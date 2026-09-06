/**
 * @file living/gear.js
 * @description THE ONE MARK ON THE SCREEN THAT SAYS THIS PART CAN BE AUTOMATED. A living document
 *   already looks like a document — a slider, a number, a stamp — and nothing about it suggests that
 *   the slider could be a sensor or that the stamp could tell an inverter. So each node that can
 *   take a value from outside carries a small gear with an arrow going IN, and each node that can
 *   tell somebody carries the same gear with an arrow going OUT, and pressing one opens the dialog
 *   that explains the shape for that exact node.
 *
 *   TWO ICONS, ONE GEAR, AND THE ARROW IS THE WHOLE MESSAGE. A person reads direction before they
 *   read anything else, so the difference between "this listens" and "this speaks" is a stroke
 *   pointing at the gear or away from it, not a second shape to learn and not a colour.
 *
 *   INLINE SVG, NEVER AN EMOJI. It inherits `currentColor`, so it wears whatever look the page is
 *   wearing, and it is drawn at the kit's own touch size (44px of hit area around a 16px mark) so a
 *   thumb can find it on a phone without the icon growing to fill the row.
 * @structure GEAR_IN · GEAR_OUT · gearButton(spec)
 * @usage
 *   import { gearButton } from './gear.js';
 *   host.appendChild(gearButton({ way: 'in', title: 'Tämä arvo voi tulla ulkoa', onOpen }));
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { el } from './dom.js';
import { say } from './hooks-words.js';

/** The gear itself, without its arrow: eight teeth and a hole, on a 24-unit square. */
const GEAR = '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"/>'
  + '<path d="M19.3 13.6a7.6 7.6 0 0 0 0-3.2l1.7-1.2-1.7-3-2 .8a7.6 7.6 0 0 0-2.8-1.6L14.2 3h-3.4'
  + 'l-.3 2.4a7.6 7.6 0 0 0-2.8 1.6l-2-.8-1.7 3 1.7 1.2a7.6 7.6 0 0 0 0 3.2L3.7 15l1.7 3 2-.8'
  + 'a7.6 7.6 0 0 0 2.8 1.6l.3 2.2h3.4l.3-2.2a7.6 7.6 0 0 0 2.8-1.6l2 .8 1.7-3-1.4-1.4Z"/>';

/** An arrow arriving at the gear from the left: the value comes from outside. */
export const GEAR_IN = '<g class="ak-living__gear-arrow"><path d="M1 12h6"/><path d="M4.6 9.2 7.4 12l-2.8 2.8"/></g>';

/** An arrow leaving the gear to the right: when this changes, somebody is told. */
export const GEAR_OUT = '<g class="ak-living__gear-arrow"><path d="M17 12h6"/><path d="M20.4 9.2 23.2 12l-2.8 2.8"/></g>';

/**
 * One gear button. It is a real `<button>`, so the keyboard reaches it and the kit's focus ring
 * lands on it without a line of ARIA being written here.
 * @param {{ way: 'in'|'out', node: string, langs?: () => string[], onOpen: () => void }} spec
 * @returns {HTMLElement}
 */
export function gearButton(spec) {
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const title = say(spec.way === 'out' ? 'gear.out' : 'gear.in', langs());
  const button = el('button', {
    type: 'button',
    class: 'ak-btn ak-btn--ghost ak-living__gear ak-living__gear--' + (spec.way === 'out' ? 'out' : 'in'),
    'data-living-gear': spec.way === 'out' ? 'out' : 'in',
    'data-living-for': String(spec.node || ''),
    title: title,
    'aria-label': title,
    on: { click: function () { if (spec.onOpen) spec.onOpen(); } },
  });
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + (spec.way === 'out' ? GEAR_OUT : GEAR_IN) + GEAR + '</svg>';
  return button;
}

/**
 * The gear's words, written again. A language change moves the title and the label in place, the
 * way every other view in this library does, rather than rebuilding the button under the pointer.
 * @param {HTMLElement} root @param {() => string[]} langs
 */
export function relabelGears(root, langs) {
  if (!root || !root.querySelectorAll) return;
  for (const button of root.querySelectorAll('[data-living-gear]')) {
    const way = button.getAttribute('data-living-gear') === 'out' ? 'gear.out' : 'gear.in';
    const title = say(way, langs ? langs() : []);
    if (button.getAttribute('title') !== title) button.setAttribute('title', title);
    if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
  }
}
