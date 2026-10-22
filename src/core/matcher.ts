import type { Settings } from './types'
import picomatch from 'picomatch'

export class ResourceMatcher {
  private readonly excluded: (path: string) => boolean
  private readonly extensions: string[]
  private readonly folders: Set<string>

  constructor(readonly settings: Settings) {
    this.excluded = picomatch(settings.exclude, { dot: true })
    this.extensions = settings.fileExtensions.map(value => value.trim().toLowerCase())
      .filter(Boolean)
      .map(value => value === '*' || value.startsWith('.') ? value : `.${value}`)
    this.folders = new Set(settings.folderNames.map(value => value.trim().toLowerCase()).filter(Boolean))
  }

  isExcluded(relativePath: string): boolean {
    const parts = relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
    return parts.some((_, index) => {
      const prefix = parts.slice(0, index + 1).join('/')
      return this.excluded(prefix) || this.excluded(`${prefix}/`)
    })
  }

  matches(name: string, isDirectory: boolean): boolean {
    if (!this.settings.enabled) { return false }
    const normalized = name.toLowerCase()
    return isDirectory
      ? this.folders.has('*') || this.folders.has(normalized)
      : this.extensions.some(extension => extension === '*' || normalized.endsWith(extension))
  }

  mayMatch(name: string): boolean {
    return this.matches(name, true) || this.matches(name, false)
  }
}
