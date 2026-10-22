import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVSIX } from '@vscode/vsce'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
await mkdir(path.join(root, 'artifacts'), { recursive: true })
await createVSIX({
  cwd: root,
  githubBranch: 'main',
  dependencies: false,
  packagePath: path.join(root, 'artifacts', `assets-size-${version}.vsix`),
})
