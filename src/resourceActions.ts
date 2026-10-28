import type { Logger } from './log'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import { silentLogger } from './log'

export type AssetResource = vscode.Uri | { uri: vscode.Uri }

export function assetResource(resource?: AssetResource): vscode.Uri | undefined {
  return resource && 'uri' in resource ? resource.uri : resource
}

export function assetResources(resource?: AssetResource, selection?: readonly AssetResource[]): vscode.Uri[] {
  const clicked = assetResource(resource)
  // Editor title actions can pass editor context as the second argument.
  const uris = Array.isArray(selection) ? selection.map(item => assetResource(item)!) : []
  const selected = clicked && !uris.some(uri => uri.toString() === clicked.toString()) ? [clicked] : uris
  return [...new Map(selected.map(uri => [uri.toString(), uri])).values()]
}

interface ResourceActions {
  openSvg: (uri: vscode.Uri) => unknown
  previewImage: (uri?: vscode.Uri) => unknown
  compressImage: (uri?: vscode.Uri) => unknown
  compressImages: (uris: readonly vscode.Uri[]) => unknown
  copyRelativePath: (uri?: vscode.Uri) => unknown
  copyAbsolutePath: (uri?: vscode.Uri) => unknown
  copyImage: (uri?: vscode.Uri) => unknown
  deleteResource: (uri?: vscode.Uri) => unknown
}

export function registerResourceActions(actions: ResourceActions): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('assetMeter.openSvg', (uri: vscode.Uri) => actions.openSvg(uri)),
    vscode.commands.registerCommand('assetMeter.previewImage', (resource?: AssetResource) => actions.previewImage(assetResource(resource))),
    vscode.commands.registerCommand('assetMeter.compressImage', (resource?: AssetResource, selection?: readonly AssetResource[]) => {
      const uris = assetResources(resource, selection)
      return uris.length > 1 ? actions.compressImages(uris) : actions.compressImage(uris[0])
    }),
    vscode.commands.registerCommand('assetMeter.compressImages', (resource?: AssetResource, selection?: readonly AssetResource[]) => actions.compressImages(assetResources(resource, selection))),
    vscode.commands.registerCommand('assetMeter.copyRelativePath', (resource?: AssetResource) => actions.copyRelativePath(assetResource(resource))),
    vscode.commands.registerCommand('assetMeter.copyAbsolutePath', (resource?: AssetResource) => actions.copyAbsolutePath(assetResource(resource))),
    vscode.commands.registerCommand('assetMeter.copyImage', (resource?: AssetResource) => actions.copyImage(assetResource(resource))),
    vscode.commands.registerCommand('assetMeter.deleteResource', (resource?: AssetResource) => actions.deleteResource(assetResource(resource))),
    vscode.commands.registerCommand('assetMeter.revealInExplorer', (resource?: AssetResource) => {
      const uri = assetResource(resource)
      if (uri) { return vscode.commands.executeCommand('revealInExplorer', uri) }
    }),
    vscode.commands.registerCommand('assetMeter.revealInFinder', (resource?: AssetResource) => {
      const uri = assetResource(resource)
      if (uri?.scheme === 'file') { return vscode.commands.executeCommand('revealFileInOS', uri) }
      if (uri) { void vscode.window.showInformationMessage('Finder can only reveal files stored on this Mac.') }
    }),
  )
}

export async function deleteResource(uri: vscode.Uri | undefined, onDeleted: (uri: vscode.Uri) => void, log: Logger = silentLogger): Promise<boolean> {
  if (!uri) { return false }
  const workspaceRoot = vscode.workspace.workspaceFolders?.some(folder => folder.uri.scheme === uri.scheme && folder.uri.authority === uri.authority
    && folder.uri.path.replace(/\/+$/, '') === uri.path.replace(/\/+$/, ''))
  if (workspaceRoot) {
    void vscode.window.showInformationMessage('Workspace roots cannot be deleted from Asset Meter.')
    return false
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri)
    const directory = (stat.type & vscode.FileType.Directory) !== 0
    const selected = await vscode.window.showWarningMessage(`Delete "${posix.basename(uri.path)}"?`, {
      modal: true,
      detail: `${directory ? 'This includes all files and folders inside this folder.\n\n' : ''}Moves to Trash when supported. Otherwise deletion may be permanent.\n\n${uri.scheme === 'file' ? uri.fsPath : uri.toString()}`,
    }, { title: 'Delete' })
    if (selected?.title !== 'Delete') { return false }
    await vscode.workspace.fs.delete(uri, { recursive: directory, useTrash: true })
    onDeleted(uri)
    return true
  }
  catch (error) {
    log.error(`Resource deletion failed: ${uri.toString()}`, error)
    void vscode.window.showErrorMessage(`Unable to delete "${posix.basename(uri.path)}": ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
