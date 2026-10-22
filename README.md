# Asset Size

Show folder file counts and complete file sizes directly in the native Explorer tree.

```text
▾ assets                         3 files · 7.9 MB
  ▾ images                       2 files · 7.9 MB
      hero.png                              6.3 MB
      texture.jpg                           1.6 MB
    logo.svg                                 39 B
```

Only the trailing size text uses severity colors. Filenames retain their theme and Git colors; file counts remain neutral. There is no additional panel.

## Install or update

1. Install `artifacts/asset-size-0.3.0.vsix` using **Extensions → ⋯ → Install from VSIX**.
2. Run **Asset Size: Install / Reapply Native Explorer Patch**.
3. Choose **Reload Window**.

**Upgrading from 0.2.0 or 0.2.1 requires updating the native patch.** The command upgrades the verified old patch from the existing original backups. You do not need to restore or remove the old patch first.

Empty folders display `0 files · 0 B`. Internal severity markers are invisible and are decoded separately from the displayed count, including when handling the previous badge format.

The native patch is needed because the standard VS Code API limits file badges to two characters. It modifies three desktop program files and triggers VS Code's integrity warning. Integrity checks and code signatures are not disabled or modified. Reapply the patch after editor updates. Unsupported code layouts are rejected before program files are changed.

Without the current patch, details remain available in hover tooltips. Full inline labels require a local desktop extension host with access to the desktop program files.

## Restore

Run **Asset Size: Restore Native Explorer Patch** before uninstalling, then reload the window. Original files and their SHA-256 manifest are retained in `resources/app/.asset-size-native-patch`.

Restoration checks every program file and backup before writing. It refuses to overwrite files changed by an editor update or another tool. Installation failures roll back written files; upgrading a previous patch also preserves its previous manifest if installation fails.

The source project provides a CLI after `pnpm build`:

```sh
node scripts/native-patch.mjs status "/Applications/Visual Studio Code.app/Contents/Resources/app"
node scripts/native-patch.mjs restore "/Applications/Visual Studio Code.app/Contents/Resources/app"
```

## Size colors

| Size text | File threshold | Folder threshold |
| --- | --- | --- |
| Neutral | Below 256 KiB | Below 10 MiB |
| Yellow | At least 256 KiB | At least 10 MiB |
| Orange | At least 1 MiB | At least 50 MiB |
| Red | At least 5 MiB | At least 100 MiB |

Thresholds use MiB (1024 squared bytes), independently of the display units. Three configured values are sorted in ascending order.

```json
{
  "assetSize.colorize": true,
  "assetSize.fileColorThresholdsMiB": [0.25, 1, 5],
  "assetSize.folderColorThresholdsMiB": [10, 50, 100],
  "workbench.colorCustomizations": {
    "assetSize.sizeWarning": "#D7BA7D",
    "assetSize.sizeLarge": "#F0883E",
    "assetSize.sizeCritical": "#F85149"
  }
}
```

Setting `colorize` to `false` makes the size neutral as well. This extension never sets filename decoration colors.

## Display rules

Search for **Asset Size** in Settings or edit your workspace configuration:

```json
{
  "assetSize.enabled": true,
  "assetSize.displayMode": "always",
  "assetSize.fileExtensions": [".jpg", ".jpeg", ".png", ".svg", ".webp", ".woff2"],
  "assetSize.folderNames": ["assets", "public", "static", "images", "fonts"],
  "assetSize.exclude": ["**/.git/**", "**/node_modules/**", "**/.DS_Store"],
  "assetSize.showFileCount": true,
  "assetSize.fileCountMode": "recursive",
  "assetSize.units": "decimal",
  "assetSize.decimalPlaces": 1,
  "assetSize.refreshDelay": 400
}
```

| Setting | Behavior |
| --- | --- |
| `displayMode` | `always` displays counts before sizes with the native patch; `hover` shows details only in the tooltip. |
| `fileExtensions` / `folderNames` | Case-insensitive matches at any depth. Use `*` for all or an empty array to disable that resource type. |
| `exclude` | Workspace-relative glob exclusions for both decorations and totals. Supports `**`, `*` and braces. |
| `showFileCount` / `fileCountMode` | Hide counts, count all descendants (`recursive`), or count immediate child files (`direct`). |
| `units` / `decimalPlaces` | Default KB / MB (base 1000); `binary` uses KiB / MiB (base 1024). Supports 0–3 decimal places. |
| `refreshDelay` | Batch filesystem updates over 100–5000 milliseconds; default 400. |

Default extensions cover images, video, audio, fonts, PDF and ZIP. Default folder names are `assets public static images img media fonts`. Leading dots are optional for extensions; compound extensions such as `.tar.gz` are supported. A matching folder does not automatically decorate its subfolders; configure `folderNames: ["*"]` to include all folders.

Default exclusions cover `.git`, `node_modules`, `.svn`, `.hg` and `.DS_Store` at any depth. Configured arrays replace the defaults. Rules are independent of `files.exclude` and `.gitignore`.

## Totals and refresh

Folder sizes always include every non-excluded descendant file, regardless of which extensions are decorated. Sizes reflect saved file bytes, not allocated disk blocks. Symbolic links are skipped. Unreadable items produce partial totals marked with `≥` and an explanation in the tooltip.

Calculations are requested on demand, with up to 10,000 cached results and 16 concurrent filesystem operations. Workspace-scoped watchers refresh changed files and their ancestors after saves, creation, deletion and renames. Run **Asset Size: Refresh Sizes** if a filesystem provider misses an external change.

Enable `explorer.decorations.badges` for inline labels. Complete labels appear only in Explorer; unrelated decoration badges retain their ordinary rendering elsewhere.

## Image compression

Open a **JPEG, PNG or WebP** image in the built-in image preview and click **Compress Image** (the inward-folding arrows) at the top right of the editor. The command is also available in the Explorer context menu and Command Palette.

Compression uses the Squoosh-derived [jSquash codecs](https://github.com/jamsinclair/jSquash), bundled locally with the extension. JPEG uses MozJPEG, PNG uses lossless Oxipng, and WebP uses libwebp. A cancellable background worker keeps the editor responsive; images are never uploaded.

1. Click the compression icon to open an image diff with original/compressed sizes and the percentage saved.
2. Inspect the side-by-side images at Fit or 100%, or use the comparison slider.
3. Click **Save Result…** and choose **Save As** or **Overwrite Original**, with **Allow Once** or **Always Allow**. Discard closes the result without writing an image.

**Always Allow** remembers the save action in User Settings. Every compression still opens a comparison and requires clicking **Save Result…**. Save As defaults to `name.compressed.ext`; it asks before replacing an existing destination. Overwrite refuses if the original has changed since compression or has unsaved edits. Saving refreshes Explorer sizes immediately.

```json
{
  "assetSize.compression.quality": 75,
  "assetSize.compression.saveBehavior": "ask"
}
```

`quality` ranges from 1–100 for JPEG/WebP. PNG optimization is lossless. `saveBehavior` accepts `ask`, `saveAs`, or `overwrite`; reset it to `ask` to revoke Always Allow. Save permission can only be configured in User Settings.

Compression preserves the format and dimensions (applying JPEG orientation). JPEG/WebP re-encoding removes metadata and may lose quality; compare before saving. Animated PNG/WebP are rejected so frames are never silently discarded. Images are limited to 50 MiB and 40 million pixels, with a 120-second compression timeout. Results that do not reduce size can be compared but cannot replace the smaller original.

## Development

```sh
pnpm install
pnpm check
pnpm lint
pnpm build
pnpm package
```

Press **F5** to launch the demo. The extension uses VS Code 1.90 API types; the native patch checks the current desktop code layout for compatibility.

Optional test commands are available for manual development use:

```sh
pnpm test
VSCODE_EXECUTABLE_PATH="/path/to/test/Code" pnpm test:integration
VSCODE_EXECUTABLE_PATH="/path/to/patched/test/Code" pnpm test:ui
VSCODE_EXECUTABLE_PATH="/path/to/test/Code" pnpm test:compression:ui
```

Use disposable test installations for native patch UI checks. All UI/integration checks use temporary workspace, profile and extension directories. Without an executable path, integration tests download VS Code 1.90.2. UI screenshots are saved to `artifacts/native-explorer-preview.png` and `artifacts/image-compression-preview.png`. Compression checks exercise all three codecs, pixel-perfect PNG/alpha, Save As, cancellation, stale source protection, and remembered overwrite permission.

No file uploads, telemetry or external network requests are made at runtime.
