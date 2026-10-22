import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => readFile(path.join(root, name), 'utf8')
const manifest = JSON.parse(await read('package.json'))
const allowLocalPublisher = process.argv.includes('--allow-local-publisher')

try {
  assert.equal(manifest.displayName, 'Assets Size', 'Use the Assets Size display name.')
  assert.match(manifest.publisher, /^[a-z0-9][a-z0-9-]*$/i, 'Set a valid Marketplace Publisher ID.')
  if (!allowLocalPublisher) {
    assert.notEqual(manifest.publisher, 'local-assets', 'Create a Marketplace publisher, replace package.json publisher, then rerun pnpm release:prepare. See docs/PUBLISHING.md.')
  }
  for (const url of [manifest.homepage, manifest.bugs?.url, manifest.repository?.url?.replace(/^git\+/, '')]) {
    assert.ok(url?.startsWith('https://github.com/zyyv/vscode-assets-size'), 'Keep repository, homepage and issue links configured.')
  }
  assert.ok((await read('CHANGELOG.md')).includes(`## ${manifest.version}\n`), 'Add the current version to CHANGELOG.md.')
  for (const file of ['README.md', 'README.zh-CN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'images/compression.png']) {
    await access(path.join(root, file))
  }
  const icon = await readFile(path.join(root, manifest.icon))
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'The Marketplace icon must be a PNG.')
  assert.ok(icon.readUInt32BE(16) >= 256 && icon.readUInt32BE(20) >= 256, 'Use an icon of at least 256 × 256 pixels.')
  for (const language of ['README.md', 'README.zh-CN.md']) {
    const content = await read(language)
    for (const setting of Object.keys(manifest.contributes.configuration.properties)) {
      assert.ok(content.includes(`\`${setting}\``), `${language} must document ${setting}.`)
    }
    for (const command of manifest.contributes.commands) {
      assert.ok(content.includes(command.title), `${language} must document ${command.title}.`)
    }
  }
  console.log(`Release metadata ready: ${manifest.publisher}.${manifest.name} v${manifest.version}${allowLocalPublisher ? ' (local publisher allowed; not a publishing approval)' : ''}`)
}
catch (error) {
  console.error(`Release check failed: ${error.message}`)
  process.exitCode = 1
}
