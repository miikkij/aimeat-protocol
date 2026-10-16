/**
 * @file src/services/html-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An HTML page: a workspace document whose value carries `html` beside `title` and
 *   `markdown`. It is the free-form way to bring a presentation with pictures and script into a
 *   workspace without building an app (wish-kevyet-html-esitykset-ilman-sovellusta-eristetty-html-sivu-j,
 *   brief doc-mvb4bmxr8eyg).
 *
 *   THE VALUE. `{ title, html, markdown, files? }`.
 *     - `html` is the page as the browser runs it, inside the page frame (routes/page-host.ts).
 *     - `markdown` is the page as text. The writer may give it; when it does not, the node writes it
 *       from the HTML here. Every reader that knows only Markdown pages (search, the librarian, the
 *       overview, ?format=md, an older Pages app, a schema that requires `markdown`) then reads an
 *       HTML page as the text it says, and nothing that reads a document has to change.
 *     - `files` maps a file name the HTML uses (`kuva.png`, `img/kaavio.svg`) to the key of a stored
 *       file of the writer or one of their agents. The page frame serves those names beside the page,
 *       to whoever may open the page, so a relative `<img src="kuva.png">` works for everyone the page
 *       is shared with and the file itself keeps the visibility it has.
 *
 *   THE FRAME. Everything the browser is told about a page's response is here, as constants: one
 *   CSP string that grows with neither pages nor owners (a header that listed origins took down
 *   every app subdomain at 76 apps, when it outgrew nginx's 4 kB buffer), the Permissions-Policy, and
 *   which stored file types the frame serves.
 * @structure
 *   - isHtmlPageValue() — does a document value carry a page
 *   - htmlToText() — the readable text of a page, written by a scanner rather than a regex
 *   - normalizeHtmlPageValue() — check a page value and give it its text
 *   - htmlPageRetention() — the version window of an HTML page (5, or less when the space keeps fewer)
 *   - pageFrameCsp() · PAGE_PERMISSIONS_POLICY · isServablePageFileType() · pageFileNameOk()
 *   - pageOriginOf() — the origin the page frame is served from, or null when the node has none
 * @usage
 *   const n = normalizeHtmlPageValue(value); if (!n.ok) refuse(n.message); value = n.value;
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial.
 */
import type { AimeatConfig } from '../config.js';

/** Snapshots kept per HTML page. A page is up to a whole memory value and each version is a full copy. */
export const HTML_PAGE_MAX_VERSIONS = 5;
/** Days an open link to an HTML page lasts when the share names no end date (Jouni, 2026-10-16). */
export const HTML_PAGE_SHARE_DAYS = 90;
/** A page nobody opened or changed for this many days is marked, and its archiving is offered. */
export const PAGE_STALE_DAYS = 180;
/** File names one page may map. */
export const PAGE_FILES_MAX = 50;
/** The most text htmlToText writes; the rest of a long page is still served, only not as text. */
const TEXT_MAX = 200_000;

export interface HtmlPageValue {
    title?: unknown;
    html: string;
    markdown?: unknown;
    files?: Record<string, string>;
    [k: string]: unknown;
}

/** A document value that carries a page: an object with a string `html`. */
export function isHtmlPageValue(v: unknown): v is HtmlPageValue {
    return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).html === 'string';
}

// ── htmlToText ──────────────────────────────────────────────────────────────────────────────────

/** Elements whose content is not text a reader sees. */
const SKIP_CONTENT = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'canvas', 'math']);
/** Elements that start and end a block of text. */
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
    'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'tr', 'blockquote', 'pre', 'figure', 'figcaption', 'hr',
    'form', 'fieldset', 'details', 'summary', 'address']);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', euro: '€', auml: 'ä', ouml: 'ö', aring: 'å', Auml: 'Ä', Ouml: 'Ö', Aring: 'Å' };

/** One pass over the entities, so `&amp;lt;` stays `&lt;` and is never read twice. */
function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,8});/g, (whole, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return NAMED[body] ?? whole;
    });
}

/**
 * The text a person reads on the page, as plain Markdown-ish text: headings as `#`, list items as
 * `- `, a block per paragraph. A character scanner rather than a chain of regex replacements, so a
 * malformed or unclosed tag costs one pass and never a backtracking regex over a megabyte.
 */
export function htmlToText(html: string): string {
    const src = html.length > 4_000_000 ? html.slice(0, 4_000_000) : html;
    const lower = src.toLowerCase();
    const out: string[] = [];
    let i = 0;
    const push = (s: string) => { out.push(s); };
    while (i < src.length) {
        const lt = src.indexOf('<', i);
        if (lt === -1) { push(src.slice(i)); break; }
        if (lt > i) push(src.slice(i, lt));
        if (lower.startsWith('<!--', lt)) {
            const end = src.indexOf('-->', lt + 4);
            i = end === -1 ? src.length : end + 3;
            continue;
        }
        const gt = src.indexOf('>', lt + 1);
        if (gt === -1) break;
        const raw = lower.slice(lt + 1, gt).trim();
        const closing = raw.startsWith('/');
        const name = (closing ? raw.slice(1) : raw).split(/[\s/]/, 1)[0] ?? '';
        i = gt + 1;
        if (!closing && SKIP_CONTENT.has(name)) {
            const end = lower.indexOf(`</${name}`, i);
            if (end === -1) { i = src.length; continue; }
            const endGt = src.indexOf('>', end);
            i = endGt === -1 ? src.length : endGt + 1;
            continue;
        }
        if (/^h[1-6]$/.test(name)) { push(closing ? '\n\n' : `\n\n${'#'.repeat(Number(name[1]))} `); continue; }
        if (name === 'li') { if (!closing) push('\n- '); continue; }
        if (name === 'br') { push('\n'); continue; }
        if (name === 'td' || name === 'th') { if (closing) push(' '); continue; }
        if (BLOCK.has(name)) { push('\n\n'); continue; }
    }
    const text = decodeEntities(out.join(''))
        .replace(/[ \t\f\v\u00a0]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text;
}

// ── normalizeHtmlPageValue ──────────────────────────────────────────────────────────────────────

/**
 * A file name a page may map: one or more path segments of letters, digits, dot, dash and
 * underscore, none of them `.` or `..`, never `index.html` (that name is the page itself).
 */
export function pageFileNameOk(name: string): boolean {
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) return false;
    if (name === 'index.html') return false;
    return name.split('/').every(seg => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(seg) && seg !== '.' && seg !== '..');
}

export type HtmlPageNormalized = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * Check a document value that carries a page and give it its text. A value without `html` passes
 * through unchanged, so every Markdown page is exactly what it was.
 */
export function normalizeHtmlPageValue(value: unknown): HtmlPageNormalized {
    if (!isHtmlPageValue(value)) return { ok: true, value };
    if (value.html.trim() === '') {
        return { ok: false, message: 'An HTML page needs `html`: the page as one HTML document. An empty string would store a page that shows nothing.' };
    }
    let files: Record<string, string> | undefined;
    if (value.files !== undefined && value.files !== null) {
        if (typeof value.files !== 'object' || Array.isArray(value.files)) {
            return { ok: false, message: '`files` maps a file name the HTML uses to the key of a stored file, for example { "kuva.png": "pages/esitys/kuva.png" }.' };
        }
        const entries = Object.entries(value.files as Record<string, unknown>);
        if (entries.length > PAGE_FILES_MAX) return { ok: false, message: `A page maps at most ${PAGE_FILES_MAX} files; this one maps ${entries.length}.` };
        files = {};
        for (const [name, key] of entries) {
            if (!pageFileNameOk(name)) {
                return { ok: false, message: `File name "${name}" cannot be used: a name is letters, digits, ".", "-" and "_", in segments separated by "/", and never index.html.` };
            }
            if (typeof key !== 'string' || key.trim() === '' || key.length > 512) {
                return { ok: false, message: `File "${name}" must name the key of a stored file (upload it with aimeat_storage_upload and use the key it answers).` };
            }
            files[name] = key.trim();
        }
    }
    const given = typeof value.markdown === 'string' && value.markdown.trim() !== '' ? value.markdown : null;
    const title = typeof value.title === 'string' ? value.title : '';
    const markdown = given ?? (htmlToText(value.html) || title);
    const next: Record<string, unknown> = { ...value, markdown };
    if (files) next.files = files; else delete next.files;
    return { ok: true, value: next };
}

/**
 * The retention window an HTML page publishes under: the space's own, and never more than
 * HTML_PAGE_MAX_VERSIONS. A space that keeps everything (0) keeps five of a page. An append-only
 * space is left as it is: its history is its record.
 */
export function htmlPageRetention<T extends { create_only?: unknown; maxVersions?: unknown }>(
    ot: T | undefined, config: Pick<AimeatConfig, 'workspaceMaxVersions'>,
): T | { maxVersions: number } {
    if (ot?.create_only === true) return ot;
    const own = typeof ot?.maxVersions === 'number' && Number.isFinite(ot.maxVersions) && ot.maxVersions >= 0
        ? Math.floor(ot.maxVersions)
        : (config.workspaceMaxVersions > 0 ? Math.floor(config.workspaceMaxVersions) : 0);
    const window = own === 0 ? HTML_PAGE_MAX_VERSIONS : Math.min(own, HTML_PAGE_MAX_VERSIONS);
    return { ...(ot ?? {}), maxVersions: window } as T;
}

// ── The frame ───────────────────────────────────────────────────────────────────────────────────

/** Where a page may load a library from. The same three a Claude artifact may use, plus fonts. */
const LIBRARY_HOSTS = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com';

/**
 * The page frame's content policy. The sandbox gives the page an opaque origin: no cookie, no
 * storage, no session, no read of the node or of another page. Nothing leaves the page:
 * connect-src, form-action and frame-src are 'none', and images and media load only from the page's
 * own files or data. Only the node's own pages may frame it. Fixed per node: no page, owner or count
 * of anything changes its length.
 */
export function pageFrameCsp(pageOrigin: string, frameAncestors: string): string {
    return [
        'sandbox allow-scripts allow-forms allow-modals',
        "default-src 'none'",
        `script-src ${pageOrigin} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${LIBRARY_HOSTS}`,
        `style-src ${pageOrigin} 'unsafe-inline' https://fonts.googleapis.com ${LIBRARY_HOSTS}`,
        `font-src ${pageOrigin} data: https://fonts.gstatic.com ${LIBRARY_HOSTS}`,
        `img-src ${pageOrigin} data: blob:`,
        `media-src ${pageOrigin} data: blob:`,
        "connect-src 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        'worker-src blob:',
        "manifest-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        `frame-ancestors ${frameAncestors}`,
    ].join('; ');
}

/** Every powerful browser feature, off for the page. */
export const PAGE_PERMISSIONS_POLICY = [
    'camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()', 'serial=()', 'bluetooth=()',
    'hid=()', 'midi=()', 'display-capture=()', 'fullscreen=()', 'clipboard-read=()', 'clipboard-write=()',
    'publickey-credentials-get=()', 'screen-wake-lock=()', 'xr-spatial-tracking=()',
].join(', ');

/** Stored file types the frame serves beside a page. An HTML file is not one of them: the page is the one document. */
export function isServablePageFileType(mime: string): boolean {
    const m = (mime || '').toLowerCase().split(';')[0].trim();
    if (m.startsWith('image/') || m.startsWith('audio/') || m.startsWith('video/') || m.startsWith('font/')) return true;
    return m === 'text/css' || m === 'text/javascript' || m === 'application/javascript' || m === 'application/json'
        || m === 'text/plain' || m === 'text/csv' || m === 'application/font-woff' || m === 'application/font-woff2';
}

/**
 * The origin the page frame is served from: the configured page host, with the scheme and port of
 * the node's own address (a dev node on :40600 serves its pages on pages.localhost:40600). Null when
 * the node has no page host, and then an HTML page is shown as its text.
 */
export function pageOriginOf(config: Pick<AimeatConfig, 'pageHost' | 'baseUrl'>): string | null {
    const host = (config.pageHost || '').trim().toLowerCase();
    if (!host || !URL.canParse(config.baseUrl)) return null;
    const base = new URL(config.baseUrl);
    return `${base.protocol}//${host}${base.port ? `:${base.port}` : ''}`;
}
