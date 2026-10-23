import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runInNewContext, Script } from 'node:vm'
import { it } from 'vitest'
import { getNativePatchStatus, installNativePatch, patchExtensionHost, patchWorkbench, restoreNativePatch } from '../src/nativePatch'

const host = `class Decoration { static validate(t) { if(typeof t.badge=="string"){let e=t.badge.length?1:0;if(e<t.badge.length&&(e+=1),t.badge.length>e)throw new Error("The 'badge'-property must be undefined or a short character")}return true} } globalThis.validate = Decoration.validate;`
const renderer = 'globalThis.one = function(i,t,e){emit(`.${this.itemBadgeClassName}::after`,`content: "${i}"; color: ${color(t)};`,e)};globalThis.many=function(i,t,e){emit(`.${this.itemBadgeClassName}::after`,`content: "${i.join(", ")}"; color: ${t};`,e)};'
const targetPaths = ['out/vs/workbench/api/node/extensionHostProcess.js', 'out/vs/workbench/workbench.desktop.main.js', 'out/vs/workbench/workbench.desktop.main.css']

it('patched host accepts only safe full Asset Size labels and preserves other badge validation', () => {
  const context: { validate?: (value: { badge: string }) => boolean } = {}
  runInNewContext(patchExtensionHost(host), context)
  assert.ok(context.validate)
  assert.equal(context.validate({ badge: '\u2063324 files · 1.2 MB\u2063' }), true)
  assert.equal(context.validate({ badge: '\u206302 files · ≥ 1.5 KiB\u2063' }), true)
  assert.equal(context.validate({ badge: '\u2063\u20600 files · 0 B\u2063' }), true)
  assert.equal(context.validate({ badge: '\u2063\u2060\u20620 files · 0 B\u2063' }), true)
  assert.equal(context.validate({ badge: '\u2063\u2060\u2060\u2060\u2060\u20621.2 MB\u2063' }), true)
  assert.equal(context.validate({ badge: 'M' }), true)
  assert.throws(() => context.validate!({ badge: 'unrelated-long-badge' }))
  assert.throws(() => context.validate!({ badge: '\u2063"; background: red;\u2063' }))
  assert.throws(() => context.validate!({ badge: '\u2063\u2060\u2062\u20621.2 MB\u2063' }))
  assert.throws(() => context.validate!({ badge: '\u2063\u2060\u2062"; background: red;\u2063' }))
})

it('renderer scopes sizes to Explorer, keeps counts neutral, and preserves ordinary badges', () => {
  const source = patchWorkbench(renderer)
  assert.doesNotThrow(() => new Script(source))
  const emitted: [string, string][] = []
  const context: Record<string, unknown> = { emit: (selector: string, content: string) => emitted.push([selector, content]), color: () => 'red' }
  runInNewContext(source, context)
  const one = context.one as (letter: string, color: string) => void
  const many = context.many as (letters: string[], color: string) => void
  const receiver = { itemBadgeClassName: 'example' }
  one.call(receiver, 'M', 'red')
  one.call(receiver, '\u2063\u2060\u2060\u2060\u20601.2 MB\u2063', 'red')
  many.call(receiver, ['M', '\u2063324 files · 1.2 MB\u2063'], 'red')
  one.call(receiver, '\u2063\u20600 files · 0 B\u2063', 'red')
  assert.equal(emitted[0]![0], '.example::after')
  assert.equal(emitted[0]![1], 'content: "M"; color: red;')
  assert.match(emitted[1]![1], /content: ""/)
  assert.equal(emitted[2]![0], '.monaco-workbench .explorer-folders-view .monaco-list-row .monaco-icon-label.example::after')
  assert.match(emitted[2]![1], /content: "1.2 MB"/)
  assert.match(emitted[2]![1], /var\(--vscode-assetSize-sizeCritical\)/)
  assert.match(emitted[3]![1], /content: "M"/)
  assert.equal(emitted[5]![0], '.explorer-folders-view .monaco-list-row .example > .monaco-icon-label-container::after')
  assert.match(emitted[5]![1], /content: "24 files ·"/)
  assert.match(emitted[5]![1], /var\(--vscode-descriptionForeground\)/)
  assert.match(emitted[7]![1], /content: "0 B"/)
  assert.match(emitted[8]![1], /content: "0 files ·"/)
  assert.doesNotMatch(emitted[8]![1], /00 files/)
})

it('hover labels reveal counts and sizes only on the hovered Explorer row and preserve other badges', () => {
  const emitted: [string, string][] = []
  const context: Record<string, unknown> = { emit: (selector: string, content: string) => emitted.push([selector, content]), color: () => 'red' }
  runInNewContext(patchWorkbench(renderer), context)
  const one = context.one as (letter: string, color: string) => void
  const many = context.many as (letters: string[], color: string) => void
  const receiver = { itemBadgeClassName: 'example' }
  many.call(receiver, ['M', '\u2063\u2060\u2060\u2060\u2060\u206224 files · 1.2 MB\u2063'], 'red')
  one.call(receiver, '\u2063\u2060\u20620 B\u2063', 'red')
  assert.deepEqual(emitted[0], ['.example::after', 'content: "M"; color: red;'])
  assert.equal(emitted[1]![0], '.monaco-workbench .explorer-folders-view .monaco-list-row:hover .monaco-icon-label.example::after')
  assert.match(emitted[1]![1], /content: "1.2 MB"/)
  assert.match(emitted[1]![1], /var\(--vscode-assetSize-sizeCritical\)/)
  assert.equal(emitted[2]![0], '.explorer-folders-view .monaco-list-row:hover .example > .monaco-icon-label-container::after')
  assert.match(emitted[2]![1], /content: "24 files ·"/)
  assert.match(emitted[2]![1], /var\(--vscode-descriptionForeground\)/)
  assert.deepEqual(emitted[3], ['.example::after', 'content: ""; color: red;'])
  assert.match(emitted[4]![0], /\.monaco-list-row:hover /)
  assert.match(emitted[4]![1], /content: "0 B"/)
  assert.equal(emitted.length, 5, 'Files do not emit a count label')
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'asset-size-patch-'))
  for (const file of targetPaths) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }) }
  await writeFile(path.join(root, 'package.json'), '{"version":"test-1"}')
  await writeFile(path.join(root, targetPaths[0]!), host)
  await writeFile(path.join(root, targetPaths[1]!), renderer)
  await writeFile(path.join(root, targetPaths[2]!), 'body { color: white; }')
  return root
}

it('installation backs up all files, is idempotent, and restoration is byte-for-byte reversible', async () => {
  const root = await fixture()
  try {
    const original = await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8')))
    assert.equal((await getNativePatchStatus(root)).installed, false)
    assert.equal((await installNativePatch(root)).changed, true)
    assert.equal((await getNativePatchStatus(root)).installed, true)
    assert.equal((await installNativePatch(root)).changed, false)
    assert.equal((await restoreNativePatch(root)).changed, true)
    assert.deepEqual(await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8'))), original)
    assert.equal((await getNativePatchStatus(root)).installed, false)
    assert.equal((await restoreNativePatch(root)).changed, false)
    assert.equal((await installNativePatch(root)).changed, true)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('unsupported editor layouts are rejected before any program file is modified', async () => {
  const root = await fixture()
  try {
    await writeFile(path.join(root, targetPaths[1]!), 'unknown renderer')
    await assert.rejects(installNativePatch(root), /Unsupported decoration renderer layout/)
    assert.equal(await readFile(path.join(root, targetPaths[0]!), 'utf8'), host)
    assert.ok(!(await readdir(root)).includes('.asset-size-native-patch'))
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('upgrading a previous patch adds row hover support and retains the original backups', async () => {
  const root = await fixture()
  try {
    const originals = await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8')))
    await installNativePatch(root)
    const manifestPath = path.join(root, '.asset-size-native-patch', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { revision: number, files: { patchedHash: string }[] }
    manifest.revision = 3
    for (const [index, file] of targetPaths.entries()) {
      const older = (await readFile(path.join(root, file), 'utf8')).replaceAll('ASSET_SIZE_NATIVE_PATCH_V4', 'ASSET_SIZE_NATIVE_PATCH_V3')
      await writeFile(path.join(root, file), older)
      manifest.files[index]!.patchedHash = createHash('sha256').update(older).digest('hex')
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    assert.equal((await getNativePatchStatus(root)).needsUpgrade, true)
    assert.equal((await installNativePatch(root)).changed, true)
    assert.equal((await getNativePatchStatus(root)).installed, true)
    assert.match(await readFile(path.join(root, targetPaths[1]!), 'utf8'), /:hover/)
    assert.ok(!(await readdir(root)).some(file => file.startsWith('.asset-size-native-patch.')))
    await restoreNativePatch(root)
    assert.deepEqual(await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8'))), originals)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('restore refuses to overwrite a later editor change and checks every file before restoring', async () => {
  const root = await fixture()
  try {
    await installNativePatch(root)
    const patchedHost = await readFile(path.join(root, targetPaths[0]!), 'utf8')
    await writeFile(path.join(root, targetPaths[2]!), 'updated editor CSS')
    await assert.rejects(restoreNativePatch(root), /avoid overwriting a newer version/)
    assert.equal(await readFile(path.join(root, targetPaths[0]!), 'utf8'), patchedHost)
    assert.equal(await readFile(path.join(root, targetPaths[2]!), 'utf8'), 'updated editor CSS')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('reapplying after a clean editor update archives the old backups', async () => {
  const root = await fixture()
  try {
    await installNativePatch(root)
    await writeFile(path.join(root, 'package.json'), '{"version":"test-2"}')
    await writeFile(path.join(root, targetPaths[0]!), `${host}\n// new version`)
    await writeFile(path.join(root, targetPaths[1]!), renderer)
    await writeFile(path.join(root, targetPaths[2]!), 'body { color: yellow; }')
    await installNativePatch(root)
    assert.ok((await readdir(root)).some(file => file.startsWith('.asset-size-native-patch.test-1.')))
    await restoreNativePatch(root)
    assert.equal(await readFile(path.join(root, targetPaths[2]!), 'utf8'), 'body { color: yellow; }')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
