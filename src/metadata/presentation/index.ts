import type { AssetMetadata } from '../types'
import type { MetadataPresentation, PresentedField } from './fields'
import { fieldLabel } from './fields'
import { coordinate, decimal, formatMetadataValue, formatNumber, numeric } from './format'
import { summarizeMetadata } from './summary'

const presentations = new WeakMap<AssetMetadata, MetadataPresentation>()

function combine(make?: string, model?: string): string | undefined {
  if (!model) { return make }
  return make && !model.toLowerCase().includes(make.toLowerCase()) ? `${make} ${model}` : model
}

export function metadataPresentation(metadata: AssetMetadata): MetadataPresentation {
  const cached = presentations.get(metadata)
  if (cached) { return cached }
  const entries = metadata.groups.flatMap(group => group.fields).filter(field => field.value.trim())
  const raw = new Map<string, string>()
  for (const field of entries) { if (!raw.has(field.name)) { raw.set(field.name, field.value.trim()) } }
  const fields: PresentedField[] = []
  const consumed = new Set<string>()
  const pick = (...keys: string[]) => keys.map(key => raw.get(key)).find(Boolean)
  const add = (key: string, value: string | undefined, sources = [key]) => {
    for (const source of sources) { consumed.add(source) }
    if (value) { fields.push({ key, label: fieldLabel(key), value }) }
    return value
  }
  const formatted = (key: string) => { const value = raw.get(key); return value ? formatMetadataValue(key, value) : undefined }

  const camera = add('Camera', combine(pick('Make'), pick('Model')), ['Make', 'Model'])
  add('Lens', combine(pick('LensMake'), pick('LensModel')), ['LensMake', 'LensModel'])
  const createdDate = formatted('CreateDate')
  const modifiedDate = formatted('ModifyDate')
  const capturedDate = formatted('DateTimeOriginal') ?? createdDate
  add('Captured', capturedDate ? [capturedDate, pick('OffsetTimeOriginal')].filter(Boolean).join(' ') : undefined, ['DateTimeOriginal', 'OffsetTimeOriginal'])
  const width = numeric(pick('ImageWidth', 'ExifImageWidth'))
  const height = numeric(pick('ImageHeight', 'ExifImageHeight'))
  if (width && height && width > 0 && height > 0) {
    add('Dimensions', `${formatNumber(width)} × ${formatNumber(height)} px${width * height >= 1_000_000 ? ` · ${decimal(width * height / 1_000_000, 1)} MP` : ''}`, ['ImageWidth', 'ExifImageWidth', 'ImageHeight', 'ExifImageHeight'])
  }
  const shutter = add('ExposureTime', formatted('ExposureTime'))
  add('FNumber', formatted('FNumber'))
  add('ISO', pick('ISO', 'PhotographicSensitivity'), ['ISO', 'PhotographicSensitivity'])
  add('FocalLength', formatted('FocalLength'))
  add('FocalLengthIn35mmFormat', formatted('FocalLengthIn35mmFormat'))
  add('WhiteBalance', formatted('WhiteBalance'))
  add('Flash', formatted('Flash'))
  add('ColorSpace', formatted('ColorSpace'))
  const compensationKey = raw.has('ExposureCompensation') ? 'ExposureCompensation' : 'ExposureBiasValue'
  add('ExposureCompensation', formatted(compensationKey), ['ExposureCompensation', 'ExposureBiasValue'])
  add('Orientation', formatted('Orientation'))
  const rating = numeric(pick('Rating'))
  add('Rating', rating && rating > 0 ? `${Math.min(5, rating)} / 5` : undefined)
  add('CreateDate', createdDate === capturedDate ? undefined : createdDate)
  add('ModifyDate', modifiedDate === capturedDate ? undefined : modifiedDate)
  add('Latitude', coordinate(pick('latitude', 'GPSLatitude'), pick('GPSLatitudeRef'), true), ['latitude', 'GPSLatitude', 'GPSLatitudeRef'])
  add('Longitude', coordinate(pick('longitude', 'GPSLongitude'), pick('GPSLongitudeRef'), false), ['longitude', 'GPSLongitude', 'GPSLongitudeRef'])
  const altitude = numeric(pick('GPSAltitude'))
  add('Altitude', altitude === undefined ? undefined : `${formatNumber(/below|^1$/i.test(pick('GPSAltitudeRef') ?? '') ? -Math.abs(altitude) : altitude)} m`, ['GPSAltitude', 'GPSAltitudeRef'])

  const seen = new Set(fields.map(field => `${field.label}\0${field.value}`))
  for (const field of entries) {
    if (consumed.has(field.name)) { continue }
    const label = fieldLabel(field.name)
    const value = formatMetadataValue(field.name, field.value)
    const key = `${label}\0${value}`
    if (seen.has(key)) { continue }
    seen.add(key)
    fields.push({ key: field.name, label, value })
  }

  const summary = summarizeMetadata(fields, { photo: !!(camera || shutter), compensation: numeric(raw.get(compensationKey)) })
  const result = { fields, ...summary }
  presentations.set(metadata, result)
  return result
}
