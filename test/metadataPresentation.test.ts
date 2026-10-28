import assert from 'node:assert/strict'
import { it } from 'vitest'
import { normalizeMetadata } from '../src/metadata/normalize'
import { metadataPresentation } from '../src/metadata/presentation'
import { formatMetadataValue } from '../src/metadata/presentation/format'

it('formats exposure and optical values with photographic units instead of floating-point noise', () => {
  assert.equal(formatMetadataValue('ExposureTime', '0.03333333333333333'), '1/30 s')
  assert.equal(formatMetadataValue('ExposureTime', '0.008'), '1/125 s')
  assert.equal(formatMetadataValue('ExposureTime', '1/250'), '1/250 s')
  assert.equal(formatMetadataValue('ExposureTime', '2.5'), '2.5 s')
  assert.equal(formatMetadataValue('ExposureTime', '0.3'), '0.3 s')
  assert.equal(formatMetadataValue('FNumber', '2.8000000000000003'), 'f/2.8')
  assert.equal(formatMetadataValue('FocalLength', '18'), '18 mm')
  assert.equal(formatMetadataValue('ExposureCompensation', '0.6666666666666666'), '+0.67 EV')
  assert.equal(formatMetadataValue('ExposureCompensation', '-1'), '-1 EV')
})

it('translates color, flash, white balance and orientation into short readable values', () => {
  assert.equal(formatMetadataValue('ColorSpace', '1'), 'sRGB')
  assert.equal(formatMetadataValue('ColorSpace', '2'), 'Adobe RGB')
  assert.equal(formatMetadataValue('Flash', 'Flash did not fire, compulsory flash mode'), 'Off')
  assert.equal(formatMetadataValue('Flash', '16'), 'Off')
  assert.equal(formatMetadataValue('Flash', '25'), 'Fired')
  assert.equal(formatMetadataValue('WhiteBalance', '0'), 'Auto')
  assert.equal(formatMetadataValue('Orientation', 'Horizontal (normal)'), 'Normal')
  assert.equal(formatMetadataValue('Orientation', '6'), 'Rotated 90° CW')
})

it('creates a compact photo summary, restores the recorded clock time and removes duplicate dates', () => {
  const captured = new Date(2024, 1, 15, 19, 37, 34)
  const metadata = normalizeMetadata({
    ifd0: { Make: 'SONY', Model: 'ILCE-6700', Orientation: 'Horizontal (normal)', ModifyDate: captured, Software: 'ILCE-6700 v1.01' },
    exif: { LensModel: '18-50mm F2.8 DC DN | Contemporary 021', DateTimeOriginal: captured, CreateDate: captured, OffsetTimeOriginal: '+08:00', ExposureTime: 1 / 30, FNumber: 2.8, ISO: 5000, FocalLength: 18, FocalLengthIn35mmFormat: 27, ExifImageWidth: 6192, ExifImageHeight: 4128, ColorSpace: 1, Flash: 'Flash did not fire, compulsory flash mode', WhiteBalance: 'Manual', ExposureCompensation: 0 },
    xmp: { Rating: 0 },
  })
  const snapshot = JSON.stringify(metadata)
  const result = metadataPresentation(metadata)
  const text = result.rows.map(row => `${row.label}: ${row.value}`).join('\n')
  assert.match(text, /SONY ILCE-6700/)
  assert.match(text, /18-50mm F2\.8 DC DN/)
  assert.doesNotMatch(text, /Contemporary/)
  assert.ok(result.fields.find(field => field.key === 'Lens')?.value.includes('Contemporary 021'), 'the full details retain the complete lens model')
  assert.match(text, /Shutter: 1\/30 s/)
  assert.match(text, /Aperture: f\/2\.8/)
  assert.match(text, /ISO: 5000/)
  assert.match(text, /Focal length: 18 mm/)
  assert.match(text, /35mm equiv\.: 27 mm/)
  assert.match(text, /Date: 2024-02-15/)
  assert.match(text, /Time: 19:37:34 \+08:00/)
  assert.match(text, /Image: 6,192 × 4,128 px/)
  assert.match(text, /Resolution: 25\.6 MP/)
  assert.match(text, /White balance: Manual/)
  assert.match(text, /Flash: Off/)
  assert.match(text, /Color space: sRGB/)
  assert.doesNotMatch(text, /Rating|Orientation|Software|CreateDate|ModifyDate|0\.033333|0 EV/)
  assert.ok(!result.fields.some(field => ['Rating', 'CreateDate', 'ModifyDate'].includes(field.key)))
  assert.equal(JSON.stringify(metadata), snapshot, 'presentation leaves shared cached metadata intact')
})

it('formats GPS coordinates and altitude without showing redundant raw DMS arrays or reference flags', () => {
  const metadata = normalizeMetadata({ gps: { latitude: 22.5, GPSLatitude: [22, 30, 0], GPSLatitudeRef: 'N', GPSLongitude: [114, 15, 0], GPSLongitudeRef: 'W', GPSAltitude: 12.345, GPSAltitudeRef: 1 } })
  const fields = metadataPresentation(metadata).fields
  assert.equal(fields.find(field => field.key === 'Latitude')?.value, '22.5° N')
  assert.equal(fields.find(field => field.key === 'Longitude')?.value, '114.25° W')
  assert.equal(fields.find(field => field.key === 'Altitude')?.value, '-12.3 m')
  assert.equal(fields.length, 3)
})

it('preserves custom text, handles missing photo fields and avoids zero-megapixel labels for icons', () => {
  const description = '<script>unsafe</script> | custom\nmetadata'
  const result = metadataPresentation(normalizeMetadata({ pngText: { Author: 'Asset Meter UI', Description: description }, ihdr: { ImageWidth: 1, ImageHeight: 1 } }))
  assert.equal(result.fields.find(field => field.key === 'Description')?.value, description)
  assert.equal(result.fields.find(field => field.key === 'Dimensions')?.value, '1 × 1 px')
  assert.ok(result.rows.some(row => row.value.includes('Asset Meter UI')))
  assert.equal(formatMetadataValue('ExposureTime', 'invalid'), 'invalid')
  assert.equal(formatMetadataValue('DateTimeOriginal', 'invalid'), 'invalid')
  assert.equal(formatMetadataValue('DateTimeOriginal', '2024:02:15 19:37:34'), '2024-02-15 19:37:34')
})

it('does not regroup custom text fields that share names with generated image summary rows', () => {
  const result = metadataPresentation(normalizeMetadata({ pngText: { Date: 'custom date', Time: 'custom time', Image: 'custom image', Resolution: 'custom resolution' } }))
  assert.deepEqual(result.rows.map(row => row.section), ['details', 'details', 'details', 'details'])
})
