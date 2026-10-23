import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { it } from 'vitest'
import { compressedName, imageFormat, maxInputBytes, validateImage } from '../src/compression/image'
import { CompressionRegistry } from '../src/compression/plugins'
import { jsquashPlugin } from '../src/compression/providers/jsquash'
import { createTinyPngPlugin } from '../src/compression/providers/tinypng'
import { startCompression } from '../src/compression/runner'

const fixture = (name: string) => readFile(path.join(__dirname, 'fixtures', name))
const dist = path.resolve(__dirname, '../dist')
function pluginContext(apiKey = '') {
  return {
    distDirectory: dist,
    getSetting: <T>(key: string, fallback: T): T => key === 'tinypng.apiKey' ? apiKey as T : fallback,
  }
}

it('supported image formats and Save As names preserve extension and basename', () => {
  assert.equal(imageFormat('/assets/HERO.JPEG'), 'jpeg')
  assert.equal(imageFormat('/assets/hero.jpe'), 'jpeg')
  assert.equal(imageFormat('/assets/logo.PNG'), 'png')
  assert.equal(imageFormat('/assets/logo.webp'), 'webp')
  assert.equal(imageFormat('/assets/animated.gif'), undefined)
  assert.equal(imageFormat('/assets/logo.svg'), undefined)
  assert.equal(compressedName('/assets/hero.final.JPG'), 'hero.final.compressed.JPG')
})

for (const [name, format] of [['sample.jpg', 'jpeg'], ['sample.png', 'png'], ['sample.webp', 'webp']] as const) {
  it(`packaged WASM compresses ${format} without changing the source bytes`, async () => {
    const original = await fixture(name)
    const snapshot = Buffer.from(original)
    const output = await startCompression(dist, original, format, 75).result
    assert.ok(output.byteLength > 0 && output.byteLength < original.byteLength, `${name} must become smaller`)
    validateImage(output, format)
    assert.deepEqual(original, snapshot)
  })
}

it('compression can be cancelled and the worker is terminated', async () => {
  const job = startCompression(dist, await fixture('sample.png'), 'png', 75)
  job.cancel()
  await assert.rejects(job.result, /cancelled/)
})

it('jpeg EXIF orientation is applied before metadata is removed', async () => {
  const jpeg = await fixture('sample.jpg')
  // Little-endian TIFF, one Orientation entry: rotate 90 degrees clockwise.
  const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex')
  const segment = Buffer.alloc(exif.length + 4)
  segment.writeUInt16BE(0xFFE1); segment.writeUInt16BE(exif.length + 2, 2); exif.copy(segment, 4)
  const oriented = Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
  const result = Buffer.from(await startCompression(dist, oriented, 'jpeg', 75).result)
  let dimensions: number[] | undefined
  for (let offset = 2; offset + 8 < result.length;) {
    const marker = result[offset + 1]
    const length = result.readUInt16BE(offset + 2)
    if (marker === 0xC0 || marker === 0xC2) {
      dimensions = [result.readUInt16BE(offset + 7), result.readUInt16BE(offset + 5)]; break
    }
    offset += length + 2
  }
  assert.deepEqual(dimensions, [160, 256], 'The displayed orientation is preserved in the encoded pixels')
})

it('animation is rejected before a static encoder can discard frames', async () => {
  const png = await fixture('sample.png')
  const animation = Buffer.alloc(20)
  animation.writeUInt32BE(8); animation.write('acTL', 4)
  const animatedPng = Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)])
  assert.throws(() => validateImage(animatedPng, 'png'), /Animated PNG/)
  const animatedWebp = Buffer.alloc(30)
  animatedWebp.write('RIFF'); animatedWebp.writeUInt32LE(22, 4); animatedWebp.write('WEBPVP8X', 8)
  animatedWebp.writeUInt32LE(10, 16); animatedWebp[20] = 2
  assert.throws(() => validateImage(animatedWebp, 'webp'), /Animated WebP/)
})

it('invalid, truncated, oversized and decompression-bomb inputs are rejected', async () => {
  assert.throws(() => validateImage(new Uint8Array(), 'png'), /50 MiB/)
  assert.throws(() => validateImage(Buffer.alloc(maxInputBytes + 1), 'jpeg'), /50 MiB/)
  assert.throws(() => validateImage(Buffer.from('not a PNG image'), 'png'), /not a valid/)
  const png = await fixture('sample.png')
  const oversized = Buffer.from(png)
  oversized.writeUInt32BE(500_000, 16)
  assert.throws(() => validateImage(oversized, 'png'), /40 million/)
  assert.throws(() => validateImage(png.subarray(0, 36), 'png'), /not a valid/)
  await assert.rejects(startCompression(dist, Buffer.from('broken image'), 'jpeg', 75).result, /not a valid JPEG/)
})

it('plugin registration supports discovery, format filtering and safe disposal', async () => {
  const registry = new CompressionRegistry()
  registry.register(jsquashPlugin)
  const custom = { ...jsquashPlugin, id: 'custom', formats: ['png'] as const }
  const registration = registry.register(custom)
  assert.deepEqual(registry.forFormat('png').map(plugin => plugin.id), ['jsquash', 'custom'])
  assert.deepEqual(registry.forFormat('jpeg').map(plugin => plugin.id), ['jsquash'])
  assert.throws(() => registry.register(custom), /already registered/)
  assert.throws(() => registry.register({ ...custom, id: '' }), /plugin IDs/)
  assert.throws(() => registry.start('custom', { bytes: new Uint8Array(), format: 'jpeg', quality: 75 }, pluginContext()), /does not support/)
  registration.dispose()
  registry.register(custom)
  registration.dispose()
  assert.equal(registry.get('custom'), custom, 'Disposing an old registration must not remove a replacement')
  const bytes = await fixture('sample.png')
  const result = await registry.start('custom', { bytes, format: 'png', quality: 75 }, pluginContext()).result
  assert.ok(result.length < bytes.length)
  assert.throws(() => registry.get('missing'), /not available/)
})

it('registry rejects malformed output and unexpected format from any plugin', async () => {
  const registry = new CompressionRegistry()
  registry.register({
    ...jsquashPlugin,
    id: 'broken',
    compress: () => ({ result: Promise.resolve(Buffer.from('broken')), cancel: () => {} }),
  })
  const input = { bytes: await fixture('sample.png'), format: 'png' as const, quality: 75 }
  await assert.rejects(registry.start('broken', input, pluginContext()).result, /not a valid PNG/)
  registry.register({
    ...jsquashPlugin,
    id: 'wrong-format',
    compress: () => ({ result: fixture('sample.jpg'), cancel: () => {} }),
  })
  await assert.rejects(registry.start('wrong-format', input, pluginContext()).result, /not a valid PNG/)
})

it('tinyPNG requires a configured key before making requests', async () => {
  let requested = false
  const plugin = createTinyPngPlugin(async () => { requested = true; throw new Error('Unexpected request') })
  const input = { bytes: await fixture('sample.png'), format: 'png' as const, quality: 75 }
  assert.throws(() => plugin.compress(input, pluginContext('  ')), /User Settings/)
  assert.equal(requested, false)
})

for (const [name, format] of [['sample.jpg', 'jpeg'], ['sample.png', 'png'], ['sample.webp', 'webp']] as const) {
  it(`tinyPNG uploads ${format}, authenticates and downloads without converting or mutating the input`, async () => {
    const original = await fixture(name)
    const snapshot = Buffer.from(original)
    const calls: string[] = []
    const request: typeof fetch = async (url, init) => {
      calls.push(String(url))
      assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${Buffer.from('api:test-key').toString('base64')}`)
      assert.equal(init?.redirect, 'error')
      if (calls.length === 1) {
        assert.equal(init?.method, 'POST')
        assert.deepEqual(init?.body, Uint8Array.from(original))
        return new Response('{}', { status: 201, headers: { location: 'https://api.tinify.com/output/test' } })
      }
      assert.equal(init?.method, undefined)
      return new Response(Uint8Array.from(original))
    }
    const registry = new CompressionRegistry()
    registry.register(createTinyPngPlugin(request))
    const result = await registry.start('tinypng', { bytes: original, format, quality: 1 }, pluginContext(' test-key ')).result
    assert.deepEqual(calls, ['https://api.tinify.com/shrink', 'https://api.tinify.com/output/test'])
    assert.deepEqual(Buffer.from(result), snapshot)
    assert.deepEqual(original, snapshot)
  })
}

it('tinyPNG reports authentication, quota, server and network errors without leaking the key', async () => {
  const input = { bytes: await fixture('sample.png'), format: 'png' as const, quality: 75 }
  for (const [status, message] of [[401, /key is invalid/], [402, /quota/], [429, /rate limit/], [413, /too large/], [503, /HTTP 503/]] as const) {
    const plugin = createTinyPngPlugin(async () => new Response('private test-key', { status }))
    await assert.rejects(plugin.compress(input, pluginContext('test-key')).result, (error: Error) => {
      assert.match(error.message, message)
      assert.doesNotMatch(error.message, /test-key/)
      return true
    })
  }
  const plugin = createTinyPngPlugin(async () => { throw new TypeError('Network failure') })
  await assert.rejects(plugin.compress(input, pluginContext('test-key')).result, /network connection/)
})

it('tinyPNG refuses missing or untrusted output URLs before sending credentials', async () => {
  const input = { bytes: await fixture('sample.png'), format: 'png' as const, quality: 75 }
  for (const location of ['', 'https://example.com/output/test', 'http://api.tinify.com/output/test', 'https://api.tinify.com/unexpected', 'https://user:password@api.tinify.com/output/test']) {
    let requests = 0
    const plugin = createTinyPngPlugin(async () => {
      requests++
      return new Response('{}', { status: 201, headers: location ? { location } : {} })
    })
    await assert.rejects(plugin.compress(input, pluginContext('test-key')).result, /image URL/)
    assert.equal(requests, 1)
  }
})

it('tinyPNG download errors and oversized responses are rejected', async () => {
  const input = { bytes: await fixture('sample.png'), format: 'png' as const, quality: 75 }
  for (const response of [new Response('', { status: 503 }), new Response('', { headers: { 'content-length': String(maxInputBytes + 1) } })]) {
    const plugin = createTinyPngPlugin(async url => String(url).endsWith('/shrink')
      ? new Response('{}', { status: 201, headers: { location: '/output/test' } })
      : response)
    await assert.rejects(plugin.compress(input, pluginContext('test-key')).result, /HTTP 503|50 MiB/)
  }
})

it('tinyPNG cancellation aborts uploads and downloads; timeout also aborts the request', async () => {
  const input = { bytes: await fixture('sample.png'), format: 'png' as const, quality: 75 }
  for (const stage of ['upload', 'download', 'timeout']) {
    let started!: () => void
    let requestSignal: AbortSignal | undefined
    const ready = new Promise<void>((resolve) => { started = resolve })
    const plugin = createTinyPngPlugin(async (url, init) => {
      if (stage === 'download' && String(url).endsWith('/shrink')) {
        return new Response('{}', { status: 201, headers: { location: '/output/test' } })
      }
      requestSignal = init?.signal ?? undefined
      started()
      return new Promise<Response>((_resolve, reject) => {
        requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
      })
    }, stage === 'timeout' ? 10 : 120_000)
    const job = plugin.compress(input, pluginContext('test-key'))
    await ready
    if (stage !== 'timeout') { job.cancel() }
    await assert.rejects(job.result, stage === 'timeout' ? /exceeded 120 seconds/ : /Compression cancelled/)
    assert.equal(requestSignal?.aborted, true)
  }
})
