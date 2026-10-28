import type { MetadataSource } from './source'
import { parseExif, parseSidecar } from './exifr'
import { SegmentBudget } from './source'

const metadataChunks = new Set(['EXIF', 'XMP ', 'ICCP'])

export async function parseWebp({ read, size }: MetadataSource, header: Buffer): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {}
  const end = Math.min(size, header.readUInt32LE(4) + 8)
  const budget = new SegmentBudget('WebP')
  for (let offset = 12; offset + 8 <= end;) {
    budget.nextChunk()
    const chunk = await read(offset, 8)
    const kind = chunk.toString('ascii', 0, 4)
    const length = chunk.readUInt32LE(4)
    if (offset + 8 + length > end) { throw new Error('Truncated WebP chunk.') }
    if (metadataChunks.has(kind)) {
      budget.consume(length)
      let data = await read(offset + 8, length)
      if (kind === 'EXIF') {
        if (data.toString('ascii', 0, 6) === 'Exif\0\0') { data = data.subarray(6) }
        Object.assign(output, await parseExif(data))
      }
      else {
        const segment = kind === 'XMP ' ? 'xmp' : 'icc'
        output[segment] = await parseSidecar(data, segment)
      }
    }
    offset += 8 + length + length % 2
  }
  return output
}
