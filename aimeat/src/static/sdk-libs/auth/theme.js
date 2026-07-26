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

// ── Compact login pill styles (default ON on app origins) ──
// On viewports ≤600px the full gold pill is replaced by a small gold "account" button (green dot +
// initials + caret); tapping it opens the full pill as an anchored popover. Styles are injected once;
// the show/hide is pure CSS media so it reflows on rotation.
export function ensureAuthPillStyles() {
  if (document.getElementById('aimeat-auth-pill-css')) return;
  var st = document.createElement('style');
  st.id = 'aimeat-auth-pill-css';
  st.textContent = [
    '.aimeat-auth-wrap{position:relative;display:inline-flex;align-items:center}',
    '.aimeat-auth-compact{display:none;align-items:center;gap:7px;padding:5px 11px 5px 9px;cursor:pointer;',
      'background:linear-gradient(160deg,#3d2e1a 0%,#6b4c2a 15%,#c9a84c 30%,#f5e6a3 45%,#c9a84c 55%,#8b6914 70%,#4a3520 100%);',
      'border:1px solid rgba(201,168,76,.6);border-top-color:rgba(245,230,163,.5);border-bottom-color:rgba(75,53,32,.8);',
      'border-radius:10px;box-shadow:0 1px 0 rgba(245,230,163,.3) inset,0 -1px 0 rgba(75,53,32,.5) inset,0 3px 10px rgba(0,0,0,.4);',
      'font-family:system-ui;font-size:13px;color:#2a1800;text-shadow:0 1px 0 rgba(245,230,163,.5)}',
    '.aimeat-auth-compact .cdot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;',
      'background:radial-gradient(circle at 35% 35%,#b0ffc8,#00c853 40%,#00802e 80%,#003d15);box-shadow:0 0 5px rgba(0,200,83,.6)}',
    '.aimeat-auth-compact .cini{font-weight:800;letter-spacing:.3px;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.aimeat-auth-compact .ccar{font-size:9px;opacity:.75;transition:transform .18s}',
    '.aimeat-auth-wrap.aimeat-open .aimeat-auth-compact .ccar{transform:rotate(180deg)}',
    '@media (max-width:600px){',
      '.aimeat-auth-compact{display:inline-flex}',
      '.aimeat-auth-wrap>.aimeat-auth-pill{position:absolute;top:calc(100% + 8px);right:0;z-index:1000;',
        'display:none!important;flex-wrap:wrap!important;justify-content:flex-start;row-gap:9px;',
        'min-width:210px;max-width:calc(100vw - 24px)}',
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
