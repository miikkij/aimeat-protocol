/**
 * @file test/unit/markdown-href-scheme.test.ts
 * @description The Markdown link and image sanitizers decide the scheme on the text the browser's
 *   URL parser reads: an ASCII tab or newline anywhere and a leading C0 control character are
 *   removed first, so `java\tscript:` and `\u0001javascript:` are refused like `javascript:`.
 *   Covers both copies: the served SDK lib (AIMEAT.md) and the node SPA component.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, sanitizeHref scheme check).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

type San = (u: unknown) => string | null;
const here = dirname(fileURLToPath(import.meta.url));

// Both files import browser-only modules, so the sanitizer functions are read out of the source and
// evaluated on their own: the test covers the code that ships, not a copy of it.
function fromSdk(): { href: San; img: San } {
    const src = readFileSync(resolve(here, '../../src/static/sdk-libs/markdown/index.js'), 'utf-8');
    const body = src.slice(src.indexOf('var SAFE ='), src.indexOf('function txt('));
    return new Function(`${body}; return { href: sanitizeHref, img: sanitizeImgSrc };`)();
}
function fromSpa(): { href: San; img: San } {
    const src = readFileSync(resolve(here, '../../public/components/Markdown.js'), 'utf-8');
    const consts = src.slice(src.indexOf('const SAFE_SCHEME'), src.indexOf('// Slug used'));
    const helper = src.indexOf('function parserText');
    const fns = src.slice(helper >= 0 ? helper : src.indexOf('export function sanitizeHref'), src.indexOf('// Match a BARE')).replace(/export /g, '');
    return new Function(`${consts}\n${fns}; return { href: sanitizeHref, img: sanitizeImgSrc };`)();
}

const base = 'https://app.example/';
const hostile = ['java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)', ' \u0000javascript:alert(1)', 'j\ra\tvascript:alert(1)'];
const kept: Array<[string, string]> = [
    ['https://example.org/a', 'https://example.org/a'],
    ['http://example.org/', 'http://example.org/'],
    ['mailto:a@example.org', 'mailto:a@example.org'],
    ['/v1/pub/abc/file.png', '/v1/pub/abc/file.png'],
    ['#heading', '#heading'],
    ['docs/page', 'docs/page'],
    ['  https://example.org/b  ', 'https://example.org/b'],
];

for (const [name, load] of [['SDK lib aimeat-markdown', fromSdk], ['SPA Markdown component', fromSpa]] as const) {
    describe(`${name}: sanitizeHref`, () => {
        const { href, img } = load();
        for (const h of hostile) {
            it(`refuses ${JSON.stringify(h)}`, () => {
                const out = href(h);
                // Refused, or at least nothing the URL parser reads as a script address.
                expect(out === null || new URL(out, base).protocol !== 'javascript:').toBe(true);
                expect(out).toBeNull();
            });
            it(`image src refuses ${JSON.stringify(h)}`, () => { expect(img(h)).toBeNull(); });
        }
        for (const [input, want] of kept) {
            it(`keeps ${JSON.stringify(input)}`, () => { expect(href(input)).toBe(want); });
        }
        it('keeps a blob: image source', () => { expect(img('blob:https://app.example/1234')).toBe('blob:https://app.example/1234'); });
    });
}
