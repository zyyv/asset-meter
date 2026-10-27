import type { Logger } from './log'
import type { SizeService } from './service'
import * as vscode from 'vscode'
import { compactSizeBadge, describeMetrics, inlineLabel, nativeHoverMarker, nativeLabelMarker, nativeToneMarker } from './core/format'
import { ScanCancelled } from './core/scanner'
import { sizeSeverity } from './core/severity'
import { silentLogger } from './log'

export class SizeDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<vscode.Uri[] | undefined>()
  readonly onDidChangeFileDecorations = this.changes.event
  private readonly subscription: vscode.Disposable

  constructor(private readonly service: SizeService, private readonly nativePatchActive = false, private readonly log: Logger = silentLogger) {
    // A file update also changes every decorated ancestor's aggregate.
    this.subscription = service.onDidChange((uris) => {
      if (!uris) { this.changes.fire(undefined); return }
      const affected = new Map<string, vscode.Uri>()
      for (const uri of uris) {
        const root = vscode.workspace.getWorkspaceFolder(uri)
        if (!root) { continue }
        let current = uri
        while (true) {
          affected.set(current.toString(), current)
          if (current.toString() === root.uri.toString()) { break }
          const parent = vscode.Uri.joinPath(current, '..')
          if (parent.path === current.path) { break }
          current = parent
        }
      }
      this.changes.fire([...affected.values()])
    })
  }

  async provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): Promise<vscode.FileDecoration | undefined> {
    if (token.isCancellationRequested) { return undefined }
    try {
      const match = this.service.inspectMatch(uri)
      this.log.debug(`Decoration match: ${uri.toString()}`, JSON.stringify(match))
      if (!match.matched) { return undefined }
      const stat = await this.service.stat(uri)
      if ((stat.type & vscode.FileType.SymbolicLink) !== 0) { this.log.debug(`Decoration skipped (symbolic-link): ${uri.toString()}`); return undefined }
      const isDirectory = (stat.type & vscode.FileType.Directory) !== 0
      const metrics = await this.service.measure(uri)
      if (token.isCancellationRequested) { return undefined }
      const settings = this.service.settings(uri)
      const severity = settings.colorize ? sizeSeverity(metrics.bytes, isDirectory, settings) : 'normal'
      // Keep severity metadata invisible even if an older renderer shows the
      // complete badge instead of decoding it. Never prefix counts with digits.
      const tone = nativeToneMarker.repeat({ normal: 1, warning: 2, large: 3, critical: 4 }[severity])
      const mode = settings.displayMode === 'hover' ? nativeHoverMarker : ''
      const badge = this.nativePatchActive
        ? `${nativeLabelMarker}${tone}${mode}${inlineLabel(metrics, settings)}${nativeLabelMarker}`
        : settings.displayMode === 'always' ? compactSizeBadge(metrics.bytes, settings.units) : undefined
      const tooltip = `Asset Meter\n${describeMetrics(metrics, settings)}${this.nativePatchActive ? '' : '\nFull inline sizes: run Asset Meter: Install / Reapply Native Explorer Patch.'}`
      this.log.debug(`Decoration ready: ${uri.toString()}`, JSON.stringify({ badge, nativePatchActive: this.nativePatchActive, displayMode: settings.displayMode }))
      // FileDecoration.color also colors filenames. The native renderer reads
      // the tone from our payload and applies it to the size suffix only.
      return { badge, tooltip, propagate: false }
    }
    catch (error) {
      if (error instanceof ScanCancelled) { this.log.debug(`Decoration scan invalidated: ${uri.toString()}`) }
      else { this.log.error(`Decoration failed: ${uri.toString()}`, error) }
      // Deleted files, revoked providers and cancelled scans must not disrupt Explorer.
      return undefined
    }
  }

  dispose(): void { this.subscription.dispose(); this.changes.dispose() }
}
