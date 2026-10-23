import type { Settings } from './types'
import { posix } from 'node:path'
import picomatch from 'picomatch'

const options = { dot: true, nocase: true, posix: true, windows: false }

function isPositive(pattern: string): boolean { return !pattern.startsWith('!') || pattern.startsWith('!(') }

function normalizePattern(pattern: string): string { return posix.normalize(pattern).replace(/\/$/, '') }

function matchesAncestor(relativePath: string, matcher: (path: string) => boolean): boolean {
  const parts = relativePath.split('/').filter(Boolean)
  return parts.some((_, index) => {
    const prefix = parts.slice(0, index + 1).join('/')
    return matcher(prefix) || matcher(`${prefix}/`)
  })
}

export class ResourceMatcher {
  private readonly included: (path: string) => boolean
  private readonly excluded: (path: string) => boolean
  private readonly hidden: (path: string) => boolean

  constructor(readonly settings: Settings) {
    const patterns = settings.include.filter(Boolean)
    const include = patterns.filter(isPositive).map(normalizePattern)
    const omitted = patterns.filter(pattern => !isPositive(pattern)).map(pattern => pattern.slice(1)).filter(isPositive).map(normalizePattern)
    const exclude = settings.exclude.filter(Boolean).filter(isPositive).map(normalizePattern)
    this.included = picomatch(include, options)
    this.excluded = picomatch(exclude, options)
    this.hidden = picomatch([...exclude, ...omitted], options)
  }

  isExcluded(relativePath: string): boolean {
    return matchesAncestor(posix.normalize(relativePath.replaceAll('\\', '/')), this.excluded)
  }

  matches(relativePath: string): boolean {
    const path = posix.normalize(relativePath.replaceAll('\\', '/')).replace(/\/$/, '')
    if (!this.settings.enabled || posix.isAbsolute(path) || path === '..' || path.startsWith('../')) { return false }
    return !matchesAncestor(path, this.hidden) && this.included(path)
  }
}
