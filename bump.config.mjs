import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'bumpp'

export default defineConfig({
  files: ['package.json'],
  commit: 'chore: release v{version}',
  tag: 'v{version}',
  push: true,
  noGitCheck: false,
  execute(operation) {
    const { newVersion, updatedFiles } = operation.state
    assert.match(newVersion, /^\d+\.\d+\.\d+$/, 'Marketplace versions must use major.minor.patch; choose patch, minor or major.')

    const changelog = readFileSync('CHANGELOG.md', 'utf8')
    if (!changelog.includes(`## ${newVersion}\n`)) {
      let nextChangelog
      if (/^## Unreleased[\t ]*$/m.test(changelog)) {
        nextChangelog = changelog.replace(/^## Unreleased[\t ]*$/m, `## ${newVersion}`)
      }
      else {
        const tags = execFileSync('git', ['tag', '--merged', 'HEAD', '--sort=-creatordate', '--list', 'v[0-9]*'], { encoding: 'utf8' }).trim()
        const previousTag = tags.split('\n')[0]
        const commits = execFileSync('git', ['log', '--format=- %s', ...(previousTag ? [`${previousTag}..HEAD`] : ['HEAD'])], { encoding: 'utf8' }).trim()
        assert.ok(commits, 'There are no commits to include in the release changelog.')
        nextChangelog = changelog.replace(/^# Changelog\n/, `# Changelog\n\n## ${newVersion}\n\n${commits}\n`)
      }
      writeFileSync('CHANGELOG.md', nextChangelog)
      operation.update({ updatedFiles: [...updatedFiles, 'CHANGELOG.md'] })
    }

    execFileSync('pnpm', ['release:check'], { stdio: 'inherit' })
  },
})
