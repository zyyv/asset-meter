import type { MetadataSource } from './source'
import { parseExif, parseSidecar } from './exifr'
import { SegmentBudget } from './source'

const metadataChunks = new Set(['IHDR', 'eXIf', 'iCCP', 'tEXt', 'zTXt', 'iTXt'])

function textChunk(data: Buffer, kind: string, budget: SegmentBudget): { key: string, value: Buffer } {
  const separator = data.indexOf(0)
  if (separator < 0) { throw new Error('Invalid PNG text chunk.') }
  const key = data.toString('latin1', 0, separator)
  let value = data.subarray(separator + 1)
  let compressed = false
  if (kind === 'zTXt') {
    if (value[0] !== 0) { throw new Error('Unsupported PNG text compression.') }
    compressed = true
    value = value.subarray(1)
  }
  else if (kind === 'iTXt') {
    if (value.length < 4 || value[0]! > 1 || value[1] !== 0) { throw new Error('Invalid PNG international text.') }
    compressed = value[0] === 1
    const languageEnd = value.indexOf(0, 2)
    const translatedEnd = value.indexOf(0, languageEnd + 1)
    if (languageEnd < 0 || translatedEnd < 0) { throw new Error('Invalid PNG text header.') }
    value = value.subarray(translatedEnd + 1)
  }
  return { key, value: budget.decode(value, compressed) }
}

export async function parsePng({ read, size }: MetadataSource): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {}
  const text: Record<string, string> = Object.create(null)
  const budget = new SegmentBudget('PNG')
  for (let offset = 8; offset + 12 <= size;) {
    budget.nextChunk()
    const header = await read(offset, 8)
    const length = header.readUInt32BE(0)
    const kind = header.toString('ascii', 4, 8)
    if (offset + 12 + length > size) { throw new Error('Truncated PNG chunk.') }
    if (kind === 'IEND') { break }
    if (metadataChunks.has(kind)) {
      budget.consume(length)
      const data = await read(offset + 8, length)
      if (kind === 'IHDR') {
        if (length !== 13) { throw new Error('Invalid PNG header.') }
        budget.decode(data)
        output.ihdr = { ImageWidth: data.readUInt32BE(0), ImageHeight: data.readUInt32BE(4), BitDepth: data[8] }
      }
      else if (kind === 'eXIf') { Object.assign(output, await parseExif(budget.decode(data))) }
      else if (kind === 'iCCP') {
        const separator = data.indexOf(0)
        if (separator < 0 || data[separator + 1] !== 0) { throw new Error('Invalid PNG color profile.') }
        output.icc = await parseSidecar(budget.decode(data.subarray(separator + 2), true), 'icc')
      }
      else {
        const { key, value } = textChunk(data, kind, budget)
        if (key === 'XML:com.adobe.xmp') { output.xmp = await parseSidecar(value, 'xmp') }
        else { text[key] = value.toString(kind === 'iTXt' ? 'utf8' : 'latin1') }
      }
    }
    offset += length + 12
  }
  output.pngText = text
  return output
}
