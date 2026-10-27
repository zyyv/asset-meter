import type { AssetMeterApi } from '../src/extension'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import { SizeDecorationProvider } from '../src/decorations'
import { getNativePatchStatus } from '../src/nativePatch'
import { SizeService } from '../src/service'

export async function run(): Promise<void> {
  const { publisher, name } = JSON.parse(await readFile(path.join(__dirname, '../package.json'), 'utf8'))
  const extension = vscode.extensions.getExtension<AssetMeterApi>(`${publisher}.${name}`)
  assert.ok(extension, 'Extension is installed in the development host')
  const api = await extension.activate()
  const plugin = {
    id: 'integration-test',
    label: 'Integration Test',
    description: 'Local test plugin',
    formats: ['png'] as const,
    describe: () => 'Test PNG',
    compress: ({ bytes }: { bytes: Uint8Array }) => ({ result: Promise.resolve(bytes), cancel: () => {} }),
  }
  const registration = api.registerCompressionPlugin(plugin)
  assert.throws(() => api.registerCompressionPlugin(plugin), /already registered/)
  registration.dispose()
  const replacement = api.registerCompressionPlugin(plugin)
  registration.dispose()
  assert.throws(() => api.registerCompressionPlugin(plugin), /already registered/)
  replacement.dispose()
  console.log('Asset Meter integration: compression plugin API registration and disposal')
  const root = vscode.workspace.workspaceFolders?.[0]?.uri
  assert.ok(root)
  const assets = vscode.Uri.joinPath(root, 'assets')
  const logo = vscode.Uri.joinPath(assets, 'logo.png')
  const config = vscode.workspace.getConfiguration('assetMeter', root)
  // Native workspace watching initializes asynchronously during host startup.
  // Wait for an actual event before testing watcher-driven cache invalidation.
  const readiness = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'))
  let observedProbe = false
  const observe = (uri: vscode.Uri) => { if (uri.path.endsWith('/.asset-meter-watch-probe')) { observedProbe = true } }
  const createProbe = readiness.onDidCreate(observe)
  const changeProbe = readiness.onDidChange(observe)
  const probe = vscode.Uri.joinPath(root, '.asset-meter-watch-probe')
  try {
    await waitFor(async () => {
      await vscode.workspace.fs.writeFile(probe, new TextEncoder().encode(String(Date.now())))
      return observedProbe
    })
  }
  finally {
    createProbe.dispose(); changeProbe.dispose(); readiness.dispose()
    await vscode.workspace.fs.delete(probe)
  }
  console.log('Asset Meter integration: native watcher ready')
  const service = new SizeService()
  const patched = (await getNativePatchStatus(vscode.env.appRoot)).installed
  const decorations = new SizeDecorationProvider(service, patched)
  const cancellation = new vscode.CancellationTokenSource()
  try {
    await waitFor(async () => (await api.getSize(assets))?.bytes === 2305)
    console.log('Asset Meter integration: initial totals')
    assert.equal((await api.getSize(assets))?.files, 3)
    assert.equal((await api.getSize(logo))?.bytes, 1536)
    assert.equal(await api.getSize(vscode.Uri.joinPath(assets, 'node_modules', 'skip.png')), undefined)

    const native = await decorations.provideFileDecoration(assets, cancellation.token)
    assert.equal(native?.badge, patched ? '\u2063\u20603 files · 2.3 KB\u2063' : undefined)
    assert.match(native?.tooltip ?? '', /Files: 3/)
    assert.equal((await decorations.provideFileDecoration(logo, cancellation.token))?.badge, patched ? '\u2063\u20601.5 KB\u2063' : undefined)
    assert.equal(await decorations.provideFileDecoration(vscode.Uri.joinPath(assets, 'nested', 'readme.txt'), cancellation.token), undefined)

    assert.equal(extension.packageJSON.contributes.views, undefined, 'No additional Explorer panel is contributed')
    console.log(`Asset Meter integration: native decorations (patch ${patched ? 'enabled' : 'disabled'}), no extra panel`)

    await config.update('displayMode', 'hover', vscode.ConfigurationTarget.Workspace)
    service.invalidate(undefined, true)
    const hover = await decorations.provideFileDecoration(logo, cancellation.token)
    assert.equal(hover?.badge, patched ? '\u2063\u2060\u20621.5 KB\u2063' : undefined)
    assert.match(hover?.tooltip ?? '', /1.5 KB/)
    assert.equal((await decorations.provideFileDecoration(assets, cancellation.token))?.badge, patched ? '\u2063\u2060\u20623 files · 2.3 KB\u2063' : undefined)

    await config.update('fileColorThresholdsMiB', [0.00025, 0.001, 0.005], vscode.ConfigurationTarget.Workspace)
    service.invalidate(undefined, true)
    assert.equal((await decorations.provideFileDecoration(logo, cancellation.token))?.color, undefined, 'Filenames must keep their original color')
    await config.update('colorize', false, vscode.ConfigurationTarget.Workspace)
    service.invalidate(undefined, true)
    assert.equal((await decorations.provideFileDecoration(logo, cancellation.token))?.color, undefined)

    await config.update('fileCountMode', 'direct', vscode.ConfigurationTarget.Workspace)
    service.invalidate(undefined, true)
    assert.match((await decorations.provideFileDecoration(assets, cancellation.token))?.tooltip ?? '', /Files: 2 \(direct children\)/)
    console.log('Asset Meter integration: hover mode and direct counts')

    // Exercise the activated extension's actual watcher, including ancestors.
    await vscode.workspace.fs.writeFile(logo, new Uint8Array(4096))
    await waitFor(async () => (await api.getSize(assets))?.bytes === 4865)
    console.log('Asset Meter integration: changed file refreshed ancestor')
    const moved = vscode.Uri.joinPath(assets, 'renamed.png')
    await vscode.workspace.fs.rename(logo, moved)
    await waitFor(async () => (await api.getSize(moved))?.bytes === 4096)
    await vscode.workspace.fs.delete(moved)
    await waitFor(async () => (await api.getSize(assets))?.bytes === 769)
    console.log('Asset Meter integration: rename and delete refreshed ancestor')

    await config.update('enabled', false, vscode.ConfigurationTarget.Workspace)
    service.invalidate(undefined, true)
    assert.equal(await decorations.provideFileDecoration(assets, cancellation.token), undefined)
    await vscode.commands.executeCommand('assetMeter.refresh')
    assert.equal(await api.getSize(assets), undefined)
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes('assetMeter.toggleDisplayMode'))
    assert.ok(commands.includes('assetMeter.restoreNativePatch'))
    console.log('Asset Meter: native labels, colors, no extra panel, settings and live filesystem updates passed.')
  }
  finally {
    cancellation.dispose(); decorations.dispose(); service.dispose()
  }
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { if (await condition()) { return } }
    catch (error) {
      // A filesystem event may deliberately cancel an overlapping scan.
      if (!(error instanceof Error) || error.message !== 'Size scan invalidated') { throw error }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.fail('Timed out waiting for filesystem invalidation')
}
