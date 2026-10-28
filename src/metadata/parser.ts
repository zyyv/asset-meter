import type { FileHandle } from 'node:fs/promises'
import type { AssetMetadata } from './types'
import { open } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import * as exifr from 'exifr'
import { normalizeMetadata } from './types'

const options = { xmp: true, iptc: true, icc: true, jfif: false, ihdr: true, mergeOutput: false, makerNote: false, userComment: true }
const maxSegmentBytes = 8 * 1024 * 1024
type Read = (offset: number, length: number) => Promise<Buffer>

// exifr 7.1.3 passes a pathname to FileHandle.stat(), whose modern Node API
// accepts only an options object. Replace its fs reader via the plugin registry
// so large JPEG/TIFF/HEIF files retain chunked reads on current VS Code hosts.
const FsReader = exifr.fileReaders.get('fs') as new (...args: unknown[]) => { input: string, fh?: FileHandle, size: number }
class NodeFileReader extends FsReader {
  async open(): Promise<void> {
    if (this.fh) { return }
    this.fh = await open(this.input, 'r')
    this.size = (await this.fh.stat()).size
  }
}
exifr.fileReaders.set('fs', NodeFileReader)

async function parsePng(read: Read, size: number): Promise<AssetMetadata> {
  const output: Record<string, unknown> = {}
  const text: Record<string, string> = Object.create(null)
  let total = 0
  let chunks = 0
  for (let offset = 8; offset + 12 <= size;) {
    if (++chunks > 4096) { throw new Error('Too many PNG chunks.') }
    const header = await read(offset, 8)
    const length = header.readUInt32BE(0)
    const name = header.toString('ascii', 4, 8)
    if (offset + 12 + length > size) { throw new Error('Truncated PNG chunk.') }
    if (name === 'IEND') { break }
    if (['IHDR', 'eXIf', 'iCCP', 'tEXt', 'zTXt', 'iTXt'].includes(name)) {
      total += length
      if (total > maxSegmentBytes) { throw new Error('Metadata exceeds the 8 MiB parsing limit.') }
      const data = await read(offset + 8, length)
      if (name === 'IHDR') {
        if (length !== 13) { throw new Error('Invalid PNG header.') }
        output.ihdr = { ImageWidth: data.readUInt32BE(0), ImageHeight: data.readUInt32BE(4), BitDepth: data[8], ColorType: data[9], Compression: data[10], Filter: data[11], Interlace: data[12] }
      }
      else if (name === 'eXIf') { Object.assign(output, await exifr.parse(data, options)) }
      else if (name === 'iCCP') {
        const separator = data.indexOf(0)
        if (separator < 0 || data[separator + 1] !== 0) { throw new Error('Invalid PNG color profile.') }
        const profile = inflateSync(data.subarray(separator + 2), { maxOutputLength: maxSegmentBytes })
        output.icc = await exifr.sidecar(profile, {}, 'icc')
      }
      else {
        const separator = data.indexOf(0)
        if (separator < 0) { throw new Error('Invalid PNG text chunk.') }
        const key = data.toString('latin1', 0, separator)
        let value = data.subarray(separator + 1)
        if (name === 'zTXt') {
          if (value[0] !== 0) { throw new Error('Unsupported PNG text compression.') }
          value = inflateSync(value.subarray(1), { maxOutputLength: maxSegmentBytes })
        }
        else if (name === 'iTXt') {
          const compressed = value[0] === 1
          if (value.length < 4 || value[0]! > 1 || value[1] !== 0) { throw new Error('Invalid PNG international text.') }
          const languageEnd = value.indexOf(0, 2)
          const translatedEnd = value.indexOf(0, languageEnd + 1)
          if (languageEnd < 0 || translatedEnd < 0) { throw new Error('Invalid PNG text header.') }
          value = value.subarray(translatedEnd + 1)
          if (compressed) { value = inflateSync(value, { maxOutputLength: maxSegmentBytes }) }
        }
        if (key === 'XML:com.adobe.xmp') { output.xmp = await exifr.sidecar(value, {}, 'xmp') }
        else { text[key] = value.toString(name === 'iTXt' ? 'utf8' : 'latin1') }
      }
    }
    offset += length + 12
  }
  output.pngText = text
  return normalizeMetadata(output)
}

export async function parseMetadata(input: string | Uint8Array): Promise<AssetMetadata> {
  // exifr supports JPEG, TIFF, PNG and HEIF directly. WebP stores the same
  // EXIF/XMP payloads in RIFF chunks; pass those payloads to exifr separately.
  const file = typeof input === 'string' ? await open(input, 'r') : undefined
  try {
    const size = file ? (await file.stat()).size : (input as Uint8Array).length
    const read = async (offset: number, length: number) => {
      if (length > maxSegmentBytes || offset + length > size) { throw new Error('Invalid or oversized metadata segment.') }
      if (!file) { return Buffer.from((input as Uint8Array).subarray(offset, offset + length)) }
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await file.read(buffer, 0, length, offset)
      if (bytesRead !== length) { throw new Error('Image changed while reading metadata.') }
      return buffer
    }
    const header = await read(0, Math.min(12, size))
    if (header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) { return await parsePng(read, size) }
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WEBP') {
      return normalizeMetadata(await exifr.parse(input, options))
    }
    const output: Record<string, unknown> = {}
    const end = Math.min(size, header.readUInt32LE(4) + 8)
    let total = 0
    let chunks = 0
    for (let offset = 12; offset + 8 <= end;) {
      if (++chunks > 4096) { throw new Error('Too many WebP chunks.') }
      const chunk = await read(offset, 8)
      const name = chunk.toString('ascii', 0, 4)
      const length = chunk.readUInt32LE(4)
      if (offset + 8 + length > end) { throw new Error('Truncated WebP chunk.') }
      if (name === 'EXIF' || name === 'XMP ' || name === 'ICCP') {
        total += length
        if (total > maxSegmentBytes) { throw new Error('Metadata exceeds the 8 MiB parsing limit.') }
        let data = await read(offset + 8, length)
        if (name === 'EXIF') {
          if (data.toString('ascii', 0, 6) === 'Exif\0\0') { data = data.subarray(6) }
          Object.assign(output, await exifr.parse(data, options))
        }
        else {
          const segment = name === 'XMP ' ? 'xmp' : 'icc'
          output[segment] = await exifr.sidecar(data, {}, segment)
        }
      }
      offset += 8 + length + length % 2
    }
    return normalizeMetadata(output)
  }
  finally { await file?.close() }
}
