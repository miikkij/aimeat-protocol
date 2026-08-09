/**
 * @file public/components/CardMenu.js
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
 * @structure CardMenu({ state, actions, label })
 * @usage
 *   html`<${CardMenu} state=${'open'} actions=${[{ label: 'Copy', run: copy }]} />`
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial. Replaces the grey prompt box plus a separate loose light, which
 *     repeated the card's own heading and left a 10px dot alone in the whitespace under it.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function CardMenu({
  /** 'off' | 'open' | 'working' — the colour of the dots. */
  state = 'off',
  /** [{ label, run, done }] — done shows a tick for a moment, for copy. */
  actions = [],
  /** What the dots are, for a screen reader and the tooltip. */
  label = null,
  /** Called the first time this menu is opened. The mat card uses it to retire its one-time hint. */
  onOpened = null,
}) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const ref = useRef(null);

  // Clicking anywhere else closes it, which is what every menu in the world does and what a person
  // tries first when they opened one by accident.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

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
    <div class="card-menu" ref=${ref} onClick=${stop}>
      <button type="button"
        class="card-menu-dots card-menu-dots--${state}"
        aria-haspopup="menu" aria-expanded=${open} aria-label=${hint} title=${hint}
        onClick=${(e) => { stop(e); if (!open) onOpened?.(); setOpen(v => !v); }}>
        <span aria-hidden="true">⋯</span>
      </button>
      ${open && html`
        <div class="card-menu-list" role="menu">
          ${actions.map((a, i) => html`
            <button type="button" role="menuitem" key=${a.label} class="card-menu-item"
              onClick=${(e) => { stop(e); run(a, i); }}>
              ${flash === i ? (a.doneLabel ?? tr('cardMenu.done', 'Done')) : a.label}
            </button>`)}
        </div>`}
    </div>`;
}

export default CardMenu;
