import type { Logger } from '../log'
import type { SizeService } from '../service'
import type { AssetMetadata, MetadataReader } from './types'
import * as vscode from 'vscode'
import { Limiter } from '../core/limiter'
import { isSameOrChild } from '../core/uri'
import { silentLogger } from '../log'
import { supportsMetadata } from './formats'
import { metadataLimits } from './limits'
import { MetadataWorker } from './runner'

interface CacheEntry {
  uri: vscode.Uri
  result?: AssetMetadata
  promise: Promise<AssetMetadata | undefined>
}

function remoteLimitError(): AssetMetadata {
  return { status: 'error', groups: [], message: `Metadata preview is limited to ${metadataLimits.remoteBytes / 1024 ** 2} MiB for remote and virtual files.` }
}

export class MetadataService implements vscode.Disposable {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly limiter = new Limiter(1)
  private readonly changes = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.changes.event
  private readonly subscription: vscode.Disposable
  private readonly reader: MetadataReader
  private disposed = false

  constructor(service: SizeService, distDirectory: string, private readonly log: Logger = silentLogger, reader?: MetadataReader) {
    this.reader = reader ?? new MetadataWorker(distDirectory)
    this.subscription = service.onDidChange(uris => this.invalidate(uris))
  }

  peek(uri: vscode.Uri): AssetMetadata | undefined { return this.cache.get(uri.toString())?.result }

  get(uri: vscode.Uri): Promise<AssetMetadata | undefined> {
    if (this.disposed) { return Promise.resolve(undefined) }
    if (!supportsMetadata(uri.path)) { return Promise.resolve({ status: 'unsupported', groups: [] }) }
    const key = uri.toString()
    const existing = this.cache.get(key)
    if (existing) {
      this.cache.delete(key); this.cache.set(key, existing)
      return existing.promise
    }
    const entry: CacheEntry = { uri, promise: Promise.resolve(undefined) }
    this.cache.set(key, entry)
    // LRU, including negative/error results. Evicted pending jobs check their
    // identity before touching the filesystem or publishing stale results.
    while (this.cache.size > metadataLimits.cacheEntries) { this.cache.delete(this.cache.keys().next().value!) }
    entry.promise = this.limiter.run(async () => {
      if (this.disposed || this.cache.get(key) !== entry) { return undefined }
      let result: AssetMetadata
      try {
        const stat = await vscode.workspace.fs.stat(uri)
        if ((stat.type & (vscode.FileType.Directory | vscode.FileType.SymbolicLink)) !== 0) { return undefined }
        if (this.disposed || this.cache.get(key) !== entry) { return undefined }
        if (uri.scheme === 'file') { result = await this.reader.parse(uri.fsPath) }
        else if (stat.size > metadataLimits.remoteBytes) {
          result = remoteLimitError()
        }
        else {
          const bytes = await vscode.workspace.fs.readFile(uri)
          if (this.disposed || this.cache.get(key) !== entry) { return undefined }
          result = bytes.byteLength > metadataLimits.remoteBytes
            ? remoteLimitError()
            : await this.reader.parse(bytes)
        }
      }
      catch (error) {
        this.log.debug(`Metadata unavailable: ${key}`, error)
        result = { status: 'error', groups: [], message: error instanceof Error ? error.message : String(error) }
      }
      if (this.disposed || this.cache.get(key) !== entry) { return undefined }
      entry.result = result
      this.changes.fire(uri)
      return result
    })
    return entry.promise
  }

  invalidate(uris?: readonly vscode.Uri[]): void {
    if (!uris) { this.cache.clear(); return }
    for (const [key, entry] of this.cache) {
      if (uris.some(uri => isSameOrChild(entry.uri, uri))) {
        this.cache.delete(key)
      }
    }
  }

  dispose(): void {
    if (this.disposed) { return }
    this.disposed = true
    this.subscription.dispose()
    this.cache.clear()
    this.reader.dispose()
    this.changes.dispose()
  }
}
