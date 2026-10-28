import type { FileStat } from '../../src/core/types'
import { vi } from 'vitest'

export const state = {
  entries: new Map<string, FileStat>(),
  config: {} as Record<string, unknown>,
  workspaceRoot: 'file:///workspace',
  workspaceRoots: undefined as string[] | undefined,
  beforeStat: undefined as ((key: string) => Promise<void>) | undefined,
  beforeRead: undefined as ((key: string) => Promise<void>) | undefined,
}

export async function createVscodeMock() {
  const { posix } = await import('node:path')
  class Uri {
    constructor(private readonly url: URL) {}
    static parse(key: string) { return new Uri(new URL(key)) }
    static from(parts: { scheme: string, path: string, query: string }) {
      return Uri.parse(`${parts.scheme}:${parts.path}?${encodeURIComponent(parts.query)}`)
    }

    static joinPath(uri: Uri, ...parts: string[]) {
      const url = new URL(uri.toString())
      url.pathname = posix.join(url.pathname, ...parts)
      return new Uri(url)
    }

    get scheme() { return this.url.protocol.slice(0, -1) }
    get authority() { return this.url.host }
    get path() { return decodeURIComponent(this.url.pathname) }
    get fsPath() { return this.path }
    get query() { return decodeURIComponent(this.url.search.slice(1)) }
    with(change: { scheme?: string }) {
      return Uri.parse(change.scheme ? this.toString().replace(/^[^:]+:/, `${change.scheme}:`) : this.toString())
    }

    toString() { return this.url.toString() }
  }
  class EventEmitter<T> {
    private readonly listeners = new Set<(value: T) => void>()
    readonly event = (listener: (value: T) => void) => {
      this.listeners.add(listener)
      return { dispose: () => this.listeners.delete(listener) }
    }

    fire(value: T) { for (const listener of this.listeners) { listener(value) } }
    dispose() { this.listeners.clear() }
  }
  return {
    Uri,
    EventEmitter,
    MarkdownString: class {
      constructor(public value = '') {}
      appendText(value: string) {
        this.value += value.replace(/([\\`*_{}[\]()#+\-.!<>])/g, '\\$1').replace(/\n/g, '  \n')
        return this
      }

      appendMarkdown(value: string) { this.value += value; return this }
    },
    TreeItem: class {
      constructor(public label: string, public collapsibleState: number) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: { File: { id: 'file' }, Folder: { id: 'folder' } },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      get workspaceFolders() {
        return (state.workspaceRoots ?? [state.workspaceRoot]).map((root, index) => ({ uri: Uri.parse(root), name: posix.basename(Uri.parse(root).path), index }))
      },
      getWorkspaceFolder: (uri: Uri) => {
        const root = (state.workspaceRoots ?? [state.workspaceRoot]).map(key => Uri.parse(key)).sort((a, b) => b.path.length - a.path.length).find(root => uri.toString() === root.toString() || uri.toString().startsWith(`${root}/`))
        return root ? { uri: root } : undefined
      },
      getConfiguration: vi.fn(() => ({ get: (key: string, fallback: unknown) => state.config[key] ?? fallback })),
      textDocuments: [],
      registerTextDocumentContentProvider: vi.fn(() => ({ dispose() {} })),
      registerFileSystemProvider: vi.fn(() => ({ dispose() {} })),
      fs: {
        readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
        stat: vi.fn(async (uri: Uri) => {
          await state.beforeStat?.(uri.toString())
          const entry = state.entries.get(uri.toString())
          if (!entry) { throw Object.assign(new Error('Not found'), { code: 'FileNotFound' }) }
          return { ...entry }
        }),
        readDirectory: vi.fn(async (uri: Uri) => {
          await state.beforeRead?.(uri.toString())
          return [...state.entries]
            .filter(([key]) => key !== uri.toString() && key.startsWith(`${uri.toString().replace(/\/$/, '')}/`) && posix.dirname(Uri.parse(key).path) === uri.path)
            .map(([key, stat]) => [posix.basename(Uri.parse(key).path), stat.type])
        }),
      },
    },
  }
}

export function workspaceUris(vscode: typeof import('vscode')) {
  const assets = vscode.Uri.parse('file:///workspace/assets')
  return { assets, logo: vscode.Uri.joinPath(assets, 'logo.png'), token: { isCancellationRequested: false } as import('vscode').CancellationToken }
}

export function resetWorkspace(vscode: typeof import('vscode')): void {
  const { assets, logo } = workspaceUris(vscode)

  vi.clearAllMocks()
  state.beforeStat = undefined
  state.beforeRead = undefined
  state.workspaceRoots = undefined
  state.workspaceRoot = 'file:///workspace'
  state.config = { include: ['**/*.png', '**/assets'], exclude: ['**/node_modules/**'] }
  state.entries.clear()
  state.entries.set(assets.toString(), { type: vscode.FileType.Directory, size: 0 })
  state.entries.set(logo.toString(), { type: vscode.FileType.File, size: 10 })
  vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new Uint8Array([1, 2, 3]))
}
