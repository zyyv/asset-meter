import type { CompressionContext, CompressionInput } from './plugins'
import { CompressionRegistry } from './plugins'
import { CompressionPool } from './pool'
import { jsquashPlugin } from './providers/jsquash'
import { createTinyPngPlugin } from './providers/tinypng'

/** A pool slot covers reading, encoding and writing, so memory use follows concurrency. */
export class CompressionExecutor {
  readonly plugins = new CompressionRegistry()
  readonly pool: CompressionPool

  constructor(concurrency: number) {
    this.pool = new CompressionPool(concurrency)
    this.plugins.register(jsquashPlugin)
    this.plugins.register(createTinyPngPlugin())
  }

  async encode(id: string, input: CompressionInput, context: CompressionContext, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted()
    const job = this.plugins.start(id, input, context)
    const cancel = () => job.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { cancel() }
    try {
      const bytes = await job.result
      signal.throwIfAborted()
      return bytes
    }
    finally { signal.removeEventListener('abort', cancel) }
  }

  dispose(): void { this.pool.dispose() }
}
