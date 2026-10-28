import type { Logger } from './log'
import * as vscode from 'vscode'
import { ImageClipboard } from './imageClipboard'
import { silentLogger } from './log'
import { isSvg } from './svgPreview'

export class AssetTreeActions {
  constructor(private readonly log: Logger = silentLogger, private readonly images = new ImageClipboard()) {}

  async open(uri: vscode.Uri): Promise<void> {
    try {
      if (isSvg(uri)) { await vscode.commands.executeCommand('assetMeter.openSvg', uri) }
      else { await vscode.commands.executeCommand('vscode.open', uri, { preview: true, preserveFocus: true }) }
    }
    catch (error) {
      this.log.error(`Failed to open asset: ${uri.toString()}`, error)
      void vscode.window.showErrorMessage(`Asset Meter could not open the file: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async copy(uri: vscode.Uri, type: 'relative' | 'absolute' | 'image'): Promise<void> {
    try {
      if (type === 'image') {
        await this.images.copy(uri)
        void vscode.window.showInformationMessage(`Asset Meter: Copied image: ${vscode.workspace.asRelativePath(uri, false)}`)
        return
      }
      const path = type === 'absolute' ? uri.fsPath : vscode.workspace.asRelativePath(uri, false)
      await vscode.env.clipboard.writeText(path)
      void vscode.window.showInformationMessage(`Asset Meter: Copied path: ${path}`)
    }
    catch (error) {
      this.log.error(`Failed to copy asset (${type}): ${uri.toString()}`, error)
      void vscode.window.showErrorMessage(`Asset Meter could not copy ${type === 'image' ? 'the image' : 'the path'}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
