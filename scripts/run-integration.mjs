import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(path.join(tmpdir(), 'asset-meter-integration-'))
const fixture = path.join(temporary, 'workspace')
try {
  await mkdir(path.join(fixture, 'assets', 'nested'), { recursive: true })
  await mkdir(path.join(fixture, 'assets', 'node_modules'), { recursive: true })
  await mkdir(path.join(fixture, '.vscode'), { recursive: true })
  await writeFile(path.join(fixture, 'assets', 'logo.png'), Buffer.alloc(1536))
  await writeFile(path.join(fixture, 'assets', 'icon.JPG'), Buffer.alloc(512))
  await writeFile(path.join(fixture, 'assets', 'nested', 'readme.txt'), Buffer.alloc(257))
  await writeFile(path.join(fixture, 'assets', 'node_modules', 'skip.png'), Buffer.alloc(500_000))
  if (process.platform !== 'win32') { await symlink(path.join(fixture, 'assets'), path.join(fixture, 'assets', 'loop')) }
  await writeFile(path.join(fixture, '.vscode', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'window.restoreWindows': 'none',
    'extensions.autoUpdate': false,
  }))
  await build({ entryPoints: [path.join(root, 'test/integration.ts')], outfile: path.join(root, 'dist/integration.js'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] })
  await runTests({
    version: '1.90.2',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'dist/integration.js'),
    ...(process.env.VSCODE_EXECUTABLE_PATH ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH } : {}),
    launchArgs: [fixture, '--user-data-dir', path.join(temporary, 'profile'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates', '--no-sandbox'],
  })
}
finally { await rm(temporary, { recursive: true, force: true }) }
