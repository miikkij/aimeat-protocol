/**
 * @file auth/theme.js
 * @description aimeat-auth presentation helpers (SDK-libs migration Phase 3): the light/dark theme
 *   toggle that travels INSIDE the login pill (so every embedding app inherits it for free — reads/
 *   writes the same 'aimeat-theme' localStorage key + <html data-theme> the SPA uses, and fires an
 *   'aimeat-theme-change' window event), plus escHtml, the compact-pill CSS injector, and the
 *   two-letter pill initials. Extracted from auth-lib-part2.ts.
 * @structure escHtml · aimeatReadTheme/aimeatApplyTheme · themeToggleHtml/wireThemeToggle ·
 *   ensureAuthPillStyles · pillInitials.
 * @usage import { escHtml, themeToggleHtml, wireThemeToggle } from './theme.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part2.ts (SDK-libs migration Phase 3).
 */

export function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Theme toggle (travels with the login pill) ──
var AIMEAT_THEME_KEY = 'aimeat-theme';

export function aimeatReadTheme() {
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

export function themeToggleHtml(i) {
  var dark = aimeatReadTheme() === 'dark';
  var title = dark ? (i.themeToLight || 'Switch to light mode') : (i.themeToDark || 'Switch to dark mode');
  return '<button id="aimeat-theme-toggle" class="aimeat-theme-toggle" title="' + escHtml(title) + '" '
    + 'aria-label="' + escHtml(title) + '" style="display:inline-flex;align-items:center;justify-content:center;'
    + 'width:30px;height:30px;flex:0 0 auto;background:transparent;border:1px solid rgba(127,127,127,.4);'
    + 'border-radius:8px;cursor:pointer;font-size:15px;line-height:1;padding:0;color:currentColor">'
    + (dark ? '☀' : '☾') + '</button>';
}

export function wireThemeToggle(container, i) {
  var btn = container.querySelector('#aimeat-theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var next = aimeatReadTheme() === 'dark' ? 'light' : 'dark';
    aimeatApplyTheme(next);
    var dark = next === 'dark';
    btn.textContent = dark ? '☀' : '☾';
    var title = dark ? (i.themeToLight || 'Switch to light mode') : (i.themeToDark || 'Switch to dark mode');
    btn.title = title; btn.setAttribute('aria-label', title);
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
