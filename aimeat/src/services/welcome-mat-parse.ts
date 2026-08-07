/**
 * @file src/services/welcome-mat-parse.ts
 * @description Reading a welcome mat out of whatever the person pasted (aimeat_remake/
 *   03-welcome-mat.md). The paste comes from a chat window, so it arrives wrapped in whatever the
 *   model said around it — "Here's your welcome mat! Let me know if you want changes." The box
 *   therefore does NOT demand clean input: five attempts run in order and the first that hits wins.
 *
 *   The one thing it will not do is invent a page. A paste with no HTML in it at all is rejected,
 *   and the rejection names what was missing so the person knows what to fix. There is no skip:
 *   the mat is the condition of having a home, so "accept anything" would hand out homes to people
 *   whose AI produced nothing, which is the failure this gate exists to catch.
 * @structure
 *   - parseWelcomeMat(raw): the five levels → { ok, html, level, meta } or { ok:false, missing }
 *   - readWelcomeMatMeta(html): the four ai-* meta fields + title, all optional
 *   - WELCOME_MAT_BEGIN / _END: the markers the prompt asks the model to emit
 * @usage
 *   import { parseWelcomeMat } from '../services/welcome-mat-parse.js';
 *   const parsed = parseWelcomeMat(req.body.paste);
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 2).
 */

export const WELCOME_MAT_BEGIN = '<!-- AIMEAT WELCOME MAT BEGIN -->';
export const WELCOME_MAT_END = '<!-- AIMEAT WELCOME MAT END -->';

/** What the page says about the AI that wrote it. Every field is optional by design. */
export interface WelcomeMatMeta {
    /** The model's own claim about itself. Models get this wrong; it is kept for what it is. */
    model: string | null;
    vendor: string | null;
    /** The deciding field: MCP is a property of the client app, not of the model. */
    client: string | null;
    /** The model's own guess at its app's capability. Advisory — the alias map decides. */
    canMcp: 'yes' | 'no' | 'unknown' | null;
    title: string | null;
    /** What the page says the person is called, if the model filled it in. */
    authorSays: string | null;
    /** Whether the page carries <meta name="aimeat-welcome-mat">, i.e. followed the prompt. */
    declared: boolean;
}

/** Which of the five attempts read the page. Recorded because it grades the prompt, not the person. */
export type WelcomeMatLevel = 1 | 2 | 3 | 4;

export type WelcomeMatParse =
    | {
        ok: true;
        /** A complete HTML document, ready to store as the portfolio. */
        html: string;
        level: WelcomeMatLevel;
        /** True when level 4 had to build the document shell around a fragment. */
        wrapped: boolean;
        meta: WelcomeMatMeta;
    }
    | {
        ok: false;
        /**
         * `empty` — nothing was pasted. `no_html` — there was no page in it. `empty_page` — there
         * WAS a document but it has nothing in it, which is the shape a JSON blob mentioning
         * `<html></html>` takes, and which would otherwise hand someone a blank home.
         */
        reason: 'empty' | 'no_html' | 'empty_page';
        /**
         * What was looked for and not found, as machine keys the UI localizes. Naming the missing
         * thing is the difference between "try again" (which teaches nothing) and a person who
         * knows to ask their AI for a full HTML file.
         */
        missing: Array<'doctype' | 'html-tag' | 'body-tag' | 'content'>;
    };

/** Case-insensitive index of a needle, or -1. */
const idxOf = (hay: string, needle: string, from = 0): number =>
    hay.toLowerCase().indexOf(needle.toLowerCase(), from);

/**
 * Level 2: a fenced code block. Accepts ```html, ```HTML and a bare ``` — models label the fence
 * inconsistently, and a bare fence around a document is still a document.
 */
function fromCodeBlock(raw: string): string | null {
    // Non-greedy body, so the FIRST complete block wins rather than everything between the first
    // and last fence in a reply that contains two.
    const fenced = /```[ \t]*([a-zA-Z0-9]*)[ \t]*\r?\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = fenced.exec(raw)) !== null) {
        const langTag = (m[1] ?? '').toLowerCase();
        const body = m[2] ?? '';
        if (langTag && langTag !== 'html' && langTag !== 'htm') continue;   // a ```json block is not the page
        if (idxOf(body, '<html') >= 0 || idxOf(body, '<!doctype html') >= 0 || idxOf(body, '<body') >= 0) {
            return body.trim();
        }
    }
    return null;
}

/** Level 3: from the first doctype/`<html` to the last `</html>`. */
function fromDocumentTags(raw: string): string | null {
    const doctype = idxOf(raw, '<!doctype html');
    const htmlOpen = idxOf(raw, '<html');
    const starts = [doctype, htmlOpen].filter(i => i >= 0);
    if (starts.length === 0) return null;
    const start = Math.min(...starts);
    const closeIdx = raw.toLowerCase().lastIndexOf('</html>');
    if (closeIdx < start) return null;               // an opening tag with no close: let level 4 try
    return raw.slice(start, closeIdx + '</html>'.length).trim();
}

/**
 * Level 4: a body fragment with no document around it. Take from `<body` to the last `</body>`
 * (or to the end when the model forgot to close it) and build the shell. Slicing rather than
 * wrapping the whole paste is what keeps "Here you go!" out of the rendered page.
 */
function fromBodyFragment(raw: string): string | null {
    const start = idxOf(raw, '<body');
    if (start < 0) return null;
    const closeIdx = raw.toLowerCase().lastIndexOf('</body>');
    const end = closeIdx > start ? closeIdx + '</body>'.length : raw.length;
    return raw.slice(start, end).trim();
}

/**
 * Build a minimal document around a body fragment, carrying forward any ai-* metadata that was
 * sitting OUTSIDE the fragment. Dropping it would make the stored page unable to say which AI
 * wrote it, and that claim is the only thing the mat is read for besides being a page.
 */
function wrapFragment(fragment: string, meta: WelcomeMatMeta): string {
    const tags = [
        meta.declared ? '<meta name="aimeat-welcome-mat" content="1">' : '',
        meta.authorSays ? `<meta name="aimeat-author-says" content="${escapeAttr(meta.authorSays)}">` : '',
        meta.model ? `<meta name="ai-model" content="${escapeAttr(meta.model)}">` : '',
        meta.vendor ? `<meta name="ai-vendor" content="${escapeAttr(meta.vendor)}">` : '',
        meta.client ? `<meta name="ai-client" content="${escapeAttr(meta.client)}">` : '',
        meta.canMcp ? `<meta name="ai-can-mcp" content="${escapeAttr(meta.canMcp)}">` : '',
    ].filter(Boolean).map(t => `\n  ${t}`).join('');
    const title = escapeHtml(meta.title ?? 'Welcome');
    return `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>${title}</title>${tags}\n</head>\n${fragment}\n</html>\n`;
}

/** Quote-safe attribute value. */
function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Does this document actually show anything? A document with no text and no visual element is not
 * a welcome mat — it is the shape `{"html": "<html></html>"}` takes after extraction, and letting
 * it through would give someone a home whose front page is blank.
 */
function hasVisibleContent(html: string): boolean {
    const stripped = html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .trim();
    if (stripped.length > 0) return true;
    // A page can be entirely visual. Those count.
    return /<(img|svg|canvas|video|picture|iframe)\b/i.test(html);
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Read one `<meta name="X" content="Y">` value. Tolerates single quotes, attribute order and
 * arbitrary whitespace, because the page was written by a language model and not by a serializer.
 */
function metaContent(html: string, name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        // name= before content=
        new RegExp(`<meta\\s[^>]*name\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i'),
        // content= before name=
        new RegExp(`<meta\\s[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*name\\s*=\\s*["']${escaped}["']`, 'i'),
    ];
    for (const re of patterns) {
        const m = re.exec(html);
        if (m && typeof m[1] === 'string') {
            const v = m[1].trim();
            if (v) return v;
        }
    }
    return null;
}

/** The four ai-* fields plus the title. Everything is optional: a missing field costs one question. */
export function readWelcomeMatMeta(html: string): WelcomeMatMeta {
    const rawMcp = (metaContent(html, 'ai-can-mcp') ?? '').toLowerCase();
    const canMcp: WelcomeMatMeta['canMcp'] =
        rawMcp === 'yes' || rawMcp === 'true' ? 'yes'
            : rawMcp === 'no' || rawMcp === 'false' ? 'no'
                : rawMcp ? 'unknown' : null;
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return {
        model: metaContent(html, 'ai-model'),
        vendor: metaContent(html, 'ai-vendor'),
        client: metaContent(html, 'ai-client'),
        canMcp,
        title: titleMatch ? titleMatch[1].trim().slice(0, 200) || null : null,
        authorSays: metaContent(html, 'aimeat-author-says'),
        declared: metaContent(html, 'aimeat-welcome-mat') !== null,
    };
}

/**
 * The five attempts, in order, stopping at the first that hits (03-welcome-mat.md). Level 5 is the
 * rejection: there was no page in the paste. It names what was looked for, and the caller keeps the
 * person's text — a cleared box after a failed paste loses work the AI may not reproduce.
 */
export function parseWelcomeMat(raw: unknown): WelcomeMatParse {
    if (typeof raw !== 'string' || !raw.trim()) {
        return { ok: false, reason: 'empty', missing: ['doctype', 'html-tag', 'body-tag'] };
    }
    const text = raw.replace(/\r\n/g, '\n');

    // Level 1 — the markers the prompt asks for. Exact, and by far the cheapest to trust.
    const b = idxOf(text, WELCOME_MAT_BEGIN);
    const e = idxOf(text, WELCOME_MAT_END);
    if (b >= 0 && e > b) {
        const inner = text.slice(b + WELCOME_MAT_BEGIN.length, e).trim();
        if (inner) return complete(inner, 1, false);
    }

    // Level 2 — a fenced code block containing a page.
    const block = fromCodeBlock(text);
    if (block) return complete(block, 2, false);

    // Level 3 — a document sitting in the middle of prose.
    const doc = fromDocumentTags(text);
    if (doc) return complete(doc, 3, false);

    // Level 4 — a body fragment with no document around it. Metadata may sit outside it, so the
    // whole paste is what gets read for meta, and the shell carries it forward.
    const fragment = fromBodyFragment(text);
    if (fragment) {
        const meta = readWelcomeMatMeta(text);
        const wrapped = wrapFragment(fragment, meta);
        if (!hasVisibleContent(wrapped)) return { ok: false, reason: 'empty_page', missing: ['content'] };
        return { ok: true, html: wrapped, level: 4, wrapped: true, meta };
    }

    // Level 5 — no page here. Say which of the three things was absent.
    const missing: Array<'doctype' | 'html-tag' | 'body-tag'> = [];
    if (idxOf(text, '<!doctype html') < 0) missing.push('doctype');
    if (idxOf(text, '<html') < 0) missing.push('html-tag');
    if (idxOf(text, '<body') < 0) missing.push('body-tag');
    return { ok: false, reason: 'no_html', missing };
}

/** Shared tail for levels 1–3: the extracted text is already a document. */
function complete(html: string, level: WelcomeMatLevel, wrapped: boolean): WelcomeMatParse {
    if (!hasVisibleContent(html)) return { ok: false, reason: 'empty_page', missing: ['content'] };
    return { ok: true, html, level, wrapped, meta: readWelcomeMatMeta(html) };
}
