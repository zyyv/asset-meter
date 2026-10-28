import type { MetadataInput } from '../types'
import { open } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { metadataLimits } from '../limits'

export interface MetadataSource {
  readonly size: number
  read: (offset: number, length: number) => Promise<Buffer>
}

export async function withMetadataSource<T>(input: MetadataInput, action: (source: MetadataSource) => Promise<T>): Promise<T> {
  const file = typeof input === 'string' ? await open(input, 'r') : undefined
  try {
    const size = file ? (await file.stat()).size : (input as Uint8Array).byteLength
    const read: MetadataSource['read'] = async (offset, length) => {
      if (offset < 0 || length < 0 || length > metadataLimits.segmentBytes || offset + length > size) {
        throw new Error('Invalid or oversized metadata segment.')
      }
      if (!file) {
        const bytes = input as Uint8Array
        return Buffer.from(bytes.buffer, bytes.byteOffset + offset, length)
      }
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await file.read(buffer, 0, length, offset)
      if (bytesRead !== length) { throw new Error('Image changed while reading metadata.') }
      return buffer
    }
    return await action({ size, read })
  }
  finally { await file?.close() }
}

export class SegmentBudget {
  private chunks = 0
  private encoded = 0
  private decoded = 0
  constructor(private readonly format: 'PNG' | 'WebP') {}

  nextChunk(): void {
    if (++this.chunks > metadataLimits.chunks) { throw new Error(`Too many ${this.format} chunks.`) }
  }

  consume(length: number): void {
    this.encoded += length
    if (this.encoded > metadataLimits.segmentBytes) { this.exceeded() }
  }

  decode(data: Buffer, compressed = false): Buffer {
    const remaining = metadataLimits.segmentBytes - this.decoded
    let result = data
    if (compressed) {
      if (remaining <= 0) { this.exceeded() }
      try { result = inflateSync(data, { maxOutputLength: remaining }) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') { this.exceeded() }
        throw error
      }
    }
    this.decoded += result.byteLength
    if (this.decoded > metadataLimits.segmentBytes) { this.exceeded() }
    return result
  }

  private exceeded(): never { throw new Error(`Metadata exceeds the ${metadataLimits.segmentBytes / 1024 ** 2} MiB parsing limit.`) }
}
