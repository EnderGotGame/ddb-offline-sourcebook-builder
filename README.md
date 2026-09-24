# DDB Offline Sourcebook Builder

A Tampermonkey userscript that builds a print-ready, offline-friendly version of a D&D Beyond sourcebook that your currently logged-in account can already access, then lets you save it as a PDF from the browser print dialog.

> **Important:** This project does not bypass authentication, ownership checks, paywalls, or DRM. It only requests pages the current D&D Beyond browser session can already open. Use it only with content you are authorized to access and in accordance with applicable terms and law.

## Current version

**v0.6.0**

v0.6 adds semantic print reconstruction for stat blocks and sourcebook tables. This was added after reviewing a generated 2024 Monster Manual PDF where the captured data was correct but ability-score tables and other reference tables were flattened and difficult to scan.

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

Captured HTML tables now receive consistent print styling:

- visible cell borders;
- shaded header rows;
- alternating row shading;
- repeated table headers across printed pages where the browser supports it;
- compact first columns for dice/random-result tables;
- row-level page-break protection where practical.

This applies to tables such as random appearance/composition tables, challenge-rating tables, lookup tables, and similar book content.

## Why indexes are treated as navigation

The 2024 Monster Manual demonstrates why indexed links cannot simply be appended one at a time.

An index can contain links such as:

```text
/monsters-a#aarakocra
/monsters-a#aarakocra-aeromancer
/monsters-a#aarakocra-skirmisher
/monsters-a#aboleth
```

Those logical targets can all live inside one underlying HTML document:

```text
/monsters-a
```

The builder therefore:

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

This prevents grouped monster pages from being duplicated in the finished PDF.

## Print-first pagination

The script neutralizes inherited `break-before`, `break-after`, `break-inside`, and legacy `page-break-*` rules inside captured sourcebook content, then applies book-style print rules.

It also:

- uses a simple block-layout cover;
- lets normal prose and subsections flow naturally;
- allows large stat blocks to span pages;
- keeps headings with following content where practical;
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
// @version      0.6.0
```

7. Reload the D&D Beyond sourcebook page.

Do not manually merge v0.6 functions into an older copy; replace the entire userscript.

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

The v0.6 transformer is deliberately conservative. It only replaces the source ability layout when all six ability scores, modifiers, and save values can be parsed from the captured table markup. If D&D Beyond changes that markup, the original data remains visible rather than being discarded.

### A normal table still looks wrong

Report the book/section and generated PDF page. Different sourcebooks sometimes use non-table div/grid components that may need an additional semantic print transformer.

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
