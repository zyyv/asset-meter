import type { Logger } from '../src/log'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { BatchImageCompression } from '../src/compression/batch'
import { CompressionExecutor } from '../src/compression/executor'
import { saveCompressedCopy } from '../src/compression/output'
import { boundedSetting } from '../src/compression/settings'
import { state } from './support/workspace'

vi.mock('vscode', async () => {
  const base = await (await import('./support/workspace')).createVscodeMock()
  class FileSystemError extends Error {
    constructor(readonly code: string) { super(code) }
  }
  return {
    ...base,
    FileSystemError,
    ProgressLocation: { Notification: 15 },
    commands: { executeCommand: vi.fn() },
    window: {
      ...base.window,
      showQuickPick: vi.fn(),
      showOpenDialog: vi.fn(),
      showInputBox: vi.fn(),
      withProgress: vi.fn(),
    },
    workspace: {
      ...base.workspace,
      fs: { ...base.workspace.fs, writeFile: vi.fn(), copy: vi.fn(), delete: vi.fn() },
    },
  }
})

const files = new Map<string, Uint8Array>()
const listeners = new Set<() => void>()
const report = vi.fn()
const refreshed = vi.fn()
const log: Logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
let cancelled = false
let png: Uint8Array
let webp: Uint8Array
let jpeg: Uint8Array
let executor: CompressionExecutor
let batch: BatchImageCompression
const image = (name: string) => vscode.Uri.parse(`file:///workspace/${name}`)
function cancel() { cancelled = true; for (const listener of listeners) { listener() } }

beforeEach(async () => {
  vi.clearAllMocks()
  files.clear(); listeners.clear(); cancelled = false
  state.config = { plugin: 'test', batchSize: 2 }
  png = Uint8Array.from(await readFile(join(__dirname, 'fixtures/sample.png')))
  webp = Uint8Array.from(await readFile(join(__dirname, 'fixtures/sample.webp')))
  jpeg = Uint8Array.from(await readFile(join(__dirname, 'fixtures/sample.jpg')))
  executor = new CompressionExecutor(2)
  executor.plugins.register({
    id: 'test',
    label: 'Test encoder',
    description: 'Local test',
    formats: ['png', 'jpeg', 'webp'],
    outputFormats: ['jpeg', 'png', 'webp'],
    describe: () => 'Test',
    compress: input => ({ result: Promise.resolve(input.outputFormat === 'jpeg' ? jpeg : input.outputFormat === 'png' ? png : webp), cancel() {} }),
  })
  batch = new BatchImageCompression({ extensionUri: image('extension') } as vscode.ExtensionContext, executor, refreshed, log)
  vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
    const choices = await items
    return (choices[0]?.label === 'Keep original format' ? choices.find(choice => choice.label === 'WebP') : choices[0]) as never
  })
  vi.mocked(vscode.window.showInputBox).mockResolvedValue('75')
  vi.mocked(vscode.window.withProgress).mockImplementation(async (_options, task) => task({ report }, {
    get isCancellationRequested() { return cancelled },
    onCancellationRequested: (listener) => {
      const notify = () => listener(undefined)
      listeners.add(notify)
      return { dispose: () => { listeners.delete(notify) } }
    },
  }))
  vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined)
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined)
  vi.mocked(vscode.workspace.fs.stat).mockImplementation(async (uri) => {
    const bytes = files.get(uri.toString())
    if (!bytes) { throw new vscode.FileSystemError('FileNotFound') }
    return { type: vscode.FileType.File, size: bytes.length, ctime: 0, mtime: 0 }
  })
  vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async uri => files.get(uri.toString())!)
  vi.mocked(vscode.workspace.fs.writeFile).mockImplementation(async (uri, bytes) => { files.set(uri.toString(), Uint8Array.from(bytes)) })
  vi.mocked(vscode.workspace.fs.copy).mockImplementation(async (source, target, options) => {
    expect(options).toEqual({ overwrite: false })
    if (files.has(target.toString())) { throw new vscode.FileSystemError('FileExists') }
    files.set(target.toString(), files.get(source.toString())!)
  })
  vi.mocked(vscode.workspace.fs.delete).mockImplementation(async (uri) => { files.delete(uri.toString()) })
})

afterEach(() => { batch.dispose(); executor.dispose() })

function addImages(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const uri = image(`image-${index}.png`)
    files.set(uri.toString(), png)
    return uri
  })
}

it('saves converted copies in bounded batches, deduplicates selection and reports complete progress', async () => {
  const uris = addImages(5)
  await batch.compress([...uris, uris[0]!, image('notes.txt')])
  expect(refreshed).toHaveBeenCalledTimes(5)
  for (let index = 0; index < 5; index++) {
    expect(files.get(image(`image-${index}.png`).toString())).toEqual(png)
    expect(files.get(image(`image-${index}.compressed.webp`).toString())).toEqual(webp)
  }
  expect([...files.keys()].some(key => key.includes('.asset-meter-'))).toBe(false)
  expect(vi.mocked(log.info).mock.calls.filter(([text]) => /Batch \d\/3/.test(text))).toHaveLength(3)
  expect(report.mock.calls.at(-1)![0].message).toContain('5/5 · 5 saved')
  expect(report.mock.calls.reduce((sum, [update]) => sum + (update.increment ?? 0), 0)).toBeCloseTo(100)
  expect(vscode.window.withProgress).toHaveBeenCalledWith(expect.objectContaining({ location: vscode.ProgressLocation.Notification, cancellable: true }), expect.any(Function))
})

it('reads only admitted images, cancels active workers and never reads the queued or future batches', async () => {
  const uris = addImages(5)
  const cancelEncoder = vi.fn()
  const plugin = executor.plugins.get('test')
  plugin.compress = () => {
    let reject!: (error: Error) => void
    const result = new Promise<Uint8Array>((_resolve, fail) => { reject = fail })
    return { result, cancel: () => { cancelEncoder(); reject(new Error('Compression cancelled.')) } }
  }
  const running = batch.compress(uris)
  await vi.waitFor(() => expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(2))
  cancel()
  await running
  expect(cancelEncoder).toHaveBeenCalledTimes(2)
  expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(2)
  expect(refreshed).not.toHaveBeenCalled()
  expect(log.error).not.toHaveBeenCalled()
  expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Cancelled: 0 saved, 0 skipped, 0 failed, 5 remaining'), 'Show Logs')
  expect(listeners.size).toBe(0)
})

it('continues after corrupt input and write failures, logging failures and accurate totals', async () => {
  const uris = addImages(4)
  files.set(uris[0]!.toString(), Buffer.from('corrupt'))
  vi.mocked(vscode.workspace.fs.copy).mockRejectedValueOnce(new Error('Read-only destination'))
  await batch.compress(uris)
  expect(log.error).toHaveBeenCalledTimes(2)
  expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Read-only destination'))
  expect(refreshed).toHaveBeenCalledTimes(2)
  expect(report.mock.calls.at(-1)![0].message).toContain('4/4 · 2 saved · 0 skipped · 2 failed')
  expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Finished: 2 saved, 0 skipped, 2 failed'), 'Show Logs')
  expect([...files.keys()].some(key => key.includes('.asset-meter-'))).toBe(false)
})

it('skips same-format results without savings and does not publish copies', async () => {
  const uris = addImages(2)
  executor.plugins.get('test').compress = () => ({ result: Promise.resolve(png), cancel() {} })
  vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
    const options = await items
    return options[0] as never
  })
  await batch.compress(uris)
  expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
  expect(refreshed).not.toHaveBeenCalled()
  expect(report.mock.calls.at(-1)![0].message).toContain('2/2 · 0 saved · 2 skipped')
})

it('picker cancellation has no effects and disposal aborts a running batch', async () => {
  const uris = addImages(1)
  vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined)
  await batch.compress(uris)
  expect(vscode.window.withProgress).not.toHaveBeenCalled()
  expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled()
  const cancelEncoder = vi.fn()
  executor.plugins.get('test').compress = () => {
    let reject!: (error: Error) => void
    const result = new Promise<Uint8Array>((_resolve, fail) => { reject = fail })
    return { result, cancel: () => { cancelEncoder(); reject(new Error('cancelled')) } }
  }
  const running = batch.compress(uris)
  await vi.waitFor(() => expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(1))
  batch.dispose()
  await running
  expect(cancelEncoder).toHaveBeenCalledOnce()
  expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
})

it('never overwrites existing outputs, including collisions from simultaneous same-stem conversions', async () => {
  const existing = image('hero.compressed.webp')
  files.set(existing.toString(), Buffer.from('existing'))
  const signal = new AbortController().signal
  const targets = await Promise.all([
    saveCompressedCopy(image('hero.png'), webp, 'webp', signal, log),
    saveCompressedCopy(image('hero.jpg'), webp, 'webp', signal, log),
  ])
  expect(targets.map(uri => uri.path).sort()).toEqual(['/workspace/hero.compressed-2.webp', '/workspace/hero.compressed-3.webp'])
  expect(files.get(existing.toString())).toEqual(Buffer.from('existing'))
  expect([...files.keys()].filter(key => key.includes('.asset-meter-'))).toEqual([])
})

it('cancellation before publishing cleans up the temporary file without exposing a partial result', async () => {
  const controller = new AbortController()
  vi.mocked(vscode.workspace.fs.writeFile).mockImplementationOnce(async (uri, bytes) => {
    files.set(uri.toString(), bytes)
    controller.abort()
  })
  await expect(saveCompressedCopy(image('hero.png'), webp, 'webp', controller.signal, log)).rejects.toThrow()
  expect(vscode.workspace.fs.copy).not.toHaveBeenCalled()
  expect(files.size).toBe(0)
})

it('bounds invalid settings before they can stall a batch or create unlimited parallelism', () => {
  expect(boundedSetting(0, 50, 200)).toBe(1)
  expect(boundedSetting(Number.NaN, 50, 200)).toBe(50)
  expect(boundedSetting(Infinity, 50, 200)).toBe(50)
  expect(boundedSetting(1000, 50, 200)).toBe(200)
})

it.each(['JPEG', 'PNG', 'WebP'])('passes the selected %s format and quality to the encoder', async (label) => {
  const uri = image(label === 'PNG' ? 'source.webp' : 'source.png')
  files.set(uri.toString(), label === 'PNG' ? webp : png)
  const encode = vi.spyOn(executor.plugins.get('test'), 'compress')
  vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
    const choices = await items
    return (choices[0]?.label === 'Keep original format' ? choices.find(choice => choice.label === label) : choices[0]) as never
  })
  vi.mocked(vscode.window.showInputBox).mockResolvedValue('90')
  await batch.compress([uri])
  expect(encode).toHaveBeenCalledWith(expect.objectContaining({ outputFormat: label.toLowerCase(), quality: label === 'PNG' ? 75 : 90 }), expect.anything())
  expect(refreshed).toHaveBeenCalledOnce()
  expect(refreshed.mock.calls[0]![0].path).toBe(`/workspace/source.compressed.${label === 'JPEG' ? 'jpg' : label.toLowerCase()}`)
  expect(vscode.window.showInputBox).toHaveBeenCalledTimes(label === 'PNG' ? 0 : 1)
})

it('validates quality and cancelling that input does not start any compression', async () => {
  vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined)
  await batch.compress(addImages(1))
  expect(vscode.window.withProgress).not.toHaveBeenCalled()
  expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled()
  const validate = vi.mocked(vscode.window.showInputBox).mock.calls[0]![0]!.validateInput!
  for (const value of ['', '0', '101', '75.5', '1e2', 'invalid']) {
    expect(validate(value)).toBe('Enter a whole number from 1 to 100.')
  }
  for (const value of ['1', '75', '100', ' 90 ']) { expect(validate(value)).toBeUndefined() }
})

it('does not offer manual quality for automatic providers', async () => {
  const uri = image('source.jpg')
  files.set(uri.toString(), jpeg)
  executor.plugins.register({
    ...executor.plugins.get('test'),
    id: 'automatic-test',
    quality: 'automatic',
    compress: () => ({ result: Promise.resolve(jpeg), cancel() {} }),
  })
  state.config.plugin = 'automatic-test'
  vi.mocked(vscode.window.showQuickPick).mockImplementation(async items => (await items)[0] as never)
  await batch.compress([uri])
  expect(vscode.window.showInputBox).not.toHaveBeenCalled()
  expect(report.mock.calls.at(-1)![0].message).toContain('1/1 · 0 saved · 1 skipped')
})
