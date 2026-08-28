/**
 * @file auth/theme.js
 * @description aimeat-auth presentation helpers (SDK-libs migration Phase 3): the light/dark theme
 *   toggle that travels INSIDE the login pill (so every embedding app inherits it for free — reads/
 *   writes the same 'aimeat-theme' localStorage key + <html data-theme> the SPA uses, and fires an
 *   'aimeat-theme-change' window event), plus escHtml, the compact-pill CSS injector, and the
 *   two-letter pill initials. Extracted from auth-lib-part2.ts.
 * @structure escHtml · aimeatReadTheme/aimeatApplyTheme · modeSwitchHtml/wireModeSwitch ·
 *   ensureAuthPillStyles · pillInitials.
 * @usage import { escHtml, modeSwitchHtml, wireModeSwitch } from './theme.js';
 * @version-history
 *   v1.3.0 — 2026-08-29 — ensureAuthPillStyles carries the whole pill (signed in, signed out, compact),
 *     class-based and drawn from the page's tokens with fallbacks, in place of the gold gradients
 *     that were inline in pill.js.
 *   v1.2.0 — 2026-07-26 — ?mode= is read first and applied at parse time (aimeatRestoreMode), the
 *     same door ?palette= and ?lang= use, so an embedded app follows the embedding page's light/
 *     dark instead of its own origin's storage. Not persisted.
 *   v1.1.0 — 2026-07-25 — The lone ☾/☀ toggle becomes a segmented ☀|☾ mode switch (both options
 *     visible, active marked), styled by cluster.js instead of inline styles.
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part2.ts (SDK-libs migration Phase 3).
 */

export function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Theme toggle (travels with the login pill) ──
var AIMEAT_THEME_KEY = 'aimeat-theme';

export function aimeatReadTheme() {
  // ?mode= first, the same door ?palette= and ?lang= use: an app embedded by another page cannot
  // read the choice made on the embedder's origin, so the embedder says it and the app follows.
  // Deliberately not persisted — being embedded in a dark page is not a decision about the app.
  try {
    var u = new URLSearchParams(location.search).get('mode');
    if (u === 'light' || u === 'dark') return u;
  } catch { /* no location */ }
  try { var s = localStorage.getItem(AIMEAT_THEME_KEY); if (s === 'light' || s === 'dark') return s; } catch { /* storage blocked */ }
  var attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

export function aimeatApplyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(AIMEAT_THEME_KEY, t); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new CustomEvent('aimeat-theme-change', { detail: { theme: t } })); } catch { /* no window */ }
}

/**
 * Adopt an embedder's ?mode= onto <html> at parse time, without persisting it. The app's own
 * light/dark snippet reads localStorage and cannot know it is inside someone else's page; this
 * runs after it and lets the embedding page win for as long as the embed lasts. No URL param
 * means no opinion, so a normally-opened app is untouched.
 */
export function aimeatRestoreMode() {
  try {
    var u = new URLSearchParams(location.search).get('mode');
    if (u === 'light' || u === 'dark') document.documentElement.dataset.theme = u;
  } catch { /* no location */ }
}

/**
 * The MODE control: a segmented ☀ | ☾ where both options are visible and the active one is
 * marked — the same pattern as the language switch, so the cluster reads as one instrument.
 * Cluster classes come from cluster.js (ensureClusterStyles).
 */
export function modeSwitchHtml(i) {
  var cur = aimeatReadTheme();
  var light = i.lightMode || 'Light mode';
  var dark = i.darkMode || 'Dark mode';
  return '<span id="aimeat-mode-switch" class="aimeat-seg" role="group" aria-label="' + escHtml(i.themeLabel || 'Theme') + '">'
    + '<button type="button" data-mode="light" aria-pressed="' + (cur === 'light') + '" title="' + escHtml(light) + '" aria-label="' + escHtml(light) + '">'
    + '<span class="seg-ico" aria-hidden="true">☀</span></button>'
    + '<button type="button" data-mode="dark" aria-pressed="' + (cur === 'dark') + '" title="' + escHtml(dark) + '" aria-label="' + escHtml(dark) + '">'
    + '<span class="seg-ico" aria-hidden="true">☾</span></button>'
    + '</span>';
}

export function wireModeSwitch(container) {
  var root = container.querySelector('#aimeat-mode-switch');
  if (!root) return;
  function sync(cur) {
    root.querySelectorAll('button[data-mode]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === cur));
    });
  }
  root.querySelectorAll('button[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-mode');
      aimeatApplyTheme(m);
      sync(m);
    });
  });
  // Follow out-of-band changes (the app's own logic, another control instance, the SPA).
  window.addEventListener('aimeat-theme-change', function (ev) {
    var e = /** @type {CustomEvent} */ (ev);
    if (e && e.detail && e.detail.theme) sync(e.detail.theme);
  });
}

// ── The pill's stylesheet (signed in, signed out, and the compact form) ──
// One injected sheet, class-based. Every colour is a page token with a fallback, so the pill is ink
// on paper in the shell, light on a dark page and whatever a palette says: --text for the frame
// and the words, --accent for the name, --success for the live dot, --sun for the sign-in slab's
// shadow. A page may override any of it through the --aimeat-pill-* variables without touching
// the lib. On viewports ≤600px (compact mode, the default on app origins) the row folds behind a
// small account button (dot + initials + caret) that opens it as an anchored popover; the
// show/hide is pure CSS media so it reflows on rotation.
export function ensureAuthPillStyles() {
  if (document.getElementById('aimeat-auth-pill-css')) return;
  var st = document.createElement('style');
  st.id = 'aimeat-auth-pill-css';
  var ink = 'var(--aimeat-pill-fg,var(--text,#1A1A2E))';
  var paper = 'var(--aimeat-pill-bg,var(--bg,#FAFAF8))';
  var font = 'var(--aimeat-pill-font,var(--font-showroom-body,var(--font,system-ui,sans-serif)))';
  st.textContent = [
    '.aimeat-auth-pill{display:inline-flex;align-items:center;gap:10px;padding:4px 11px;',
      'border:2px solid ' + ink + ';background:' + paper + ';color:' + ink + ';',
      'border-radius:var(--aimeat-pill-radius,0);font-family:' + font + ';font-size:13px;line-height:1.4}',
    '.aimeat-auth-dot{display:inline-block;flex:0 0 auto;width:9px;height:9px;',
      'background:var(--aimeat-pill-live,var(--success,#10B981))}',
    '.aimeat-auth-label{display:inline-flex;align-items:center;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}',
    '.aimeat-auth-ghii{font-weight:800;font-size:13px;color:var(--aimeat-pill-name,var(--accent,#E8564A))}',
    '.aimeat-auth-fed{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:.04em;',
      'padding:1px 6px;border:2px solid currentColor}',
    '.aimeat-auth-gear{appearance:none;background:none;border:2px solid currentColor;color:inherit;border-radius:0;',
      'padding:2px 7px;cursor:pointer;font-size:13px;line-height:1}',
    '.aimeat-auth-logout{appearance:none;background:none;border:0;border-bottom:2px solid currentColor;border-radius:0;',
      'padding:0 0 1px;margin:0;cursor:pointer;color:inherit;font-family:inherit;font-size:11px;font-weight:800;',
      'letter-spacing:.04em;text-transform:uppercase;line-height:1.4}',
    '.aimeat-auth-logout:hover,.aimeat-auth-gear:hover{color:var(--aimeat-pill-name,var(--accent,#E8564A))}',
    /* Signed out: the cluster beside one ink slab with the sun's offset shadow. */
    '.aimeat-auth-out{display:inline-flex;align-items:center;gap:10px;color:' + ink + '}',
    '.aimeat-sign-btn{appearance:none;padding:8px 16px;background:var(--aimeat-pill-cta-bg,' + ink + ');',
      'color:var(--aimeat-pill-cta-fg,' + paper + ');border:0;border-radius:var(--aimeat-pill-radius,0);cursor:pointer;',
      'font-family:' + font + ';font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;line-height:1.4;',
      'box-shadow:4px 4px 0 var(--aimeat-pill-cta-shadow,var(--sun,#FFB52E));transition:transform .12s,box-shadow .12s}',
    '.aimeat-sign-btn:hover{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--aimeat-pill-cta-shadow,var(--sun,#FFB52E))}',
    /* Compact: the account button, and the pill as its popover. */
    '.aimeat-auth-wrap{position:relative;display:inline-flex;align-items:center}',
    '.aimeat-auth-compact{display:none;align-items:center;gap:7px;padding:5px 11px 5px 9px;cursor:pointer;',
      'background:' + paper + ';color:' + ink + ';border:2px solid ' + ink + ';border-radius:var(--aimeat-pill-radius,0);',
      'font-family:' + font + ';font-size:13px}',
    '.aimeat-auth-compact .cdot{width:8px;height:8px;flex:0 0 auto;background:var(--aimeat-pill-live,var(--success,#10B981))}',
    '.aimeat-auth-compact .cini{font-weight:800;letter-spacing:.3px;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.aimeat-auth-compact .ccar{font-size:9px;opacity:.75;transition:transform .18s}',
    '.aimeat-auth-wrap.aimeat-open .aimeat-auth-compact .ccar{transform:rotate(180deg)}',
    '@media (max-width:600px){',
      '.aimeat-auth-compact{display:inline-flex}',
      '.aimeat-auth-wrap>.aimeat-auth-pill{position:absolute;top:calc(100% + 8px);right:0;z-index:1000;',
        'display:none!important;flex-wrap:wrap!important;justify-content:flex-start;row-gap:9px;padding:10px 12px;',
        'min-width:210px;max-width:calc(100vw - 24px);box-shadow:6px 6px 0 var(--aimeat-pill-cta-shadow,var(--sun,#FFB52E))}',
      '.aimeat-auth-wrap.aimeat-open>.aimeat-auth-pill{display:flex!important}',
    '}',
  ].join('');
  (document.head || document.documentElement).appendChild(st);
}

// Two-letter initials for the compact button, from a display name / GHII / owner (strips the
// @node and #owner suffixes so a GAII/GHII shows the person, not the node).
export function pillInitials(s) {
  s = (s || '').trim();
  if (!s) return '•'; // bullet fallback
  s = s.split('@')[0].split('#')[0].trim();
  var parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}
