# Changelog

## 0.3.0

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
