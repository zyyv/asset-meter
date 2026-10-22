export const FileKind = { File: 1, Directory: 2, SymbolicLink: 64 } as const

export interface FileStat { type: number, size: number }
export interface FileSystem {
  stat: (key: string) => Promise<FileStat>
  readDirectory: (key: string) => Promise<[string, number][]>
  join: (key: string, name: string) => string
}

export interface Metrics {
  bytes: number
  files: number
  directFiles: number
  directories: number
  skipped: number
  errors: number
  isDirectory: boolean
}

export interface Settings {
  enabled: boolean
  displayMode: 'always' | 'hover'
  fileExtensions: string[]
  folderNames: string[]
  exclude: string[]
  showFileCount: boolean
  fileCountMode: 'recursive' | 'direct'
  units: 'binary' | 'decimal'
  decimalPlaces: number
  colorize: boolean
  fileColorThresholdsMiB: number[]
  folderColorThresholdsMiB: number[]
}
