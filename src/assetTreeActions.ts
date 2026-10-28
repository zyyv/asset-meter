import type { Logger } from './log'
import * as vscode from 'vscode'
import { ImageClipboard } from './imageClipboard'
import { silentLogger } from './log'
import { isSvg } from './svgPreview'

export class AssetTreeActions implements vscode.Disposable {
  private lastOpen?: { uri: string, time: number }
  private previewTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly log: Logger = silentLogger, private readonly images = new ImageClipboard()) {}

  reset(): void {
    this.lastOpen = undefined
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = undefined }
  }

  select(uri?: vscode.Uri): void {
    // Selection can arrive after the first open command. Keep that click
    // when it belongs to the selected file, so the double-click still pairs.
    if (uri?.toString() !== this.lastOpen?.uri) { this.reset() }
  }

  async open(uri: vscode.Uri): Promise<void> {
    const key = uri.toString()
    const now = Date.now()
    // Tree item commands have no mouse event. In single-click mode the
    // workbench invokes the command again on double-click; in double-click
    // mode it invokes it only once, when the double-click completes.
    const doubleClickMode = vscode.workspace.getConfiguration('workbench').get<string>('list.openMode', 'singleClick') === 'doubleClick'
    const repeated = this.lastOpen?.uri === key && now - this.lastOpen.time < 500
    if (doubleClickMode || repeated) {
      this.reset()
      await this.copy(uri)
      return
    }
    this.reset()
    this.lastOpen = { uri: key, time: now }
    if (isSvg(uri)) {
      // Creating SVG editor groups can interrupt the second click. Wait for
      // the double-click interval before opening a single-click preview.
      this.previewTimer = setTimeout(() => { this.previewTimer = undefined; void this.preview(uri) }, 500)
      return
    }
    await this.preview(uri)
  }

  private async preview(uri: vscode.Uri): Promise<void> {
    try {
      if (isSvg(uri)) { await vscode.commands.executeCommand('assetMeter.openSvg', uri) }
      else { await vscode.commands.executeCommand('vscode.open', uri, { preview: true, preserveFocus: true }) }
    }
    catch (error) {
      this.log.error(`Failed to open asset: ${uri.toString()}`, error)
      void vscode.window.showErrorMessage(`Asset Meter could not open the file: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async copy(uri: vscode.Uri): Promise<void> {
    const type = vscode.workspace.getConfiguration('assetMeter', uri).get<string>('copyType', 'relative')
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

  dispose(): void {
    this.reset()
  }
}
