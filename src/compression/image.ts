import { basename, extname } from 'node:path'

export type ImageFormat = 'jpeg' | 'png' | 'webp'
export type SaveBehavior = 'ask' | 'saveAs' | 'overwrite'
export const maxInputBytes = 50 * 1024 ** 2
export const maxPixels = 40_000_000

export function imageFormat(path: string): ImageFormat | undefined {
  switch (extname(path).toLowerCase()) {
    case '.jpg': case '.jpeg': case '.jpe': return 'jpeg'
    case '.png': return 'png'
    case '.webp': return 'webp'
    default: return undefined
  }
}

export function compressedName(path: string, outputFormat?: ImageFormat): string {
  const name = basename(path)
  const extension = extname(name)
  const outputExtension = outputFormat && outputFormat !== imageFormat(path) ? `.${outputFormat === 'jpeg' ? 'jpg' : outputFormat}` : extension
  return `${name.slice(0, -extension.length)}.compressed${outputExtension}`
}

export function assertDimensions(width: number, height: number): void {
  if (!width || !height || width * height > maxPixels) {
    throw new Error('Images must contain at most 40 million pixels. Resize this image before compressing it.')
  }
}

/** Validate headers before a decoder allocates memory; never flatten an animation. */
export function validateImage(bytes: Uint8Array, format: ImageFormat): void {
  if (!bytes.length || bytes.length > maxInputBytes) { throw new Error('Choose an image smaller than 50 MiB.') }
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const invalid = () => { throw new Error(`This file is not a valid ${format.toUpperCase()} image.`) }
  if (format === 'png') {
    if (data.length < 33 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || data.toString('ascii', 12, 16) !== 'IHDR') { invalid() }
    assertDimensions(data.readUInt32BE(16), data.readUInt32BE(20))
    let hasImageData = false
    let ended = false
    for (let offset = 8; offset + 12 <= data.length;) {
      const length = data.readUInt32BE(offset)
      if (offset + length + 12 > data.length) { invalid() }
      const chunk = data.toString('ascii', offset + 4, offset + 8)
      if (chunk === 'acTL') { throw new Error('Animated PNG images are not supported. The animation has been left unchanged.') }
      if (chunk === 'IDAT') { hasImageData = true }
      if (chunk === 'IEND') { ended = true; break }
      offset += length + 12
    }
    if (!hasImageData || !ended) { invalid() }
  }
  else if (format === 'webp') {
    if (data.length < 20 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') { invalid() }
    let foundDimensions = false
    for (let offset = 12; offset + 8 <= data.length;) {
      const chunk = data.toString('ascii', offset, offset + 4)
      const length = data.readUInt32LE(offset + 4)
      const start = offset + 8
      if (start + length > data.length) { invalid() }
      if (chunk === 'ANIM' || chunk === 'ANMF' || (chunk === 'VP8X' && length >= 10 && (data[start]! & 2))) {
        throw new Error('Animated WebP images are not supported. The animation has been left unchanged.')
      }
      if (chunk === 'VP8X' && length >= 10) {
        assertDimensions(data.readUIntLE(start + 4, 3) + 1, data.readUIntLE(start + 7, 3) + 1); foundDimensions = true
      }
      else if (chunk === 'VP8 ' && length >= 10) {
        assertDimensions(data.readUInt16LE(start + 6) & 0x3FFF, data.readUInt16LE(start + 8) & 0x3FFF); foundDimensions = true
      }
      else if (chunk === 'VP8L' && length >= 5) {
        const bits = data.readUInt32LE(start + 1)
        assertDimensions((bits & 0x3FFF) + 1, ((bits >>> 14) & 0x3FFF) + 1); foundDimensions = true
      }
      offset = start + length + (length % 2)
    }
    if (!foundDimensions) { invalid() }
  }
  else {
    if (data[0] !== 0xFF || data[1] !== 0xD8) { invalid() }
    let foundDimensions = false
    for (let offset = 2; offset + 4 <= data.length;) {
      if (data[offset++] !== 0xFF) { invalid() }
      while (data[offset] === 0xFF) { offset++ }
      const marker = data[offset++]
      if (marker === 0xDA || marker === 0xD9) { break }
      if (marker === 0x01 || (marker !== undefined && marker >= 0xD0 && marker <= 0xD7)) { continue }
      if (offset + 2 > data.length) { invalid() }
      const length = data.readUInt16BE(offset)
      if (length < 2 || offset + length > data.length) { invalid() }
      if (marker !== undefined && [0xC0, 0xC1, 0xC2].includes(marker) && length >= 8) {
        assertDimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)); foundDimensions = true
      }
      offset += length
    }
    if (!foundDimensions) { invalid() }
  }
}
