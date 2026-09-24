// ==UserScript==
// @name         DDB Offline Sourcebook Builder
// @namespace    https://tampermonkey.net/
// @version      0.8.0
// @description  Build a print-ready offline PDF from D&D Beyond sourcebooks your logged-in account can access.
// @author       Brandon / OpenAI
// @match        https://www.dndbeyond.com/sources/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

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

    const state = {
        running: false,
        cancelled: false,
        fetchCache: new Map()
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const log = (...a) => CONFIG.debug && console.info('[DDB PDF]', ...a);
    const warn = (...a) => console.warn('[DDB PDF]', ...a);
    const delay = () => CONFIG.minPageDelay + Math.random() * (CONFIG.maxPageDelay - CONFIG.minPageDelay);

    function escapeHtml(v = '') {
        return String(v)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function slugify(v = '') {
        return String(v)
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 100) || 'section';
    }

    function absoluteUrl(url, base = location.href) {
        if (!url || /^(data:|blob:|mailto:|javascript:)/i.test(url)) return url || '';
        try { return new URL(url, base).href; } catch { return url; }
    }

    function withoutHash(url) {
        const u = new URL(url, location.href);
        u.hash = '';
        return u.href;
    }

    function comparableUrl(url) {
        const u = new URL(url, location.href);
        ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => u.searchParams.delete(k));
        return u.href;
    }

    function cleanBookTitle() {
        for (const el of [
            document.querySelector('main h1'),
            document.querySelector('.compendium-toc-full-header h1')
        ]) {
            const text = el?.textContent?.trim();
            if (text && !/^sources$/i.test(text) && text.length < 140) return text;
        }
        return document.title.split(/\s+-\s+/)[0]?.trim() || 'D&D Beyond Sourcebook';
    }

    function determineBookRoot() {
        const p = location.pathname.split('/').filter(Boolean);
        if (p[0] !== 'sources') return null;
        if (p[1] === 'dnd') return p[2] ? '/' + p.slice(0, 3).join('/') : null;
        if (p[1]) return '/' + p.slice(0, 2).join('/');
        return null;
    }

    function determineBookRoots(root) {
        if (!root) return [];
        const parts = root.split('/').filter(Boolean);
        const roots = new Set([root.replace(/\/+$/, '')]);
        let slug = null;
        if (parts[0] === 'sources' && parts[1] === 'dnd' && parts[2]) slug = parts[2];
        else if (parts[0] === 'sources' && parts[1]) slug = parts[1];
        if (slug) {
            roots.add(`/sources/${slug}`);
            roots.add(`/sources/dnd/${slug}`);
        }
        return [...roots];
    }

    function pathBelongsToBook(pathname, bookRoots) {
        const path = pathname.replace(/\/+$/, '');
        return bookRoots.some(root => path === root || path.startsWith(root + '/'));
    }

    function isBookRootPath(pathname, bookRoots) {
        const path = pathname.replace(/\/+$/, '');
        return bookRoots.some(root => path === root);
    }

    function isLandingPage(root) {
        return location.pathname.replace(/\/+$/, '') === root.replace(/\/+$/, '');
    }

    function isSameBook(url, bookRoots) {
        try {
            const u = new URL(url, location.href);
            return u.origin === location.origin && pathBelongsToBook(u.pathname, bookRoots);
        } catch { return false; }
    }

    function mainEl() { return document.querySelector('main') || document.body; }
    function headingLevel(el) { return /^H[1-6]$/.test(el?.tagName || '') ? Number(el.tagName.slice(1)) : 99; }

    function elementsAfterHeading(heading, selector = 'a[href]') {
        if (!heading) return [];
        const main = mainEl();
        const headings = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')];
        const level = headingLevel(heading);
        const start = headings.indexOf(heading);
        let boundary = null;
        for (let i = start + 1; i < headings.length; i++) {
            if (headingLevel(headings[i]) <= level) { boundary = headings[i]; break; }
        }
        return [...main.querySelectorAll(selector)].filter(el => {
            const afterStart = heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
            const beforeBoundary = !boundary || (el.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING);
            return Boolean(afterStart && beforeBoundary);
        });
    }

    function findTocLinks() {
        for (const sel of [
            '.compendium-toc-full-text',
            '.compendium-toc',
            '[class*="table-of-contents"]',
            '[class*="TableOfContents"]',
            '[aria-label*="contents" i]'
        ]) {
            const el = document.querySelector(sel);
            if (el) return [...el.querySelectorAll('a[href]')];
        }
        const h = [...mainEl().querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .find(x => /^contents$/i.test(x.textContent.trim()));
        return h ? elementsAfterHeading(h) : [];
    }

    function discoverPrimaryPages(root, bookRoots) {
        let links = findTocLinks();
        if (!links.length) links = [...mainEl().querySelectorAll('a[href]')].filter(a => isSameBook(a.href, bookRoots));

        const seen = new Set();
        const pages = [];
        for (const a of links) {
            let u;
            try { u = new URL(a.href, location.href); } catch { continue; }
            if (!isSameBook(u.href, bookRoots)) continue;
            u.hash = '';
            if (isBookRootPath(u.pathname, bookRoots)) continue;
            if (seen.has(u.href)) continue;
            seen.add(u.href);
            const label = a.textContent.trim() || decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'Section');
            pages.push({ url: u.href, label, id: `ddb-page-${pages.length + 1}-${slugify(label)}` });
        }
        return pages;
    }

    const INDEX_HEADING_RE = /\b(index|stat blocks?|spell descriptions?|creature stat blocks?|monster entries?|creatures?|npcs?|sidekicks?|magic items?|feats?|background descriptions?|species descriptions?|rules glossary|glossary|reference)\b/i;
    const REFERENCE_PATHS = ['/monsters/', '/spells/', '/magic-items/', '/feats/', '/backgrounds/', '/species/', '/equipment/', '/vehicles/'];

    function discoverIndexGroups(root, bookRoots) {
        const groups = [];
        const seen = new Set();
        const headings = [...mainEl().querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .filter(h => INDEX_HEADING_RE.test(h.textContent.trim()));

        for (const h of headings) {
            const entries = [];
            for (const a of elementsAfterHeading(h)) {
                const label = a.textContent.trim();
                if (!label) continue;
                let u;
                try { u = new URL(a.href, location.href); } catch { continue; }
                const sameBookFragment = isSameBook(u.href, bookRoots) && Boolean(u.hash);
                const referencePage = u.origin === location.origin && REFERENCE_PATHS.some(p => u.pathname.startsWith(p));
                if (!sameBookFragment && !referencePage) continue;

                const exact = comparableUrl(u.href);
                if (seen.has(exact)) continue;
                seen.add(exact);
                entries.push({ label, url: exact, fetchUrl: withoutHash(exact), fragment: u.hash || '' });
                if (seen.size >= CONFIG.maxIndexedLinks) break;
            }
            if (entries.length) groups.push({ title: h.textContent.trim(), entries });
            if (seen.size >= CONFIG.maxIndexedLinks) break;
        }
        return groups;
    }

    const flattenEntries = groups => groups.flatMap(g => g.entries);

    function buildReferenceDocuments(entries, primaryPages) {
        const primary = new Set(primaryPages.map(p => withoutHash(p.url)));
        const byUrl = new Map();
        for (const entry of entries) {
            if (primary.has(entry.fetchUrl)) continue;
            if (!byUrl.has(entry.fetchUrl)) {
                byUrl.set(entry.fetchUrl, {
                    url: entry.fetchUrl,
                    label: entry.label,
                    id: `ddb-ref-${byUrl.size + 1}-${slugify(entry.label)}`,
                    entries: []
                });
            }
            byUrl.get(entry.fetchUrl).entries.push(entry);
        }
        return [...byUrl.values()];
    }

    async function fetchWithTimeout(url) {
        const c = new AbortController();
        const timer = setTimeout(() => c.abort(), CONFIG.requestTimeoutMs);
        try {
            return await fetch(url, {
                credentials: 'include',
                redirect: 'follow',
                signal: c.signal,
                headers: { Accept: 'text/html,application/xhtml+xml' }
            });
        } finally { clearTimeout(timer); }
    }

    async function fetchHtml(url) {
        const key = withoutHash(url);
        if (state.fetchCache.has(key)) return state.fetchCache.get(key);

        const promise = (async () => {
            let last;
            for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
                if (state.cancelled) throw new Error('Cancelled');
                try {
                    const r = await fetchWithTimeout(key);
                    if (/\/login|\/sign-in|marketplace\.dndbeyond\.com/i.test(r.url)) {
                        throw new Error('Redirected to login/Marketplace; verify this account can open the target normally.');
                    }
                    if (r.ok) return await r.text();
                    if (![429, 500, 502, 503, 504].includes(r.status)) throw new Error(`HTTP ${r.status} ${r.statusText}`);
                    let wait = 1400 * attempt;
                    const retryAfter = Number(r.headers.get('Retry-After'));
                    if (Number.isFinite(retryAfter) && retryAfter > 0) wait = Math.max(wait, retryAfter * 1000);
                    await sleep(wait);
                } catch (e) {
                    last = e;
                    if (attempt === CONFIG.maxRetries) break;
                    await sleep(1200 * attempt + Math.random() * 900);
                }
            }
            throw last || new Error(`Failed to fetch ${key}`);
        })();

        state.fetchCache.set(key, promise);
        try { return await promise; }
        catch (e) { state.fetchCache.delete(key); throw e; }
    }

    function parse(html) { return new DOMParser().parseFromString(html, 'text/html'); }

    function findArticle(doc) {
        for (const sel of [
            '.p-article-content', '.compendium-content', '.ddb-compendium-page',
            '[class*="compendium"][class*="content"]', 'main article', 'article', 'main'
        ]) {
            const el = doc.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    function normalizeAssets(root, sourceUrl) {
        root.querySelectorAll('img').forEach(img => {
            const lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src');
            let src = img.getAttribute('src') || '';
            if (lazy && (!src || /^data:image\/gif/i.test(src) || /placeholder/i.test(src))) img.setAttribute('src', lazy);
            if (img.getAttribute('src')) img.setAttribute('src', absoluteUrl(img.getAttribute('src'), sourceUrl));
            const srcset = img.getAttribute('srcset');
            if (srcset && !srcset.startsWith('data:')) {
                img.setAttribute('srcset', srcset.split(',').map(x => {
                    const p = x.trim().split(/\s+/); p[0] = absoluteUrl(p[0], sourceUrl); return p.join(' ');
                }).join(', '));
            }
            img.loading = 'eager';
            img.decoding = 'sync';
        });

        root.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (href && !href.startsWith('#')) a.setAttribute('href', absoluteUrl(href, sourceUrl));
        });
    }

    function cleanupContent(content, sourceUrl) {
        const clone = content.cloneNode(true);
        clone.querySelectorAll('script,style,nav,footer,button,iframe,noscript,[role="navigation"],[role="banner"],[class*="advertisement"],[class*="ad-container"]')
            .forEach(el => el.remove());
        normalizeAssets(clone, sourceUrl);
        return clone;
    }

    function looksLikeArtistCredit(el) {
        if (!el || !['P', 'DIV', 'SPAN', 'FIGCAPTION'].includes(el.tagName)) return false;
        const t = el.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (!t || t.length > 80 || t.split(/\s+/).length > 7 || /[.!?;:]/.test(t)) return false;
        if (/\b(AC|HP|CR|Speed|Action|Trait|Habitat|Treasure|Language|Immunity|Resistance)\b/i.test(t)) return false;
        return /[A-Za-z]/.test(t);
    }

    function groupArtwork(root) {
        const done = new Set();
        for (const img of [...root.querySelectorAll('img')]) {
            let art = img.closest('figure') || img.closest('picture') || img;
            if (done.has(art) || art.closest('.ddb-art-block')) continue;
            done.add(art);
            const prev = art.previousElementSibling;
            if (!looksLikeArtistCredit(prev)) continue;
            const wrap = root.ownerDocument.createElement('div');
            wrap.className = 'ddb-art-block';
            art.parentNode.insertBefore(wrap, prev);
            wrap.append(prev, art);
        }
    }

    function namespaceAnchors(root, prefix) {
        const map = new Map();
        root.querySelectorAll('[id]').forEach(el => {
            const old = el.id;
            if (!old) return;
            const next = `${prefix}--${old}`;
            map.set(`#${old}`, `#${next}`);
            try { map.set(`#${decodeURIComponent(old)}`, `#${next}`); } catch {}
            el.id = next;
        });
        root.querySelectorAll('a[name]').forEach(el => {
            const old = el.getAttribute('name');
            if (!old) return;
            const next = `${prefix}--${old}`;
            map.set(`#${old}`, `#${next}`);
            el.setAttribute('name', next);
            if (!el.id) el.id = next;
        });
        root.querySelectorAll('a[href^="#"]').forEach(a => {
            const h = a.getAttribute('href');
            if (map.has(h)) a.setAttribute('href', map.get(h));
        });
        return map;
    }


    function normalizeMinus(value = '') {
        return String(value).replace(/[−–—]/g, '-');
    }

    function parseAbilityRowsFromTable(table) {
        const text = normalizeMinus(table.textContent || '').replace(/\s+/g, ' ').trim();
        const rows = [];
        const re = /\b(Str|Dex|Con|Int|Wis|Cha)\b\s*(\d+)\s*([+-]\d+)\s*([+-]\d+)/gi;
        let match;
        while ((match = re.exec(text)) !== null) {
            rows.push({
                ability: match[1].toUpperCase(),
                score: match[2],
                mod: match[3],
                save: match[4]
            });
        }
        return rows;
    }

    function buildAbilityTable(doc, rows) {
        const order = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
        const byAbility = new Map(rows.map(r => [r.ability, r]));
        if (!order.every(a => byAbility.has(a))) return null;

        const table = doc.createElement('table');
        table.className = 'ddb-ability-table';

        const thead = doc.createElement('thead');
        const headRow = doc.createElement('tr');
        headRow.innerHTML = '<th scope="col">&nbsp;</th>' + order.map(a => `<th scope="col">${a}</th>`).join('');
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = doc.createElement('tbody');
        for (const [label, key] of [['Score', 'score'], ['Mod', 'mod'], ['Save', 'save']]) {
            const tr = doc.createElement('tr');
            tr.innerHTML = `<th scope="row">${label}</th>` + order.map(a => `<td>${byAbility.get(a)[key]}</td>`).join('');
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        return table;
    }

    function classifyOrdinaryTables(root) {
        for (const table of root.querySelectorAll('table')) {
            table.classList.add('ddb-print-table');
            const text = normalizeMinus(table.textContent || '').replace(/\s+/g, ' ').trim();
            const rowCount = table.rows?.length || table.querySelectorAll('tr').length;

            if (rowCount > 0 && rowCount <= 12) {
                table.classList.add('ddb-short-table');

                // Keep a nearby table title with a compact table when practical.
                const previous = table.previousElementSibling;
                if (previous && /^H[1-6]$/.test(previous.tagName)) {
                    previous.classList.add('ddb-short-table-heading');
                }
            }

            if (/\b(Str|Dex|Con|Int|Wis|Cha)\b/i.test(text) && /\b(Mod|Save|Ability Score)\b/i.test(text)) {
                table.classList.add('ddb-ability-source-table');
            } else if (/\b1d\d+\b/i.test(text) || /^d\d+\b/i.test(text)) {
                table.classList.add('ddb-roll-table');
            }
        }
    }

    function enhanceStatBlocks(root) {
        classifyOrdinaryTables(root);

        const candidates = [...root.querySelectorAll([
            '.mon-stat-block',
            '.monster-stat-block',
            '[class*="mon-stat-block"]',
            '[class*="monster-stat-block"]',
            '[class*="stat-block"]'
        ].join(','))];

        // Keep only the outermost matching stat-block containers.
        const blocks = candidates.filter(el => !el.parentElement?.closest([
            '.mon-stat-block',
            '.monster-stat-block',
            '[class*="mon-stat-block"]',
            '[class*="monster-stat-block"]',
            '[class*="stat-block"]'
        ].join(',')));

        for (const block of blocks) {
            block.classList.add('ddb-stat-block');

            // Merge the two common three-ability source tables into one compact six-ability print table.
            const sourceTables = [...block.querySelectorAll('table')];
            const rows = sourceTables.flatMap(parseAbilityRowsFromTable);
            const unique = [];
            const seen = new Set();
            for (const row of rows) {
                if (!seen.has(row.ability)) {
                    seen.add(row.ability);
                    unique.push(row);
                }
            }

            if (unique.length >= 6) {
                const merged = buildAbilityTable(block.ownerDocument, unique);
                if (merged) {
                    const abilityTables = sourceTables.filter(t => parseAbilityRowsFromTable(t).length > 0);
                    const first = abilityTables[0];
                    if (first) {
                        first.parentNode.insertBefore(merged, first);
                        abilityTables.forEach(t => t.classList.add('ddb-source-ability-table'));
                    }
                }
            }

            // Give the standard D&D Beyond label/value rows a real print grid.
            block.querySelectorAll('.mon-stat-block__attribute,[class*="stat-block__attribute"]').forEach(el => {
                el.classList.add('ddb-stat-attribute');
            });
            block.querySelectorAll('.mon-stat-block__attribute-label,[class*="attribute-label"]').forEach(el => {
                el.classList.add('ddb-stat-label');
            });
            block.querySelectorAll('.mon-stat-block__attribute-value,.mon-stat-block__attribute-data,[class*="attribute-value"],[class*="attribute-data"]').forEach(el => {
                el.classList.add('ddb-stat-value');
            });
            block.querySelectorAll('.mon-stat-block__tidbit,[class*="stat-block__tidbit"]').forEach(el => {
                el.classList.add('ddb-stat-detail-row');
            });
            block.querySelectorAll('.mon-stat-block__tidbit-label,[class*="tidbit-label"]').forEach(el => {
                el.classList.add('ddb-stat-label');
            });
            block.querySelectorAll('.mon-stat-block__tidbit-data,[class*="tidbit-data"]').forEach(el => {
                el.classList.add('ddb-stat-value');
            });
            block.querySelectorAll('.mon-stat-block__description-block-heading,[class*="description-block-heading"]').forEach(el => {
                el.classList.add('ddb-stat-section-heading');
            });
        }
    }


    function findFragmentTargetInNode(root, fragment) {
        if (!fragment) return null;

        let id;
        try { id = decodeURIComponent(fragment.replace(/^#/, '')); }
        catch { id = fragment.replace(/^#/, ''); }
        if (!id) return null;

        const allWithId = [...root.querySelectorAll('[id]')];
        const byId = allWithId.find(el => el.id === id || el.id.toLowerCase() === id.toLowerCase());
        if (byId) return byId;

        return [...root.querySelectorAll('a[name]')]
            .find(el => {
                const name = el.getAttribute('name') || '';
                return name === id || name.toLowerCase() === id.toLowerCase();
            }) || null;
    }

    function entryHeadingForTarget(target) {
        if (!target) return null;
        if (/^H[1-6]$/.test(target.tagName)) return target;

        const closest = target.closest?.('h1,h2,h3,h4,h5,h6');
        if (closest) return closest;

        const nested = target.querySelector?.('h1,h2,h3,h4,h5,h6');
        if (nested) return nested;

        let cursor = target;
        for (let i = 0; i < 5 && cursor; i++) {
            cursor = cursor.nextElementSibling;
            if (cursor && /^H[1-6]$/.test(cursor.tagName)) return cursor;
        }

        return null;
    }

    function markIndexedEntryBoundaries(root, indexedEntries = []) {
        const marked = new Set();

        for (const entry of indexedEntries) {
            if (!entry.fragment) continue;
            const target = findFragmentTargetInNode(root, entry.fragment);
            if (!target) continue;

            const heading = entryHeadingForTarget(target);
            const marker = heading || target;
            if (marked.has(marker)) continue;
            marked.add(marker);

            marker.classList.add('ddb-content-entry-start');

            // The opening line or two of a discrete entry often contains a
            // subtitle, type, rarity, location metadata, or other compact
            // identifying details. Keep these visually attached to the heading
            // without making assumptions about what kind of D&D content it is.
            let sibling = marker.nextElementSibling;
            let tagged = 0;
            while (sibling && tagged < 1) {
                if (/^H[1-6]$/.test(sibling.tagName)) break;
                if (sibling.matches('table,figure,picture,img,.ddb-art-block,.ddb-stat-block')) break;
                const compactText = (sibling.textContent || '').replace(/\s+/g, ' ').trim();
                if (!compactText || compactText.length > 190) break;
                sibling.classList.add('ddb-entry-opening-part');
                tagged += 1;
                sibling = sibling.nextElementSibling;
            }
        }
    }

    function extractDocument(html, sourceUrl, fallbackTitle, namespace, indexedEntries = []) {
        const doc = parse(html);
        const article = findArticle(doc);
        if (!article) throw new Error('Could not locate sourcebook article content.');
        const node = cleanupContent(article, sourceUrl);
        groupArtwork(node);
        enhanceStatBlocks(node);
        markIndexedEntryBoundaries(node, indexedEntries);
        const anchorMap = namespaceAnchors(node, namespace);
        return {
            title: article.querySelector('h1')?.textContent?.trim() || doc.querySelector('main h1')?.textContent?.trim() || fallbackTitle,
            node,
            anchorMap
        };
    }

    function resolveFragment(result, hash) {
        if (!result?.anchorMap || !hash) return null;
        if (result.anchorMap.has(hash)) return result.anchorMap.get(hash);
        try {
            const d = `#${decodeURIComponent(hash.replace(/^#/, ''))}`;
            return result.anchorMap.get(d) || null;
        } catch { return null; }
    }

    function buildMaps(primaryPages, primaryResults, refs, refResults, entries) {
        const documentMap = new Map();
        const resultMap = new Map();
        const targetMap = new Map();

        primaryPages.forEach((p, i) => {
            const base = withoutHash(p.url);
            documentMap.set(base, `#${p.id}`);
            resultMap.set(base, primaryResults[i]);
        });
        refs.forEach((d, i) => {
            const base = withoutHash(d.url);
            documentMap.set(base, `#${d.id}`);
            resultMap.set(base, refResults[i]);
        });

        for (const e of entries) {
            const exact = comparableUrl(e.url);
            const owner = resultMap.get(e.fetchUrl);
            const fragmentTarget = e.fragment ? resolveFragment(owner, e.fragment) : null;
            targetMap.set(exact, fragmentTarget || documentMap.get(e.fetchUrl) || e.url);
        }
        return { documentMap, targetMap };
    }

    function rewriteLinks(root, sourceUrl, documentMap, targetMap) {
        root.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (!href || href.startsWith('#') || /^(mailto:|javascript:)/i.test(href)) return;
            let u;
            try { u = new URL(href, sourceUrl); } catch { return; }
            const exact = comparableUrl(u.href);
            if (targetMap.has(exact)) a.setAttribute('href', targetMap.get(exact));
            else if (documentMap.has(withoutHash(u.href))) a.setAttribute('href', documentMap.get(withoutHash(u.href)));
        });
    }

    function stylesheetLinks() {
        if (!CONFIG.includeSiteCss) return '';
        const urls = new Set();
        document.querySelectorAll('link[rel="stylesheet"][href]').forEach(l => urls.add(absoluteUrl(l.href)));
        return [...urls].map(u => `<link rel="stylesheet" href="${escapeHtml(u)}">`).join('\n');
    }

    function findCoverArt() {
        return [...document.querySelectorAll('a[href]')].find(a => /view cover art/i.test(a.textContent.trim()))?.href || '';
    }

    function css() {
        return `<style>
:root{color-scheme:light}*,*::before,*::after{box-sizing:border-box}html,body{background:#fff!important}
body{margin:0 auto;max-width:8in;padding:.28in;color:#111!important;font-size:10.5pt;line-height:1.36;overflow:visible!important}
.ddb-pdf-toolbar{position:sticky;top:0;z-index:2147483647;display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:-.28in -.28in 18px;padding:10px 12px;background:#222;color:#fff;font-family:Arial,sans-serif;box-shadow:0 2px 10px #0004}
.ddb-pdf-toolbar button{padding:8px 12px;cursor:pointer;font-weight:700}.ddb-status{margin-left:auto;font-size:9pt}
.ddb-cover{text-align:center;break-after:page!important;page-break-after:always!important}.ddb-cover h1{font-size:30pt;line-height:1.08;margin:0 0 16pt;break-after:avoid-page!important}
.ddb-cover img{display:block!important;width:auto!important;max-width:100%!important;max-height:7in!important;height:auto!important;object-fit:contain!important;margin:0 auto!important}
.ddb-source{margin:12pt auto 0;max-width:90%;font:8pt/1.3 Arial,sans-serif;opacity:.62;overflow-wrap:anywhere}
.ddb-generated-toc{break-after:page!important;page-break-after:always!important}.ddb-generated-toc ol,.ddb-generated-index ul{padding-left:1.35rem}.ddb-generated-toc li,.ddb-generated-index li{margin:.14rem 0}.ddb-generated-toc a,.ddb-generated-index a{color:inherit!important;text-decoration:none!important}.ddb-generated-index.ddb-large-index ul{column-count:2;column-gap:1.4rem;column-fill:auto}.ddb-generated-index.ddb-large-index li{break-inside:avoid-column!important;page-break-inside:avoid!important}
.ddb-content-root,.ddb-major-page,.ddb-reference-document{width:100%;clear:both}
.ddb-content-root *,.ddb-content-root *::before,.ddb-content-root *::after{break-before:auto!important;break-after:auto!important;page-break-before:auto!important;page-break-after:auto!important;break-inside:auto!important;page-break-inside:auto!important}
.ddb-major-page{${CONFIG.majorPagesStartNewPage ? 'break-before:page!important;page-break-before:always!important;' : ''}}
.ddb-reference-document+.ddb-reference-document{margin-top:1.45em!important;padding-top:.62em!important;border-top:1px solid #b8aa96!important}
.ddb-content-root h1{margin-top:1.65em!important;margin-bottom:.5em!important}
.ddb-content-root h2{margin-top:1.4em!important;margin-bottom:.42em!important}
.ddb-content-root h3{margin-top:1.15em!important;margin-bottom:.36em!important}
.ddb-content-root h4,.ddb-content-root h5,.ddb-content-root h6{margin-top:.95em!important;margin-bottom:.3em!important}
.ddb-content-entry-start{margin-top:1.55em!important;padding-top:.65em!important;border-top:1.35px solid rgba(125,35,30,.62)!important;break-after:avoid-page!important;page-break-after:avoid!important}
.ddb-content-entry-start:first-child{margin-top:.35em!important}
.ddb-content-entry-start+.ddb-entry-opening-part{break-before:avoid-page!important;page-break-before:avoid!important}
p{orphans:3;widows:3}h1,h2,h3,h4,h5,h6{break-after:avoid-page!important;page-break-after:avoid!important;orphans:3;widows:3}h1+*,h2+*,h3+*,h4+*,h5+*,h6+*{break-before:avoid-page!important;page-break-before:avoid!important}
ul,ol,li,blockquote,aside{break-inside:auto!important;page-break-inside:auto!important}
table{width:100%;max-width:100%;border-collapse:collapse;break-inside:auto!important}thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid-page!important;page-break-inside:avoid!important}th,td{vertical-align:top}
.ddb-short-table{break-inside:avoid-page!important;page-break-inside:avoid!important}
.ddb-short-table-heading{break-after:avoid-page!important;page-break-after:avoid!important;margin-bottom:.28em!important}
figure,picture{max-width:100%!important;break-inside:auto!important;page-break-inside:auto!important;margin-left:auto;margin-right:auto}img,picture,svg,canvas{max-width:100%!important;height:auto!important}.ddb-content-root img{max-height:6.9in!important;object-fit:contain!important}
.ddb-art-block{clear:both;break-inside:auto!important;page-break-inside:auto!important;margin:.35em 0 .7em}.ddb-art-block>:first-child{break-after:avoid-page!important;page-break-after:avoid!important}.ddb-art-block img{display:block!important;width:auto!important;max-width:100%!important;max-height:6.75in!important;margin:.15em auto 0!important}figcaption{text-align:center;break-before:avoid-page!important}

.ddb-print-table{width:100%!important;border-collapse:collapse!important;border-spacing:0!important;margin:.45em 0 .8em!important;font-size:9.4pt!important;line-height:1.25!important;background:#fff!important}
.ddb-print-table th,.ddb-print-table td{padding:.22em .42em!important;border:1px solid #777!important;text-align:left!important;vertical-align:top!important}
.ddb-print-table thead th{font-weight:700!important;background:#ece9df!important;border-bottom:2px solid #555!important}
.ddb-print-table tbody tr:nth-child(even)>td,.ddb-print-table tbody tr:nth-child(even)>th{background:#f7f5ef!important}
.ddb-roll-table th:first-child,.ddb-roll-table td:first-child{width:11%!important;text-align:center!important;white-space:nowrap!important}
.ddb-source-ability-table{display:none!important}
.ddb-ability-table{width:100%!important;table-layout:fixed!important;border-collapse:collapse!important;margin:.45em 0 .75em!important;font-size:9pt!important;line-height:1.15!important;break-inside:avoid-page!important;page-break-inside:avoid!important}
.ddb-ability-table th,.ddb-ability-table td{border:1px solid #555!important;padding:.22em .18em!important;text-align:center!important;vertical-align:middle!important}
.ddb-ability-table thead th{background:#2e2e2e!important;color:#fff!important;font-weight:700!important;letter-spacing:.02em!important}
.ddb-ability-table tbody th{background:#e8e5dc!important;text-align:left!important;font-weight:700!important;width:12%!important}
.ddb-ability-table tbody tr:nth-child(even) td{background:#f7f5ef!important}
.ddb-stat-block{border-top:2px solid #8b1e1e!important;border-bottom:2px solid #8b1e1e!important;padding:.45em .55em .55em!important;margin:.45em 0 1em!important;background:#fffdf8!important}
.ddb-stat-attribute,.ddb-stat-detail-row{display:grid!important;grid-template-columns:minmax(5.6em,auto) 1fr!important;gap:.35em!important;align-items:start!important;padding:.14em .22em!important;border-bottom:1px solid #ddd6c8!important}
.ddb-stat-label{font-weight:700!important;white-space:nowrap!important}.ddb-stat-value{min-width:0!important}
.ddb-stat-section-heading{margin:.65em 0 .25em!important;padding:.18em .28em!important;font-weight:800!important;text-transform:uppercase!important;letter-spacing:.035em!important;border-top:1px solid #8b1e1e!important;border-bottom:1px solid #8b1e1e!important;background:#f0e6d7!important;break-after:avoid-page!important;page-break-after:avoid!important}
.mon-stat-block,.monster-stat-block,[class*="mon-stat-block"],[class*="monster-stat-block"],[class*="stat-block"]{break-inside:auto!important;page-break-inside:auto!important}.mon-stat-block p,.monster-stat-block p,[class*="stat-block"] p,.mon-stat-block li,.monster-stat-block li,[class*="stat-block"] li{break-inside:avoid-page!important;page-break-inside:avoid!important}
.compendium-image-left,.monster-image-left{float:left;margin:.25rem 1rem .5rem 0}.compendium-image-right,.monster-image-right{float:right;margin:.25rem 0 .5rem 1rem}.compendium-center-banner-img{width:100%!important}
.ddb-error{margin:1rem 0;padding:.75rem;border:1px solid #999;font-family:Arial,sans-serif;break-inside:avoid-page!important}.ddb-report{break-before:page!important;page-break-before:always!important;font:9pt Arial,sans-serif}.ddb-report table{width:auto}
@page{size:Letter;margin:.62in .58in .68in}
@media print{html,body{max-width:none!important;width:auto!important;margin:0!important;padding:0!important;background:#fff!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;overflow:visible!important}.ddb-pdf-toolbar{display:none!important}a{color:inherit!important;text-decoration:none!important}${CONFIG.includeCaptureReportInPrint ? '' : '.ddb-report{display:none!important}'}}
</style>`;
    }

    function buildIndex(groups, targetMap) {
        return groups.map(g => {
            const sizeClass = g.entries.length >= 80 ? ' ddb-large-index' : '';
            return `<section class="ddb-generated-index${sizeClass}"><h2>${escapeHtml(g.title)}</h2><ul>${g.entries.map(e => `<li><a href="${escapeHtml(targetMap.get(comparableUrl(e.url)) || e.url)}">${escapeHtml(e.label)}</a></li>`).join('')}</ul></section>`;
        }).join('');
    }

    function trailingPrimary(page) { return /^(appendix\b|credits?\b|acknowledg|legal\b|index\b)/i.test(page.label.trim()); }

    function renderPrimary(page, result) {
        if (!result?.node) return `<section id="${escapeHtml(page.id)}" class="ddb-major-page"><div class="ddb-error"><h1>${escapeHtml(page.label)}</h1><p>${escapeHtml(result?.error || 'Capture failed')}</p></div></section>`;
        return `<section id="${escapeHtml(page.id)}" class="ddb-major-page" data-source-url="${escapeHtml(page.url)}">${result.node.innerHTML}</section>`;
    }

    function renderRef(doc, result) {
        if (!result?.node) return `<section id="${escapeHtml(doc.id)}" class="ddb-reference-document"><div class="ddb-error"><h2>${escapeHtml(doc.label)}</h2><p>${escapeHtml(result?.error || 'Capture failed')}</p></div></section>`;
        return `<section id="${escapeHtml(doc.id)}" class="ddb-reference-document" data-source-url="${escapeHtml(doc.url)}">${result.node.innerHTML}</section>`;
    }

    function buildDocument({ bookTitle, root, primaryPages, primaryResults, refs, refResults, indexGroups, documentMap, targetMap }) {
        primaryResults.forEach(r => r?.node && rewriteLinks(r.node, r.sourceUrl, documentMap, targetMap));
        refResults.forEach(r => r?.node && rewriteLinks(r.node, r.sourceUrl, documentMap, targetMap));

        const lead = [], tail = [];
        primaryPages.forEach((p, i) => (refs.length && trailingPrimary(p) ? tail : lead).push(renderPrimary(p, primaryResults[i])));
        const refHtml = refs.map((d, i) => renderRef(d, refResults[i])).join('\n');
        const failures = [...primaryResults, ...refResults].filter(r => r?.error);
        const cover = findCoverArt();
        const toc = primaryPages.map((p, i) => `<li><a href="#${p.id}">${escapeHtml(primaryResults[i]?.title || p.label)}</a></li>`).join('');
        const report = [
            ['Primary sourcebook pages discovered', primaryPages.length],
            ['Indexed/reference links discovered', flattenEntries(indexGroups).length],
            ['Unique indexed source documents appended', refs.length],
            ['Unique HTML documents requested', state.fetchCache.size],
            ['Capture failures', failures.length]
        ].map(([a,b]) => `<tr><th>${escapeHtml(a)}</th><td>${b}</td></tr>`).join('');

        return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(bookTitle)}</title>${stylesheetLinks()}${css()}</head><body>
<div class="ddb-pdf-toolbar"><button id="ddbPrint">Print / Save PDF</button><button id="ddbClose">Close</button><span class="ddb-status">${primaryPages.length} primary pages • ${flattenEntries(indexGroups).length} indexed links • ${refs.length} indexed documents • ${failures.length} warnings</span></div>
<section class="ddb-cover"><h1>${escapeHtml(bookTitle)}</h1>${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(bookTitle)} cover">` : ''}<div class="ddb-source">Built from sourcebook content accessible to the currently logged-in D&D Beyond account.<br>${escapeHtml(location.origin + root)}</div></section>
<section class="ddb-generated-toc"><h1>Contents</h1><ol>${toc}</ol>${buildIndex(indexGroups, targetMap)}</section>
<main class="ddb-content-root">${lead.join('\n')}${refHtml}${tail.join('\n')}</main>
<section class="ddb-report"><h1>Capture Report</h1><table>${report}</table>${failures.length ? `<h2>Warnings</h2><ul>${failures.map(f => `<li>${escapeHtml(f.label || '')}: ${escapeHtml(f.error)}</li>`).join('')}</ul>` : '<p>No capture failures were reported.</p>'}</section>
</body></html>`;
    }

    async function waitForAssets(win) {
        const doc = win.document;
        await Promise.allSettled([...doc.images].map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 15000);
        })));
        try { if (doc.fonts?.ready) await Promise.race([doc.fonts.ready, sleep(10000)]); } catch {}
    }

    function button(text) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = text;
        Object.assign(b.style, { cursor: 'pointer', padding: '9px 13px', fontWeight: '700' });
        return b;
    }

    const root = determineBookRoot();
    const bookRoots = determineBookRoots(root);
    if (!root || !isLandingPage(root)) return;

    const panel = document.createElement('div');
    Object.assign(panel.style, { position:'fixed', right:'18px', bottom:'18px', zIndex:'2147483647', display:'flex', gap:'8px', alignItems:'center', padding:'10px', borderRadius:'8px', background:'#202020', color:'#fff', boxShadow:'0 3px 16px #0006', fontFamily:'Arial,sans-serif' });
    const buildBtn = button('Build Offline PDF');
    const cancelBtn = button('Cancel'); cancelBtn.disabled = true;
    const status = document.createElement('span'); status.textContent = 'Ready'; Object.assign(status.style, { fontSize:'12px', maxWidth:'240px' });
    panel.append(buildBtn, cancelBtn, status); document.body.appendChild(panel);

    cancelBtn.onclick = () => { state.cancelled = true; cancelBtn.disabled = true; cancelBtn.textContent = 'Cancelling…'; };

    buildBtn.onclick = async () => {
        if (state.running) return;
        state.running = true; state.cancelled = false; state.fetchCache.clear();
        buildBtn.disabled = true; cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel';

        const preview = window.open('about:blank', '_blank');
        if (!preview) {
            alert('Allow popups for www.dndbeyond.com, then try again.');
            state.running = false; buildBtn.disabled = false; cancelBtn.disabled = true; return;
        }

        preview.document.write('<!doctype html><html><body style="font-family:Arial;padding:40px"><h1>Building sourcebook…</h1><p id="ddbBuildStatus">Discovering book structure…</p></body></html>');
        preview.document.close();
        const setStatus = t => { status.textContent = t; try { const e = preview.document.getElementById('ddbBuildStatus'); if (e) e.textContent = t; } catch {} };

        try {
            const bookTitle = cleanBookTitle();
            const primaryPages = discoverPrimaryPages(root, bookRoots);
            const indexGroups = discoverIndexGroups(root, bookRoots);
            const entries = flattenEntries(indexGroups);
            const refs = buildReferenceDocuments(entries, primaryPages);
            log('Detected source roots', bookRoots);
            log('Primary source documents', primaryPages.map(p => p.url));

            if (!primaryPages.length) throw new Error(`No sourcebook pages found. Detected source roots: ${bookRoots.join(', ')}. Open the book main Contents page and reload.`);

            const primaryResults = new Array(primaryPages.length);
            for (let i = 0; i < primaryPages.length; i++) {
                if (state.cancelled) throw new Error('Download cancelled.');
                const p = primaryPages[i]; setStatus(`Book pages ${i+1}/${primaryPages.length}: ${p.label}`);
                try {
                    const html = await fetchHtml(p.url);
                    primaryResults[i] = { ...extractDocument(html, p.url, p.label, p.id, entries.filter(e => e.fetchUrl === withoutHash(p.url))), sourceUrl:p.url, label:p.label };
                } catch (e) { primaryResults[i] = { error:e?.message || String(e), sourceUrl:p.url, label:p.label }; warn(e); }
                if (i < primaryPages.length - 1) await sleep(delay());
            }

            const refResults = new Array(refs.length);
            for (let i = 0; i < refs.length; i++) {
                if (state.cancelled) throw new Error('Download cancelled.');
                const d = refs[i]; setStatus(`Indexed documents ${i+1}/${refs.length}: ${d.label}`);
                try {
                    const html = await fetchHtml(d.url);
                    refResults[i] = { ...extractDocument(html, d.url, d.label, d.id, d.entries), sourceUrl:d.url, label:d.label };
                } catch (e) { refResults[i] = { error:e?.message || String(e), sourceUrl:d.url, label:d.label }; warn(e); }
                if (i < refs.length - 1) await sleep(delay());
            }

            const { documentMap, targetMap } = buildMaps(primaryPages, primaryResults, refs, refResults, entries);
            setStatus('Building print-ready book…');
            const html = buildDocument({ bookTitle, root, primaryPages, primaryResults, refs, refResults, indexGroups, documentMap, targetMap });
            preview.document.open(); preview.document.write(html); preview.document.close();

            const printBtn = preview.document.getElementById('ddbPrint');
            const closeBtn = preview.document.getElementById('ddbClose');
            if (printBtn) { printBtn.disabled = true; printBtn.textContent = 'Loading images…'; }
            if (closeBtn) closeBtn.onclick = () => preview.close();
            await waitForAssets(preview);
            if (printBtn) { printBtn.disabled = false; printBtn.textContent = 'Print / Save PDF'; printBtn.onclick = () => { preview.focus(); preview.print(); }; }

            const failures = [...primaryResults, ...refResults].filter(r => r?.error).length;
            setStatus(`Ready: ${primaryPages.length} primary pages, ${entries.length} indexed links, ${refs.length} indexed documents, ${failures} warnings`);
            log('Complete', { primaryPages:primaryPages.length, indexedLinks:entries.length, indexedDocuments:refs.length, uniqueDocuments:state.fetchCache.size, failures });
        } catch (e) {
            warn(e); status.textContent = 'Failed';
            try { const x = preview.document.getElementById('ddbBuildStatus'); if (x) { x.textContent = e?.message || String(e); x.style.color = 'darkred'; } } catch {}
        } finally {
            state.running = false; buildBtn.disabled = false; buildBtn.textContent = 'Build Offline PDF'; cancelBtn.disabled = true; cancelBtn.textContent = 'Cancel';
        }
    };
})();
