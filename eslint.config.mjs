import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: ['dist/**', 'node_modules/**', 'artifacts/**', '.vscode-test/**'],
    typescript: true,
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    rules: {
      // This project has compact, semicolon-separated statements in existing code.
      'style/max-statements-per-line': 'off',
      // Existing Node entry points rely on the standard globals.
      'node/prefer-global/buffer': 'off',
      'node/prefer-global/process': 'off',
      // Tests run with Node's built-in test runner, not Vitest.
      'test/no-import-node-test': 'off',
    },
  },
  {
    files: ['src/nativePatch.ts', 'test/nativePatch.test.ts'],
    rules: {
      // These files intentionally construct source strings containing template syntax.
      'no-template-curly-in-string': 'off',
    },
  },
  {
    files: ['test/integration.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/compression/webview.js'],
    languageOptions: {
      globals: {
        acquireVsCodeApi: 'readonly',
        window: 'readonly',
        document: 'readonly',
        HTMLElement: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
)
