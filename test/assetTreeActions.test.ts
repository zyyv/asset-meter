import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { AssetTreeActions } from '../src/assetTreeActions'
import { ImageClipboard } from '../src/imageClipboard'

const state = vi.hoisted(() => ({
  copyType: 'relative',
  openMode: 'singleClick',
}))

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn((section: string) => ({
      get: (key: string, fallback: unknown) => section === 'workbench' && key === 'list.openMode'
        ? state.openMode
        : key === 'copyType' ? state.copyType : fallback,
    })),
    asRelativePath: vi.fn((uri: vscode.Uri) => uri.path.replace(/^\/workspace\//, '')),
  },
  commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
  env: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
  window: {
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn().mockResolvedValue(undefined),
  },
}))

function file(path = '/workspace/assets/hero image.png'): vscode.Uri {
  return { path, fsPath: path, toString: () => `file://${path}` } as vscode.Uri
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  state.copyType = 'relative'
  state.openMode = 'singleClick'
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('previews on single-click and copies a relative path once on double-click', async () => {
  const actions = new AssetTreeActions()
  const uri = file()
  await actions.open(uri)
  expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.open', uri, { preview: true, preserveFocus: true })
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  await actions.open(uri)
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('assets/hero image.png')
  expect(vscode.workspace.asRelativePath).toHaveBeenCalledWith(uri, false)
  expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter: Copied path: assets/hero image.png')
  expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1)
  await actions.open(uri)
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledTimes(1)
})

it('uses the current resource-scoped setting for absolute paths', async () => {
  const actions = new AssetTreeActions()
  const uri = file()
  await actions.open(uri)
  state.copyType = 'absolute'
  await actions.open(uri)
  expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('assetMeter', uri)
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(uri.fsPath)
  expect(vscode.workspace.asRelativePath).not.toHaveBeenCalled()
})

it('does not copy when opening different files, after the click interval or after selection resets', async () => {
  const actions = new AssetTreeActions()
  await actions.open(file())
  await actions.open(file('/workspace/assets/other.png'))
  await actions.open(file())
  await vi.advanceTimersByTimeAsync(500)
  await actions.open(file())
  actions.reset()
  await actions.open(file())
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
})

it('copies when VS Code invokes the command once in double-click opening mode', async () => {
  state.openMode = 'doubleClick'
  const actions = new AssetTreeActions()
  await actions.open(file())
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('assets/hero image.png')
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
})

it('preserves the SVG opener on single-click and copies SVG paths on double-click', async () => {
  const actions = new AssetTreeActions()
  const uri = file('/workspace/assets/logo.SVG')
  await actions.open(uri)
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(500)
  expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith('assetMeter.openSvg', uri)
  await actions.open(uri)
  await vi.advanceTimersByTimeAsync(100)
  await actions.open(uri)
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('assets/logo.SVG')
  await vi.advanceTimersByTimeAsync(500)
  expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1)
})

it('shows success only after the clipboard write completes', async () => {
  let finish!: () => void
  vi.mocked(vscode.env.clipboard.writeText).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  state.openMode = 'doubleClick'
  const copying = new AssetTreeActions().open(file())
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  finish()
  await copying
  expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
})

it('reports clipboard failure without a success notification and allows retrying', async () => {
  vi.mocked(vscode.env.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard unavailable'))
  state.openMode = 'doubleClick'
  const actions = new AssetTreeActions()
  await actions.open(file())
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter could not copy the path: Clipboard unavailable')
  await actions.open(file())
  expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
})

it('copies image content instead of path text and waits for the image clipboard to finish', async () => {
  let finish!: () => void
  const copyImage = vi.spyOn(ImageClipboard.prototype, 'copy').mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  state.copyType = 'image'
  state.openMode = 'doubleClick'
  const uri = file()
  const copying = new AssetTreeActions().open(uri)
  expect(copyImage).toHaveBeenCalledExactlyOnceWith(uri)
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  finish()
  await copying
  expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter: Copied image: assets/hero image.png')
})

it('reports image-copy failures without a success message or overwriting the clipboard with a path', async () => {
  vi.spyOn(ImageClipboard.prototype, 'copy').mockRejectedValueOnce(new Error('Clipboard permission denied'))
  state.copyType = 'image'
  state.openMode = 'doubleClick'
  await new AssetTreeActions().open(file())
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Asset Meter could not copy the image: Clipboard permission denied')
})

it('rejects non-images in image mode without changing the clipboard', async () => {
  state.copyType = 'image'
  state.openMode = 'doubleClick'
  await new AssetTreeActions().open(file('/workspace/assets/video.mp4'))
  expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled()
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Image copy requires a JPEG'))
})

it('copies a double-clicked SVG without starting a competing preview', async () => {
  const copyImage = vi.spyOn(ImageClipboard.prototype, 'copy').mockResolvedValueOnce(undefined)
  state.copyType = 'image'
  const actions = new AssetTreeActions()
  const uri = file('/workspace/assets/logo.svg')
  await actions.open(uri)
  actions.select(uri)
  await vi.advanceTimersByTimeAsync(100)
  await actions.open(uri)
  await vi.advanceTimersByTimeAsync(500)
  expect(copyImage).toHaveBeenCalledExactlyOnceWith(uri)
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
})

it('keeps a first click when its selection event arrives later, while clearing it for other files', async () => {
  const actions = new AssetTreeActions()
  const uri = file()
  await actions.open(uri)
  actions.select(uri)
  await actions.open(uri)
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('assets/hero image.png')
  await actions.open(uri)
  actions.select(file('/workspace/assets/other.png'))
  await actions.open(uri)
  expect(vscode.env.clipboard.writeText).toHaveBeenCalledTimes(1)
})

it('cancels a pending SVG preview when the selection changes or the extension deactivates', async () => {
  const actions = new AssetTreeActions()
  await actions.open(file('/workspace/assets/logo.svg'))
  actions.reset()
  await vi.advanceTimersByTimeAsync(500)
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  await actions.open(file('/workspace/assets/logo.svg'))
  actions.dispose()
  await vi.advanceTimersByTimeAsync(500)
  expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
})
