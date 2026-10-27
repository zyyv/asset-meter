import type { CompressionPlugin } from '../plugins'
import { maxInputBytes } from '../image'

const apiOrigin = 'https://api.tinify.com'

async function checkResponse(response: Response): Promise<void> {
  if (response.ok) { return }
  await response.body?.cancel()
  // Keep service responses and credentials out of user-visible errors.
  if (response.status === 401) { throw new Error('TinyPNG API key is invalid. Update assetMeter.compression.tinypng.apiKey in User Settings.') }
  if (response.status === 402 || response.status === 429) { throw new Error('TinyPNG quota or rate limit reached. Check your account or try again later.') }
  if (response.status === 413) { throw new Error('TinyPNG rejected this image because it is too large. Choose a smaller image or use jSquash.') }
  throw new Error(`TinyPNG request failed (HTTP ${response.status}). Try again later or use jSquash.`)
}

async function readImage(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maxInputBytes) {
    await response.body?.cancel()
    throw new Error('TinyPNG returned an image larger than 50 MiB.')
  }
  if (!response.body) { throw new Error('TinyPNG returned an empty image.') }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { break }
      size += value.length
      if (size > maxInputBytes) { throw new Error('TinyPNG returned an image larger than 50 MiB.') }
      chunks.push(value)
    }
  }
  finally { await reader.cancel(); reader.releaseLock() }
  return Buffer.concat(chunks, size)
}

export function createTinyPngPlugin(request: typeof fetch = fetch, timeoutMs = 120_000): CompressionPlugin {
  return {
    id: 'tinypng',
    label: 'TinyPNG',
    description: 'Cloud · uploads images to TinyPNG; API key required',
    formats: ['jpeg', 'png', 'webp'],
    describe: ({ format }) => `${format.toUpperCase()} · automatic optimization`,
    compress: ({ bytes }, context) => {
      const apiKey = context.getSetting('tinypng.apiKey', '').trim()
      if (!apiKey) { throw new Error('Set assetMeter.compression.tinypng.apiKey in User Settings before using TinyPNG.') }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error('TinyPNG compression exceeded 120 seconds. Try a smaller image or use jSquash.')), timeoutMs)
      const result = (async () => {
        const options = {
          headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}` },
          signal: controller.signal,
          redirect: 'error' as const,
        }
        try {
          const uploaded = await request(`${apiOrigin}/shrink`, { ...options, method: 'POST', body: Uint8Array.from(bytes) })
          await checkResponse(uploaded)
          await uploaded.body?.cancel()
          const location = uploaded.headers.get('location')
          if (!location) { throw new Error('TinyPNG did not return a compressed image URL.') }
          const output = new URL(location, apiOrigin)
          if (output.origin !== apiOrigin || !output.pathname.startsWith('/output/') || output.username || output.password) {
            throw new Error('TinyPNG returned an unexpected image URL.')
          }
          const downloaded = await request(output.toString(), options)
          await checkResponse(downloaded)
          return await readImage(downloaded)
        }
        catch (error) {
          if (controller.signal.aborted) { throw controller.signal.reason }
          if (error instanceof TypeError) { throw new Error('Could not connect to TinyPNG. Check your network connection or use jSquash.') }
          throw error
        }
        finally { clearTimeout(timeout) }
      })()
      return { result, cancel: () => controller.abort(new Error('Compression cancelled.')) }
    },
  }
}
