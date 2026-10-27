import type { Logger } from './log'
import type { SizeService } from './service'
import * as vscode from 'vscode'
import { imageFormat } from './compression/image'
import { describeMetrics, inlineLabel } from './core/format'
import { Limiter } from './core/limiter'
import { ScanCancelled } from './core/scanner'
import { silentLogger } from './log'
import { isSvg } from './svgPreview'

export interface AssetTreeNode {
  uri: vscode.Uri
  name: string
  isDirectory: boolean
  hasChildren: boolean
  workspaceRoot?: boolean
}

interface DirectoryEntry {
  valid: boolean
  result: Promise<AssetTreeNode[]>
}

export function assetResource(resource?: vscode.Uri | AssetTreeNode): vscode.Uri | undefined {
  return resource && 'uri' in resource ? resource.uri : resource
}

export class AssetTreeProvider implements vscode.TreeDataProvider<AssetTreeNode>, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<AssetTreeNode | undefined>()
  readonly onDidChangeTreeData = this.changes.event
  private readonly subscription: vscode.Disposable
  private readonly directories = new Map<string, DirectoryEntry>()
  private readonly limiter = new Limiter(16)
  private readonly collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  private disposed = false

  constructor(private readonly service: SizeService, private readonly log: Logger = silentLogger) {
    this.subscription = service.onDidChange((uris) => {
      for (const [key, entry] of this.directories) {
        const directory = vscode.Uri.parse(key)
        if (!uris || uris.some(uri => within(uri, directory) || within(directory, uri))) {
          entry.valid = false
          this.directories.delete(key)
        }
      }
      this.changes.fire(undefined)
    })
  }

  async getChildren(element?: AssetTreeNode): Promise<AssetTreeNode[]> {
    if (this.disposed) { return [] }
    if (element) { return element.isDirectory ? this.children(element.uri) : [] }
    const folders = vscode.workspace.workspaceFolders ?? []
    const roots = await Promise.all(folders.map(async (folder) => {
      const settings = this.service.settings(folder.uri)
      if (!settings.enabled || !settings.include.length || this.service.isExcluded(folder.uri)) { return undefined }
      const children = await this.children(folder.uri)
      return { folder, children }
    }))
    if (folders.length === 1) { return roots[0]?.children ?? [] }
    return roots.flatMap(root => root && (root.children.length || this.service.matches(root.folder.uri))
      ? [{ uri: root.folder.uri, name: root.folder.name, isDirectory: true, hasChildren: root.children.length > 0, workspaceRoot: true }]
      : [])
  }

  async getTreeItem(element: AssetTreeNode): Promise<vscode.TreeItem> {
    const state = !element.hasChildren
      ? vscode.TreeItemCollapsibleState.None
      : element.workspaceRoot ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    const item = new vscode.TreeItem(element.name, state)
    item.id = element.uri.toString()
    // Keep theme file/folder icons, without duplicating the original Explorer's
    // size decoration badge alongside this view's full description.
    item.resourceUri = element.uri.with({ scheme: 'asset-meter-tree' })
    item.iconPath = element.isDirectory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File
    item.contextValue = element.isDirectory ? 'assetMeter.folder' : imageFormat(element.uri.path) ? 'assetMeter.image' : 'assetMeter.file'
    if (!element.isDirectory) {
      item.command = { command: isSvg(element.uri) ? 'assetMeter.openSvg' : 'vscode.open', title: 'Open File', arguments: [element.uri] }
    }
    try {
      const metrics = await this.service.measure(element.uri)
      const settings = this.service.settings(element.uri)
      item.description = inlineLabel(metrics, settings)
      item.tooltip = `${element.uri.path}\n\n${describeMetrics(metrics, settings)}`
      item.accessibilityInformation = { label: `${element.name}, ${item.description}` }
    }
    catch (error) {
      if (!(error instanceof ScanCancelled)) { this.log.warn(`Asset tree measurement failed: ${element.uri.toString()}`, error) }
      item.tooltip = element.uri.path
    }
    return item
  }

  private children(uri: vscode.Uri): Promise<AssetTreeNode[]> {
    const key = uri.toString()
    let entry = this.directories.get(key)
    if (!entry) {
      const created: DirectoryEntry = { valid: true, result: Promise.resolve([]) }
      created.result = this.readChildren(uri, created).catch((error: unknown) => {
        if (this.directories.get(key) === created) { this.directories.delete(key) }
        if (!(error instanceof ScanCancelled)) { this.log.warn(`Asset tree directory read failed: ${key}`, error) }
        return []
      })
      this.directories.set(key, created)
      entry = created
    }
    return entry.result
  }

  private async readChildren(uri: vscode.Uri, entry: DirectoryEntry): Promise<AssetTreeNode[]> {
    const check = () => { if (!entry.valid || this.disposed) { throw new ScanCancelled() } }
    const listing = await this.limiter.run(async () => {
      check()
      return vscode.workspace.fs.readDirectory(uri)
    })
    check()
    const nodes = await Promise.all(listing.map(async ([name, type]): Promise<AssetTreeNode | undefined> => {
      if ((type & vscode.FileType.SymbolicLink) !== 0) { return undefined }
      const child = vscode.Uri.joinPath(uri, name)
      if (this.service.isExcluded(child)) { return undefined }
      const isDirectory = (type & vscode.FileType.Directory) !== 0
      if (!isDirectory && (type & vscode.FileType.File) === 0) { return undefined }
      const matched = this.service.matches(child)
      const descendants = isDirectory ? await this.children(child) : []
      check()
      if (!matched && !descendants.length) { return undefined }
      return { uri: child, name, isDirectory, hasChildren: descendants.length > 0 }
    }))
    check()
    return nodes.filter((node): node is AssetTreeNode => node !== undefined)
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || this.collator.compare(a.name, b.name))
  }

  dispose(): void {
    this.disposed = true
    this.subscription.dispose()
    for (const entry of this.directories.values()) { entry.valid = false }
    this.directories.clear()
    this.changes.dispose()
  }
}

function within(uri: vscode.Uri, parent: vscode.Uri): boolean {
  return uri.scheme === parent.scheme && uri.authority === parent.authority
    && (uri.path === parent.path || uri.path.startsWith(`${parent.path.replace(/\/$/, '')}/`))
}
