import type { AssetTreeNode } from './assetTree'
import type { CompressionPlugin } from './compression/plugins'
import type { Metrics } from './core/types'
import * as vscode from 'vscode'
import { assetResource, AssetTreeProvider } from './assetTree'
import { ImageCompression } from './compression/preview'
import { SizeDecorationProvider } from './decorations'
import { getNativePatchStatus, installNativePatch, restoreNativePatch } from './nativePatch'
import { SizeService } from './service'
import { SvgPreview } from './svgPreview'

export interface AssetMeterApi {
  getSize: (uri: vscode.Uri) => Promise<Metrics | undefined>
  registerCompressionPlugin: (plugin: CompressionPlugin) => vscode.Disposable
}

export type { CompressionContext, CompressionInput, CompressionPlugin } from './compression/plugins'
export type { CompressionJob } from './compression/runner'

export async function activate(context: vscode.ExtensionContext): Promise<AssetMeterApi> {
  const output = vscode.window.createOutputChannel('Asset Meter', { log: true })
  context.subscriptions.push(output)
  output.info(`Activating ${context.extension.id} ${context.extension.packageJSON.version}; VS Code ${vscode.version}`, JSON.stringify({ appRoot: vscode.env.appRoot, remoteName: vscode.env.remoteName }))
  const service = new SizeService(output)
  const assetTree = new AssetTreeProvider(service, output)
  const assetView = vscode.window.createTreeView('assetMeter.explorer', { treeDataProvider: assetTree, showCollapseAll: true })
  const refresh = (uris: readonly vscode.Uri[]) => {
    void service.refresh(uris).catch(error => output.error('Failed to refresh sizes.', error))
  }
  const compression = new ImageCompression(context, uri => refresh([uri]))
  const svgPreview = new SvgPreview(output)
  const readPatchStatus = () => getNativePatchStatus(vscode.env.appRoot).catch((error) => {
    output.error('Failed to read native Explorer patch status.', error)
    return { installed: false, needsUpgrade: false, appliedAt: 0, reason: error instanceof Error ? error.message : String(error) }
  })
  const patchStatus = await readPatchStatus()
  // Written program files take effect only in a freshly started extension host.
  const nativePatchActive = patchStatus.installed && Date.now() - process.uptime() * 1000 >= patchStatus.appliedAt
  const decorations = new SizeDecorationProvider(service, nativePatchActive, output)
  const logRenderingStatus = (uri?: vscode.Uri, status = patchStatus) => {
    const badges = vscode.workspace.getConfiguration('explorer', uri).get('decorations.badges', true)
    output.info('Explorer rendering status', JSON.stringify({ nativePatchActive, badges, patchStatus: status }))
    if (!nativePatchActive) {
      output.warn(status.installed
        ? 'Native patch is installed but this extension host must reload before full inline sizes can be displayed.'
        : `${status.reason} Always mode uses compact badges (or ⓘ); hover for exact sizes. Run Asset Meter: Install / Reapply Native Explorer Patch for full inline labels.`)
    }
    if (!badges) { output.warn('explorer.decorations.badges is false; Explorer will hide size badges. Enable it in Settings.') }
  }
  logRenderingStatus()
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<string, vscode.Uri>()
  const flush = () => {
    timer = undefined
    const uris = [...pending.values()]
    pending.clear()
    if (uris.length) { refresh(uris) }
  }
  const queue = (uri: vscode.Uri) => {
    if (service.isExcluded(uri)) { return }
    pending.set(uri.toString(), uri)
    if (timer) { return }
    const delay = vscode.workspace.getConfiguration('assetMeter').get('refreshDelay', 400)
    timer = setTimeout(flush, delay)
  }
  const watchers = new Map<string, vscode.Disposable>()
  const watchWorkspace = () => {
    for (const watcher of watchers.values()) { watcher.dispose() }
    watchers.clear()
    output.info('Watching workspaces', JSON.stringify((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.toString())))
    if (!vscode.workspace.workspaceFolders?.length) { output.warn('No workspace folders are open. Open a folder to enable resource matching.') }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      service.settings(folder.uri)
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'))
      watchers.set(folder.uri.toString(), vscode.Disposable.from(
        watcher,
        watcher.onDidCreate(queue),
        watcher.onDidChange(queue),
        watcher.onDidDelete(queue),
      ))
    }
  }
  watchWorkspace()
  context.subscriptions.push(
    service,
    assetTree,
    assetView,
    decorations,
    compression,
    svgPreview,
    vscode.commands.registerCommand('assetMeter.openSvg', (uri: vscode.Uri) => svgPreview.open(uri)),
    vscode.commands.registerCommand('assetMeter.compressImage', (resource?: vscode.Uri | AssetTreeNode) => compression.compress(assetResource(resource))),
    vscode.commands.registerCommand('assetMeter.revealInExplorer', (resource?: vscode.Uri | AssetTreeNode) => {
      const uri = assetResource(resource)
      if (uri) { return vscode.commands.executeCommand('revealInExplorer', uri) }
    }),
    vscode.window.registerFileDecorationProvider(decorations),
    new vscode.Disposable(() => { for (const watcher of watchers.values()) { watcher.dispose() } watchers.clear() }),
    vscode.workspace.onDidSaveTextDocument((document) => { queue(document.uri) }),
    vscode.workspace.onDidCreateFiles((event) => { event.files.forEach(queue) }),
    vscode.workspace.onDidDeleteFiles((event) => { event.files.forEach(queue) }),
    vscode.workspace.onDidRenameFiles((event) => { event.files.forEach((file) => { queue(file.oldUri); queue(file.newUri) }) }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('assetMeter') || event.affectsConfiguration('explorer.decorations')) {
        service.invalidate(undefined, true)
        for (const folder of vscode.workspace.workspaceFolders ?? []) { service.settings(folder.uri) }
        logRenderingStatus()
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { watchWorkspace(); service.invalidate(undefined, true) }),
    vscode.commands.registerCommand('assetMeter.refresh', () => { output.info('Manual size refresh requested.'); service.invalidate() }),
    vscode.commands.registerCommand('assetMeter.showOutput', () => { output.show(true) }),
    vscode.commands.registerCommand('assetMeter.diagnose', async (resource?: vscode.Uri | AssetTreeNode) => {
      output.show(true)
      const uri = assetResource(resource) ?? vscode.window.activeTextEditor?.document.uri ?? (await vscode.window.showOpenDialog({
        title: 'Asset Meter: Select a file or folder to diagnose',
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      }))?.[0]
      if (!uri) { return }
      try {
        logRenderingStatus(uri, await readPatchStatus())
        const match = service.inspectMatch(uri)
        output.info(`File matching diagnosis: ${uri.toString()}`, JSON.stringify(match))
        if (match.workspace) { output.info('Effective matching settings', JSON.stringify(service.settings(uri))) }
        if (!match.matched) { output.warn(`No decoration: ${match.reason}`); return match }
        const stat = await service.stat(uri)
        if ((stat.type & vscode.FileType.SymbolicLink) !== 0) { output.warn('No decoration: symbolic-link'); return { ...match, reason: 'symbolic-link' } }
        const metrics = await service.measure(uri)
        output.info('Size calculation result', JSON.stringify(metrics))
        return { ...match, metrics }
      }
      catch (error) { output.error(`File matching diagnosis failed: ${uri.toString()}`, error) }
    }),
    vscode.commands.registerCommand('assetMeter.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)),
    vscode.commands.registerCommand('assetMeter.installNativePatch', async () => {
      try {
        output.info('Installing native Explorer patch.')
        const result = await installNativePatch(vscode.env.appRoot)
        output.info('Native Explorer patch installed; reload required.', JSON.stringify(result))
        const action = await vscode.window.showInformationMessage('Native Explorer patch installed. Original files are backed up. Reload to show file counts followed by sizes.', 'Reload Window')
        if (action) { await vscode.commands.executeCommand('workbench.action.reloadWindow') }
      }
      catch (error) {
        output.error('Native Explorer patch installation failed.', error)
        void vscode.window.showErrorMessage(`Asset Meter patch installation failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
    vscode.commands.registerCommand('assetMeter.restoreNativePatch', async () => {
      try {
        output.info('Restoring original VS Code files.')
        const result = await restoreNativePatch(vscode.env.appRoot)
        output.info('Original VS Code files restored; reload required.', JSON.stringify(result))
        const action = await vscode.window.showInformationMessage('Original VS Code files restored. Backups are retained. Reload the window to apply the change.', 'Reload Window')
        if (action) { await vscode.commands.executeCommand('workbench.action.reloadWindow') }
      }
      catch (error) {
        output.error('Native Explorer patch restoration failed.', error)
        void vscode.window.showErrorMessage(`Asset Meter patch restoration failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
    vscode.commands.registerCommand('assetMeter.toggleDisplayMode', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri
      const config = vscode.workspace.getConfiguration('assetMeter', uri)
      const mode = config.get('displayMode', 'always') === 'always' ? 'hover' : 'always'
      const target = config.inspect('displayMode')?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : vscode.workspace.workspaceFolders?.length
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global
      await config.update('displayMode', mode, target)
      vscode.window.setStatusBarMessage(`Asset Meter: ${mode === 'always' ? 'Always show sizes' : 'Show sizes on row hover'}`, 2500)
    }),
    new vscode.Disposable(() => { if (timer) { clearTimeout(timer) } pending.clear() }),
  )
  const noticeKey = patchStatus.needsUpgrade ? 'nativePatchUpgradeV7NoticeShown' : 'nativePatchV7NoticeShown'
  if (!nativePatchActive && !context.globalState.get(noticeKey, false)) {
    void context.globalState.update(noticeKey, true)
    void vscode.window.showInformationMessage(
      patchStatus.needsUpgrade
        ? 'Update the native Explorer patch to use consistent file count and size spacing in both asset trees. Original backups will be preserved.'
        : 'Full inline labels require a reversible VS Code patch. It triggers an integrity warning and must be reapplied after editor updates.',
      patchStatus.needsUpgrade ? 'Update Patch' : 'Install Patch',
    ).then((action) => { if (action) { void vscode.commands.executeCommand('assetMeter.installNativePatch') } })
  }
  return {
    getSize: async uri => service.isExcluded(uri) || !service.settings(uri).enabled ? undefined : service.measure(uri),
    registerCompressionPlugin: plugin => compression.plugins.register(plugin),
  }
}
