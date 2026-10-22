import { defineConfig } from 'tsdown'

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
    clean: false,
    deps: {
      neverBundle: ['vscode'],
      alwaysBundle: bundledDependencies,
    },
  },
  {
    entry: { 'compression-worker': 'src/compression/worker.ts' },
    outDir: 'dist',
    format: 'esm',
    outExtensions: () => ({ js: '.mjs' }),
    target: 'node20',
    sourcemap: true,
    clean: false,
    deps: { alwaysBundle: bundledDependencies },
  },
  {
    entry: { 'compression-preview': 'src/compression/webview.js' },
    outDir: 'dist',
    format: 'iife',
    outputOptions: { entryFileNames: '[name].js' },
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    clean: false,
  },
])
