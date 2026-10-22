import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { installNativePatch, restoreNativePatch, getNativePatchStatus } = require('../dist/native-patch.js')

const [action, appRoot] = process.argv.slice(2)
if (!['install', 'restore', 'status'].includes(action) || !appRoot) {
  throw new Error('Usage: node scripts/native-patch.mjs install|restore|status /absolute/path/to/VSCode/resources/app')
}
const result = await (action === 'install'
  ? installNativePatch(appRoot)
  : action === 'restore' ? restoreNativePatch(appRoot) : getNativePatchStatus(appRoot))
console.log(JSON.stringify(result, null, 2))
