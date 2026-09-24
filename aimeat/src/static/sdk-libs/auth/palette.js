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
 *
 *   ON THE NODE'S OWN PAGES the shell owns the look (Themes & Styles): its look script
 *   (window.__aimeatLook, spa.html) knows the node's themes and which page is AIMEAT's own
 *   interface. There the picker offers the styles of the person's theme, and the other themes when
 *   the operator makes more than one available; it is gone when the operator decides for everybody.
 *   On every other page, and in every published app, nothing changed: PALETTES, as before.
 * @structure AIMEAT_PALETTE_KEY · PALETTES (the registry, synced against aimeat-theme.css) ·
 *   paletteRegistry · aimeatReadPalette/aimeatApplyPalette/aimeatRestorePalette ·
 *   paletteControlHtml/wirePaletteControl (the swatch picker) · esc
 * @usage import { PALETTES, aimeatApplyPalette, aimeatRestorePalette } from './palette.js';
 *   In the app: nothing — the login pill renders the picker and the CSS follows.
 * @version-history
 *   v1.3.0 — 2026-09-24 — On the node's own pages the picker reads the shell's look
 *     (window.__aimeatLook): the styles of the person's theme, the available themes when there are
 *     more than one, and no picker when the operator decides. Everywhere else PALETTES as before.
 *     The styles' group is "Styles in this theme": the AIMEAT theme's first style is also AIMEAT.
 *     The list has a name, and each option says it is chosen with aria-selected.
 *   v1.2.0 — 2026-08-28 — VOLTAGE joins the palettes: the front-demo2 register as a theme — hot
 *     magenta on warm cream, deep violet night, electric yellow, 2px borders, Space Grotesk
 *     display. check:theme holds its swatches and ratios like every other.
 *   v1.1.0 — 2026-07-26 — ?palette= is read first (the ?lang= door): an app EMBEDDED by another
 *     page cannot see the look chosen on the embedder's origin, so the embedder says it in the URL
 *     and the app inherits it. Never persisted — an embed decides how it looks while it is
 *     embedded, not what the app remembers.
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
    light: { bg: '#eaeef7', card: '#ffffff', accent: '#e8564a' },
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
  { id: 'voltage', label: 'Voltage', swatch: {
    light: { bg: '#f1e4d2', card: '#ffffff', accent: '#c2187e' },
    dark: { bg: '#150d20', card: '#2c1d3f', accent: '#ff4fa8' } } },
];

/** The house palette: no attribute on <html>. */
var HOUSE = 'aimeat';

/** The shell's look on the node's own pages (spa.html), or null in an app and on other pages. */
function look() {
  try {
    var L = /** @type {any} */ (window).__aimeatLook;
    return L && typeof L.state === 'function' ? L : null;
  } catch { return null; }
}

/** The look's state when this page is AIMEAT's own interface, else null. */
function innerState() {
  var L = look();
  var s = L ? L.state() : null;
  return s && s.inner ? s : null;
}

/** The theme the page wears, from the look's state. */
function currentTheme(s) {
  for (var i = 0; i < s.themes.length; i++) if (s.themes[i].id === s.theme) return s.themes[i];
  return s.themes[0] || null;
}

/** What the picker offers: the styles of the person's theme on AIMEAT's own pages, PALETTES elsewhere. */
export function paletteRegistry() {
  var s = innerState();
  var th = s ? currentTheme(s) : null;
  if (!th) return PALETTES;
  return th.styles.map(function (x) { return { id: x.id, label: x.name, swatch: x.swatch }; });
}

/** The palette in effect: stored choice if valid, else the default (first in PALETTES). */
export function aimeatReadPalette() {
  var L = look();
  if (L) return L.state().style || HOUSE;
  var ids = PALETTES.map(function (p) { return p.id; });
  try {
    // ?palette= first, exactly where ?lang= sits in the locale lookup, and for the same reason:
    // localStorage is per ORIGIN, so an app embedded by another page cannot see the look the
    // reader chose there. The embedder says it in the URL and the app inherits it instead of
    // rendering in a palette nobody picked. Not persisted — an embed decides how it looks while
    // it is embedded, and must not overwrite the choice the app's own origin remembers.
    var u = new URLSearchParams(location.search).get('palette');
    if (u && ids.indexOf(u) >= 0) return u;
  } catch { /* no location */ }
  try {
    var s = localStorage.getItem(AIMEAT_PALETTE_KEY);
    if (s && ids.indexOf(s) >= 0) return s;
  } catch { /* storage blocked */ }
  var attr = document.documentElement.getAttribute('data-palette');
  return attr && ids.indexOf(attr) >= 0 ? attr : PALETTES[0].id;
}

/** Apply + persist + announce. The default palette REMOVES the attribute (canonical no-attr form). */
export function aimeatApplyPalette(id) {
  var L = look();
  if (L) { L.choose(null, id); return; }   // the shell keeps it, wears it and announces it
  if (id === HOUSE) document.documentElement.removeAttribute('data-palette');
  else document.documentElement.setAttribute('data-palette', id);
  try { localStorage.setItem(AIMEAT_PALETTE_KEY, id); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new CustomEvent('aimeat-palette-change', { detail: { palette: id } })); } catch { /* no window */ }
}

/**
 * Restore the stored choice onto <html> (idempotent; no event — nothing changed from the user's
 * point of view). Runs at lib parse time via auth/index so every app follows the choice even
 * before any UI mounts, and follows other-tab changes through the storage event. On the node's
 * own pages the shell has already put the look on before the first paint.
 */
export function aimeatRestorePalette() {
  var L = look();
  if (!L) {
    var cur = aimeatReadPalette();
    if (cur !== HOUSE) document.documentElement.setAttribute('data-palette', cur);
    else document.documentElement.removeAttribute('data-palette');   // an embed may ask for the default
  }
  try {
    window.addEventListener('storage', function (e) {
      if (e.key !== AIMEAT_PALETTE_KEY && e.key !== 'aimeat-look-theme') return;
      var LL = look();
      if (LL) LL.apply(location.pathname);
      else if (e.key === AIMEAT_PALETTE_KEY && e.newValue) aimeatApplyPalette(e.newValue);
    });
  } catch { /* no window */ }
}

/** A chip: page, card and accent of one look in the current mode, as inline data. */
function chipHtml(sw) {
  return '<span class="aimeat-pal-chip" style="background:' + esc(sw.bg) + '">'
    + '<span class="pc-card" style="background:' + esc(sw.card) + '"></span>'
    + '<span class="pc-acc" style="background:' + esc(sw.accent) + '"></span></span>';
}

/** Open the picker again after the pill re-drew itself for a theme just chosen in it. */
var reopen = null;

/**
 * The PALETTE picker: a swatch trigger (the active palette's accent as a dot) opening a popover
 * grid where every palette is a true-colour chip (page/card/accent in the CURRENT mode) plus its
 * name — you see what you are choosing, not a dropdown of words. The chip colours are data, so
 * they ride as inline background values; all layout lives in cluster.js. On AIMEAT's own pages
 * with more than one theme available, the themes come first and the theme's styles under them.
 * @param {{ chooseLook?: string, lookThemes?: string, lookStyles?: string, styleLightOnly?: string, styleDarkOnly?: string }} [i]
 */
export function paletteControlHtml(i) {
  var s = innerState();
  // The operator decides the look for everybody: there is nothing to choose, so there is no picker.
  if (s && !s.personalChoice) return '';
  var list = paletteRegistry();
  var cur = aimeatReadPalette();
  var mode = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  var curAcc = (list.find(function (p) { return p.id === cur; }) || list[0]).swatch[mode].accent;
  var label = (i && i.chooseLook) || 'Choose look';
  var themes = s && s.themes.length > 1 ? s.themes : null;
  var head = function (text) { return '<span class="aimeat-pop-head">' + esc(text) + '</span>'; };
  return '<span id="aimeat-palette-switch" class="aimeat-pop-wrap">'
    + '<button type="button" class="aimeat-pop-btn" aria-haspopup="listbox" aria-expanded="false" '
    + 'title="' + esc(label) + '" aria-label="' + esc(label) + '">'
    + '<span class="aimeat-pal-dot" style="background:' + esc(curAcc) + '"></span></button>'
    // An option's chosen state is aria-selected for a screen reader; aria-pressed stays as the CSS hook.
    + '<span class="aimeat-pop" role="listbox" aria-label="' + esc(label) + '">'
    // A style with one mode says so here too: the light/dark switch beside the picker is off.
    + (s && s.only ? '<span class="aimeat-pop-note">' + esc(s.only === 'light' ? ((i && i.styleLightOnly) || 'This style has a light mode only')
      : ((i && i.styleDarkOnly) || 'This style has a dark mode only')) + '</span>' : '')
    + (themes
      ? head((i && i.lookThemes) || 'Themes')
        + themes.map(function (t) {
          var def = t.styles.find(function (x) { return x.id === t.defaultStyle; }) || t.styles[0];
          return '<button type="button" role="option" data-look-theme="' + esc(t.id) + '" aria-label="' + esc(t.name) + '" aria-pressed="' + (t.id === s.theme) + '" aria-selected="' + (t.id === s.theme) + '">'
            + (def ? chipHtml(def.swatch[mode]) : '') + esc(t.name) + '</button>';
        }).join('')
        // "Styles in this theme": the built-in theme and its first style share the name AIMEAT.
        + head((i && i.lookStyles) || 'Styles in this theme')
      : '')
    + list.map(function (p) {
      return '<button type="button" role="option" data-palette="' + esc(p.id) + '" aria-label="' + esc(p.label) + '" aria-pressed="' + (p.id === cur) + '" aria-selected="' + (p.id === cur) + '">'
        + chipHtml(p.swatch[mode]) + esc(p.label) + '</button>';
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
  var list = paletteRegistry();
  function open() {
    root.classList.add('aimeat-open');
    trigger.setAttribute('aria-expanded', 'true');
    clampPopover(/** @type {HTMLElement} */ (root.querySelector('.aimeat-pop')));
  }
  function syncDot() {
    var cur = aimeatReadPalette();
    var mode = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var p = list.find(function (x) { return x.id === cur; }) || list[0];
    var dot = /** @type {HTMLElement|null} */ (root.querySelector('.aimeat-pal-dot'));
    if (dot) dot.style.background = p.swatch[mode].accent;
    root.querySelectorAll('button[data-palette]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-palette') === cur));
      b.setAttribute('aria-selected', String(b.getAttribute('data-palette') === cur));
      // Re-tint the chips for the mode in effect, so the picker always previews truthfully.
      var pp = list.find(function (x) { return x.id === b.getAttribute('data-palette'); });
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
      aimeatApplyPalette(b.getAttribute('data-palette') || HOUSE);
      syncDot();
      root.classList.remove('aimeat-open');
      trigger.setAttribute('aria-expanded', 'false');
    });
  });
  // A theme: the page takes its default style at once, and the picker stays open on its styles.
  // The pill re-draws itself on the look's change, so the new picker opens after this click is done.
  root.querySelectorAll('button[data-look-theme]').forEach(function (b) {
    b.addEventListener('click', function () {
      var L = look();
      if (!L) return;
      reopen = { compact: !!container.querySelector('.aimeat-auth-wrap.aimeat-open') };
      L.choose(b.getAttribute('data-look-theme'), null);
    });
  });
  trigger.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (root.classList.contains('aimeat-open')) {
      root.classList.remove('aimeat-open');
      trigger.setAttribute('aria-expanded', 'false');
    } else open();
  });
  if (reopen) {
    var again = reopen;
    reopen = null;
    setTimeout(function () {
      var wrap = container.querySelector('.aimeat-auth-wrap');
      if (again.compact && wrap) {
        wrap.classList.add('aimeat-open');
        var cb = wrap.querySelector('.aimeat-auth-compact');
        if (cb) cb.setAttribute('aria-expanded', 'true');
      }
      if (root.isConnected) open();
    }, 0);
  }
  window.addEventListener('aimeat-palette-change', syncDot);
  window.addEventListener('aimeat-theme-change', syncDot);
}

/** Local escaper (palette.js must not import from theme.js — theme.js may import from here). */
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
