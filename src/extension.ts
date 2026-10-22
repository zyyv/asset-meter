import type { Metrics } from './core/types'
import * as vscode from 'vscode'
import { ImageCompression } from './compression/preview'
import { SizeDecorationProvider } from './decorations'
import { getNativePatchStatus, installNativePatch, restoreNativePatch } from './nativePatch'
import { SizeService } from './service'

export interface AssetSizeApi {
  getSize: (uri: vscode.Uri) => Promise<Metrics | undefined>
}

export async function activate(context: vscode.ExtensionContext): Promise<AssetSizeApi> {
  const service = new SizeService()
  const compression = new ImageCompression(context, uri => service.invalidate([uri]))
  const patchStatus = await getNativePatchStatus(vscode.env.appRoot).catch(error => ({
    installed: false,
    needsUpgrade: false,
    appliedAt: 0,
    reason: error instanceof Error ? error.message : String(error),
  }))
  // Written program files take effect only in a freshly started extension host.
  const nativePatchActive = patchStatus.installed && Date.now() - process.uptime() * 1000 >= patchStatus.appliedAt
  const decorations = new SizeDecorationProvider(service, nativePatchActive)
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<string, vscode.Uri>()
  const flush = () => {
    timer = undefined
    const uris = [...pending.values()]
    pending.clear()
    if (uris.length) { service.invalidate(uris) }
  }
  const queue = (uri: vscode.Uri) => {
    if (service.isExcluded(uri)) { return }
    pending.set(uri.toString(), uri)
    if (timer) { return }
    const delay = vscode.workspace.getConfiguration('assetSize').get('refreshDelay', 400)
    timer = setTimeout(flush, delay)
  }
  const watchers = new Map<string, vscode.Disposable>()
  const watchWorkspace = () => {
    for (const watcher of watchers.values()) { watcher.dispose() }
    watchers.clear()
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
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
    decorations,
    compression,
    vscode.commands.registerCommand('assetSize.compressImage', (uri?: vscode.Uri) => compression.compress(uri)),
    vscode.window.registerFileDecorationProvider(decorations),
    new vscode.Disposable(() => { for (const watcher of watchers.values()) { watcher.dispose() } watchers.clear() }),
    vscode.workspace.onDidSaveTextDocument((document) => { queue(document.uri) }),
    vscode.workspace.onDidCreateFiles((event) => { event.files.forEach(queue) }),
    vscode.workspace.onDidDeleteFiles((event) => { event.files.forEach(queue) }),
    vscode.workspace.onDidRenameFiles((event) => { event.files.forEach((file) => { queue(file.oldUri); queue(file.newUri) }) }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('assetSize')) { service.invalidate(undefined, true) }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { watchWorkspace(); service.invalidate(undefined, true) }),
    vscode.commands.registerCommand('assetSize.refresh', () => { service.invalidate() }),
    vscode.commands.registerCommand('assetSize.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)),
    vscode.commands.registerCommand('assetSize.installNativePatch', async () => {
      try {
        await installNativePatch(vscode.env.appRoot)
        const action = await vscode.window.showInformationMessage('Native Explorer patch installed. Original files are backed up. Reload to show file counts followed by sizes.', 'Reload Window')
        if (action) { await vscode.commands.executeCommand('workbench.action.reloadWindow') }
      }
      catch (error) {
        void vscode.window.showErrorMessage(`Assets Size patch installation failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
    vscode.commands.registerCommand('assetSize.restoreNativePatch', async () => {
      try {
        await restoreNativePatch(vscode.env.appRoot)
        const action = await vscode.window.showInformationMessage('Original VS Code files restored. Backups are retained. Reload the window to apply the change.', 'Reload Window')
        if (action) { await vscode.commands.executeCommand('workbench.action.reloadWindow') }
      }
      catch (error) {
        void vscode.window.showErrorMessage(`Assets Size patch restoration failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
    vscode.commands.registerCommand('assetSize.toggleDisplayMode', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri
      const config = vscode.workspace.getConfiguration('assetSize', uri)
      const mode = config.get('displayMode', 'always') === 'always' ? 'hover' : 'always'
      const target = config.inspect('displayMode')?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : vscode.workspace.workspaceFolders?.length
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global
      await config.update('displayMode', mode, target)
      vscode.window.setStatusBarMessage(`Assets Size: ${mode === 'always' ? 'Always show sizes' : 'Hover only'}`, 2500)
    }),
    new vscode.Disposable(() => { if (timer) { clearTimeout(timer) } pending.clear() }),
  )
  const noticeKey = patchStatus.needsUpgrade ? 'nativePatchUpgradeV3NoticeShown' : 'nativePatchV3NoticeShown'
  if (!nativePatchActive && !context.globalState.get(noticeKey, false)) {
    void context.globalState.update(noticeKey, true)
    void vscode.window.showInformationMessage(
      patchStatus.needsUpgrade
        ? 'Update the native Explorer patch to fix leading digits in labels and keep colors on size text only. Original backups will be preserved.'
        : 'Full inline labels require a reversible VS Code patch. It triggers an integrity warning and must be reapplied after editor updates.',
      patchStatus.needsUpgrade ? 'Update Patch' : 'Install Patch',
    ).then((action) => { if (action) { void vscode.commands.executeCommand('assetSize.installNativePatch') } })
  }
  return {
    getSize: async uri => service.isExcluded(uri) || !service.settings(uri).enabled ? undefined : service.measure(uri),
  }
}
