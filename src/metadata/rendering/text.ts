import type { MarkdownString } from 'vscode'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character]!)
}

export function hoverText(value: string, path = false): string {
  if (path) { return [...graphemes.segment(value)].map(part => (/^[\r\n]+$/.test(part.segment) ? '<br>' : escapeHtml(part.segment))).join('<wbr>') }
  return value.split(/(\r\n?|\n|\s+)/).map((part) => {
    if (/^[\r\n]+$/.test(part)) { return '<br>' }
    const characters = [...graphemes.segment(part)]
    return characters.length > 18 ? characters.map(character => escapeHtml(character.segment)).join('<wbr>') : escapeHtml(part)
  }).join('')
}

export function appendTableCell(markdown: MarkdownString, value: string): MarkdownString {
  for (const [lineIndex, line] of value.split(/\r\n?|\n/).entries()) {
    if (lineIndex) { markdown.appendMarkdown('<br>') }
    for (const [partIndex, part] of line.split('|').entries()) {
      if (partIndex) { markdown.appendMarkdown('&#124;') }
      markdown.appendText(part)
    }
  }
  return markdown
}

export function appendMarkdownText(markdown: MarkdownString, value: string, wrap: boolean): MarkdownString {
  if (!wrap) { return markdown.appendText(value) }
  // Wrap at words and path separators, keeping values such as dates, fractions
  // and ISO settings intact. Only oversized tokens need character wrapping.
  let width = 0
  const units = (character: string) => character.codePointAt(0)! >= 0x2E80 || /[MW@%]/i.test(character) ? 2 : 1
  for (const token of value.split(/(\s+|(?<=[/\\]))/)) {
    if (!token) { continue }
    if (/^[\r\n]+$/.test(token)) { markdown.appendMarkdown('<br>'); width = 0; continue }
    const length = [...token].reduce((total, character) => total + units(character), 0)
    if (width && width + length > 36) {
      markdown.appendMarkdown('<br>'); width = 0
      if (/^\s+$/.test(token)) { continue }
    }
    for (const character of token) {
      if (width + units(character) > 36) { markdown.appendMarkdown('<br>'); width = 0 }
      markdown.appendText(character).appendMarkdown('<wbr>')
      width += units(character)
    }
  }
  return markdown
}
