const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
export const formatNumber = (value: number): string => numberFormat.format(value)

export function numeric(value?: string): number | undefined {
  if (!value?.trim()) { return undefined }
  const parts = value.trim().split('/')
  const result = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(value)
  return Number.isFinite(result) ? result : undefined
}

export function decimal(value: number, places = 2): string { return String(Number(value.toFixed(places))) }

export function coordinate(value: string | undefined, reference: string | undefined, latitude: boolean): string | undefined {
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

const colorSpaces = new Map([['1', 'sRGB'], ['2', 'Adobe RGB'], ['65535', 'Uncalibrated']])
const orientations = new Map([['2', 'Mirrored horizontally'], ['3', 'Rotated 180°'], ['4', 'Mirrored vertically'], ['5', 'Mirrored and rotated 270°'], ['6', 'Rotated 90° CW'], ['7', 'Mirrored and rotated 90°'], ['8', 'Rotated 90° CCW']])
const dates = new Set(['DateTimeOriginal', 'CreateDate', 'ModifyDate'])

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
  if (key === 'ColorSpace') { return colorSpaces.get(value) ?? value }
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
    return orientations.get(value) ?? value.replace(/Rotate (\d+) (CW|CCW)/i, 'Rotated $1° $2')
  }
  if (dates.has(key)) {
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
