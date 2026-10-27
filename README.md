<p align="center">
  <img src="images/icon.png" width="96" height="96" alt="Asset Meter logo">
</p>

<h1 align="center">Asset Meter</h1>

<p align="center">Know what your assets weigh. Make your images lighter.</p>

<p align="center">
  <a href="https://github.com/zyyv/asset-meter">GitHub</a> ·
  <a href="https://github.com/zyyv/asset-meter/issues">Report an issue</a> ·
  <a href="https://github.com/zyyv/asset-meter/blob/main/README.zh-CN.md">简体中文</a>
</p>

See file sizes and folder counts where you already work: VS Code's Explorer. Find heavy assets, then compress JPEG, PNG and WebP images with jSquash or TinyPNG and compare before saving.

**VS Code 1.90+ · Desktop extension · Pluggable compression · MIT**

## At a glance

- **Sizes in Explorer.** Full file sizes and folder totals, with optional recursive or direct file counts.
- **Useful color cues.** Configurable warning, large and critical thresholds on size text; filenames keep their theme and Git colors.
- **Preview before saving.** Compare compressed images side by side or with a slider, at Fit or 100% zoom.
- **Your rules.** Choose include / exclude glob patterns, units and decimal precision. Saved changes refresh sizes automatically.
- **Choose your compressor.** Local jSquash codecs by default, or optional TinyPNG cloud compression with your API key. No telemetry.

```text
▾ assets                         3 files · 7.9 MB
  ▾ images                       2 files · 7.9 MB
      hero.png                              6.3 MB
      texture.jpg                           1.6 MB
    logo.svg                                 39 B
```

> **Inline labels require an optional native Explorer patch.** VS Code's standard decoration API limits badges to two characters. The patch modifies three desktop program files, triggers VS Code's integrity warning and must be reapplied after editor updates. Hover tooltips and image compression work without it. Read [Native Explorer patch](#native-explorer-patch) before enabling inline labels.

## Quick start

1. Install the `.vsix` from this project's [GitHub Releases](https://github.com/zyyv/asset-meter/releases), when available, using **Extensions → ⋯ → Install from VSIX…**. To build from source, see [Development](#development).
2. Open a workspace containing an `assets`, `public`, `static`, `images`, `img`, `media` or `fonts` folder. Hover over matching files and folders to see their sizes.
3. For full inline labels, run **Asset Meter: Install / Reapply Native Explorer Patch** from the Command Palette, then choose **Reload Window**.

Run **Asset Meter: Open Settings** to customize matching rules. An empty folder displays `0 files · 0 B`. Set `assetMeter.include` to `["**/*"]` to decorate every file and folder.

## Compress images

Open a **JPEG, PNG or WebP** image in VS Code's built-in image preview and click **Compress Image** in the editor toolbar. You can also right-click an image in Explorer or run **Asset Meter: Compress Image**.

1. Choose a compression plugin from the picker: **jSquash** runs locally; **TinyPNG** uploads the image to its API. In the comparison, use the **Plugin** dropdown and **Compress Again** to try another plugin.
2. Inspect the original and compressed sizes, savings, and image comparison. Switch between side by side and slider views, or inspect at 100% zoom.
3. Click **Save Result…**, then choose **Save As** or **Overwrite Original**, with **Allow Once** or **Always Allow**.
4. Choose **Discard** to close without saving. A successful save refreshes Explorer sizes.

**Save As** suggests `name.compressed.ext` and confirms before replacing an existing destination. **Overwrite Original** refuses to replace a source that changed after compression or has unsaved edits. **Always Allow** remembers the save action in User Settings; every compression still waits for **Save Result…**. Reset `assetMeter.compression.saveBehavior` to `"ask"` to revoke that permission.

| Format | jSquash codec | Behavior |
| --- | --- | --- |
| JPEG (`.jpg`, `.jpeg`, `.jpe`) | MozJPEG | Lossy; configurable quality |
| PNG | Oxipng | Lossless; quality setting does not apply |
| WebP | libwebp | Lossy; configurable quality |

Compression preserves the format and dimensions, applying JPEG orientation to the pixels. Metadata preservation is not guaranteed. Animated PNG/WebP, inputs larger than 50 MiB and images above 40 million pixels are rejected. If the result is not smaller, saving is disabled. jSquash runs in a cancellable worker using locally bundled [codecs](https://github.com/jamsinclair/jSquash). TinyPNG supports the same three formats and chooses compression quality automatically.

To use TinyPNG, [get an API key](https://tinypng.com/developers), then set `assetMeter.compression.tinypng.apiKey` in **User Settings**. The key is stored as plain text, excluded from Settings Sync, and never sent to the comparison webview. Each compression uploads the original image and uses your TinyPNG API quota; switching the dropdown alone does not send a request. Set `assetMeter.compression.plugin` to `"tinypng"` to show it first in the picker. Requests follow the [TinyPNG HTTP API](https://tinypng.com/developers/reference).

Failed API calls show an error and leave the original unchanged. A failed **Compress Again** keeps the previous successful result and restores the controls. Retry manually or choose another plugin; requests are not automatically retried. Saving stays disabled until both comparison images decode successfully, so undecodable output cannot be saved through the comparison.

Other extensions can register compressors through `await vscode.extensions.getExtension('zyyv.asset-meter').activate()`, then call `api.registerCompressionPlugin(plugin)` and add the returned disposable to their subscriptions. Plugins implement `CompressionPlugin` in `src/compression/plugins.ts`: an ID, label, description, supported formats, `describe(input)`, and `compress(input, context)` returning `{ result: Promise<Uint8Array>, cancel() }`. The picker and comparison dropdown discover registered plugins automatically. Plugins own their settings and encoding; the shared flow validates inputs and outputs, displays the comparison, and handles saving.

## Configuration

Open **Settings → Extensions → Asset Meter**, or add this example to `.vscode/settings.json`:

```json
{
  "assetMeter.displayMode": "always",
  "assetMeter.include": ["**/*.{jpg,jpeg,png,svg,webp,woff2}", "**/{assets,public,images,fonts}"],
  "assetMeter.exclude": ["**/.git/**", "**/node_modules/**", "**/.DS_Store"],
  "assetMeter.showFileCount": true,
  "assetMeter.fileCountMode": "recursive",
  "assetMeter.units": "decimal",
  "assetMeter.compression.plugin": "jsquash",
  "assetMeter.compression.quality": 75
}
```

Configured arrays **replace** the defaults. Matching uses [picomatch](https://github.com/micromatch/picomatch), relative to each workspace folder, with case-insensitive matching and dotfiles enabled. Matching paths does not read the filesystem. Exclusions are independent of `.gitignore` and `files.exclude`.

`assetMeter.include` uses glob patterns such as `["**/*.{png,tar.gz}"]` for file formats and `["**/{assets,images}"]` for folder names. A directory pattern selects that directory itself; add `/**` to select its descendants as well. For example, `assets/**` selects `assets` and everything inside it.

| Setting | Default | Description |
| --- | --- | --- |
| `assetMeter.enabled` | `true` | Enable size calculations and decorations. |
| `assetMeter.displayMode` | `"always"` | Keep labels visible; `"hover"` shows counts and sizes on the right only while hovering that Explorer row. Both require the patch; tooltips work without it. |
| `assetMeter.include` | Common asset formats and folders | Workspace-relative glob patterns for files and folders; supports `**`, `*`, braces, extglobs and negated patterns. `"**/*"` matches all resources; `[]` hides decorations. Does not limit folder totals. |
| `assetMeter.exclude` | VCS, dependencies, `.DS_Store` | Workspace-relative glob patterns. Matching resources and their descendants are excluded from decorations and totals. |
| `assetMeter.showFileCount` | `true` | Show the file count before folder size. |
| `assetMeter.fileCountMode` | `"recursive"` | Count all descendants; `"direct"` counts immediate child files. Sizes always include descendants. |
| `assetMeter.units` | `"decimal"` | Base 1000: KB / MB / GB. `"binary"` uses KiB / MiB / GiB. |
| `assetMeter.decimalPlaces` | `1` | Size precision, from 0 to 3 decimal places. |
| `assetMeter.colorize` | `true` | Color the trailing inline size by severity. |
| `assetMeter.fileColorThresholdsMiB` | `[0.25, 1, 5]` | Yellow, orange and red file thresholds. Values are sorted. |
| `assetMeter.folderColorThresholdsMiB` | `[10, 50, 100]` | Yellow, orange and red folder thresholds. Values are sorted. |
| `assetMeter.refreshDelay` | `400` | Batch filesystem events for 100–5000 milliseconds. |
| `assetMeter.compression.plugin` | `"jsquash"` | Preferred plugin shown first in the picker: `jsquash`, `tinypng`, or a registered plugin ID. |
| `assetMeter.compression.tinypng.apiKey` | `""` | TinyPNG API key in User Settings only; plain text, excluded from Settings Sync. |
| `assetMeter.compression.quality` | `75` | jSquash JPEG/WebP quality from 1 to 100. jSquash PNG is lossless; TinyPNG ignores this setting. |
| `assetMeter.compression.saveBehavior` | `"ask"` | `"ask"`, `"saveAs"` or `"overwrite"`. Only User Settings can grant remembered save permission. |

Default file pattern: `**/*.{jpg,jpeg,png,gif,webp,avif,svg,ico,bmp,heic,mp4,webm,mov,mp3,wav,ogg,woff,woff2,ttf,otf,pdf,zip}`.

Default folder pattern: `**/{assets,public,static,images,img,media,fonts}`. Matching a folder does not automatically decorate its subfolders.

Default exclusions: `**/.git/**`, `**/node_modules/**`, `**/.svn/**`, `**/.hg/**`, `**/.DS_Store`.

### Size colors

Thresholds use MiB (1,048,576 bytes), independently of display units. Defaults:

| Size text | Files | Folders |
| --- | --- | --- |
| Neutral | Below 256 KiB | Below 10 MiB |
| Yellow | At least 256 KiB | At least 10 MiB |
| Orange | At least 1 MiB | At least 50 MiB |
| Red | At least 5 MiB | At least 100 MiB |

Customize `assetMeter.sizeWarning`, `assetMeter.sizeLarge` and `assetMeter.sizeCritical` in `workbench.colorCustomizations`. Set `assetMeter.colorize` to `false` to use neutral size text.

## Commands

| Command Palette entry | Action |
| --- | --- |
| **Asset Meter: Refresh Sizes** | Recalculate sizes and folder totals. |
| **Asset Meter: Toggle Always / Hover** | Toggle always-visible labels and labels shown on row hover. |
| **Asset Meter: Open Settings** | Open this extension's settings. |
| **Asset Meter: Compress Image** | Compress an image and open its comparison. |
| **Asset Meter: Install / Reapply Native Explorer Patch** | Install, upgrade or reapply the optional patch. |
| **Asset Meter: Restore Native Explorer Patch** | Restore the original desktop program files. |

## Native Explorer patch

The patch expands the decoration badge limit for this extension and renders counts and sizes in the existing Explorer tree. Before changing three desktop program files, it creates backups and a SHA-256 manifest in `resources/app/.asset-meter-native-patch`:

```text
out/vs/workbench/api/node/extensionHostProcess.js
out/vs/workbench/workbench.desktop.main.js
out/vs/workbench/workbench.desktop.main.css
```

Run **Asset Meter: Install / Reapply Native Explorer Patch**, then reload. This requires write permission to the application directory. Integrity checks and code signatures are not disabled; VS Code may report that the installation appears corrupt. Tooltips and compression remain available without the patch.

Unsupported editor code layouts are rejected before writing. The minimum API version does not guarantee patch compatibility with every VS Code release or derivative. Reapply after editor updates.

**Before uninstalling**, run **Asset Meter: Restore Native Explorer Patch** and reload. Restoration checks program files and backups before writing, and refuses to overwrite files changed by an editor update or another tool. Original backups remain available. See [recovery commands](https://github.com/zyyv/asset-meter/blob/main/docs/PUBLISHING.md#native-patch-recovery) if the extension is already uninstalled.

## Totals and compatibility

Folder totals include **all non-excluded descendant files**, regardless of the `include` patterns selecting decorations. Sizes reflect saved file bytes, not allocated disk blocks. Symbolic links are skipped. Unreadable items produce partial totals marked with `≥` and an explanation in the tooltip.

Results are calculated on demand, sharing cached file stats and subtree totals across requests, with up to 10,000 resource entries and 16 concurrent filesystem operations. After saves, additions, deletions and renames, workspace watchers update affected branches and cached ancestors before refreshing Explorer. Unchanged child contributions are reused; evicted branches are rebuilt when needed. Run **Asset Meter: Refresh Sizes** if an external change is missed.

| Situation | What to check |
| --- | --- |
| Only tooltips appear | Reapply the patch, reload and enable `explorer.decorations.badges`. In `"hover"` mode, move the pointer over the Explorer row to reveal its label. |
| No size for an item | Check matching rules, exclusions, `assetMeter.enabled` and symbolic links. |
| Remote SSH, WSL or Dev Containers | Calculations use the workspace extension host. Inline labels require access to local desktop program files; do not assume patch support in remote sessions. |
| Virtual workspace | Totals depend on the filesystem provider's stat, enumeration and watch support. |
| Browser / vscode.dev | Not supported; this extension requires a Node.js extension host and WebAssembly workers. |

## Privacy and licensing

No telemetry is collected. jSquash processes images locally without uploads or external network requests. Choosing TinyPNG uploads the selected image to `api.tinify.com` over HTTPS using your API key. Registered plugins may use other services; check their descriptions. In remote workspaces, processing and API requests happen on the workspace extension host.

Asset Meter is [MIT licensed](https://github.com/zyyv/asset-meter/blob/main/LICENSE).

## Credits

Asset Meter uses the following projects and services:

- [picomatch](https://github.com/micromatch/picomatch) — file and folder glob matching.
- [jSquash](https://github.com/jamsinclair/jSquash), derived from [Squoosh](https://github.com/GoogleChromeLabs/squoosh) — local WebAssembly image codecs.
- [MozJPEG](https://github.com/mozilla/mozjpeg) and [libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo) — JPEG encoding and decoding.
- [libwebp](https://chromium.googlesource.com/webm/libwebp/) and [Oxipng](https://github.com/oxipng/oxipng) — WebP codecs and lossless PNG optimization.
- [TinyPNG](https://tinypng.com/developers) — optional cloud image compression.

This software is based in part on the work of the Independent JPEG Group.

Bundled dependencies retain their own licenses. The VSIX includes complete upstream license texts and notices in `dist/codecs/LICENSE*` and `dist/licenses/LICENSE*`.

## Development

Use Node.js 24+ and the pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm package
```

`pnpm test` builds the extension and runs the core, native patch and compression tests with Vitest. After a build, use `pnpm exec vitest run` to rerun tests or `pnpm exec vitest` to watch them. Use `pnpm lint --fix` to fix lint issues.

`pnpm package` typechecks and builds through the `vscode:prepublish` hook, then writes `asset-meter-<version>.vsix` in the repository root. Install it from the Extensions menu. Press **F5** to launch the example workspace in an Extension Development Host.

For desktop integration and UI checks, use a disposable VS Code installation:

```sh
VSCODE_EXECUTABLE_PATH="/path/to/test/Code" pnpm test:integration
VSCODE_EXECUTABLE_PATH="/path/to/patched/test/Code" pnpm test:ui
VSCODE_EXECUTABLE_PATH="/path/to/test/Code" pnpm test:compression:ui
```

Without an executable path, integration tests download VS Code 1.90.2. UI checks use temporary profiles and workspaces; native patch checks must target a disposable application copy.

After configuring the publishers and the `VSCE_TOKEN` and `OVSX_TOKEN` repository secrets in the [publishing guide](https://github.com/zyyv/asset-meter/blob/main/docs/PUBLISHING.md), commit your changes and run `pnpm release`. Choose a version in bumpp; it updates `package.json`, commits and pushes a `v*` tag. GitHub Actions checks and packages the extension, publishes the same VSIX to Visual Studio Marketplace and Open VSX, and creates a GitHub Release with generated notes and the VSIX attached. Maintain `CHANGELOG.md` manually when needed. Contributions and reproducible bug reports are welcome in [GitHub Issues](https://github.com/zyyv/asset-meter/issues).
