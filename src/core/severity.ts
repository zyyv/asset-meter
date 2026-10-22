import type { Settings } from './types'

export type SizeSeverity = 'normal' | 'warning' | 'large' | 'critical'
export const defaultFileThresholds = [0.25, 1, 5]
export const defaultFolderThresholds = [10, 50, 100]

export function sizeSeverity(bytes: number, isDirectory: boolean, settings: Settings): SizeSeverity {
  const fallback = isDirectory ? defaultFolderThresholds : defaultFileThresholds
  const configured = isDirectory ? settings.folderColorThresholdsMiB : settings.fileColorThresholdsMiB
  const thresholds = configured.length === 3 && configured.every(value => Number.isFinite(value) && value >= 0)
    ? [...configured].sort((a, b) => a - b)
    : fallback
  if (bytes >= thresholds[2]! * 1024 ** 2) { return 'critical' }
  if (bytes >= thresholds[1]! * 1024 ** 2) { return 'large' }
  if (bytes >= thresholds[0]! * 1024 ** 2) { return 'warning' }
  return 'normal'
}
