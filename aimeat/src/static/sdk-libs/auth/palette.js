/**
 * @file auth/palette.js
 * @description The PALETTE axis of the AIMEAT theme system — which designed look the user wants,
 *   orthogonal to the light/dark MODE (theme.js). Mirrors /lib/aimeat-theme.css: every palette
 *   there appears in PALETTES here with its true swatch colours, and `pnpm check:theme` fails the
 *   build when the two drift, so this registry can never advertise a palette the CSS does not ship.
 *
 *   ONE key: 'aimeat-palette' in localStorage; `data-palette` on <html> (absent = the default
 *   'aimeat' coral palette, so a page with no stored choice is byte-identical to the pre-palette
 *   era). Changing it fires an 'aimeat-palette-change' window event — a pure CSS-variable swap,
 *   so an app never needs to re-render, exactly like TDR.setPalette() in the MACHINE ROOM kit.
 * @structure AIMEAT_PALETTE_KEY · PALETTES (the registry, synced against aimeat-theme.css) ·
 *   aimeatReadPalette/aimeatApplyPalette/aimeatRestorePalette · paletteControlHtml/
 *   wirePaletteControl (the swatch picker) · esc
 * @usage import { PALETTES, aimeatApplyPalette, aimeatRestorePalette } from './palette.js';
 *   In the app: nothing — the login pill renders the picker and the CSS follows.
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial palette registry + apply/restore + swatch picker, born with
 *     aimeat-theme.css v2.
 */

/** The one palette key on this platform (the mode key is 'aimeat-theme' in theme.js). */
export var AIMEAT_PALETTE_KEY = 'aimeat-palette';

/**
 * The designed palettes, in display order. `swatch` carries the REAL theme colours (page/card/
 * accent per mode) so a picker can show what it is offering instead of a name; check:theme
 * verifies each hex against the corresponding --color-* in /lib/aimeat-theme.css.
 * @type {{ id: string, label: string, swatch: { light: { bg: string, card: string, accent: string }, dark: { bg: string, card: string, accent: string } } }[]}
 */
export var PALETTES = [
  { id: 'aimeat', label: 'AIMEAT', swatch: {
    light: { bg: '#efeee8', card: '#ffffff', accent: '#e8564a' },
    dark: { bg: '#14151a', card: '#21232e', accent: '#ff6f62' } } },
  { id: 'paper', label: 'Paper', swatch: {
    light: { bg: '#eae2cf', card: '#fdfaf1', accent: '#a03040' },
    dark: { bg: '#151110', card: '#282017', accent: '#e08590' } } },
  { id: 'circuit', label: 'Circuit', swatch: {
    light: { bg: '#e9edf1', card: '#ffffff', accent: '#0e7290' },
    dark: { bg: '#0a0f14', card: '#18202b', accent: '#4fd2f2' } } },
  { id: 'contrast', label: 'Contrast', swatch: {
    light: { bg: '#e9e9e9', card: '#ffffff', accent: '#1d4ed8' },
    dark: { bg: '#000000', card: '#17171c', accent: '#99c2ff' } } },
  { id: 'mist', label: 'Mist', swatch: {
    light: { bg: '#e6eae4', card: '#fbfcfa', accent: '#47695a' },
    dark: { bg: '#141715', card: '#252b27', accent: '#9cc0ae' } } },
];

/** The palette in effect: stored choice if valid, else the default (first in PALETTES). */
export function aimeatReadPalette() {
  var ids = PALETTES.map(function (p) { return p.id; });
  try {
    var s = localStorage.getItem(AIMEAT_PALETTE_KEY);
    if (s && ids.indexOf(s) >= 0) return s;
  } catch { /* storage blocked */ }
  var attr = document.documentElement.getAttribute('data-palette');
  return attr && ids.indexOf(attr) >= 0 ? attr : PALETTES[0].id;
}

/** Apply + persist + announce. The default palette REMOVES the attribute (canonical no-attr form). */
export function aimeatApplyPalette(id) {
  if (id === PALETTES[0].id) document.documentElement.removeAttribute('data-palette');
  else document.documentElement.setAttribute('data-palette', id);
  try { localStorage.setItem(AIMEAT_PALETTE_KEY, id); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new CustomEvent('aimeat-palette-change', { detail: { palette: id } })); } catch { /* no window */ }
}

/**
 * Restore the stored choice onto <html> (idempotent; no event — nothing changed from the user's
 * point of view). Runs at lib parse time via auth/index so every app follows the choice even
 * before any UI mounts, and follows other-tab changes through the storage event.
 */
export function aimeatRestorePalette() {
  var cur = aimeatReadPalette();
  if (cur !== PALETTES[0].id) document.documentElement.setAttribute('data-palette', cur);
  try {
    window.addEventListener('storage', function (e) {
      if (e.key === AIMEAT_PALETTE_KEY && e.newValue) aimeatApplyPalette(e.newValue);
    });
  } catch { /* no window */ }
}

/**
 * The PALETTE picker: a swatch trigger (the active palette's accent as a dot) opening a popover
 * grid where every palette is a true-colour chip (page/card/accent in the CURRENT mode) plus its
 * name — you see what you are choosing, not a dropdown of words. The chip colours are data, so
 * they ride as inline background values; all layout lives in cluster.js.
 * @param {{ chooseLook?: string }} [i]
 */
export function paletteControlHtml(i) {
  var cur = aimeatReadPalette();
  var mode = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  var curAcc = (PALETTES.find(function (p) { return p.id === cur; }) || PALETTES[0]).swatch[mode].accent;
  var label = (i && i.chooseLook) || 'Choose look';
  return '<span id="aimeat-palette-switch" class="aimeat-pop-wrap">'
    + '<button type="button" class="aimeat-pop-btn" aria-haspopup="listbox" aria-expanded="false" '
    + 'title="' + esc(label) + '" aria-label="' + esc(label) + '">'
    + '<span class="aimeat-pal-dot" style="background:' + esc(curAcc) + '"></span></button>'
    + '<span class="aimeat-pop" role="listbox">'
    + PALETTES.map(function (p) {
      var s = p.swatch[mode];
      return '<button type="button" role="option" data-palette="' + esc(p.id) + '" aria-pressed="' + (p.id === cur) + '">'
        + '<span class="aimeat-pal-chip" style="background:' + esc(s.bg) + '">'
        + '<span class="pc-card" style="background:' + esc(s.card) + '"></span>'
        + '<span class="pc-acc" style="background:' + esc(s.accent) + '"></span></span>'
        + esc(p.label) + '</button>';
    }).join('')
    + '</span></span>';
}

/**
 * @param {Element} container
 * @param {(pop: HTMLElement) => void} clampPopover
 */
export function wirePaletteControl(container, clampPopover) {
  var root = container.querySelector('#aimeat-palette-switch');
  if (!root) return;
  var trigger = /** @type {HTMLElement} */ (root.querySelector('.aimeat-pop-btn'));
  function syncDot() {
    var cur = aimeatReadPalette();
    var mode = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var p = PALETTES.find(function (x) { return x.id === cur; }) || PALETTES[0];
    var dot = /** @type {HTMLElement|null} */ (root.querySelector('.aimeat-pal-dot'));
    if (dot) dot.style.background = p.swatch[mode].accent;
    root.querySelectorAll('button[data-palette]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-palette') === cur));
      // Re-tint the chips for the mode in effect, so the picker always previews truthfully.
      var pp = PALETTES.find(function (x) { return x.id === b.getAttribute('data-palette'); });
      if (!pp) return;
      var s = pp.swatch[mode];
      var chip = /** @type {HTMLElement|null} */ (b.querySelector('.aimeat-pal-chip'));
      var card = /** @type {HTMLElement|null} */ (b.querySelector('.pc-card'));
      var acc = /** @type {HTMLElement|null} */ (b.querySelector('.pc-acc'));
      if (chip) chip.style.background = s.bg;
      if (card) card.style.background = s.card;
      if (acc) acc.style.background = s.accent;
    });
  }
  root.querySelectorAll('button[data-palette]').forEach(function (b) {
    b.addEventListener('click', function () {
      aimeatApplyPalette(b.getAttribute('data-palette') || PALETTES[0].id);
      syncDot();
      root.classList.remove('aimeat-open');
      trigger.setAttribute('aria-expanded', 'false');
    });
  });
  trigger.addEventListener('click', function (ev) {
    ev.stopPropagation();
    var open = root.classList.toggle('aimeat-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (open) clampPopover(/** @type {HTMLElement} */ (root.querySelector('.aimeat-pop')));
  });
  window.addEventListener('aimeat-palette-change', syncDot);
  window.addEventListener('aimeat-theme-change', syncDot);
}

/** Local escaper (palette.js must not import from theme.js — theme.js may import from here). */
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
