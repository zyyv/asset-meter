import type { AssetMetadata } from './types'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

export class MetadataWorker {
  private worker?: Worker
  private idle?: ReturnType<typeof setTimeout>
  private cancel?: () => void

  constructor(private readonly distDirectory: string) {}

  // MetadataService serializes calls, so one reusable worker serves the cache.
  parse(input: string | Uint8Array): Promise<AssetMetadata> {
    if (this.cancel) { return Promise.reject(new Error('Metadata worker is busy.')) }
    if (this.idle) { clearTimeout(this.idle) }
    return new Promise((resolve, reject) => {
      let worker: Worker
      try {
        worker = this.worker ??= new Worker(join(this.distDirectory, 'metadata-worker.mjs'), { resourceLimits: { maxOldGenerationSizeMb: 128 } })
      }
      catch (error) { reject(error); return }
      let timeout: ReturnType<typeof setTimeout> | undefined
      let settled = false
      let finish: (error?: Error, result?: AssetMetadata) => void
      const onMessage = (result: AssetMetadata) => finish(undefined, result)
      const onError = (error: Error) => finish(error)
      const onExit = (code: number) => finish(new Error(`Metadata worker exited (code ${code}).`))
      finish = (error, result) => {
        if (settled) { return }
        settled = true
        if (timeout) { clearTimeout(timeout) }
        worker.removeListener('message', onMessage)
        worker.removeListener('error', onError)
        worker.removeListener('exit', onExit)
        this.cancel = undefined
        if (error) { this.stop(); reject(error) }
        else {
          this.idle = setTimeout(() => this.stop(), 15_000)
          this.idle.unref()
          resolve(result!)
        }
      }
      timeout = setTimeout(() => finish(new Error('Metadata parsing exceeded 10 seconds.')), 10_000)
      this.cancel = () => finish(new Error('Metadata parsing cancelled.'))
      worker.once('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
      try { worker.postMessage(input) }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  private stop(): void {
    if (this.idle) { clearTimeout(this.idle); this.idle = undefined }
    void this.worker?.terminate()
    this.worker = undefined
  }

  dispose(): void { this.cancel?.(); this.stop() }
}
