# DDB Offline Sourcebook Builder

A Tampermonkey userscript that builds a print-ready, offline-friendly version of a D&D Beyond sourcebook that your currently logged-in account can already access, then lets you save it as a PDF from the browser's print dialog.

The project is designed around two problems that ordinary "print the webpage" approaches handle poorly:

1. **D&D Beyond sourcebooks are not always linear.** Some books use chapter pages, while others expose large indexes whose entries point to fragments or separate reference pages. The 2024 Monster Manual is a good example: its stat-block index links to hundreds of individual entries.
2. **Web layout is not print layout.** Naive HTML-to-PDF conversion often creates giant blank areas, stranded headings, broken stat blocks, and one forced page per web section.

This script discovers both ordinary sourcebook pages and indexed/reference links, fetches each underlying HTML document only once, rewrites captured navigation for offline use, and applies print-focused CSS intended to flow naturally on US Letter paper.

> **Important:** This project does not bypass authentication, ownership checks, paywalls, or DRM. It only requests pages the active D&D Beyond browser session can already open. Use it only with content you are authorized to access and in accordance with applicable terms and law.

## Features

- Works from a D&D Beyond sourcebook landing page under `/sources/...`.
- Supports both current paths such as `/sources/dnd/phb-2024` and older source paths.
- Discovers normal table-of-contents pages.
- Detects common index/reference sections such as stat blocks, spells, magic items, feats, backgrounds, glossary/reference sections, and similar linked material.
- Preserves `#fragment` targets instead of collapsing them into a single page URL.
- Separates **fetch identity** from **logical entry identity** so many entries on one page require only one network request.
- Caches source documents during a run.
- Retries transient HTTP failures such as `429`, `500`, `502`, `503`, and `504`.
- Uses the current logged-in browser session (`credentials: include`).
- Detects redirects to login/Marketplace pages and reports them as failures rather than silently exporting bad content.
- Resolves lazy-loaded images and relative asset URLs.
- Rewrites captured links to offline anchors when possible.
- Appends indexed/reference material that is linked by the sourcebook but not already present in a captured source page.
- Adds a capture report showing discovered pages, indexed links, unique documents requested, and warnings.
- Provides a **Cancel** control during long exports.
- Provides a **Print / Save PDF** button in the generated preview.

## Print-first pagination

The generated document is intentionally styled like a printable book rather than a collection of web pages.

The print CSS attempts to:

- Start major sourcebook pages/chapters cleanly.
- Let normal prose and subsections flow naturally.
- Keep headings with the content that follows them.
- Avoid isolated first/last lines with widow/orphan controls.
- Allow long lists to continue across pages.
- Avoid splitting individual list items when practical.
- Allow tables to span pages while trying not to split individual rows.
- Keep images and captions together when possible.
- Allow large stat blocks to span multiple pages rather than forcing huge blank areas.
- Avoid splitting individual stat-block paragraphs/actions when practical.
- Use physical print units rather than a fixed browser-pixel page width.

The default target is **US Letter** with print-friendly margins.

## Requirements

- A Chromium- or Firefox-based browser supported by Tampermonkey.
- [Tampermonkey](https://www.tampermonkey.net/) installed.
- A D&D Beyond account logged into the browser.
- Access to the sourcebook you want to export.

## Installation

### Option 1: Install from this repository

1. Open `ddb-offline-sourcebook-builder.user.js` in this repository.
2. Click **Raw**.
3. If Tampermonkey recognizes the userscript, choose **Install**.

If your browser opens the file as plain text instead:

1. Click the Tampermonkey extension icon.
2. Open **Dashboard**.
3. Choose **Create a new script**.
4. Delete the sample contents.
5. Copy the full contents of `ddb-offline-sourcebook-builder.user.js` into the editor.
6. Press **Ctrl+S** (or use **File -> Save**).
7. Confirm the script is enabled.

### Option 2: Replace an older version

If you previously installed another D&D Beyond PDF/downloader userscript, disable it first to avoid duplicate buttons or conflicting behavior.

Then install this script using the steps above.

## Usage

1. Sign in to D&D Beyond.
2. Open the **main landing/Contents page** of a sourcebook you can access.
3. Wait for the page to finish loading.
4. Look in the lower-right corner for **Build Offline PDF**.
5. Click it.
6. Allow pop-ups for `www.dndbeyond.com` if your browser blocks the preview tab.
7. Leave the original D&D Beyond tab open while the builder runs.
8. Watch progress in the lower-right status display or the preview tab.
9. When complete, review the generated **Capture Report**.
10. Click **Print / Save PDF** in the preview tab.
11. In the browser print dialog, choose **Save to PDF** or your physical printer.

## Recommended print settings

For PDF export or physical printing:

| Setting | Recommendation |
| --- | --- |
| Paper size | Letter |
| Layout | Portrait |
| Scale | 95-100% initially |
| Background graphics | On |
| Browser headers/footers | Off |
| Margins | Default/custom generated layout |
| Duplex | Long-edge binding for normal book-style printing |

If a particular book has unusually wide tables, try a slightly lower scale before changing the script CSS.

## How it works

The builder uses a two-phase discovery model.

### 1. Primary sourcebook pages

The script first looks for the book's normal table of contents and collects unique underlying chapter/source page URLs.

For example:

```text
/sources/dnd/example-book/introduction
/sources/dnd/example-book/chapter-1
/sources/dnd/example-book/appendix-a
```

Each underlying page is fetched once and its article content is cleaned for offline output.

### 2. Indexed/reference entries

The landing page is also inspected for likely index/reference headings. Links in those sections are classified as logical entries when they point to:

- a fragment inside the sourcebook, such as:

```text
/sources/dnd/example-book/creatures#raven
/sources/dnd/example-book/creatures#wolf
```

- or a D&D Beyond reference/entity page such as a monster, spell, magic item, feat, background, species, equipment item, or vehicle.

The key design detail is that a **logical target** and the **HTML document that must be fetched** are stored separately.

For example:

```text
Logical target: /sources/dnd/example-book/creatures#raven
Fetch document: /sources/dnd/example-book/creatures
```

If 80 indexed entries live on that same `creatures` page, the page is fetched once and reused from memory for the other entries.

### 3. Duplicate prevention

If an indexed fragment already lives inside a primary sourcebook page that is being included in full, the script does **not** append a second duplicate copy of that entry. Instead, offline navigation can point to the original fragment in the combined document.

Reference entries that are linked by the sourcebook but not present in a captured primary page are appended under **Indexed Reference Material**.

### 4. Offline navigation

Where possible, links are rewritten from D&D Beyond URLs to local document anchors.

Conceptually:

```text
https://www.dndbeyond.com/.../creatures#raven
```

becomes an in-document link such as:

```text
#raven
```

or a generated entry anchor.

Links that were not captured remain normal external links.

### 5. Asset handling

The builder attempts to preserve images by:

- resolving relative URLs to absolute URLs;
- recognizing common lazy-load attributes;
- preserving `srcset` values with absolute URLs;
- waiting for images and fonts before enabling the print button.

The generated HTML preview still uses remote D&D Beyond assets while it is being assembled/printed. The resulting PDF embeds what the browser renders at print time.

## Monster Manual and large indexes

The script is intentionally **not** hard-coded only for the Monster Manual.

The Monster Manual exposed a general flaw in older downloaders: removing URL fragments before deduplication turns distinct targets such as:

```text
creatures#raven
creatures#rat
creatures#wolf
```

into one apparent URL:

```text
creatures
```

This project keeps the fragment as part of the logical entry while still sharing the underlying fetched document. The same strategy can therefore support future books that use similar indexes for spells, creatures, items, feats, NPCs, or other reference content.

## Capture Report

Every generated book ends with a **Capture Report**.

It includes:

- Primary sourcebook pages discovered
- Indexed/reference links discovered
- Indexed entries appended
- Unique HTML documents requested
- Capture failures

Do not ignore a large warning count. A warning generally means D&D Beyond changed part of its markup, an entry used an unsupported layout, the current account could not access a target, or the target could not be isolated reliably.

A healthy run should have either zero warnings or a small number that you have manually checked.

## Configuration

Configuration is near the top of the userscript:

```javascript
const CONFIG = {
    minPageDelay: 900,
    maxPageDelay: 1600,
    maxRetries: 4,
    requestTimeoutMs: 30000,
    majorPagesStartNewPage: true,
    includeSiteCss: true,
    maxIndexedEntries: 1200,
    debug: true
};
```

### `minPageDelay` / `maxPageDelay`

Random delay range between uncached requests. Keeping a non-zero delay reduces the likelihood of rate limiting and is friendlier to the site.

### `maxRetries`

Maximum retry attempts for transient request failures.

### `requestTimeoutMs`

Abort a request that has not completed within this time.

### `majorPagesStartNewPage`

When `true`, captured primary book pages start on a new printed page. Indexed entries still flow naturally rather than forcing one entry per sheet.

If you prefer maximum paper density, set this to `false`.

### `includeSiteCss`

Includes stylesheets already loaded by D&D Beyond in the generated preview, followed by this project's print overrides.

### `maxIndexedEntries`

Safety cap for automatically discovered indexed/reference entries.

### `debug`

Enables additional progress information in the browser developer console.

## Troubleshooting

### The **Build Offline PDF** button does not appear

Check all of the following:

- Tampermonkey is enabled.
- The userscript is enabled.
- You are on `https://www.dndbeyond.com/sources/...`.
- You are on the book's main landing page rather than an individual chapter.
- Reload the page after enabling the script.

### The preview tab is blocked

Allow pop-ups for `www.dndbeyond.com`, then run the builder again.

The script opens the preview synchronously when you click **Build Offline PDF** specifically so normal popup blockers can recognize it as user-initiated.

### I see `429` errors

D&D Beyond is rate limiting requests.

Increase:

```javascript
minPageDelay
maxPageDelay
```

Do **not** set both delays to zero for large books.

### A source page redirects to Marketplace or login

Open that target manually while logged in and confirm your account can access it.

The script deliberately does not attempt to work around access-control redirects.

### An indexed entry appears under Warnings

The script found the link but could not confidently isolate the corresponding entry from the returned page.

Useful information for a bug report includes:

- book URL;
- entry name;
- entry URL;
- the Capture Report warning;
- browser name/version;
- whether the entry opens normally when clicked on D&D Beyond.

Do not attach or publish copyrighted book content in an issue.

### Large blank areas still appear in the PDF

Some D&D Beyond components may bring their own strong print/break styles. First try:

- Scale 95%;
- background graphics enabled;
- browser headers/footers disabled.

If the same component repeatedly causes bad pagination, file an issue naming the component/section and book. The print override can usually be adjusted without changing the extraction logic.

### Images are missing

Possible causes include:

- the image failed to load before printing;
- a new lazy-loading attribute is being used;
- the remote asset requires a request pattern not preserved by the browser preview;
- the source image itself is unavailable to the current session.

Wait until **Print / Save PDF** becomes enabled before printing.

## Privacy and security

- The script runs locally in your browser through Tampermonkey.
- It does not ask for your D&D Beyond password.
- It uses the browser's existing D&D Beyond authenticated session.
- It does not send captured book HTML to this GitHub repository or to an external project server.
- The project contains **no D&D Beyond book content**.

As with any userscript, review the code before installing it and install updates only from a source you trust.

## Project scope

This repository is for the userscript and its extraction/print logic only.

It is **not**:

- an official D&D Beyond feature;
- affiliated with or endorsed by Wizards of the Coast;
- a repository of D&D book PDFs or sourcebook text;
- a mechanism for bypassing account permissions or purchasing requirements.

D&D Beyond and Dungeons & Dragons are trademarks of their respective owners.

## Development notes

The current implementation intentionally favors robust, understandable browser-side JavaScript over a build system. There are no runtime dependencies beyond Tampermonkey and the D&D Beyond page itself.

Important internal concepts:

- `discoverPrimaryPages()` — finds ordinary sourcebook pages.
- `discoverIndexGroups()` — finds likely index/reference sections and logical entry links.
- `fetchDocumentHtml()` — authenticated, retrying, cached document fetch.
- `extractPrimaryPage()` — extracts/cleans normal sourcebook content.
- `extractIndexedEntry()` — attempts fragment, stat-block/entity, heading-range, and article extraction strategies.
- `chooseEntriesToAppend()` — prevents duplicate copies when indexed fragments already live inside included primary pages.
- `rewriteLinks()` — converts captured links to offline navigation.
- `printCss()` — provides print-first pagination rules.
- `buildFinalDocument()` — assembles the preview, indexes, reference material, and capture report.

## Testing changes

When modifying extraction logic, test at least:

1. A normal chapter-heavy sourcebook.
2. A book with a large linked index, especially the Monster Manual.
3. A book containing wide tables.
4. A book with many images.
5. An export with one deliberately inaccessible/broken link to confirm warnings are visible.
6. Physical-print preview, not just on-screen HTML.

Verify that:

- duplicate indexed entries are not appended;
- offline links navigate to the intended captured entry;
- the number of discovered indexed links is plausible;
- unique-document count is much lower than logical-entry count when many fragments share a page;
- no major source pages are missing;
- warning count is understood before printing.

## Contributing

Bug reports and improvements are welcome.

Please do **not** commit or attach copyrighted sourcebook text, screenshots containing large amounts of book text, downloaded PDFs, or other proprietary D&D Beyond content.

A useful issue report contains the URL structure, DOM/selectors if known, console error, entry name, and reproduction steps without reproducing the protected content itself.

## License

The userscript source code in this repository is released under the MIT License. That license applies only to this project's code. It does not grant rights to D&D Beyond content, Dungeons & Dragons content, artwork, trademarks, or any third-party material accessed while using the script.
