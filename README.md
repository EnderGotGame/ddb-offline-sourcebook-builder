# DDB Offline Sourcebook Builder

A Tampermonkey userscript that builds a print-ready, offline-friendly copy of a D&D Beyond sourcebook or adventure that the currently logged-in browser session can already access, then opens it in a print preview so it can be saved as a PDF.

> **Important:** This project does not bypass authentication, ownership checks, paywalls, or DRM. It only requests pages the current D&D Beyond browser session can already open. Use it only with content you are authorized to access and in accordance with applicable terms and law.

## Current version

**v0.9.0**

v0.9 is a presentation-polish release based on testing both the 2024 Monster Manual and *Dragonlance: Shadow of the Dragon Queen*. It keeps the downloader book-agnostic and adds better reference indexes, safer artwork association, printable callouts/read-aloud text, and preservation/reconstruction of flow/card layouts.

## Design principle

The exporter is intentionally **not tailored to individual books**.

The Monster Manual is a useful stress test because it contains hundreds of indexed stat blocks. Adventure books stress different parts of the system: chapters, read-aloud text, encounter tables, maps, appendices, NPCs, magic items, flowcharts, and mixed modern/legacy D&D Beyond URLs.

The builder therefore reacts to document structure and features rather than book titles.

Examples:

- table-of-contents structure;
- modern and legacy source-path aliases;
- indexed/reference links;
- `#fragment` targets;
- heading hierarchy;
- short versus long tables;
- structured rules/stat blocks;
- callout/read-aloud containers;
- card/grid/flowchart containers;
- artwork and artist credits;
- source-document boundaries.

There are no `if book === "Monster Manual"` or `if book === "Shadow of the Dragon Queen"` branches.

## Highlights

- Works from D&D Beyond sourcebook landing pages under `/sources/...`.
- Supports both newer `/sources/dnd/<slug>` landing pages and older `/sources/<slug>/...` chapter routes.
- Discovers normal book/chapter pages from the landing-page table of contents.
- Detects reference/index sections such as stat blocks, creatures, NPCs, sidekicks, magic items, feats, backgrounds, species, glossary/reference sections, and similar linked material.
- Preserves fragment targets and converts captured links to internal PDF/document links where possible.
- Groups indexed links by the **underlying source document** and downloads each underlying HTML document only once.
- Avoids duplicate parent/child content caused by repeatedly appending fragment targets from the same source page.
- Namespaces captured IDs/anchors to reduce collisions after many pages are merged.
- Resolves common lazy-loaded images and waits for images/fonts before enabling print.
- Produces US Letter print-oriented output.
- Keeps the diagnostic Capture Report in the preview while hiding it from PDF/physical print by default.

## v0.9 print polish

### Reference Index

Generated linked material is now clearly separated from the ordinary table of contents under a **Reference Index** heading.

Column count is selected from the total number of discovered reference entries:

| Reference entries | Layout |
| ---: | --- |
| 0–30 | 1 column |
| 31–180 | 2 columns |
| 181+ | 3 columns |

This keeps small adventure indexes readable while making very large bestiary/spell/item indexes substantially more compact.

Repeated reference groups with the same normalized heading are merged in the generated index while preserving entry order.

### Artwork and artist credits

When the exporter confidently detects a short artist/studio credit immediately before an image, the credit and artwork are grouped as one print unit.

v0.9 uses a more conservative artist-name heuristic than earlier versions so ordinary short adventure text is less likely to be mistaken for a credit.

Credited artwork is capped to a smaller print height than unrestricted artwork, which helps the credit and its image stay together without creating as many sparse pages.

### Callouts and read-aloud text

The builder identifies common structural classes used for:

- read-aloud/boxed text;
- sidebars;
- rule callouts;
- notes;
- quote boxes;
- similar semantic callout containers.

These receive a print-safe background, left rule, padding, and page-break protection. Read-aloud containers receive italic treatment.

The logic is class/structure driven and does not depend on a specific adventure title.

### Flowcharts and card/grid layouts

The builder preserves containers whose classes advertise grid/card/flow layout.

If a section explicitly labels itself as a **flowchart** but the source is represented as ordinary lower-level heading/text siblings, v0.9 can reconstruct those repeated groups into a two-column print grid.

This is useful for adventure-flow diagrams and similar structured reference sections while remaining feature-driven.

## Adventure/source path compatibility

Some D&D Beyond books use mixed URL layouts. A landing page can use:

```text
/sources/dnd/<slug>
```

while its actual chapter pages use:

```text
/sources/<slug>/<chapter>
```

The exporter derives both roots from the book slug and treats them as aliases for the same book.

This fixed adventure books that previously failed with:

```text
No sourcebook pages found. Open the book main Contents page.
```

## Generic entry spacing

When an index/reference link points to a fragment inside a captured source document, the exporter marks that fragment target as a generic discrete-entry boundary.

That gives monsters, spells, items, NPCs, locations, encounters, feats, backgrounds, and similar reference entries:

- extra breathing room;
- a subtle divider;
- heading-to-opening-line page-break hints.

Only one compact opening metadata/subtitle line is preferentially kept with the heading. The entire entry remains free to span pages naturally.

## Table handling

### Short tables

HTML tables with up to 12 rows are preferentially kept together on one page. A nearby table heading is also kept with the table when practical.

This works well for:

- random encounters;
- rumors;
- complications;
- appearance tables;
- treasure tables;
- small lookup tables.

Long tables remain splittable.

### Ordinary tables

Captured HTML tables receive consistent print styling:

- visible borders;
- shaded header rows;
- alternating row shading;
- repeated table headers across printed pages where supported;
- compact die/result columns;
- row-level page-break protection where practical.

### Ability-score/stat-block tables

When a source stat block exposes parseable STR/DEX/CON/INT/WIS/CHA tables, the exporter combines the common split layout into one compact six-ability print table:

|  | STR | DEX | CON | INT | WIS | CHA |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Score | 21 | 9 | 15 | 18 | 15 | 18 |
| Mod | +5 | -1 | +2 | +4 | +2 | +4 |
| Save | +5 | +3 | +6 | +8 | +6 | +4 |

The original ability tables are hidden **only after** a complete six-ability replacement is successfully reconstructed.

Older stat-block formats are left intact when the transformer cannot confidently reconstruct them.

## Why indexes are treated as navigation

A large index might contain hundreds of logical entries while those entries live in only a few underlying HTML documents.

For example:

```text
/reference-page#entry-a
/reference-page#entry-b
/reference-page#entry-c
```

all belong to:

```text
/reference-page
```

The builder therefore uses this model:

```text
logical reference links
        ↓
normalize underlying URLs
        ↓
unique source documents
        ↓
fetch each document once
        ↓
include each document once
        ↓
rewrite reference links to local anchors
```

This prevents duplicate content while retaining offline navigation.

## Print-first pagination

The script neutralizes inherited `break-before`, `break-after`, `break-inside`, and legacy `page-break-*` rules inside captured source content, then applies its own print-oriented rules.

It also:

- uses a simple block-layout cover;
- lets normal prose flow naturally;
- lets large stat/rules blocks span pages;
- keeps headings with nearby opening content when practical;
- separates discrete indexed entries visually;
- protects compact tables;
- constrains large artwork to printable page height;
- keeps confidently detected artist credits with their artwork;
- hides the Capture Report from the printed PDF.

Major chapter/source pages can still start on a new sheet.

## Requirements

- Chrome, Edge, Firefox, or another browser supported by Tampermonkey.
- [Tampermonkey](https://www.tampermonkey.net/) installed.
- A D&D Beyond account logged into the browser.
- Access to the sourcebook/adventure being exported.

## Installation / update

Open the raw userscript:

```text
https://raw.githubusercontent.com/EnderGotGame/ddb-offline-sourcebook-builder/main/ddb-offline-sourcebook-builder.user.js
```

If Tampermonkey recognizes it, choose **Install** or **Update**.

If it opens as plain text:

1. Open **Tampermonkey → Dashboard**.
2. Open your existing **DDB Offline Sourcebook Builder**.
3. Select everything in the editor.
4. Replace it with the complete contents of `ddb-offline-sourcebook-builder.user.js`.
5. Save with **Ctrl+S**.
6. Confirm the header says:

```javascript
// @version      0.9.0
```

7. Reload the D&D Beyond book landing page.

Replace the whole userscript when updating. Do not manually merge individual functions from older versions.

## Usage

1. Sign in to D&D Beyond.
2. Open the book's **main landing / Contents page**.
3. Reload the page after installing/updating the userscript.
4. Click **Build Offline PDF** in the lower-right.
5. Allow popups for `www.dndbeyond.com` if required.
6. Leave the original D&D Beyond tab open while the builder runs.
7. Wait for the generated preview to finish loading images.
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

The Capture Report is hidden from printed/PDF output by default.

## Configuration

Near the top of the userscript:

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

### `No sourcebook pages found`

v0.8+ supports mixed modern/legacy source roots. If this still happens:

- reload the main Contents page;
- verify the visible URL is the book landing page;
- open DevTools → Console and look for `[DDB PDF] Detected source roots`;
- report the landing-page URL and one chapter URL.

### Popup is blocked

Allow popups for `www.dndbeyond.com`, then run the builder again.

### 429 errors

D&D Beyond is rate limiting requests. Increase `minPageDelay` and `maxPageDelay`.

### A target redirects to login or Marketplace

Open the same target normally while logged in and verify that the account has access. The script intentionally does not bypass access controls.

### A stat block did not get a reconstructed ability table

The transformer is conservative. It only replaces the source ability layout when all six abilities can be parsed safely. If the markup differs, the original data remains visible.

### A table still looks wrong

Report the book, section name, and generated PDF page. Some D&D Beyond components are grid/div structures rather than semantic HTML tables.

### A callout/read-aloud box is not recognized

Report the book and generated PDF page. The exporter currently relies on semantic class/structure cues and intentionally avoids guessing based on book-specific text.

## Privacy and security

- Runs locally in the browser through Tampermonkey.
- Uses the browser's existing authenticated D&D Beyond session.
- Does not request or store your D&D Beyond password.
- Does not upload captured book content to this repository.
- The repository contains only the userscript and documentation, not sourcebook PDFs or copyrighted book text.

## Project scope

This is an unofficial personal-use utility. It is not affiliated with or endorsed by Wizards of the Coast or D&D Beyond.

D&D Beyond and Dungeons & Dragons are trademarks of their respective owners.

## License

The userscript source code in this repository is released under the MIT License. That license applies only to this project's code and does not grant rights to D&D Beyond or Dungeons & Dragons content, artwork, trademarks, or other third-party material.
