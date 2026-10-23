import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

try {
  const missing = ['VSCE_TOKEN', 'OVSX_TOKEN'].filter(name => !process.env[name]?.trim())
  assert.equal(missing.length, 0, `Set ${missing.join(' and ')}. GitHub Actions reads these repository secrets in .github/workflows/release.yml.`)

  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const packagePath = path.join(root, 'artifacts', `assets-size-${version}.vsix`)
  await access(packagePath).catch(() => { throw new Error(`Missing ${packagePath}. Run pnpm release:prepare first.`) })

  const publishers = [
    { cli: require.resolve('@vscode/vsce/vsce'), args: ['publish', '--packagePath', packagePath, '--skip-duplicate'] },
    { cli: require.resolve('ovsx/bin/ovsx'), args: ['publish', packagePath, '--skip-duplicate'] },
  ]
  for (const { cli, args } of publishers) {
    execFileSync(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, VSCE_PAT: process.env.VSCE_TOKEN, OVSX_PAT: process.env.OVSX_TOKEN },
    })
  }
  console.log(`Published Assets Size v${version} to Visual Studio Marketplace and Open VSX.`)
}
catch (error) {
  console.error(`Publish failed: ${error.message}`)
  process.exitCode = 1
}
