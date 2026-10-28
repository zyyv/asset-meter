import type { AssetMetadata, MetadataGroup } from './types'
import { metadataLimits } from './limits'

const photoFields = new Set([
  'Make',
  'Model',
  'LensMake',
  'LensModel',
  'DateTimeOriginal',
  'OffsetTimeOriginal',
  'CreateDate',
  'ModifyDate',
  'ImageWidth',
  'ImageHeight',
  'ExifImageWidth',
  'ExifImageHeight',
  'Orientation',
  'ExposureTime',
  'FNumber',
  'ISO',
  'PhotographicSensitivity',
  'FocalLength',
  'FocalLengthIn35mmFormat',
  'ExposureCompensation',
  'ExposureBiasValue',
  'WhiteBalance',
  'Flash',
  'ColorSpace',
  'Software',
  'Artist',
  'Copyright',
  'ImageDescription',
  'UserComment',
  'Title',
  'Description',
  'Rating',
  'XPTitle',
  'XPComment',
  'XPAuthor',
  'XPKeywords',
  'XPSubject',
])
const gpsFields = new Set(['latitude', 'longitude', 'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef', 'GPSDateStamp', 'GPSTimeStamp'])
const profileFields = new Set(['ProfileDescription', 'ProfileDescriptionML', 'ColorSpaceData', 'ProfileCopyright'])
const imageFields = new Set(['ImageWidth', 'ImageHeight', 'BitDepth'])

function usefulField(group: string, key: string): boolean {
  if (group === 'ifd1' || group === 'interop') { return false }
  if (group === 'ifd0' || group === 'exif') { return photoFields.has(key) }
  if (group === 'gps') { return gpsFields.has(key) }
  if (group === 'icc') { return profileFields.has(key) }
  if (group === 'ihdr') { return imageFields.has(key) }
  return true
}

export function hasMetadata(metadata?: AssetMetadata): boolean {
  // A PNG's mandatory IHDR header alone is not embedded metadata.
  return !!metadata?.groups.some(group => group.name !== 'ihdr' && group.fields.some(field => field.value.trim().length > 0))
}

// Bound both the worker response and the retained cache. Binary data (profiles,
// thumbnails, maker notes) must never become megabytes of Markdown.
export function normalizeMetadata(output: unknown): AssetMetadata {
  const result: AssetMetadata = { status: 'empty', groups: [] }
  if (!output || typeof output !== 'object') { return result }
  let remaining = metadataLimits.outputCharacters
  let count = 0
  for (const [name, values] of Object.entries(output)) {
    if (name === 'errors' || !values || typeof values !== 'object' || ArrayBuffer.isView(values) || values instanceof ArrayBuffer || Array.isArray(values)) { continue }
    const fields: MetadataGroup['fields'] = []
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || !usefulField(name, key)) { continue }
      if (++count > metadataLimits.fields || remaining <= 0) { result.truncated = true; break }
      let text: string
      if (value instanceof Date) { text = Number.isNaN(value.getTime()) ? String(value) : value.toISOString() }
      else if (typeof value === 'object') { text = JSON.stringify(value, (_key, nested) => ArrayBuffer.isView(nested) ? `[Binary data: ${nested.byteLength} bytes]` : nested) }
      else { text = String(value) }
      const limit = Math.min(metadataLimits.fieldCharacters, remaining)
      if (text.length > limit) { text = `${text.slice(0, limit)}…`; result.truncated = true }
      remaining -= text.length + key.length
      fields.push({ name: key.slice(0, metadataLimits.fieldNameCharacters), value: text })
    }
    if (fields.length) { result.groups.push({ name, fields }) }
  }
  if (hasMetadata(result)) { result.status = 'ready' }
  return result
}
