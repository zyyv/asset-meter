# Changelog

## Unreleased

- Add a compression plugin registry and an API for other extensions to register compressors.
- Add TinyPNG cloud compression with a User Settings API key, cancellation and actionable errors.
- Choose plugins before compression or switch and recompress in the comparison view.
- Disable saving until both comparison images decode successfully, rejecting undecodable compression results.

## 0.3.0

- Show right-aligned counts and sizes on the hovered Explorer row in hover mode; hide them again on mouse leave.
- Introduce the Assets Size name, a new extension icon, and English / Simplified Chinese documentation.
- Add Marketplace metadata, version-aware VSIX packaging, and a release checklist.
- Open extension settings using the installed extension ID so publisher changes work correctly.
- Use TypeScript 6 for typechecking and ESLint compatibility.
- Include the bundled glob matcher's license alongside the codec notices.
- Add a Compress Image button to JPEG, PNG and WebP previews, using locally bundled Squoosh-derived jSquash codecs.
- Compare original and compressed images side by side, at 100%, or with a slider before saving.
- Support Save As / Overwrite Original with Allow Once / Always Allow and a resettable User setting.
- Reject animations, oversized inputs and stale originals; refresh Explorer sizes after saving.

## 0.2.2

- Fix leaked severity digits producing labels such as `00 files · 0 B`.
- Use invisible severity markers and parse metadata separately from file counts.
- Decode the previous numeric marker format during native patch upgrades.

## 0.2.1

- Use English labels, tooltips, commands, settings and notifications.
- Show folder file counts before the trailing size, such as `24 files · 1.2 MB`.
- Apply severity colors only to the size text; keep filenames and counts unchanged.
- Upgrade previous native patches while retaining the original backups.

## 0.2.0

- Remove the extra Asset Size panel and compact size buckets.
- Add a reversible native Explorer patch for full sizes and file counts.
- Add configurable yellow, orange and red size thresholds.
- Scope inline labels to Explorer and preserve recovery backups.

## 0.1.0

- Add native size badges and hover details.
- Add an Explorer companion tree with full sizes.
- Add recursive totals, configurable resource rules and automatic refresh.
