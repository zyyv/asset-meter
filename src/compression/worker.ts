import type { ImageFormat } from './image'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { assertDimensions, validateImage } from './image'

interface Request { bytes: Uint8Array, format: ImageFormat, outputFormat: ImageFormat, quality: number, wasmDirectory: string }

async function compress({ bytes, format, outputFormat = format, quality, wasmDirectory }: Request): Promise<Uint8Array> {
  validateImage(bytes, format)
  const wasm = async (name: string) => WebAssembly.compile(await readFile(join(wasmDirectory, name)))
  if (format === 'png' && outputFormat === 'png') {
    // The low-level API accepts PNG bytes directly and preserves all pixel values.
    const { default: init, optimise } = await import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js')
    await init(await wasm('squoosh_oxipng_bg.wasm'))
    return optimise(bytes, 2, false, false)
  }
  // The decoder applies JPEG EXIF orientation before metadata is removed.
  const input = Uint8Array.from(bytes).buffer
  const image = await (async () => {
    if (format === 'png') {
      const { default: decode, init } = await import('@jsquash/png/decode.js')
      await init(await wasm('squoosh_png_bg.wasm'))
      return decode(input)
    }
    const decoder = format === 'jpeg' ? await import('@jsquash/jpeg/decode.js') : await import('@jsquash/webp/decode.js')
    await (decoder.init as (module: WebAssembly.Module) => Promise<unknown>)(await wasm(format === 'jpeg' ? 'mozjpeg_dec.wasm' : 'webp_dec.wasm'))
    return format === 'jpeg' ? decoder.default(input, { preserveOrientation: true }) : decoder.default(input)
  })()
  assertDimensions(image.width, image.height)
  if (outputFormat === 'png') {
    const { default: init, optimise_raw: encode } = await import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js')
    await init(await wasm('squoosh_oxipng_bg.wasm'))
    return encode(image.data, image.width, image.height, 2, false, false)
  }
  if (outputFormat === 'jpeg') {
    // JPEG has no alpha channel. Composite onto white instead of exposing hidden RGB.
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const alpha = image.data[offset + 3]! / 255
      if (alpha === 1) { continue }
      for (let channel = 0; channel < 3; channel++) {
        image.data[offset + channel] = Math.round(image.data[offset + channel]! * alpha + 255 * (1 - alpha))
      }
      image.data[offset + 3] = 255
    }
    const { default: encode, init } = await import('@jsquash/jpeg/encode.js')
    await (init as (module: WebAssembly.Module) => Promise<void>)(await wasm('mozjpeg_enc.wasm'))
    return new Uint8Array(await encode(image, { quality }))
  }
  if (outputFormat !== 'webp') { throw new Error(`Unsupported output format: ${outputFormat}`) }
  // Choose the scalar encoder explicitly so the packaged WASM always matches it.
  const { default: factory } = await import('@jsquash/webp/codec/enc/webp_enc.js')
  const { initEmscriptenModule } = await import('@jsquash/webp/utils.js')
  const { defaultOptions } = await import('@jsquash/webp/meta.js')
  const encoder = await initEmscriptenModule(factory, await wasm('webp_enc.wasm'))
  const result = encoder.encode(image.data, image.width, image.height, { ...defaultOptions, quality })
  if (!result) { throw new Error('WebP encoding failed.') }
  return new Uint8Array(result)
}

void compress(workerData as Request).then((bytes) => {
  parentPort?.postMessage({ bytes })
}).catch((error) => {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) })
})
