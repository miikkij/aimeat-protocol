/**
 * @file public/components/Tabs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What chooses what a page, a list or a field shows, as one component (component plan
 *   C9, page parts; Jouni's decisions "Tabs and filters" and "Choice"): the tab and the row of tabs.
 *   The chosen tab stands on the sun. A page passes the choices as data and never writes a class.
 *   The tab's look is poster.css (.poster-tab and its tones, shared with the admin and the home);
 *   the row's is css/components/tab-row.css, and the row under a page head is .tab-row--bar with
 *   .poster-row--thing.
 *
 *   Tabs({ items, value, onSelect, ... }): each item is { value, label, count, title, disabled,
 *   attention, on, key }; `count` is the small tally inside the tab (Mark kind="count"); `attention`
 *   marks a filter whose items need the person (coral while it is not chosen); `on` says the item
 *   is chosen where `value` cannot say it (a facet row whose "All" is on when no other is).
 *   - tone: undefined (underlined capitals) | 'filter' (small framed words; the row takes the
 *     facet row's spacing) | 'fold' (coral typewriter words) | 'tile' (framed tiles) | 'line' (small
 *     capitals with no ground, the chosen one ink with a coral line under it: the app catalogue's
 *     dialog tabs, Paste / File) | 'glyph' (a square holding one mark, the chosen one on the sun: a
 *     row of ready icons to pick from).
 *   - kind: 'choice' (the default: one of these, a radio group, aria-checked) | 'view' (switches
 *     what the page shows, a tab list, aria-selected) | 'toggle' (each on or off, aria-pressed;
 *     `value` is then the list of the chosen values).
 *   - label or labelledBy: the row's name for a screen reader.
 *   - bar: the row of tabs right under a page head (Nodes, Services, Work, Notebook).
 *   - children: stand after the tabs in the row (a field for a number of one's own).
 *   - caption (added for appcat): the row's own word, shown before the tabs as a coral label (the app
 *     catalogue's "Order"); the row then keeps one line and scrolls sideways on a phone.
 *   - fill (added for appcat): the tabs share the row's whole width in equal parts, each word centred
 *     (the app catalogue's Paste / File tabs over a dialog's body).
 *   Keyboard: the arrow keys move between the tabs of a row, Home and End to its ends; Enter and
 *   Space choose. Every tab stays in the Tab order, as it was.
 *
 *   Tab: one tab alone (a button that shows a panel and stays pressed): `on`, `tone`, `count`,
 *   `attention`, `disabled`, `title`, `ariaLabel`, `pressed` (says aria-pressed), `expanded`.
 * @structure Tabs(props) · Tab(props) · TabPanel({ value, id, label, children })
 * @usage html`<${Tabs} tone="filter" value=${F.who} onSelect=${(v) => set({ who: v })}
 *          items=${[{ value: '', label: x('facetAll'), count: 12 }, { value: 'bound', label: x('facetBound'), count: 3 }]} />`
 *        html`<${Tabs} bar kind="view" value=${sub} onSelect=${setSub} items=${[{ value: 'nodes', label: t('profile.tabs.nodes') }]} />`
 * @version-history
 *   v1.4.0 — 2026-09-27 — `fill`: the tabs share the row's width, each word centred (the app
 *     catalogue's Add dialog tabs), for appcat; additive, tab-row.css .tab-row--fill. The line tone's
 *     grey is the old catalogue's (its --text-dim is the site's --text-muted), and the line and glyph
 *     tones keep their own padding in a row.
 *   v1.3.0 — 2026-09-27 — `caption`: the row's own coral word before its tabs (the app catalogue's
 *     order row), for appcat; additive, tab-row.css .tab-row--caption.
 *   v1.2.0 — 2026-09-27 — Tones 'line' (the app catalogue's dialog tabs: capitals, the chosen one ink
 *     over a coral line) and 'glyph' (a square with one mark, the chosen one on the sun: the Add
 *     dialog's ready icons), for appcat; additive, poster.css .poster-tab--line and --glyph.
 *   v1.1.0 — 2026-09-27 — TabPanel: the part a view tab shows, which fades in (about 180ms) when the
 *     chosen tab changes, and stands still under reduced motion. Every tab of a row keeps one box
 *     whether chosen or not (tab-row.css), so choosing one no longer moves the row.
 *   v1.0.1 — 2026-09-27 — The row under a page head draws only its own name, .tab-row--bar, which
 *     already carried every value of the page's .pf .sub-tabs (a move, same look).
 *   v1.0.0 — 2026-09-26 — Initial: the poster-tab rows every page wrote by hand (.pf-tabs, .sub-tabs,
 *     the facet rows .sk-facets and kin), as data (component plan C9).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
// 'line' and 'glyph' (added by appcat's dialogs): see the header.
const TONES = new Set(['filter', 'fold', 'tile', 'line', 'glyph']);

const countOf = (n) => (n !== null && n !== undefined && n !== '' ? html`<span class="poster-count poster-count--tally">${n}</span>` : null);

/** One tab. */
export function Tab({ on, tone, count, attention, disabled, title, ariaLabel, pressed, expanded, role, checked, selected, id, onClick, children }) {
  const cls = cx('poster-tab', TONES.has(tone) && `poster-tab--${tone}`, attention && 'poster-tab--attention', on && 'is-on');
  return html`<button type="button" class=${cls} id=${id} role=${role} title=${title} aria-label=${ariaLabel}
    aria-pressed=${pressed === undefined ? undefined : String(!!pressed)}
    aria-expanded=${expanded === undefined ? undefined : String(!!expanded)}
    aria-checked=${checked === undefined ? undefined : String(!!checked)}
    aria-selected=${selected === undefined ? undefined : String(!!selected)}
    disabled=${disabled} onClick=${onClick}>${children}${countOf(count)}</button>`;
}

const KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };

/** Arrow keys move the focus along the row's own tabs (not into what stands after them). */
function moveFocus(e) {
  const step = KEYS[e.key];
  if (!step) return;
  const tabs = [...e.currentTarget.children].filter((el) => el.classList.contains('poster-tab') && !el.disabled);
  const at = tabs.indexOf(document.activeElement);
  if (at < 0 || !tabs.length) return;
  e.preventDefault();
  const next = step === 'first' ? tabs[0] : step === 'last' ? tabs[tabs.length - 1] : tabs[(at + step + tabs.length) % tabs.length];
  next.focus();
}

/**
 * @typedef {{ value: any, label: any, count?: any, title?: string, disabled?: boolean, attention?: boolean, key?: any,
 *   on?: boolean }} TabItem
 */

/**
 * @param {{ items: Array<TabItem|null|false>,
 *   value?: any, onSelect?: (value: any, item: object) => void, tone?: 'filter'|'fold'|'tile'|'line'|'glyph', kind?: 'choice'|'view'|'toggle',
 *   label?: string, labelledBy?: string, bar?: boolean, disabled?: boolean, caption?: any, fill?: boolean, children?: any }} props
 */
export function Tabs({ items, value, onSelect, tone, kind = 'choice', label, labelledBy, bar, disabled, caption, fill, children }) {
  const chosen = (v) => (kind === 'toggle' ? (Array.isArray(value) ? value : []).includes(v) : value === v);
  const role = kind === 'view' ? 'tablist' : kind === 'toggle' ? 'group' : 'radiogroup';
  // fill (added by appcat's dialogs, parity): the tabs share the row's whole width, each word centred.
  const cls = bar ? 'tab-row--bar poster-row--thing' : cx('tab-row', tone === 'filter' && 'tab-row--filter', caption && 'tab-row--caption', fill && 'tab-row--fill');
  return html`
    <div class=${cls} role=${role} aria-label=${label} aria-labelledby=${labelledBy} onKeyDown=${moveFocus}>
      ${caption ? html`<span class="poster-label tab-row-caption" aria-hidden=${label ? 'true' : undefined}>${caption}</span>` : null}
      ${/** @type {TabItem[]} */ ((items || []).filter(Boolean)).map((it, i) => {
        const on = it.on !== undefined ? !!it.on : chosen(it.value);
        return html`<${Tab} key=${it.key ?? it.value ?? i} tone=${tone} on=${on} count=${it.count} attention=${it.attention}
          title=${it.title} disabled=${disabled || it.disabled}
          role=${kind === 'view' ? 'tab' : kind === 'toggle' ? undefined : 'radio'}
          selected=${kind === 'view' ? on : undefined} checked=${kind === 'choice' ? on : undefined} pressed=${kind === 'toggle' ? on : undefined}
          onClick=${() => onSelect?.(it.value, it)}>${it.label}<//>`;
      })}
      ${children}
    </div>`;
}

/**
 * What a row of view tabs shows: the part for the chosen tab. It fades in when the chosen tab changes
 * (a new element for each value), and stands still for a person who asks for reduced motion.
 * @param {{ value: any, id?: string, label?: string, children?: any }} props
 */
export function TabPanel({ value, id, label, children }) {
  return html`<div class="tab-panel" key=${String(value)} id=${id} role="tabpanel" aria-label=${label}>${children}</div>`;
}

export default Tabs;
