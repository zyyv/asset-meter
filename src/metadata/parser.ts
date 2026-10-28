import type { AssetMetadata, MetadataInput } from './types'
import { normalizeMetadata } from './normalize'
import { parseExif } from './parsing/exifr'
import { parsePng } from './parsing/png'
import { withMetadataSource } from './parsing/source'
import { parseWebp } from './parsing/webp'

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex')

export async function parseMetadata(input: MetadataInput): Promise<AssetMetadata> {
  const container = await withMetadataSource(input, async (source) => {
    const header = await source.read(0, Math.min(12, source.size))
    if (header.subarray(0, 8).equals(pngSignature)) { return parsePng(source) }
    if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') {
      return parseWebp(source, header)
    }
  })
  // Close our signature reader before exifr opens its own chunked file reader.
  return normalizeMetadata(container ?? await parseExif(input))
}
