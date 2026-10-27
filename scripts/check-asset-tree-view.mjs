import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* global setTimeout, fetch */
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.VSCODE_EXECUTABLE_PATH
if (!executable) { throw new Error('VSCODE_EXECUTABLE_PATH must point to a VS Code test installation. No native patch is required.') }
const temporary = await mkdtemp(path.join(tmpdir(), 'asset-meter-tree-ui-'))
const workspace = path.join(temporary, 'workspace')
const profile = path.join(temporary, 'profile')
let browser
let child
let page
let log = ''
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(action, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode)) { throw new Error(`VS Code exited during asset tree checks.\n${log}`) }
    try { const result = await action(); if (result) { return result } }
    catch { /* The workbench can be starting or refreshing. */ }
    await delay(200)
  }
  throw new Error(`Timed out waiting for the Asset Meter tree.\n${log}`)
}
try {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  await mkdir(path.join(workspace, 'assets/images'), { recursive: true })
  await mkdir(path.join(workspace, 'docs'), { recursive: true })
  await mkdir(path.join(workspace, '.vscode'), { recursive: true })
  await mkdir(path.join(profile, 'User'), { recursive: true })
  await writeFile(path.join(workspace, 'assets/images/hero.png'), Buffer.alloc(1536))
  await writeFile(path.join(workspace, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(path.join(workspace, 'assets/notes.txt'), 'notes')
  await writeFile(path.join(workspace, 'docs/readme.txt'), 'unrelated')
  const settings = {
    'assetMeter.include': ['**/*.{png,svg}', '**/assets'],
    'assetMeter.exclude': ['**/node_modules/**'],
    'assetMeter.units': 'decimal',
    'assetMeter.displayMode': 'hover',
    'assetMeter.refreshDelay': 100,
  }
  const settingsFile = path.join(workspace, '.vscode/settings.json')
  await writeFile(settingsFile, JSON.stringify(settings))
  await writeFile(path.join(profile, 'User/settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'workbench.iconTheme': 'vs-seti',
    'explorer.decorations.badges': false,
    'telemetry.telemetryLevel': 'off',
    'extensions.autoUpdate': false,
    'chat.disableAIFeatures': true,
    'window.restoreWindows': 'none',
    'window.menuStyle': 'custom',
    'security.workspace.trust.enabled': false,
  }))
  child = spawn(executable, [workspace, '--user-data-dir', profile, '--extensions-dir', path.join(temporary, 'extensions'), `--extensionDevelopmentPath=${root}`, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--no-sandbox', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const capture = (data) => { log = (log + data.toString()).slice(-20_000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.on('error', (error) => { log += error.message })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = await waitFor(async () => browser.contexts()[0]?.pages().find(candidate => /workbench.*html/.test(candidate.url())))
  const prefix = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${prefix}+Shift+E`)
  const header = page.locator('.pane-header').filter({ hasText: /^Asset Meter$/i })
  await header.waitFor({ state: 'visible' })
  if (await header.getAttribute('aria-expanded') === 'false') { await header.click() }
  const pane = header.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " pane ")][1]')
  const view = pane.locator('.pane-body')
  await view.waitFor({ state: 'visible' })
  const explorerHeader = page.locator('.explorer-folders-view').locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " pane ")][1]').locator('.pane-header')
  if (await explorerHeader.getAttribute('aria-expanded') === 'true') { await explorerHeader.click() }
  const name = value => view.locator('.label-name').filter({ hasText: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
  const row = value => name(value).locator('xpath=ancestor::*[contains(@class,"monaco-list-row")][1]')
  const expand = async (value) => {
    if (await row(value).getAttribute('aria-expanded') !== 'true') { await row(value).locator('.monaco-tl-twistie').click() }
  }
  await name('assets').waitFor({ state: 'visible' })
  await waitFor(async () => (await row('assets').locator('.label-description').textContent()) === '3 files · 1.6 KB')
  await expand('assets')
  await name('images').waitFor({ state: 'visible' })
  await expand('images')
  await name('hero.png').waitFor({ state: 'visible' })
  assert.equal(await row('hero.png').locator('.label-description').textContent(), '1.5 KB', 'full sizes remain visible in hover display mode')
  if (process.env.ASSET_METER_EXPECT_RIGHT_ALIGNED === '1') {
    const positions = []
    for (const value of ['assets', 'images', 'hero.png']) {
      const position = await row(value).evaluate((element) => {
        const label = element.querySelector('.custom-view-tree-node-item-resourceLabel').getBoundingClientRect()
        const filename = element.querySelector('.monaco-icon-name-container').getBoundingClientRect()
        const statistics = element.querySelector('.monaco-icon-description-container').getBoundingClientRect()
        return { labelRight: label.right, filenameRight: filename.right, statisticsLeft: statistics.left, statisticsRight: statistics.right }
      })
      assert.ok(Math.abs(position.labelRight - position.statisticsRight) <= 1, `${value}: statistics align with the right edge of the row`)
      assert.ok(position.filenameRight <= position.statisticsLeft + 1, `${value}: the filename does not overlap statistics`)
      positions.push(position.statisticsRight)
    }
    assert.ok(Math.max(...positions) - Math.min(...positions) <= 1, 'statistics share one right edge across tree depths')
  }
  assert.equal(await name('notes.txt').count(), 0)
  assert.equal(await name('docs').count(), 0)
  assert.ok(await row('hero.png').locator('.file-icon').count(), 'file icon theme is used')
  await name('hero.png').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Compress Image/ }).waitFor({ state: 'visible' })
  await page.getByRole('menuitem', { name: /Reveal in Explorer/ }).waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await writeFile(path.join(workspace, 'assets/added.png'), Buffer.alloc(64))
  await name('added.png').waitFor({ state: 'visible' })
  await rm(path.join(workspace, 'assets/added.png'))
  await name('added.png').waitFor({ state: 'detached' })
  await pane.locator('.pane-header').hover()
  await pane.getByRole('button', { name: /Refresh Sizes/ }).click()
  await name('hero.png').waitFor({ state: 'visible' })
  await pane.getByRole('button', { name: /Collapse All/ }).click()
  await name('hero.png').waitFor({ state: 'detached' })
  await expand('assets')
  await expand('images')
  await name('hero.png').waitFor({ state: 'visible' })
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  await page.locator('.part.sidebar').screenshot({ path: path.join(root, 'artifacts/asset-tree-preview.png') })
  settings['assetMeter.include'] = []
  await writeFile(settingsFile, JSON.stringify(settings))
  await view.getByText('No matching files or folders.', { exact: false }).waitFor({ state: 'visible' })
  await view.getByRole('button', { name: 'Open Asset Meter Settings' }).click()
  await page.getByRole('textbox', { name: /Search settings/i }).waitFor({ state: 'visible' })
  assert.doesNotMatch(log, /Error from file decoration provider|No tree view with id/)
  console.log('Asset tree UI passed: filtered hierarchy, full metrics with decoration badges disabled, theme icons, context actions, automatic updates, refresh, collapse, empty state and settings.')
}
catch (error) {
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  if (page) {
    await page.screenshot({ path: path.join(root, 'artifacts/asset-tree-ui-failure.png') }).catch(() => {})
    console.error(await page.locator('.part.sidebar .pane-header, .part.sidebar .label-name, .part.sidebar .welcome').allTextContents().catch(() => []))
  }
  console.error(log)
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
