import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import * as vscode from 'vscode'

export function canCopyImage(path: string): boolean {
  return /\.(?:jpe?g|jpe|png|gif|webp|avif|svg|ico|bmp)$/i.test(path)
}

export class ImageClipboard implements vscode.Disposable {
  private readonly pending = new Set<() => void>()
  private disposed = false

  async copy(uri: vscode.Uri): Promise<void> {
    if (this.disposed) { throw new Error('Image clipboard has been disposed.') }
    if (!canCopyImage(uri.path)) {
      throw new Error('Image copy requires a JPEG, PNG, GIF, WebP, AVIF, SVG, ICO or BMP file. Choose Copy Relative Path or Copy Absolute Path to copy other files.')
    }
    const panel = vscode.window.createWebviewPanel('assetMeter.copyImage', `Copy image: ${posix.basename(uri.path)}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(uri, '..')],
    })
    // The public clipboard API only writes text. Use the local UI's clipboard
    // from a focused webview, including for remote and virtual workspace files.
    await new Promise<void>((resolve, reject) => {
      let finished = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let cancel: () => void
      const subscriptions: vscode.Disposable[] = []
      const finish = (error?: Error) => {
        if (finished) { return }
        finished = true
        clearTimeout(timer)
        this.pending.delete(cancel)
        for (const subscription of subscriptions) { subscription.dispose() }
        panel.dispose()
        if (error) { reject(error) }
        else { resolve() }
      }
      cancel = () => finish(new Error('Image copy cancelled.'))
      timer = setTimeout(() => finish(new Error('Image copy timed out. Try Copy Image again from the context menu.')), 30_000)
      this.pending.add(cancel)
      subscriptions.push(
        panel.onDidDispose(cancel),
        panel.webview.onDidReceiveMessage((message: unknown) => {
          if (!message || typeof message !== 'object' || !('type' in message)) { return }
          if (message.type === 'copied') { finish() }
          else if (message.type === 'copyError' && 'error' in message && typeof message.error === 'string') { finish(new Error(message.error)) }
        }),
      )
      const nonce = randomBytes(16).toString('hex')
      const source = JSON.stringify(panel.webview.asWebviewUri(uri).toString()).replaceAll('<', '\\u003c')
      panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data: blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">body { padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); } img { max-width: 100%; max-height: 60vh; object-fit: contain; }</style>
</head><body><p>Copying image…</p><img id="image" alt="Image to copy">
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
async function copyImage() {
  try {
    const image = document.getElementById('image');
    image.src = ${source};
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) {
      throw new Error('Images must contain at most 40 million pixels.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) { throw new Error('Could not prepare the image for copying.'); }
    context.drawImage(image, 0, 0);
    const png = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the image.')), 'image/png'));
    for (let attempt = 0; !document.hasFocus() && attempt < 100; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    vscode.postMessage({ type: 'copied' });
  } catch (error) {
    vscode.postMessage({ type: 'copyError', error: error instanceof Error ? error.message : String(error) });
  }
}
copyImage();
</script></body></html>`
    })
  }

  dispose(): void {
    this.disposed = true
    for (const cancel of this.pending) { cancel() }
  }
}
