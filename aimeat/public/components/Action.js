/**
 * @file public/components/Action.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every way on a page offers, as one component (C7 of the component plan): the action
 *   link, the loud action, the icon button, a copy that says it copied, and the row that holds them.
 *   A page passes the words, what happens, and named options; it never writes a class. The look is
 *   the library's own action shapes in css/poster.css (.poster-action, .poster-slab, .poster-icon),
 *   which the whole site and the app catalogue draw from one place, so a theme reaches all of them.
 *
 *   Named options, each one a meaning:
 *   - Action: `small` (the Settings size), `soft` (a softer way on, lower-case words), `row` (at the
 *     end of a dense row), `tone` = 'danger' (it removes or revokes) | 'more' (show more of a list,
 *     open a thing by its name) | 'text' (a plain grey word) | 'quiet' | 'back' | 'notice' | 'jump' |
 *     'plain' (a grey word in the page's own letters, no line: the old app catalogue's "▶ toggle") |
 *     'link' (a coral word inside a sentence or a fact's value, in the words' own letters: the crumb
 *     link; `small`, `soft` and `row` do not apply to it) | 'dashed' (the link word with a dashed coral
 *     line under it: a door inside running text, the old app catalogue's "generated") | 'inline' (an
 *     ink word with its line under it inside running text, bold, in the words' own case and size;
 *     `small` a step smaller: the old app catalogue's "Read Article 50 →" and "Open →") | 'file' (the
 *     link word in the typewriter face, a link to a file: the app catalogue's "View odps.yaml").
 *   - Loud: the one action a place is for; `control` in a row of controls, `large`, `danger` for an
 *     act that cannot be undone; `quiet` while it is not yet (or no longer) the thing to do: drawn as
 *     the action link, the same button, so a press or focus is not lost when it turns loud.
 *   - Icon: a button that is a mark, not a word; `small`, `pressed`.
 *   - `copy`: on any of the three, the text it copies; it says `copiedLabel` for a moment after.
 *   - `href`: the action is a link (`newTab`, `download` for a file link).
 * @structure Action(props) · Loud(props) · Icon(props) · Actions({ under, end, children })
 * @usage html`<${Action} small onClick=${open}>${t('x.open')}<//>`
 *        html`<${Action} small soft tone="danger" onClick=${remove}>${t('x.remove')}<//>`
 *        html`<${Loud} control disabled=${busy} onClick=${save}>${t('x.save')}<//>`
 *        html`<${Action} small copy=${ref} copiedLabel=${t('x.copied')}>${t('x.copyRef')}<//>`
 *        html`<${Actions}>…<//>`
 * @version-history
 *   v1.14.0 — 2026-09-27 — Action tone 'file' (.og-crumb-link--file): a link to a file in the
 *     typewriter face (the old app catalogue's .od-link), appcat parity (sections-d); additive,
 *     crumb-trail.css.
 *   v1.13.0 — 2026-09-27 — Actions `tight`: the parts 8px apart (the old detail's skill picker row);
 *     additive, appcat parity (sections-b), page-section.css .og-doors--tight.
 *   v1.12.0 — 2026-09-27 — Action tone 'inline' (.og-crumb-link--inline): an ink word with its line
 *     inside running text (the old app catalogue's .mk-legal-link, .lg-open), appcat parity
 *     (sections-c); additive, crumb-trail.css.
 *   v1.11.0 — 2026-09-27 — Actions `apart`: the row 10px apart from what is above and below it (the
 *     old app catalogue's .dtl-seo-switch), appcat parity (sections-c); additive, page-section.css
 *     .og-doors--apart.
 *   v1.10.0 — 2026-09-27 — Actions `chapter`: the door row of a chapter (the old app catalogue's
 *     detail .dtl-btn-row), appcat parity (sections-a); additive, page-section.css .og-doors--chapter.
 *   v1.9.0 — 2026-09-27 — Action tone 'dashed' (.og-crumb-link--dashed): the link word over a dashed
 *     coral line (the old app catalogue's .cat-dashed), appcat parity; additive, crumb-trail.css.
 *   v1.8.0 — 2026-09-27 — Action tone 'plain' (.poster-action--plain): the old app catalogue's grey
 *     "▶ toggle" over its Active Extensions strip; additive, appcat parity.
 *   v1.7.0 — 2026-09-27 — Loud `mark`: a sign before the words (the app catalogue's "+ Create an
 *     app"); under 900px the sign alone stands and the words are said only to a screen reader
 *     (appcat); additive.
 *   v1.6.0 — 2026-09-27 — Loud `quiet`: the place's action while it waits for its turn (a name not
 *     yet typed, a prompt already copied) is drawn as the action link, one button that turns loud
 *     when it can act (the home's steps, which wrote the two classes in turn); page group G9, additive.
 *   v1.5.0 — 2026-09-26 — `form`: a submit outside its form names the form (a dialog footer's "do
 *     it", the Apps page's publish dialog); page group G6, additive.
 *   v1.4.0 — 2026-09-26 — `noReferrer` on a link that opens beside (rel noopener noreferrer: an
 *     agent's own host, an address a principal supplied); page group G1a, additive.
 *   v1.3.0 — 2026-09-26 — `onMouseEnter` and `onFocus` reach the element: an action that prepares its
 *     work while the pointer or the keyboard comes to it (App development's build prompt; page group
 *     G6, additive).
 *   v1.2.0 — 2026-09-26 — Action `pressed` draws the pressed look (.poster-action.is-on): Listen while
 *     it reads keeps main's pale coral ground.
 *   v1.1.0 — 2026-09-26 — The link tone: a coral word inside a sentence or a value (.og-crumb-link),
 *     so a copy or a jump inside a fact needs no class (page group G7; additive).
 *   v1.0.0 — 2026-09-26 — Initial: the action link, the loud action and the icon button as one
 *     component, so the Settings & Controls pages give data and never a class (component plan C7).
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
import { copyToClipboard } from '/js/utils.js';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const TONES = new Set(['danger', 'more', 'text', 'quiet', 'back', 'notice', 'jump', 'plain']);

/** A click that copies `copy` and says so for two seconds. */
function useCopy(copy, onCopied, onClick) {
    const [copied, setCopied] = useState(false);
    const run = useCallback(async (e) => {
        if (copy === undefined || copy === null) { onClick?.(e); return; }
        await copyToClipboard(String(copy));
        setCopied(true);
        onCopied?.();
        setTimeout(() => setCopied(false), 2000);
    }, [copy, onCopied, onClick]);
    return [copied, run];
}

/** The element every action draws: a link when it has an href, otherwise a button. */
function Press({ cls, href, newTab, noReferrer, download, onClick, disabled, title, ariaLabel, pressed, expanded, id, type, role, children, busy, onMouseEnter, onFocus, form }) {
    // form (added by page group G6): a submit that stands outside its form names it (a dialog's
    // footer: the Apps page's publish dialog).
    // onMouseEnter / onFocus (added by page group G6): an action that prepares what it will do while
    // the pointer or the keyboard comes to it (App development's "Copy" fetches the build prompt).
    // noReferrer (added by page group G1a): a link to an address a principal supplied (an agent's
    // host) tells that address nothing about the page it came from.
    if (href) {
        return html`<a class=${cls} href=${href} id=${id} title=${title} aria-label=${ariaLabel}
            target=${newTab ? '_blank' : undefined} rel=${newTab ? (noReferrer ? 'noopener noreferrer' : 'noopener') : undefined}
            download=${download === true ? '' : download} onClick=${onClick} role=${role}
            onMouseEnter=${onMouseEnter} onFocus=${onFocus}>${children}</a>`;
    }
    return html`<button type=${type || 'button'} class=${cls} id=${id} title=${title} aria-label=${ariaLabel}
        aria-pressed=${pressed === undefined ? undefined : String(!!pressed)}
        aria-expanded=${expanded === undefined ? undefined : String(!!expanded)} aria-busy=${busy ? 'true' : undefined}
        role=${role} disabled=${disabled} form=${form} onClick=${onClick} onMouseEnter=${onMouseEnter} onFocus=${onFocus}>${children}</button>`;
}

/** The action link: an underlined word. */
export function Action({ small, soft, row, tone, copy, copiedLabel, copiedTitle, onCopied, onClick, title, children, ...rest }) {
    const [copied, run] = useCopy(copy, onCopied, onClick);
    // tone 'link' (added by page group G7): a coral word inside a sentence or a fact's value, in the
    // words' own letters (the crumb link, .og-crumb-link; formerly CopyButton className="og-crumb-link").
    // tone 'dashed' (added by appcat's dialogs, parity): the link word with a dashed coral line under
    // it, a door inside running text (the old catalogue's .cat-dashed: "generated" in the Add dialog).
    // tone 'inline' (added by appcat sections-c, parity): an ink word with its line under it inside
    // running text, in the words' own case and size, bold; `small` a step smaller (the old catalogue's
    // "Read Article 50 →" .mk-legal-link and a legal page's "Open →" .lg-open).
    const cls = tone === 'inline' ? cx('og-crumb-link', 'og-crumb-link--inline', small && 'og-crumb-link--small', copied && 'copied')
      // tone 'file' (added by appcat sections-d, parity): the link word in the typewriter face, a step
      // smaller, underlined only under the pointer: a link to a file (the old catalogue's odps.yaml, .od-link).
      : tone === 'file' ? cx('og-crumb-link', 'og-crumb-link--file', copied && 'copied')
      : tone === 'link' || tone === 'dashed' ? cx('og-crumb-link', tone === 'dashed' && 'og-crumb-link--dashed', copied && 'copied') : cx('poster-action', small && 'poster-action--small', soft && 'poster-action--lower',
        row && 'poster-action--row', TONES.has(tone) && `poster-action--${tone}`, copied && 'copied',
        rest.pressed && 'is-on');
    return html`<${Press} ...${rest} cls=${cls} title=${(copied && copiedTitle) || title}
        onClick=${copy !== undefined && copy !== null ? run : onClick}>${copied ? (copiedLabel || t('common.copied')) : children}<//>`;
}

/** The loud action: the dark block with the sun shadow. */
export function Loud({ control, large, danger, quiet, mark, copy, copiedLabel, copiedTitle, onCopied, onClick, title, children, ...rest }) {
    const [copied, run] = useCopy(copy, onCopied, onClick);
    // quiet (added by page group G9): not its turn yet, so the action link; the same element.
    const cls = quiet ? cx('poster-action', copied && 'copied') : cx('poster-slab', control && 'poster-slab--control', large && 'poster-slab--large',
        danger && 'poster-slab--danger', copied && 'copied');
    // mark (added for appcat): the sign before the words, which alone stands on a phone.
    const words = mark !== undefined && mark !== null && !copied ? html`${mark} <span class="poster-slab-words">${children}</span>` : null;
    return html`<${Press} ...${rest} cls=${cls} title=${(copied && copiedTitle) || title}
        onClick=${copy !== undefined && copy !== null ? run : onClick}>${copied ? (copiedLabel || t('common.copied')) : (words || children)}<//>`;
}

/** The icon button: a square with a mark in it. The mark is the child; `label` names it for a
 *  screen reader and the tooltip. */
export function Icon({ small, pressed, label, title, copy, copiedLabel, onCopied, onClick, children, ...rest }) {
    const [copied, run] = useCopy(copy, onCopied, onClick);
    const cls = cx('poster-icon', small && 'poster-icon--small', pressed && 'is-on');
    return html`<${Press} ...${rest} cls=${cls} title=${title ?? label} ariaLabel=${label}
        pressed=${pressed === undefined ? undefined : pressed}
        onClick=${copy !== undefined && copy !== null ? run : onClick}>${copied ? (copiedLabel || '✓') : children}<//>`;
}

/**
 * The row the actions of a place stand in: one gap, one line, wrapping on a phone. `under` is the row
 * at the foot of an opened panel (space above it); `end` puts the row at the right. `chapter` (added
 * by appcat sections-a, parity) is the row of a chapter of a long page of one thing, the old app
 * catalogue's detail sections (.dtl-btn-row with its .dtl-btn words and slabs: 24px apart, .78rem).
 * `apart` (added by appcat sections-c, parity) stands the row 10px apart from what is above and below
 * it (the old detail's rows of one door each: .dtl-seo-switch, .dtl-seo-wording). `tight` (added by
 * appcat sections-b, parity) puts its parts 8px apart: a picker's row of a door, a choice and a door
 * (the old detail's skill picker).
 */
export function Actions({ under, end, chapter, apart, tight, children }) {
    return html`<div class=${cx('og-doors', under && 'listing-open-doors', end && 'og-doors--end', chapter && 'og-doors--chapter', apart && 'og-doors--apart', tight && 'og-doors--tight')}>${children}</div>`;
}

export default Action;
