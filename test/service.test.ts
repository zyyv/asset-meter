import type { FileStat, Metrics } from '../src/core/types'
import assert from 'node:assert/strict'
import { beforeEach, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { assetResource, AssetTreeProvider } from '../src/assetTree'
import { SizeDecorationProvider } from '../src/decorations'
import { SizeService } from '../src/service'

const state = vi.hoisted(() => ({
  entries: new Map<string, FileStat>(),
  config: {} as Record<string, unknown>,
  workspaceRoot: 'file:///workspace',
  workspaceRoots: undefined as string[] | undefined,
  beforeStat: undefined as ((key: string) => Promise<void>) | undefined,
  beforeRead: undefined as ((key: string) => Promise<void>) | undefined,
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
    with(change: { scheme?: string }) {
      return Uri.parse(change.scheme ? this.toString().replace(/^[^:]+:/, `${change.scheme}:`) : this.toString())
    }

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
    TreeItem: class {
      constructor(public label: string, public collapsibleState: number) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: { File: { id: 'file' }, Folder: { id: 'folder' } },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      get workspaceFolders() {
        return (state.workspaceRoots ?? [state.workspaceRoot]).map((root, index) => ({ uri: Uri.parse(root), name: posix.basename(Uri.parse(root).path), index }))
      },
      getWorkspaceFolder: (uri: Uri) => {
        const root = (state.workspaceRoots ?? [state.workspaceRoot]).map(key => Uri.parse(key)).sort((a, b) => b.path.length - a.path.length).find(root => uri.toString() === root.toString() || uri.toString().startsWith(`${root}/`))
        return root ? { uri: root } : undefined
      },
      getConfiguration: vi.fn(() => ({ get: (key: string, fallback: unknown) => state.config[key] ?? fallback })),
      fs: {
        stat: vi.fn(async (uri: Uri) => {
          await state.beforeStat?.(uri.toString())
          const entry = state.entries.get(uri.toString())
          if (!entry) { throw Object.assign(new Error('Not found'), { code: 'FileNotFound' }) }
          return { ...entry }
        }),
        readDirectory: vi.fn(async (uri: Uri) => {
          await state.beforeRead?.(uri.toString())
          return [...state.entries]
            .filter(([key]) => key !== uri.toString() && key.startsWith(`${uri.toString().replace(/\/$/, '')}/`) && posix.dirname(Uri.parse(key).path) === uri.path)
            .map(([key, stat]) => [posix.basename(Uri.parse(key).path), stat.type])
        }),
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
  state.beforeRead = undefined
  state.workspaceRoots = undefined
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
    assert.deepEqual(vi.mocked(vscode.workspace.getConfiguration).mock.calls.map(([namespace]) => namespace), ['assetMeter'])
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

it.each(['always', 'hover'])('unpatched hosts provide visible compact badges in always mode and exact tooltip details in %s mode', async (mode) => {
  state.config.displayMode = mode
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    const folder = await decorations.provideFileDecoration(assets, token)
    assert.equal(folder?.badge, mode === 'always' ? '10' : undefined)
    assert.match(folder?.tooltip ?? '', /Files: 1/)
    assert.match(folder?.tooltip ?? '', /Size: 10 B/)
    assert.match(folder?.tooltip ?? '', /Install \/ Reapply Native Explorer Patch/)
  }
  finally { decorations.dispose(); service.dispose() }
})

it('matching diagnostics explain skipped resources without reading the filesystem', () => {
  const service = new SizeService()
  try {
    assert.equal(service.inspectMatch(logo).reason, 'included')
    assert.equal(service.inspectMatch(vscode.Uri.joinPath(assets, 'notes.txt')).reason, 'include-not-matched-or-negated')
    assert.equal(service.inspectMatch(vscode.Uri.joinPath(assets, 'node_modules', 'logo.png')).reason, 'excluded')
    assert.equal(service.inspectMatch(vscode.Uri.parse('file:///outside/logo.png')).reason, 'outside-workspace')
    state.config.enabled = false
    service.invalidate(undefined, true)
    assert.equal(service.inspectMatch(logo).reason, 'disabled')
    assert.equal(vi.mocked(vscode.workspace.fs.stat).mock.calls.length, 0)
  }
  finally { service.dispose() }
})

it('decoration logging records matches, measurements and read failures instead of hiding errors', async () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const service = new SizeService(log)
  const decorations = new SizeDecorationProvider(service, false, log)
  try {
    assert.ok(await decorations.provideFileDecoration(logo, token))
    assert.ok(log.debug.mock.calls.some(([message]) => message.includes('Decoration match:')))
    assert.ok(log.debug.mock.calls.some(([message]) => message.includes('Measured:')))
    state.entries.delete(logo.toString())
    service.invalidate([logo])
    assert.equal(await decorations.provideFileDecoration(logo, token), undefined)
    assert.ok(log.warn.mock.calls.some(([message]) => message.includes('Filesystem stat failed:')))
    assert.ok(log.error.mock.calls.some(([message]) => message.includes('Decoration failed:')))
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

it.each([
  { name: 'empty include', include: [], exclude: [] },
  { name: 'unmatched include', include: ['**/*.jpg'], exclude: [] },
  { name: 'excluded file', include: ['**/*.png'], exclude: ['**/*.png'] },
  { name: 'excluded ancestor', include: ['**/*.png'], exclude: ['assets'] },
  { name: 'negated include', include: ['**/*.png', '!assets/**'], exclude: [] },
])('$name skips decoration without reading the filesystem', async ({ include, exclude }) => {
  state.config = { ...state.config, include, exclude }
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    assert.equal(await decorations.provideFileDecoration(logo, token), undefined)
    assert.equal(vi.mocked(vscode.workspace.fs.stat).mock.calls.length, 0)
    assert.equal(vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.length, 0)
  }
  finally { decorations.dispose(); service.dispose() }
})

it('include filters decorations while only exclude reduces folder sizes and counts', async () => {
  const notes = vscode.Uri.joinPath(assets, 'notes.txt')
  const drafts = vscode.Uri.joinPath(assets, 'drafts')
  const draft = vscode.Uri.joinPath(drafts, 'draft.png')
  const privateFolder = vscode.Uri.joinPath(assets, 'private')
  const privateFile = vscode.Uri.joinPath(privateFolder, 'secret.png')
  state.entries.set(notes.toString(), { type: vscode.FileType.File, size: 5 })
  state.entries.set(drafts.toString(), { type: vscode.FileType.Directory, size: 0 })
  state.entries.set(draft.toString(), { type: vscode.FileType.File, size: 20 })
  state.entries.set(privateFolder.toString(), { type: vscode.FileType.Directory, size: 0 })
  state.entries.set(privateFile.toString(), { type: vscode.FileType.File, size: 100 })
  state.config.include = ['assets', '**/*.png', '!**/drafts/**']
  state.config.exclude = ['**/private/**']
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  try {
    assert.ok(await decorations.provideFileDecoration(logo, token))
    assert.equal(await decorations.provideFileDecoration(notes, token), undefined)
    assert.equal(await decorations.provideFileDecoration(draft, token), undefined)
    assert.equal(await decorations.provideFileDecoration(privateFile, token), undefined)
    assert.equal(service.isExcluded(draft), false)
    assert.equal(service.isExcluded(privateFile), true)
    const metrics = await service.measure(assets)
    assert.equal(metrics.bytes, 35)
    assert.equal(metrics.files, 3)
    assert.equal(metrics.directFiles, 2)
    assert.equal(metrics.directories, 1)
    assert.ok(vi.mocked(vscode.workspace.fs.stat).mock.calls.every(([uri]) => !uri.path.includes('/private')))
    assert.ok(vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.every(([uri]) => !uri.path.includes('/private')))

    state.config.include = []
    service.invalidate(undefined, true)
    assert.equal(await decorations.provideFileDecoration(assets, token), undefined)
    assert.equal((await service.measure(assets)).bytes, 35, 'empty include must not reduce totals')
    assert.equal((await service.measure(assets)).files, 3)
  }
  finally { decorations.dispose(); service.dispose() }
})

it('changing exclude invalidates existing decorations and cached ancestor totals in both directions', async () => {
  const notes = vscode.Uri.joinPath(assets, 'notes.txt')
  state.entries.set(notes.toString(), { type: vscode.FileType.File, size: 5 })
  const service = new SizeService()
  const decorations = new SizeDecorationProvider(service)
  const notify = vi.fn()
  decorations.onDidChangeFileDecorations(notify)
  try {
    assert.ok(await decorations.provideFileDecoration(logo, token))
    assert.equal((await service.measure(assets)).bytes, 15)
    state.config.exclude = ['**/*.png']
    service.invalidate(undefined, true)
    assert.equal(await decorations.provideFileDecoration(logo, token), undefined)
    assert.equal(service.inspectMatch(logo).reason, 'excluded')
    assert.equal((await service.measure(assets)).bytes, 5)
    assert.equal((await service.measure(assets)).files, 1)

    state.config.exclude = []
    service.invalidate(undefined, true)
    assert.ok(await decorations.provideFileDecoration(logo, token))
    assert.equal((await service.measure(assets)).bytes, 15)
    assert.equal((await service.measure(assets)).files, 2)
    assert.deepEqual(notify.mock.calls, [[undefined], [undefined]])
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

it('asset tree keeps matched resources and their ancestors, and prunes unrelated, excluded and symlink branches', async () => {
  state.config.include = ['**/*.png', '**/empty']
  for (const [path, type] of [
    ['assets/nested', 2],
    ['assets/nested/photo2.png', 1],
    ['assets/nested/photo10.png', 1],
    ['assets/notes.txt', 1],
    ['empty', 2],
    ['docs', 2],
    ['docs/readme.txt', 1],
    ['node_modules', 2],
    ['node_modules/hidden.png', 1],
    ['loop', 66],
  ] as const) { state.entries.set(`file:///workspace/${path}`, { type, size: 5 }) }
  const service = new SizeService()
  const tree = new AssetTreeProvider(service)
  try {
    const roots = await tree.getChildren()
    assert.deepEqual(roots.map(node => node.name), ['assets', 'empty'])
    const children = await tree.getChildren(roots[0])
    assert.deepEqual(children.map(node => node.name), ['nested', 'logo.png'])
    assert.deepEqual((await tree.getChildren(children[0])).map(node => node.name), ['photo2.png', 'photo10.png'])
    assert.equal((await tree.getTreeItem(roots[1]!)).collapsibleState, vscode.TreeItemCollapsibleState.None)
    const reads = vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.map(([uri]) => uri.path)
    assert.ok(!reads.some(path => path.includes('node_modules') || path.includes('loop')))
    const count = reads.length
    await tree.getChildren()
    assert.equal(vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.length, count, 'reopening cached branches does not rescan')
  }
  finally { tree.dispose(); service.dispose() }
})

it('asset tree shows the same full metrics, preserves theme icons and opens actual resources without a duplicate badge', async () => {
  state.entries.set(vscode.Uri.joinPath(assets, 'notes.txt').toString(), { type: 1, size: 5 })
  const service = new SizeService()
  const tree = new AssetTreeProvider(service)
  const decorations = new SizeDecorationProvider(service)
  try {
    const [folder] = await tree.getChildren()
    const folderItem = await tree.getTreeItem(folder!)
    assert.equal(folderItem.description, '2 files · 15 B', 'folder totals retain files hidden by include, as in Explorer')
    assert.equal(folderItem.iconPath, vscode.ThemeIcon.Folder)
    const [file] = await tree.getChildren(folder)
    const item = await tree.getTreeItem(file!)
    assert.equal(item.description, '10 B')
    assert.equal(item.iconPath, vscode.ThemeIcon.File)
    assert.equal(item.contextValue, 'assetMeter.image')
    assert.equal(item.command?.command, 'vscode.open')
    assert.deepEqual(item.command?.arguments, [logo])
    assert.equal(assetResource(file)?.toString(), logo.toString())
    assert.equal(assetResource(logo), logo)
    assert.equal(assetResource(), undefined)
    assert.equal(await decorations.provideFileDecoration(item.resourceUri!, token), undefined)
    assert.match(String(item.tooltip), /Size: 10 B/)
    state.config.fileCountMode = 'direct'
    state.config.showFileCount = false
    state.config.units = 'binary'
    state.config.displayMode = 'hover'
    service.invalidate(undefined, true)
    assert.equal((await tree.getTreeItem(folder!)).description, '15 B', 'panel keeps full descriptions in hover mode too')
  }
  finally { decorations.dispose(); tree.dispose(); service.dispose() }
})

it('asset tree routes SVG files through the configured SVG opener, including uppercase extensions', async () => {
  state.config.include = ['**/*.svg']
  const uri = vscode.Uri.joinPath(assets, 'logo.SVG')
  state.entries.set(uri.toString(), { type: vscode.FileType.File, size: 100 })
  const service = new SizeService()
  const tree = new AssetTreeProvider(service)
  try {
    const [folder] = await tree.getChildren()
    const [file] = await tree.getChildren(folder)
    const item = await tree.getTreeItem(file!)
    assert.equal(item.command?.command, 'assetMeter.openSvg')
    assert.deepEqual(item.command?.arguments, [uri])
  }
  finally { tree.dispose(); service.dispose() }
})

it('asset tree updates added, deleted and renamed branches while retaining unrelated directory caches', async () => {
  state.config.include = ['**/*.png']
  state.entries.set('file:///workspace/other', { type: 2, size: 0 })
  state.entries.set('file:///workspace/other/other.png', { type: 1, size: 1 })
  const service = new SizeService()
  const tree = new AssetTreeProvider(service)
  const notify = vi.fn()
  tree.onDidChangeTreeData(notify)
  try {
    const [folder] = await tree.getChildren()
    const added = vscode.Uri.joinPath(assets, 'added.png')
    state.entries.set(added.toString(), { type: 1, size: 20 })
    await service.refresh([added])
    assert.deepEqual((await tree.getChildren(folder)).map(node => node.name), ['added.png', 'logo.png'])
    state.entries.delete(logo.toString())
    await service.refresh([logo])
    assert.deepEqual((await tree.getChildren(folder)).map(node => node.name), ['added.png'])
    const renamed = vscode.Uri.joinPath(assets, 'added.txt')
    state.entries.delete(added.toString())
    state.entries.set(renamed.toString(), { type: 1, size: 20 })
    await service.refresh([added, renamed])
    assert.deepEqual((await tree.getChildren()).map(node => node.name), ['other'], 'the last matched file disappearing prunes its ancestors')
    assert.equal(notify.mock.calls.length, 3)
    assert.equal(vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.filter(([uri]) => uri.path.endsWith('/other')).length, 1)
    service.invalidate()
    await tree.getChildren()
    assert.equal(vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.filter(([uri]) => uri.path.endsWith('/other')).length, 2, 'manual refresh clears all branches')
  }
  finally { tree.dispose(); service.dispose() }
})

it('asset tree responds to changed rules, disabled extension and empty workspaces', async () => {
  const service = new SizeService()
  const tree = new AssetTreeProvider(service)
  try {
    assert.equal((await tree.getChildren()).length, 1)
    state.config.include = ['**/*.jpg']
    service.invalidate(undefined, true)
    assert.deepEqual(await tree.getChildren(), [])
    state.config.include = ['**/*']
    state.config.enabled = false
    service.invalidate(undefined, true)
    vi.mocked(vscode.workspace.fs.readDirectory).mockClear()
    assert.deepEqual(await tree.getChildren(), [])
    assert.equal(vi.mocked(vscode.workspace.fs.readDirectory).mock.calls.length, 0)
    state.workspaceRoots = []
    assert.deepEqual(await tree.getChildren(), [])
  }
  finally { tree.dispose(); service.dispose() }
})

it('asset tree separates workspace roots and supports virtual filesystem providers', async () => {
  state.workspaceRoots = ['file:///workspace', 'memfs://remote/project']
  const remote = 'memfs://remote/project/banner.png'
  state.entries.set(remote, { type: 1, size: 42 })
  const service = new SizeService()
  const tree = new AssetTreeProvider(service)
  try {
    const roots = await tree.getChildren()
    assert.deepEqual(roots.map(node => node.name), ['workspace', 'project'])
    assert.equal((await tree.getTreeItem(roots[1]!)).collapsibleState, vscode.TreeItemCollapsibleState.Expanded)
    const [file] = await tree.getChildren(roots[1])
    assert.equal(file?.uri.toString(), remote)
    assert.equal((await tree.getTreeItem(file!)).description, '42 B')
  }
  finally { tree.dispose(); service.dispose() }
})

it('asset tree discards invalidated pending reads and retries unreadable branches on refresh', async () => {
  const service = new SizeService()
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const tree = new AssetTreeProvider(service, log)
  let release: () => void = () => {}
  let started: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const entered = new Promise<void>((resolve) => { started = resolve })
  state.beforeRead = async () => { started(); await gate }
  try {
    const pending = tree.getChildren()
    await entered
    state.config.include = []
    service.invalidate(undefined, true)
    release()
    assert.deepEqual(await pending, [])
    assert.equal(log.warn.mock.calls.length, 0, 'invalidated reads do not log filesystem failures')
    state.config.include = ['**/*.png']
    service.invalidate(undefined, true)
    state.beforeRead = async () => { throw new Error('Permission denied') }
    assert.deepEqual(await tree.getChildren(), [])
    assert.ok(log.warn.mock.calls.length)
    state.beforeRead = undefined
    service.invalidate()
    assert.equal((await tree.getChildren()).length, 1)
    tree.dispose()
    assert.deepEqual(await tree.getChildren(), [])
  }
  finally { tree.dispose(); service.dispose() }
})
