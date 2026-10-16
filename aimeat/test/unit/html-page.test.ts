/**
 * @file test/unit/html-page.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure rules of HTML pages in workspaces: the text the node writes from a page
 *   (services/html-page.ts htmlToText), the page check, the page as a locked schema reads it, the
 *   version window, the file names, the frame's policy, a share's end dates
 *   (services/workspace-share.ts isDocPublicAt), the stale mark (services/workspace-opened.ts), the
 *   tool input of aimeat_workspace_share (services/workspace-share-input.ts) and the decoding that
 *   answers instead of throwing (utils/uri-decode.ts).
 * @usage pnpm exec vitest run test/unit/html-page.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial.
 */
import { describe, expect, it } from 'vitest';
import {
    htmlToText, normalizeHtmlPageValue, schemaViewOfDocument, htmlPageRetention, pageFileNameOk,
    isServablePageFileType, pageFrameCsp, pageHolderCsp, pageOriginOf, HTML_PAGE_MAX_VERSIONS,
} from '../../src/services/html-page.js';
import { isDocPublicAt, resolveShare } from '../../src/services/workspace-share.js';
import { isPageStale } from '../../src/services/workspace-opened.js';
import { shareBodyFromToolInput } from '../../src/services/workspace-share-input.js';
import { decodeUriSegment } from '../../src/utils/uri-decode.js';

describe('htmlToText', () => {
    it('keeps headings, list items and paragraphs, and drops scripts, styles and comments', () => {
        const text = htmlToText('<html><head><title>T</title><style>p{}</style></head><body><!-- x --><h2>Otsikko</h2><p>Eka &amp; toka</p><ul><li>yksi</li><li>kaksi</li></ul><script>alert(1)</script></body></html>');
        expect(text).toBe('## Otsikko\n\nEka & toka\n\n- yksi\n- kaksi');
    });
    it('decodes each entity once, so an escaped entity stays escaped', () => {
        expect(htmlToText('<p>&amp;lt; &#x41; &#66; &auml;</p>')).toBe('&lt; A B ä');
    });
    it('ends cleanly on an unclosed tag and an unclosed script', () => {
        expect(htmlToText('<p>alku<script>never closed')).toBe('alku');
        expect(htmlToText('loppu <b')).toBe('loppu');
    });
});

describe('normalizeHtmlPageValue', () => {
    it('passes a Markdown page through unchanged', () => {
        const v = { title: 't', markdown: 'm' };
        expect(normalizeHtmlPageValue(v)).toEqual({ ok: true, value: v });
    });
    it('writes the text into markdown when the writer gave none, and keeps one the writer gave', () => {
        const written = normalizeHtmlPageValue({ title: 't', html: '<h1>H</h1>' });
        expect(written).toEqual({ ok: true, value: { title: 't', html: '<h1>H</h1>', markdown: '# H' } });
        const kept = normalizeHtmlPageValue({ title: 't', html: '<h1>H</h1>', markdown: 'own' });
        expect(kept.ok && (kept.value as { markdown: string }).markdown).toBe('own');
    });
    it('falls back to the title when the page has no text', () => {
        const v = normalizeHtmlPageValue({ title: 'Vain kuva', html: '<img src="a.png">' });
        expect(v.ok && (v.value as { markdown: string }).markdown).toBe('Vain kuva');
    });
    it('refuses an empty page, a bad file map, a climbing name and too many files', () => {
        expect(normalizeHtmlPageValue({ html: ' ' }).ok).toBe(false);
        expect(normalizeHtmlPageValue({ html: '<p>x</p>', files: ['a'] }).ok).toBe(false);
        expect(normalizeHtmlPageValue({ html: '<p>x</p>', files: { '../x': 'k' } }).ok).toBe(false);
        expect(normalizeHtmlPageValue({ html: '<p>x</p>', files: { 'index.html': 'k' } }).ok).toBe(false);
        expect(normalizeHtmlPageValue({ html: '<p>x</p>', files: { 'a.png': '' } }).ok).toBe(false);
        const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}.png`, 'k']));
        expect(normalizeHtmlPageValue({ html: '<p>x</p>', files: many }).ok).toBe(false);
    });
});

describe('schemaViewOfDocument', () => {
    it('drops html and files from a page in a document space, and only there', () => {
        const page = { title: 't', markdown: 'm', html: '<p>x</p>', files: { 'a.png': 'k' } };
        expect(schemaViewOfDocument(page, true)).toEqual({ title: 't', markdown: 'm' });
        expect(schemaViewOfDocument(page, false)).toBe(page);
        const md = { title: 't', markdown: 'm' };
        expect(schemaViewOfDocument(md, true)).toBe(md);
    });
});

describe('htmlPageRetention', () => {
    const config = { workspaceMaxVersions: 20 };
    it('keeps at most five, fewer when the space keeps fewer, five when the space keeps all', () => {
        expect(htmlPageRetention(undefined, config)).toMatchObject({ maxVersions: HTML_PAGE_MAX_VERSIONS });
        expect(htmlPageRetention({ maxVersions: 3 }, config)).toMatchObject({ maxVersions: 3 });
        expect(htmlPageRetention({ maxVersions: 0 }, config)).toMatchObject({ maxVersions: HTML_PAGE_MAX_VERSIONS });
    });
    it('leaves an append-only space as it is', () => {
        const ot = { create_only: true };
        expect(htmlPageRetention(ot, config)).toBe(ot);
    });
});

describe('file names and types', () => {
    it('takes names in segments and refuses dot segments and the page itself', () => {
        expect(pageFileNameOk('img/kaavio.svg')).toBe(true);
        expect(pageFileNameOk('a/../b')).toBe(false);
        expect(pageFileNameOk('/abs.png')).toBe(false);
        expect(pageFileNameOk('index.html')).toBe(false);
    });
    it('serves pictures, media, fonts, styles and scripts beside a page, never another HTML document', () => {
        for (const t of ['image/png', 'image/svg+xml', 'video/mp4', 'audio/mpeg', 'font/woff2', 'text/css', 'text/javascript', 'application/json']) expect(isServablePageFileType(t)).toBe(true);
        for (const t of ['text/html', 'application/xhtml+xml', 'application/pdf', 'application/octet-stream']) expect(isServablePageFileType(t)).toBe(false);
    });
});

describe('the frame policies', () => {
    it('sandboxes the page without its own origin and closes every network exit', () => {
        const csp = pageFrameCsp('https://pages.example', 'https://pages.example https://example');
        expect(csp.startsWith('sandbox allow-scripts allow-forms allow-modals;')).toBe(true);
        expect(csp).not.toMatch(/allow-same-origin|allow-popups|allow-top-navigation/);
        for (const d of ["connect-src 'none'", "form-action 'none'", "frame-src 'none'", 'img-src https://pages.example data: blob:', 'frame-ancestors https://pages.example https://example']) expect(csp).toContain(d);
    });
    it('lets the holder frame the page host alone', () => {
        const csp = pageHolderCsp('https://pages.example', 'https://example');
        expect(csp).toContain('frame-src https://pages.example;');
        expect(csp).toContain('frame-ancestors https://example');
        expect(csp).toContain('script-src https://pages.example/p/_/holder.js');
    });
    it('takes the node\'s scheme and port, and is null without a page host', () => {
        expect(pageOriginOf({ pageHost: 'pages.localhost', baseUrl: 'http://localhost:40600' })).toBe('http://pages.localhost:40600');
        expect(pageOriginOf({ pageHost: 'pages.aimeat.io', baseUrl: 'https://aimeat.io' })).toBe('https://pages.aimeat.io');
        expect(pageOriginOf({ pageHost: '', baseUrl: 'https://aimeat.io' })).toBeNull();
    });
});

describe('isDocPublicAt', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    it('closes a target at its end date, at the level that decides', () => {
        const share = resolveShare({ docs: { 'p/a': true }, spaces: { q: true }, public: true, until: { 'p/a': '2026-10-15T00:00:00Z', 'space:q': '2026-12-01T00:00:00Z' } });
        expect(isDocPublicAt(share, 'p', 'a', now)).toBe(false);
        expect(isDocPublicAt(share, 'q', 'b', now)).toBe(true);
        expect(isDocPublicAt(share, 'q', 'b', Date.parse('2026-12-02T00:00:00Z'))).toBe(false);
        expect(isDocPublicAt(share, 'r', 'c', now)).toBe(true);
    });
    it('reads a share made before end dates existed exactly as before', () => {
        const share = resolveShare({ docs: { 'p/a': false }, public: true });
        expect(isDocPublicAt(share, 'p', 'a', now)).toBe(false);
        expect(isDocPublicAt(share, 'p', 'b', now)).toBe(true);
    });
});

describe('isPageStale', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    it('marks a page neither opened nor changed for 180 days', () => {
        expect(isPageStale('2026-03-01', '2026-02-01T00:00:00Z', now)).toBe(true);
        expect(isPageStale('2026-10-01', '2026-02-01T00:00:00Z', now)).toBe(false);
        expect(isPageStale(undefined, '2026-09-01T00:00:00Z', now)).toBe(false);
        expect(isPageStale(undefined, undefined, now)).toBe(false);
    });
});

describe('shareBodyFromToolInput', () => {
    it('names a page, a space or the workspace, with an end date or none', () => {
        expect(shareBodyFromToolInput({ space: 'p', id: 'a', shared: true, until: '2027-01-31' })).toEqual({ body: { docs: { 'p/a': true }, until: { 'p/a': '2027-01-31' } } });
        expect(shareBodyFromToolInput({ space: 'p', shared: false })).toEqual({ body: { spaces: { p: false } } });
        expect(shareBodyFromToolInput({ shared: true, until: 'none', access: 'account' })).toEqual({ body: { public: true, access: 'account', until: { '*': null } } });
    });
    it('refuses an id without its space and a missing shared', () => {
        expect('error' in shareBodyFromToolInput({ id: 'a', shared: true })).toBe(true);
        expect('error' in shareBodyFromToolInput({ space: 'p' })).toBe(true);
    });
});

describe('decodeUriSegment', () => {
    it('decodes well-formed escapes and answers null for a malformed one', () => {
        expect(decodeUriSegment('alice%40node')).toBe('alice@node');
        expect(decodeUriSegment('%C3%A4')).toBe('ä');
        expect(decodeUriSegment('plain')).toBe('plain');
        expect(decodeUriSegment('100%')).toBeNull();
        expect(decodeUriSegment('%zz')).toBeNull();
    });
    it('turns bytes that are not UTF-8 into a name nothing stored has', () => {
        expect(decodeUriSegment('%C3')).toBe('�');
    });
});
