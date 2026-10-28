export function boundedSetting(value: number, fallback: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(1, Math.floor(value))) : fallback
}

export function parseQuality(value: string): number | undefined {
  if (!/^\d{1,3}$/.test(value.trim())) { return }
  const quality = Number(value)
  return quality >= 1 && quality <= 100 ? quality : undefined
}
