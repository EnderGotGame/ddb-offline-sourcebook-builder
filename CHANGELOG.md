# Changelog

## 0.8.0 - 2026-09-23

### Fixed

- Adventure/source discovery now accepts both modern `/sources/dnd/<slug>` and legacy `/sources/<slug>/...` paths for the same book.
- Adventure books such as Shadow of the Dragon Queen no longer fail with `No sourcebook pages found` solely because their chapter URLs use the legacy route.

### Changed

- Large generated indexes with 80+ entries use a two-column print layout.
- Indexed-entry keep-together behavior now protects only one compact opening line.
- Artwork/credit grouping is less aggressive and image height is slightly reduced to cut sparse pages.
- Reference-document spacing is slightly tighter while preserving visual separation.
- Generic `Creatures`, `NPCs`, and `Sidekicks` headings are recognized as possible reference collections.

## 0.7.0 - 2026-09-23

### Added

- Generic indexed-entry boundary detection based on document structure and fragment targets rather than book names or content types.
- Additional spacing and a subtle separator before discrete indexed entries so adjacent monsters, spells, items, NPCs, locations, and other reference entries do not visually run together.
- Generic opening-content grouping hints so a discrete entry heading stays visually attached to the first short metadata/subtitle lines when practical.
- Short-table detection for compact tables with up to 12 rows.
- Page-break protection for short tables and nearby table headings so small d6/d8/d10/d12 lookup tables are less likely to split awkwardly across pages.
- More consistent heading hierarchy spacing for h1-h6 content throughout captured sourcebooks and adventures.
- Additional spacing/separation between independently captured reference documents.

### Changed

- Print polish remains structure-driven and feature-driven. v0.7 contains no Monster Manual-specific, adventure-specific, or sourcebook-name checks.
- Indexed-entry styling now applies to any discrete reference target exposed by a D&D Beyond book, including monsters, spells, magic items, feats, backgrounds, species, NPCs, locations, encounters, rules entries, and similar content.
- Long tables remain splittable while compact tables are preferentially kept intact.
- Existing v0.5 document-level duplicate prevention and v0.6 stat-block/table reconstruction remain unchanged.

## 0.6.0 - 2026-09-23

### Added

- Print-focused semantic table reconstruction for D&D Beyond monster stat blocks.
- Ability-score reconstruction that merges split STR/DEX/CON and INT/WIS/CHA source tables into one compact six-ability table with Score, Mod, and Save rows when all six abilities can be parsed safely.
- Dedicated print styling for D&D Beyond stat-block attribute rows and detail rows.
- Visually distinct stat-block section headings for Traits, Actions, Bonus Actions, Reactions, Legendary Actions, and similar sections when D&D Beyond exposes the expected heading classes.
- Consistent print styling for ordinary sourcebook tables, including borders, header shading, row striping, and repeated table headers across printed pages where supported by the browser.
- Special styling for roll/random tables so die-result columns remain compact and readable.

### Changed

- Stat-block tables are now treated as semantic reference data instead of relying on D&D Beyond's screen-oriented table layout to survive browser printing.
- Original split ability tables are hidden only when a complete six-ability replacement table is successfully reconstructed.
- Large stat blocks continue to span pages naturally while compact ability tables and individual rows are kept together when practical.

## 0.5.0 - 2026-09-23

### Fixed

- Eliminated duplicate Monster Manual entries caused by appending every indexed monster separately.
- Indexed/reference links now resolve to a unique underlying source document; each source document is included only once.
- Parent/group entries such as Aarakocra, dragons, vampires, and similar grouped monster pages no longer cause child stat blocks to be appended again.
- Internal fragment links are namespaced per captured source document to reduce anchor collisions after many D&D Beyond pages are combined.
- Reworked print pagination to neutralize D&D Beyond's inherited page-break rules before applying this project's own print rules.
- Removed the large flex-based cover layout that could split the title, cover art, and source text across multiple sheets.
- Improved book-title cleanup so generated covers use the actual sourcebook title instead of the full browser tab title.
- Added artwork/artist-credit grouping so short artist credits are less likely to be stranded on otherwise blank pages.
- Added maximum printable image heights to reduce image-driven blank pages.
- Capture Report is now visible in the preview but hidden from physical/PDF printing by default.

### Changed

- Large indexes are now treated primarily as navigation maps rather than instructions to append hundreds of independently extracted snippets.
- Capture Report now reports the number of unique indexed source documents appended instead of the number of individual indexed entries appended.
- Appendices and credits are moved after indexed source documents when a book has a large reference index, producing a more natural bestiary/book order.

## 0.4.0 - 2026-09-23

Initial public project version.

### Added

- Universal sourcebook landing-page discovery.
- Primary chapter/source-page extraction.
- Index/reference section discovery.
- Fragment-aware logical entry handling.
- Shared underlying-document cache for large indexes.
- Extraction strategies for fragments, stat blocks, entity pages, heading ranges, and article fallbacks.
- Offline internal-link rewriting.
- Duplicate prevention for indexed entries already contained in captured source pages.
- Print-first US Letter pagination.
- Retry/backoff handling for transient HTTP failures.
- Capture Report with counts and warnings.
- Cancel control and progress reporting.
- Image/lazy-load normalization and asset wait before printing.
