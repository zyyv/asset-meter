import type { CompressionPlugin } from '../plugins'
import { startCompression } from '../runner'

export const jsquashPlugin: CompressionPlugin = {
  id: 'jsquash',
  label: 'jSquash',
  description: 'Local · no uploads or API key',
  formats: ['jpeg', 'png', 'webp'],
  describe: ({ format, quality }) => format === 'png' ? 'Lossless PNG' : `${format.toUpperCase()} · quality ${quality}`,
  compress: ({ bytes, format, quality }, { distDirectory }) => startCompression(distDirectory, bytes, format, quality),
}
