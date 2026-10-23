import type { FileStat, Metrics } from '../src/core/types'
import assert from 'node:assert/strict'
import { beforeEach, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { SizeDecorationProvider } from '../src/decorations'
import { SizeService } from '../src/service'

const state = vi.hoisted(() => ({
  entries: new Map<string, FileStat>(),
  config: {} as Record<string, unknown>,
  workspaceRoot: 'file:///workspace',
  beforeStat: undefined as ((key: string) => Promise<void>) | undefined,
}))

vi.mock('vscode', async () => {
  const { posix } = await import('node:path')
  class Uri {
    constructor(private readonly url: URL) {}
    static parse(key: string) { return new Uri(new URL(key)) }
    static joinPath(uri: Uri, ...parts: string[]) {
      const url = new URL(uri.toString())
      url.pathname = posix.join(url.pathname, ...parts)
      return new Uri(url)
    }

    get scheme() { return this.url.protocol.slice(0, -1) }
    get authority() { return this.url.host }
    get path() { return decodeURIComponent(this.url.pathname) }
    toString() { return this.url.toString() }
  }
  class EventEmitter<T> {
    private readonly listeners = new Set<(value: T) => void>()
    readonly event = (listener: (value: T) => void) => {
      this.listeners.add(listener)
      return { dispose: () => this.listeners.delete(listener) }
    }

    fire(value: T) { for (const listener of this.listeners) { listener(value) } }
    dispose() { this.listeners.clear() }
  }
  return {
    Uri,
    EventEmitter,
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      getWorkspaceFolder: (uri: Uri) => {
        const root = Uri.parse(state.workspaceRoot)
        return uri.toString() === root.toString() || uri.toString().startsWith(`${root}/`) ? { uri: root } : undefined
      },
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => state.config[key] ?? fallback }),
      fs: {
        stat: vi.fn(async (uri: Uri) => {
          await state.beforeStat?.(uri.toString())
          const entry = state.entries.get(uri.toString())
          if (!entry) { throw Object.assign(new Error('Not found'), { code: 'FileNotFound' }) }
          return { ...entry }
        }),
        readDirectory: vi.fn(async (uri: Uri) => [...state.entries]
          .filter(([key]) => key !== uri.toString() && posix.dirname(Uri.parse(key).path) === uri.path)
          .map(([key, stat]) => [posix.basename(Uri.parse(key).path), stat.type])),
      },
    },
  }
})

const assets = vscode.Uri.parse('file:///workspace/assets')
const logo = vscode.Uri.joinPath(assets, 'logo.png')
const token = { isCancellationRequested: false } as vscode.CancellationToken

beforeEach(() => {
  vi.clearAllMocks()
  state.beforeStat = undefined
  state.workspaceRoot = 'file:///workspace'
  state.config = { include: ['**/*.png', '**/assets'], exclude: ['**/node_modules/**'] }
  state.entries.clear()
  state.entries.set(assets.toString(), { type: vscode.FileType.Directory, size: 0 })
  state.entries.set(logo.toString(), { type: vscode.FileType.File, size: 10 })
})

it('path matching is synchronous and performs no filesystem reads', () => {
  const service = new SizeService()
  try {
    assert.equal(service.matches(logo), true)
    assert.equal(service.matches(assets), true)
    assert.equal(service.matches(vscode.Uri.joinPath(assets, 'node_modules', 'logo.png')), false)
    assert.equal(vi.mocked(vscode.workspace.fs.stat).mock.calls.length, 0)
    assert.equal(vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.length, 0)
  }
  finally { service.dispose() }
})

it('directory globs decorate empty folders while symbolic links stay hidden', async () => {
  state.config.include = ['assets/**']
  state.entries.delete(logo.toString())
  const link = vscode.Uri.joinPath(assets, 'loop')
  state.entries.set(link.toString(), { type: vscode.FileType.Directory | vscode.FileType.SymbolicLink, size: 0 })
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    assert.match((await decorations.provideFileDecoration(assets, token))?.tooltip ?? '', /0 B/)
    assert.equal(await decorations.provideFileDecoration(link, token), undefined)
  }
  finally { decorations.dispose(); service.dispose() }
})

it('switching display modes keeps inline metrics with a hover marker and refreshes Explorer', async () => {
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service, true)
  const notify = vi.fn()
  decorations.onDidChangeFileDecorations(notify)
  try {
    assert.equal((await decorations.provideFileDecoration(assets, token))?.badge, '\u2063\u20601 file · 10 B\u2063')
    state.config.displayMode = 'hover'
    service.invalidate(undefined, true)
    assert.equal(notify.mock.calls.length, 1)
    const folder = await decorations.provideFileDecoration(assets, token)
    assert.equal(folder?.badge, '\u2063\u2060\u20621 file · 10 B\u2063')
    assert.match(folder?.tooltip ?? '', /Files: 1/)
    const file = await decorations.provideFileDecoration(logo, token)
    assert.equal(file?.badge, '\u2063\u2060\u206210 B\u2063')
    assert.equal(file?.color, undefined)
    assert.match(file?.tooltip ?? '', /Size: 10 B/)
    state.config.displayMode = 'always'
    service.invalidate(undefined, true)
    assert.equal((await decorations.provideFileDecoration(assets, token))?.badge, '\u2063\u20601 file · 10 B\u2063')
  }
  finally { decorations.dispose(); service.dispose() }
})

it.each(['always', 'hover'])('unpatched hosts keep tooltip details without long badges in %s mode', async (mode) => {
  state.config.displayMode = mode
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    const folder = await decorations.provideFileDecoration(assets, token)
    assert.equal(folder?.badge, undefined)
    assert.match(folder?.tooltip ?? '', /Files: 1/)
    assert.match(folder?.tooltip ?? '', /Size: 10 B/)
  }
  finally { decorations.dispose(); service.dispose() }
})

it('refresh updates cached sizes before notifying Explorer about the resource and every ancestor', async () => {
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service, true)
  try {
    await decorations.provideFileDecoration(assets, token)
    await decorations.provideFileDecoration(logo, token)
    assert.equal(vi.mocked(vscode.workspace.fs.stat).mock.calls.length, 2, 'decorations and totals share file stats')
    let notifiedMetrics: Promise<Metrics> | undefined
    let affected: string[] = []
    service.onDidChange(() => { notifiedMetrics = service.measure(assets) })
    decorations.onDidChangeFileDecorations((uris) => { affected = uris?.map(uri => uri.toString()) ?? [] })
    state.entries.set(logo.toString(), { type: vscode.FileType.File, size: 20 })
    await service.refresh([logo])
    assert.equal((await notifiedMetrics)?.bytes, 20)
    assert.deepEqual(affected, [logo.toString(), assets.toString(), 'file:///workspace'])
    assert.match((await decorations.provideFileDecoration(assets, token))?.tooltip ?? '', /20 B/)
    assert.equal(vi.mocked(vscode.workspace.fs.stat).mock.calls.length, 3)
    assert.equal(vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.length, 1, 'only the aggregate reads directory contents')
  }
  finally { decorations.dispose(); service.dispose() }
})

it('deleted files are removed from cached ancestor sizes before decoration notifications', async () => {
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    await service.measure(assets)
    state.entries.delete(logo.toString())
    await service.refresh([logo])
    assert.equal((await service.measure(assets)).bytes, 0)
    assert.equal((await service.measure(assets)).files, 0)
    assert.equal(await decorations.provideFileDecoration(logo, token), undefined)
    assert.match((await decorations.provideFileDecoration(assets, token))?.tooltip ?? '', /0 B/)
  }
  finally { decorations.dispose(); service.dispose() }
})

it('include globs use workspace paths and configuration changes rebuild decoration rules', async () => {
  state.config.include = ['assets/*.png']
  const other = vscode.Uri.parse('file:///workspace/other.png')
  state.entries.set(other.toString(), { type: vscode.FileType.File, size: 5 })
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    assert.ok(await decorations.provideFileDecoration(logo, token))
    assert.equal(await decorations.provideFileDecoration(other, token), undefined)
    assert.equal(await decorations.provideFileDecoration(assets, token), undefined)
    state.config.include = ['**/*']
    service.invalidate(undefined, true)
    assert.ok(await decorations.provideFileDecoration(other, token))
    assert.ok(await decorations.provideFileDecoration(assets, token))
    state.config.include = []
    service.invalidate(undefined, true)
    assert.equal(await decorations.provideFileDecoration(logo, token), undefined)
  }
  finally { decorations.dispose(); service.dispose() }
})

it('new files become selectable after refresh while totals count files outside include', async () => {
  const notes = vscode.Uri.joinPath(assets, 'notes.txt')
  const added = vscode.Uri.joinPath(assets, 'added.png')
  state.entries.set(notes.toString(), { type: vscode.FileType.File, size: 5 })
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    assert.equal(await decorations.provideFileDecoration(added, token), undefined)
    assert.equal((await service.measure(assets)).bytes, 15)
    state.entries.set(added.toString(), { type: vscode.FileType.File, size: 20 })
    await service.refresh([added])
    assert.match((await decorations.provideFileDecoration(added, token))?.tooltip ?? '', /20 B/)
    assert.equal(await decorations.provideFileDecoration(notes, token), undefined)
    assert.equal((await service.measure(assets)).bytes, 35)
  }
  finally { decorations.dispose(); service.dispose() }
})

it('path matching supports virtual workspaces while metrics use the VS Code filesystem', async () => {
  state.workspaceRoot = 'memfs://remote/project'
  const remoteAssets = vscode.Uri.parse('memfs://remote/project/assets')
  const remoteLogo = vscode.Uri.joinPath(remoteAssets, 'logo.png')
  state.entries.set(remoteAssets.toString(), { type: vscode.FileType.Directory, size: 0 })
  state.entries.set(remoteLogo.toString(), { type: vscode.FileType.File, size: 42 })
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    assert.match((await decorations.provideFileDecoration(remoteAssets, token))?.tooltip ?? '', /42 B/)
    assert.match((await decorations.provideFileDecoration(remoteLogo, token))?.tooltip ?? '', /42 B/)
    assert.equal(service.matches(logo), false, 'resources outside this workspace are ignored')
  }
  finally { decorations.dispose(); service.dispose() }
})

it('excluded changes do no work and configuration invalidation rebuilds settings and totals', async () => {
  const service = new SizeService()
  const notify = vi.fn()
  service.onDidChange(notify)
  try {
    await service.measure(assets)
    const excluded = vscode.Uri.joinPath(assets, 'node_modules')
    state.entries.set(excluded.toString(), { type: vscode.FileType.Directory, size: 0 })
    state.entries.set(vscode.Uri.joinPath(excluded, 'big.png').toString(), { type: vscode.FileType.File, size: 100 })
    const reads = vi.mocked(vscode.workspace.fs.stat).mock.calls.length
    await service.refresh([excluded])
    assert.equal(notify.mock.calls.length, 0)
    assert.equal(vi.mocked(vscode.workspace.fs.stat).mock.calls.length, reads)
    state.config.exclude = []
    service.invalidate(undefined, true)
    assert.equal((await service.measure(assets)).bytes, 110)
    assert.equal(notify.mock.calls.length, 1)
    assert.equal(notify.mock.calls[0]?.[0], undefined)
  }
  finally { service.dispose() }
})

it('disposing during refresh cancels work without sending a late decoration notification', async () => {
  const service = new SizeService()
  const notify = vi.fn()
  service.onDidChange(notify)
  await service.measure(assets)
  let release: () => void = () => {}
  let started: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const entered = new Promise<void>((resolve) => { started = resolve })
  state.beforeStat = async () => { started(); await gate }
  const refresh = service.refresh([logo])
  await entered
  service.dispose()
  release()
  await refresh
  await service.refresh([logo])
  assert.equal(notify.mock.calls.length, 0)
})
