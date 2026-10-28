import type { SizeService } from '../service'
import type { MetadataService } from './service'
import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import { imageDetailsMarkdown } from './markdown'
import { isPreviewImage } from './types'

export const detailsScheme = 'asset-meter-details'

// Native Markdown resolves relative images through its document's filesystem.
// Serve only images explicitly requested by this preview, without embedding
// large base64 payloads or writing temporary copies of the source image.
class PreviewImages implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly allowed = new Map<string, vscode.Uri>()
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  readonly onDidChangeFile = this.changes.event

  constructor(private readonly markdown: (uri: vscode.Uri) => Promise<string>) {}

  reference(source: vscode.Uri): vscode.Uri {
    const id = this.id(source)
    this.allowed.set(id, source)
    return vscode.Uri.from({ scheme: detailsScheme, path: `/${id}/image/${posix.basename(source.path)}`, query: '' })
  }

  document(source: vscode.Uri): vscode.Uri {
    this.reference(source)
    return vscode.Uri.from({ scheme: detailsScheme, path: `/${this.id(source)}/${posix.basename(source.path)}.md`, query: '' })
  }

  private id(source: vscode.Uri): string { return Buffer.from(source.toString()).toString('base64url') }
  private isImage(uri: vscode.Uri): boolean { return uri.path.split('/')[2] === 'image' }

  source(uri: vscode.Uri): vscode.Uri {
    const id = uri.path.split('/')[1] ?? ''
    const source = this.isImage(uri) ? this.allowed.get(id) : vscode.Uri.parse(Buffer.from(id, 'base64url').toString())
    if (!source || !(this.isImage(uri) || uri.path.endsWith('.md')) || !isPreviewImage(source.path) || source.scheme === detailsScheme) {
      throw vscode.FileSystemError.NoPermissions(uri)
    }
    // Restored Markdown tabs can recover their source without a persisted cache.
    if (!this.isImage(uri)) { this.allowed.set(id, source) }
    return source
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const stat = await vscode.workspace.fs.stat(this.source(uri))
    return this.isImage(uri) ? stat : { ...stat, size: (await this.readFile(uri)).byteLength }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const source = this.source(uri)
    return this.isImage(uri) ? vscode.workspace.fs.readFile(source) : new TextEncoder().encode(await this.markdown(uri))
  }

  change(uri: vscode.Uri): void { this.changes.fire([{ type: vscode.FileChangeType.Changed, uri }]) }
  watch(): vscode.Disposable { return new vscode.Disposable(() => {}) }
  readDirectory(): [string, vscode.FileType][] { throw vscode.FileSystemError.NoPermissions() }
  createDirectory(): void { throw vscode.FileSystemError.NoPermissions() }
  writeFile(): void { throw vscode.FileSystemError.NoPermissions() }
  delete(): void { throw vscode.FileSystemError.NoPermissions() }
  rename(): void { throw vscode.FileSystemError.NoPermissions() }
  dispose(): void { this.allowed.clear(); this.changes.dispose() }
}

export class ImageDetailsPreview implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[]
  private readonly images = new PreviewImages(uri => this.provideTextDocumentContent(uri))

  constructor(private readonly service: SizeService, private readonly metadata: MetadataService) {
    const refresh = (uris?: readonly vscode.Uri[]) => {
      for (const document of vscode.workspace.textDocuments) {
        if (document.uri.scheme !== detailsScheme) { continue }
        const source = this.source(document.uri)
        if (!uris || uris.some(uri => uri.scheme === source.scheme && uri.authority === source.authority
          && (source.path === uri.path || source.path.startsWith(`${uri.path.replace(/\/$/, '')}/`)))) {
          this.images.change(document.uri)
        }
      }
    }
    this.subscriptions = [
      vscode.workspace.registerFileSystemProvider(detailsScheme, this.images, { isReadonly: true }),
      this.images,
      service.onDidChange(refresh),
      metadata.onDidChange(uri => refresh([uri])),
    ]
  }

  private source(uri: vscode.Uri): vscode.Uri { return this.images.source(uri) }

  uriFor(source: vscode.Uri): vscode.Uri { return this.images.document(source) }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const source = this.source(uri)
    try {
      const [metrics, metadata] = await Promise.all([this.service.measure(source), this.metadata.get(source)])
      const image = this.images.reference(source).toString().replace(`${detailsScheme}:`, '')
      return imageDetailsMarkdown(source, metrics, this.service.settings(source), metadata, false, image).value
    }
    catch {
      return new vscode.MarkdownString().appendMarkdown('### Image unavailable\n\n').appendText(`The file may have been moved, deleted or become unreadable: ${source.path}`).value
    }
  }

  async open(resource?: vscode.Uri): Promise<void> {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    const uri = resource ?? (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined)
      ?? (await vscode.window.showOpenDialog({ title: 'Asset Meter: Select an image', canSelectMany: false, filters: { Images: ['jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'iiq'] } }))?.[0]
    if (!uri) { return }
    if (!isPreviewImage(uri.path)) { void vscode.window.showWarningMessage('Select an image to preview its details.'); return }
    const preview = this.uriFor(uri)
    await vscode.commands.executeCommand('markdown.showPreviewToSide', preview)
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose() }
  }
}
