import type { ImageFormat } from './image'
import type { CompressionJob } from './runner'
import { validateImage } from './image'

export interface CompressionInput {
  readonly bytes: Uint8Array
  readonly format: ImageFormat
  readonly quality: number
  readonly outputFormat?: ImageFormat
}

export interface CompressionContext {
  readonly distDirectory: string
  getSetting: <T>(key: string, fallback: T) => T
}

/** Plugins keep encoding, configuration and cancellation out of the preview UI. */
export interface CompressionPlugin {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly formats: readonly ImageFormat[]
  /** Additional output formats; omitted by plugins that only preserve the source format. */
  readonly outputFormats?: readonly ImageFormat[]
  /** Omit for configurable quality; automatic providers choose their own quality. */
  readonly quality?: 'configurable' | 'automatic'
  describe: (input: CompressionInput) => string
  compress: (input: CompressionInput, context: CompressionContext) => CompressionJob
}

export class CompressionRegistry {
  private readonly plugins = new Map<string, CompressionPlugin>()

  register(plugin: CompressionPlugin): { dispose: () => void } {
    if (!/^[a-z][\w.-]*$/i.test(plugin.id)) { throw new Error('Compression plugin IDs must start with a letter and contain only letters, numbers, underscores, dots or hyphens.') }
    if (this.plugins.has(plugin.id)) { throw new Error(`Compression plugin "${plugin.id}" is already registered.`) }
    this.plugins.set(plugin.id, plugin)
    let disposed = false
    return { dispose: () => {
      if (disposed) { return }
      disposed = true
      if (this.plugins.get(plugin.id) === plugin) { this.plugins.delete(plugin.id) }
    } }
  }

  get(id: string): CompressionPlugin {
    const plugin = this.plugins.get(id)
    if (!plugin) { throw new Error(`Compression plugin "${id}" is not available. Choose another plugin.`) }
    return plugin
  }

  forFormat(format: ImageFormat, outputFormat: ImageFormat = format): CompressionPlugin[] {
    return [...this.plugins.values()].filter(plugin => plugin.formats.includes(format)
      && (outputFormat === format || plugin.outputFormats?.includes(outputFormat)))
  }

  start(id: string, input: CompressionInput, context: CompressionContext): CompressionJob {
    const plugin = this.get(id)
    if (!plugin.formats.includes(input.format)) { throw new Error(`${plugin.label} does not support ${input.format.toUpperCase()} images.`) }
    const outputFormat = input.outputFormat ?? input.format
    if (outputFormat !== input.format && !plugin.outputFormats?.includes(outputFormat)) {
      throw new Error(`${plugin.label} does not support conversion to ${outputFormat.toUpperCase()}.`)
    }
    validateImage(input.bytes, input.format)
    const job = plugin.compress(input, context)
    return {
      cancel: () => job.cancel(),
      result: job.result.then((bytes) => {
        validateImage(bytes, outputFormat)
        return bytes
      }),
    }
  }
}
