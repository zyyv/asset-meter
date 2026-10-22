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

interface Entry { valid: boolean, settled: boolean, result: Promise<Metrics> }

export class SizeScanner {
  private readonly cache = new Map<string, Entry>()
  private readonly limiter = new Limiter(16)

  constructor(private readonly fs: FileSystem, private readonly isExcluded: (key: string) => boolean, private readonly maxEntries = 10_000) {}

  stat(key: string): Promise<FileStat> {
    return this.limiter.run(() => this.fs.stat(key))
  }

  measure(key: string): Promise<Metrics> {
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached.result
    }
    const entry: Entry = { valid: true, settled: false, result: Promise.resolve(emptyMetrics()) }
    entry.result = this.scan(key, entry).then((result) => {
      entry.settled = true
      this.trimCache()
      return result
    }, (error: unknown) => {
      if (this.cache.get(key) === entry) { this.cache.delete(key) }
      throw error
    })
    this.cache.set(key, entry)
    this.trimCache()
    return entry.result
  }

  private trimCache(): void {
    if (this.cache.size <= this.maxEntries) { return }
    for (const [key, entry] of this.cache) {
      // Keep active scans addressable so invalidation can still cancel them.
      if (entry.settled) { this.cache.delete(key) }
      if (this.cache.size <= this.maxEntries) { break }
    }
  }

  invalidate(changed?: string): void {
    for (const [key, entry] of this.cache) {
      if (!changed || related(key, changed)) {
        entry.valid = false
        this.cache.delete(key)
      }
    }
  }

  private async scan(key: string, entry: Entry): Promise<Metrics> {
    const check = () => { if (!entry.valid) { throw new ScanCancelled() } }
    const stat = await this.limiter.run(async () => { check(); return this.fs.stat(key) })
    check()
    if ((stat.type & FileKind.SymbolicLink) !== 0) { return { ...emptyMetrics(), skipped: 1 } }
    if ((stat.type & FileKind.Directory) === 0) { return { ...emptyMetrics(), bytes: stat.size, files: 1, directFiles: 1 } }
    const total = emptyMetrics(true)
    // Iterative traversal keeps deep trees safe. Each scan uses at most one
    // directory batch of stat promises, sharing a global I/O concurrency limit.
    const pending = [{ key, root: true }]
    while (pending.length) {
      check()
      const directory = pending.pop()!
      let children: [string, number][]
      try {
        children = await this.limiter.run(async () => { check(); return this.fs.readDirectory(directory.key) })
      }
      catch (error) {
        if (error instanceof ScanCancelled) { throw error }
        total.errors++
        continue
      }
      for (let offset = 0; offset < children.length; offset += 64) {
        check()
        await Promise.all(children.slice(offset, offset + 64).map(async ([name, type]) => {
          const child = this.fs.join(directory.key, name)
          if (this.isExcluded(child)) { return }
          if ((type & FileKind.SymbolicLink) !== 0) { total.skipped++; return }
          if ((type & FileKind.Directory) !== 0) {
            total.directories++
            pending.push({ key: child, root: false })
            return
          }
          try {
            const childStat = await this.limiter.run(async () => { check(); return this.fs.stat(child) })
            if ((childStat.type & FileKind.SymbolicLink) !== 0) { total.skipped++; return }
            if ((childStat.type & FileKind.Directory) !== 0) {
              total.directories++
              pending.push({ key: child, root: false })
              return
            }
            total.bytes += childStat.size
            total.files++
            if (directory.root) { total.directFiles++ }
          }
          catch (error) {
            if (error instanceof ScanCancelled) { throw error }
            total.errors++
          }
        }))
      }
    }
    check()
    return total
  }
}

function emptyMetrics(isDirectory = false): Metrics {
  return { bytes: 0, files: 0, directFiles: 0, directories: 0, skipped: 0, errors: 0, isDirectory }
}

function related(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right.replace(/\/$/, '')}/`) || right.startsWith(`${left.replace(/\/$/, '')}/`)
}
