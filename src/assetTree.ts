import type { Logger } from './log'
import type { MetadataService } from './metadata/service'
import type { SizeService } from './service'
import * as vscode from 'vscode'
import { imageFormat } from './compression/image'
import { describeMetrics, inlineLabel, nativeSizeLabel } from './core/format'
import { Limiter } from './core/limiter'
import { ScanCancelled } from './core/scanner'
import { sizeSeverity } from './core/severity'
import { isSameOrChild } from './core/uri'
import { silentLogger } from './log'
import { isPreviewImage, supportsMetadata } from './metadata/formats'
import { hasMetadata } from './metadata/normalize'
import { imageDetailsMarkdown } from './metadata/rendering/markdown'
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

export class AssetTreeProvider implements vscode.TreeDataProvider<AssetTreeNode>, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<AssetTreeNode | undefined>()
  readonly onDidChangeTreeData = this.changes.event
  private readonly subscription: vscode.Disposable
  private readonly directories = new Map<string, DirectoryEntry>()
  private readonly limiter = new Limiter(16)
  private readonly collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  private disposed = false
  private readonly metadataSubscription?: vscode.Disposable
  private readonly nodes = new Map<string, AssetTreeNode>()

  constructor(private readonly service: SizeService, private readonly log: Logger = silentLogger, private readonly metadata?: MetadataService, private readonly nativePatchActive = false) {
    this.subscription = service.onDidChange((uris) => {
      for (const [key, entry] of this.directories) {
        const directory = vscode.Uri.parse(key)
        if (!uris || uris.some(uri => isSameOrChild(uri, directory) || isSameOrChild(directory, uri))) {
          entry.valid = false
          this.directories.delete(key)
        }
      }
      this.nodes.clear()
      this.changes.fire(undefined)
    })
    this.metadataSubscription = metadata?.onDidChange((uri) => {
      const node = this.nodes.get(uri.toString())
      if (node && !this.disposed) { this.changes.fire(node) }
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
    this.nodes.set(element.uri.toString(), element)
    const state = !element.hasChildren
      ? vscode.TreeItemCollapsibleState.None
      : vscode.TreeItemCollapsibleState.Expanded
    const item = new vscode.TreeItem(element.name, state)
    item.id = element.uri.toString()
    // Keep theme file/folder icons, without duplicating the original Explorer's
    // size decoration badge alongside this view's full description.
    item.resourceUri = element.uri.with({ scheme: 'asset-meter-tree' })
    item.iconPath = element.isDirectory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File
    item.contextValue = element.workspaceRoot ? 'assetMeter.workspaceRoot' : element.isDirectory ? 'assetMeter.folder' : imageFormat(element.uri.path) ? 'assetMeter.image' : isPreviewImage(element.uri.path) ? 'assetMeter.previewImage' : 'assetMeter.file'
    if (!element.isDirectory) {
      item.command = { command: isSvg(element.uri) ? 'assetMeter.openSvg' : 'vscode.open', title: 'Open File', arguments: [element.uri] }
    }
    try {
      const metrics = await this.service.measure(element.uri)
      const settings = this.service.settings(element.uri)
      const metadata = this.metadata?.peek(element.uri)
      const description = `${hasMetadata(metadata) ? 'ⓘ · ' : ''}${inlineLabel(metrics, settings)}`
      const severity = settings.colorize ? sizeSeverity(metrics.bytes, metrics.isDirectory, settings) : 'normal'
      item.description = this.nativePatchActive ? nativeSizeLabel(description, severity) : description
      const details = `Path: ${element.uri.path}\n${describeMetrics(metrics, settings)}`
      item.tooltip = details
      if (!element.isDirectory && isPreviewImage(element.uri.path)) {
        // Leave tooltip unset while parsing so VS Code can lazily resolve it
        // on hover. Size rows never await the metadata worker.
        item.tooltip = this.metadata && supportsMetadata(element.uri.path) && !metadata
          ? undefined
          : imageDetailsMarkdown(element.uri, metrics, settings, metadata, { view: 'hover' })
        if (this.metadata && !metadata) { void this.metadata.get(element.uri) }
      }
      item.accessibilityInformation = { label: `${element.name}, ${hasMetadata(metadata) ? 'metadata available, ' : ''}${inlineLabel(metrics, settings)}` }
    }
    catch (error) {
      if (!(error instanceof ScanCancelled)) { this.log.warn(`Asset tree measurement failed: ${element.uri.toString()}`, error) }
      item.tooltip = `Path: ${element.uri.path}`
    }
    return item
  }

  async resolveTreeItem(item: vscode.TreeItem, element: AssetTreeNode, token: vscode.CancellationToken): Promise<vscode.TreeItem> {
    if (!this.metadata || element.isDirectory || token.isCancellationRequested) { return item }
    const metadata = await this.metadata.get(element.uri)
    if (this.disposed || token.isCancellationRequested) { return item }
    try {
      const metrics = await this.service.measure(element.uri)
      if (!token.isCancellationRequested) { item.tooltip = imageDetailsMarkdown(element.uri, metrics, this.service.settings(element.uri), metadata, { view: 'hover' }) }
    }
    catch { /* A removed file should not interrupt the hover. */ }
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
    this.metadataSubscription?.dispose()
    this.nodes.clear()
    for (const entry of this.directories.values()) { entry.valid = false }
    this.directories.clear()
    this.changes.dispose()
  }
}
