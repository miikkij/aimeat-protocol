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
 *   - Action: `control` (a box as tall as the control cut, a touch target), `small` (the Settings
 *     size), `soft` (a softer way on, lower-case words), `row` (at the
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
 *   v1.18.0 — 2026-11-27 — Chevron `down`, `up` and `small`: one drawn disclosure mark for every
 *     part that opens in place (down while open, right while closed), replacing the ▼ ▾ ▸ ▶ ▲ ⌄ ⌃
 *     letters; `left` and the right default are unchanged. Glyph: the drawn expand, shrink, more,
 *     refresh and download marks that replace ⤢ ⤡ ⋯ ↻ ⤓ ⬇ in icon controls. Additive.
 *   v1.17.0 — 2026-11-27 — Glyph: the drawn close, star, star-filled, mic, attach, speaker, pause,
 *     link, external, calendar, image, music, video, agent, person, people, app, lock, key, bell,
 *     warning, info, edit, mail, chart, copy, chat, folder, upload, clock and note marks that replace emoji in
 *     icon controls and status marks across Settings & Controls, the home and the components;
 *     Glyph `label` names a mark that is the only signal of a state. Additive.
 *   v1.16.0 — 2026-11-27 — Chevron: the drawn mark of a fold control (the Settings menu, the
 *     messenger's list). Glyph: the drawn archive, delete and search marks that replace emoji in
 *     icon controls. Additive.
 *   v1.15.0 — 2026-10-21 — Action `control`: the action link in a box as tall as the control cut
 *     (44px, poster.css .poster-action--control), a touch target on a phone. Additive.
 *   v1.14.0 — 2026-09-27 —Action tone 'file' (.og-crumb-link--file): a link to a file in the
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
export function Action({ small, soft, row, control, tone, copy, copiedLabel, copiedTitle, onCopied, onClick, title, children, ...rest }) {
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
        row && 'poster-action--row', control && 'poster-action--control', TONES.has(tone) && `poster-action--${tone}`, copied && 'copied',
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
/**
 * The mark of a fold control (added 2026-11-27 for the Settings menu and the messenger's list): a
 * chevron that points the way the folded part moves, drawn so a theme's colour reaches it.
 * `down` and `up` (added v1.18.0): the disclosure mark of a part that opens in place, down while it
 * is open and right (the default) while it is closed; up only where the control collapses upward.
 * `small` draws it at 12px for a mark set in small letters (a menu group, a heading's caret).
 * @param {{ left?: boolean, down?: boolean, up?: boolean, small?: boolean }} props
 */
export function Chevron({ left, down, up, small }) {
    const size = small ? 12 : 16;
    const path = up ? html`<path d="M3 10.5l5-5 5 5" />` : down ? html`<path d="M3 5.5l5 5 5-5" />`
      : left ? html`<path d="M10 3 5 8l5 5" />` : html`<path d="M6 3l5 5-5 5" />`;
    return html`<svg viewBox="0 0 16 16" width=${size} height=${size} aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${path}</svg>`;
}

/** The drawn marks of an Icon (added 2026-11-27): an emoji in a control is not drawn by the theme and
 *  reads as noise; these take the text colour. */
const MARKS = {
    archive: html`<path d="M2.5 3.5h11v3h-11z" /><path d="M3.5 6.5v6h9v-6" /><path d="M6.5 9h3" />`,
    trash: html`<path d="M2.5 4.5h11" /><path d="M6 4.5V3h4v1.5" /><path d="M4 4.5l.7 9h6.6l.7-9" /><path d="M6.8 7v4.5M9.2 7v4.5" />`,
    search: html`<circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 13.5 13.5" />`,
    restore: html`<path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 2.5v3h3" />`,
    shield: html`<path d="M8 1.8 13 3.6v4.2c0 3-2.2 5.3-5 6.4-2.8-1.1-5-3.4-5-6.4V3.6Z" />`,
    cart: html`<path d="M1.8 2.5h2l1.6 7.5h7l1.4-5.3H4.6" /><circle cx="6.5" cy="13" r="1" /><circle cx="11.5" cy="13" r="1" />`,
    file: html`<path d="M4 1.8h5l3 3v9.4H4Z" /><path d="M9 1.8v3h3" />`,
    close: html`<path d="M4 4l8 8M12 4l-8 8" />`,
    star: html`<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z" />`,
    'star-filled': html`<path fill="currentColor" d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z" />`,
    mic: html`<rect x="6" y="1.8" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" /><path d="M8 12v2.2M5.8 14.2h4.4" />`,
    attach: html`<path d="M13 7.5 8.2 12.3a3 3 0 0 1-4.3-4.3l5.1-5.1a2 2 0 0 1 2.9 2.9L6.8 10.9a1 1 0 0 1-1.5-1.5L9.8 5" />`,
    speaker: html`<path d="M2.5 6v4H5l3.5 3V3L5 6Z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" />`,
    pause: html`<path d="M5.5 3.5v9M10.5 3.5v9" />`,
    link: html`<path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9" /><path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9" />`,
    external: html`<path d="M9.5 2.5h4v4" /><path d="M13.5 2.5 7.5 8.5" /><path d="M12 9.5v4H2.5V4h4" />`,
    calendar: html`<path d="M2.5 3.5h11v10h-11z" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />`,
    image: html`<path d="M2 3h12v10H2z" /><circle cx="5.8" cy="6.5" r="1.2" /><path d="M2 11.5 5.5 8l3 3 2-2 3.5 3.5" />`,
    music: html`<path d="M6 12V3.5l7-1.5v8.5" /><circle cx="4.5" cy="12" r="1.5" /><circle cx="11.5" cy="10.5" r="1.5" />`,
    video: html`<path d="M1.8 4h9v8h-9z" /><path d="M10.8 7 14.2 5v6l-3.4-2" />`,
    agent: html`<rect x="3" y="5" width="10" height="8" rx="1.5" /><path d="M8 2.5V5" /><path d="M6 8.5v1.2M10 8.5v1.2" />`,
    person: html`<circle cx="8" cy="5.5" r="2.7" /><path d="M2.8 14a5.2 5.2 0 0 1 10.4 0" />`,
    people: html`<circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13.5a4.2 4.2 0 0 1 8.4 0" /><path d="M10.2 3.4a2.3 2.3 0 0 1 0 4.4M11.8 9.8a4.2 4.2 0 0 1 2.4 3.7" />`,
    app: html`<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />`,
    lock: html`<path d="M3 7h10v7H3z" /><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" />`,
    key: html`<circle cx="5" cy="11" r="2.8" /><path d="M7 9 13.5 2.5M11 5l2 2M12.5 3.5 14 5" />`,
    bell: html`<path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1.2 1.3H2.8Z" /><path d="M6.5 14.5h3" />`,
    warning: html`<path d="M8 2 14.5 13.5h-13Z" /><path d="M8 6.5v3.2M8 11.6v.1" />`,
    info: html`<circle cx="8" cy="8" r="6" /><path d="M8 7.2v4M8 4.9v.1" />`,
    edit: html`<path d="M10.5 2.5l3 3-8 8H2.5v-3Z" /><path d="M9 4l3 3" />`,
    mail: html`<path d="M1.8 3.5h12.4v9H1.8z" /><path d="M1.8 4 8 9l6.2-5" />`,
    chart: html`<path d="M2.5 13.5h11" /><path d="M4.5 13.5V8M8 13.5V4M11.5 13.5V6.5" />`,
    copy: html`<path d="M5.5 5.5h8v8h-8z" /><path d="M10.5 5.5v-3h-8v8h3" />`,
    chat: html`<path d="M2.5 3h11v8H7l-3 2.5V11H2.5Z" />`,
    folder: html`<path d="M1.8 4h4.5l1.5 1.5h6.4v7.5H1.8Z" />`,
    upload: html`<path d="M8 11V2.5M4.5 6 8 2.5 11.5 6" /><path d="M2.5 11v2.5h11V11" />`,
    clock: html`<circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.6" />`,
    note: html`<path d="M3 2.5h10v11H3z" /><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />`,
    expand: html`<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />`,
    shrink: html`<path d="M9.5 2.5v4h4M9.5 6.5l4-4M6.5 13.5v-4h-4M6.5 9.5l-4 4" />`,
    more: html`<circle cx="3.5" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12.5" cy="8" r=".9" fill="currentColor" />`,
    refresh: html`<path d="M13 8a5 5 0 1 1-1.5-3.5" /><path d="M13 2.5v3h-3" />`,
    download: html`<path d="M8 2.5V11M4.5 7.5 8 11l3.5-3.5" /><path d="M2.5 13.5h11" />`,
};
/** @param {{ name: 'archive'|'trash'|'search'|'restore'|'shield'|'cart'|'file'|'close'|'star'|'star-filled'|'mic'|'attach'|'speaker'|'pause'|'link'|'external'|'calendar'|'image'|'music'|'video'|'agent'|'person'|'people'|'app'|'lock'|'key'|'bell'|'warning'|'info'|'edit'|'mail'|'chart'|'copy'|'chat'|'folder'|'upload'|'clock'|'note'|'expand'|'shrink'|'more'|'refresh'|'download', label?: string }} props
 *  `label` (added v1.17.0): a mark that is the only signal of a state names it for a screen reader
 *  and the tooltip; without it the mark is hidden from assistive technology. */
export function Glyph({ name, label }) {
    return html`<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden=${label ? undefined : 'true'} focusable="false"
      role=${label ? 'img' : undefined} aria-label=${label || undefined}
      fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${label ? html`<title>${label}</title>` : null}${MARKS[name] || null}</svg>`;
}

export function Actions({ under, end, chapter, apart, tight, children }) {
    return html`<div class=${cx('og-doors', under && 'listing-open-doors', end && 'og-doors--end', chapter && 'og-doors--chapter', apart && 'og-doors--apart', tight && 'og-doors--tight')}>${children}</div>`;
}

export default Action;
