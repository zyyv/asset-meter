import type { SizeService } from './service'
import * as vscode from 'vscode'
import { describeMetrics, inlineLabel, nativeLabelMarker, nativeToneMarker } from './core/format'
import { sizeSeverity } from './core/severity'

export class SizeDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<vscode.Uri[] | undefined>()
  readonly onDidChangeFileDecorations = this.changes.event
  private readonly subscription: vscode.Disposable

  constructor(private readonly service: SizeService, private readonly nativePatchActive = false) {
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
    if (token.isCancellationRequested || !this.service.mayMatch(uri)) { return undefined }
    try {
      const stat = await this.service.stat(uri)
      if ((stat.type & vscode.FileType.SymbolicLink) !== 0) { return undefined }
      const isDirectory = (stat.type & vscode.FileType.Directory) !== 0
      if (!this.service.matches(uri, isDirectory)) { return undefined }
      const metrics = await this.service.measure(uri)
      if (token.isCancellationRequested) { return undefined }
      const settings = this.service.settings(uri)
      const severity = settings.colorize ? sizeSeverity(metrics.bytes, isDirectory, settings) : 'normal'
      // Keep severity metadata invisible even if an older renderer shows the
      // complete badge instead of decoding it. Never prefix counts with digits.
      const tone = nativeToneMarker.repeat({ normal: 1, warning: 2, large: 3, critical: 4 }[severity])
      const badge = this.nativePatchActive && settings.displayMode === 'always'
        ? `${nativeLabelMarker}${tone}${inlineLabel(metrics, settings)}${nativeLabelMarker}`
        : undefined
      const tooltip = `Assets Size\n${describeMetrics(metrics, settings)}`
      // FileDecoration.color also colors filenames. The native renderer reads
      // the tone from our payload and applies it to the size suffix only.
      return { badge, tooltip, propagate: false }
    }
    catch {
      // Deleted files, revoked providers and cancelled scans must not disrupt Explorer.
      return undefined
    }
  }

  dispose(): void { this.subscription.dispose(); this.changes.dispose() }
}
