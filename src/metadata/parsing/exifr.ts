import type { FileHandle } from 'node:fs/promises'
import type { MetadataInput } from '../types'
import { open } from 'node:fs/promises'
import * as exifr from 'exifr'

const options = { xmp: true, iptc: true, icc: true, jfif: false, ihdr: true, mergeOutput: false, makerNote: false, userComment: true }

// exifr 7.1.3 passes a pathname to FileHandle.stat(). Modern Node accepts only
// options, so replace that adapter while keeping exifr's chunked file reads.
const FsReader = exifr.fileReaders.get('fs') as new (...args: unknown[]) => { input: string, fh?: FileHandle, size: number }
class NodeFileReader extends FsReader {
  async open(): Promise<void> {
    if (this.fh) { return }
    this.fh = await open(this.input, 'r')
    this.size = (await this.fh.stat()).size
  }
}
exifr.fileReaders.set('fs', NodeFileReader)

export const parseExif = (input: MetadataInput): Promise<unknown> => exifr.parse(input, options)
export const parseSidecar = (input: Uint8Array, format: 'xmp' | 'icc'): Promise<unknown> => exifr.sidecar(input, {}, format)
