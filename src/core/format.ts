import type { SizeSeverity } from './severity'
import type { Metrics, Settings } from './types'

export function formatSize(bytes: number, units: Settings['units'] = 'binary', places = 1): string {
  const base = units === 'binary' ? 1024 : 1000
  const names = units === 'binary' ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] : ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(base)), names.length - 1) : 0
  const value = bytes / base ** index
  return `${Number(value.toFixed(index === 0 ? 0 : places))} ${names[index]}`
}

export function compactSizeBadge(bytes: number, units: Settings['units']): string {
  const compact = formatSize(bytes, units, 0).replace(/ (?:([KMGTPE])i?B|B)$/, '$1')
  // VS Code accepts at most two characters. Keep the exact size in the tooltip.
  return compact.length <= 2 ? compact : 'ⓘ'
}

// An invisible delimiter identifies labels accepted by the reversible native patch.
// Unpatched hosts never receive these long badges.
export const nativeLabelMarker = '\u2063'
export const nativeToneMarker = '\u2060'
export const nativeHoverMarker = '\u2062'

const severityTones: Record<SizeSeverity, number> = { normal: 1, warning: 2, large: 3, critical: 4 }

export function nativeSizeLabel(text: string, severity: SizeSeverity, hover = false): string {
  return `${nativeLabelMarker}${nativeToneMarker.repeat(severityTones[severity])}${hover ? nativeHoverMarker : ''}${text}${nativeLabelMarker}`
}

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

export interface MetricDetail { label: string, value: string }

export function describeMetricFields(metrics: Metrics, settings: Settings): MetricDetail[] {
  const fields: MetricDetail[] = []
  if (metrics.isDirectory && settings.showFileCount) {
    fields.push({ label: 'Files', value: `${fileCount(metrics, settings)} (${settings.fileCountMode === 'direct' ? 'direct children' : 'recursive'})` })
  }
  if (metrics.isDirectory) { fields.push({ label: 'Folders', value: `${metrics.directories} (recursive)` }) }
  if (metrics.skipped) { fields.push({ label: 'Skipped symbolic links', value: String(metrics.skipped) }) }
  if (metrics.errors) { fields.push({ label: 'Unreadable items', value: `${metrics.errors}. Totals include readable items only.` }) }
  fields.push({ label: 'Size', value: `${metrics.errors ? '≥ ' : ''}${formatSize(metrics.bytes, settings.units, settings.decimalPlaces)} (${metrics.bytes.toLocaleString('en-US')} bytes)` })
  return fields
}

export function describeMetrics(metrics: Metrics, settings: Settings): string {
  return describeMetricFields(metrics, settings).map(field => `${field.label}: ${field.value}`).join('\n')
}
