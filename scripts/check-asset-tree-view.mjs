import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'
/* global setTimeout, fetch */
import { chromium } from 'playwright'
import { inspectHoverRows } from './ui/hover-layout.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.VSCODE_EXECUTABLE_PATH
if (!executable) { throw new Error('VSCODE_EXECUTABLE_PATH must point to a VS Code test installation. No native patch is required.') }
const temporary = await mkdtemp(path.join(tmpdir(), 'asset-meter-tree-ui-'))
const workspace = path.join(temporary, 'workspace')
const profile = path.join(temporary, 'profile')
let browser
let child
let page
let command
let clipboardSaved = false
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
  const clipboardReport = path.join(temporary, 'clipboard.json')
  const imageReport = path.join(temporary, 'clipboard-image.json')
  await mkdir(svgFixture, { recursive: true })
  await writeFile(path.join(svgFixture, 'package.json'), JSON.stringify({
    name: 'asset-meter-svg-fixture',
    publisher: 'test',
    version: '1.0.0',
    engines: { vscode: '^1.90.0' },
    main: './extension.js',
    contributes: { commands: [
      { command: 'assetMeterTest.editSvg', title: 'Asset Meter Test: Edit SVG' },
      { command: 'assetMeterTest.reportClipboard', title: 'Asset Meter Test: Report Clipboard' },
      { command: 'assetMeterTest.restoreClipboard', title: 'Asset Meter Test: Restore Clipboard' },
      { command: 'assetMeterTest.inspectImageClipboard', title: 'Asset Meter Test: Inspect Image Clipboard' },
    ] },
  }))
  await writeFile(path.join(svgFixture, 'extension.js'), `
    const vscode = require('vscode')
    exports.activate = async (context) => {
      const originalClipboard = await vscode.env.clipboard.readText()
      context.subscriptions.push(vscode.commands.registerCommand('assetMeterTest.reportClipboard', async () => {
        await require('node:fs/promises').writeFile(${JSON.stringify(clipboardReport)}, JSON.stringify({
          text: await vscode.env.clipboard.readText(),
          type: vscode.workspace.getConfiguration('assetMeter').get('copyType'),
          openMode: vscode.workspace.getConfiguration('workbench').get('list.openMode'),
        }))
      }))
      context.subscriptions.push(vscode.commands.registerCommand('assetMeterTest.restoreClipboard', () => vscode.env.clipboard.writeText(originalClipboard)))
      context.subscriptions.push(vscode.commands.registerCommand('assetMeterTest.inspectImageClipboard', () => {
        const panel = vscode.window.createWebviewPanel('assetMeterTest.clipboard', 'Test image paste', vscode.ViewColumn.Active, { enableScripts: true })
        panel.webview.onDidReceiveMessage(async (message) => {
          await require('node:fs/promises').writeFile(${JSON.stringify(imageReport)}, JSON.stringify(message))
          panel.dispose()
        })
        panel.webview.html = \`<!DOCTYPE html><html><body><div id="paste" contenteditable="true" tabindex="0">Paste image here</div><script>
          const vscode = acquireVsCodeApi()
          document.addEventListener('paste', async (event) => {
            event.preventDefault()
            try {
              const file = Array.from(event.clipboardData.files).find(file => file.type.startsWith('image/'))
              if (!file) { throw new Error('No image in clipboard') }
              const bitmap = await createImageBitmap(file)
              const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
              const context = canvas.getContext('2d')
              context.drawImage(bitmap, 0, 0)
              vscode.postMessage({ type: file.type, width: bitmap.width, height: bitmap.height, pixel: Array.from(context.getImageData(0, 0, 1, 1).data) })
            } catch (error) { vscode.postMessage({ error: String(error) }) }
          })
        <\/script></body></html>\`
      }))
      context.subscriptions.push(vscode.commands.registerCommand('assetMeterTest.editSvg', async () => {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'assets', 'logo.svg')
        const document = await vscode.workspace.openTextDocument(uri)
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), document.getText().replace('#f5b942', '#42b9f5'))
        await vscode.workspace.applyEdit(edit)
      }))
    }
  `)
  const hero = Buffer.alloc(1536)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  const text = Buffer.from('Author\0Asset Meter UI')
  const metadata = Buffer.alloc(text.length + 12)
  metadata.writeUInt32BE(text.length); metadata.write('tEXt', 4); text.copy(metadata, 8)
  metadata.writeUInt32BE(crc32(metadata.subarray(4, -4)), metadata.length - 4)
  Buffer.concat([png.subarray(0, -12), metadata, png.subarray(-12)]).copy(hero)
  await writeFile(path.join(workspace, 'assets/images/hero.png'), hero)
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><circle cx="80" cy="80" r="64" fill="#f5b942"/></svg>'
  await writeFile(path.join(workspace, 'assets/logo.svg'), svg)
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
  const expectColors = process.env.ASSET_METER_EXPECT_COLORS === '1'
  if (expectColors) {
    settings['assetMeter.fileColorThresholdsMiB'] = [0.00005, 0.0005, 0.001]
    settings['assetMeter.folderColorThresholdsMiB'] = [0.00005, 0.0005, 0.001]
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
    'window.dialogStyle': 'custom',
    'security.workspace.trust.enabled': false,
  }))
  child = spawn(executable, [workspace, '--user-data-dir', profile, '--extensions-dir', path.join(temporary, 'extensions'), `--extensionDevelopmentPath=${root}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--no-sandbox', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const capture = (data) => { log = (log + data.toString()).slice(-20_000) }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.on('error', (error) => { log += error.message })
  child.on('exit', (code, signal) => { log += `\nVS Code exited: code=${code}, signal=${signal}\n` })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = await waitFor(async () => browser.contexts()[0]?.pages().find(candidate => /workbench.*html/.test(candidate.url())))
  const prefix = process.platform === 'darwin' ? 'Meta' : 'Control'
  command = async (title) => {
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
  const hoverFile = async (filename, relativePath) => {
    const hover = page.locator('.monaco-hover').filter({ hasText: path.join(workspace, relativePath) })
    // Startup refreshes can replace a row after the pointer first enters it.
    // Retry the interaction while keeping assertions on the final hover strict.
    await waitFor(async () => {
      await page.bringToFront()
      await page.mouse.move(0, 0)
      await name(filename).hover()
      await hover.waitFor({ state: 'visible', timeout: 2000 })
      return true
    })
    return hover
  }
  const expand = async (value) => {
    if (await row(value).getAttribute('aria-expanded') !== 'true') { await row(value).locator('.monaco-tl-twistie').click() }
  }
  await name('assets').waitFor({ state: 'visible' })
  await waitFor(async () => (await row('assets').locator('.label-description').textContent()) === '3 files · 1.7 KB')
  assert.equal(await row('assets').getAttribute('aria-expanded'), 'true', 'top-level folders start expanded')
  await name('images').waitFor({ state: 'visible' })
  assert.equal(await row('images').getAttribute('aria-expanded'), 'true', 'nested folders start expanded')
  await name('hero.png').waitFor({ state: 'visible' })
  await waitFor(async () => (await row('hero.png').locator('.label-description').textContent()) === 'ⓘ · 1.5 KB')
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
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  if (expectColors) {
    const severity = async (filename, variable) => {
      await waitFor(async () => {
        const size = row(filename).locator('.asset-meter-stat-size')
        return await size.count() === 1 && await size.evaluate((element, expected) => element.style.color === `var(--vscode-${expected})`, variable)
      })
      const colors = await row(filename).evaluate((element, variable) => {
        const description = element.querySelector('.label-description')
        const size = description.querySelector('.asset-meter-stat-size')
        const probe = document.createElement('span')
        probe.style.color = `var(--vscode-${variable})`
        description.append(probe)
        const result = {
          size: getComputedStyle(size).color,
          expected: getComputedStyle(probe).color,
          label: getComputedStyle(element.querySelector('.label-name')).color,
          prefix: getComputedStyle(description).color,
          neutralPrefix: description.firstChild.nodeType === Node.TEXT_NODE,
          opacity: getComputedStyle(description).opacity,
        }
        probe.remove()
        return result
      }, variable)
      assert.equal(colors.size, colors.expected, `${filename}: rendered size uses the theme severity color`)
      assert.equal(colors.opacity, '1')
      assert.ok(colors.neutralPrefix, 'counts and metadata indicators remain outside the colored span')
      if (variable !== 'descriptionForeground') { assert.notEqual(colors.size, colors.prefix) }
      return colors.label
    }
    const filenameColor = await severity('hero.png', 'assetMeter-sizeCritical')
    await severity('assets', 'assetMeter-sizeCritical')
    await severity('logo.svg', 'assetMeter-sizeWarning')
    const mediumSvg = `<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(650)}</svg>`
    await writeFile(path.join(workspace, 'assets/medium.svg'), mediumSvg)
    await name('medium.svg').waitFor({ state: 'visible' })
    await severity('medium.svg', 'assetMeter-sizeLarge')
    settings['assetMeter.colorize'] = false
    await writeFile(settingsFile, JSON.stringify(settings))
    assert.equal(await severity('hero.png', 'descriptionForeground'), filenameColor, 'color settings do not recolor filenames')
    settings['assetMeter.colorize'] = true
    settings['assetMeter.fileColorThresholdsMiB'] = [1, 2, 3]
    await writeFile(settingsFile, JSON.stringify(settings))
    await severity('hero.png', 'descriptionForeground')
    settings['assetMeter.fileColorThresholdsMiB'] = [0.00005, 0.0005, 0.001]
    await writeFile(settingsFile, JSON.stringify(settings))
    await severity('hero.png', 'assetMeter-sizeCritical')
    await page.locator('.part.sidebar').screenshot({ path: path.join(root, 'artifacts/asset-tree-colors.png') })
    await rm(path.join(workspace, 'assets/medium.svg'))
    await name('medium.svg').waitFor({ state: 'detached' })
    console.log('Statistics colors passed: yellow/orange/red match theme colors, counts and filenames stay neutral, and settings update live with Explorer badges disabled.')
  }
  for (const [filename, relativePath, size] of [
    ['hero.png', 'assets/images/hero.png', '1.5 KB (1,536 bytes)'],
    ['logo.svg', 'assets/logo.svg', `${Buffer.byteLength(svg)} B (${Buffer.byteLength(svg)} bytes)`],
  ]) {
    const hover = await hoverFile(filename, relativePath)
    const preview = hover.getByRole('img', { name: 'Image preview', exact: true })
    await waitFor(async () => await preview.evaluate(element => element.complete && element.naturalWidth > 0))
    const text = (await hover.textContent() ?? '').replace(/\u00A0/g, ' ')
    const basicRows = await hover.locator('table').first().locator('tbody > tr').evaluateAll(elements => elements.filter(element => element.children.length === 4).map(element => ({ key: element.children[1].textContent.trim(), value: element.lastElementChild.textContent.trim() })))
    assert.equal(basicRows[0].key, 'Path')
    assert.equal(basicRows[0].value, path.join(workspace, relativePath))
    assert.equal(basicRows[1].key, 'Size')
    assert.equal(basicRows[1].value, size, 'hover retains exact bytes')
    assert.equal(await hover.locator('table').first().locator('.codicon-file').count(), 1, 'Path uses the built-in file icon')
    assert.equal(await hover.locator('table').first().locator('.codicon-database').count(), 1, 'Size uses the built-in database icon')
    assert.equal(await hover.locator('pre, code, th').count(), 0, 'tooltip uses normal text without code fonts or table headers')
    const typography = await hover.evaluate((element) => {
      const base = getComputedStyle(element.querySelector('.rendered-markdown') ?? element).fontFamily
      return [...element.querySelectorAll('td > span:not(.codicon), td > strong')].every(cell => getComputedStyle(cell).fontFamily === base)
    })
    assert.equal(typography, true, 'basic and metadata values inherit the normal tooltip font')
    const borderless = await hover.locator('table, td').evaluateAll(elements => elements.every((element) => {
      const style = getComputedStyle(element)
      return [style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderRightWidth].every(width => Number.parseFloat(width) === 0)
    }))
    assert.equal(borderless, true, 'layout has no visible table borders or row separators')
    if (filename === 'hero.png') {
      assert.ok(text.includes('Asset Meter UI'), 'hover includes embedded metadata')
      assert.equal(await hover.locator('strong').filter({ hasText: /^MetaData$/ }).count(), 1)
    }
    else { assert.equal(await hover.locator('strong').filter({ hasText: /^MetaData$/ }).count(), 0, 'images without metadata omit the section') }
    assert.equal(await preview.evaluate(element => Math.round(element.getBoundingClientRect().width)), 280)
    const layout = await hover.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const content = element.querySelector('.rendered-markdown') ?? element
      return { width: bounds.width, overflow: content.scrollWidth > content.clientWidth }
    })
    assert.ok(layout.width <= 320, `hover stays within 320px, including long paths (actual: ${layout.width}px)`)
    assert.equal(layout.overflow, false, 'the complete path wraps without horizontal overflow')
    const order = await hover.evaluate(element => element.querySelector('img').getBoundingClientRect().bottom <= element.querySelector('table').getBoundingClientRect().top)
    assert.ok(order, 'the image is above the details')
    await hover.screenshot({ path: path.join(root, `artifacts/asset-hover-${filename}.png`) })
    await page.keyboard.press('Escape')
    await page.mouse.move(0, 0)
    await hover.waitFor({ state: 'hidden' })
  }
  console.log('Image hover UI passed: PNG and SVG images load above Path and Size, with exact bytes and bounded width.')
  const reportClipboard = async () => {
    await rm(clipboardReport, { force: true })
    await command('Asset Meter Test: Report Clipboard')
    return waitFor(async () => JSON.parse(await readFile(clipboardReport, 'utf8')))
  }
  const originalClipboard = (await reportClipboard()).text
  clipboardSaved = true
  await name('hero.png').click()
  assert.equal((await reportClipboard()).text, originalClipboard, 'single-click does not change the clipboard')
  const checkCopy = async (expected) => {
    await expand('assets')
    await expand('images')
    await name('hero.png').waitFor({ state: 'visible' })
    await delay(550)
    await name('hero.png').dblclick()
    await page.locator('.notifications-toasts').getByText(`Asset Meter: Copied path: ${expected}`, { exact: true }).waitFor({ state: 'visible' })
    assert.equal((await reportClipboard()).text, expected, 'the clipboard contains the path shown in the success notification')
  }
  await checkCopy('assets/images/hero.png')
  settings['assetMeter.copyType'] = 'absolute'
  await writeFile(settingsFile, JSON.stringify(settings))
  await waitFor(async () => (await reportClipboard()).type === 'absolute')
  await checkCopy(path.join(workspace, 'assets/images/hero.png'))
  settings['assetMeter.copyType'] = 'relative'
  settings['workbench.list.openMode'] = 'doubleClick'
  await writeFile(settingsFile, JSON.stringify(settings))
  await waitFor(async () => {
    const report = await reportClipboard()
    return report.type === 'relative' && report.openMode === 'doubleClick'
  })
  await checkCopy('assets/images/hero.png')
  settings['workbench.list.openMode'] = 'singleClick'
  await writeFile(settingsFile, JSON.stringify(settings))
  await waitFor(async () => (await reportClipboard()).openMode === 'singleClick')
  settings['assetMeter.copyType'] = 'image'
  await writeFile(settingsFile, JSON.stringify(settings))
  await waitFor(async () => (await reportClipboard()).type === 'image')
  for (const [filename, width, height] of [['hero.png', 1, 1], ['logo.svg', 160, 160]]) {
    await expand('assets')
    if (filename === 'hero.png') { await expand('images') }
    await name(filename).waitFor({ state: 'visible' })
    await delay(550)
    await name(filename).dblclick()
    const relativePath = filename === 'hero.png' ? 'assets/images/hero.png' : 'assets/logo.svg'
    await page.locator('.notifications-toasts').getByText(`Asset Meter: Copied image: ${relativePath}`, { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.locator('.editor-group-container .tab').filter({ hasText: `Copy image: ${filename}` }).count(), 0, 'the temporary copying tab closes after success')
    await rm(imageReport, { force: true })
    await command('Asset Meter Test: Inspect Image Clipboard')
    const target = await waitFor(async () => {
      for (const frame of page.frames()) {
        const candidate = frame.locator('#paste')
        if (await candidate.count()) { return candidate }
      }
    })
    await target.click()
    await target.press(`${prefix}+V`)
    const image = await waitFor(async () => JSON.parse(await readFile(imageReport, 'utf8')))
    assert.equal(image.type, 'image/png', JSON.stringify(image))
    assert.equal(image.width, width)
    assert.equal(image.height, height)
    if (filename === 'logo.svg') { assert.equal(image.pixel[3], 0, 'SVG transparency survives copying') }
    console.log(`Image copy and paste passed: ${filename}, ${width} × ${height}.`)
  }
  settings['assetMeter.copyType'] = 'relative'
  await writeFile(settingsFile, JSON.stringify(settings))
  await waitFor(async () => (await reportClipboard()).type === 'relative')
  await command('Asset Meter Test: Restore Clipboard')
  clipboardSaved = false
  console.log('Copy UI passed: relative / absolute paths, image content pasted as PNG, SVG transparency, live settings, success notifications and double-click opening mode.')
  await name('hero.png').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Compress Image/ }).waitFor({ state: 'visible' })
  await page.getByRole('menuitem', { name: /Reveal in Explorer/ }).waitFor({ state: 'visible' })
  const menuItems = page.getByRole('menuitem')
  assert.ok((await menuItems.allTextContents()).every(label => !label.includes('Asset Meter:')), 'context menu labels omit the extension prefix')
  assert.equal((await menuItems.last().textContent()).trim(), 'Delete', 'Delete is the last context action')
  const deleteItem = page.getByRole('menuitem', { name: /^Delete$/ })
  const separateGroup = await deleteItem.evaluate(element => element.closest('.action-item').previousElementSibling?.classList.contains('disabled'))
  assert.ok(separateGroup, 'Delete follows a separate menu separator')
  await page.screenshot({ path: path.join(root, 'artifacts/asset-tree-context-menu.png') })
  if (process.platform === 'darwin') { await page.getByRole('menuitem', { name: /Reveal in Finder/ }).waitFor({ state: 'visible' }) }
  await page.getByRole('menuitem', { name: /Open Image Details/ }).click()
  const detailsFrame = await waitFor(async () => {
    for (const frame of page.frames()) {
      if ((await frame.locator('body').textContent())?.replaceAll('\u00A0', ' ').includes('Asset Meter UI')) { return frame }
    }
  })
  const detailsImage = detailsFrame.getByRole('img', { name: 'Image preview', exact: true })
  await waitFor(() => detailsImage.evaluate(image => image.complete && image.naturalWidth > 0))
  assert.ok((await detailsFrame.locator('body').textContent()).includes('Metadata'))
  assert.equal(await detailsFrame.getByRole('columnheader', { name: 'Field', exact: true }).count(), 1)
  assert.equal(await detailsFrame.getByRole('columnheader').count(), 2, 'details table contains only Field and Value columns')
  await detailsFrame.getByRole('cell', { name: 'Asset Meter UI', exact: true }).waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(root, 'artifacts/image-metadata-preview.png') })
  // Return to the tree before the existing SVG editor checks.
  await page.keyboard.press(`${prefix}+k`)
  await page.keyboard.press('w')
  console.log('Metadata UI passed: indicator, hover and native Markdown preview show the same embedded Author field.')
  await writeFile(path.join(workspace, 'assets/added.png'), Buffer.alloc(64))
  await name('added.png').waitFor({ state: 'visible' })
  const addedPath = path.join(workspace, 'assets/added.png')
  await name('added.png').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Delete$/ }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Delete "added.png"?' })
  await dialog.waitFor({ state: 'visible' })
  assert.ok((await dialog.textContent()).includes(addedPath), 'confirmation identifies the exact resource path')
  assert.equal((await readFile(addedPath)).length, 64, 'opening confirmation does not delete the resource')
  await dialog.getByRole('button', { name: /Cancel/ }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal((await readFile(addedPath)).length, 64, 'cancelling keeps the resource')
  await name('added.png').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Delete$/ }).click()
  await dialog.waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(root, 'artifacts/asset-tree-delete-confirmation.png') })
  await dialog.getByRole('button', { name: /^Delete$/ }).click()
  await dialog.waitFor({ state: 'hidden' })
  await name('added.png').waitFor({ state: 'detached' })
  await assert.rejects(readFile(addedPath), { code: 'ENOENT' })
  console.log('Delete UI passed: separate bottom action, exact path confirmation, cancel preserves the file, confirmed deletion refreshes the tree.')
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
  // Exercise a camera photo as well as generic PNG text, without depending on
  // personal photos or their metadata. The XMP APP1 segment uses EXIF names.
  const jpeg = await readFile(path.join(root, 'test/fixtures/sample.jpg'))
  const captured = new Date(2024, 1, 15, 19, 37, 34).toISOString()
  const xmp = Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" tiff:Make="SONY" tiff:Model="ILCE-6700" tiff:ImageWidth="6192" tiff:ImageHeight="4128" tiff:Orientation="1" tiff:Software="ILCE-6700 v1.01" exif:LensModel="18-50mm F2.8 DC DN | Contemporary 021" exif:ExposureTime="0.03333333333333333" exif:FNumber="2.8" exif:ISO="5000" exif:FocalLength="18" exif:FocalLengthIn35mmFormat="27" exif:DateTimeOriginal="${captured}" exif:ColorSpace="1" exif:Flash="16" exif:WhiteBalance="1" xmp:Rating="0"/></rdf:RDF></x:xmpmeta>`)
  const segment = Buffer.alloc(xmp.length + 4)
  segment.writeUInt16BE(0xFFE1); segment.writeUInt16BE(xmp.length + 2, 2); xmp.copy(segment, 4)
  await writeFile(path.join(workspace, 'assets/camera.jpg'), Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]))
  settings['assetMeter.include'] = ['**/*.{png,svg,jpg}', '**/assets']
  await writeFile(settingsFile, JSON.stringify(settings))
  await waitFor(async () => { await expand('assets'); return name('camera.jpg').isVisible() })
  await waitFor(async () => (await row('camera.jpg').locator('.label-description').textContent()).startsWith('ⓘ'))
  const photoHover = await hoverFile('camera.jpg', 'assets/camera.jpg')
  const photoText = (await photoHover.textContent()).replaceAll('\u00A0', ' ')
  assert.ok(photoText.includes('SONY ILCE-6700'))
  const photoRows = await inspectHoverRows(photoHover)
  const photoValues = new Map(photoRows.map(row => [row.label, row.value]))
  assert.equal(photoValues.get('Shutter'), '1/30 s')
  assert.equal(photoValues.get('Aperture'), 'f/2.8')
  assert.equal(photoValues.get('ISO'), '5000')
  assert.equal(photoValues.get('Focal length'), '18 mm')
  assert.equal(photoValues.get('35mm equiv.'), '27 mm')
  assert.equal(photoValues.get('Date'), '2024-02-15')
  assert.equal(photoValues.get('Time'), '19:37:34')
  assert.equal(photoValues.get('Image'), '6,192 × 4,128 px')
  assert.equal(photoValues.get('Resolution'), '25.6 MP')
  assert.ok(Math.max(...photoRows.map(row => row.left)) - Math.min(...photoRows.map(row => row.left)) <= 1, 'metadata keys share a left edge')
  assert.ok(Math.max(...photoRows.map(row => row.right)) - Math.min(...photoRows.map(row => row.right)) <= 1, 'metadata values share a right edge')
  assert.ok(photoRows.every(row => row.gap >= 12), 'key/value rows keep a visible gap')
  assert.ok(photoRows.every(row => row.baselineOffset <= 0.25), `keys and values share the actual first text baseline: ${JSON.stringify(photoRows.map(row => [row.label, row.baselineOffset]))}`)
  for (const label of ['Shutter', 'Date', 'White balance']) {
    const index = photoRows.findIndex(row => row.label === label)
    assert.ok(index > 0 && photoRows[index].top - photoRows[index - 1].bottom >= 19, `${label} starts a group after one blank line`)
  }
  assert.ok(photoRows.every(row => row.keyColor !== row.valueColor), 'basic and metadata keys keep their muted color')
  assert.ok(photoRows.every(row => row.iconWidth > 0 && row.glyph && !['none', 'normal', '""'].includes(row.glyph)), 'every key has a rendered built-in icon')
  assert.ok(photoRows.every(row => Math.abs(row.iconGap - 4) <= 0.5), 'icons and keys keep a 4px gap')
  // Font outlines and DOM coordinates round differently within one layout subpixel.
  assert.ok(photoRows.every(row => row.opticalOffset <= 1.25 + 1 / 64), `icon glyphs align optically with key text: ${JSON.stringify(photoRows.map(row => [row.label, row.opticalOffset]))}`)
  assert.equal(await photoHover.locator('table table').count(), 0, 'nested tables cannot introduce independent text baselines')
  assert.ok(photoRows.every(row => row.iconColor === row.keyColor), 'icons share the muted key color')
  assert.equal(await photoHover.locator('.codicon-device-camera').count(), 1)
  assert.equal(await photoHover.locator('.codicon-calendar').count(), 1)
  assert.equal(await photoHover.locator('.codicon-clock').count(), 1)
  assert.doesNotMatch(photoText, /Rating: 0|ExifImageWidth|ExposureTime|0\.033333|Software:|Orientation:/)
  assert.equal(await photoHover.locator('pre, code, th').count(), 0)
  assert.equal(await photoHover.locator('strong').filter({ hasText: '1/30 s' }).count(), 1)
  assert.ok(await photoHover.evaluate(element => element.getBoundingClientRect().width <= 320))
  const photoTitle = photoHover.locator('strong').filter({ hasText: /^MetaData$/ })
  const titlePosition = await photoTitle.evaluate(element => ({ title: element.getBoundingClientRect().toJSON(), row: element.parentElement.getBoundingClientRect().toJSON(), text: element.parentElement.textContent }))
  assert.match(titlePosition.text.replaceAll('\u00A0', ' '), /-------- {3}MetaData {3}--------/)
  assert.ok(Math.abs(titlePosition.title.x + titlePosition.title.width / 2 - titlePosition.row.x - titlePosition.row.width / 2) <= 1, 'MetaData is centered between its dashed separators')
  await photoHover.locator('table').first().evaluate(element => element.scrollIntoView({ block: 'start' }))
  await photoHover.screenshot({ path: path.join(root, 'artifacts/asset-hover-camera-details.png') })
  await photoTitle.evaluate(element => element.scrollIntoView({ block: 'start' }))
  await photoHover.screenshot({ path: path.join(root, 'artifacts/asset-hover-camera.jpg.png') })
  const metadataBounds = await photoTitle.boundingBox()
  const hoverBounds = await photoHover.boundingBox()
  const metadataTop = metadataBounds.y - 8
  await page.screenshot({ path: path.join(root, 'artifacts/asset-hover-camera-metadata.png'), clip: { x: hoverBounds.x, y: metadataTop, width: hoverBounds.width, height: hoverBounds.y + hoverBounds.height - metadataTop } })
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  console.log('Camera metadata UI passed: clear hierarchy, compact exposure, formatted dimensions/date and no default or duplicate rows.')
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
  if (clipboardSaved && page && command) { await command('Asset Meter Test: Restore Clipboard').catch(() => {}) }
  if (browser) { await browser.close() }
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
  }
  await rm(temporary, { recursive: true, force: true })
}
