import assert from 'node:assert/strict'
import { beforeEach, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { AssetTreeProvider } from '../src/assetTree'
import { metadataLimits } from '../src/metadata/limits'
import { normalizeMetadata } from '../src/metadata/normalize'
import { ImageDetailsPreview } from '../src/metadata/preview'
import { MetadataService } from '../src/metadata/service'
import { SizeService } from '../src/service'
import { resetWorkspace, state, workspaceUris } from './support/workspace'

vi.mock('vscode', async () => (await import('./support/workspace')).createVscodeMock())
const { assets, logo, token } = workspaceUris(vscode)
beforeEach(() => resetWorkspace(vscode))

it('does not parse remote data that grows beyond its limit after stat', async () => {
  const service = new SizeService()
  const reader = { parse: vi.fn(async () => normalizeMetadata(undefined)), dispose() {} }
  const metadata = new MetadataService(service, '', undefined, reader)
  const remote = vscode.Uri.parse('memfs://remote/growing.png')
  state.entries.set(remote.toString(), { type: 1, size: 3 })
  vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(new Uint8Array(metadataLimits.remoteBytes + 1))
  try {
    assert.equal((await metadata.get(remote))?.status, 'error')
    assert.equal(reader.parse.mock.calls.length, 0)
    await metadata.get(remote)
    assert.equal(vi.mocked(vscode.workspace.fs.readFile).mock.calls.length, 1, 'the rejection is cached')
  }
  finally { metadata.dispose(); service.dispose() }
})

it('skips the worker when a remote read becomes stale before it finishes', async () => {
  const service = new SizeService()
  const reader = { parse: vi.fn(async () => normalizeMetadata(undefined)), dispose() {} }
  const metadata = new MetadataService(service, '', undefined, reader)
  const remote = vscode.Uri.parse('memfs://remote/stale.png')
  state.entries.set(remote.toString(), { type: 1, size: 3 })
  let release = () => {}
  let entered = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const reading = new Promise<void>((resolve) => { entered = resolve })
  vi.mocked(vscode.workspace.fs.readFile).mockImplementationOnce(async () => { entered(); await gate; return new Uint8Array([1, 2, 3]) })
  try {
    const pending = metadata.get(remote)
    await reading
    metadata.invalidate([remote])
    release()
    assert.equal(await pending, undefined)
    assert.equal(reader.parse.mock.calls.length, 0)
  }
  finally { release(); metadata.dispose(); service.dispose() }
})

it('metadata never delays statistics and hover plus Markdown preview share one cached parse', async () => {
  const service = new SizeService()
  let release: () => void = () => {}
  let started: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const entered = new Promise<void>((resolve) => { started = resolve })
  const result = normalizeMetadata({ exif: { Model: 'Shared camera', UserComment: '<script>alert(1)</script> [link](command:evil)' } })
  const reader = { parse: vi.fn(async () => { started(); await gate; return result }), dispose: vi.fn() }
  const metadata = new MetadataService(service, '', undefined, reader)
  const tree = new AssetTreeProvider(service, undefined, metadata)
  const preview = new ImageDetailsPreview(service, metadata)
  const changed = vi.fn()
  tree.onDidChangeTreeData(changed)
  const node = { uri: logo, name: 'logo.png', isDirectory: false, hasChildren: false }
  try {
    const item = await tree.getTreeItem(node)
    assert.equal(item.description, '10 B', 'statistics return before the parser finishes')
    assert.equal(item.tooltip, undefined, 'VS Code can lazily resolve the pending hover')
    await entered
    const first = metadata.get(logo)
    assert.equal(metadata.get(logo), first, 'in-flight requests share one promise')
    const hover = tree.resolveTreeItem(item, node, token)
    assert.equal((await service.measure(assets)).bytes, 10, 'metadata does not block the scanner')
    release()
    assert.equal(await first, result)
    const resolved = await hover
    assert.ok(resolved.tooltip instanceof vscode.MarkdownString)
    assert.match(resolved.tooltip.value.replace(/<(?:wbr|br)>/g, ''), /Shared camera/)
    assert.ok(!resolved.tooltip.value.includes('<script>'))
    assert.equal(resolved.tooltip.isTrusted, false)
    assert.equal((await tree.getTreeItem(node)).description, 'ⓘ · 10 B')
    const documentUri = preview.uriFor(logo)
    assert.equal(documentUri.query, '', 'webview resource roots must have the same empty query as image requests')
    const content = await preview.provideTextDocumentContent(documentUri)
    assert.match(content, /Shared camera/)
    assert.ok(content.indexOf('![Image preview]') < content.indexOf('Path:'))
    assert.ok(content.indexOf('Path:') < content.indexOf('### Metadata'))
    const image = /!\[Image preview\]\(<([^>]+)>\)/.exec(content)?.[1]
    assert.ok(image?.includes('/image/'), 'native Markdown uses a relative image on the virtual filesystem')
    const provider = vi.mocked(vscode.workspace.registerFileSystemProvider).mock.calls.at(-1)?.[1]
    assert.ok(provider)
    const imageUri = vscode.Uri.parse(`asset-meter-details:${image}`)
    assert.ok(imageUri.path.startsWith(`${documentUri.path.slice(0, documentUri.path.lastIndexOf('/'))}/`), 'image stays inside the Markdown preview resource root')
    assert.equal(new TextDecoder().decode(await provider.readFile(documentUri)), content)
    assert.equal((await provider.stat(documentUri)).size, Buffer.byteLength(content))
    await provider.readFile(imageUri)
    assert.equal(vi.mocked(vscode.workspace.fs.readFile).mock.calls.at(-1)?.[0].toString(), logo.toString())
    assert.equal(reader.parse.mock.calls.length, 1, 'opening the full preview does not reparse the image')
    assert.equal(changed.mock.calls.length, 1)
    assert.equal(changed.mock.calls[0]?.[0], node, 'only the parsed resource row refreshes')
    metadata.dispose()
    assert.equal(reader.dispose.mock.calls.length, 1)
  }
  finally { preview.dispose(); tree.dispose(); metadata.dispose(); service.dispose() }
})

it('metadata drops invalidated in-flight results and caches negative results without repeated reads', async () => {
  const service = new SizeService()
  let release: () => void = () => {}
  let started: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const entered = new Promise<void>((resolve) => { started = resolve })
  const reader = { parse: vi.fn(async () => { started(); await gate; return normalizeMetadata(undefined) }), dispose() {} }
  const metadata = new MetadataService(service, '', undefined, reader)
  const changed = vi.fn()
  metadata.onDidChange(changed)
  try {
    const pending = metadata.get(logo)
    await entered
    metadata.invalidate([assets])
    release()
    assert.equal(await pending, undefined)
    assert.equal(changed.mock.calls.length, 0, 'stale completions never refresh the tree')
    assert.equal(metadata.peek(logo), undefined)
    assert.equal((await metadata.get(logo))?.status, 'empty')
    await metadata.get(logo)
    assert.equal(reader.parse.mock.calls.length, 2, 'no-metadata results are cached too')
    service.invalidate()
    await metadata.get(logo)
    assert.equal(reader.parse.mock.calls.length, 3, 'manual refresh invalidates metadata')
    assert.equal((await metadata.get(vscode.Uri.joinPath(assets, 'icon.svg')))?.status, 'unsupported')
    assert.equal(reader.parse.mock.calls.length, 3)
  }
  finally { metadata.dispose(); service.dispose() }
})

it('metadata bounds its LRU cache, handles remote bytes, and isolates read/parse failures', async () => {
  const service = new SizeService()
  const reader = { parse: vi.fn(async () => normalizeMetadata({ exif: { Model: 'Remote' } })), dispose() {} }
  const metadata = new MetadataService(service, '', undefined, reader)
  try {
    const remote = vscode.Uri.parse('memfs://remote/photo.png')
    state.entries.set(remote.toString(), { type: 1, size: 3 })
    await metadata.get(remote)
    assert.deepEqual(reader.parse.mock.calls[0], [new Uint8Array([1, 2, 3])])
    const tooLarge = vscode.Uri.parse('memfs://remote/large.png')
    state.entries.set(tooLarge.toString(), { type: 1, size: 33 * 1024 * 1024 })
    assert.equal((await metadata.get(tooLarge))?.status, 'error')
    assert.equal(vi.mocked(vscode.workspace.fs.readFile).mock.calls.length, 1, 'large remote resources are not read in full')
    const missing = vscode.Uri.joinPath(assets, 'missing.png')
    assert.equal((await metadata.get(missing))?.status, 'error')
    await metadata.get(missing)
    assert.equal(reader.parse.mock.calls.length, 1, 'failed reads are cached')
    for (let index = 0; index < 257; index++) {
      const uri = vscode.Uri.joinPath(assets, `${index}.png`)
      state.entries.set(uri.toString(), { type: 1, size: 3 })
      await metadata.get(uri)
    }
    assert.equal(metadata.peek(vscode.Uri.joinPath(assets, '0.png')), undefined, 'old entries are evicted')
    assert.equal(metadata.peek(vscode.Uri.joinPath(assets, '256.png'))?.status, 'ready')
    reader.parse.mockRejectedValueOnce(new Error('Worker crashed'))
    metadata.invalidate([logo])
    assert.equal((await metadata.get(logo))?.status, 'error')
    metadata.invalidate([logo])
    assert.equal((await metadata.get(logo))?.status, 'ready', 'a parse failure cannot poison later jobs')
  }
  finally { metadata.dispose(); service.dispose() }
})
