import type { SaveBehavior } from './image'
import type { CompressionJob } from './runner'
import { createHash, randomBytes } from 'node:crypto'
import { basename, posix } from 'node:path'
import * as vscode from 'vscode'
import { formatSize as formatBytes } from '../core/format'
import { compressedName, imageFormat, maxInputBytes, validateImage } from './image'
import { startCompression } from './runner'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character]!)

export class ImageCompression implements vscode.Disposable {
  private readonly jobs = new Set<CompressionJob>()
  private readonly pending = new Set<string>()
  private readonly panels = new Set<vscode.WebviewPanel>()
  private disposed = false

  constructor(private readonly context: vscode.ExtensionContext, private readonly onSaved: (uri: vscode.Uri) => void) {}

  async compress(resource?: vscode.Uri): Promise<void> {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    const uri = resource instanceof vscode.Uri
      ? resource
      : input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined
    const format = uri && imageFormat(uri.path)
    if (!uri || !format) {
      void vscode.window.showInformationMessage('Open a JPEG, PNG or WebP image preview to compress it.'); return
    }
    const key = uri.toString()
    if (this.pending.has(key)) { return }
    this.pending.add(key)
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.size > maxInputBytes) { throw new Error('Choose an image smaller than 50 MiB.') }
      const original = await vscode.workspace.fs.readFile(uri)
      validateImage(original, format)
      const qualitySetting = vscode.workspace.getConfiguration('assetSize.compression', uri).get<number>('quality', 75)
      const quality = Number.isFinite(qualitySetting) ? Math.min(100, Math.max(1, Math.round(qualitySetting))) : 75
      const output = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Compressing ${basename(uri.path)}…`,
        cancellable: true,
      }, async (_progress, token) => {
        const job = startCompression(vscode.Uri.joinPath(this.context.extensionUri, 'dist').fsPath, original, format, quality)
        this.jobs.add(job)
        const cancellation = token.onCancellationRequested(() => job.cancel())
        if (token.isCancellationRequested) { job.cancel() }
        try { return await job.result }
        finally { cancellation.dispose(); this.jobs.delete(job) }
      })
      if (!this.disposed) { this.openComparison(uri, original, output, format === 'png' ? 'Lossless PNG' : `${format.toUpperCase()} · quality ${quality}`) }
    }
    catch (error) {
      if (error instanceof Error && error.message === 'Compression cancelled.') { return }
      void vscode.window.showErrorMessage(`Asset Size compression failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally { this.pending.delete(key) }
  }

  private openComparison(uri: vscode.Uri, original: Uint8Array, compressed: Uint8Array, method: string): void {
    const panel = vscode.window.createWebviewPanel('assetSize.imageDiff', `Compress: ${basename(uri.path)}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    })
    this.panels.add(panel)
    const nonce = randomBytes(16).toString('hex')
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'compression-preview.js'))
    const mime = imageFormat(uri.path) === 'jpeg' ? 'image/jpeg' : `image/${imageFormat(uri.path)}`
    const imageUrl = (bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
    const saved = original.length - compressed.length
    const savings = saved > 0 ? `${formatBytes(saved, 'decimal', 1)} smaller (${(saved / original.length * 100).toFixed(1)}%)` : 'No size reduction — original retained'
    const originalUrl = imageUrl(original)
    const compressedUrl = imageUrl(compressed)
    panel.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Image compression comparison</title><style nonce="${nonce}">
body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.5 var(--vscode-font-family); }
header { padding: 18px 24px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
h1 { margin: 0; font-size: 15px; overflow-wrap: anywhere; } p { margin: 3px 0 0; color: var(--vscode-descriptionForeground); }
.info { flex: 1 1 240px; } .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
button, select { font: inherit; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; padding: 6px 12px; }
button { cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); } button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button:disabled { opacity: .5; cursor: default; } select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 3px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; padding: 12px 24px; } label { display: flex; gap: 8px; align-items: center; }
#status { padding: 0 24px 12px; min-height: 1.5em; } .success { color: var(--vscode-testing-iconPassed); }
main { padding: 0 24px 24px; } .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--vscode-panel-border); border: 1px solid var(--vscode-panel-border); }
figure { margin: 0; min-width: 0; background: var(--vscode-editor-background); } figcaption { display: flex; justify-content: space-between; gap: 8px; padding: 10px 14px; }
.canvas { height: calc(100vh - 235px); min-height: 220px; overflow: auto; display: grid; place-items: center; background-color: var(--vscode-editor-background); background-image: conic-gradient(var(--vscode-editorWidget-background) 25%, transparent 0 50%, var(--vscode-editorWidget-background) 0 75%, transparent 0); background-size: 20px 20px; }
.canvas img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; } .actual .canvas { display: block; } .actual .canvas img { max-width: none; max-height: none; }
.overlay { display: none; } .overlay .canvas { position: relative; display: block; } .overlay img { position: absolute; inset: 0; width: 100%; height: 100%; } .overlay #after-overlay { clip-path: inset(0 0 0 50%); }
.slider .pair { display: none; } .slider .overlay { display: block; } #slider-control { display: none; } .slider #slider-control { display: flex; } input[type=range] { accent-color: var(--vscode-focusBorder); }
#zoom-control[hidden] { display: none; }
@media (max-width: 650px) { .pair { grid-template-columns: 1fr; } .canvas { height: 38vh; } header, .toolbar { padding-left: 14px; padding-right: 14px; } main { padding: 0 14px 14px; } }
</style></head><body>
<header><div class="info"><h1>${escapeHtml(basename(uri.path))}</h1><p>${escapeHtml(method)} · ${escapeHtml(savings)}</p></div>
<div class="actions"><button id="save" ${saved <= 0 ? 'disabled' : ''}>Save Result…</button><button id="discard" class="secondary">Discard</button></div></header>
<div class="toolbar"><label>Compare <select id="mode"><option value="pair">Side by side</option><option value="slider">Slider</option></select></label>
<label id="zoom-control">Zoom <select id="zoom"><option value="fit">Fit</option><option value="actual">100%</option></select></label>
<label id="slider-control">Original ← <input id="split" type="range" min="0" max="100" value="50" aria-label="Comparison split"> → Compressed</label></div>
<p id="status" role="status" aria-live="polite">Review the images, then save. The original has not been changed.</p>
<main><div class="pair"><figure><figcaption><strong>Original</strong><span>${formatBytes(original.length, 'decimal', 1)}</span></figcaption><div class="canvas"><img src="${originalUrl}" alt="Original image"></div></figure>
<figure><figcaption><strong>Compressed</strong><span>${formatBytes(compressed.length, 'decimal', 1)}</span></figcaption><div class="canvas"><img src="${compressedUrl}" alt="Compressed image"></div></figure></div>
<figure class="overlay"><figcaption><strong>Original / Compressed</strong><span>${escapeHtml(savings)}</span></figcaption><div class="canvas"><img src="${originalUrl}" alt="Original image"><img id="after-overlay" src="${compressedUrl}" alt="Compressed image overlay"></div></figure></main>
<script nonce="${nonce}" src="${script}"></script></body></html>`
    let saving = false
    let finished = false
    const listener = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) { return }
      if (message.type === 'discard') { if (!saving) { panel.dispose() } return }
      if (message.type !== 'save' || saving || finished || saved <= 0) { return }
      saving = true
      try {
        const target = await this.save(uri, original, compressed)
        if (target) { finished = true }
        await panel.webview.postMessage({ type: 'saveResult', saved: !!target, text: target ? `Saved: ${target.toString(true)}` : 'Save cancelled. The original has not been changed.' })
      }
      catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        await panel.webview.postMessage({ type: 'saveResult', saved: false, text })
        void vscode.window.showErrorMessage(`Asset Size could not save the image: ${text}`)
      }
      finally { saving = false }
    })
    panel.onDidDispose(() => { listener.dispose(); this.panels.delete(panel) })
  }

  private async save(uri: vscode.Uri, original: Uint8Array, compressed: Uint8Array): Promise<vscode.Uri | undefined> {
    const config = vscode.workspace.getConfiguration('assetSize.compression')
    const behavior = config.get<SaveBehavior>('saveBehavior', 'ask')
    let mode: Exclude<SaveBehavior, 'ask'>
    let remember = false
    if (behavior === 'saveAs' || behavior === 'overwrite') { mode = behavior }
    else {
      const choice = await vscode.window.showQuickPick([
        { label: 'Save As — Allow Once', mode: 'saveAs' as const, remember: false, description: 'Choose a new file; keep the original' },
        { label: 'Save As — Always Allow', mode: 'saveAs' as const, remember: true, description: 'Remember Save As for future Save Result clicks' },
        { label: 'Overwrite Original — Allow Once', mode: 'overwrite' as const, remember: false, description: 'Replace this original after reviewing the comparison' },
        { label: 'Overwrite Original — Always Allow', mode: 'overwrite' as const, remember: true, description: 'Remember overwrite for future Save Result clicks' },
      ], { title: 'Save compressed image', placeHolder: 'Choose how to save. Always Allow remembers the action in User Settings.' })
      if (!choice) { return }
      mode = choice.mode; remember = choice.remember
    }
    let target = uri
    if (mode === 'saveAs') {
      const selected = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(uri, '..', compressedName(uri.path)),
        filters: { Images: [posix.extname(uri.path).slice(1)] },
        saveLabel: 'Save Compressed Image',
      })
      if (!selected) { return }
      if (selected.toString() === uri.toString() || (selected.scheme === 'file' && uri.scheme === 'file' && selected.fsPath.toLowerCase() === uri.fsPath.toLowerCase())) {
        throw new Error('Save As requires a different filename. Choose Overwrite Original to replace the source image.')
      }
      if (posix.extname(selected.path).toLowerCase() !== posix.extname(uri.path).toLowerCase()) {
        throw new Error('Keep the original file extension. Compression does not convert the image format.')
      }
      target = selected
      let exists = false
      try { await vscode.workspace.fs.stat(target); exists = true }
      catch (error) { if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') { throw error } }
      if (exists && await vscode.window.showWarningMessage(`Replace the existing file ${basename(target.path)}?`, { modal: true }, 'Replace') !== 'Replace') { return }
    }
    else {
      const dirty = vscode.window.tabGroups.all.flatMap(group => group.tabs).some((tab) => {
        const input = tab.input
        return tab.isDirty && (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) && input.uri.toString() === uri.toString()
      })
      if (dirty || digest(await vscode.workspace.fs.readFile(uri)) !== digest(original)) {
        throw new Error('The original image changed after compression. Run compression again before overwriting it, or use Save As.')
      }
    }
    await vscode.workspace.fs.writeFile(target, compressed)
    this.onSaved(target)
    if (remember) {
      try { await config.update('saveBehavior', mode, vscode.ConfigurationTarget.Global) }
      catch { void vscode.window.showWarningMessage('The image was saved, but the save preference could not be remembered.') }
    }
    return target
  }

  dispose(): void {
    this.disposed = true
    for (const job of this.jobs) { job.cancel() }
    for (const panel of this.panels) { panel.dispose() }
    this.jobs.clear(); this.panels.clear()
  }
}
