import type { Logger } from './log'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import * as vscode from 'vscode'

type SvgOpenMode = 'both' | 'image' | 'code'

export function isSvg(uri: vscode.Uri): boolean {
  return /\.svg$/i.test(uri.path)
}

export class SvgPreview implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[]
  private panel?: vscode.WebviewPanel
  private document?: vscode.TextDocument
  private sourceGroup?: vscode.TabGroup
  private opening?: string
  private dismissed?: string
  private request = 0
  private task = Promise.resolve()
  private disposed = false

  constructor(private readonly log: Logger) {
    const followImageEditor = () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      if (input instanceof vscode.TabInputCustom && input.viewType === 'imagePreview.previewEditor' && isSvg(input.uri)
        && this.opening !== input.uri.toString() && this.dismissed !== input.uri.toString()) {
        void this.open(input.uri)
      }
    }
    this.subscriptions = [
      vscode.window.tabGroups.onDidChangeTabs(followImageEditor),
      vscode.window.tabGroups.onDidChangeTabGroups(followImageEditor),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document !== this.document) { this.dismissed = undefined }
        if (!editor || !isSvg(editor.document.uri) || this.opening === editor.document.uri.toString()) { return }
        if (this.dismissed === editor.document.uri.toString()) { return }
        // Reviewing a diff should never create an additional editor group.
        if (!(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText)) { return }
        void this.open(editor.document.uri, editor)
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.document?.uri.toString()) { this.render() }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!this.document || !event.affectsConfiguration('assetMeter.svgOpenMode', this.document.uri)) { return }
        const editor = vscode.window.activeTextEditor
        if (this.panel?.active || editor?.document.uri.toString() === this.document.uri.toString()) {
          void this.open(this.document.uri, editor)
        }
        else if (this.mode(this.document.uri) === 'code') { this.panel?.dispose() }
      }),
    ]
    const editor = vscode.window.activeTextEditor
    if (editor && isSvg(editor.document.uri) && vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText) {
      void this.open(editor.document.uri, editor)
    }
    else { followImageEditor() }
  }

  open(uri: vscode.Uri, editor?: vscode.TextEditor): Promise<void> {
    this.dismissed = undefined
    const request = ++this.request
    this.task = this.task.then(async () => {
      if (this.disposed || request !== this.request) { return }
      this.opening = uri.toString()
      try { await this.show(uri, editor, request) }
      finally { this.opening = undefined }
    }).catch((error: unknown) => {
      this.log.error(`Failed to open SVG: ${uri.toString()}`, error)
      void vscode.window.showErrorMessage(`Asset Meter could not open SVG: ${error instanceof Error ? error.message : String(error)}`)
    })
    return this.task
  }

  private mode(uri: vscode.Uri): SvgOpenMode {
    const mode = vscode.workspace.getConfiguration('assetMeter', uri).get<string>('svgOpenMode', 'both')
    return mode === 'image' || mode === 'code' ? mode : 'both'
  }

  private async show(uri: vscode.Uri, editor: vscode.TextEditor | undefined, request: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri)
    if (this.disposed || request !== this.request) { return }
    const mode = this.mode(uri)
    const activeGroup = vscode.window.tabGroups.activeTabGroup
    const sourceGroup = this.sourceGroup && vscode.window.tabGroups.all.includes(this.sourceGroup) ? this.sourceGroup : undefined
    const column = editor?.viewColumn ?? activeGroup.viewColumn
    const sourceColumn = this.panel?.viewColumn === column && sourceGroup ? sourceGroup.viewColumn : column
    this.document = document
    if (mode === 'code') {
      this.panel?.dispose()
      await vscode.window.showTextDocument(document, { viewColumn: sourceColumn, preview: true })
      return
    }

    const tab = activeGroup.activeTab
    if (mode === 'both') {
      const source = editor?.viewColumn === sourceColumn ? editor : await vscode.window.showTextDocument(document, { viewColumn: sourceColumn, preview: true })
      if (this.disposed || request !== this.request) { return }
      this.sourceGroup = vscode.window.tabGroups.all.find(group => group.viewColumn === source.viewColumn)
    }
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel('assetMeter.svgPreview', 'SVG Preview', {
        viewColumn: mode === 'both' ? vscode.ViewColumn.Beside : sourceColumn,
        preserveFocus: mode === 'both',
      }, { enableScripts: false, localResourceRoots: [] })
      this.panel = panel
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.dismissed = this.document?.uri.toString()
          this.panel = undefined
        }
      })
    }
    else {
      const previewColumn = mode === 'image'
        ? sourceColumn
        : this.panel.viewColumn === this.sourceGroup?.viewColumn ? vscode.ViewColumn.Beside : this.panel.viewColumn
      this.panel.reveal(previewColumn, mode === 'both')
    }
    this.render()
    // Explorer can open a fresh preview tab in the image's group. Once the
    // source is visible elsewhere, remove only that clean, temporary duplicate.
    if (tab?.isPreview && !tab.isDirty && tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()
      && (mode === 'image' || tab.group.viewColumn !== this.sourceGroup?.viewColumn)) {
      await vscode.window.tabGroups.close(tab, true)
    }
  }

  private render(): void {
    if (!this.panel || !this.document) { return }
    const nonce = randomBytes(16).toString('hex')
    const image = Buffer.from(this.document.getText()).toString('base64')
    this.panel.title = `Preview: ${posix.basename(this.document.uri.path)}`
    this.panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SVG Preview</title>
<style nonce="${nonce}">
html, body { width: 100%; height: 100%; margin: 0; }
body { display: grid; place-items: center; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
img { max-width: 100%; max-height: 100vh; object-fit: contain; background-image: conic-gradient(#8882 25%, transparent 0 50%, #8882 0 75%, transparent 0); background-size: 16px 16px; }
</style></head><body><img src="data:image/svg+xml;base64,${image}" alt="Unable to preview SVG. Check the SVG source for errors."></body></html>`
  }

  dispose(): void {
    this.disposed = true
    this.request++
    for (const subscription of this.subscriptions) { subscription.dispose() }
    this.panel?.dispose()
  }
}
