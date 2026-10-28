export interface MetadataGroup {
  name: string
  fields: { name: string, value: string }[]
}

export interface AssetMetadata {
  status: 'ready' | 'empty' | 'unsupported' | 'error'
  groups: MetadataGroup[]
  truncated?: boolean
  message?: string
}

export type MetadataInput = string | Uint8Array

export interface MetadataReader {
  parse: (input: MetadataInput) => Promise<AssetMetadata>
  dispose: () => void
}
