import type { HoverField } from './presentation'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const muted = 'color:var(--vscode-descriptionForeground);'
const emphasis = new Set(['Camera', 'ExposureTime', 'FNumber', 'ISO'])
const layouts = new WeakMap<readonly HoverField[], string>()
const icons = new Map(Object.entries({
  Path: 'file',
  Size: 'database',
  Camera: 'device-camera',
  Lens: 'circle-large-outline',
  ExposureTime: 'watch',
  FNumber: 'circle-large-outline',
  ISO: 'dashboard',
  FocalLength: 'arrow-both',
  FocalLengthIn35mmFormat: 'arrow-both',
  ExposureCompensation: 'add',
  Date: 'calendar',
  Time: 'clock',
  Image: 'file-media',
  Resolution: 'screen-full',
  Latitude: 'location',
  Longitude: 'location',
  Altitude: 'arrow-up',
  WhiteBalance: 'symbol-color',
  Flash: 'zap',
  ColorSpace: 'symbol-color',
  Orientation: 'sync',
  Rating: 'star-full',
  Author: 'person',
  Creator: 'person',
  Copyright: 'law',
  Description: 'note',
}))

export interface HoverInfoField { key: string, label: string, value: string, section?: string }

function html(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character]!)
}

function text(value: string, path = false): string {
  if (path) { return [...graphemes.segment(value)].map(part => html(part.segment)).join('<wbr>') }
  return value.split(/(\r\n?|\n|\s+)/).map((part) => {
    if (/^[\r\n]+$/.test(part)) { return '<br>' }
    const characters = [...graphemes.segment(part)]
    return characters.length > 18 ? characters.map(character => html(character.segment)).join('<wbr>') : html(part)
  }).join('')
}

// A flat grid shares one text baseline without independent nested line boxes.
// The value strut balances the filler row, preserving that first baseline for
// wrapped values. Icons keep VS Code's native optical alignment and a 4px gap.
export function hoverInfoHtml(rows: readonly HoverInfoField[]): string {
  if (!rows.length) { return '' }
  const bodies: string[] = []
  let section = rows[0]!.section
  for (const row of rows) {
    if (row.section !== section) {
      bodies.push('<tbody><tr><td colspan="4"><br></td></tr></tbody>')
      section = row.section
    }
    const tag = emphasis.has(row.key) ? 'strong' : 'span'
    // Only fixed icon IDs become markup; metadata labels and values stay text.
    const icon = `<span class="codicon codicon-${icons.get(row.key) ?? 'info'}" style="${muted}"></span>`
    const label = `<span style="${muted}display:inline-block;">${text(row.label)}</span>`
    const value = `<span style="display:inline-block;"><sub></sub><${tag}>${text(row.value, row.key === 'Path')}</${tag}></span>`
    bodies.push(`<tbody><tr height="1"><td width="1">${icon}</td><td align="left">${label}</td><td width="12"></td><td align="right" rowspan="2">${value}</td></tr><tr height="100%"><td colspan="3"></td></tr></tbody>`)
  }
  return `<table width="280">${bodies.join('')}</table>`
}

export function hoverMetadataHtml(rows: readonly HoverField[]): string {
  if (!rows.length) { return '' }
  const cached = layouts.get(rows)
  if (cached) { return cached }
  const heading = `<p align="center"><span style="${muted}">--------&nbsp;&nbsp;&nbsp;</span><strong>MetaData</strong><span style="${muted}">&nbsp;&nbsp;&nbsp;--------</span></p>`
  const result = heading + hoverInfoHtml(rows)
  layouts.set(rows, result)
  return result
}
