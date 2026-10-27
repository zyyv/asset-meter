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
  const svgFixture = path.join(temporary, 'extensions', 'asset-meter-svg-fixture')
  await mkdir(svgFixture, { recursive: true })
  await writeFile(path.join(svgFixture, 'package.json'), JSON.stringify({
    name: 'asset-meter-svg-fixture',
    publisher: 'test',
    version: '1.0.0',
    engines: { vscode: '^1.90.0' },
    main: './extension.js',
    contributes: { commands: [{ command: 'assetMeterTest.editSvg', title: 'Asset Meter Test: Edit SVG' }] },
  }))
  await writeFile(path.join(svgFixture, 'extension.js'), `
    const vscode = require('vscode')
    exports.activate = (context) => {
      context.subscriptions.push(vscode.commands.registerCommand('assetMeterTest.editSvg', async () => {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'assets', 'logo.svg')
        const document = await vscode.workspace.openTextDocument(uri)
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), document.getText().replace('#f5b942', '#42b9f5'))
        await vscode.workspace.applyEdit(edit)
      }))
    }
  `)
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
    'workbench.editorAssociations': { '*.svg': 'imagePreview.previewEditor' },
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
  child = spawn(executable, [workspace, '--user-data-dir', profile, '--extensions-dir', path.join(temporary, 'extensions'), `--extensionDevelopmentPath=${root}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--no-sandbox', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const capture = (data) => { log = (log + data.toString()).slice(-20_000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.on('error', (error) => { log += error.message })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = await waitFor(async () => browser.contexts()[0]?.pages().find(candidate => /workbench.*html/.test(candidate.url())))
  const prefix = process.platform === 'darwin' ? 'Meta' : 'Control'
  const command = async (title) => {
    await page.keyboard.press('F1')
    const input = page.locator('.quick-input-widget input').first()
    await input.fill(`>${title}`)
    await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: title }).first().click()
    await input.waitFor({ state: 'hidden' })
  }
  await page.keyboard.press(`${prefix}+Shift+E`)
  const header = page.locator('.pane-header').filter({ hasText: /^Asset Meter$/i })
  await header.waitFor({ state: 'visible' })
  if (await header.getAttribute('aria-expanded') === 'false') { await header.click() }
  const pane = header.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " pane ")][1]')
  const view = pane.locator('.pane-body')
  await view.waitFor({ state: 'visible' })
  const explorerHeader = page.locator('.pane-header').filter({ hasText: /^workspace$/i })
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
  // Exercise SVG modes in the real editor, including unsaved native text edits.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><circle cx="80" cy="80" r="64" fill="#f5b942"/></svg>'
  await writeFile(path.join(workspace, 'assets/logo.svg'), svg)
  const groups = page.locator('.editor-group-container')
  const source = page.locator('.editor-group-container .monaco-editor[data-uri$="/assets/logo.svg"]')
  const image = async () => waitFor(async () => {
    for (const frame of page.frames()) {
      const candidate = frame.locator('img[src^="data:image/svg+xml;base64,"]')
      if (await candidate.count()) { return candidate }
    }
  })
  await name('logo.svg').click()
  await source.waitFor({ state: 'visible' })
  let svgImage = await image()
  await waitFor(async () => await svgImage.evaluate(element => element.complete && element.naturalWidth > 0))
  assert.equal(await groups.count(), 2, 'Both is the default and opens two editor groups')
  assert.equal(Buffer.from((await svgImage.getAttribute('src')).split(',')[1], 'base64').toString(), svg)
  const editedSvg = svg.replace('#f5b942', '#42b9f5')
  await command('Asset Meter Test: Edit SVG')
  await waitFor(async () => {
    svgImage = await image()
    return Buffer.from((await svgImage.getAttribute('src')).split(',')[1], 'base64').toString() === editedSvg
  })
  await page.screenshot({ path: path.join(root, 'artifacts/svg-both-preview.png') })
  await command('File: Save All')
  settings['assetMeter.svgOpenMode'] = 'image'
  await writeFile(settingsFile, JSON.stringify(settings))
  await waitFor(async () => await groups.count() === 1 && !(await source.isVisible()))
  await image()
  settings['assetMeter.svgOpenMode'] = 'code'
  await writeFile(settingsFile, JSON.stringify(settings))
  await source.waitFor({ state: 'visible' })
  await waitFor(async () => await groups.count() === 1)
  settings['assetMeter.svgOpenMode'] = 'both'
  await writeFile(settingsFile, JSON.stringify(settings))
  await image()
  await waitFor(async () => await groups.count() === 2)
  // Opening the next SVG while the image group is focused must reuse the pane.
  await writeFile(path.join(workspace, 'assets/other.SVG'), svg.replace('#f5b942', '#b942f5'))
  await page.locator('.editor-group-container .tab').filter({ hasText: 'Preview: logo.svg' }).click()
  await waitFor(async () => {
    await expand('assets')
    return name('other.SVG').isVisible()
  })
  await name('other.SVG').click()
  await image()
  await waitFor(async () => (await page.locator('.editor-group-container .monaco-editor[data-uri$="/assets/other.SVG"]').count()) === 1)
  assert.equal(await groups.count(), 2, 'switching SVGs reuses the preview group')
  // The original Explorer uses the same behavior through native text opening.
  await command('View: Close All Editors')
  await waitFor(async () => await groups.count() === 1)
  if (await explorerHeader.getAttribute('aria-expanded') !== 'true') { await explorerHeader.click() }
  const explorer = page.locator('.explorer-folders-view')
  const nativeAssets = explorer.locator('.label-name').filter({ hasText: /^assets$/ }).locator('xpath=ancestor::*[contains(@class,"monaco-list-row")][1]')
  if (await nativeAssets.getAttribute('aria-expanded') !== 'true') { await nativeAssets.locator('.monaco-tl-twistie').click() }
  await explorer.locator('.label-name').filter({ hasText: /^logo\.svg$/ }).click()
  await source.waitFor({ state: 'visible' })
  await image()
  assert.equal(await groups.count(), 2, 'native Explorer also opens source and image')
  console.log('SVG UI passed: default Both, live unsaved edits, Image / Code mode changes, uppercase SVGs, pane reuse and native Explorer clicks.')
  await explorerHeader.click()
  settings['assetMeter.include'] = []
  await writeFile(settingsFile, JSON.stringify(settings))
  await view.getByText('No matching files or folders.', { exact: false }).waitFor({ state: 'visible' })
  await view.getByRole('button', { name: 'Open Asset Meter Settings' }).press('Enter')
  await page.locator('.settings-editor').waitFor({ state: 'visible' })
  assert.doesNotMatch(log, /Error from file decoration provider|No tree view with id/)
  console.log('Asset tree UI passed: filtered hierarchy, full metrics with decoration badges disabled, theme icons, context actions, automatic updates, refresh, collapse, empty state and settings.')
}
catch (error) {
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  if (page) {
    await page.screenshot({ path: path.join(root, 'artifacts/asset-tree-ui-failure.png') }).catch(() => {})
    console.error(await page.locator('.part.sidebar .pane-header, .part.sidebar .label-name, .part.sidebar .welcome').allTextContents().catch(() => []))
    console.error('Editor text:', await page.locator('.editor-group-container .view-lines').allTextContents().catch(() => []))
    for (const frame of page.frames()) {
      const sources = await frame.locator('img[src^="data:image/svg+xml;base64,"]').evaluateAll(elements => elements.map(element => element.getAttribute('src'))).catch(() => [])
      for (const src of sources) { console.error('SVG preview source:', Buffer.from(src.split(',')[1], 'base64').toString()) }
    }
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
