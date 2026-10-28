import * as vscode from 'vscode'

export type AssetResource = vscode.Uri | { uri: vscode.Uri }

export function assetResource(resource?: AssetResource): vscode.Uri | undefined {
  return resource && 'uri' in resource ? resource.uri : resource
}

interface ResourceActions {
  openSvg: (uri: vscode.Uri) => unknown
  previewImage: (uri?: vscode.Uri) => unknown
  compressImage: (uri?: vscode.Uri) => unknown
}

export function registerResourceActions(actions: ResourceActions): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('assetMeter.openSvg', (uri: vscode.Uri) => actions.openSvg(uri)),
    vscode.commands.registerCommand('assetMeter.previewImage', (resource?: AssetResource) => actions.previewImage(assetResource(resource))),
    vscode.commands.registerCommand('assetMeter.compressImage', (resource?: AssetResource) => actions.compressImage(assetResource(resource))),
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
