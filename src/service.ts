import type { FileStat, Metrics, Settings } from './core/types'
import type { Logger } from './log'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import { ResourceMatcher } from './core/matcher'
import { SizeScanner } from './core/scanner'
import { defaultFileThresholds, defaultFolderThresholds } from './core/severity'
import { silentLogger } from './log'

export class SizeService implements vscode.Disposable {
  private readonly matchers = new Map<string, ResourceMatcher>()
  private readonly scanner: SizeScanner
  private disposed = false
  private readonly changes = new vscode.EventEmitter<vscode.Uri[] | undefined>()
  readonly onDidChange = this.changes.event

  constructor(private readonly log: Logger = silentLogger) {
    this.scanner = new SizeScanner({
      stat: async key => this.read('stat', key, () => vscode.workspace.fs.stat(vscode.Uri.parse(key))),
      readDirectory: async key => this.read('readDirectory', key, () => vscode.workspace.fs.readDirectory(vscode.Uri.parse(key))),
      join: (key, name) => vscode.Uri.joinPath(vscode.Uri.parse(key), name).toString(),
    }, key => this.isExcluded(vscode.Uri.parse(key)))
  }

  private async read<T>(operation: string, key: string, action: () => PromiseLike<T>): Promise<T> {
    try { return await action() }
    catch (error) {
      this.log.warn(`Filesystem ${operation} failed: ${key}`, error)
      throw error
    }
  }

  settings(uri: vscode.Uri): Settings { return this.matcher(uri).settings }

  private matcher(uri: vscode.Uri): ResourceMatcher {
    const root = vscode.workspace.getWorkspaceFolder(uri)
    const key = root?.uri.toString() ?? uri.toString()
    let matcher = this.matchers.get(key)
    if (!matcher) {
      const config = vscode.workspace.getConfiguration('assetMeter', uri)
      matcher = new ResourceMatcher({
        enabled: config.get('enabled', true),
        displayMode: config.get('displayMode', 'always'),
        include: config.get('include', []),
        exclude: config.get('exclude', []),
        showFileCount: config.get('showFileCount', true),
        fileCountMode: config.get('fileCountMode', 'recursive'),
        units: config.get('units', 'decimal'),
        decimalPlaces: config.get('decimalPlaces', 1),
        colorize: config.get('colorize', true),
        fileColorThresholdsMiB: config.get('fileColorThresholdsMiB', defaultFileThresholds),
        folderColorThresholdsMiB: config.get('folderColorThresholdsMiB', defaultFolderThresholds),
      })
      this.matchers.set(key, matcher)
      this.log.info(`Matching configuration: ${key}`, JSON.stringify(matcher.settings))
    }
    return matcher
  }

  isExcluded(uri: vscode.Uri): boolean {
    const root = vscode.workspace.getWorkspaceFolder(uri)
    if (!root || uri.scheme !== root.uri.scheme || uri.authority !== root.uri.authority) { return true }
    const relative = posix.relative(root.uri.path, uri.path)
    if (relative === '..' || relative.startsWith('../')) { return true }
    return this.matcher(uri).isExcluded(relative)
  }

  matches(uri: vscode.Uri): boolean {
    return this.inspectMatch(uri).matched
  }

  inspectMatch(uri: vscode.Uri): { matched: boolean, reason: string, relativePath?: string, workspace?: string } {
    const root = vscode.workspace.getWorkspaceFolder(uri)
    if (!root || uri.scheme !== root.uri.scheme || uri.authority !== root.uri.authority) { return { matched: false, reason: 'outside-workspace' } }
    const relativePath = posix.relative(root.uri.path, uri.path)
    if (relativePath === '..' || relativePath.startsWith('../')) { return { matched: false, reason: 'outside-workspace' } }
    const matcher = this.matcher(uri)
    const reason = !matcher.settings.enabled
      ? 'disabled'
      : matcher.isExcluded(relativePath)
        ? 'excluded'
        : matcher.matches(relativePath) ? 'included' : 'include-not-matched-or-negated'
    return { matched: reason === 'included', reason, relativePath, workspace: root.uri.toString() }
  }

  async measure(uri: vscode.Uri): Promise<Metrics> {
    const started = Date.now()
    const metrics = await this.scanner.measure(uri.toString())
    this.log.debug(`Measured: ${uri.toString()}`, JSON.stringify({ ...metrics, durationMs: Date.now() - started }))
    return metrics
  }

  stat(uri: vscode.Uri): Promise<FileStat> {
    return this.scanner.stat(uri.toString())
  }

  async refresh(uris: readonly vscode.Uri[]): Promise<void> {
    if (this.disposed) { return }
    const included = uris.filter(uri => !this.isExcluded(uri))
    if (!included.length) { return }
    this.log.debug('Refreshing changed resources', JSON.stringify(included.map(uri => uri.toString())))
    await this.scanner.refresh(included.map(uri => uri.toString()))
    if (!this.disposed) { this.changes.fire(included) }
  }

  invalidate(uris?: readonly vscode.Uri[], configurationChanged = false): void {
    this.log.info(configurationChanged ? 'Configuration/workspace changed; reloading matching rules and sizes.' : 'Invalidating cached sizes.', JSON.stringify(uris?.map(uri => uri.toString()) ?? 'all'))
    if (configurationChanged) { this.matchers.clear() }
    if (uris) {
      for (const uri of uris) { this.scanner.invalidate(uri.toString()) }
    }
    else { this.scanner.invalidate() }
    this.changes.fire(uris ? [...uris] : undefined)
  }

  dispose(): void {
    this.disposed = true
    this.scanner.invalidate()
    this.changes.dispose()
    this.matchers.clear()
  }
}
