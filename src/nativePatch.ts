import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'

const patchRevision = 3
const marker = `ASSET_SIZE_NATIVE_PATCH_V${patchRevision}`
const hasPatch = (source: string) => /ASSET_SIZE_NATIVE_PATCH_V\d+/.test(source)
const backupName = '.asset-size-native-patch'
const targets = [
  'out/vs/workbench/api/node/extensionHostProcess.js',
  'out/vs/workbench/workbench.desktop.main.js',
  'out/vs/workbench/workbench.desktop.main.css',
] as const

interface BackupFile { path: string, backup: string, originalHash: string, patchedHash: string, mode: number }
interface Manifest { schema: 1, revision?: number, version: string, appliedAt: number, files: BackupFile[] }
export interface NativePatchStatus { installed: boolean, needsUpgrade: boolean, appliedAt: number, reason: string, backupDirectory: string }
export interface PatchResult { changed: boolean, backupDirectory: string }

// Accept the previous numeric header while older extension hosts finish
// reloading, but only emit invisible headers in the current extension.
const nativeBadgePattern = String.raw`/^\u2063(\u2060{1,4}|[0-3])((?:\d+ files? \u00b7 )?(?:\u2265 )?\d+(?:\.\d+)? (?:B|[KMGTPE]i?B))\u2063$/u`
const badgeStyle = ' white-space: nowrap; width: auto; min-width: 0; max-width: none; flex: 0 0 auto; margin-left: 12px; margin-right: 12px; font-family: var(--vscode-font-family); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; opacity: 1;'
const countStyle = ' margin-left: auto; padding-left: 12px; flex: 0 0 auto; white-space: nowrap; font-size: 11px; font-weight: 400; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground);'
const css = `\n/* ${marker} */
.explorer-folders-view .explorer-item { min-width: 0; flex: 1 1 auto; }
.explorer-folders-view .explorer-item > .monaco-icon-label-container { display: flex; align-items: center; flex: 1 1 auto; min-width: 0; overflow: hidden; }
.explorer-folders-view .explorer-item > .monaco-icon-label-container > .monaco-icon-name-container { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
`
const rendererHelper = `
function __assetSizeNativeBadgeV3(value) {
  const fragments = value.split(", ");
  const pattern = ${nativeBadgePattern};
  const own = fragments.find(part => pattern.test(part));
  if (!own) return null;
  const parsed = pattern.exec(own);
  if (!parsed) return null;
  const header = parsed[1];
  const tone = header.charCodeAt(0) === 0x2060 ? header.length - 1 : Number(header);
  const text = parsed[2];
  const separator = text.lastIndexOf(" · ");
  return {
    size: separator < 0 ? text : text.slice(separator + 3),
    count: separator < 0 ? "" : text.slice(0, separator) + " ·",
    color: ["var(--vscode-descriptionForeground)", "var(--vscode-assetSize-sizeWarning)", "var(--vscode-assetSize-sizeLarge)", "var(--vscode-assetSize-sizeCritical)"][tone],
    other: fragments.filter(part => !pattern.test(part)).join(", ")
  };
}
`

export function patchExtensionHost(source: string): string {
  if (hasPatch(source)) { throw new Error('The extension host already contains an Assets Size patch.') }
  // Keep VS Code's original validation for every other badge. Only our delimited,
  // plain-text numeric labels gain the larger limit; quotes/CSS are never accepted.
  const expression = /([\w$]+)\.badge\.length\s*>\s*([\w$]+)(?=\s*\)\s*throw new Error\("The 'badge'-property must be undefined or a short character"\))/g
  let matches = 0
  const result = source.replace(expression, (comparison, owner: string) => {
    matches++
    return `${comparison}&&!${nativeBadgePattern}.test(${owner}.badge)`
  })
  if (matches !== 1) { throw new Error(`Unsupported badge validation layout (${matches} matches). No program files were modified.`) }
  return `${result}\n/* ${marker} */\n`
}

export function patchWorkbench(source: string): string {
  if (hasPatch(source)) { throw new Error('The workbench already contains an Assets Size patch.') }
  const expression = /([\w$]+)\(`\.\$\{this\.itemBadgeClassName\}::after`,(`content: "\$\{([^}]+)\}"; color: \$\{[^}]+\};`),([\w$]+)\)/g
  let matches = 0
  const result = source.replace(expression, (_match, emit: string, content: string, value: string, sheet: string) => {
    if (!/^[\w$]+(?:\.join\(", "\))?$/.test(value)) {
      throw new Error('Unsupported decoration renderer layout. No program files were modified.')
    }
    matches++
    const selector = '`' + '.${this.itemBadgeClassName}::after`'
    const ordinary = `${emit}(${selector},${content},${sheet})`
    const fallback = content.replace(`\${${value}}`, '${__assetSizeData.other}')
    const outside = `${emit}(${selector},${fallback},${sheet})`
    // Two distinct pseudo-elements keep counts neutral and severity colors on
    // the trailing size alone. No filename or Git decoration colors are changed.
    const sizeSelector = '`' + '.monaco-workbench .explorer-folders-view .monaco-list-row .monaco-icon-label.${this.itemBadgeClassName}::after`'
    const sizeContent = `\`content: "\${__assetSizeData.size}"; color: \${__assetSizeData.color} !important;${badgeStyle}\``
    const countSelector = '`' + '.explorer-folders-view .${this.itemBadgeClassName} > .monaco-icon-label-container::after`'
    const countContent = `\`content: "\${__assetSizeData.count}";${countStyle}\``
    return `(()=>{const __assetSizeData=__assetSizeNativeBadgeV3(${value});if(!__assetSizeData){${ordinary};return;}${outside};${emit}(${sizeSelector},${sizeContent},${sheet});if(__assetSizeData.count){${emit}(${countSelector},${countContent},${sheet});}})()`
  })
  if (matches !== 2) { throw new Error(`Unsupported decoration renderer layout (${matches} matches). No program files were modified.`) }
  return `${result}\n/* ${marker} */\n${rendererHelper}`
}

function sha256(content: string): string { return createHash('sha256').update(content).digest('hex') }

async function readManifest(appRoot: string): Promise<Manifest | undefined> {
  let value: unknown
  try { value = JSON.parse(await readFile(path.join(appRoot, backupName, 'manifest.json'), 'utf8')) }
  catch (error) { if (isMissing(error)) { return undefined } throw error }
  const manifest = value as Manifest
  if (!manifest || manifest.schema !== 1 || typeof manifest.version !== 'string'
    || typeof manifest.appliedAt !== 'number' || (manifest.revision !== undefined && !Number.isInteger(manifest.revision))
    || !Array.isArray(manifest.files) || manifest.files.length !== targets.length
    || !manifest.files.every((file, index) => file.path === targets[index] && file.backup === `${index}.original`
      && /^[a-f0-9]{64}$/.test(file.originalHash) && /^[a-f0-9]{64}$/.test(file.patchedHash) && Number.isInteger(file.mode))) {
    throw new Error('Invalid Assets Size backup manifest. Keep the backups and check the application directory.')
  }
  return manifest
}

export async function getNativePatchStatus(appRoot: string): Promise<NativePatchStatus> {
  const backupDirectory = path.join(appRoot, backupName)
  const manifest = await readManifest(appRoot)
  if (!manifest) { return { installed: false, needsUpgrade: false, appliedAt: 0, reason: 'The native Explorer patch is not installed.', backupDirectory } }
  const states = await Promise.all(manifest.files.map(async file => sha256(await readFile(path.join(appRoot, file.path), 'utf8'))))
  const patched = states.every((hash, index) => hash === manifest.files[index]!.patchedHash)
  const installed = patched && manifest.revision === patchRevision
  const needsUpgrade = patched && !installed
  const original = states.every((hash, index) => hash === manifest.files[index]!.originalHash)
  return { installed, needsUpgrade, appliedAt: manifest.appliedAt, backupDirectory, reason: installed
    ? 'The native Explorer patch is installed.'
    : needsUpgrade
      ? 'The native Explorer patch needs an update.'
      : original ? 'The original VS Code files have been restored.' : 'VS Code program files have changed. Check or reapply the patch.' }
}

export async function installNativePatch(appRoot: string): Promise<PatchResult> {
  const backupDirectory = path.join(appRoot, backupName)
  const version = String((JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')) as { version: string }).version)
  const existing = await readManifest(appRoot)
  if (existing && (await getNativePatchStatus(appRoot)).installed) { return { changed: false, backupDirectory } }
  const current = await Promise.all(targets.map(target => readFile(path.join(appRoot, target), 'utf8')))
  let originals = current
  if (existing && current.every((content, index) => sha256(content) === existing.files[index]!.patchedHash)) {
    // Upgrade a verified older patch from the same preserved originals.
    originals = await Promise.all(existing.files.map(async (file) => {
      const original = await readFile(path.join(backupDirectory, file.backup), 'utf8')
      if (sha256(original) !== file.originalHash) { throw new Error(`Backup checksum mismatch: ${file.backup}. No program files were modified.`) }
      return original
    }))
  }
  if (originals.some(hasPatch)) {
    throw new Error('An incomplete or modified Assets Size patch was detected. Run Restore Native Explorer Patch first and keep the backups.')
  }
  // Build and validate the entire plan before touching any application file.
  const patched = [patchExtensionHost(originals[0]!), patchWorkbench(originals[1]!), `${originals[2]}${css}`]
  const modes = await Promise.all(targets.map(async target => (await stat(path.join(appRoot, target))).mode & 0o777))
  const manifest: Manifest = { schema: 1, revision: patchRevision, version, appliedAt: Date.now(), files: targets.map((target, index) => ({
    path: target,
    backup: `${index}.original`,
    originalHash: sha256(originals[index]!),
    patchedHash: sha256(patched[index]!),
    mode: modes[index]!,
  })) }
  const sameOriginals = existing?.files.every((file, index) => file.originalHash === manifest.files[index]!.originalHash)
  if (existing) {
    if (!sameOriginals) {
      // An editor update replaced the clean files. Preserve the old backups in an
      // archive and back up this version independently instead of overwriting them.
      await rename(backupDirectory, `${backupDirectory}.${existing.version.replace(/[^\w.-]/g, '_')}.${Date.now()}`)
    }
  }
  await mkdir(backupDirectory, { recursive: true })
  for (let index = 0; index < targets.length; index++) {
    const backup = path.join(backupDirectory, `${index}.original`)
    try { await writeFile(backup, originals[index]!, { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if (!isCode(error, 'EEXIST') || sha256(await readFile(backup, 'utf8')) !== manifest.files[index]!.originalHash) { throw error }
    }
  }
  await writeFile(path.join(backupDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  const written: number[] = []
  try {
    for (let index = 0; index < targets.length; index++) {
      await atomicWrite(path.join(appRoot, targets[index]!), patched[index]!, modes[index]!)
      written.push(index)
    }
  }
  catch (error) {
    const rollback = await Promise.allSettled(written.map(index => atomicWrite(path.join(appRoot, targets[index]!), current[index]!, modes[index]!)))
    if (rollback.some(result => result.status === 'rejected')) {
      throw new Error(`Patch installation was interrupted. Some files need restoration. Original backups are in ${backupDirectory}.`, { cause: error })
    }
    if (existing && sameOriginals) {
      await atomicWrite(path.join(backupDirectory, 'manifest.json'), JSON.stringify(existing, null, 2), 0o600)
    }
    throw new Error('Patch installation failed. The program file changes have been rolled back.', { cause: error })
  }
  return { changed: true, backupDirectory }
}

export async function restoreNativePatch(appRoot: string): Promise<PatchResult> {
  const backupDirectory = path.join(appRoot, backupName)
  const manifest = await readManifest(appRoot)
  if (!manifest) { return { changed: false, backupDirectory } }
  const originals = await Promise.all(manifest.files.map(async (file) => {
    const original = await readFile(path.join(backupDirectory, file.backup), 'utf8')
    if (sha256(original) !== file.originalHash) { throw new Error(`Backup checksum mismatch: ${file.backup}. No program files were modified.`) }
    const current = sha256(await readFile(path.join(appRoot, file.path), 'utf8'))
    if (current !== file.patchedHash && current !== file.originalHash) {
      throw new Error(`Program file changed: ${file.path}. No files were restored to avoid overwriting a newer version.`)
    }
    return { original, changed: current !== file.originalHash }
  }))
  for (let index = 0; index < manifest.files.length; index++) {
    if (!originals[index]!.changed) { continue }
    const file = manifest.files[index]!
    await atomicWrite(path.join(appRoot, file.path), originals[index]!.original, file.mode)
  }
  return { changed: originals.some(item => item.changed), backupDirectory }
}

async function atomicWrite(target: string, content: string, mode: number): Promise<void> {
  const temporary = `${target}.asset-size-${randomBytes(6).toString('hex')}.tmp`
  try { await writeFile(temporary, content, { flag: 'wx', mode }); await rename(temporary, target) }
  finally {
    try { await unlink(temporary) }
    catch (error) { if (!isMissing(error)) { console.error('[Assets Size] Failed to remove a temporary patch file.', error) } }
  }
}

function isCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code
}
function isMissing(error: unknown): boolean { return isCode(error, 'ENOENT') }
