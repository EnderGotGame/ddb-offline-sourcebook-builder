// ==UserScript==
// @name         DDB Offline Sourcebook Builder
// @namespace    https://tampermonkey.net/
// @version      0.4.0
// @description  Build a print-ready offline PDF from D&D Beyond sourcebook content your logged-in account can access.
// @author       Brandon / OpenAI
// @match        https://www.dndbeyond.com/sources/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /*
     * DDB Offline Sourcebook Builder v0.4
     *
     * Design goals:
     *  - Works with ordinary sourcebook chapter pages.
     *  - Detects index/reference sections such as "Index of Stat Blocks".
     *  - Preserves #fragment targets instead of throwing them away.
     *  - Fetches each unique HTML document only once.
     *  - Pulls in indexed/reference entries when they are not already part of
     *    an included sourcebook page.
     *  - Rewrites captured D&D Beyond links to offline anchors.
     *  - Produces print-first CSS: natural text flow, clean tables, sensible
     *    stat-block splitting, and no forced page break for every indexed item.
     *
     * This script does not bypass ownership, authentication, paywalls, or DRM.
     * It only requests pages that the current logged-in browser session can open.
     */

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

    const state = {
        running: false,
        cancelled: false,
        fetchCache: new Map(),
        failures: []
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function randomDelay() {
        return CONFIG.minPageDelay +
            Math.random() * (CONFIG.maxPageDelay - CONFIG.minPageDelay);
    }

    function log(...args) {
        if (CONFIG.debug) console.info('[DDB PDF]', ...args);
    }

    function warn(...args) {
        console.warn('[DDB PDF]', ...args);
    }

    function escapeHtml(value = '') {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function slugify(value = '') {
        const out = String(value)
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 120);

        return out || 'entry';
    }

    function cleanBookTitle() {
        return document.title
            .replace(/\s*[-|]\s*D&D Beyond.*$/i, '')
            .trim() || 'D&D Beyond Sourcebook';
    }

    function absoluteUrl(url, base = location.href) {
        if (!url) return '';
        if (/^(data:|blob:|mailto:|javascript:)/i.test(url)) return url;
        try {
            return new URL(url, base).href;
        } catch {
            return url;
        }
    }

    function urlWithoutHash(url) {
        const parsed = new URL(url, location.href);
        parsed.hash = '';
        return parsed.href;
    }

    function normalizeComparableUrl(url) {
        const parsed = new URL(url, location.href);
        parsed.searchParams.delete('utm_source');
        parsed.searchParams.delete('utm_medium');
        parsed.searchParams.delete('utm_campaign');
        return parsed.href;
    }

    function headingLevel(el) {
        if (!el || !/^H[1-6]$/i.test(el.tagName)) return 99;
        return Number(el.tagName.slice(1));
    }

    function elementComesBefore(a, b) {
        if (!a || !b || a === b) return false;
        return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    }

    function isVisibleText(el) {
        return Boolean(el && el.textContent && el.textContent.trim());
    }

    function determineBookRoot() {
        const parts = location.pathname.split('/').filter(Boolean);
        if (parts[0] !== 'sources') return null;
        if (parts[1] === 'dnd' && parts.length >= 3) {
            return '/' + parts.slice(0, 3).join('/');
        }
        if (parts.length >= 2) {
            return '/' + parts.slice(0, 2).join('/');
        }
        return null;
    }

    function isBookLandingPage(bookRoot) {
        const a = location.pathname.replace(/\/+$/, '');
        const b = bookRoot.replace(/\/+$/, '');
        return a === b;
    }

    function isSameBookUrl(url, bookRoot) {
        try {
            const u = new URL(url, location.href);
            return u.origin === location.origin &&
                (u.pathname === bookRoot || u.pathname.startsWith(bookRoot + '/'));
        } catch {
            return false;
        }
    }

    function getMain() {
        return document.querySelector('main') || document.body;
    }

    function findHeadingByText(regex) {
        return [...getMain().querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .find(h => regex.test(h.textContent.trim()));
    }

    function elementsWithinHeadingRange(heading, selector = 'a[href]') {
        if (!heading) return [];

        const main = getMain();
        const allHeadings = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')];
        const level = headingLevel(heading);
        const startIndex = allHeadings.indexOf(heading);

        let boundary = null;
        for (let i = startIndex + 1; i < allHeadings.length; i++) {
            if (headingLevel(allHeadings[i]) <= level) {
                boundary = allHeadings[i];
                break;
            }
        }

        return [...main.querySelectorAll(selector)].filter(el => {
            if (!elementComesBefore(heading, el)) return false;
            if (boundary && !elementComesBefore(el, boundary)) return false;
            return true;
        });
    }

    function findLegacyTocContainer() {
        const selectors = [
            '.compendium-toc-full-text',
            '.compendium-toc',
            '[class*="table-of-contents"]',
            '[class*="TableOfContents"]',
            '[aria-label*="contents" i]'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    function discoverPrimaryPages(bookRoot) {
        let anchors = [];

        const legacyToc = findLegacyTocContainer();
        if (legacyToc) {
            anchors = [...legacyToc.querySelectorAll('a[href]')];
        } else {
            const contentsHeading = findHeadingByText(/^contents$/i);
            if (contentsHeading) {
                anchors = elementsWithinHeadingRange(contentsHeading, 'a[href]');
            }
        }

        if (!anchors.length) {
            anchors = [...getMain().querySelectorAll('a[href]')]
                .filter(a => isSameBookUrl(a.href, bookRoot));
        }

        const seen = new Set();
        const pages = [];

        for (const anchor of anchors) {
            let u;
            try {
                u = new URL(anchor.href, location.href);
            } catch {
                continue;
            }

            if (u.origin !== location.origin) continue;
            if (!isSameBookUrl(u.href, bookRoot)) continue;

            u.hash = '';

            if (u.pathname.replace(/\/+$/, '') === bookRoot.replace(/\/+$/, '')) continue;

            const key = u.href;
            if (seen.has(key)) continue;
            seen.add(key);

            const label = anchor.textContent.trim() ||
                decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'Section');

            pages.push({
                url: key,
                label,
                id: `ddb-page-${pages.length + 1}-${slugify(label)}`
            });
        }

        return pages;
    }

    const INDEX_HEADING_RE =
        /\b(index|stat blocks?|spell descriptions?|creature stat blocks?|monster entries?|magic items?|feats?|background descriptions?|species descriptions?|rules glossary|glossary|reference)\b/i;

    const ALLOWED_REFERENCE_PATHS = [
        '/monsters/',
        '/spells/',
        '/magic-items/',
        '/feats/',
        '/backgrounds/',
        '/species/',
        '/equipment/',
        '/vehicles/'
    ];

    function looksLikeReferenceEntityUrl(u) {
        if (u.origin !== location.origin) return false;
        return ALLOWED_REFERENCE_PATHS.some(prefix => u.pathname.startsWith(prefix));
    }

    function discoverIndexGroups(bookRoot) {
        const main = getMain();
        const candidateHeadings = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .filter(h => INDEX_HEADING_RE.test(h.textContent.trim()));

        const groups = [];
        const globallySeen = new Set();

        for (const heading of candidateHeadings) {
            const anchors = elementsWithinHeadingRange(heading, 'a[href]');
            const entries = [];

            for (const anchor of anchors) {
                if (!isVisibleText(anchor)) continue;

                let u;
                try {
                    u = new URL(anchor.href, location.href);
                } catch {
                    continue;
                }

                const sameBookFragment = isSameBookUrl(u.href, bookRoot) && Boolean(u.hash);
                const externalReference = looksLikeReferenceEntityUrl(u);

                if (!sameBookFragment && !externalReference) continue;

                const label = anchor.textContent.trim();
                if (!label) continue;

                const exact = normalizeComparableUrl(u.href);
                if (globallySeen.has(exact)) continue;
                globallySeen.add(exact);

                entries.push({
                    label,
                    url: exact,
                    fetchUrl: urlWithoutHash(exact),
                    fragment: u.hash || '',
                    outputId: `ddb-entry-${slugify(label)}-${globallySeen.size}`
                });

                if (globallySeen.size >= CONFIG.maxIndexedEntries) break;
            }

            if (entries.length) groups.push({ title: heading.textContent.trim(), entries });
            if (globallySeen.size >= CONFIG.maxIndexedEntries) break;
        }

        return groups;
    }

    function flattenIndexEntries(groups) {
        return groups.flatMap(group => group.entries);
    }

    async function fetchWithTimeout(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

        try {
            return await fetch(url, {
                method: 'GET',
                credentials: 'include',
                redirect: 'follow',
                signal: controller.signal,
                headers: { Accept: 'text/html,application/xhtml+xml' }
            });
        } finally {
            clearTimeout(timer);
        }
    }

    async function fetchDocumentHtml(url) {
        const fetchUrl = urlWithoutHash(url);
        if (state.fetchCache.has(fetchUrl)) return state.fetchCache.get(fetchUrl);

        const promise = (async () => {
            let lastError = null;

            for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
                if (state.cancelled) throw new Error('Cancelled');

                try {
                    const response = await fetchWithTimeout(fetchUrl);

                    if (
                        response.url.includes('/login') ||
                        response.url.includes('/sign-in') ||
                        response.url.includes('marketplace.dndbeyond.com')
                    ) {
                        throw new Error(
                            'D&D Beyond redirected this request to login/Marketplace. ' +
                            'Open the target normally first and verify your account has access.'
                        );
                    }

                    if (response.ok) return await response.text();

                    const retryable = [429, 500, 502, 503, 504].includes(response.status);
                    if (!retryable) throw new Error(`HTTP ${response.status} ${response.statusText}`);

                    let delay = 1400 * attempt;
                    const retryAfter = response.headers.get('Retry-After');
                    if (retryAfter && Number.isFinite(Number(retryAfter))) {
                        delay = Math.max(delay, Number(retryAfter) * 1000);
                    }

                    warn(`HTTP ${response.status}; retrying ${fetchUrl} in ${Math.round(delay)} ms`);
                    await sleep(delay);
                } catch (error) {
                    lastError = error;
                    if (attempt >= CONFIG.maxRetries) break;
                    const delay = 1200 * attempt + Math.random() * 900;
                    warn(`Request attempt ${attempt}/${CONFIG.maxRetries} failed`, fetchUrl, error);
                    await sleep(delay);
                }
            }

            throw lastError || new Error(`Failed to fetch ${fetchUrl}`);
        })();

        state.fetchCache.set(fetchUrl, promise);

        try {
            return await promise;
        } catch (error) {
            state.fetchCache.delete(fetchUrl);
            throw error;
        }
    }

    const ARTICLE_SELECTORS = [
        '.p-article-content',
        '.compendium-content',
        '.ddb-compendium-page',
        '[class*="compendium"][class*="content"]',
        'main article',
        'article',
        'main'
    ];

    function findArticleContent(doc) {
        for (const selector of ARTICLE_SELECTORS) {
            const el = doc.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    function prepareImageElement(img, sourceUrl) {
        const lazyCandidates = [
            img.getAttribute('data-src'),
            img.getAttribute('data-original'),
            img.getAttribute('data-lazy-src'),
            img.getAttribute('data-url')
        ].filter(Boolean);

        let src = img.getAttribute('src') || '';

        if (
            lazyCandidates.length &&
            (!src || src.startsWith('data:image/gif') || /placeholder/i.test(src))
        ) {
            src = lazyCandidates[0];
            img.setAttribute('src', src);
        }

        if (img.getAttribute('src')) {
            img.setAttribute('src', absoluteUrl(img.getAttribute('src'), sourceUrl));
        }

        const srcset = img.getAttribute('srcset');
        if (srcset && !srcset.startsWith('data:')) {
            const converted = srcset
                .split(',')
                .map(candidate => {
                    const pieces = candidate.trim().split(/\s+/);
                    pieces[0] = absoluteUrl(pieces[0], sourceUrl);
                    return pieces.join(' ');
                })
                .join(', ');
            img.setAttribute('srcset', converted);
        }

        img.loading = 'eager';
        img.decoding = 'sync';
    }

    function cleanupContent(content, sourceUrl) {
        const clone = content.cloneNode(true);

        clone.querySelectorAll([
            'script', 'style', 'nav', 'footer', 'button', 'iframe', 'noscript',
            '[role="navigation"]', '[role="banner"]',
            '[class*="advertisement"]', '[class*="ad-container"]'
        ].join(',')).forEach(el => el.remove());

        clone.querySelectorAll('img').forEach(img => prepareImageElement(img, sourceUrl));

        clone.querySelectorAll('source').forEach(source => {
            const src = source.getAttribute('src');
            if (src) source.setAttribute('src', absoluteUrl(src, sourceUrl));

            const srcset = source.getAttribute('srcset');
            if (srcset && !srcset.startsWith('data:')) {
                source.setAttribute(
                    'srcset',
                    srcset.split(',').map(candidate => {
                        const pieces = candidate.trim().split(/\s+/);
                        pieces[0] = absoluteUrl(pieces[0], sourceUrl);
                        return pieces.join(' ');
                    }).join(', ')
                );
            }
        });

        clone.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (!href || href.startsWith('#')) return;
            anchor.setAttribute('href', absoluteUrl(href, sourceUrl));
        });

        clone.querySelectorAll('[style]').forEach(el => {
            const style = el.getAttribute('style');
            if (!style || !style.includes('url(')) return;

            el.setAttribute(
                'style',
                style.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, assetUrl) => {
                    if (/^(data:|blob:)/i.test(assetUrl)) return match;
                    return `url("${absoluteUrl(assetUrl, sourceUrl)}")`;
                })
            );
        });

        return clone;
    }

    function parseHtml(html) {
        return new DOMParser().parseFromString(html, 'text/html');
    }

    function extractPrimaryPage(html, sourceUrl, fallbackTitle) {
        const doc = parseHtml(html);
        const content = findArticleContent(doc);
        if (!content) throw new Error('Could not locate sourcebook article content on this page.');

        const title =
            content.querySelector('h1')?.textContent?.trim() ||
            doc.querySelector('main h1')?.textContent?.trim() ||
            fallbackTitle || sourceUrl;

        return { title, node: cleanupContent(content, sourceUrl) };
    }

    function findFragmentTarget(doc, hash) {
        if (!hash) return null;

        let id;
        try {
            id = decodeURIComponent(hash.replace(/^#/, ''));
        } catch {
            id = hash.replace(/^#/, '');
        }

        if (!id) return null;

        return (
            doc.getElementById(id) ||
            doc.querySelector(`[name="${CSS.escape(id)}"]`) ||
            [...doc.querySelectorAll('[id]')].find(el => el.id.toLowerCase() === id.toLowerCase()) ||
            null
        );
    }

    function nearestUsefulWrapper(target) {
        if (!target) return null;

        const preferred = target.closest([
            '.mon-stat-block',
            '.monster-stat-block',
            '[class*="stat-block"]',
            '[class*="spell-block"]',
            '[class*="item-block"]',
            'article',
            'section'
        ].join(','));

        if (preferred && !['ARTICLE', 'MAIN'].includes(preferred.tagName)) return preferred;
        return null;
    }

    function extractHeadingRangeFromTarget(doc, target) {
        if (!target) return null;

        let heading = null;
        if (/^H[1-6]$/i.test(target.tagName)) {
            heading = target;
        } else {
            heading = target.closest('h1,h2,h3,h4,h5,h6');
        }

        if (!heading) {
            let cursor = target;
            for (let i = 0; i < 6 && cursor; i++) {
                cursor = cursor.nextElementSibling;
                if (cursor && /^H[1-6]$/i.test(cursor.tagName)) {
                    heading = cursor;
                    break;
                }
            }
        }

        if (!heading) return null;

        const level = headingLevel(heading);
        const wrapper = doc.createElement('div');
        let node = heading;

        while (node) {
            if (
                node !== heading &&
                /^H[1-6]$/i.test(node.tagName) &&
                headingLevel(node) <= level
            ) break;

            wrapper.appendChild(node.cloneNode(true));
            node = node.nextElementSibling;
        }

        return wrapper.children.length ? wrapper : null;
    }

    function findEntityBlock(doc, label) {
        const selectors = [
            '.mon-stat-block',
            '.monster-stat-block',
            '[class*="mon-stat-block"]',
            '[class*="monster-stat-block"]',
            '[class*="stat-block"]',
            '[data-testid*="stat-block"]',
            '[class*="spell-block"]',
            '[class*="item-block"]'
        ];

        for (const selector of selectors) {
            const blocks = [...doc.querySelectorAll(selector)];
            if (!blocks.length) continue;
            if (blocks.length === 1) return blocks[0];

            const normalizedLabel = label.trim().toLowerCase();
            const exact = blocks.find(block =>
                block.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim().toLowerCase() === normalizedLabel
            );
            if (exact) return exact;
        }

        return null;
    }

    function findHeadingByLabel(doc, label) {
        const needle = label.trim().toLowerCase();
        return [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .find(h => h.textContent.trim().toLowerCase() === needle);
    }

    function extractIndexedEntry(html, entry) {
        const doc = parseHtml(html);

        if (entry.fragment) {
            const target = findFragmentTarget(doc, entry.fragment);
            if (target) {
                const wrapper = nearestUsefulWrapper(target);
                if (wrapper) return cleanupContent(wrapper, entry.url);

                const range = extractHeadingRangeFromTarget(doc, target);
                if (range) return cleanupContent(range, entry.url);
            }
        }

        const entity = findEntityBlock(doc, entry.label);
        if (entity) return cleanupContent(entity, entry.url);

        const heading = findHeadingByLabel(doc, entry.label);
        if (heading) {
            const range = extractHeadingRangeFromTarget(doc, heading);
            if (range) return cleanupContent(range, entry.url);
        }

        if (!entry.fragment) {
            const article = findArticleContent(doc);
            if (article) return cleanupContent(article, entry.url);
        }

        throw new Error(`Could not isolate indexed entry "${entry.label}"`);
    }

    function buildPageMaps(primaryPages, indexEntries) {
        const pageMap = new Map();
        const exactEntryMap = new Map();

        for (const page of primaryPages) {
            pageMap.set(urlWithoutHash(page.url), `#${page.id}`);
        }

        for (const entry of indexEntries) {
            exactEntryMap.set(normalizeComparableUrl(entry.url), `#${entry.outputId}`);
        }

        return { pageMap, exactEntryMap };
    }

    function rewriteLinks(root, sourceUrl, pageMap, exactEntryMap, entriesIncludedByPage) {
        root.querySelectorAll('a[href]').forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (!href || /^(mailto:|javascript:)/i.test(href)) return;

            let u;
            try {
                u = new URL(href, sourceUrl);
            } catch {
                return;
            }

            const exact = normalizeComparableUrl(u.href);

            if (exactEntryMap.has(exact) && !entriesIncludedByPage.has(exact)) {
                anchor.setAttribute('href', exactEntryMap.get(exact));
                return;
            }

            const base = urlWithoutHash(u.href);

            if (u.hash && pageMap.has(base)) {
                anchor.setAttribute('href', u.hash);
                return;
            }

            if (!u.hash && pageMap.has(base)) {
                anchor.setAttribute('href', pageMap.get(base));
            }
        });
    }

    function currentStylesheetLinks() {
        if (!CONFIG.includeSiteCss) return '';

        const hrefs = new Set();
        document.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
            try {
                hrefs.add(new URL(link.href, location.href).href);
            } catch {
                // ignore
            }
        });

        return [...hrefs]
            .map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
            .join('\n');
    }

    function printCss() {
        return `
<style>
    :root { color-scheme: light; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { background: #fff !important; }

    body {
        margin: 0 auto;
        max-width: 8in;
        padding: 0.3in;
        color: #111 !important;
        font-size: 10.5pt;
        line-height: 1.36;
        overflow: visible !important;
    }

    .ddb-pdf-toolbar {
        position: sticky;
        top: 0;
        z-index: 2147483647;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin: -0.3in -0.3in 18px;
        padding: 10px 12px;
        background: #222;
        color: #fff;
        font-family: Arial, sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,.25);
    }

    .ddb-pdf-toolbar button {
        padding: 8px 12px;
        cursor: pointer;
        font-weight: 700;
    }

    .ddb-pdf-toolbar .ddb-status {
        margin-left: auto;
        font-size: 9pt;
    }

    .ddb-cover {
        min-height: 8.7in;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        break-after: page;
        page-break-after: always;
    }

    .ddb-cover h1 {
        font-size: 30pt;
        line-height: 1.08;
        margin: 0 0 20pt;
    }

    .ddb-cover .ddb-source {
        margin-top: 20pt;
        max-width: 90%;
        font: 8.5pt/1.35 Arial, sans-serif;
        opacity: .65;
        overflow-wrap: anywhere;
    }

    .ddb-generated-toc {
        break-after: page;
        page-break-after: always;
    }

    .ddb-generated-toc ol,
    .ddb-generated-index ul { padding-left: 1.35rem; }

    .ddb-generated-toc li,
    .ddb-generated-index li { margin: .16rem 0; }

    .ddb-generated-toc a,
    .ddb-generated-index a {
        color: inherit !important;
        text-decoration: none !important;
    }

    .ddb-major-page {
        clear: both;
        width: 100%;
        break-inside: auto;
        page-break-inside: auto;
        ${CONFIG.majorPagesStartNewPage ? 'break-before: page; page-break-before: always;' : ''}
    }

    .ddb-indexed-material {
        clear: both;
        break-before: page;
        page-break-before: always;
    }

    .ddb-index-entry {
        clear: both;
        break-before: auto;
        page-break-before: auto;
        break-inside: auto;
        page-break-inside: auto;
        margin-top: 1.2em;
    }

    .ddb-index-entry + .ddb-index-entry { margin-top: 1.6em; }
    .ddb-entry-title { margin-top: 1.2em; }

    p { orphans: 3; widows: 3; }

    h1, h2, h3, h4, h5, h6 {
        break-after: avoid-page;
        page-break-after: avoid;
        orphans: 3;
        widows: 3;
    }

    h1 + *, h2 + *, h3 + *, h4 + *, h5 + *, h6 + * {
        break-before: avoid-page;
        page-break-before: avoid;
    }

    ul, ol { break-inside: auto; page-break-inside: auto; }
    li { break-inside: avoid-page; page-break-inside: avoid; }
    blockquote, aside { break-inside: auto; page-break-inside: auto; }

    blockquote > p,
    aside > p { break-inside: avoid-page; page-break-inside: avoid; }

    figure {
        max-width: 100% !important;
        break-inside: avoid-page;
        page-break-inside: avoid;
        margin-left: auto;
        margin-right: auto;
    }

    img, picture, svg, canvas {
        max-width: 100% !important;
        height: auto !important;
    }

    figcaption {
        text-align: center;
        break-before: avoid-page;
        page-break-before: avoid;
    }

    table {
        width: 100%;
        max-width: 100%;
        border-collapse: collapse;
        break-inside: auto;
        page-break-inside: auto;
    }

    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr, th, td { break-inside: avoid-page; page-break-inside: avoid; }

    pre, code {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .mon-stat-block,
    .monster-stat-block,
    [class*="mon-stat-block"],
    [class*="monster-stat-block"],
    [class*="stat-block"] {
        break-inside: auto !important;
        page-break-inside: auto !important;
    }

    .mon-stat-block p,
    .monster-stat-block p,
    [class*="stat-block"] p,
    .mon-stat-block li,
    .monster-stat-block li,
    [class*="stat-block"] li {
        break-inside: avoid-page;
        page-break-inside: avoid;
    }

    .compendium-image-left,
    .monster-image-left {
        float: left;
        margin: .25rem 1rem .5rem 0;
    }

    .compendium-image-right,
    .monster-image-right {
        float: right;
        margin: .25rem 0 .5rem 1rem;
    }

    .compendium-center-banner-img { width: 100% !important; }

    .ddb-error {
        margin: 1rem 0;
        padding: .75rem;
        border: 1px solid #999;
        font-family: Arial, sans-serif;
        break-inside: avoid-page;
    }

    .ddb-report {
        break-before: page;
        page-break-before: always;
        font-family: Arial, sans-serif;
        font-size: 9pt;
    }

    .ddb-report table { width: auto; }

    @page {
        size: Letter;
        margin: 0.62in 0.58in 0.68in;
    }

    @media print {
        html, body {
            max-width: none !important;
            width: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            overflow: visible !important;
        }

        .ddb-pdf-toolbar { display: none !important; }

        a {
            color: inherit !important;
            text-decoration: none !important;
        }
    }
</style>`;
    }

    function findCoverArt() {
        const link = [...document.querySelectorAll('a[href]')]
            .find(a => /view cover art/i.test(a.textContent.trim()));
        return link?.href || '';
    }

    function buildGeneratedIndex(groups, includedEntries) {
        if (!groups.length) return '';

        const includedSet = new Set(includedEntries.map(e => normalizeComparableUrl(e.url)));

        return groups.map(group => {
            const items = group.entries.map(entry => {
                let href;
                if (includedSet.has(normalizeComparableUrl(entry.url))) {
                    href = `#${entry.outputId}`;
                } else if (entry.fragment) {
                    href = entry.fragment;
                } else {
                    href = entry.url;
                }

                return `<li><a href="${escapeHtml(href)}">${escapeHtml(entry.label)}</a></li>`;
            }).join('');

            return `
<section class="ddb-generated-index">
    <h2>${escapeHtml(group.title)}</h2>
    <ul>${items}</ul>
</section>`;
        }).join('\n');
    }

    function buildFinalDocument({
        bookTitle,
        bookRoot,
        primaryPages,
        primaryResults,
        indexGroups,
        includedEntries,
        entryResults,
        entriesIncludedByPage,
        pageMap,
        exactEntryMap
    }) {
        for (const result of primaryResults) {
            if (!result?.node) continue;
            rewriteLinks(result.node, result.sourceUrl, pageMap, exactEntryMap, entriesIncludedByPage);
        }

        for (const result of entryResults) {
            if (!result?.node) continue;
            rewriteLinks(result.node, result.sourceUrl, pageMap, exactEntryMap, entriesIncludedByPage);
        }

        const tocItems = primaryPages.map((page, i) => {
            const title = primaryResults[i]?.title || page.label;
            return `<li><a href="#${escapeHtml(page.id)}">${escapeHtml(title)}</a></li>`;
        }).join('');

        const primaryHtml = primaryPages.map((page, i) => {
            const result = primaryResults[i];

            if (!result?.node) {
                return `
<section id="${escapeHtml(page.id)}" class="ddb-major-page">
    <div class="ddb-error">
        <h1>${escapeHtml(page.label)}</h1>
        <p>This sourcebook page could not be captured.</p>
        <p>${escapeHtml(result?.error || 'Unknown error')}</p>
        <p><a href="${escapeHtml(page.url)}">${escapeHtml(page.url)}</a></p>
    </div>
</section>`;
            }

            return `
<section id="${escapeHtml(page.id)}" class="ddb-major-page" data-source-url="${escapeHtml(page.url)}">
${result.node.innerHTML}
</section>`;
        }).join('\n');

        const generatedIndex = buildGeneratedIndex(indexGroups, includedEntries);

        const indexedHtml = includedEntries.length ? `
<section class="ddb-indexed-material">
    <h1>Indexed Reference Material</h1>
    <p>
        These entries were linked by the sourcebook but were not already contained
        in one of the captured sourcebook pages. They are included here so the
        generated PDF remains useful offline.
    </p>
</section>
${includedEntries.map((entry, i) => {
            const result = entryResults[i];

            if (!result?.node) {
                return `
<section id="${escapeHtml(entry.outputId)}" class="ddb-index-entry">
    <div class="ddb-error">
        <h2>${escapeHtml(entry.label)}</h2>
        <p>This indexed entry could not be isolated.</p>
        <p>${escapeHtml(result?.error || 'Unknown error')}</p>
        <p><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a></p>
    </div>
</section>`;
            }

            return `
<section id="${escapeHtml(entry.outputId)}" class="ddb-index-entry" data-source-url="${escapeHtml(entry.url)}">
${result.node.innerHTML}
</section>`;
        }).join('\n')}` : '';

        const allFailures = [
            ...primaryResults.filter(r => r?.error).map(r => ({ type: 'Page', name: r.label, error: r.error })),
            ...entryResults.filter(r => r?.error).map(r => ({ type: 'Entry', name: r.label, error: r.error }))
        ];

        const reportRows = [
            ['Primary sourcebook pages discovered', primaryPages.length],
            ['Indexed/reference links discovered', flattenIndexEntries(indexGroups).length],
            ['Indexed entries appended', includedEntries.length],
            ['Unique HTML documents requested', state.fetchCache.size],
            ['Capture failures', allFailures.length]
        ].map(([a, b]) => `<tr><th>${escapeHtml(a)}</th><td>${escapeHtml(b)}</td></tr>`).join('');

        const failureList = allFailures.length
            ? `<h2>Warnings</h2><ul>${allFailures.map(f =>
                `<li><strong>${escapeHtml(f.type)}: ${escapeHtml(f.name || '')}</strong> — ${escapeHtml(f.error)}</li>`
              ).join('')}</ul>`
            : '<p>No capture failures were reported.</p>';

        const coverUrl = findCoverArt();

        return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(bookTitle)}</title>
    ${currentStylesheetLinks()}
    ${printCss()}
</head>
<body>
    <div class="ddb-pdf-toolbar">
        <button id="ddbPrint">Print / Save PDF</button>
        <button id="ddbClose">Close</button>
        <span class="ddb-status">
            ${primaryPages.length} pages •
            ${flattenIndexEntries(indexGroups).length} indexed links •
            ${allFailures.length} warnings
        </span>
    </div>

    <section class="ddb-cover">
        <h1>${escapeHtml(bookTitle)}</h1>
        ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(bookTitle)} cover">` : ''}
        <div class="ddb-source">
            Built from sourcebook content accessible to the currently logged-in D&D Beyond account.<br>
            ${escapeHtml(location.origin + bookRoot)}
        </div>
    </section>

    <section class="ddb-generated-toc">
        <h1>Contents</h1>
        <ol>${tocItems}</ol>
        ${generatedIndex}
    </section>

    ${primaryHtml}
    ${indexedHtml}

    <section class="ddb-report">
        <h1>Capture Report</h1>
        <table>${reportRows}</table>
        ${failureList}
    </section>
</body>
</html>`;
    }

    async function waitForAssets(preview) {
        const doc = preview.document;

        const imageWaits = [...doc.images].map(img => {
            if (img.complete) return Promise.resolve();

            return new Promise(resolve => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
                setTimeout(resolve, 15000);
            });
        });

        await Promise.allSettled(imageWaits);

        try {
            if (doc.fonts?.ready) {
                await Promise.race([doc.fonts.ready, sleep(10000)]);
            }
        } catch {
            // Fonts are helpful but not required.
        }
    }

    function chooseEntriesToAppend(indexEntries, primaryPages) {
        const primaryBaseUrls = new Set(primaryPages.map(p => urlWithoutHash(p.url)));
        const entriesIncludedByPage = new Set();
        const append = [];

        for (const entry of indexEntries) {
            const exact = normalizeComparableUrl(entry.url);

            if (entry.fragment && primaryBaseUrls.has(entry.fetchUrl)) {
                entriesIncludedByPage.add(exact);
                continue;
            }

            append.push(entry);
        }

        return { append, entriesIncludedByPage };
    }

    function makeButton(text) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        Object.assign(button.style, {
            cursor: 'pointer',
            padding: '9px 13px',
            fontWeight: '700'
        });
        return button;
    }

    const bookRoot = determineBookRoot();

    if (!bookRoot || !isBookLandingPage(bookRoot)) {
        log('Open the main landing/Contents page of a sourcebook to use the builder.');
        return;
    }

    const panel = document.createElement('div');
    Object.assign(panel.style, {
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        zIndex: '2147483647',
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        padding: '10px',
        borderRadius: '8px',
        background: '#202020',
        color: '#fff',
        boxShadow: '0 3px 16px rgba(0,0,0,.4)',
        fontFamily: 'Arial, sans-serif'
    });

    const generateButton = makeButton('Build Offline PDF');
    const cancelButton = makeButton('Cancel');
    cancelButton.disabled = true;

    const miniStatus = document.createElement('span');
    miniStatus.textContent = 'Ready';
    Object.assign(miniStatus.style, {
        fontSize: '12px',
        maxWidth: '220px'
    });

    panel.append(generateButton, cancelButton, miniStatus);
    document.body.appendChild(panel);

    cancelButton.addEventListener('click', () => {
        state.cancelled = true;
        cancelButton.disabled = true;
        cancelButton.textContent = 'Cancelling…';
    });

    generateButton.addEventListener('click', async () => {
        if (state.running) return;

        state.running = true;
        state.cancelled = false;
        state.fetchCache.clear();
        state.failures = [];

        generateButton.disabled = true;
        cancelButton.disabled = false;
        cancelButton.textContent = 'Cancel';

        const preview = window.open('about:blank', '_blank');

        if (!preview) {
            alert(
                'The browser blocked the preview tab. Allow popups for www.dndbeyond.com, then try again.'
            );
            state.running = false;
            generateButton.disabled = false;
            cancelButton.disabled = true;
            return;
        }

        preview.document.open();
        preview.document.write(`<!doctype html>
<html>
<head><title>Building sourcebook…</title></head>
<body style="font-family:Arial,sans-serif;padding:40px">
    <h1>Building sourcebook…</h1>
    <p id="ddbBuildStatus">Discovering book structure…</p>
    <p>Leave the original D&D Beyond tab open until this finishes.</p>
</body>
</html>`);
        preview.document.close();

        const setStatus = (text) => {
            miniStatus.textContent = text;
            try {
                const el = preview.document.getElementById('ddbBuildStatus');
                if (el) el.textContent = text;
            } catch {
                // preview may have been closed
            }
        };

        try {
            const bookTitle = cleanBookTitle();
            const primaryPages = discoverPrimaryPages(bookRoot);
            const indexGroups = discoverIndexGroups(bookRoot);
            const indexEntries = flattenIndexEntries(indexGroups);

            log('Primary pages:', primaryPages);
            log('Index groups:', indexGroups);

            if (!primaryPages.length) {
                throw new Error(
                    'No sourcebook pages were discovered. Make sure you are on the book\'s main Contents page.'
                );
            }

            const { append: includedEntries, entriesIncludedByPage } =
                chooseEntriesToAppend(indexEntries, primaryPages);

            const { pageMap, exactEntryMap } =
                buildPageMaps(primaryPages, includedEntries);

            const primaryResults = new Array(primaryPages.length);

            for (let i = 0; i < primaryPages.length; i++) {
                if (state.cancelled) throw new Error('Download cancelled.');

                const page = primaryPages[i];
                setStatus(`Book pages ${i + 1}/${primaryPages.length}: ${page.label}`);

                try {
                    const html = await fetchDocumentHtml(page.url);
                    const extracted = extractPrimaryPage(html, page.url, page.label);

                    primaryResults[i] = {
                        ...extracted,
                        sourceUrl: page.url,
                        label: page.label
                    };
                } catch (error) {
                    primaryResults[i] = {
                        error: error?.message || String(error),
                        sourceUrl: page.url,
                        label: page.label
                    };
                    warn('Primary page failed:', page.url, error);
                }

                if (i < primaryPages.length - 1) {
                    await sleep(randomDelay());
                }
            }

            const entryResults = new Array(includedEntries.length);

            for (let i = 0; i < includedEntries.length; i++) {
                if (state.cancelled) throw new Error('Download cancelled.');

                const entry = includedEntries[i];
                setStatus(`Indexed entries ${i + 1}/${includedEntries.length}: ${entry.label}`);

                const wasAlreadyCached = state.fetchCache.has(entry.fetchUrl);

                try {
                    const html = await fetchDocumentHtml(entry.fetchUrl);
                    const node = extractIndexedEntry(html, entry);

                    entryResults[i] = {
                        node,
                        sourceUrl: entry.url,
                        label: entry.label
                    };
                } catch (error) {
                    entryResults[i] = {
                        error: error?.message || String(error),
                        sourceUrl: entry.url,
                        label: entry.label
                    };
                    warn('Indexed entry failed:', entry.url, error);
                }

                if (!wasAlreadyCached && i < includedEntries.length - 1) {
                    await sleep(randomDelay());
                }
            }

            if (state.cancelled) throw new Error('Download cancelled.');

            setStatus('Building print-ready book…');

            const finalHtml = buildFinalDocument({
                bookTitle,
                bookRoot,
                primaryPages,
                primaryResults,
                indexGroups,
                includedEntries,
                entryResults,
                entriesIncludedByPage,
                pageMap,
                exactEntryMap
            });

            preview.document.open();
            preview.document.write(finalHtml);
            preview.document.close();

            const printButton = preview.document.getElementById('ddbPrint');
            const closeButton = preview.document.getElementById('ddbClose');

            if (printButton) {
                printButton.disabled = true;
                printButton.textContent = 'Loading images…';
            }

            if (closeButton) {
                closeButton.addEventListener('click', () => preview.close());
            }

            await waitForAssets(preview);

            if (printButton) {
                printButton.disabled = false;
                printButton.textContent = 'Print / Save PDF';
                printButton.addEventListener('click', () => {
                    preview.focus();
                    preview.print();
                });
            }

            const failureCount =
                primaryResults.filter(r => r?.error).length +
                entryResults.filter(r => r?.error).length;

            setStatus(
                `Ready: ${primaryPages.length} pages, ` +
                `${indexEntries.length} indexed links, ${failureCount} warnings`
            );

            log('Complete', {
                primaryPages: primaryPages.length,
                indexedLinks: indexEntries.length,
                appendedEntries: includedEntries.length,
                uniqueDocuments: state.fetchCache.size,
                failures: failureCount
            });
        } catch (error) {
            warn(error);

            try {
                const el = preview.document.getElementById('ddbBuildStatus');
                if (el) {
                    el.textContent = error?.message || String(error);
                    el.style.color = 'darkred';
                }
            } catch {
                // ignored
            }

            miniStatus.textContent = 'Failed';
        } finally {
            state.running = false;
            generateButton.disabled = false;
            generateButton.textContent = 'Build Offline PDF';
            cancelButton.disabled = true;
            cancelButton.textContent = 'Cancel';
        }
    });
})();
