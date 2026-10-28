import { parentPort } from 'node:worker_threads'
import { parseMetadata } from './parser'

parentPort?.on('message', (input: string | Uint8Array) => {
  void parseMetadata(input).then(result => parentPort?.postMessage(result)).catch((error: unknown) => {
    parentPort?.postMessage({ status: 'error', groups: [], message: error instanceof Error ? error.message : String(error) })
  })
})
