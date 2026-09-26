/**
 * @file public/components/Box.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The frame around one thing, as one component (the framed boxes of C3 in the component
 *   plan): the Object box and the settings box. A page passes the words and a tone named by meaning;
 *   it never writes a class. The shapes are the library's own in css/poster.css (.poster-box and its
 *   tones), which this component draws; css/components/box.css holds only what the shapes do not:
 *   the head and foot of a box, its padding and margin by meaning, and the tones that colour a frame.
 *   The meter (.poster-box--meter) is the Figure family's Meter (components/Figure.js).
 *
 *   Box tone (Jouni's decisions "Object box" and "Box"):
 *   - none: one thing, the 2px ink frame on the card ground.
 *   - 'raised': the thing that stands out, a row you opened or the way to take first (the heavier
 *     frame with the raised shadow).
 *   - 'copy': a text a person copies, on the grey ground, its parts padding themselves.
 *   - 'row': one result in a list, small padding.
 *   - 'attention': the frame in coral, a result that needs a look (a failed run).
 *   - 'waiting': the frame on the sun, a thing that waits (a run that waits for an answer).
 *   - 'current': the frame in coral, the one you are on (this device).
 *   - 'off': a dashed frame and grey words, a thing that is switched off.
 *   - 'edge': no frame, the sun edge at the left (.poster-panel): what a thing needs from elsewhere.
 *   - 'field': a field to fill in for one action (a test of an extension's action): the thin dashed
 *     frame on the page's ground (Jouni's decision "Dashed field box").
 *   - 'dim': the frame on the grey ground: optional under-the-hood details a person need not touch
 *     (an ecosystem app's technical details).
 *   `name` and `marks` draw the box's head (a name in bold with its tags beside it), `end` what stands
 *   at the right end of the head (the mark that hides the box); `doors` the row of ways at its foot.
 *   `as` is the element when the box is an item of a list ('li') or wraps a check box ('label').
 *   `flush`: the box's parts pad themselves (a chart, a picture, a table), so the box has no padding.
 *   `packed`: the box stands in a grid or a row with others, which space it; it has no margin.
 *   `scroll`: a long text (a document, a preview) scrolls inside the box after 24rem; `scroll="page"`
 *   after 32rem (a map of a whole structure).
 *   `beside`: the `doors` stand at the right of the words, not at the foot (a verdict and its one
 *   way on); under the words on a narrow screen.
 *   `folded`: a long text shows its first 22rem under a fade; `onUnfold` + `unfoldLabel` put the way
 *   to show all of it at the fade's foot (the page stops passing `folded` once it is open).
 *   `document`: the box holds a rendered document (Markdown: a preview, a charter, a version), whose
 *   words keep .75rem 1rem from the frame; with tone 'copy', whose parts otherwise pad themselves.
 *   The inside of a box is the page's: a page that lays its content out in a row or a grid writes
 *   its own element inside the box for it.
 *
 *   SettingBox: a box on a settings page with its label on a line of its own (the note's small
 *   aside); `irreversible` for one whose act cannot be undone. SettingRow is its line of words with
 *   the button at the right; SettingConfirm the line that asks for a word before the act.
 * @structure Box({ tone, flush, packed, scroll, folded, unfoldLabel, onUnfold, document, beside, as, name, marks, end, doors, id, role, ariaLabel, children }) ·
 *   SettingBox({ label, irreversible, children }) · SettingRow({ children }) ·
 *   SettingConfirm({ children }) · boxClass(tone) · BoxList({ apart, children }) ·
 *   BoxLine({ name, meta, time, end, column, doors, after, children })
 * @usage html`<${Box}>…<//>` · html`<${Box} tone="raised">…<//>` ·
 *        html`<${Box} name=${pkg.name} marks=${html`<${Mark}>…<//>`} doors=${…}>…<//>` ·
 *        html`<${SettingBox} label=${t('x.export')} irreversible>…<//>`
 * @version-history
 *   v1.6.0 — 2026-09-26 — Tone 'dim' (the grey ground: main's Ecosystem .pf-eco-tech), `scroll="page"`
 *     (32rem: main's organism structure map, .pj-struct-body) and `beside` (the doors at the right of
 *     the words: main's Workflows .wp-verdict); additive, fix pass.
 *   v1.5.0 — 2026-09-26 — BoxList and BoxLine: a stack of small boxes, one thing in each (the AI tab's
 *     decision, transparency and compliance cards: main's .pf-aitr-list, .pf-aitr-row, .pf-aitr-policy,
 *     .pf-cmp-entries); additive, page group G8.
 *   v1.4.0 — 2026-09-26 — Tone 'field': the Dashed field box (Jouni's decision) around a field to fill
 *     in for one action, Extensions' action test (main's .ex-test; page group G6; additive).
 *   v1.3.0 — 2026-09-26 — Tone 'edge': the sun edge at the left instead of a frame (.poster-panel),
 *     for what a thing needs from elsewhere (Packages' "this node must already have", main's
 *     .pk-expects; page group G7; additive).
 *   v1.2.0 — 2026-09-26 — The document option: a rendered document's words keep their space from the
 *     frame on the copy ground (formerly .pf-nb-enrich-preview-body's padding; page group G4; additive).
 *   v1.1.0 — 2026-09-26 — The folded option: a long text under a fade with "show all" at its foot
 *     (the Skills page's SKILL.md), so the page writes no class (page group G7; additive).
 *   v1.0.0 — 2026-09-26 — Initial: the Object box and the settings box as one component, so
 *     the Settings & Controls pages give data and never a class (component plan C3, the framed boxes).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** The poster.css tones and the frame colours this component adds. */
const SHAPE_TONES = new Set(['raised', 'copy', 'row']);
const FRAME_TONES = new Set(['attention', 'waiting', 'current', 'off', 'dim']);
const ELEMENTS = new Set(['div', 'li', 'label', 'section', 'article']);

/**
 * The classes of a box in a tone, for the family's own components (Card, Road) that draw their
 * tiles in the Object box. A page calls Box, never this.
 */
export function boxClass(tone) {
    return cx('poster-box', SHAPE_TONES.has(tone) && `poster-box--${tone}`, FRAME_TONES.has(tone) && `box--${tone}`);
}

/** The Object box. */
export function Box({ tone, flush, packed, scroll, folded, unfoldLabel, onUnfold, document, beside, as = 'div', name, marks, end, doors, id, role, ariaLabel, children }) {
    const El = ELEMENTS.has(as) ? as : 'div';
    const head = name || marks || end ? html`<div class="box-head">${name ? html`<b class="box-name">${name}</b>` : null}${marks}${end ? html`<span class="box-end">${end}</span>` : null}</div>` : null;
    // folded (added by page group G7): a long text shows its first 22rem under a fade, with the way
    // to show all of it at the fade's foot (the Skills page's SKILL.md, formerly .sk-md + .sk-fade).
    const fade = folded && onUnfold ? html`<div class="box-fade"><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${onUnfold}>${unfoldLabel}</button></div>` : null;
    // document (added by page group G4, living): a rendered document keeps its words off the frame.
    // tone 'edge' (added by page group G7, Packages): not a frame but the sun edge at the left
    // (poster.css .poster-panel), for what a thing needs from elsewhere (main's .pk-expects).
    // tone 'field' (added by page group G6, Extensions): a field to fill in for one action, in the thin
    // dashed frame on the page's ground (Jouni's decision "Dashed field box"; main's .ex-test).
    const shape = tone === 'edge' ? 'poster-panel box--edge' : tone === 'field' ? 'box--field' : boxClass(tone);
    // scroll="page" (added by the fix pass): the long text scrolls after 32rem, not 24rem (main's
    // organism structure map, .pj-struct-body).
    const cls = cx(shape, 'box', flush && 'box--flush', packed && 'box--packed', scroll && 'box--scroll', scroll === 'page' && 'box--scroll-page',
        folded && 'box--folded', document && 'box--document');
    const foot = doors ? html`<div class="og-doors box-doors">${doors}</div>` : null;
    // beside (added by the fix pass): the doors stand at the right of the words, in the middle of
    // their height, and under them on a narrow screen (main's Workflows verdict, .wp-verdict).
    if (beside && doors) {
        return html`<${El} class=${cls} id=${id} role=${role} aria-label=${ariaLabel}>
            <div class="box-beside"><div class="box-beside-words">${head}${children}${fade}</div>${foot}</div>
        <//>`;
    }
    return html`<${El} class=${cls} id=${id} role=${role} aria-label=${ariaLabel}>
        ${head}${children}${fade}${foot}
    <//>`;
}

/**
 * A stack of small boxes, one thing in each (added by page group G8: the AI tab's cards, main's
 * .pf-aitr-list and .pf-cmp-entries): no bullets, .4rem between the boxes. `apart`: .3rem above it.
 */
export function BoxList({ apart, children }) {
    return html`<ul class=${cx('box-list', apart && 'box-list--apart')}>${children}</ul>`;
}

/**
 * One small box in a BoxList (added by page group G8, main's .pf-aitr-row, .pf-aitr-policy and the
 * compliance entries): the row tone of the Object box with its parts in a wrapping line: the `name`
 * (600, .85rem), each of `meta` (a string or a list: the grey typewriter lines), the `time`, what
 * the page gives as children (a link, a check line, a message), and `doors` (its actions).
 * `column`: the parts stand under each other, full width (a policy line, a rule, a provider).
 * `end`: a word at the far end of the line in grey (a use case's risk class).
 * A `meta` entry may be `{ text, keep: true }`: a line a browser must not translate (an address).
 * `after`: what stands after the doors (the message the doors caused).
 */
export function BoxLine({ name, meta, time, end, column, doors, after, children }) {
    const metas = (Array.isArray(meta) ? meta : [meta]).filter((m) => m !== undefined && m !== null && m !== false && m !== '');
    return html`<li class=${cx('poster-box', 'poster-box--row', 'box-line', column && 'box-line--column', end !== undefined && end !== null && 'box-line--split')}>
        ${name !== undefined && name !== null && name !== '' ? html`<span class="box-line-name">${name}</span>` : null}
        ${metas.map((m, i) => (m && typeof m === 'object' && 'keep' in m
            ? html`<span class="listing-meta box-line-meta" translate="no" key=${'m' + i}>${m.text}</span>`
            : html`<span class="listing-meta box-line-meta" key=${'m' + i}>${m}</span>`))}
        ${time ? html`<time class="poster-time box-line-meta">${time}</time>` : null}
        ${end !== undefined && end !== null ? html`<span class="box-line-end">${end}</span>` : null}
        ${children}
        ${doors ? html`<span class="og-doors box-line-doors">${doors}</span>` : null}
        ${after}
    </li>`;
}

/** A box on a settings page: its label on a line of its own over the words. */
export function SettingBox({ label, irreversible, children }) {
    return html`<div class=${cx('og-box', 'poster-aside', 'poster-aside--small', irreversible && 'poster-aside--irreversible')}>
        ${label ? html`<span class="poster-label">${label}</span>` : null}${children}
    </div>`;
}

/** The settings box's line of words with its button at the right. */
export function SettingRow({ children }) {
    return html`<div class="og-box-row">${children}</div>`;
}

/** The settings box's line that asks for a word before the act: the field, then the button. */
export function SettingConfirm({ children }) {
    return html`<div class="og-box-confirm">${children}</div>`;
}

export default Box;
