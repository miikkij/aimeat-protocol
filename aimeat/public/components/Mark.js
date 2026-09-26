/**
 * @file public/components/Mark.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The small marks a page puts beside a thing, as one component (C6 of the component
 *   plan): the tag, the status, the count, the time, the row label, and the code in a line. A page
 *   passes the words and a tone named by meaning; it never writes a class. The look is the library's
 *   own mark shapes in css/poster.css (.poster-chip, .poster-status, .poster-count, .poster-time,
 *   .poster-label) and css/components/code-block.css.
 *
 *   - Mark kind="tag" (the default): names a kind, a version, a role or a relation. tone = 'sun' (the
 *     chosen one, the one that counts now) | 'coral' (the one to notice) | 'ink' (yours) | 'dim' (it
 *     counts nothing yet: main's .og-chip--dim, which the previous branch lost) | 'fine' (the success
 *     colour: main's .pf .badge-success, e.g. a knowledge hit, a step for an agent). `onRemove`
 *     adds the remove mark after its name.
 *   - Mark kind="status": says a state. tone = 'fine' | 'attention' | 'danger' | 'off'.
 *   - Mark kind="count": a small number. tone = 'waiting' (something waits for the person) | 'tally'
 *     (it only says how many); `small` for one that sits on an icon.
 *   - Mark kind="time": when a thing happened.
 *   - Label: the row label over a field, a column, a box.
 *   - Marks: a row of tags.
 *   - Code: an identifier in a line; `block` for lines of code or a prompt to copy; `block scroll` for
 *     a long one (a schema) that scrolls inside after 200px, as main's service schema did; `block tall`
 *     for a prompt to copy that scrolls only after 24rem (the MCP page's proof and organism prompts).
 *     `scroll` also takes a size: "medium" scrolls after 300px (an agent's stored value, its config
 *     file), "large" after 400px (a crew's try output), "page" after 32rem (a workflow's run record).
 *     `blurred` (inline): a secret shown blurred until the person asks to see it (the recovery key).
 * @structure Mark({ kind, tone, small, title, onRemove, removeLabel, presence, away, children }) · Marks({ children }) ·
 *   Label({ htmlFor, block, children }) · Code({ block, scroll, tall, blurred, change, children })
 * @usage html`<${Mark} tone="sun">${t('x.mine')}<//>` · html`<${Mark} kind="status" tone="fine">OK<//>`
 * @version-history
 *   v1.12.0 — 2026-09-26 — Code block `scroll` takes a size, "medium" (300px), "large" (400px) or
 *     "page" (32rem): main's caps for an agent's stored value and config preview (.pf-agd-memory-preview,
 *     .pf-agd-config-preview), a crew's try output (.pf-agd-crew-try-output) and a workflow's run
 *     record (.wp-code); `scroll` alone keeps 200px. Additive, fix pass.
 *   v1.11.0 — 2026-09-26 — A tag's `live`: a small green square before its words, a connection that
 *     works (the Settings overview's "MCP connected" and federation tags, main's .pf-fed-dot);
 *     additive, page group G8.
 *   v1.10.0 — 2026-09-26 — `explains`: a mark whose tooltip says why takes the help pointer (the
 *     Ecosystem page's validation Status, main's .pf-eco-valid); additive, page group G5.
 *   v1.9.0 — 2026-09-26 — A tag's `presence` ('online' | 'idle' …: the status dot after the name) and
 *     `away` (the coral word while it is away): an agent's tag on the Offers pages (main's .op-agent);
 *     additive, page group G6.
 *   v1.8.0 — 2026-09-26 — Code block `change` = 'added' | 'removed': the heavy left edge in green or
 *     coral that says what a draft adds or removes (the Apps page's diff); additive, page group G6.
 *   v1.7.0 — 2026-09-26 — A tag that is a button takes `expanded` (aria-expanded: the agent's
 *     capabilities tag opens the full list under it). Additive, page group G1a.
 *   v1.6.0 — 2026-09-26 — The tag's fine tone (green frame and words, main's .pf .badge-success: a
 *     knowledge hit and a step that goes to an agent in the Notebook); its rule is
 *     css/components/mark.css. Additive, by page group G4 (notebook).
 *   v1.5.0 — 2026-09-26 — Code's `blurred` option (the Access page's recovery key, blurred until
 *     shown, as main's .ac-keybox code did); additive, by page group G3.
 *   v1.4.0 — 2026-09-26 — Code's `tall` option (a prompt to copy that scrolls after 24rem: the MCP
 *     page's .mc-code); additive, by page group G6.
 *   v1.3.0 — 2026-09-26 — A tag with `onClick` is a button (the visibility tag of memory and
 *     documents: press it to change who may see); its pointer is css/components/mark.css. Additive,
 *     by page group G8.
 *   v1.2.0 — 2026-09-26 — Code's `scroll` option (a block that scrolls after 200px: the Services tab's
 *     schemas, svc-detail-code on main); additive, by page group G4.
 *   v1.1.0 — 2026-09-26 — The tag's dim tone, put back from main (og-chip--dim).
 *   v1.0.0 — 2026-09-26 — Initial (component plan C6).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const SCROLL_SIZES = new Set(['medium', 'large', 'page']);

const KIND = {
    tag: { base: 'poster-chip', tones: ['sun', 'coral', 'ink', 'dim', 'fine'] },
    status: { base: 'poster-status', tones: ['fine', 'attention', 'danger', 'off'] },
    count: { base: 'poster-count', tones: ['waiting', 'tally'] },
    time: { base: 'poster-time', tones: [] },
};

/**
 * `onRemove` adds the remove mark (`removeGlyph`, ✗ by default) after the name; `whole` makes the
 * whole tag the button that removes it, the mark greying to coral while the pointer is on the tag.
 */
export function Mark({ kind = 'tag', tone, small, title, onRemove, removeLabel, removeGlyph = '✗', whole, onClick, expanded, presence, away, explains, live, children }) {
    const k = KIND[kind] || KIND.tag;
    // `explains` (added by page group G5): the tooltip says why (a failed validation's checks), so
    // the pointer is the help pointer (main's .pf-eco-valid).
    const cls = cx(k.base, k.tones.includes(tone) && `${k.base}--${tone}`, small && kind === 'count' && 'poster-count--small', explains && 'mark-explains');
    if (kind === 'time') return html`<time class=${cls} title=${title}>${children}</time>`;
    if (onClick && !onRemove) return html`<button type="button" class=${cx(cls, 'mark-button')} title=${title}
        aria-expanded=${expanded === undefined ? undefined : String(!!expanded)} onClick=${onClick}>${children}</button>`;
    const what = removeLabel || t('common.remove');
    if (onRemove && whole) {
        return html`<button type="button" class=${cx(cls, 'tag-removable')} title=${title || what} onClick=${onRemove}>${children} <span class="poster-chip-x">${removeGlyph}</span></button>`;
    }
    // `presence` (added by page group G6): a tag that names an agent says whether it is there, with
    // the status dot after its name ('online' | 'idle' …) and, while it is away, `away`: the word in
    // coral (the Offers pages' agent tag, main's .op-agent).
    if (presence) {
        return html`<span class=${cx(cls, 'mark-presence')} title=${title}>${children}<span class=${`status-dot status-dot--${presence}`}></span>${away ? html` <em class="mark-away">${away}</em>` : null}</span>`;
    }
    // `live` (added by page group G8): a small green square before the words, a connection that
    // works (the overview's "MCP connected" and "connected to N nodes", main's .pf-fed-dot).
    if (live) {
        return html`<span class=${cx(cls, 'mark-live')} title=${title}><span class="mark-live-dot" aria-hidden="true"></span>${children}</span>`;
    }
    return html`<span class=${cls} title=${title}>${children}${onRemove ? html` <button type="button" class="poster-chip-x"
        title=${what} aria-label=${what} onClick=${onRemove}>${removeGlyph}</button>` : null}</span>`;
}

export function Marks({ children }) {
    return html`<div class="poster-chips">${children}</div>`;
}

/** The row label. `block` stands it on a line of its own; `htmlFor` ties it to a field. */
export function Label({ htmlFor, block, children }) {
    if (htmlFor) return html`<label class=${cx('poster-label', block && 'poster-label--block')} for=${htmlFor}>${children}</label>`;
    return html`<span class=${cx('poster-label', block && 'poster-label--block')}>${children}</span>`;
}

export function Code({ block, scroll, tall, blurred, change, children }) {
    // `change` (added by page group G6): 'added' | 'removed', the lines a draft adds or removes, said by
    // a heavy edge on the block's left, green or coral (the Apps page's draft diff, main's .ap-code--add/--del).
    const edge = change === 'added' || change === 'removed' ? `code-block--${change}` : null;
    // A `scroll` size (added by the fix pass): 'medium' 300px, 'large' 400px, 'page' 32rem (main's caps).
    const size = SCROLL_SIZES.has(scroll) ? `code-block--scroll-${scroll}` : null;
    return block ? html`<pre class=${cx('code-block', scroll && 'code-block--scroll', size, tall && 'code-block--tall', edge)}>${children}</pre>` : html`<code class=${cx('code-inline', blurred && 'code-inline--blurred')}>${children}</code>`;
}

export default Mark;
