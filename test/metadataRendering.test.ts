import assert from 'node:assert/strict'
import { it } from 'vitest'
import { normalizeMetadata } from '../src/metadata/normalize'
import { metadataPresentation } from '../src/metadata/presentation'
import { formatMetadataValue } from '../src/metadata/presentation/format'
import { hoverInfoHtml, hoverMetadataHtml } from '../src/metadata/rendering/hover'

it('treats prototype-named metadata fields and unknown enum values as ordinary text', () => {
  const metadata = normalizeMetadata(JSON.parse('{"pngText":{"constructor":"Camera author","toString":"Description","__proto__":"Custom value"}}'))
  const view = metadataPresentation(metadata)
  assert.equal(view.rows.length, 3)
  assert.ok(view.rows.every(field => typeof field.label === 'string' && typeof field.value === 'string'))
  assert.match(hoverMetadataHtml(view.rows), /Camera author/)
  assert.equal(formatMetadataValue('ColorSpace', 'constructor'), 'constructor')
  assert.equal(formatMetadataValue('Orientation', 'toString'), 'toString')
})

it('escapes resource text without allowing metadata to select markup or icon classes', () => {
  const html = hoverInfoHtml([{ key: 'device-camera" onclick="run()', label: '<b>Camera</b>', value: '<script>alert(1)</script> $(zap)' }])
  assert.ok(html.includes('&lt;b&gt;Camera&lt;/b&gt;'))
  assert.ok(html.replaceAll('<wbr>', '').includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('$(zap)'), 'user text is never interpreted as a theme icon')
  assert.doesNotMatch(html, /<script>|<b>|<[^>]+\bonclick=/)
  assert.ok(!html.includes('codicon-device-camera'), 'only known field IDs select icons')
})

it('retains multiline paths and complete graphemes while wrapping escaped filename text', () => {
  const html = hoverInfoHtml([{ key: 'Path', label: 'Path', value: '/assets/👩🏽‍💻/line\n<draft>.png' }])
  const text = html.replaceAll('<wbr>', '')
  assert.match(text, /👩🏽\u200D💻\/line<br>&lt;draft&gt;\.png/)
  assert.ok(!html.includes('<draft>'))
})

it('reuses one presentation and row array for both views without changing the parsed data', () => {
  const metadata = normalizeMetadata({ exif: { Model: 'Shared camera', ExposureTime: 1 / 30, FNumber: 2.8, ISO: 5000 } })
  const original = JSON.stringify(metadata)
  const first = metadataPresentation(metadata)
  const second = metadataPresentation(metadata)
  assert.equal(first, second)
  assert.equal(first.rows, second.rows)
  assert.equal(first.fields, second.fields)
  assert.equal(JSON.stringify(metadata), original)
})
