import type { HoverField, InfoField } from '../presentation/fields'

import { fieldDefinition } from '../presentation/fields'
import { hoverText } from './text'

export const hoverWidth = 280
const valueGap = 12
const muted = 'color:var(--vscode-descriptionForeground);'
// Balances the native two-row layout's descent without moving the icon glyph.
const firstLineBaseline = '<sub></sub>'
const layouts = new WeakMap<readonly HoverField[], string>()

function fieldRowHtml(field: InfoField): string {
  const definition = fieldDefinition(field.key)
  const tag = definition?.emphasis ? 'strong' : 'span'
  // Only fixed icon IDs become markup; metadata labels and values stay text.
  const icon = `<span class="codicon codicon-${definition?.icon ?? 'info'}" style="${muted}"></span>`
  const label = `<span style="${muted}display:inline-block;">${hoverText(field.label)}</span>`
  const value = `<span style="display:inline-block;">${firstLineBaseline}<${tag}>${hoverText(field.value, field.key === 'Path')}</${tag}></span>`
  return [
    '<tbody><tr height="1">',
    `<td width="1">${icon}</td>`,
    `<td align="left">${label}</td>`,
    `<td width="${valueGap}"></td>`,
    `<td align="right" rowspan="2">${value}</td>`,
    '</tr><tr height="100%"><td colspan="3"></td></tr></tbody>',
  ].join('')
}

// A flat grid shares one text baseline without independent nested line boxes.
// The value strut balances the filler row, preserving that first baseline for
// wrapped values. Icons keep VS Code's native optical alignment and a 4px gap.
export function hoverInfoHtml(rows: readonly InfoField[]): string {
  if (!rows.length) { return '' }
  const bodies: string[] = []
  let section = rows[0]!.section
  for (const row of rows) {
    if (row.section !== section) {
      bodies.push('<tbody><tr><td colspan="4"><br></td></tr></tbody>')
      section = row.section
    }
    bodies.push(fieldRowHtml(row))
  }
  return `<table width="${hoverWidth}">${bodies.join('')}</table>`
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
