import type { Metrics, Settings } from '../../core/types'
import type { InfoField, MetadataPresentation } from '../presentation/fields'
import type { AssetMetadata } from '../types'
import * as vscode from 'vscode'
import { describeMetricFields } from '../../core/format'
import { hasMetadata } from '../normalize'
import { metadataPresentation } from '../presentation'
import { hoverInfoHtml, hoverMetadataHtml, hoverWidth } from './hover'
import { appendMarkdownText, appendTableCell } from './text'

interface ImageDetailsOptions {
  view: 'hover' | 'details'
  imageHref?: string
}

function appendBasicDetails(markdown: vscode.MarkdownString, fields: readonly InfoField[], hover: boolean): void {
  if (hover) { markdown.appendMarkdown(hoverInfoHtml(fields)); return }
  for (const [index, field] of fields.entries()) {
    if (index) { markdown.appendMarkdown('  \n') }
    markdown.appendText(`${field.label}: ${field.value}`)
  }
}

function appendMetadataTable(markdown: vscode.MarkdownString, presentation: MetadataPresentation): void {
  if (!presentation.fields.length) { return }
  markdown.appendMarkdown('\n\n### Metadata\n\n| Field | Value |\n| --- | --- |\n')
  for (const field of presentation.fields) {
    markdown.appendMarkdown('| ')
    appendTableCell(markdown, field.label).appendMarkdown(' | ')
    appendTableCell(markdown, field.value).appendMarkdown(' |\n')
  }
  markdown.appendMarkdown('\n\n')
}

export function imageDetailsMarkdown(uri: vscode.Uri, metrics: Metrics, settings: Settings, metadata?: AssetMetadata, options: ImageDetailsOptions = { view: 'details' }): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString()
  const hover = options.view === 'hover'
  markdown.supportHtml = true
  // Resource data is escaped text, never trusted HTML or executable commands.
  markdown.isTrusted = false
  if (options.imageHref || uri.scheme === 'file' || uri.scheme === 'vscode-remote') {
    markdown.appendMarkdown(`![Image preview](<${options.imageHref ?? uri.toString()}${hover ? `|width=${hoverWidth}` : ''}>)\n\n`)
  }
  const fields = [{ key: 'Path', label: 'Path', value: uri.path }, ...describeMetricFields(metrics, settings).map(field => ({ key: field.label, ...field }))]
  appendBasicDetails(markdown, fields, hover)
  if (metadata?.status !== 'ready' || !hasMetadata(metadata)) { return markdown }
  const presentation = metadataPresentation(metadata)
  if (hover) {
    markdown.appendMarkdown(`\n\n${hoverMetadataHtml(presentation.rows)}\n\n`)
    if (presentation.abbreviated) { appendMarkdownText(markdown, 'Open Image Details for more.', true).appendMarkdown('\n\n') }
  }
  else { appendMetadataTable(markdown, presentation) }
  if (metadata.truncated) { appendMarkdownText(markdown, 'Large metadata values were abbreviated to keep the preview responsive.', hover).appendMarkdown('\n\n') }
  return markdown
}
