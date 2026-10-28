import type { Logger } from '../log'
import type { ImageFormat } from './image'
import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import { compressedName } from './image'

/** Publish a completed copy without replacing an existing file, even across simultaneous batches. */
export async function saveCompressedCopy(source: vscode.Uri, bytes: Uint8Array, format: ImageFormat, signal: AbortSignal, log: Logger): Promise<vscode.Uri> {
  const name = compressedName(source.path, format)
  const extension = posix.extname(name)
  const stem = name.slice(0, -extension.length)
  const temporary = vscode.Uri.joinPath(source, '..', `.asset-meter-${randomUUID()}${extension}`)
  signal.throwIfAborted()
  try {
    await vscode.workspace.fs.writeFile(temporary, bytes)
    for (let suffix = 1; suffix <= 10_000; suffix++) {
      signal.throwIfAborted()
      const target = vscode.Uri.joinPath(source, '..', `${stem}${suffix === 1 ? '' : `-${suffix}`}${extension}`)
      try {
        await vscode.workspace.fs.copy(temporary, target, { overwrite: false })
        return target
      }
      catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileExists') { throw error }
      }
    }
    throw new Error('Could not find an unused output filename.')
  }
  finally {
    try { await vscode.workspace.fs.delete(temporary) }
    catch (error) {
      if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') {
        log.warn(`Could not remove compression temporary file: ${temporary.toString()}`, error)
      }
    }
  }
}
