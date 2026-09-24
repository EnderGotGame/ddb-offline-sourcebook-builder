# Changelog

## 0.9.0 - 2026-09-24

### Added

- A clearly labeled **Reference Index** section separate from the ordinary book Contents.
- Adaptive reference-index columns based on total discovered reference entries:
  - 1 column for 0–30 entries;
  - 2 columns for 31–180 entries;
  - 3 columns for 181+ entries.
- Generic print styling for read-aloud/boxed text, sidebars, notes, callouts, rules boxes, and quote boxes when D&D Beyond exposes recognizable structural classes.
- Generic preservation of card/grid/flow containers.
- Flowchart reconstruction for sections explicitly labeled as flowcharts when their source markup is ordinary repeated lower-level heading/text groups.
- Same-named generated reference groups are merged while preserving entry order.

### Fixed

- Artist credits and their associated artwork are kept together again when a conservative name-like credit pattern is detected.
- Credited artwork uses a smaller print-height cap to reduce sparse pages while avoiding artwork being visually associated with the following entry.
- Artist-credit detection is more conservative so short adventure prose/headings are less likely to be treated as credits.

### Changed

- v0.9 is a presentation-only refinement. The v0.5 document-level duplicate-prevention model, v0.6 stat/table reconstruction, v0.7 entry spacing, and v0.8 mixed source-root discovery architecture remain intact.
- Large generated indexes no longer choose columns independently per group; the entire reference-index size determines column density.

## 0.8.0 - 2026-09-23

### Fixed

- Adventure/source discovery accepts both modern `/sources/dnd/<slug>` and legacy `/sources/<slug>/...` paths for the same book.
- Adventure books no longer fail with `No sourcebook pages found` solely because their chapter URLs use the legacy route.

### Changed

- Large generated indexes with 80+ entries use a two-column print layout.
- Indexed-entry keep-together behavior protects only one compact opening line.
- Artwork/credit grouping was relaxed and maximum print image height reduced.
- Reference-document spacing was tightened while preserving visual separation.
- Generic `Creatures`, `NPCs`, and `Sidekicks` headings can participate in reference discovery.

## 0.7.0 - 2026-09-23

### Added

- Generic indexed-entry boundary detection based on document structure and fragment targets rather than book names.
- Additional spacing and a subtle separator before discrete indexed entries.
- Generic opening-content grouping hints.
- Short-table detection for compact tables with up to 12 rows.
- Page-break protection for short tables and nearby table headings.
- More consistent heading hierarchy spacing.
- Additional separation between independently captured reference documents.

### Changed

- Print polish remains structure-driven and feature-driven.
- Long tables remain splittable while compact tables are preferentially kept intact.

## 0.6.0 - 2026-09-23

### Added

- Print-focused semantic table reconstruction.
- Ability-score reconstruction that merges split STR/DEX/CON and INT/WIS/CHA layouts into one six-ability table when all six abilities parse safely.
- Dedicated print styling for stat-block attribute/detail rows.
- Visually distinct stat-block section headings.
- Consistent print styling for ordinary sourcebook tables.
- Special styling for roll/random tables.

### Changed

- Original split ability tables are hidden only after complete reconstruction succeeds.
- Large stat blocks continue to span pages naturally.

## 0.5.0 - 2026-09-23

### Fixed

- Eliminated duplicate indexed entries caused by appending every logical fragment separately.
- Indexed/reference links resolve to unique underlying source documents; each source document is included once.
- Parent/group entries no longer cause child stat blocks to be appended again.
- Internal fragment links are namespaced per captured source document.
- Reworked pagination to neutralize D&D Beyond inherited page-break rules.
- Replaced the flex-based cover with a print-safe block layout.
- Improved title cleanup.
- Added artwork/artist-credit grouping.
- Added maximum printable image heights.
- Capture Report is hidden from printed/PDF output by default.

### Changed

- Large indexes are treated primarily as navigation maps rather than instructions to append hundreds of independently extracted snippets.
- Capture Report reports unique indexed source documents.
- Appendices and credits are placed after indexed source documents when appropriate.

## 0.4.0 - 2026-09-23

Initial public project version.

### Added

- Universal sourcebook landing-page discovery.
- Primary chapter/source-page extraction.
- Index/reference section discovery.
- Fragment-aware logical entry handling.
- Shared underlying-document cache.
- Offline internal-link rewriting.
- Duplicate prevention for indexed entries already contained in captured source pages.
- Print-first US Letter pagination.
- Retry/backoff handling.
- Capture Report.
- Cancel control and progress reporting.
- Image/lazy-load normalization and asset wait before printing.
