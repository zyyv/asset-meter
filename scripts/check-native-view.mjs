import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* global document, getComputedStyle, setTimeout, fetch */
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.VSCODE_EXECUTABLE_PATH
if (!executable) { throw new Error('VSCODE_EXECUTABLE_PATH must point to a patched, disposable VS Code test installation.') }
const temporary = await mkdtemp(path.join(tmpdir(), 'asset-size-native-ui-'))
const workspace = path.join(temporary, 'asset-size-demo')
const profile = path.join(temporary, 'profile')
let browser
let child
let log = ''
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(action, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode)) { throw new Error(`VS Code exited during UI checks.\n${log}`) }
    try { const result = await action(); if (result) { return result } }
    catch { /* Renderer can be starting or reloading. */ }
    await delay(200)
  }
  throw new Error(`Timed out waiting for native Explorer.\n${log}`)
}
try {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  await mkdir(path.join(workspace, 'assets/images'), { recursive: true })
  await mkdir(path.join(workspace, '.vscode'), { recursive: true })
  await mkdir(path.join(profile, 'User'), { recursive: true })
  await writeFile(path.join(workspace, 'assets/images/hero.png'), Buffer.alloc(6 * 1024 ** 2))
  await writeFile(path.join(workspace, 'assets/images/texture.jpg'), Buffer.alloc(1.5 * 1024 ** 2))
  await writeFile(path.join(workspace, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const settings = {
    'assetSize.folderNames': ['assets', 'images'],
    'assetSize.folderColorThresholdsMiB': [1, 3, 5],
    'assetSize.displayMode': 'always',
    'assetSize.units': 'decimal',
  }
  const settingsFile = path.join(workspace, '.vscode/settings.json')
  await writeFile(settingsFile, JSON.stringify(settings))
  await writeFile(path.join(profile, 'User/settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'telemetry.telemetryLevel': 'off',
    'extensions.autoUpdate': false,
    'chat.disableAIFeatures': true,
    'window.restoreWindows': 'none',
    'security.workspace.trust.enabled': false,
  }))
  child = spawn(executable, [workspace, '--user-data-dir', profile, '--extensions-dir', path.join(temporary, 'extensions'), `--extensionDevelopmentPath=${root}`, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--no-sandbox', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const capture = (data) => { log = (log + data.toString()).slice(-20_000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.on('error', (error) => { log += error.message })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = await waitFor(async () => browser.contexts()[0]?.pages().find(candidate => /workbench.*html/.test(candidate.url())))
  const prefix = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${prefix}+Shift+E`)
  const asset = page.locator('.explorer-folders-view .explorer-item').filter({ hasText: /^assets$/ }).first()
  await asset.waitFor({ state: 'visible', timeout: 30_000 })
  await waitFor(() => asset.evaluate((element) => {
    const container = element.querySelector('.monaco-icon-label-container')
    return container && getComputedStyle(container, '::after').content.includes('3 files')
  }))
  assert.match(await asset.evaluate(element => getComputedStyle(element, '::after').content), /7\.9 MB/)
  assert.equal(await page.locator('[id="assetSize.explorer"]').count(), 0, 'No Asset Size panel')
  const assetRow = asset.locator('xpath=ancestor::*[contains(@class,"monaco-list-row")][1]')
  await assetRow.locator('.monaco-tl-twistie').click()
  const images = page.locator('.explorer-folders-view .explorer-item').filter({ hasText: /^images$/ }).first()
  await images.waitFor({ state: 'visible' })
  const imagesRow = images.locator('xpath=ancestor::*[contains(@class,"monaco-list-row")][1]')
  await imagesRow.locator('.monaco-tl-twistie').click()
  const hero = page.locator('.explorer-folders-view .explorer-item').filter({ hasText: /^hero\.png$/ }).first()
  await hero.waitFor({ state: 'visible' })
  await waitFor(() => hero.evaluate(element => getComputedStyle(element, '::after').content.includes('6.3 MB')))
  await page.keyboard.press(`${prefix}+1`)
  const colors = await hero.evaluate((element) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--vscode-assetSize-sizeCritical)'
    element.append(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    const label = element.querySelector('.label-name') ?? element
    return { actual: getComputedStyle(element, '::after').color, name: getComputedStyle(label).color, expected }
  })
  assert.equal(colors.actual, colors.expected, 'Large resource has the critical red color')
  assert.notEqual(colors.name, colors.expected, 'Severity does not color the filename')
  const overflowing = await hero.evaluate((element) => {
    const label = element.querySelector('.monaco-icon-label-container')
    return label && label.getBoundingClientRect().right > element.getBoundingClientRect().right
  })
  assert.equal(overflowing, false)
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  await page.locator('.part.sidebar').screenshot({ path: path.join(root, 'artifacts/native-explorer-preview.png') })

  await writeFile(settingsFile, JSON.stringify({ ...settings, 'assetSize.displayMode': 'hover' }))
  await waitFor(() => hero.evaluate(element => !getComputedStyle(element, '::after').content.includes('6.3 MB')))
  await hero.hover()
  await page.locator('.monaco-hover').filter({ hasText: '6.3 MB' }).first().waitFor({ state: 'visible', timeout: 10_000 })
  assert.doesNotMatch(log, /The 'badge'-property must be undefined|Error from file decoration provider/)
  console.log('Native Explorer UI passed: full size, file count, red severity, expansion, hover mode, no extra panel.')
}
finally {
  if (browser) { await browser.close() }
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
  }
  await rm(temporary, { recursive: true, force: true })
}
