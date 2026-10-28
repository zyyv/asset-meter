import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runInNewContext, Script } from 'node:vm'
import { it } from 'vitest'
import { getNativePatchStatus, installNativePatch, patchExtensionHost, patchWorkbench, restoreNativePatch } from '../src/nativePatch'

const host = `class Decoration { static validate(t) { if(typeof t.badge=="string"){let e=t.badge.length?1:0;if(e<t.badge.length&&(e+=1),t.badge.length>e)throw new Error("The 'badge'-property must be undefined or a short character")}return true} } globalThis.validate = Decoration.validate;`
const renderer = 'globalThis.one = function(i,t,e){emit(`.${this.itemBadgeClassName}::after`,`content: "${i}"; color: ${color(t)};`,e)};globalThis.many=function(i,t,e){emit(`.${this.itemBadgeClassName}::after`,`content: "${i.join(", ")}"; color: ${t};`,e)};globalThis.setLabel = function(i){if(i?.suffix||this.suffixNode){this.suffixNode=i.suffix}};'
const targetPaths = ['out/vs/workbench/api/node/extensionHostProcess.js', 'out/vs/workbench/workbench.desktop.main.js', 'out/vs/workbench/workbench.desktop.main.css']

it('colors only encoded Asset Meter size spans and leaves metadata indicators and counts neutral', () => {
  const context: Record<string, unknown> = {}
  runInNewContext(patchWorkbench(renderer), context)
  const setLabel = context.setLabel as (options: object) => void
  const children: { textContent: string, className?: string, style?: { color?: string } }[] = []
  const element = {
    textContent: '\u2063\u2060\u2060\u2060\u2060ⓘ · 6.3 MB\u2063',
    closest: () => true,
    ownerDocument: {
      createElement: () => ({ className: '', textContent: '', style: {} }),
      createTextNode: (textContent: string) => ({ textContent }),
    },
    replaceChildren: (...nodes: typeof children) => { children.splice(0, children.length, ...nodes) },
  }
  setLabel.call({ descriptionNode: { element } }, {})
  assert.equal(children.map(node => node.textContent).join(''), 'ⓘ · 6.3 MB')
  assert.equal(children[0]!.textContent, 'ⓘ · ')
  assert.equal(children[0]!.style, undefined)
  assert.equal(children[1]!.style!.color, 'var(--vscode-assetMeter-sizeCritical)')
  element.textContent = '\u2063\u2060\u2060\u20603 files · 1.5 MiB\u2063'
  setLabel.call({ descriptionNode: { element } }, {})
  assert.equal(children.map(node => node.textContent).join(''), '3 files · 1.5 MiB')
  assert.equal(children[0]!.textContent, '3 files · ')
  assert.equal(children[1]!.style!.color, 'var(--vscode-assetMeter-sizeLarge)')
  const previous = children[1]
  element.closest = () => false
  setLabel.call({ descriptionNode: { element } }, {})
  assert.equal(children[1], previous, 'other views are not modified')
  element.closest = () => true
  element.textContent = '\u2063\u2060";color:red;\u2063'
  setLabel.call({ descriptionNode: { element } }, {})
  assert.equal(children[1], previous, 'non-numeric descriptions cannot inject styles')
})

it('rejects unknown asset description layouts before modifying program files', () => {
  assert.throws(() => patchWorkbench(renderer.replace('if(i?.suffix||this.suffixNode)', 'if(false)')), /Unsupported asset tree description layout/)
})

it('patched host accepts only safe full Asset Meter labels and preserves other badge validation', () => {
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
  assert.match(emitted[2]![1], /var\(--vscode-assetMeter-sizeCritical\)/)
  assert.match(emitted[3]![1], /content: "M"/)
  assert.equal(emitted[5]![0], '.explorer-folders-view .monaco-list-row .example > .monaco-icon-label-container::after')
  assert.match(emitted[5]![1], /content: "24 files · "/)
  assert.match(emitted[5]![1], /var\(--vscode-descriptionForeground\)/)
  assert.match(emitted[7]![1], /content: "0 B"/)
  assert.match(emitted[8]![1], /content: "0 files · "/)
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
  assert.match(emitted[1]![1], /var\(--vscode-assetMeter-sizeCritical\)/)
  assert.equal(emitted[2]![0], '.explorer-folders-view .monaco-list-row:hover .example > .monaco-icon-label-container::after')
  assert.match(emitted[2]![1], /content: "24 files · "/)
  assert.match(emitted[2]![1], /var\(--vscode-descriptionForeground\)/)
  assert.deepEqual(emitted[3], ['.example::after', 'content: ""; color: red;'])
  assert.match(emitted[4]![0], /\.monaco-list-row:hover /)
  assert.match(emitted[4]![1], /content: "0 B"/)
  assert.equal(emitted.length, 5, 'Files do not emit a count label')
})

it.each(['3 files · 603 B', '1 file · 240 B', '0 files · 0 B', '24 files · ≥ 1.5 MiB'])('split Explorer labels preserve the exact spacing of "%s"', (label) => {
  const emitted: [string, string][] = []
  const context: Record<string, unknown> = { emit: (selector: string, content: string) => emitted.push([selector, content]), color: () => 'red' }
  runInNewContext(patchWorkbench(renderer), context)
  const one = context.one as (letter: string, color: string) => void
  one.call({ itemBadgeClassName: 'example' }, `\u2063\u2060${label}\u2063`, 'red')
  const size = emitted[1]![1]
  const count = emitted[2]![1]
  const text = (content: string) => /content: "([^"]*)"/.exec(content)?.[1]
  assert.equal(`${text(count)}${text(size)}`, label, 'count and size together match Asset Meter’s single text description')
  assert.match(size, /margin-left: 0px;/, 'no extra pixels are inserted after the separator')
  assert.match(count, /white-space: pre;/, 'the single trailing space is preserved across the two spans')
})

it('standalone file sizes keep their gap from the filename without adding a separator', () => {
  const emitted: [string, string][] = []
  const context: Record<string, unknown> = { emit: (selector: string, content: string) => emitted.push([selector, content]), color: () => 'red' }
  runInNewContext(patchWorkbench(renderer), context)
  const one = context.one as (letter: string, color: string) => void
  one.call({ itemBadgeClassName: 'example' }, '\u2063\u2060603 B\u2063', 'red')
  assert.equal(emitted.length, 2)
  assert.match(emitted[1]![1], /content: "603 B";/)
  assert.match(emitted[1]![1], /margin-left: 12px;/)
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'asset-meter-patch-'))
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
    assert.ok(!(await readdir(root)).includes('.asset-meter-native-patch'))
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('upgrading a previous patch adds row hover support and retains the original backups', async () => {
  const root = await fixture()
  try {
    const originals = await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8')))
    await installNativePatch(root)
    const manifestPath = path.join(root, '.asset-meter-native-patch', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { revision: number, files: { patchedHash: string }[] }
    manifest.revision = 3
    for (const [index, file] of targetPaths.entries()) {
      const older = (await readFile(path.join(root, file), 'utf8')).replaceAll('ASSET_METER_NATIVE_PATCH_V8', 'ASSET_METER_NATIVE_PATCH_V3')
      await writeFile(path.join(root, file), older)
      manifest.files[index]!.patchedHash = createHash('sha256').update(older).digest('hex')
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    assert.equal((await getNativePatchStatus(root)).needsUpgrade, true)
    assert.equal((await installNativePatch(root)).changed, true)
    assert.equal((await getNativePatchStatus(root)).installed, true)
    assert.match(await readFile(path.join(root, targetPaths[1]!), 'utf8'), /:hover/)
    assert.ok(!(await readdir(root)).some(file => file.startsWith('.asset-meter-native-patch.')))
    await restoreNativePatch(root)
    assert.deepEqual(await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8'))), originals)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it.each([5, 6, 7])('upgrading V%s keeps dedicated tree statistics right-aligned and restoration reversible', async (revision) => {
  const root = await fixture()
  try {
    const originals = await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8')))
    await installNativePatch(root)
    const manifestPath = path.join(root, '.asset-meter-native-patch', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { revision: number, files: { patchedHash: string, originalHash: string }[] }
    const originalHashes = manifest.files.map(file => file.originalHash)
    manifest.revision = revision
    for (const [index, file] of targetPaths.entries()) {
      const previous = (await readFile(path.join(root, file), 'utf8'))
        .replaceAll('ASSET_METER_NATIVE_PATCH_V8', `ASSET_METER_NATIVE_PATCH_V${revision}`)
        .split('\n')
        .filter(line => revision !== 5 || !line.startsWith('.monaco-workbench .customview-tree'))
        .join('\n')
      await writeFile(path.join(root, file), previous)
      manifest.files[index]!.patchedHash = createHash('sha256').update(previous).digest('hex')
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    assert.equal((await getNativePatchStatus(root)).needsUpgrade, true)
    await installNativePatch(root)
    const stylesheet = await readFile(path.join(root, targetPaths[2]!), 'utf8')
    assert.ok(stylesheet.startsWith(originals[2]!))
    const treeRules = stylesheet.split('\n').filter(line => line.startsWith('.monaco-workbench .customview-tree'))
    assert.ok(treeRules.length)
    assert.ok(treeRules.every(rule => rule.includes('.monaco-list[aria-label="Asset Meter"]')), 'alignment does not affect other custom trees')
    assert.ok(treeRules.some(rule => rule.includes('.monaco-icon-label-container { display: flex;')))
    assert.ok(treeRules.some(rule => rule.includes('.monaco-icon-description-container { margin-left: auto;') && rule.includes('flex: 0 0 auto;')))
    assert.ok(treeRules.some(rule => rule.includes('.monaco-icon-name-container { min-width: 0; overflow: hidden; text-overflow: ellipsis;')))
    const upgraded = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest
    assert.equal(upgraded.revision, 8)
    assert.deepEqual(upgraded.files.map(file => file.originalHash), originalHashes)
    assert.equal((await getNativePatchStatus(root)).installed, true)
    await restoreNativePatch(root)
    assert.deepEqual(await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8'))), originals)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it.each(['restore', 'upgrade'] as const)('renamed extension can %s a legacy Assets Size patch without losing its original backups', async (action) => {
  const root = await fixture()
  try {
    const originals = await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8')))
    await installNativePatch(root)
    const backupDirectory = path.join(root, '.asset-size-native-patch')
    await rename(path.join(root, '.asset-meter-native-patch'), backupDirectory)
    const manifestPath = path.join(backupDirectory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { revision: number, files: { patchedHash: string }[] }
    manifest.revision = 4
    for (const [index, file] of targetPaths.entries()) {
      const legacy = (await readFile(path.join(root, file), 'utf8'))
        .replaceAll('ASSET_METER_NATIVE_PATCH_V8', 'ASSET_SIZE_NATIVE_PATCH_V4')
        .replaceAll('assetMeter', 'assetSize')
      await writeFile(path.join(root, file), legacy)
      manifest.files[index]!.patchedHash = createHash('sha256').update(legacy).digest('hex')
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    const status = await getNativePatchStatus(root)
    assert.equal(status.backupDirectory, backupDirectory)
    assert.equal(status.needsUpgrade, true)
    assert.equal(status.installed, false)
    assert.throws(() => patchExtensionHost(`${host}\n/* ASSET_SIZE_NATIVE_PATCH_V4 */`), /already contains/)
    if (action === 'upgrade') {
      assert.deepEqual(await installNativePatch(root), { changed: true, backupDirectory })
      assert.equal((await getNativePatchStatus(root)).installed, true)
      const workbench = await readFile(path.join(root, targetPaths[1]!), 'utf8')
      assert.match(workbench, /ASSET_METER_NATIVE_PATCH_V8/)
      assert.match(workbench, /--vscode-assetMeter-sizeCritical/)
    }
    assert.deepEqual(await Promise.all(targetPaths.map((_, index) => readFile(path.join(backupDirectory, `${index}.original`), 'utf8'))), originals)
    assert.deepEqual(await restoreNativePatch(root), { changed: true, backupDirectory })
    assert.deepEqual(await Promise.all(targetPaths.map(file => readFile(path.join(root, file), 'utf8'))), originals)
    assert.ok(!(await readdir(root)).includes('.asset-meter-native-patch'))
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
    assert.ok((await readdir(root)).some(file => file.startsWith('.asset-meter-native-patch.test-1.')))
    await restoreNativePatch(root)
    assert.equal(await readFile(path.join(root, targetPaths[2]!), 'utf8'), 'body { color: yellow; }')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
