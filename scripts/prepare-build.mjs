import { copyFile, mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const codecsDirectory = 'dist/codecs'

await rm('dist', { recursive: true, force: true })
await mkdir(codecsDirectory, { recursive: true })

const codecFiles = [
  ['jpeg', 'codec/dec/mozjpeg_dec.wasm'],
  ['jpeg', 'codec/enc/mozjpeg_enc.wasm'],
  ['webp', 'codec/dec/webp_dec.wasm'],
  ['webp', 'codec/enc/webp_enc.wasm'],
  ['oxipng', 'codec/pkg/squoosh_oxipng_bg.wasm'],
]

await Promise.all(codecFiles.map(([codec, file]) => copyFile(
  require.resolve(`@jsquash/${codec}/${file}`),
  `${codecsDirectory}/${file.split('/').pop()}`,
)))

await Promise.all(['jpeg', 'webp', 'oxipng'].flatMap(codec => [
  copyFile(require.resolve(`@jsquash/${codec}/LICENSE`), `${codecsDirectory}/LICENSE-${codec}`),
  copyFile(require.resolve(`@jsquash/${codec}/codec/LICENSE.codec.md`), `${codecsDirectory}/LICENSE-${codec}-codec.md`),
]))
