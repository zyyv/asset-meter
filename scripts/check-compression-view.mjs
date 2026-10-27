import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* global document, setTimeout, fetch */
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.VSCODE_EXECUTABLE_PATH
if (!executable) { throw new Error('Set VSCODE_EXECUTABLE_PATH to a VS Code executable. This check uses a temporary workspace and profile.') }
const temporary = await mkdtemp(path.join(tmpdir(), 'asset-meter-compression-ui-'))
const workspace = path.join(temporary, 'workspace')
const profile = path.join(temporary, 'profile')
let child
let browser
let page
let log = ''
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(action, description, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode)) { throw new Error(`VS Code exited: ${log}`) }
    try { const result = await action(); if (result) { return result } }
    catch { /* The webview can be starting. */ }
    await delay(200)
  }
  throw new Error(`Timed out: ${description}\n${log}`)
}

try {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  await mkdir(path.join(workspace, '.vscode'), { recursive: true })
  await mkdir(path.join(profile, 'User'), { recursive: true })
  const errorFixture = path.join(temporary, 'extensions', 'asset-meter-error-fixture')
  await mkdir(errorFixture, { recursive: true })
  await writeFile(path.join(errorFixture, 'package.json'), JSON.stringify({
    name: 'asset-meter-error-fixture',
    publisher: 'test',
    version: '1.0.0',
    engines: { vscode: '^1.90.0' },
    main: './extension.js',
    activationEvents: ['*'],
    extensionDependencies: ['zyyv.asset-meter'],
  }))
  await writeFile(path.join(errorFixture, 'extension.js'), `
    const vscode = require('vscode')
    exports.activate = async (context) => {
      const api = await vscode.extensions.getExtension('zyyv.asset-meter').activate()
      const metadata = { description: 'Local error fixture; no network requests', describe: () => 'Test result' }
      context.subscriptions.push(api.registerCompressionPlugin({
        ...metadata, id: 'failed-api-test', label: 'Failed API (Test)', formats: ['png'],
        compress: () => ({ result: Promise.reject(new Error('TinyPNG request failed (HTTP 503). Try again later or use jSquash.')), cancel() {} }),
      }))
      context.subscriptions.push(api.registerCompressionPlugin({
        ...metadata, id: 'broken-output-test', label: 'Broken Output (Test)', formats: ['jpeg'],
        compress: () => ({ result: Promise.resolve(Buffer.from('ffd8ffc00008080001000101', 'hex')), cancel() {} }),
      }))
    }
  `)
  for (const name of ['sample.png', 'sample.jpg', 'sample.webp']) {
    await copyFile(path.join(root, 'test/fixtures', name), path.join(workspace, name))
  }
  const userSettings = path.join(profile, 'User/settings.json')
  await writeFile(userSettings, JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'telemetry.telemetryLevel': 'off',
    'extensions.autoUpdate': false,
    'chat.disableAIFeatures': true,
    'window.restoreWindows': 'none',
    'security.workspace.trust.enabled': false,
    'files.simpleDialog.enable': true,
    'workbench.editorAssociations': {
      '*.png': 'imagePreview.previewEditor',
      '*.jpg': 'imagePreview.previewEditor',
      '*.webp': 'imagePreview.previewEditor',
    },
  }))
  // The isolated extensions directory excludes user extensions; keep built-in image previews enabled.
  child = spawn(executable, [workspace, '--user-data-dir', profile, '--extensions-dir', path.join(temporary, 'extensions'), `--extensionDevelopmentPath=${root}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--no-sandbox', `--remote-debugging-port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  const capture = (data) => { log = (log + data.toString()).slice(-15_000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.on('error', (error) => { log += error.message })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 'CDP')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = await waitFor(() => browser.contexts()[0]?.pages().find(candidate => /workbench.*html/.test(candidate.url())), 'workbench')
  await page.locator('.monaco-workbench').waitFor({ state: 'visible' })
  const originalPng = await readFile(path.join(workspace, 'sample.png'))
  const quickInput = () => page.locator('.quick-input-widget input').first()
  async function chooseCompression(name, plugin = 'jSquash') {
    await page.locator('.explorer-folders-view .explorer-item').filter({ hasText: new RegExp(`^${name.replaceAll('.', '\\.')}\\b`) }).first().dblclick()
    await page.locator('.editor-actions .action-label[aria-label*="Compress Image"]').first().waitFor({ state: 'visible' })
    await page.locator('.editor-actions .action-label[aria-label*="Compress Image"]').first().click()
    await page.getByText(plugin, { exact: true }).last().click()
  }
  async function openImage(name, plugin = 'jSquash') {
    await chooseCompression(name, plugin)
    return waitFor(async () => {
      for (const frame of page.frames()) {
        if (await frame.locator('#save').count()) { return frame }
      }
    }, 'compression comparison webview')
  }
  async function discard(frame) {
    await frame.locator('#discard').click()
    await waitFor(() => frame.isDetached(), 'comparison closed')
  }
  async function chooseSave(frame, label) {
    await frame.locator('#save').click()
    await page.getByText(label, { exact: true }).last().click()
  }
  await chooseCompression('sample.png', 'Failed API (Test)')
  await page.getByText('Asset Meter compression failed: TinyPNG request failed (HTTP 503). Try again later or use jSquash.', { exact: true }).last().waitFor()
  assert.deepEqual(await readFile(path.join(workspace, 'sample.png')), originalPng)
  let frame = await openImage('sample.png')
  await waitFor(() => frame.locator('.pair img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 256 && image.naturalHeight === 160)), 'decoded comparison images')
  await waitFor(() => frame.locator('#save').isEnabled(), 'save enabled after successful decoding')
  assert.equal(await frame.locator('#save').isEnabled(), true)
  const pixelsMatch = await frame.locator('.pair img').evaluateAll((images) => {
    const pixels = images.map((image) => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    })
    return pixels[0].every((value, index) => value === pixels[1][index])
  })
  assert.equal(pixelsMatch, true, 'PNG pixels and transparency are unchanged')
  assert.equal(await frame.locator('#plugin').inputValue(), 'jsquash')
  const successfulResult = await frame.locator('body').getAttribute('data-result-id')
  const successfulImage = await frame.locator('.pair img').last().getAttribute('src')
  await frame.locator('#plugin').selectOption('failed-api-test')
  await frame.locator('#recompress').click()
  await waitFor(async () => (await frame.locator('#status').textContent()).includes('HTTP 503'), 'failed API feedback')
  assert.equal(await frame.locator('#plugin').inputValue(), 'jsquash')
  assert.equal(await frame.locator('body').getAttribute('data-result-id'), successfulResult)
  assert.equal(await frame.locator('.pair img').last().getAttribute('src'), successfulImage)
  assert.equal(await frame.locator('#save').isEnabled(), true)
  assert.equal(await frame.locator('#recompress').isEnabled(), true)
  assert.deepEqual(await readFile(path.join(workspace, 'sample.png')), originalPng)
  await frame.locator('#plugin').selectOption('tinypng')
  assert.match(await frame.locator('#plugin-description').textContent(), /uploads images/)
  assert.equal(await frame.locator('#save').isEnabled(), false, 'Changing plugin requires compression before saving')
  await frame.locator('#recompress').click()
  await waitFor(async () => (await frame.locator('#status').textContent()).includes('tinypng.apiKey'), 'missing API key feedback')
  assert.equal(await frame.locator('#plugin').inputValue(), 'jsquash', 'Failed compression restores the plugin of the visible result')
  assert.equal(await frame.locator('#save').isEnabled(), true)
  const resultId = await frame.locator('body').getAttribute('data-result-id')
  await frame.locator('#recompress').click()
  frame = await waitFor(async () => {
    for (const candidate of page.frames()) {
      if (await candidate.locator('#save').count() && (await candidate.locator('body').getAttribute('data-result-id')) !== resultId) { return candidate }
    }
  }, 'recompressed comparison')
  await waitFor(() => frame.locator('.pair img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 256)), 'recompressed images decoded')
  await frame.locator('#mode').selectOption('slider')
  await frame.locator('#split').fill('25')
  assert.match(await frame.locator('#after-overlay').getAttribute('style'), /25%/)
  await frame.locator('#mode').selectOption('pair')
  await frame.locator('#zoom').selectOption('actual')
  assert.match(await frame.locator('body').getAttribute('class'), /actual/)
  await frame.locator('#zoom').selectOption('fit')
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'artifacts/image-compression-preview.png') })

  await frame.locator('#save').click()
  await page.getByText('Overwrite Original — Allow Once', { exact: true }).last().waitFor()
  await page.keyboard.press('Escape')
  await waitFor(() => frame.locator('#save').isEnabled(), 'cancelled save returns to comparison')
  assert.deepEqual(await readFile(path.join(workspace, 'sample.png')), originalPng)
  console.log('Compression UI: plugin selection, missing API key, recompression, lossless PNG/alpha, diff modes, zoom and cancellation passed.')

  await chooseSave(frame, 'Save As — Allow Once')
  await waitFor(() => quickInput().isVisible(), 'Save As path dialog')
  const destination = path.join(workspace, 'sample.compressed.png')
  await quickInput().fill(destination)
  await page.keyboard.press('Enter')
  await waitFor(async () => (await readFile(destination)).length < originalPng.length, 'saved new image')
  await waitFor(async () => (await frame.locator('#status').textContent()).startsWith('Saved:'), 'saved status')
  assert.deepEqual(await readFile(path.join(workspace, 'sample.png')), originalPng)
  assert.equal(JSON.parse(await readFile(userSettings, 'utf8'))['assetMeter.compression.saveBehavior'], undefined)
  await discard(frame)
  console.log('Compression UI: Save As Once creates a smaller copy and does not remember permission.')

  frame = await openImage('sample.png')
  const changed = new Uint8Array([...originalPng, 0])
  await writeFile(path.join(workspace, 'sample.png'), changed)
  await chooseSave(frame, 'Overwrite Original — Allow Once')
  await waitFor(async () => (await frame.locator('#status').textContent()).includes('changed after compression'), 'stale original rejected')
  assert.deepEqual(new Uint8Array(await readFile(path.join(workspace, 'sample.png'))), changed)
  await discard(frame)
  await writeFile(path.join(workspace, 'sample.png'), originalPng)
  console.log('Compression UI: stale original is protected from overwrite.')

  const originalJpeg = await readFile(path.join(workspace, 'sample.jpg'))
  frame = await openImage('sample.jpg', 'Broken Output (Test)')
  await waitFor(async () => (await frame.locator('#status').textContent()).includes('could not be decoded'), 'broken output rejected after decoding')
  assert.equal(await frame.locator('#save').isEnabled(), false)
  assert.equal(await frame.locator('#recompress').isEnabled(), true)
  assert.deepEqual(await readFile(path.join(workspace, 'sample.jpg')), originalJpeg)
  const brokenResult = await frame.locator('body').getAttribute('data-result-id')
  await frame.locator('#plugin').selectOption('jsquash')
  await frame.locator('#recompress').click()
  frame = await waitFor(async () => {
    for (const candidate of page.frames()) {
      if (await candidate.locator('#save').count() && (await candidate.locator('body').getAttribute('data-result-id')) !== brokenResult) { return candidate }
    }
  }, 'successful retry after broken output')
  await waitFor(() => frame.locator('#save').isEnabled(), 'save available after a valid retry')
  await discard(frame)
  console.log('Compression UI: failed API calls retain the original and previous result; undecodable output cannot be saved and a valid retry recovers.')

  frame = await openImage('sample.jpg')
  await waitFor(() => frame.locator('.pair img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 256)), 'JPEG comparison')
  await chooseSave(frame, 'Overwrite Original — Always Allow')
  await waitFor(async () => (await frame.locator('#status').textContent()).startsWith('Saved:'), 'JPEG overwritten')
  await waitFor(async () => JSON.parse(await readFile(userSettings, 'utf8'))['assetMeter.compression.saveBehavior'] === 'overwrite', 'remembered User setting')
  await page.locator('.explorer-folders-view .explorer-item').filter({ hasText: /^sample\.png\b/ }).first().dblclick()
  await page.getByRole('tab', { name: /Compress: sample.jpg/ }).first().click()
  frame = await waitFor(async () => {
    for (const candidate of page.frames()) {
      if (await candidate.locator('#save').count()) { return candidate }
    }
  }, 'comparison restored after tab switch')
  await waitFor(async () => (await frame.locator('#status').textContent()).startsWith('Saved:'), 'saved state restored')
  assert.equal(await frame.locator('#save').isEnabled(), false)
  await discard(frame)
  frame = await openImage('sample.webp')
  await waitFor(() => frame.locator('.pair img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 256)), 'WebP comparison')
  const beforeWebp = await readFile(path.join(workspace, 'sample.webp'))
  assert.ok(beforeWebp.length > 0, 'Always Allow still waits at the comparison')
  await frame.locator('#save').click()
  await waitFor(async () => (await frame.locator('#status').textContent()).startsWith('Saved:'), 'remembered overwrite')
  assert.ok((await readFile(path.join(workspace, 'sample.webp'))).length < beforeWebp.length)
  assert.equal(await page.locator('.quick-input-widget').isVisible(), false, 'Remembered permission skips the save question')
  await discard(frame)
  console.log('Compression UI: JPEG/WebP, Always Allow persistence and explicit save after comparison passed.')
}
catch (error) {
  if (page) {
    await mkdir(path.join(root, 'artifacts'), { recursive: true })
    await page.screenshot({ path: path.join(root, 'artifacts/image-compression-failure.png') }).catch(() => {})
    console.error((await page.locator('body').textContent().catch(() => '')).slice(-6000))
  }
  throw error
}
finally {
  if (browser) { await browser.close() }
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
  }
  await rm(temporary, { recursive: true, force: true })
}
