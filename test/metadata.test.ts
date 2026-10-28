import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { it } from 'vitest'
import { hasMetadata, normalizeMetadata } from '../src/metadata/normalize'
import { parseMetadata } from '../src/metadata/parser'
import { MetadataWorker } from '../src/metadata/runner'

const fixture = (name: string) => readFile(path.join(__dirname, 'fixtures', name))
const tiff = Buffer.from('49492a0008000000010012010300010000000600000000000000', 'hex')
const xmp = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:description="Shared metadata"/></rdf:RDF></x:xmpmeta>')

function pngChunk(name: string, data: Buffer): Buffer {
  // The parser does not decode image pixels or consume CRC values.
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length); chunk.write(name, 4); data.copy(chunk, 8)
  return chunk
}

function webpChunk(name: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 8 + data.length % 2)
  chunk.write(name); chunk.writeUInt32LE(data.length, 4); data.copy(chunk, 8)
  return chunk
}

it('parses JPEG EXIF through the bundled worker using both file paths and buffers, and reuses it', async () => {
  const jpeg = await fixture('sample.jpg')
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const segment = Buffer.alloc(exif.length + 4)
  segment.writeUInt16BE(0xFFE1); segment.writeUInt16BE(exif.length + 2, 2); exif.copy(segment, 4)
  const image = Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
  const temporary = await mkdtemp(path.join(tmpdir(), 'asset-metadata-'))
  const filename = path.join(temporary, 'image.jpg')
  const reader = new MetadataWorker(path.resolve(__dirname, '../dist'))
  try {
    await writeFile(filename, image)
    const local = await reader.parse(filename)
    const buffer = await reader.parse(image)
    assert.deepEqual(local, buffer)
    assert.equal(local.status, 'ready')
    assert.ok(local.groups.some(group => group.fields.some(field => field.name === 'Orientation' && field.value.includes('90'))))
    assert.equal((await reader.parse(Buffer.from('broken image'))).status, 'error')
    assert.equal((await reader.parse(image)).status, 'ready', 'a malformed resource must not break subsequent parses')
  }
  finally { reader.dispose(); await rm(temporary, { recursive: true, force: true }) }
})

it('reads PNG text after image data, compressed and international text, XMP and EXIF without classifying IHDR as metadata', async () => {
  const png = await fixture('sample.png')
  const plain = await parseMetadata(png)
  assert.equal(plain.status, 'empty')
  assert.equal(hasMetadata(plain), false)
  const image = Buffer.concat([
    png.subarray(0, png.length - 12),
    pngChunk('tEXt', Buffer.from('Author\0Asset Meter')),
    pngChunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0'), deflateSync('Compressed metadata')])),
    pngChunk('iTXt', Buffer.concat([Buffer.from('Description\0\0\0\0\0'), Buffer.from('中文说明')])),
    pngChunk('iTXt', Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0'), xmp])),
    pngChunk('eXIf', tiff),
    png.subarray(png.length - 12),
  ])
  const result = await parseMetadata(image)
  assert.equal(result.status, 'ready')
  const text = result.groups.find(group => group.name === 'pngText')?.fields
  assert.deepEqual(text, [{ name: 'Author', value: 'Asset Meter' }, { name: 'Comment', value: 'Compressed metadata' }, { name: 'Description', value: '中文说明' }])
  assert.ok(result.groups.some(group => group.name === 'ifd0'))
  assert.ok(JSON.stringify(result).includes('Shared metadata'))
  const padded = Buffer.concat([Buffer.alloc(17, 0xAA), image, Buffer.alloc(11, 0xBB)])
  const view = new Uint8Array(padded.buffer, padded.byteOffset + 17, image.byteLength)
  assert.deepEqual(await parseMetadata(view), result, 'zero-copy reads honor the input view offset and length')
})

it('extracts WebP EXIF and XMP from RIFF chunks, skipping pixel data', async () => {
  const header = Buffer.alloc(12)
  header.write('RIFF'); header.write('WEBP', 8)
  const chunks = [webpChunk('VP8 ', Buffer.alloc(100)), webpChunk('EXIF', tiff), webpChunk('XMP ', xmp)]
  header.writeUInt32LE(4 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4)
  const result = await parseMetadata(Buffer.concat([header, ...chunks]))
  assert.equal(result.status, 'ready')
  assert.ok(JSON.stringify(result).includes('Orientation'))
  assert.ok(JSON.stringify(result).includes('Shared metadata'))
})

it('bounds large and binary metadata output and rejects truncated chunks', async () => {
  const normalized = normalizeMetadata({
    exif: { DateTimeOriginal: new Date('2026-01-01T00:00:00Z'), MakerNote: new Uint8Array(100_000), UserComment: 'x'.repeat(100_000), ExifVersion: '0232', ISO: 100 },
    userComment: new Uint8Array(64),
    icc: { ProfileDescription: 'sRGB', RedMatrixColumn: [0.4, 0.2, 0.1] },
  })
  assert.equal(normalized.truncated, true)
  assert.ok(JSON.stringify(normalized).length < 3000)
  assert.ok(!JSON.stringify(normalized).includes('100000 bytes'))
  assert.ok(!normalized.groups.some(group => group.name === 'userComment'), 'raw byte arrays must not become numbered metadata rows')
  assert.ok(!JSON.stringify(normalized).includes('ExifVersion'))
  assert.ok(!JSON.stringify(normalized).includes('RedMatrixColumn'))
  assert.ok(JSON.stringify(normalized).includes('sRGB'))
  assert.ok(normalized.groups.some(group => group.fields.some(field => field.name === 'ISO' && field.value === '100')))
  const png = await fixture('sample.png')
  const bad = Buffer.from(png)
  bad.writeUInt32BE(0xFFFFFFFF, 8)
  await assert.rejects(parseMetadata(bad), /Truncated PNG/)
})

it('terminates an active metadata worker on disposal', async () => {
  const reader = new MetadataWorker(path.resolve(__dirname, '../dist'))
  const pending = reader.parse(await fixture('sample.jpg'))
  reader.dispose()
  await assert.rejects(pending, /cancelled/)
})

it('bounds the combined expanded size of separate compressed PNG metadata chunks', async () => {
  const png = await fixture('sample.png')
  const compressed = (name: string, size: number) => pngChunk('zTXt', Buffer.concat([Buffer.from(`${name}\0\0`), deflateSync(Buffer.alloc(size, 65))]))
  const image = Buffer.concat([
    png.subarray(0, -12),
    compressed('First', 5 * 1024 * 1024),
    compressed('Second', 4 * 1024 * 1024),
    png.subarray(-12),
  ])
  assert.ok(image.byteLength - png.byteLength < 100_000, 'the compressed metadata alone does not reveal its expanded cost')
  await assert.rejects(parseMetadata(image), /8 MiB parsing limit/)
})
