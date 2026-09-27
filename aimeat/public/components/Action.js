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
 *     'link' (a coral word inside a sentence or a fact's value, in the words' own letters: the crumb
 *     link; `small`, `soft` and `row` do not apply to it).
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
const TONES = new Set(['danger', 'more', 'text', 'quiet', 'back', 'notice', 'jump']);

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
    const cls = tone === 'link' ? cx('og-crumb-link', copied && 'copied') : cx('poster-action', small && 'poster-action--small', soft && 'poster-action--lower',
        row && 'poster-action--row', TONES.has(tone) && `poster-action--${tone}`, copied && 'copied',
        rest.pressed && 'is-on');
    return html`<${Press} ...${rest} cls=${cls} title=${(copied && copiedTitle) || title}
        onClick=${copy !== undefined && copy !== null ? run : onClick}>${copied ? (copiedLabel || t('common.copied')) : children}<//>`;
}

/** The loud action: the dark block with the sun shadow. */
export function Loud({ control, large, danger, quiet, copy, copiedLabel, copiedTitle, onCopied, onClick, title, children, ...rest }) {
    const [copied, run] = useCopy(copy, onCopied, onClick);
    // quiet (added by page group G9): not its turn yet, so the action link; the same element.
    const cls = quiet ? cx('poster-action', copied && 'copied') : cx('poster-slab', control && 'poster-slab--control', large && 'poster-slab--large',
        danger && 'poster-slab--danger', copied && 'copied');
    return html`<${Press} ...${rest} cls=${cls} title=${(copied && copiedTitle) || title}
        onClick=${copy !== undefined && copy !== null ? run : onClick}>${copied ? (copiedLabel || t('common.copied')) : children}<//>`;
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
 * at the foot of an opened panel (space above it); `end` puts the row at the right.
 */
export function Actions({ under, end, children }) {
    return html`<div class=${cx('og-doors', under && 'listing-open-doors', end && 'og-doors--end')}>${children}</div>`;
}

export default Action;
