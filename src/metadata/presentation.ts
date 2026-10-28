import type { AssetMetadata } from './types'

export interface PresentedField { key: string, label: string, value: string }
export interface HoverField extends PresentedField { section: string }
export interface MetadataPresentation {
  fields: PresentedField[]
  rows: HoverField[]
  abbreviated: boolean
}

const presentations = new WeakMap<AssetMetadata, MetadataPresentation>()
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

function numeric(value?: string): number | undefined {
  if (!value?.trim()) { return undefined }
  const parts = value.trim().split('/')
  const result = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(value)
  return Number.isFinite(result) ? result : undefined
}

function decimal(value: number, places = 2): string { return String(Number(value.toFixed(places))) }

function coordinate(value: string | undefined, reference: string | undefined, latitude: boolean): string | undefined {
  if (!value) { return undefined }
  let number = numeric(value)
  if (number === undefined) {
    try {
      const parts: unknown = JSON.parse(value)
      if (Array.isArray(parts) && parts.length === 3 && parts.every(part => typeof part === 'number' && Number.isFinite(part))) {
        number = parts[0] + parts[1] / 60 + parts[2] / 3600
      }
    }
    catch { return undefined }
  }
  if (number === undefined || Math.abs(number) > (latitude ? 90 : 180)) { return undefined }
  const negative = number < 0 || /^(?:S|W|South|West)$/i.test(reference ?? '')
  return `${decimal(Math.abs(number), 6)}° ${latitude ? negative ? 'S' : 'N' : negative ? 'W' : 'E'}`
}

export function formatMetadataValue(key: string, value: string): string {
  const number = numeric(value)
  if (key === 'ExposureTime' && number !== undefined && number > 0) {
    const denominator = Math.round(1 / number)
    return number < 1 && Math.abs(1 / number - denominator) < 0.01
      ? `1/${denominator} s`
      : `${decimal(number, number < 0.01 ? 6 : 2)} s`
  }
  if (key === 'FNumber' && number !== undefined && number > 0) { return `f/${decimal(number)}` }
  if ((key === 'FocalLength' || key === 'FocalLengthIn35mmFormat') && number !== undefined) { return `${decimal(number)} mm` }
  if ((key === 'ExposureCompensation' || key === 'ExposureBiasValue') && number !== undefined) { return `${number > 0 ? '+' : ''}${decimal(number)} EV` }
  if (key === 'ColorSpace') { return ({ 1: 'sRGB', 2: 'Adobe RGB', 65535: 'Uncalibrated' } as Record<string, string>)[value] ?? value }
  if (key === 'Flash') {
    if (number !== undefined) { return (number & 1) === 1 ? 'Fired' : 'Off' }
    if (/did not fire|not fired|^off$/i.test(value)) { return 'Off' }
    if (/fired|^on$/i.test(value)) { return 'Fired' }
  }
  if (key === 'WhiteBalance') {
    if (value === '0' || /^auto(?:matic)?(?: white balance)?$/i.test(value)) { return 'Auto' }
    if (value === '1' || /^manual(?: white balance)?$/i.test(value)) { return 'Manual' }
  }
  if (key === 'Orientation') {
    if (value === '1' || /horizontal.*normal|^normal$/i.test(value)) { return 'Normal' }
    const orientations: Record<string, string> = { 2: 'Mirrored horizontally', 3: 'Rotated 180°', 4: 'Mirrored vertically', 5: 'Mirrored and rotated 270°', 6: 'Rotated 90° CW', 7: 'Mirrored and rotated 90°', 8: 'Rotated 90° CCW' }
    return orientations[value] ?? value.replace(/Rotate (\d+) (CW|CCW)/i, 'Rotated $1° $2')
  }
  if (['DateTimeOriginal', 'CreateDate', 'ModifyDate'].includes(key)) {
    // exifr revives TIFF dates in the worker's local timezone. Recover that
    // recorded clock time rather than showing the serialized UTC ISO string.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) {
        const pad = (part: number) => String(part).padStart(2, '0')
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      }
    }
    return value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
  }
  if (key === 'BitDepth' && number !== undefined) { return `${number}-bit` }
  return value
}

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
  const add = (key: string, label: string, value: string | undefined, sources = [key]) => {
    for (const source of sources) { consumed.add(source) }
    if (value) { fields.push({ key, label, value }) }
    return value
  }
  const formatted = (key: string) => { const value = raw.get(key); return value ? formatMetadataValue(key, value) : undefined }

  const camera = add('Camera', 'Camera', combine(pick('Make'), pick('Model')), ['Make', 'Model'])
  add('Lens', 'Lens', combine(pick('LensMake'), pick('LensModel')), ['LensMake', 'LensModel'])
  const capturedDate = formatted('DateTimeOriginal') ?? formatted('CreateDate')
  add('Captured', 'Captured', capturedDate ? [capturedDate, pick('OffsetTimeOriginal')].filter(Boolean).join(' ') : undefined, ['DateTimeOriginal', 'OffsetTimeOriginal'])
  const width = numeric(pick('ImageWidth', 'ExifImageWidth'))
  const height = numeric(pick('ImageHeight', 'ExifImageHeight'))
  if (width && height && width > 0 && height > 0) {
    add('Dimensions', 'Dimensions', `${numberFormat.format(width)} × ${numberFormat.format(height)} px${width * height >= 1_000_000 ? ` · ${decimal(width * height / 1_000_000, 1)} MP` : ''}`, ['ImageWidth', 'ExifImageWidth', 'ImageHeight', 'ExifImageHeight'])
  }
  const shutter = add('ExposureTime', 'Shutter speed', formatted('ExposureTime'))
  add('FNumber', 'Aperture', formatted('FNumber'))
  add('ISO', 'ISO', pick('ISO', 'PhotographicSensitivity'), ['ISO', 'PhotographicSensitivity'])
  add('FocalLength', 'Focal length', formatted('FocalLength'))
  add('FocalLengthIn35mmFormat', '35mm equivalent', formatted('FocalLengthIn35mmFormat'))
  add('WhiteBalance', 'White balance', formatted('WhiteBalance'))
  add('Flash', 'Flash', formatted('Flash'))
  add('ColorSpace', 'Color space', formatted('ColorSpace'))
  const compensationKey = raw.has('ExposureCompensation') ? 'ExposureCompensation' : 'ExposureBiasValue'
  add('ExposureCompensation', 'Exposure compensation', formatted(compensationKey), ['ExposureCompensation', 'ExposureBiasValue'])
  add('Orientation', 'Orientation', formatted('Orientation'))
  const rating = numeric(pick('Rating'))
  add('Rating', 'Rating', rating && rating > 0 ? `${Math.min(5, rating)} / 5` : undefined)
  add('CreateDate', 'Created', formatted('CreateDate') === capturedDate ? undefined : formatted('CreateDate'))
  add('ModifyDate', 'Modified', formatted('ModifyDate') === capturedDate ? undefined : formatted('ModifyDate'))
  add('Latitude', 'Latitude', coordinate(pick('latitude', 'GPSLatitude'), pick('GPSLatitudeRef'), true), ['latitude', 'GPSLatitude', 'GPSLatitudeRef'])
  add('Longitude', 'Longitude', coordinate(pick('longitude', 'GPSLongitude'), pick('GPSLongitudeRef'), false), ['longitude', 'GPSLongitude', 'GPSLongitudeRef'])
  const altitude = numeric(pick('GPSAltitude'))
  add('Altitude', 'Altitude', altitude === undefined ? undefined : `${numberFormat.format(/below|^1$/i.test(pick('GPSAltitudeRef') ?? '') ? -Math.abs(altitude) : altitude)} m`, ['GPSAltitude', 'GPSAltitudeRef'])

  const seen = new Set(fields.map(field => `${field.label}\0${field.value}`))
  for (const field of entries) {
    if (consumed.has(field.name)) { continue }
    const label = field.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())
    const value = formatMetadataValue(field.name, field.value)
    const key = `${label}\0${value}`
    if (seen.has(key)) { continue }
    seen.add(key)
    fields.push({ key: field.name, label, value })
  }

  const order = ['Camera', 'Lens', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat', 'ExposureCompensation', 'Captured', 'Dimensions', 'Latitude', 'Longitude', 'Altitude', 'WhiteBalance', 'Flash', 'ColorSpace', 'Orientation', 'Rating']
  const labels: Record<string, string> = { ExposureTime: 'Shutter', FocalLengthIn35mmFormat: '35mm equiv.', ExposureCompensation: 'EV comp.' }
  const rows: HoverField[] = []
  let abbreviated = false
  let supplemental = 0
  for (const field of [...fields].sort((a, b) => (!order.includes(a.key) ? 99 : order.indexOf(a.key)) - (!order.includes(b.key) ? 99 : order.indexOf(b.key)))) {
    if ((camera || shutter) && ['Software', 'CreateDate', 'ModifyDate'].includes(field.key)) { continue }
    if (field.key === 'Orientation' && field.value === 'Normal') { continue }
    if (field.key === 'ExposureCompensation' && !numeric(raw.get(compensationKey))) { continue }
    if (!order.includes(field.key) && ++supplemental > 4) { abbreviated = true; continue }
    const section = ['Camera', 'Lens'].includes(field.key)
      ? 'equipment'
      : ['ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat', 'ExposureCompensation'].includes(field.key)
          ? 'exposure'
          : ['Captured', 'Dimensions'].includes(field.key) ? 'image' : 'details'
    const value = field.value.length > 160 ? `${field.value.slice(0, 160)}…` : field.value
    if (value !== field.value) { abbreviated = true }
    if (field.key === 'Captured') {
      const date = /^(\d{4}-\d{2}-\d{2}) (.+)$/.exec(value)
      if (date) {
        rows.push({ key: 'Date', label: 'Date', value: date[1]!, section }, { key: 'Time', label: 'Time', value: date[2]!, section })
        continue
      }
    }
    if (field.key === 'Dimensions') {
      const [pixels, megapixels] = value.split(' · ')
      rows.push({ key: 'Image', label: 'Image', value: pixels!, section })
      if (megapixels) { rows.push({ key: 'Resolution', label: 'Resolution', value: megapixels, section }) }
      continue
    }
    rows.push({ key: field.key, label: labels[field.key] ?? field.label, value: field.key === 'Lens' ? value.split(/\s*\|\s*/)[0]!.trim() : value, section })
  }
  const result = { fields, rows, abbreviated }
  presentations.set(metadata, result)
  return result
}
