import type { Metrics, Settings } from './types'

export function formatSize(bytes: number, units: Settings['units'] = 'binary', places = 1): string {
  const base = units === 'binary' ? 1024 : 1000
  const names = units === 'binary' ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] : ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(base)), names.length - 1) : 0
  const value = bytes / base ** index
  return `${Number(value.toFixed(index === 0 ? 0 : places))} ${names[index]}`
}

// An invisible delimiter identifies labels accepted by the reversible native patch.
// Unpatched hosts never receive these long badges.
export const nativeLabelMarker = '\u2063'
export const nativeToneMarker = '\u2060'

export function inlineLabel(metrics: Metrics, settings: Settings): string {
  const size = `${metrics.errors ? '≥ ' : ''}${formatSize(metrics.bytes, settings.units, settings.decimalPlaces)}`
  const count = fileCount(metrics, settings)
  return metrics.isDirectory && settings.showFileCount
    ? `${count} ${count === 1 ? 'file' : 'files'} · ${size}`
    : size
}

export function fileCount(metrics: Metrics, settings: Settings): number {
  return settings.fileCountMode === 'direct' ? metrics.directFiles : metrics.files
}

export function describeMetrics(metrics: Metrics, settings: Settings): string {
  const lines: string[] = []
  if (metrics.isDirectory && settings.showFileCount) {
    lines.push(`Files: ${fileCount(metrics, settings)} (${settings.fileCountMode === 'direct' ? 'direct children' : 'recursive'})`)
  }
  if (metrics.isDirectory) { lines.push(`Folders: ${metrics.directories} (recursive)`) }
  if (metrics.skipped) { lines.push(`Skipped symbolic links: ${metrics.skipped}`) }
  if (metrics.errors) { lines.push(`Unreadable items: ${metrics.errors}. Totals include readable items only.`) }
  lines.push(`Size: ${metrics.errors ? '≥ ' : ''}${formatSize(metrics.bytes, settings.units, settings.decimalPlaces)} (${metrics.bytes.toLocaleString('en-US')} bytes)`)
  return lines.join('\n')
}
