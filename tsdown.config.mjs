import { createRequire } from 'node:module'
import { defineConfig } from 'tsdown'

const require = createRequire(import.meta.url)
const bundledDependencies = [/^(?!vscode(?:\/|$)).+/]

export default defineConfig([
  {
    entry: {
      'extension': 'src/extension.ts',
      'native-patch': 'src/nativePatch.ts',
    },
    outDir: 'dist',
    format: 'cjs',
    outExtensions: () => ({ js: '.js' }),
    target: 'node20',
    sourcemap: true,
    deps: {
      neverBundle: ['vscode'],
      alwaysBundle: bundledDependencies,
    },
    copy: [{
      from: require.resolve('picomatch/LICENSE'),
      to: 'dist/licenses',
      rename: 'LICENSE-picomatch',
    }, {
      from: require.resolve('exifr/LICENSE'),
      to: 'dist/licenses',
      rename: 'LICENSE-exifr',
    }],
  },
  {
    entry: { 'metadata-worker': 'src/metadata/worker.ts' },
    outDir: 'dist',
    format: 'esm',
    outExtensions: () => ({ js: '.mjs' }),
    target: 'node20',
    sourcemap: true,
    deps: { alwaysBundle: bundledDependencies },
  },
  {
    entry: { 'compression-worker': 'src/compression/worker.ts' },
    outDir: 'dist',
    format: 'esm',
    outExtensions: () => ({ js: '.mjs' }),
    target: 'node20',
    sourcemap: true,
    deps: { alwaysBundle: bundledDependencies },
    copy: [
      {
        from: [
          '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm',
          '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm',
          '@jsquash/webp/codec/dec/webp_dec.wasm',
          '@jsquash/webp/codec/enc/webp_enc.wasm',
          '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm',
        ].map(file => require.resolve(file)),
        to: 'dist/codecs',
      },
      ...['jpeg', 'webp', 'oxipng'].flatMap(codec => [
        {
          from: require.resolve(`@jsquash/${codec}/LICENSE`),
          to: 'dist/codecs',
          rename: `LICENSE-${codec}`,
        },
        {
          from: require.resolve(`@jsquash/${codec}/codec/LICENSE.codec.md`),
          to: 'dist/codecs',
          rename: `LICENSE-${codec}-codec.md`,
        },
      ]),
    ],
  },
  {
    entry: { 'compression-preview': 'src/compression/webview.js' },
    outDir: 'dist',
    format: 'iife',
    outputOptions: { entryFileNames: '[name].js' },
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
  },
])
