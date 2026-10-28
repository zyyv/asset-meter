export type MetadataSection = 'equipment' | 'exposure' | 'image' | 'details'
export interface PresentedField { key: string, label: string, value: string }
export interface InfoField extends PresentedField { section?: MetadataSection }
export interface HoverField extends PresentedField { section: MetadataSection }
export interface MetadataPresentation {
  fields: PresentedField[]
  rows: HoverField[]
  abbreviated: boolean
}

interface FieldDefinition {
  key: string
  label: string
  icon: string
  section?: MetadataSection
  hoverLabel?: string
  emphasis?: boolean
}

// Order, labels, grouping and icons are one policy, shared by both views.
const primaryFields: readonly FieldDefinition[] = [
  { key: 'Camera', label: 'Camera', icon: 'device-camera', section: 'equipment', emphasis: true },
  { key: 'Lens', label: 'Lens', icon: 'circle-large-outline', section: 'equipment' },
  { key: 'ExposureTime', label: 'Shutter speed', hoverLabel: 'Shutter', icon: 'watch', section: 'exposure', emphasis: true },
  { key: 'FNumber', label: 'Aperture', icon: 'circle-large-outline', section: 'exposure', emphasis: true },
  { key: 'ISO', label: 'ISO', icon: 'dashboard', section: 'exposure', emphasis: true },
  { key: 'FocalLength', label: 'Focal length', icon: 'arrow-both', section: 'exposure' },
  { key: 'FocalLengthIn35mmFormat', label: '35mm equivalent', hoverLabel: '35mm equiv.', icon: 'arrow-both', section: 'exposure' },
  { key: 'ExposureCompensation', label: 'Exposure compensation', hoverLabel: 'EV comp.', icon: 'add', section: 'exposure' },
  { key: 'Captured', label: 'Captured', icon: 'info', section: 'image' },
  { key: 'Dimensions', label: 'Dimensions', icon: 'info', section: 'image' },
  { key: 'Latitude', label: 'Latitude', icon: 'location' },
  { key: 'Longitude', label: 'Longitude', icon: 'location' },
  { key: 'Altitude', label: 'Altitude', icon: 'arrow-up' },
  { key: 'WhiteBalance', label: 'White balance', icon: 'symbol-color' },
  { key: 'Flash', label: 'Flash', icon: 'zap' },
  { key: 'ColorSpace', label: 'Color space', icon: 'symbol-color' },
  { key: 'Orientation', label: 'Orientation', icon: 'sync' },
  { key: 'Rating', label: 'Rating', icon: 'star-full' },
]
const supplementalFields: readonly FieldDefinition[] = [
  { key: 'Path', label: 'Path', icon: 'file' },
  { key: 'Size', label: 'Size', icon: 'database' },
  { key: 'Date', label: 'Date', icon: 'calendar', section: 'image' },
  { key: 'Time', label: 'Time', icon: 'clock', section: 'image' },
  { key: 'Image', label: 'Image', icon: 'file-media', section: 'image' },
  { key: 'Resolution', label: 'Resolution', icon: 'screen-full', section: 'image' },
  { key: 'CreateDate', label: 'Created', icon: 'info' },
  { key: 'ModifyDate', label: 'Modified', icon: 'info' },
  { key: 'Author', label: 'Author', icon: 'person' },
  { key: 'Creator', label: 'Creator', icon: 'person' },
  { key: 'Copyright', label: 'Copyright', icon: 'law' },
  { key: 'Description', label: 'Description', icon: 'note' },
]

const definitions = new Map([...primaryFields, ...supplementalFields].map(field => [field.key, field]))
const priorities = new Map(primaryFields.map((field, index) => [field.key, index]))

export function fieldDefinition(key: string): Readonly<FieldDefinition> | undefined { return definitions.get(key) }
export function fieldPriority(key: string): number { return priorities.get(key) ?? Number.POSITIVE_INFINITY }
export function isPrimaryField(key: string): boolean { return priorities.has(key) }
export function fieldLabel(key: string): string {
  return definitions.get(key)?.label ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())
}
