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
const temporary = await mkdtemp(path.join(tmpdir(), 'asset-size-compression-ui-'))
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
  }))
  child = spawn(executable, [workspace, '--user-data-dir', profile, '--extensions-dir', path.join(temporary, 'extensions'), `--extensionDevelopmentPath=${root}`, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--no-sandbox', `--remote-debugging-port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  const capture = (data) => { log = (log + data.toString()).slice(-15_000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.on('error', (error) => { log += error.message })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 'CDP')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = await waitFor(() => browser.contexts()[0]?.pages().find(candidate => /workbench.*html/.test(candidate.url())), 'workbench')
  await page.locator('.monaco-workbench').waitFor({ state: 'visible' })
  const originalPng = await readFile(path.join(workspace, 'sample.png'))
  const quickInput = () => page.locator('.quick-input-widget input').first()
  async function openImage(name) {
    await page.locator('.explorer-folders-view .explorer-item').filter({ hasText: new RegExp(`^${name.replaceAll('.', '\\.')}\\b`) }).first().dblclick()
    await page.locator('.editor-actions .action-label[aria-label*="Compress Image"]').first().waitFor({ state: 'visible' })
    await page.locator('.editor-actions .action-label[aria-label*="Compress Image"]').first().click()
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
  let frame = await openImage('sample.png')
  await waitFor(() => frame.locator('.pair img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 256 && image.naturalHeight === 160)), 'decoded comparison images')
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
  console.log('Compression UI: preview toolbar icon, lossless PNG/alpha, diff modes, zoom and cancellation passed.')

  await chooseSave(frame, 'Save As — Allow Once')
  await waitFor(() => quickInput().isVisible(), 'Save As path dialog')
  const destination = path.join(workspace, 'sample.compressed.png')
  await quickInput().fill(destination)
  await page.keyboard.press('Enter')
  await waitFor(async () => (await readFile(destination)).length < originalPng.length, 'saved new image')
  await waitFor(async () => (await frame.locator('#status').textContent()).startsWith('Saved:'), 'saved status')
  assert.deepEqual(await readFile(path.join(workspace, 'sample.png')), originalPng)
  assert.equal(JSON.parse(await readFile(userSettings, 'utf8'))['assetSize.compression.saveBehavior'], undefined)
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

  frame = await openImage('sample.jpg')
  await waitFor(() => frame.locator('.pair img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 256)), 'JPEG comparison')
  await chooseSave(frame, 'Overwrite Original — Always Allow')
  await waitFor(async () => (await frame.locator('#status').textContent()).startsWith('Saved:'), 'JPEG overwritten')
  await waitFor(async () => JSON.parse(await readFile(userSettings, 'utf8'))['assetSize.compression.saveBehavior'] === 'overwrite', 'remembered User setting')
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
