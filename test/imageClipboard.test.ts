import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { ImageClipboard } from '../src/imageClipboard'

const state = vi.hoisted(() => ({
  messages: new Set<(message: unknown) => void>(),
  closed: new Set<() => void>(),
  html: '',
  dispose: vi.fn(),
}))

vi.mock('vscode', () => ({
  Uri: { joinPath: (uri: vscode.Uri, part: string) => new URL(part, `${uri.toString()}/`) },
  ViewColumn: { Active: -1 },
  window: {
    createWebviewPanel: vi.fn(() => ({
      dispose: state.dispose,
      onDidDispose: (listener: () => void) => {
        state.closed.add(listener)
        return { dispose: () => state.closed.delete(listener) }
      },
      webview: {
        cspSource: 'https://*.vscode-cdn.net',
        asWebviewUri: (uri: vscode.Uri) => uri,
        get html() { return state.html },
        set html(value: string) { state.html = value },
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          state.messages.add(listener)
          return { dispose: () => state.messages.delete(listener) }
        },
      },
    })),
  },
}))

function file(path = '/workspace/assets/hero.png'): vscode.Uri {
  return { path, toString: () => `file://${path}` } as vscode.Uri
}

function send(message: unknown): void {
  for (const listener of state.messages) { listener(message) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  state.messages.clear()
  state.closed.clear()
  state.html = ''
})

afterEach(() => { vi.useRealTimers() })

it('keeps the copying tab until the webview confirms the clipboard write and then cleans it up', async () => {
  const images = new ImageClipboard()
  const copy = images.copy(file())
  expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith('assetMeter.copyImage', 'Copy image: hero.png', vscode.ViewColumn.Active, expect.objectContaining({ enableScripts: true }))
  expect(state.dispose).not.toHaveBeenCalled()
  send({ type: 'copied' })
  await copy
  expect(state.dispose).toHaveBeenCalledTimes(1)
  expect(state.messages.size).toBe(0)
  expect(state.closed.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('propagates image decode and clipboard errors and closes the temporary tab', async () => {
  const copy = new ImageClipboard().copy(file())
  const failure = expect(copy).rejects.toThrow('Image could not be decoded')
  send({ type: 'copyError', error: 'Image could not be decoded' })
  await failure
  expect(state.dispose).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels pending copies when the tab is closed', async () => {
  const copy = new ImageClipboard().copy(file())
  const failure = expect(copy).rejects.toThrow('Image copy cancelled')
  for (const listener of state.closed) { listener() }
  await failure
  expect(state.messages.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('cleans up a copy that never responds', async () => {
  const copy = new ImageClipboard().copy(file())
  const failure = expect(copy).rejects.toThrow('Image copy timed out')
  await vi.advanceTimersByTimeAsync(30_000)
  await failure
  expect(state.dispose).toHaveBeenCalledTimes(1)
  expect(state.messages.size).toBe(0)
})

it('rejects unsupported files before creating a copying tab', async () => {
  await expect(new ImageClipboard().copy(file('/workspace/assets/video.mp4'))).rejects.toThrow('Image copy requires')
  expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled()
})

it('disposes pending copies when the extension deactivates', async () => {
  const images = new ImageClipboard()
  const copy = images.copy(file())
  const failure = expect(copy).rejects.toThrow('Image copy cancelled')
  images.dispose()
  await failure
  await expect(images.copy(file())).rejects.toThrow('Image clipboard has been disposed')
  expect(state.messages.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
