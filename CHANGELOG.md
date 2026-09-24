# Changelog

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
