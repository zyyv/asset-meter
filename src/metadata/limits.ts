// Resource and presentation budgets shared by the worker, cache and renderers.
export const metadataLimits = Object.freeze({
  cacheEntries: 256,
  remoteBytes: 32 * 1024 * 1024,
  segmentBytes: 8 * 1024 * 1024,
  chunks: 4096,
  outputCharacters: 64 * 1024,
  fields: 256,
  fieldCharacters: 2048,
  fieldNameCharacters: 128,
  hoverCharacters: 160,
  supplementalFields: 4,
  workerTimeoutMs: 10_000,
  workerIdleMs: 15_000,
  workerMemoryMiB: 128,
})
