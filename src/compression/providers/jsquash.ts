import type { CompressionPlugin } from '../plugins'
import { startCompression } from '../runner'

export const jsquashPlugin: CompressionPlugin = {
  id: 'jsquash',
  label: 'jSquash',
  description: 'Local · no uploads or API key',
  formats: ['jpeg', 'png', 'webp'],
  outputFormats: ['jpeg', 'png', 'webp'],
  describe: ({ format, outputFormat = format, quality }) => outputFormat === 'png' ? 'Lossless PNG' : `${outputFormat.toUpperCase()} · quality ${quality}`,
  compress: ({ bytes, format, quality, outputFormat }, { distDirectory }) => startCompression(distDirectory, bytes, format, quality, outputFormat),
}
