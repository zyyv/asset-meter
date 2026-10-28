import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { AssetTreeActions } from '../src/assetTreeActions'
import { ImageClipboard } from '../src/imageClipboard'
import { assetResources, registerResourceActions } from '../src/resourceActions'

vi.mock('vscode', () => ({
  Disposable: { from: (...subscriptions: vscode.Disposable[]) => ({ dispose: () => subscriptions.forEach(subscription => subscription.dispose()) }) },
  workspace: {
    asRelativePath: vi.fn((uri: vscode.Uri) => uri.path.replace(/^\/workspace\//, '')),
  },
  commands: {
    executeCommand: vi.fn().mockResolvedValue(undefined),
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  env: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
  window: {
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn().mockResolvedValue(undefined),
  },
}))

function file(path = '/workspace/assets/hero image.png'): vscode.Uri {
  return { path, fsPath: path, toString: () => `file://${path}` } as vscode.Uri
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

it('opens files without copying on repeated open commands', async () => {
  const copyImage = vi.spyOn(ImageClipboard.prototype, 'copy')
  const actions = new AssetTreeActions()
  const uri = file()
  await actions.open(uri)
  await actions.open(uri)
  expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2)
  expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('vscode.open', uri, { preview: true, preserveFocus: true })
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  expect(copyImage).not.toHaveBeenCalled()
})

it('opens SVGs immediately through the existing SVG opener without copying', async () => {
  const copyImage = vi.spyOn(ImageClipboard.prototype, 'copy')
  const actions = new AssetTreeActions()
  const uri = file('/workspace/assets/logo.SVG')
  const opening = actions.open(uri)
  expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith('assetMeter.openSvg', uri)
  await opening
  await actions.open(uri)
  expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2)
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  expect(copyImage).not.toHaveBeenCalled()
})

it('reports file-open failures without writing to the clipboard', async () => {
  vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(new Error('File unavailable'))
  await new AssetTreeActions().open(file())
  expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter could not open the file: File unavailable')
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
})

it('copies a workspace-relative path without opening an editor', async () => {
  const uri = file()
  await new AssetTreeActions().copy(uri, 'relative')
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('assets/hero image.png')
  expect(vscode.workspace.asRelativePath).toHaveBeenCalledWith(uri, false)
  expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter: Copied path: assets/hero image.png')
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
})

it('copies an absolute path without opening an editor or resolving a relative path', async () => {
  const uri = file()
  await new AssetTreeActions().copy(uri, 'absolute')
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(uri.fsPath)
  expect(vscode.workspace.asRelativePath).not.toHaveBeenCalled()
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
})

it('shows success only after the clipboard write completes', async () => {
  let finish!: () => void
  vi.mocked(vscode.env.clipboard.writeText).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const copying = new AssetTreeActions().copy(file(), 'relative')
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  finish()
  await copying
  expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
})

it('reports clipboard failure without a success notification and allows retrying', async () => {
  vi.mocked(vscode.env.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard unavailable'))
  const actions = new AssetTreeActions()
  await actions.copy(file(), 'relative')
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter could not copy the path: Clipboard unavailable')
  await actions.copy(file(), 'relative')
  expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
})

it('copies image content without opening a competing preview and waits for the clipboard to finish', async () => {
  let finish!: () => void
  const copyImage = vi.spyOn(ImageClipboard.prototype, 'copy').mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const uri = file('/workspace/assets/logo.svg')
  const copying = new AssetTreeActions().copy(uri, 'image')
  expect(copyImage).toHaveBeenCalledExactlyOnceWith(uri)
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  finish()
  await copying
  expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter: Copied image: assets/logo.svg')
})

it('reports image-copy failures without a success message or overwriting the clipboard with a path', async () => {
  vi.spyOn(ImageClipboard.prototype, 'copy').mockRejectedValueOnce(new Error('Clipboard permission denied'))
  await new AssetTreeActions().copy(file(), 'image')
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter could not copy the image: Clipboard permission denied')
})

it('rejects unsupported image files without changing the clipboard', async () => {
  await new AssetTreeActions().copy(file('/workspace/assets/video.mp4'), 'image')
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Image copy requires a JPEG'))
})

it.each(['copyRelativePath', 'copyAbsolutePath', 'copyImage'] as const)('passes the clicked resource to %s for tree nodes and URI arguments', async (action) => {
  const copy = vi.fn()
  const subscription = registerResourceActions({
    openSvg: vi.fn(),
    previewImage: vi.fn(),
    compressImage: vi.fn(),
    compressImages: vi.fn(),
    copyRelativePath: copy,
    copyAbsolutePath: copy,
    copyImage: copy,
    deleteResource: vi.fn(),
  })
  const callback = vi.mocked(vscode.commands.registerCommand).mock.calls.find(([command]) => command === `assetMeter.${action}`)![1]
  const uri = file()
  callback({ uri })
  callback(uri)
  expect(copy.mock.calls).toEqual([[uri], [uri]])
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  subscription.dispose()
})

it('resolves multi-selection without duplicates and uses only an unselected right-click target', () => {
  const first = file('/workspace/assets/first.png')
  const second = file('/workspace/assets/second.jpg')
  const outside = file('/workspace/assets/other.webp')
  expect(assetResources({ uri: first }, [{ uri: first }, second, first])).toEqual([first, second])
  expect(assetResources(outside, [first, second])).toEqual([outside])
  expect(assetResources()).toEqual([])
})

it('routes tree nodes and Explorer URI multi-selection to batch compression', () => {
  const compressImage = vi.fn()
  const compressImages = vi.fn()
  registerResourceActions({
    openSvg: vi.fn(),
    previewImage: vi.fn(),
    compressImage,
    compressImages,
    copyRelativePath: vi.fn(),
    copyAbsolutePath: vi.fn(),
    copyImage: vi.fn(),
    deleteResource: vi.fn(),
  })
  const command = (id: string) => vi.mocked(vscode.commands.registerCommand).mock.calls.find(([name]) => name === id)![1]
  const first = file('/workspace/assets/first.png')
  const second = file('/workspace/assets/second.jpg')
  command('assetMeter.compressImage')({ uri: first }, [{ uri: first }, { uri: second }])
  command('assetMeter.compressImage')(first, [first, second])
  command('assetMeter.compressImages')({ uri: first }, [{ uri: first }])
  expect(compressImages.mock.calls).toEqual([[[first, second]], [[first, second]], [[first]]])
  expect(compressImage).not.toHaveBeenCalled()
  command('assetMeter.compressImage')(first)
  expect(compressImage).toHaveBeenCalledExactlyOnceWith(first)
  command('assetMeter.compressImage')(first, { groupId: 1 })
  expect(compressImage).toHaveBeenCalledTimes(2)
  expect(compressImage).toHaveBeenLastCalledWith(first)
})
