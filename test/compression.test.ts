import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { compressedName, imageFormat, maxInputBytes, validateImage } from '../src/compression/image'
import { startCompression } from '../src/compression/runner'

const fixture = (name: string) => readFile(path.join(__dirname, 'fixtures', name))
const dist = path.resolve(__dirname, '../dist')

test('supported image formats and Save As names preserve extension and basename', () => {
  assert.equal(imageFormat('/assets/HERO.JPEG'), 'jpeg')
  assert.equal(imageFormat('/assets/hero.jpe'), 'jpeg')
  assert.equal(imageFormat('/assets/logo.PNG'), 'png')
  assert.equal(imageFormat('/assets/logo.webp'), 'webp')
  assert.equal(imageFormat('/assets/animated.gif'), undefined)
  assert.equal(imageFormat('/assets/logo.svg'), undefined)
  assert.equal(compressedName('/assets/hero.final.JPG'), 'hero.final.compressed.JPG')
})

for (const [name, format] of [['sample.jpg', 'jpeg'], ['sample.png', 'png'], ['sample.webp', 'webp']] as const) {
  test(`packaged WASM compresses ${format} without changing the source bytes`, async () => {
    const original = await fixture(name)
    const snapshot = Buffer.from(original)
    const output = await startCompression(dist, original, format, 75).result
    assert.ok(output.byteLength > 0 && output.byteLength < original.byteLength, `${name} must become smaller`)
    validateImage(output, format)
    assert.deepEqual(original, snapshot)
  })
}

test('compression can be cancelled and the worker is terminated', async () => {
  const job = startCompression(dist, await fixture('sample.png'), 'png', 75)
  job.cancel()
  await assert.rejects(job.result, /cancelled/)
})

test('JPEG EXIF orientation is applied before metadata is removed', async () => {
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

test('animation is rejected before a static encoder can discard frames', async () => {
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

test('invalid, truncated, oversized and decompression-bomb inputs are rejected', async () => {
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
