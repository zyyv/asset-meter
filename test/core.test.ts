import type { FileStat, FileSystem, Settings } from '../src/core/types'
import assert from 'node:assert/strict'
import { posix } from 'node:path'
import { it } from 'vitest'
import { describeMetrics, fileCount, formatSize, inlineLabel } from '../src/core/format'
import { ResourceMatcher } from '../src/core/matcher'
import { ScanCancelled, SizeScanner } from '../src/core/scanner'
import { sizeSeverity } from '../src/core/severity'
import { FileKind } from '../src/core/types'

const defaults: Settings = {
  enabled: true,
  displayMode: 'always',
  include: ['**/*.{png,jpg,tar.gz}', '**/{assets,public}'],
  exclude: ['**/node_modules/**', '**/.git/**', '**/*.tmp'],
  showFileCount: true,
  fileCountMode: 'recursive',
  units: 'binary',
  decimalPlaces: 1,
  colorize: true,
  fileColorThresholdsMiB: [0.25, 1, 5],
  folderColorThresholdsMiB: [10, 50, 100],
}

class MemoryFs implements FileSystem {
  readonly entries = new Map<string, FileStat>()
  readonly failures = new Set<string>()
  readonly calls = new Map<string, number>()
  readonly directoryCalls = new Map<string, number>()
  active = 0
  maxActive = 0
  beforeStat?: (key: string) => Promise<void>
  constructor() { this.directory('/') }
  directory(key: string): this { this.entries.set(key, { type: FileKind.Directory, size: 0 }); return this }
  file(key: string, size: number): this { this.entries.set(key, { type: FileKind.File, size }); return this }
  link(key: string): this { this.entries.set(key, { type: FileKind.Directory | FileKind.SymbolicLink, size: 0 }); return this }
  async stat(key: string): Promise<FileStat> {
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1)
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      await this.beforeStat?.(key)
      if (this.failures.has(key)) { throw new Error('Permission denied') }
      const entry = this.entries.get(key)
      if (!entry) { throw Object.assign(new Error('Not found'), { code: 'ENOENT' }) }
      return { ...entry }
    }
    finally { this.active-- }
  }

  async readDirectory(key: string): Promise<[string, number][]> {
    this.directoryCalls.set(key, (this.directoryCalls.get(key) ?? 0) + 1)
    if (this.failures.has(key)) { throw new Error('Permission denied') }
    return [...this.entries].filter(([path]) => path !== key && posix.dirname(path) === key).map(([path, stat]) => [posix.basename(path), stat.type])
  }

  join(key: string, name: string): string { return posix.join(key, name) }
}

function scanner(fs: MemoryFs): SizeScanner {
  const matcher = new ResourceMatcher(defaults)
  return new SizeScanner(fs, key => matcher.isExcluded(key.slice(1)))
}

it('include globs match files and folders relative to the workspace', () => {
  const matcher = new ResourceMatcher(defaults)
  for (const path of ['LOGO.PNG', 'archive.tar.gz', 'ASSETS', 'src/logo.jpg']) {
    assert.equal(matcher.matches(path), true, path)
  }
  for (const path of ['readme.md', 'src', 'LICENSE']) {
    assert.equal(matcher.matches(path), false, path)
  }
  assert.equal(new ResourceMatcher({ ...defaults, include: ['**/*'] }).matches('LICENSE'), true)
  assert.equal(new ResourceMatcher({ ...defaults, include: [] }).matches('LOGO.PNG'), false)
  assert.equal(new ResourceMatcher({ ...defaults, enabled: false }).matches('LOGO.PNG'), false)
})

it('include and exclude globs support nested paths, dotfiles, braces and negated includes', () => {
  const matcher = new ResourceMatcher({
    ...defaults,
    include: ['src/assets/*.{png,svg}', '!**/draft.*'],
    exclude: ['**/*.svg'],
  })
  assert.equal(matcher.matches('src/assets/logo.png'), true)
  assert.equal(matcher.matches('src\\assets\\.hidden.png'), true)
  assert.equal(matcher.matches('src/assets/icon.svg'), false)
  assert.equal(matcher.matches('src/assets/draft.png'), false)
  assert.equal(matcher.matches('other/logo.png'), false)
  const uppercase = new ResourceMatcher({ ...defaults, include: ['SRC/ASSETS/*.{PNG,SVG}'] })
  assert.equal(uppercase.matches('src/assets/logo.png'), true)
  assert.equal(uppercase.matches('../src/assets/logo.png'), false)
  assert.equal(uppercase.matches('/src/assets/logo.png'), false)
})

it('directory globs match the directory path itself and its descendants', () => {
  const matcher = new ResourceMatcher({ ...defaults, include: ['./assets/**'] })
  assert.equal(matcher.matches('assets'), true)
  assert.equal(matcher.matches('assets/logo.png'), true)
  assert.equal(matcher.matches('assets/nested'), true)
  assert.equal(matcher.matches('other/assets'), false)
})

it('negated includes hide descendants without excluding them from folder totals and keep extglobs working', () => {
  const matcher = new ResourceMatcher({ ...defaults, include: ['**/*', '!**/drafts'] })
  assert.equal(matcher.matches('assets/logo.png'), true)
  assert.equal(matcher.matches('assets/drafts'), false)
  assert.equal(matcher.matches('assets/drafts/logo.png'), false)
  assert.equal(matcher.isExcluded('assets/drafts/logo.png'), false)
  assert.equal(new ResourceMatcher({ ...defaults, include: ['!**/*.tmp'] }).matches('assets/logo.png'), false)
  const extglob = new ResourceMatcher({ ...defaults, include: ['assets/!(draft).png'] })
  assert.equal(extglob.matches('assets/logo.png'), true)
  assert.equal(extglob.matches('assets/draft.png'), false)
  const negatedExtglob = new ResourceMatcher({ ...defaults, include: ['!(draft).png'] })
  assert.equal(negatedExtglob.matches('logo.png'), true)
  assert.equal(negatedExtglob.matches('draft.png'), false)
})

it('exclusions prune directory roots, descendants, dotfiles, Windows separators and brace globs', () => {
  const matcher = new ResourceMatcher({ ...defaults, exclude: [...defaults.exclude, '**/{build,dist}/**'] })
  for (const path of ['node_modules', 'node_modules/a.png', 'assets/node_modules/a', '.git', '.git/objects/a', 'assets\\node_modules\\x', 'assets/x.tmp', 'dist', 'src/build/x']) {
    assert.equal(matcher.isExcluded(path), true, path)
  }
  for (const path of ['', 'assets/logo.png', 'assets/node_modules_backup/logo.png', '.github/workflows/ci.yml']) {
    assert.equal(matcher.isExcluded(path), false, path)
  }
})

it('exclusions normalize relative patterns and ignore negated exclusion entries', () => {
  const matcher = new ResourceMatcher({ ...defaults, include: ['**/*'], exclude: ['./assets/**', '!**/*.png'] })
  assert.equal(matcher.isExcluded('assets'), true)
  assert.equal(matcher.isExcluded('assets/logo.png'), true)
  assert.equal(matcher.isExcluded('icon.PNG'), false)
  assert.equal(matcher.matches('assets/logo.png'), false)
  assert.equal(matcher.matches('icon.PNG'), true)
})

it('folder totals include all file types, keep direct and recursive counts, skip symlink loops', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 1024).file('/assets/notes.txt', 7).directory('/assets/nested').file('/assets/nested/b.jpg', 2048).directory('/assets/node_modules').file('/assets/node_modules/large.png', 1_000_000).directory('/assets/.git').file('/assets/.git/large', 1_000_000).link('/assets/loop')
  const result = await scanner(fs).measure('/assets')
  assert.deepEqual(result, { bytes: 3079, files: 3, directFiles: 2, directories: 1, skipped: 1, errors: 0, isDirectory: true })
  assert.equal(fs.calls.has('/assets/node_modules/large.png'), false)
  assert.equal(fs.calls.has('/assets/loop'), false)
})

it('zero byte files and empty folders remain visible as zero', async () => {
  const fs = new MemoryFs().directory('/assets').file('/empty.png', 0)
  const sizes = scanner(fs)
  assert.equal((await sizes.measure('/assets')).bytes, 0)
  assert.equal((await sizes.measure('/assets')).files, 0)
  assert.equal((await sizes.measure('/empty.png')).files, 1)
  assert.equal(formatSize(0), '0 B')
})

it('unreadable children produce partial totals instead of false complete totals', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 4).file('/assets/blocked.jpg', 20).directory('/assets/blocked').file('/assets/blocked/hidden.png', 40)
  fs.failures.add('/assets/blocked.jpg')
  fs.failures.add('/assets/blocked')
  const metrics = await scanner(fs).measure('/assets')
  assert.equal(metrics.bytes, 4)
  assert.equal(metrics.files, 1)
  assert.equal(metrics.errors, 2)
  assert.match(describeMetrics(metrics, defaults), /≥ 4 B/)
  assert.match(describeMetrics(metrics, defaults), /Unreadable items: 2/)
})

it('concurrent requests share one scan; changed descendants update every cached ancestor', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 10).file('/other.png', 5)
  const sizes = scanner(fs)
  const [one, two] = await Promise.all([sizes.measure('/assets'), sizes.measure('/assets')])
  assert.equal(one.bytes, two.bytes)
  assert.equal(fs.calls.get('/assets'), 1)
  await sizes.measure('/other.png')
  fs.file('/assets/a.png', 30)
  sizes.invalidate('/assets/a.png')
  assert.equal((await sizes.measure('/assets')).bytes, 30)
  assert.equal(fs.calls.get('/assets'), 1, 'the unchanged ancestor stat stays cached')
  await sizes.measure('/other.png')
  assert.equal(fs.calls.get('/other.png'), 1)
  sizes.invalidate('/asset')
  await sizes.measure('/assets')
  assert.equal(fs.calls.get('/assets'), 1, 'path prefixes are not mistaken for ancestors')
})

it('deleting a directory drops cached descendants and full invalidation drops all entries', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 10)
  const sizes = scanner(fs)
  await sizes.measure('/assets/a.png')
  sizes.invalidate('/assets')
  fs.entries.delete('/assets/a.png')
  await assert.rejects(sizes.measure('/assets/a.png'), /Not found/)
  fs.file('/assets/a.png', 99)
  assert.equal((await sizes.measure('/assets/a.png')).bytes, 99, 'a rejected read does not poison the cache')
  sizes.invalidate()
  await sizes.measure('/assets/a.png')
  assert.equal(fs.calls.get('/assets/a.png'), 4)
})

it('in-flight scans cannot repopulate stale results after invalidation', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 10)
  let release: () => void = () => {}
  let started: () => void = () => {}
  const entered = new Promise<void>((resolve) => { started = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  fs.beforeStat = async (key) => { if (key === '/assets/a.png') { started(); await gate } }
  const sizes = scanner(fs)
  const scan = sizes.measure('/assets')
  await entered
  sizes.invalidate('/assets/a.png')
  fs.file('/assets/a.png', 100)
  release()
  await assert.rejects(scan, ScanCancelled)
  assert.equal((await sizes.measure('/assets')).bytes, 100)
})

it('i/O concurrency stays bounded across overlapping folder requests', async () => {
  const fs = new MemoryFs().directory('/assets').directory('/public')
  for (let index = 0; index < 160; index++) {
    fs.file(`/assets/${index}.png`, 1).file(`/public/${index}.jpg`, 2)
  }
  fs.beforeStat = () => new Promise(resolve => setImmediate(resolve))
  const sizes = scanner(fs)
  const result = await Promise.all([sizes.measure('/assets'), sizes.measure('/public')])
  assert.deepEqual(result.map(item => item.bytes), [160, 320])
  assert.ok(fs.maxActive <= 16, `observed ${fs.maxActive} concurrent reads`)
})

it('bounded cache evicts old results without invalidating retained siblings', async () => {
  const fs = new MemoryFs().file('/a.png', 1).file('/b.png', 2).file('/c.png', 3)
  const sizes = new SizeScanner(fs, () => false, 2)
  await sizes.measure('/a.png'); await sizes.measure('/b.png'); await sizes.measure('/c.png')
  await sizes.measure('/b.png')
  assert.equal(fs.calls.get('/b.png'), 1)
  await sizes.measure('/a.png')
  assert.equal(fs.calls.get('/a.png'), 2)
})

it('formatting uses complete, explicit binary and decimal units', () => {
  assert.equal(formatSize(1536), '1.5 KiB')
  assert.equal(formatSize(1500, 'decimal'), '1.5 KB')
  assert.equal(formatSize(1024 ** 3, 'binary', 2), '1 GiB')
})

it('native labels show complete size and configurable folder counts without compact buckets', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 1536).directory('/assets/sub').file('/assets/sub/b.png', 512)
  const metrics = await scanner(fs).measure('/assets')
  assert.equal(inlineLabel(metrics, defaults), '2 files · 2 KiB')
  assert.equal(inlineLabel(metrics, { ...defaults, fileCountMode: 'direct' }), '1 file · 2 KiB')
  assert.equal(inlineLabel(metrics, { ...defaults, showFileCount: false }), '2 KiB')
  assert.equal(inlineLabel(await scanner(fs).measure('/assets/a.png'), defaults), '1.5 KiB')
})

it('size colors escalate at each threshold and folders use their own scale', () => {
  const MiB = 1024 ** 2
  assert.equal(sizeSeverity(0.25 * MiB - 1, false, defaults), 'normal')
  assert.equal(sizeSeverity(0.25 * MiB, false, defaults), 'warning')
  assert.equal(sizeSeverity(MiB, false, defaults), 'large')
  assert.equal(sizeSeverity(5 * MiB, false, defaults), 'critical')
  assert.equal(sizeSeverity(5 * MiB, true, defaults), 'normal')
  assert.equal(sizeSeverity(10 * MiB, true, defaults), 'warning')
  assert.equal(sizeSeverity(50 * MiB, true, defaults), 'large')
  assert.equal(sizeSeverity(100 * MiB, true, defaults), 'critical')
  assert.equal(sizeSeverity(MiB, false, { ...defaults, fileColorThresholdsMiB: [5, 0.25, 1] }), 'large')
  assert.equal(sizeSeverity(MiB, false, { ...defaults, fileColorThresholdsMiB: [NaN] }), 'large')
})

it('cache pressure retains in-flight requests so changed descendants still cancel them', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 1).file('/other.png', 2)
  let release: () => void = () => {}
  let started: () => void = () => {}
  const entered = new Promise<void>((resolve) => { started = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  fs.beforeStat = async (key) => { if (key === '/assets/a.png') { started(); await gate } }
  const sizes = new SizeScanner(fs, () => false, 1)
  const pending = sizes.measure('/assets')
  await entered
  await sizes.measure('/other.png')
  sizes.invalidate('/assets/a.png')
  release()
  await assert.rejects(pending, ScanCancelled)
})

it('count setting changes count display while retaining recursive size', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 1).directory('/assets/sub').file('/assets/sub/b.png', 2)
  const metrics = await scanner(fs).measure('/assets')
  assert.equal(fileCount(metrics, defaults), 2)
  assert.equal(fileCount(metrics, { ...defaults, fileCountMode: 'direct' }), 1)
  assert.match(describeMetrics(metrics, { ...defaults, fileCountMode: 'direct' }), /Files: 1 \(direct children\)/)
  assert.doesNotMatch(describeMetrics(metrics, { ...defaults, showFileCount: false }), /Files:/)
  assert.equal(metrics.bytes, 3)
})

it('file stats and overlapping ancestor scans share cached child results', async () => {
  const fs = new MemoryFs().directory('/assets').directory('/assets/sub').file('/assets/sub/a.png', 7)
  fs.beforeStat = () => new Promise(resolve => setImmediate(resolve))
  const sizes = scanner(fs)
  await Promise.all([sizes.stat('/assets/sub/a.png'), sizes.measure('/assets'), sizes.measure('/assets/sub')])
  await sizes.measure('/assets/sub/a.png')
  assert.equal(fs.calls.get('/assets/sub/a.png'), 1)
  assert.equal(fs.calls.get('/assets/sub'), 1)
  assert.equal(fs.directoryCalls.get('/assets/sub'), 1)
})

it('refresh maintains additions, changes and deletions through all cached ancestors without enumerating them', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/notes.txt', 3).directory('/assets/sub').directory('/assets/sub/deep').file('/assets/sub/deep/a.png', 10).directory('/assets/other').file('/assets/other/b.png', 50)
  const sizes = scanner(fs)
  await sizes.measure('/assets')
  const initialListings = new Map(fs.directoryCalls)
  fs.file('/assets/sub/deep/a.png', 20).file('/assets/sub/new.txt', 7)
  await sizes.refresh(['/assets/sub/deep/a.png', '/assets/sub/new.txt', '/assets/sub/deep/a.png'])
  assert.deepEqual(await sizes.measure('/assets'), { bytes: 80, files: 4, directFiles: 1, directories: 3, skipped: 0, errors: 0, isDirectory: true })
  assert.equal((await sizes.measure('/assets/sub')).bytes, 27)
  assert.equal((await sizes.measure('/assets/sub')).directFiles, 1)
  assert.equal((await sizes.measure('/assets/sub/deep')).bytes, 20)
  assert.equal((await sizes.measure('/assets/sub/deep/a.png')).bytes, 20)
  assert.equal(fs.calls.get('/assets/sub/deep/a.png'), 2)
  assert.equal(fs.calls.get('/assets/notes.txt'), 1)
  assert.equal(fs.calls.get('/assets/other/b.png'), 1)
  assert.deepEqual(fs.directoryCalls, initialListings)

  fs.entries.delete('/assets/sub/deep/a.png')
  fs.entries.delete('/assets/sub/new.txt')
  await sizes.refresh(['/assets/sub/deep/a.png', '/assets/sub/new.txt'])
  assert.deepEqual(await sizes.measure('/assets'), { bytes: 53, files: 2, directFiles: 1, directories: 3, skipped: 0, errors: 0, isDirectory: true })
  assert.equal((await sizes.measure('/assets/sub')).bytes, 0)
  assert.equal((await sizes.measure('/assets/sub')).files, 0)
  assert.deepEqual(fs.directoryCalls, initialListings)
})

it('directory create, rename and delete replace only their affected subtree contributions', async () => {
  const fs = new MemoryFs().directory('/assets').directory('/public').file('/assets/keep.png', 5)
  const sizes = scanner(fs)
  await Promise.all([sizes.measure('/assets'), sizes.measure('/public')])
  fs.directory('/assets/new').directory('/assets/new/deep').file('/assets/new/deep/a.png', 10)
  await sizes.refresh(['/assets/new/deep/a.png', '/assets/new', '/assets/new/deep'])
  assert.deepEqual(await sizes.measure('/assets'), { bytes: 15, files: 2, directFiles: 1, directories: 2, skipped: 0, errors: 0, isDirectory: true })
  assert.equal(fs.calls.get('/assets/new/deep/a.png'), 1, 'overlapping events scan the new subtree once')

  fs.entries.delete('/assets/new'); fs.entries.delete('/assets/new/deep'); fs.entries.delete('/assets/new/deep/a.png')
  fs.directory('/public/moved').directory('/public/moved/deep').file('/public/moved/deep/a.png', 10)
  await sizes.refresh(['/assets/new', '/public/moved'])
  assert.equal((await sizes.measure('/assets')).bytes, 5)
  assert.equal((await sizes.measure('/assets')).directories, 0)
  assert.equal((await sizes.measure('/public')).bytes, 10)
  assert.equal((await sizes.measure('/public')).directories, 2)
  await assert.rejects(sizes.measure('/assets/new/deep/a.png'), /Not found/)

  fs.entries.delete('/public/moved'); fs.entries.delete('/public/moved/deep'); fs.entries.delete('/public/moved/deep/a.png')
  await sizes.refresh(['/public/moved', '/public/moved/deep/a.png'])
  assert.deepEqual(await sizes.measure('/public'), { bytes: 0, files: 0, directFiles: 0, directories: 0, skipped: 0, errors: 0, isDirectory: true })
  assert.equal(fs.directoryCalls.get('/assets'), 1)
  assert.equal(fs.directoryCalls.get('/public'), 1)
  assert.equal(fs.calls.get('/assets/keep.png'), 1)
})

it('ancestor contributions survive child LRU eviction and a missing intermediate cache entry', async () => {
  const fs = new MemoryFs().directory('/assets').directory('/assets/sub').file('/assets/sub/a.png', 1).directory('/assets/other').file('/assets/other/b.png', 20).file('/outside.png', 5)
  const sizes = new SizeScanner(fs, () => false, 2)
  await sizes.measure('/assets')
  await sizes.measure('/outside.png')
  fs.file('/assets/sub/a.png', 10)
  await sizes.refresh(['/assets/sub/a.png'])
  assert.equal((await sizes.measure('/assets')).bytes, 30)
  assert.equal(fs.calls.get('/assets/other/b.png'), 1, 'evicted siblings retain their aggregate contribution')
  assert.equal(fs.directoryCalls.get('/assets'), 1)
  assert.equal(fs.directoryCalls.get('/assets/sub'), 2, 'an evicted changed branch is safely rebuilt')
})

it('changes during an incremental refresh cancel old results and retain every dirty branch', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 1).file('/assets/b.png', 2)
  const sizes = scanner(fs)
  await sizes.measure('/assets')
  let release: () => void = () => {}
  let started: () => void = () => {}
  const entered = new Promise<void>((resolve) => { started = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  fs.beforeStat = async (key) => { if (key === '/assets/a.png') { started(); await gate } }
  fs.file('/assets/a.png', 10)
  sizes.invalidate('/assets/a.png')
  const old = sizes.measure('/assets')
  const cancelled = assert.rejects(old, ScanCancelled)
  await entered
  fs.file('/assets/b.png', 20)
  const refresh = sizes.refresh(['/assets/b.png'])
  release()
  await Promise.all([cancelled, refresh])
  assert.equal((await sizes.measure('/assets')).bytes, 30)
  assert.equal(fs.directoryCalls.get('/assets'), 1)
})

it('file and directory replacements keep direct counts, subtree counts and symlink skips correct', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/item', 5)
  const sizes = scanner(fs)
  await sizes.measure('/assets')
  fs.directory('/assets/item').file('/assets/item/a.png', 10)
  await sizes.refresh(['/assets/item'])
  assert.deepEqual(await sizes.measure('/assets'), { bytes: 10, files: 1, directFiles: 0, directories: 1, skipped: 0, errors: 0, isDirectory: true })
  fs.entries.delete('/assets/item/a.png')
  fs.file('/assets/item', 7)
  await sizes.refresh(['/assets/item'])
  assert.deepEqual(await sizes.measure('/assets'), { bytes: 7, files: 1, directFiles: 1, directories: 0, skipped: 0, errors: 0, isDirectory: true })
  fs.link('/assets/item')
  await sizes.refresh(['/assets/item'])
  assert.deepEqual(await sizes.measure('/assets'), { bytes: 0, files: 0, directFiles: 0, directories: 0, skipped: 1, errors: 0, isDirectory: true })
})

it('refresh keeps permission failures partial, retries later changes, and ignores excluded paths', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 1).file('/assets/keep.png', 2)
  const sizes = scanner(fs)
  await sizes.measure('/assets')
  fs.failures.add('/assets/a.png')
  await sizes.refresh(['/assets/a.png'])
  assert.equal((await sizes.measure('/assets')).bytes, 2)
  assert.equal((await sizes.measure('/assets')).errors, 1)
  fs.failures.delete('/assets/a.png')
  fs.file('/assets/a.png', 10)
  await sizes.refresh(['/assets/a.png'])
  assert.equal((await sizes.measure('/assets')).bytes, 12)
  assert.equal((await sizes.measure('/assets')).errors, 0)
  const calls = new Map(fs.calls)
  await sizes.refresh(['/assets/node_modules/ignored.png'])
  assert.deepEqual(fs.calls, calls)
  assert.equal(fs.directoryCalls.get('/assets'), 1)
})

it('batched roots distinguish path prefixes and refresh does not scan unobserved resources', async () => {
  const fs = new MemoryFs().directory('/assets').file('/assets/a.png', 1).directory('/assets-other').file('/assets-other/b.png', 2).directory('/public').file('/public/new.png', 3)
  const sizes = scanner(fs)
  await Promise.all([sizes.measure('/assets'), sizes.measure('/assets-other')])
  fs.file('/assets/a.png', 10).file('/assets-other/b.png', 20)
  await sizes.refresh(['/assets-other/b.png', '/assets', '/assets/a.png', '/public/new.png'])
  assert.equal((await sizes.measure('/assets')).bytes, 10)
  assert.equal((await sizes.measure('/assets-other')).bytes, 20)
  assert.equal(fs.calls.has('/public/new.png'), false)
  assert.equal(fs.calls.get('/assets/a.png'), 2)
})

it('deep directory trees and URI keys retain incremental ancestor totals', async () => {
  const fs = new MemoryFs()
  let deepest = '/assets'
  fs.directory(deepest)
  for (let index = 0; index < 400; index++) {
    deepest = `${deepest}/d`
    fs.directory(deepest)
  }
  fs.file(`${deepest}/a.png`, 1)
  const sizes = scanner(fs)
  assert.equal((await sizes.measure('/assets')).directories, 400)
  fs.file(`${deepest}/a.png`, 2)
  await sizes.refresh([`${deepest}/a.png`])
  assert.equal((await sizes.measure('/assets')).bytes, 2)
  assert.equal(fs.directoryCalls.get('/assets'), 1)

  const uriFs: FileSystem = {
    stat: key => fs.stat(new URL(key).pathname),
    readDirectory: key => fs.readDirectory(new URL(key).pathname),
    join: (key, name) => `${key.replace(/\/$/, '')}/${name}`,
  }
  const uriSizes = new SizeScanner(uriFs, () => false)
  await uriSizes.measure('vscode-remote://host/assets')
  fs.file(`${deepest}/a.png`, 3)
  await uriSizes.refresh([`vscode-remote://host${deepest}/a.png`])
  assert.equal((await uriSizes.measure('vscode-remote://host/assets')).bytes, 3)
})
