import type { ImageFormat } from './image'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

export interface CompressionJob { result: Promise<Uint8Array>, cancel: () => void }

export function startCompression(distDirectory: string, bytes: Uint8Array, format: ImageFormat, quality: number): CompressionJob {
  const worker = new Worker(join(distDirectory, 'compression-worker.mjs'), {
    workerData: { bytes, format, quality, wasmDirectory: join(distDirectory, 'codecs') },
  })
  let cancel = () => {}
  const result = new Promise<Uint8Array>((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error, output?: Uint8Array) => {
      if (settled) { return }
      settled = true
      if (timeout) { clearTimeout(timeout) }
      void worker.terminate()
      if (error) { reject(error) }
      else if (output) { resolve(output) }
    }
    timeout = setTimeout(() => finish(new Error('Compression exceeded 120 seconds. Try a smaller image.')), 120_000)
    cancel = () => finish(new Error('Compression cancelled.'))
    worker.once('message', (message: { bytes?: Uint8Array, error?: string }) => {
      if (message.error || !message.bytes?.length) { finish(new Error(message.error ?? 'The encoder returned an empty image.')) }
      else { finish(undefined, message.bytes) }
    })
    worker.once('error', error => finish(error))
    worker.once('exit', code => finish(new Error(`Image compression worker exited before returning an image (code ${code}).`)))
  })
  return { result, cancel: () => cancel() }
}
