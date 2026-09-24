# DDB Offline Sourcebook Builder

A Tampermonkey userscript that builds a print-ready, offline-friendly version of a D&D Beyond sourcebook that your currently logged-in account can already access, then lets you save it as a PDF from the browser print dialog.

> **Important:** This project does not bypass authentication, ownership checks, paywalls, or DRM. It only requests pages the current D&D Beyond browser session can already open. Use it only with content you are authorized to access and in accordance with applicable terms and law.

## Current version

**v0.8.0**

v0.8 adds mixed modern/legacy D&D Beyond source-path support for adventure books and refines v0.7 pagination efficiency while keeping the exporter structure-driven and book-agnostic.

## Design principle

This project is intentionally **not tailored to individual books**.

The Monster Manual is useful as a stress test because it contains hundreds of indexed entries, but the script is designed around reusable document semantics rather than checks such as `if book === Monster Manual`.

Where possible, the builder reacts to structural features such as:

- table-of-contents pages;
- indexed/reference links;
- fragment targets;
- heading hierarchy;
- short versus long tables;
- structured stat/rules blocks;
- artwork and captions;
- source-document boundaries.

That same logic is intended to work across adventures, rulebooks, setting books, bestiaries, character-option books, and future D&D Beyond source layouts.

## Highlights

- Works from D&D Beyond sourcebook landing pages under `/sources/...`.
- Supports newer `/sources/dnd/...` paths and older source paths.
- Discovers ordinary table-of-contents pages.
- Detects large index/reference sections such as stat-block indexes, spell references, magic items, feats, backgrounds, species, glossary/reference sections, and similar linked material.
- Preserves `#fragment` targets.
- Groups indexed links by their **underlying source document**.
- Downloads each underlying HTML document only once per run.
- Prevents grouped parent/child entries from being appended repeatedly.
- Namespaces captured HTML anchors to reduce ID collisions when many pages are merged.
- Rewrites captured navigation to offline document anchors when possible.
- Resolves common lazy-loaded images and waits for images/fonts before enabling printing.
- Produces US Letter print-oriented output.
- Keeps the Capture Report visible in the preview while hiding it from printed/PDF output by default.

## v0.8 adventure compatibility and pagination efficiency

v0.8 supports D&D Beyond books whose landing page uses `/sources/dnd/<slug>` while actual chapter pages still use `/sources/<slug>/...`. The builder treats both path forms as aliases for the same book instead of hard-coding individual adventure titles.

Additional changes:

- large generated indexes with 80+ entries print in two columns;
- indexed-entry headings keep only one compact opening metadata line attached, reducing unnecessary whitespace;
- artwork/credit grouping is less aggressive and maximum print image height is slightly reduced;
- generic `Creatures`, `NPCs`, and `Sidekicks` headings can participate in reference discovery;
- existing v0.5 duplicate prevention, v0.6 table reconstruction, and v0.7 entry spacing remain intact.

## v0.7 generic print polish

v0.7 improves readability without assuming that an indexed entry is specifically a monster, spell, item, NPC, location, or encounter.

### Discrete entry spacing

When an index/reference link points to a fragment inside a captured source document, the script marks that target as a generic content-entry boundary.

The print stylesheet then adds:

- additional top spacing;
- a subtle divider;
- stronger visual separation from the previous entry;
- page-break hints to keep the heading attached to the opening metadata when practical.

This applies equally to monsters, spells, items, feats, backgrounds, NPCs, locations, rules references, and other indexed content.

### Heading hierarchy

Captured sourcebook content receives more consistent spacing for `h1` through `h6` headings so adjacent sections do not visually run together.

Major headings receive more breathing room than lower-level subsections while still being allowed to flow naturally across printed pages.

### Short tables

Tables with up to 12 rows are treated as compact reference tables and are preferentially kept on one printed page.

A nearby table heading is also kept with the table when practical.

This is useful for:

- d6/d8/d10/d12 random tables;
- encounter tables;
- rumors;
- complications;
- small treasure tables;
- NPC traits;
- appearance tables;
- other compact lookup tables.

Long tables remain splittable and retain repeated table headers where the browser supports them.

## v0.6 stat-block and table improvements

v0.6 no longer relies entirely on D&D Beyond's screen-oriented table layout surviving browser printing.

### Ability scores

When the source markup exposes parseable ability-score tables, the script combines the common split layout into one compact six-ability print table:

|  | STR | DEX | CON | INT | WIS | CHA |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Score | 21 | 9 | 15 | 18 | 15 | 18 |
| Mod | +5 | -1 | +2 | +4 | +2 | +4 |
| Save | +5 | +3 | +6 | +8 | +6 | +4 |

The original source ability tables are hidden **only when all six abilities are parsed successfully**. If reconstruction is incomplete, the original table remains visible rather than silently dropping information.

### Stat-block details

Known D&D Beyond stat-block label/value rows are given a consistent print grid for fields such as Armor Class, Hit Points, Speed, Skills, Senses, Languages, Challenge Rating, resistances, immunities, and similar details when the source markup exposes the expected classes.

Traits, Actions, Bonus Actions, Reactions, Legendary Actions, and similar stat-block section headings receive a visually distinct print treatment when D&D Beyond exposes the expected description-heading classes.

Large stat blocks are still allowed to span multiple sheets naturally.

### Ordinary sourcebook tables

Captured HTML tables receive consistent print styling:

- visible cell borders;
- shaded header rows;
- alternating row shading;
- repeated table headers across printed pages where the browser supports it;
- compact first columns for dice/random-result tables;
- row-level page-break protection where practical.

This applies to random tables, challenge-rating tables, lookup tables, encounter tables, and similar book content.

## Why indexes are treated as navigation

Large indexes cannot safely be handled by appending every logical entry as a separate copy.

For example, links such as:

```text
/reference-page#entry-a
/reference-page#entry-b
/reference-page#entry-c
```

can all live in the same underlying HTML document:

```text
/reference-page
```

The builder therefore uses this model:

```text
logical index links
        ↓
normalize underlying URLs
        ↓
unique source documents
        ↓
fetch each document once
        ↓
include each document once
        ↓
rewrite index links to local anchors
```

This avoids duplicate content while preserving offline navigation.

## Print-first pagination

The script neutralizes inherited `break-before`, `break-after`, `break-inside`, and legacy `page-break-*` rules inside captured sourcebook content, then applies book-style print rules.

It also:

- uses a simple block-layout cover;
- lets normal prose and subsections flow naturally;
- allows large stat/rules blocks to span pages;
- keeps headings with following content where practical;
- gives discrete indexed entries additional visual separation;
- keeps compact tables intact where practical;
- limits artwork to the printable page height;
- groups short artist credits with following artwork when that pattern is detected;
- hides the diagnostic Capture Report from printed/PDF output by default.

## Requirements

- Chrome, Edge, Firefox, or another browser supported by Tampermonkey.
- [Tampermonkey](https://www.tampermonkey.net/) installed.
- A D&D Beyond account logged into the browser.
- Access to the sourcebook being exported.

## Installation / update

Open the raw userscript:

`https://raw.githubusercontent.com/EnderGotGame/ddb-offline-sourcebook-builder/main/ddb-offline-sourcebook-builder.user.js`

If Tampermonkey recognizes it, choose **Install** or **Update**.

If it opens as plain text:

1. Open **Tampermonkey → Dashboard**.
2. Open your existing **DDB Offline Sourcebook Builder** script.
3. Select everything in the editor.
4. Replace it with the contents of `ddb-offline-sourcebook-builder.user.js` from this repository.
5. Save with **Ctrl+S**.
6. Confirm the metadata header shows:

```javascript
// @version      0.8.0
```

7. Reload the D&D Beyond sourcebook page.

Do not manually merge v0.7 functions into an older copy; replace the entire userscript.

## Usage

1. Sign in to D&D Beyond.
2. Open the **main landing/Contents page** of a sourcebook you can access.
3. Reload after installing/updating the userscript.
4. Click **Build Offline PDF** in the lower-right corner.
5. Allow popups for `www.dndbeyond.com` if required.
6. Leave the original D&D Beyond tab open while the builder runs.
7. Wait until the generated preview finishes loading images.
8. Review the preview and Capture Report.
9. Click **Print / Save PDF**.

## Recommended print settings

| Setting | Recommendation |
| --- | --- |
| Paper size | Letter |
| Layout | Portrait |
| Scale | 95–100% initially |
| Background graphics | On |
| Browser headers/footers | Off |
| Duplex | Long-edge binding |

## Capture Report

The preview reports:

- Primary sourcebook pages discovered
- Indexed/reference links discovered
- Unique indexed source documents appended
- Unique HTML documents requested
- Capture failures

By default the Capture Report is hidden when printing or saving the book as PDF.

## Configuration

Near the top of the script:

```javascript
const CONFIG = {
    minPageDelay: 900,
    maxPageDelay: 1600,
    maxRetries: 4,
    requestTimeoutMs: 30000,
    majorPagesStartNewPage: true,
    includeSiteCss: true,
    includeCaptureReportInPrint: false,
    maxIndexedLinks: 1400,
    debug: true
};
```

Do not set request delays to zero for large books. The downloader intentionally spaces uncached requests to reduce rate limiting.

## Troubleshooting

### Build button does not appear

- Verify Tampermonkey and the userscript are enabled.
- Confirm the URL is under `https://www.dndbeyond.com/sources/...`.
- Open the book's main Contents/landing page, not an individual chapter.
- Reload after updating the script.

### Popup is blocked

Allow popups for `www.dndbeyond.com`, then run the builder again.

### 429 errors

D&D Beyond is rate limiting requests. Increase `minPageDelay` and `maxPageDelay`.

### A target redirects to login or Marketplace

Open the same target normally while logged in and verify that the account has access. The script intentionally does not bypass access controls.

### A stat block did not get a reconstructed ability table

The transformer is deliberately conservative. It only replaces the source ability layout when all six ability scores, modifiers, and save values can be parsed from the captured table markup. If D&D Beyond changes that markup, the original data remains visible rather than being discarded.

### A normal table still looks wrong

Report the book/section and generated PDF page. Different sourcebooks sometimes use non-table div/grid components that may need an additional semantic print transformer.

### A short table still splits

The script protects compact HTML tables with up to 12 rows, but browser pagination can still override this when the table is physically taller than the printable area or when D&D Beyond uses a non-table grid component.

## Privacy and security

- Runs locally in the browser through Tampermonkey.
- Uses the browser's existing authenticated D&D Beyond session.
- Does not request or store your D&D Beyond password.
- Does not upload captured book content to this repository.
- The repository contains only the userscript and documentation, not sourcebook PDFs or book text.

## Project scope

This is an unofficial personal-use utility. It is not affiliated with or endorsed by Wizards of the Coast or D&D Beyond.

D&D Beyond and Dungeons & Dragons are trademarks of their respective owners.

## License

The userscript source code in this repository is released under the MIT License. That license applies only to this project's code and does not grant rights to D&D Beyond or Dungeons & Dragons content, artwork, trademarks, or other third-party material.
