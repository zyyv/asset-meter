import type { Settings } from '../src/core/types'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { ResourceMatcher } from '../src/core/matcher'

const manifest = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as {
  contributes: { configuration: { properties: Record<string, { default: unknown }> } }
}
const properties = manifest.contributes.configuration.properties
const defaults: Settings = {
  enabled: true,
  displayMode: 'always',
  include: properties['assetMeter.include']!.default as string[],
  exclude: properties['assetMeter.exclude']!.default as string[],
  showFileCount: true,
  fileCountMode: 'recursive',
  units: 'decimal',
  decimalPlaces: 1,
  colorize: true,
  fileColorThresholdsMiB: [0.25, 1, 5],
  folderColorThresholdsMiB: [10, 50, 100],
}

describe('published include/exclude defaults', () => {
  it('selects supported asset formats at the root and in nested hidden paths', () => {
    const matcher = new ResourceMatcher(defaults)
    const extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'heic', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'woff', 'woff2', 'ttf', 'otf', 'pdf', 'zip']
    for (const extension of extensions) {
      assert.equal(matcher.matches(`logo.${extension}`), true, extension)
      assert.equal(matcher.matches(`src/.hidden/.LOGO.${extension.toUpperCase()}`), true, extension)
    }
    for (const path of ['README.md', 'src/main.ts', 'src/App.vue', 'assets/notes.txt', 'photo.png.backup']) {
      assert.equal(matcher.matches(path), false, path)
    }
  })

  it('selects named asset directories without automatically selecting their children', () => {
    const matcher = new ResourceMatcher(defaults)
    for (const directory of ['assets', 'public', 'static', 'images', 'img', 'media', 'fonts']) {
      assert.equal(matcher.matches(directory), true, directory)
      assert.equal(matcher.matches(`src/${directory.toUpperCase()}`), true, directory)
      assert.equal(matcher.matches(`${directory}/nested`), false, directory)
      assert.equal(matcher.matches(`${directory}/notes.txt`), false, directory)
      assert.equal(matcher.matches(`${directory}-backup`), false, directory)
    }
  })

  it('excludes dependencies, version control and metadata even under an included directory', () => {
    const matcher = new ResourceMatcher(defaults)
    for (const directory of ['node_modules', '.git', '.svn', '.hg']) {
      for (const path of [directory, `assets/${directory.toUpperCase()}`, `assets/${directory}/nested/logo.png`]) {
        assert.equal(matcher.isExcluded(path), true, path)
        assert.equal(matcher.matches(path), false, path)
      }
    }
    for (const path of ['.DS_Store', 'assets/.ds_store']) {
      assert.equal(matcher.isExcluded(path), true, path)
    }
    for (const path of ['assets/node_modules_backup/logo.png', '.github/logo.png']) {
      assert.equal(matcher.isExcluded(path), false, path)
      assert.equal(matcher.matches(path), true, path)
    }
  })
})

describe('custom include patterns', () => {
  it.each([
    { name: 'single star stays within one directory', include: ['assets/*.png'], matches: ['assets/logo.png'], misses: ['logo.png', 'assets/nested/logo.png', 'other/assets/logo.png'] },
    { name: 'globstar includes root and nested files', include: ['**/*.png'], matches: ['logo.png', 'assets/nested/logo.png'], misses: ['logo.png.bak', 'logo.jpg'] },
    { name: 'folder glob includes its root and descendants', include: ['assets/**'], matches: ['assets', 'assets/logo.txt', 'assets/nested/deep'], misses: ['assets-backup', 'assets-backup/logo.png', 'other/assets'] },
    { name: 'braces select directory names only', include: ['**/{products,_images}'], matches: ['products', 'src/_images'], misses: ['products/logo.png', '_images/nested', 'products-origin'] },
    { name: 'multi-part extensions are matched as complete suffixes', include: ['**/*.{tar.gz,woff2}'], matches: ['archive.tar.gz', 'fonts/FONT.WOFF2'], misses: ['archive.gz', 'archive.tar.gz.bak', 'font.woff'] },
    { name: 'question marks and character classes constrain filenames', include: ['assets/icon-?.[ps]ng'], matches: ['assets/icon-a.png', 'assets/icon-1.sng'], misses: ['assets/icon-ab.png', 'assets/icon-a.jpg', 'assets/nested/icon-a.png'] },
    { name: 'positive extglobs select supported alternatives', include: ['assets/@(logo|icon).+(png|jpg)'], matches: ['assets/logo.png', 'assets/icon.jpg'], misses: ['assets/hero.png', 'assets/logo.webp', 'nested/assets/logo.png'] },
    { name: 'relative patterns and resource paths are normalized', include: ['./assets/**/*.png'], matches: ['assets//logo.png', 'assets/./nested/../logo.png', 'assets\\nested\\logo.png'], misses: ['../assets/logo.png', '/assets/logo.png', 'assets-backup/logo.png'] },
    { name: 'empty include selects no resources', include: [], matches: [], misses: ['assets', 'logo.png', '.hidden/logo.png'] },
    { name: 'empty entries do not disable valid rules', include: ['', '**/*.png', ''], matches: ['logo.png'], misses: ['logo.jpg', 'assets'] },
  ])('$name', ({ include, matches, misses }) => {
    const matcher = new ResourceMatcher({ ...defaults, include, exclude: [] })
    for (const path of matches) { assert.equal(matcher.matches(path), true, path) }
    for (const path of misses) { assert.equal(matcher.matches(path), false, path) }
  })

  it.each([
    { include: ['**/*', '!**/drafts', '**/drafts/keep.png'] },
    { include: ['!**/drafts', '**/drafts/keep.png', '**/*'] },
  ])('negated includes hide complete subtrees regardless of positive-rule order: $include', ({ include }) => {
    const matcher = new ResourceMatcher({ ...defaults, include, exclude: [] })
    for (const path of ['assets/drafts', 'assets/drafts/keep.png', 'assets/drafts/nested/logo.png']) {
      assert.equal(matcher.matches(path), false, path)
      assert.equal(matcher.isExcluded(path), false, 'negated includes must not reduce folder totals')
    }
    assert.equal(matcher.matches('assets/published/logo.png'), true)
  })
})

describe('custom exclude patterns', () => {
  it.each(['assets/private', 'assets/private/', 'assets/private/**'])('directory exclusion %s prunes its root and descendants', (pattern) => {
    const matcher = new ResourceMatcher({ ...defaults, include: ['**/*'], exclude: [pattern] })
    for (const path of ['assets/private', 'ASSETS/PRIVATE/nested/logo.PNG', 'assets\\private\\logo.png']) {
      assert.equal(matcher.isExcluded(path), true, path)
      assert.equal(matcher.matches(path), false, path)
    }
    for (const path of ['assets/private-backup/logo.png', 'other/assets/private/logo.png']) {
      assert.equal(matcher.isExcluded(path), false, path)
      assert.equal(matcher.matches(path), true, path)
    }
  })

  it.each([
    { include: ['**/*', 'assets/keep.png'], exclude: ['**/*.png'] },
    { include: ['assets/keep.png', '**/*'], exclude: ['**/*.png', '!assets/keep.png'] },
  ])('exclude wins over positive includes and cannot be undone by negated excludes: $exclude', ({ include, exclude }) => {
    const matcher = new ResourceMatcher({ ...defaults, include, exclude })
    assert.equal(matcher.isExcluded('assets/keep.png'), true)
    assert.equal(matcher.matches('assets/keep.png'), false)
    assert.equal(matcher.matches('assets/keep.jpg'), true)
  })

  it('empty exclude restores resources normally excluded by defaults', () => {
    const matcher = new ResourceMatcher({ ...defaults, include: ['**/*'], exclude: [] })
    for (const path of ['node_modules', 'node_modules/logo.png', '.git/config', '.DS_Store']) {
      assert.equal(matcher.isExcluded(path), false, path)
      assert.equal(matcher.matches(path), true, path)
    }
  })

  it('exclusions support extglobs while ignoring empty entries', () => {
    const matcher = new ResourceMatcher({ ...defaults, include: ['**/*'], exclude: ['', '**/@(draft|private)/**', ''] })
    for (const path of ['draft', 'assets/private', 'assets/draft/nested/logo.png']) {
      assert.equal(matcher.isExcluded(path), true, path)
      assert.equal(matcher.matches(path), false, path)
    }
    assert.equal(matcher.matches('assets/drafts/logo.png'), true)
    assert.equal(matcher.matches('assets/public/logo.png'), true)
  })
})
