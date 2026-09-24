# DDB Offline Sourcebook Builder

A Tampermonkey userscript that builds a print-ready, offline-friendly version of a D&D Beyond sourcebook that your currently logged-in account can already access, then lets you save it as a PDF from the browser print dialog.

The project is designed around two problems that normal browser printing handles poorly:

1. **D&D Beyond sourcebooks are not always linear.** Some books use chapter pages while others expose large indexes whose entries point to fragments inside a smaller number of underlying source documents.
2. **Web layout is not print layout.** Browser-oriented CSS can create blank sheets, stranded artist credits, giant gaps, duplicated reference material, and awkward stat-block page breaks when many source pages are combined.

> **Important:** This project does not bypass authentication, ownership checks, paywalls, or DRM. It only requests pages the current D&D Beyond browser session can already open. Use it only with content you are authorized to access and in accordance with applicable terms and law.

## Current version

**v0.5.0**

The v0.5 architecture was redesigned after testing a generated 2024 Monster Manual PDF. That test captured 589 indexed links but revealed two major problems in v0.4: grouped monster pages could be appended multiple times, and inherited browser/D&D Beyond print rules could produce nearly blank pages around artwork.

v0.5 fixes those issues at the document level rather than trying to patch individual monsters.

## Features

- Works from D&D Beyond sourcebook landing pages under `/sources/...`.
- Supports both newer `/sources/dnd/...` paths and older source paths.
- Discovers ordinary table-of-contents pages.
- Detects large index/reference sections such as stat-block indexes, spell references, magic items, feats, backgrounds, species, glossary/reference sections, and similar linked material.
- Preserves `#fragment` targets.
- Groups indexed links by their **underlying source document**.
- Downloads each underlying HTML document only once per run.
- Prevents grouped parent/child entries from being appended repeatedly.
- Namespaces captured HTML anchors to reduce ID collisions when many pages are merged.
- Rewrites captured navigation to offline document anchors when possible.
- Uses the current logged-in browser session with `credentials: include`.
- Retries transient `429`, `500`, `502`, `503`, and `504` responses.
- Detects redirects to login/Marketplace pages instead of silently exporting bad content.
- Resolves common lazy-loaded images and absolute asset URLs.
- Waits for images and fonts before enabling printing.
- Provides a cancel control and progress reporting.
- Produces US Letter print-oriented output.
- Keeps the Capture Report visible in the preview while hiding it from printed/PDF output by default.

## The important v0.5 change: indexes are navigation, not duplicate content

The 2024 Monster Manual is a good example of why this matters.

An index might contain links conceptually like:

```text
/monsters-a#aarakocra
/monsters-a#aarakocra-aeromancer
/monsters-a#aarakocra-skirmisher
/monsters-a#aboleth
```

Those are four logical targets, but they may all live inside one HTML document:

```text
/monsters-a
```

Older logic could separately extract the parent Aarakocra section and then append Aeromancer and Skirmisher again, producing duplicates.

v0.5 instead does this:

```text
589 logical index links
        ↓
normalize underlying URLs
        ↓
~small set of unique source documents
        ↓
fetch each document once
        ↓
include each document once
        ↓
rewrite index links to anchors inside the combined offline book
```

That preserves all index navigation without duplicating grouped monsters.

## Print-first pagination

v0.5 also substantially changes printing behavior.

The script now:

- neutralizes inherited `break-before`, `break-after`, `break-inside`, and legacy `page-break-*` rules inside captured sourcebook content;
- re-applies only the page-break behavior needed for a book-style print layout;
- uses a simple block-layout cover instead of a large flex container;
- keeps major sourcebook pages eligible to start on a fresh sheet;
- lets normal prose, lists, tables, and monster entries flow naturally;
- allows large stat blocks to span pages;
- tries to keep individual stat-block actions/traits intact;
- allows figures to flow instead of reserving an entire sheet unnecessarily;
- limits image height to the printable page area;
- groups a short artist credit with the following artwork when that pattern is detected;
- avoids printing the diagnostic Capture Report unless configured otherwise.

The goal is a PDF that can be duplex printed and read like a book rather than a stack of webpages.

## Requirements

- Chrome, Edge, Firefox, or another browser supported by Tampermonkey.
- [Tampermonkey](https://www.tampermonkey.net/) installed.
- A D&D Beyond account logged into the browser.
- Access to the sourcebook being exported.

## Installation

### Install directly from GitHub

Open the raw userscript:

`https://raw.githubusercontent.com/EnderGotGame/ddb-offline-sourcebook-builder/main/ddb-offline-sourcebook-builder.user.js`

If Tampermonkey recognizes it, choose **Install** or **Update**.

If it opens as plain text:

1. Open the Tampermonkey extension.
2. Open **Dashboard**.
3. Open your existing **DDB Offline Sourcebook Builder** script, or create a new script.
4. Replace the entire editor contents with `ddb-offline-sourcebook-builder.user.js` from this repository.
5. Save with **Ctrl+S**.
6. Confirm the script is enabled.

### Updating from v0.4

Replace the entire old v0.4 script with v0.5. Do not try to merge individual functions manually; the indexed-content architecture changed significantly.

The metadata header should show:

```javascript
// @version      0.5.0
```

## Usage

1. Sign in to D&D Beyond.
2. Open the **main landing/Contents page** of a sourcebook you can access.
3. Reload the page after installing/updating the userscript.
4. Look in the lower-right corner for **Build Offline PDF**.
5. Click it.
6. Allow popups for `www.dndbeyond.com` if required.
7. Leave the original D&D Beyond tab open while the builder runs.
8. Wait for the generated preview to finish loading images.
9. Review the on-screen progress/Capture Report if desired.
10. Click **Print / Save PDF**.

## Recommended print settings

| Setting | Recommendation |
| --- | --- |
| Paper size | Letter |
| Layout | Portrait |
| Scale | 95-100% initially |
| Background graphics | On |
| Browser headers/footers | Off |
| Duplex | Long-edge binding |

If a specific book contains unusually wide tables, reduce print scale slightly before modifying CSS.

## How discovery works

### Primary pages

The script first looks at the book table of contents and discovers unique source pages such as introductions, chapters, appendices, and credits.

### Indexed links

The landing page is also checked for likely index/reference headings. Logical links are preserved with their fragments, but the script separately records the URL that must actually be fetched.

For example:

```text
Logical target: /sources/dnd/example/creatures#raven
Fetch URL:      /sources/dnd/example/creatures
```

### Unique reference documents

All indexed links are grouped by their fetch URL. If 50 index targets live on one source page, that source page is fetched and inserted **once**.

If the same source document is already included as a primary page, it is not added a second time.

### Anchor namespacing

When multiple source documents are merged, generic IDs such as `actions`, `traits`, or repeated component IDs could collide. v0.5 prefixes captured IDs with the generated document section ID and keeps a map from the original fragment to the new local target.

### Offline link rewriting

Captured links are rewritten to those generated anchors where possible. Uncaptured links remain normal external D&D Beyond links.

## Monster Manual behavior

For the 2024 Monster Manual, expect a large logical index count but a much smaller unique source-document count.

That is normal and desirable.

The old v0.4 Capture Report might have shown hundreds of **Indexed entries appended**. v0.5 instead reports **Unique indexed source documents appended**.

A healthy Monster Manual run should therefore look conceptually like:

```text
Primary sourcebook pages discovered:      small number
Indexed/reference links discovered:       500+
Unique indexed source documents appended: much smaller
Unique HTML documents requested:          similarly small
Capture failures:                         0 or understood warnings
```

## Capture Report

The preview includes a Capture Report with:

- Primary sourcebook pages discovered
- Indexed/reference links discovered
- Unique indexed source documents appended
- Unique HTML documents requested
- Capture failures

By default the Capture Report is hidden when printing or saving the book as PDF.

To print it too, change:

```javascript
includeCaptureReportInPrint: false
```

to:

```javascript
includeCaptureReportInPrint: true
```

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

### Request delays

Do not set both delays to zero for large books. The downloader intentionally spaces uncached requests to reduce rate limiting.

### `majorPagesStartNewPage`

When enabled, major table-of-contents pages such as introductions and appendices may start on a fresh printed page. Indexed source documents themselves are allowed to flow naturally.

### `includeSiteCss`

Keeps the site's visual styling, but v0.5 aggressively overrides pagination rules inside captured content.

### `maxIndexedLinks`

Safety cap for automatically discovered logical index targets.

## Troubleshooting

### Build button does not appear

- Verify Tampermonkey is enabled.
- Verify the userscript is enabled.
- Confirm the URL is under `https://www.dndbeyond.com/sources/...`.
- Open the book's main Contents/landing page, not an individual chapter.
- Reload after updating the script.

### Popup is blocked

Allow popups for `www.dndbeyond.com`, then run the builder again.

### 429 errors

D&D Beyond is rate limiting requests. Increase `minPageDelay` and `maxPageDelay`.

### A target redirects to login or Marketplace

Open the same target normally while logged in and verify that the account has access. The script intentionally does not bypass access controls.

### Duplicate monster groups still appear

Check whether the duplicate is a true repeated stat block or merely a legitimate image caption/title repeated near artwork. If an entire parent/child stat block group appears twice in v0.5, capture the generated report counts and the relevant index/source URLs for a bug report.

### Nearly blank pages remain

v0.5 specifically targets the common artist-credit/artwork pagination problem, but D&D Beyond can change markup. If a repeatable blank-page pattern remains, report the generated PDF page number and the nearby section/monster name. Avoid uploading copyrighted book content to a public GitHub issue.

## Privacy and security

- Runs locally in the browser through Tampermonkey.
- Uses the browser's existing authenticated D&D Beyond session.
- Does not request or store your D&D Beyond password.
- Does not upload captured book content to this GitHub repository.
- The repository contains only the userscript and documentation, not sourcebook PDFs or book text.

## Project scope

This is an unofficial personal-use utility. It is not affiliated with or endorsed by Wizards of the Coast or D&D Beyond.

D&D Beyond and Dungeons & Dragons are trademarks of their respective owners.

## Development notes

Key v0.5 concepts:

- `discoverPrimaryPages()` — finds normal TOC pages.
- `discoverIndexGroups()` — finds logical indexed/reference links.
- `buildReferenceDocuments()` — collapses hundreds of logical links into unique fetch documents.
- `fetchHtml()` — authenticated, cached, retrying fetch.
- `extractDocument()` — cleans sourcebook HTML, groups artwork, and namespaces anchors.
- `buildMaps()` — maps original D&D Beyond URLs/fragments to local offline targets.
- `rewriteLinks()` — converts captured navigation to local anchors.
- `css()` — resets inherited print pagination and applies book-style rules.
- `buildDocument()` — assembles cover, index, source documents, appendices, and diagnostic report.

When changing extraction logic, test at minimum:

1. A normal chapter-heavy sourcebook.
2. The 2024 Monster Manual or another book with a large index.
3. A book with many images.
4. A book with wide tables.
5. Physical print preview, not only the generated HTML.

Verify both **content completeness** and **pagination quality**.

## License

The userscript source code in this repository is released under the MIT License. That license applies only to this project's code and does not grant rights to D&D Beyond or Dungeons & Dragons content, artwork, trademarks, or other third-party material.
