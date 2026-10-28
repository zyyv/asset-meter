# Changelog

## Unreleased

- Offer JPEG, PNG and WebP output formats with per-run JPEG/WebP quality, lossless PNG conversion and a white background when converting transparent images to JPEG.

- Add multi-select compression and local WebP conversion in the Asset Meter panel and Explorer, with a shared bounded worker task pool, configurable batches, cancellable notification progress and per-image logs.
- Save batch results as new copies with collision-safe filenames, preserving originals and continuing after individual failures.

- Replace double-click copying with a separate Asset Meter context menu group for copying relative paths, absolute paths and supported images, and remove the copy behavior setting.
- Show compact badges or an information indicator in always mode without the native patch, with exact sizes and patch instructions in tooltips.
- Add an Asset Meter Output log, Show Logs and Diagnose File Matching commands, per-resource Debug logs, and visible filesystem/decoration errors.

## 0.0.1

- Initial release of Asset Meter (`zyyv.asset-meter`).
- Show file sizes, folder totals and recursive or direct file counts in Explorer, with configurable glob rules, units and severity colors.
- Display full inline labels always or on row hover through an optional reversible native Explorer patch.
- Compress JPEG, PNG and WebP with local jSquash codecs or TinyPNG, compare results before saving, and choose Save As or Overwrite Original.
- Provide a compression plugin API for other extensions, with plugin selection and recompression in the comparison view.
