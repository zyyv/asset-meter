import type { HoverField, PresentedField } from './fields'
import { metadataLimits } from '../limits'
import { fieldDefinition, fieldPriority, isPrimaryField } from './fields'

const redundantPhotoFields = new Set(['Software', 'CreateDate', 'ModifyDate'])

export function summarizeMetadata(fields: readonly PresentedField[], context: { photo: boolean, compensation?: number }): { rows: HoverField[], abbreviated: boolean } {
  const rows: HoverField[] = []
  let abbreviated = false
  let supplemental = 0
  for (const field of [...fields].sort((a, b) => fieldPriority(a.key) - fieldPriority(b.key))) {
    if (context.photo && redundantPhotoFields.has(field.key)) { continue }
    if (field.key === 'Orientation' && field.value === 'Normal') { continue }
    if (field.key === 'ExposureCompensation' && !context.compensation) { continue }
    const primary = isPrimaryField(field.key)
    if (!primary && ++supplemental > metadataLimits.supplementalFields) { abbreviated = true; continue }
    const definition = fieldDefinition(field.key)
    const section = primary ? definition?.section ?? 'details' : 'details'
    const value = field.value.length > metadataLimits.hoverCharacters ? `${field.value.slice(0, metadataLimits.hoverCharacters)}…` : field.value
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
    rows.push({ key: field.key, label: definition?.hoverLabel ?? field.label, value: field.key === 'Lens' ? value.split(/\s*\|\s*/)[0]!.trim() : value, section })
  }
  return { rows, abbreviated }
}
