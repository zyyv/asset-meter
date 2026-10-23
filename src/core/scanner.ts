import type { FileStat, FileSystem, Metrics } from './types'
import { FileKind } from './types'

export class ScanCancelled extends Error {
  constructor() { super('Size scan invalidated') }
}

class Limiter {
  private active = 0
  private readonly waiting: (() => void)[] = []
  constructor(private readonly limit: number) {}
  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) { await new Promise<void>(resolve => this.waiting.push(resolve)) }
    else { this.active++ }
    try { return await action() }
    finally {
      const next = this.waiting.shift()
      if (next) { next() }
      else { this.active-- }
    }
  }
}

interface Entry {
  valid: boolean
  pending: number
  stat?: Promise<FileStat>
  result?: Promise<Metrics>
  children?: Map<string, Metrics>
  dirty?: Set<string>
}

export class SizeScanner {
  private readonly cache = new Map<string, Entry>()
  private readonly limiter = new Limiter(16)

  constructor(private readonly fs: FileSystem, private readonly isExcluded: (key: string) => boolean, private readonly maxEntries = 10_000) {}

  stat(key: string): Promise<FileStat> {
    return this.readStat(key, this.entry(key))
  }

  measure(key: string): Promise<Metrics> {
    const entry = this.entry(key)
    if (!entry.result) {
      entry.pending++
      entry.result = this.scan(key, entry).then((result) => {
        this.check(entry)
        // Ancestors finish after their children and are usually the displayed
        // resources. Keep that newly completed aggregate recent in the LRU.
        if (this.cache.get(key) === entry) { this.cache.delete(key); this.cache.set(key, entry) }
        return result
      }).catch((error: unknown) => {
        if (this.cache.get(key) === entry) { this.cache.delete(key) }
        throw error
      }).finally(() => {
        entry.pending--
        this.trimCache()
      })
      this.trimCache()
    }
    return entry.result
  }

  private entry(key: string): Entry {
    const entry = this.cache.get(key) ?? { valid: true, pending: 0 }
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry
  }

  private readStat(key: string, entry: Entry): Promise<FileStat> {
    if (!entry.stat) {
      entry.pending++
      entry.stat = this.limiter.run(async () => {
        this.check(entry)
        return this.fs.stat(key)
      }).then((stat) => {
        this.check(entry)
        return stat
      }).catch((error: unknown) => {
        if (this.cache.get(key) === entry) { this.cache.delete(key) }
        throw error
      }).finally(() => {
        entry.pending--
        this.trimCache()
      })
      this.trimCache()
    }
    return entry.stat
  }

  private check(entry: Entry): void {
    if (!entry.valid) { throw new ScanCancelled() }
  }

  private trimCache(): void {
    if (this.cache.size <= this.maxEntries) { return }
    for (const [key, entry] of this.cache) {
      // Keep active scans addressable so invalidation can still cancel them.
      if (!entry.pending) { this.cache.delete(key) }
      if (this.cache.size <= this.maxEntries) { break }
    }
  }

  invalidate(changed?: string): void {
    for (const [key, entry] of this.cache) {
      if (!changed || within(key, changed)) {
        entry.valid = false
        this.cache.delete(key)
      }
      else if (within(changed, key)) {
        entry.valid = false
        if (entry.children) {
          // Keep each unchanged child's contribution, even if its own LRU entry
          // was evicted. Only the branch containing the event needs another read.
          const prefix = childPrefix(key)
          const branch = changed.slice(prefix.length).split('/')[0]!
          this.cache.set(key, {
            valid: true,
            pending: 0,
            stat: entry.stat,
            children: entry.children,
            dirty: new Set([...entry.dirty ?? [], `${prefix}${branch}`]),
          })
        }
        else { this.cache.delete(key) }
      }
    }
  }

  async refresh(changed: readonly string[]): Promise<void> {
    const paths = roots(changed.filter(key => !this.isExcluded(key)))
    const targets = roots([...this.cache].filter(([key, entry]) =>
      (entry.result || entry.children) && paths.some(path => within(path, key)),
    ).map(([key]) => key))
    for (const path of paths) { this.invalidate(path) }
    // Deleted roots and unreadable providers must not prevent other cached
    // resources from refreshing. Rejected reads remove their own cache entries.
    await Promise.allSettled(targets.map(key => this.measure(key)))
  }

  private async scan(key: string, entry: Entry): Promise<Metrics> {
    const stat = await this.readStat(key, entry)
    this.check(entry)
    if ((stat.type & FileKind.SymbolicLink) !== 0) { return { ...emptyMetrics(), skipped: 1 } }
    if ((stat.type & FileKind.Directory) === 0) { return { ...emptyMetrics(), bytes: stat.size, files: 1, directFiles: 1 } }

    const children = new Map(entry.children)
    let pending: [string, number | undefined][]
    if (entry.children && entry.dirty) {
      pending = [...entry.dirty].map(child => [child, undefined])
    }
    else {
      try {
        const listing = await this.limiter.run(async () => { this.check(entry); return this.fs.readDirectory(key) })
        pending = listing.map(([name, type]) => [this.fs.join(key, name), type])
      }
      catch (error) {
        if (error instanceof ScanCancelled) { throw error }
        return { ...emptyMetrics(true), errors: 1 }
      }
    }
    for (let offset = 0; offset < pending.length; offset += 64) {
      this.check(entry)
      await Promise.all(pending.slice(offset, offset + 64).map(async ([child, type]) => {
        if (this.isExcluded(child)) { children.delete(child); return }
        if (type !== undefined && (type & FileKind.SymbolicLink) !== 0) {
          children.set(child, { ...emptyMetrics(), skipped: 1 })
          return
        }
        try {
          children.set(child, await this.measure(child))
        }
        catch (error) {
          if (error instanceof ScanCancelled) { throw error }
          if (isMissing(error)) { children.delete(child) }
          else {
            const isDirectory = type === undefined ? children.get(child)?.isDirectory : (type & FileKind.Directory) !== 0
            children.set(child, { ...emptyMetrics(isDirectory), errors: 1 })
          }
        }
      }))
    }
    this.check(entry)
    entry.children = children
    entry.dirty = undefined
    const total = emptyMetrics(true)
    for (const child of children.values()) {
      total.bytes += child.bytes
      total.files += child.files
      total.directFiles += child.isDirectory ? 0 : child.files
      total.directories += child.directories + Number(child.isDirectory)
      total.skipped += child.skipped
      total.errors += child.errors
    }
    return total
  }
}

function emptyMetrics(isDirectory = false): Metrics {
  return { bytes: 0, files: 0, directFiles: 0, directories: 0, skipped: 0, errors: 0, isDirectory }
}

function childPrefix(key: string): string { return `${key.replace(/\/$/, '')}/` }

function within(key: string, parent: string): boolean { return key === parent || key.startsWith(childPrefix(parent)) }

function roots(keys: readonly string[]): string[] {
  const sorted = [...new Set(keys)].sort((left, right) => {
    const a = childPrefix(left)
    const b = childPrefix(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
  const result: string[] = []
  for (const key of sorted) {
    if (!result.length || !within(key, result[result.length - 1]!)) { result.push(key) }
  }
  return result
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && ['ENOENT', 'FileNotFound', 'EntryNotFound'].includes(String(error.code))
}
