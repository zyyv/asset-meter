import type { Logger } from '../log'
import type { CompressionExecutor } from './executor'
import type { ImageFormat } from './image'
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { formatSize } from '../core/format'
import { imageFormat, maxInputBytes, validateImage } from './image'
import { saveCompressedCopy } from './output'
import { boundedSetting, parseQuality } from './settings'

interface BatchOptions {
  readonly pluginId: string
  readonly outputFormat?: ImageFormat
  readonly quality?: number
}

export class BatchImageCompression implements vscode.Disposable {
  private readonly batches = new Set<AbortController>()
  private readonly pending = new Set<string>()
  private disposed = false

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly executor: CompressionExecutor,
    private readonly onSaved: (uri: vscode.Uri) => void,
    private readonly log: Logger,
  ) {}

  async compress(resources: readonly vscode.Uri[] = []): Promise<void> {
    try { await this.selectAndRun(resources) }
    catch (error) {
      this.log.error('Could not start batch compression.', error)
      void vscode.window.showErrorMessage(`Asset Meter compression failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async selectAndRun(resources: readonly vscode.Uri[]): Promise<void> {
    if (this.disposed) { return }
    const selected = resources.length
      ? resources
      : await vscode.window.showOpenDialog({
          title: 'Compress / Convert Images',
          canSelectMany: true,
          filters: { Images: ['jpg', 'jpeg', 'jpe', 'png', 'webp'] },
        })
    if (!selected?.length || this.disposed) { return }
    const supported = [...new Map(selected.filter(uri => imageFormat(uri.path)).map(uri => [uri.toString(), uri])).values()]
    const unsupported = selected.length - supported.length
    if (unsupported) { this.log.info(`Batch selection: ignored ${unsupported} unsupported or duplicate resources.`) }
    if (!supported.length) {
      void vscode.window.showInformationMessage('Select JPEG, PNG or WebP images to compress.'); return
    }
    const output = await vscode.window.showQuickPick([
      { label: 'Keep original format', description: 'Compress JPEG, PNG and WebP without conversion', format: undefined },
      { label: 'JPEG', description: 'Adjustable quality · transparency becomes white', format: 'jpeg' as const },
      { label: 'PNG', description: 'Lossless · preserves transparency', format: 'png' as const },
      { label: 'WebP', description: 'Adjustable quality · preserves transparency', format: 'webp' as const },
    ], { title: `Compress ${supported.length} image(s): output format`, placeHolder: 'Results are saved as new copies beside the originals; existing files are kept.' })
    if (!output || this.disposed) { return }
    const preferred = vscode.workspace.getConfiguration('assetMeter.compression', supported[0]).get('plugin', 'jsquash')
    const formats = [...new Set(supported.map(uri => imageFormat(uri.path)!))]
    const plugins = this.executor.plugins.forFormat(formats[0]!, output.format ?? formats[0])
      .filter(plugin => formats.every(format => this.executor.plugins.forFormat(format, output.format ?? format).includes(plugin)))
      .sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred))
    const plugin = await vscode.window.showQuickPick(plugins.map(plugin => ({ label: plugin.label, detail: plugin.description, plugin })), {
      title: 'Compress images: plugin',
      placeHolder: 'Choose a plugin. Cloud plugins upload the selected images to their service. Results are saved as new copies.',
    })
    if (!plugin || this.disposed) { return }
    let quality: number | undefined
    if (plugin.plugin.quality !== 'automatic' && formats.some(format => (output.format ?? format) !== 'png')) {
      const settings = vscode.workspace.getConfiguration('assetMeter.compression', supported[0])
      const input = await vscode.window.showInputBox({
        title: 'Compression quality',
        value: String(boundedSetting(settings.get('quality', 75), 75, 100)),
        prompt: 'JPEG / WebP quality: 1–100. Higher values preserve more detail and usually produce larger files. PNG stays lossless.',
        validateInput: value => parseQuality(value) === undefined ? 'Enter a whole number from 1 to 100.' : undefined,
      })
      if (input === undefined || this.disposed) { return }
      quality = parseQuality(input)
      if (quality === undefined) { return }
    }
    // Reserve only after the pickers: another invocation may have started while they were open.
    const uris = supported.filter(uri => !this.pending.has(uri.toString()))
    const busy = supported.length - uris.length
    if (busy) { this.log.info(`Batch selection: ${busy} images are already queued or running.`) }
    if (!uris.length) {
      void vscode.window.showInformationMessage('The selected images are already queued or being compressed.'); return
    }
    for (const uri of uris) { this.pending.add(uri.toString()) }
    try { await this.run(uris, { pluginId: plugin.plugin.id, outputFormat: output.format, quality }) }
    finally { for (const uri of uris) { this.pending.delete(uri.toString()) } }
  }

  private async compressOne(uri: vscode.Uri, options: BatchOptions, signal: AbortSignal, prefix: string) {
    return this.executor.pool.run(async (signal) => {
      const start = Date.now()
      const format = imageFormat(uri.path)!
      const targetFormat = options.outputFormat ?? format
      this.log.info(`${prefix} Encoding ${uri.toString()} → ${targetFormat.toUpperCase()}.`)
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.size > maxInputBytes) { throw new Error('Choose an image smaller than 50 MiB.') }
      signal.throwIfAborted()
      const original = await vscode.workspace.fs.readFile(uri)
      signal.throwIfAborted()
      validateImage(original, format)
      const settings = vscode.workspace.getConfiguration('assetMeter.compression', uri)
      const quality = options.quality ?? boundedSetting(settings.get('quality', 75), 75, 100)
      const result = await this.executor.encode(options.pluginId, { bytes: original, format, outputFormat: targetFormat, quality }, {
        distDirectory: vscode.Uri.joinPath(this.context.extensionUri, 'dist').fsPath,
        getSetting: (key, fallback) => settings.get(key, fallback),
      }, signal)
      if (targetFormat === format && result.length >= original.length) {
        this.log.info(`${prefix} Skipped ${uri.toString()}: no size reduction.`)
        return { status: 'skipped', savedBytes: 0 } as const
      }
      const target = await saveCompressedCopy(uri, result, targetFormat, signal, this.log)
      this.onSaved(target)
      this.log.info(`${prefix} Saved ${target.toString()}: ${original.length} → ${result.length} bytes, ${Date.now() - start} ms.`)
      return { status: 'saved', savedBytes: original.length - result.length } as const
    }, signal)
  }

  private async run(uris: readonly vscode.Uri[], options: BatchOptions): Promise<void> {
    const controller = new AbortController()
    this.batches.add(controller)
    const id = randomUUID().slice(0, 8)
    const prefix = `[Compression ${id}]`
    const config = vscode.workspace.getConfiguration('assetMeter.compression')
    const batchSize = boundedSetting(config.get('batchSize', 50), 50, 200)
    const batches = Math.ceil(uris.length / batchSize)
    const started = Date.now()
    let saved = 0; let skipped = 0; let failed = 0; let completed = 0; let savedBytes = 0
    this.log.info(`${prefix} Started: ${uris.length} images, ${options.pluginId}, output=${options.outputFormat ?? 'original'}, quality=${options.quality ?? 'automatic / lossless'}, concurrency=${this.executor.pool.concurrency}, batchSize=${batchSize}.`)
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Asset Meter: compressing ${uris.length} images`, cancellable: true }, async (progress, token) => {
        const cancellation = token.onCancellationRequested(() => controller.abort())
        if (token.isCancellationRequested) { controller.abort() }
        const message = () => `${completed}/${uris.length} · ${saved} saved · ${skipped} skipped · ${failed} failed`
        progress.report({ increment: 0, message: message() })
        try {
          for (let offset = 0; offset < uris.length && !controller.signal.aborted; offset += batchSize) {
            const batch = Math.floor(offset / batchSize) + 1
            this.log.info(`${prefix} Batch ${batch}/${batches}: ${Math.min(batchSize, uris.length - offset)} images.`)
            await Promise.all(uris.slice(offset, offset + batchSize).map(async (uri) => {
              try {
                const result = await this.compressOne(uri, options, controller.signal, prefix)
                if (result.status === 'saved') { saved++; savedBytes += result.savedBytes }
                else { skipped++ }
              }
              catch (error) {
                if (controller.signal.aborted || this.disposed) { return }
                failed++
                this.log.error(`${prefix} Failed ${uri.toString()}: ${error instanceof Error ? error.message : String(error)}`)
              }
              if (!controller.signal.aborted) {
                completed++
                progress.report({ increment: 100 / uris.length, message: message() })
              }
            }))
          }
        }
        finally { cancellation.dispose() }
      })
      const cancelled = controller.signal.aborted
      const summary = `${cancelled ? 'Cancelled' : 'Finished'}: ${saved} saved, ${skipped} skipped, ${failed} failed, ${uris.length - saved - skipped - failed} remaining. ${savedBytes >= 0 ? 'Reduced by' : 'Increased by'} ${formatSize(Math.abs(savedBytes), 'decimal', 1)}.`
      this.log.info(`${prefix} ${summary} Elapsed ${Date.now() - started} ms.`)
      if (!this.disposed) {
        const notify = failed ? vscode.window.showWarningMessage : vscode.window.showInformationMessage
        void notify(`Asset Meter: ${summary}`, 'Show Logs').then((choice) => {
          if (choice === 'Show Logs') { void vscode.commands.executeCommand('assetMeter.showOutput') }
        })
      }
    }
    finally { this.batches.delete(controller) }
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.batches) { controller.abort() }
  }
}
