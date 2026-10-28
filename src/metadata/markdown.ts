import type { Metrics, Settings } from '../core/types'
import type { AssetMetadata } from './types'
import * as vscode from 'vscode'
import { describeMetrics } from '../core/format'
import { hoverInfoHtml, hoverMetadataHtml } from './hover'
import { metadataPresentation } from './presentation'
import { hasMetadata } from './types'

export function imageDetailsMarkdown(uri: vscode.Uri, metrics: Metrics, settings: Settings, metadata?: AssetMetadata, hover = false, imageHref?: string): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString()
  markdown.supportHtml = true
  // Keep metadata untrusted: values are escaped text, never HTML or commands.
  markdown.isTrusted = false
  if (imageHref || uri.scheme === 'file' || uri.scheme === 'vscode-remote') {
    markdown.appendMarkdown(`![Image preview](<${imageHref ?? uri.toString()}${hover ? '|width=280' : ''}>)\n\n`)
  }
  const details = `Path: ${uri.path}\n${describeMetrics(metrics, settings)}`.split('\n')
  if (hover) {
    markdown.appendMarkdown(hoverInfoHtml(details.map((line) => {
      const separator = line.indexOf(': ')
      const label = line.slice(0, separator)
      return { key: label, label, value: line.slice(separator + 2) }
    })))
  }
  else {
    for (const [index, line] of details.entries()) {
      if (index) { markdown.appendMarkdown('  \n') }
      markdown.appendText(line)
    }
  }
  if (metadata?.status === 'ready' && hasMetadata(metadata)) {
    const presentation = metadataPresentation(metadata)
    if (hover) {
      markdown.appendMarkdown(`\n\n${hoverMetadataHtml(presentation.rows)}\n\n`)
      if (presentation.abbreviated) { appendText(markdown, 'Open Image Details for more.', true).appendMarkdown('\n\n') }
    }
    else if (presentation.fields.length) {
      markdown.appendMarkdown('\n\n### Metadata\n\n')
      markdown.appendMarkdown('| Field | Value |\n| --- | --- |\n')
      for (const field of presentation.fields) {
        markdown.appendMarkdown('| ')
        appendTableCell(markdown, field.label).appendMarkdown(' | ')
        appendTableCell(markdown, field.value).appendMarkdown(' |\n')
      }
      markdown.appendMarkdown('\n\n')
    }
    if (metadata.truncated) { appendText(markdown, 'Large metadata values were abbreviated to keep the preview responsive.', hover).appendMarkdown('\n\n') }
  }
  return markdown
}

function appendTableCell(markdown: vscode.MarkdownString, value: string): vscode.MarkdownString {
  for (const [lineIndex, line] of value.split(/\r\n?|\n/).entries()) {
    if (lineIndex) { markdown.appendMarkdown('<br>') }
    for (const [partIndex, part] of line.split('|').entries()) {
      if (partIndex) { markdown.appendMarkdown('&#124;') }
      markdown.appendText(part)
    }
  }
  return markdown
}

function appendText(markdown: vscode.MarkdownString, value: string, wrap: boolean): vscode.MarkdownString {
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
