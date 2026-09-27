/**
 * @file public/components/CardMenu.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The dots in the top right corner of a card: what you can do with this thing, and
 *   what state it is in, in one control that is always in the same place.
 *
 *   ALWAYS TOP RIGHT, ALWAYS THE SAME. That repetition is the whole point. A person learns one
 *   corner once and then every card in the product answers to it, instead of each surface inventing
 *   its own row of buttons and its own words.
 *
 *   THE DOTS ARE THE LIGHT. Their colour is the state, so there is no second indicator to find and
 *   nothing floating in the whitespace:
 *
 *   | Dots | Means |
 *   |---|---|
 *   | grey | not on your open items |
 *   | amber | on your list, waiting |
 *   | green, pulsing | somebody is working on it right now |
 *
 *   Three dots rather than a hamburger, deliberately: the hamburger already means site navigation
 *   in this product's own top bar, and one glyph with two meanings on one screen is the confusion
 *   this control exists to remove. Three dots is the established mark for "the actions of THIS
 *   item", and it is a neutral shape that carries colour without looking broken.
 *
 *   The card underneath is often a link. Every click here stops before the card sees it, or opening
 *   the menu would also navigate away.
 *
 *   A menu that opens from words (`word`, added by appcat): the same menu under a line of words drawn
 *   as the action link (the app catalogue's "Backups and imports"), `framed` for the list in the
 *   poster frame (ink frame, sun shadow), `disabled` while what it started runs.
 * @structure CardMenu({ state, actions, label, onOpened, inline, word, framed, disabled })
 * @usage
 *   html`<${CardMenu} state=${'open'} actions=${[{ label: 'Copy', run: copy }]} />`
 *   html`<${CardMenu} word=${x('action.backups')} framed actions=${[{ label: x('backup.exportAll'), run: exportAll }]} />`
 * @version-history
 *   v1.6.1 — 2026-09-27 — The framed list stands 6px off its words (the old .backup-menu), appcat parity.
 *   v1.6.0 — 2026-09-27 — `word` (the menu opens from words drawn as the action link, in their line),
 *     `framed` (the list in the poster frame) and `disabled`, for appcat's "Backups and imports"
 *     menu; additive, card-menu.css .card-menu-list--framed.
 *   v1.5.0 — 2026-09-27 — The menu is placed from the dots' rectangle (fixed) and opens upward when
 *     there is no room below, so a scrolling parent (the Messages thread) never clips it; it follows
 *     the dots while a parent scrolls. The arrow keys move between the rows, and Escape gives the
 *     focus back to the dots.
 *   v1.4.0 — 2026-09-26 — An action `{ divider: true }` draws a line between two groups of rows (the
 *     Settings kebab menu had one; KebabMenu in views/profile/shared.js is this menu now).
 *   v1.3.0 — 2026-09-26 — `inline`: the dots in a line of words (a message's line under it), and an
 *     action's `danger` tone (Jouni's decision "Message": the six other actions of a message).
 *   v1.2.0 — 2026-09-24 — The rows are the shared menu row (Jouni's decision "Menu row").
 *   v1.1.0 — 2026-09-24 — The dots are the small icon button; the state fills stay (Jouni's decision
 *     "Icon button").
 *   v1.0.0 — 2026-08-09 — Initial. Replaces the grey prompt box plus a separate loose light, which
 *     repeated the card's own heading and left a 10px dot alone in the whitespace under it.
 */
import { h } from 'preact';
import { useState, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function CardMenu({
  /** 'off' | 'open' | 'working' — the colour of the dots. */
  state = 'off',
  /** [{ label, run, done, danger }] — done shows a tick for a moment, for copy; danger is the menu row's danger tone. */
  actions = [],
  /** What the dots are, for a screen reader and the tooltip. */
  label = null,
  /** Called the first time this menu is opened. The mat card uses it to retire its one-time hint. */
  onOpened = null,
  /**
   * null: in the card's top right corner. 'start' | 'end': in a line of words (a message's line under
   * it), the menu opening from the dots' left or right edge, so it stays on the page.
   */
  inline: inlineGiven = null,
  /**
   * Words (added by appcat): the menu opens from these words, drawn as the action link, instead of
   * the dots, in the line where they are written (a page's "Backups and imports"). The menu opens
   * from their right edge unless `inline` says 'start'.
   */
  word = null,
  /** The menu in the poster frame (added by appcat): the ink frame with the sun shadow. */
  framed = false,
  /** The words can not be pressed now (added by appcat): an export the menu started is running. */
  disabled = false,
}) {
  const inline = inlineGiven || (word ? 'end' : null);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const ref = useRef(null);
  const dotsRef = useRef(null);
  const listRef = useRef(null);

  // Clicking anywhere else closes it, which is what every menu in the world does and what a person
  // tries first when they opened one by accident. Escape closes it and gives the focus back to the
  // dots; the arrow keys move between the rows.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const keys = (e) => {
      if (e.key === 'Escape') { setOpen(false); dotsRef.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const rows = [...(listRef.current?.querySelectorAll('[role="menuitem"]') || [])];
      if (!rows.length) return;
      e.preventDefault();
      const at = rows.indexOf(/** @type {any} */ (document.activeElement));
      const next = e.key === 'ArrowDown' ? (at + 1) % rows.length : (at <= 0 ? rows.length - 1 : at - 1);
      /** @type {HTMLElement} */ (rows[next]).focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', keys); };
  }, [open]);

  // The menu stands on the page, not in its card: it is placed from the dots' rectangle (fixed), so a
  // scrolling parent (a message thread, a list) never clips it, and it opens upward when there is no
  // room below the dots. It follows the dots while the page or a parent scrolls.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const dots = dotsRef.current;
      const list = listRef.current;
      if (!dots || !list) return;
      const b = dots.getBoundingClientRect();
      // The framed list stands 6px off its words, as the old catalogue's .backup-menu (appcat parity).
      const gap = framed ? 6 : 4;
      const h = list.offsetHeight;
      const w = list.offsetWidth;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const below = vh - b.bottom - gap;
      const above = b.top - gap;
      const up = below < h && above > below;
      let top = up ? b.top - gap - h : b.bottom + gap;
      top = Math.max(gap, Math.min(top, vh - h - gap));
      let left = inline === 'start' ? b.left : b.right - w;
      left = Math.max(gap, Math.min(left, vw - w - gap));
      list.style.top = `${Math.round(top)}px`;
      list.style.left = `${Math.round(left)}px`;
      list.classList.toggle('card-menu-list--up', up);
      list.classList.add('card-menu-list--placed');
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, inline, framed]);

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  async function run(a, i) {
    if (a.done) {
      await a.run();
      setFlash(i);
      setTimeout(() => setFlash(null), 1400);
      return;
    }
    setOpen(false);
    await a.run();
  }

  const hint = label ?? tr('cardMenu.label', 'What you can do with this');

  return html`
    <div class=${'card-menu' + (inline ? ` card-menu--inline card-menu--from-${inline}` : '')} ref=${ref} onClick=${stop}>
      ${word
        ? html`<button type="button" ref=${dotsRef} class="poster-action card-menu-word"
            aria-haspopup="menu" aria-expanded=${open} title=${label ?? undefined} disabled=${disabled}
            onClick=${(e) => { stop(e); if (!open) onOpened?.(); setOpen(v => !v); }}>${word}</button>`
        : html`<button type="button" ref=${dotsRef}
            class="poster-icon poster-icon--small card-menu-dots card-menu-dots--${state}"
            aria-haspopup="menu" aria-expanded=${open} aria-label=${hint} title=${hint} disabled=${disabled}
            onClick=${(e) => { stop(e); if (!open) onOpened?.(); setOpen(v => !v); }}>
            <span aria-hidden="true">⋯</span>
          </button>`}
      ${open && html`
        <div class=${'card-menu-list' + (framed ? ' card-menu-list--framed' : '')} role="menu" ref=${listRef}>
          ${actions.map((a, i) => a.divider ? html`<div class="card-menu-sep" role="separator" key=${'sep' + i}></div>` : html`
            <button type="button" role="menuitem" key=${a.label} class=${'poster-menu-row card-menu-item' + (a.danger ? ' poster-menu-row--danger' : '')}
              onClick=${(e) => { stop(e); run(a, i); }}>
              ${flash === i ? (a.doneLabel ?? tr('cardMenu.done', 'Done')) : a.label}
            </button>`)}
        </div>`}
    </div>`;
}

export default CardMenu;
