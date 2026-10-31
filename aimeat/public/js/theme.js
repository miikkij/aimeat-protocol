/**
 * @file theme.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Dark/light theme controller for the AIMEAT SPA. Owns the
 *   `data-theme` attribute on <html>, persists the user's explicit choice to
 *   localStorage (`aimeat-theme`), and is light until the user chooses; the OS
 *   `prefers-color-scheme` is tracked only when the stored choice is 'auto'
 *   ("automatic"). Mirrors the i18n module's
 *   shape (getter / setter / subscribe + a `aimeat-theme-change` CustomEvent).
 *   The no-flash initial paint is handled by an inline boot snippet in
 *   spa.html <head>; this module takes over once the SPA mounts.
 * @structure getTheme, setTheme, toggleTheme, hasExplicitChoice,
 *   onThemeChange, initThemeSystem
 * @usage
 *   import { initThemeSystem, getTheme, toggleTheme, onThemeChange } from '/js/theme.js';
 *   initThemeSystem();                       // call once during boot()
 *   const off = onThemeChange((t) => ...);   // subscribe, returns unsubscribe
 *   toggleTheme();                           // flip light <-> dark
 * @version-history
 *   v1.3.0 — 2026-10-31 — Light until the person chooses: the OS preference is followed only when the
 *     stored choice is 'auto' (Jouni, v31 K65). The head snippet in spa.html decides the same way.
 *   v1.0.0 — 2026-06-02 — Initial dark/light theming (Phase 1 mechanism).
 *   v1.2.0 — 2026-09-24 — The OS listener leaves the mode alone while the page wears a style with
 *     one mode only (Themes & Styles).
 *   v1.1.0 — 2026-06-28 — Adopt external `aimeat-theme-change` events (the login pill now
 *     owns the toggle) so SPA subscribers repaint; loop-guarded via selfDispatch.
 */

const STORAGE_KEY = 'aimeat-theme';
const EVENT_NAME = 'aimeat-theme-change';
const VALID = new Set(['light', 'dark']);

/** Browser chrome (address bar) colors, matched to theme.css --bg per theme. */
const META_THEME_COLOR = { light: '#FAFAF8', dark: '#14151A' };

const listeners = new Set();
let mediaQuery = null;
// Set true while WE dispatch EVENT_NAME so the external listener (below) ignores our own echo.
let selfDispatch = false;

/** The stored value as it is ('light', 'dark', 'auto' or anything else), or null. */
function storedRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
    return null;
  }
}

/** Read the stored explicit choice of a mode, or null if the user has not chosen one. */
function storedChoice() {
  const v = storedRaw();
  return VALID.has(v) ? v : null;
}

/** Sync the <meta name="theme-color"> so mobile browser chrome matches. */
function syncMetaThemeColor(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_THEME_COLOR[theme] || META_THEME_COLOR.light);
}

/** Current active theme ('light' | 'dark'). Reflects the <html data-theme>. */
export function getTheme() {
  const attr = document.documentElement.dataset.theme;
  return VALID.has(attr) ? attr : 'light';
}

/** True if the user has explicitly picked a theme (vs. following the OS). */
export function hasExplicitChoice() {
  return storedChoice() !== null;
}

/**
 * True only when the person chose "automatic" (the key holds 'auto'): then the OS decides. With no
 * choice at all the page is light, AIMEAT's own look (Jouni, v31 K65, 2026-10-31).
 */
function followsOs() {
  return storedRaw() === 'auto';
}

/**
 * Apply a theme. `persist=true` records it as the user's explicit choice
 * (stops OS-preference tracking); `persist=false` applies without recording
 * (used by the OS-preference listener).
 */
export function setTheme(theme, persist = true) {
  const next = VALID.has(theme) ? theme : 'light';
  document.documentElement.dataset.theme = next;
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }   // eslint-disable-line aimeat/no-silent-catch -- ignore
  }
  syncMetaThemeColor(next);
  const detail = { theme: next };
  for (const fn of listeners) fn(next);
  selfDispatch = true;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
  selfDispatch = false;
  return next;
}

/** Flip between light and dark, recording the result as an explicit choice. */
export function toggleTheme() {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Initialize the theme system once at boot. The inline head snippet has
 * already set <html data-theme>; here we keep meta in sync and — only while
 * the user has no explicit choice — follow live OS preference changes.
 */
export function initThemeSystem() {
  syncMetaThemeColor(getTheme());

  // The login pill (served by libs.ts) owns the light/dark toggle now. It applies the theme
  // itself (data-theme + localStorage) and fires this same event. Adopt those external changes
  // so SPA subscribers (charts, tabs) repaint too. `selfDispatch` skips our own echo to avoid
  // a loop; we DON'T call setTheme here (the pill already set data-theme + persisted) — just
  // sync meta + notify in-module listeners.
  window.addEventListener(EVENT_NAME, (e) => {
    if (selfDispatch) return;
    const detail = /** @type {CustomEvent} */ (e).detail;
    const next = detail && detail.theme;
    if (!VALID.has(next)) return;
    syncMetaThemeColor(next);
    for (const fn of listeners) fn(next);
  });

  if (window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onOsChange = (e) => {
      if (!followsOs()) return; // the OS decides only when the person chose "automatic"
      // A style with one mode only keeps that mode (Themes & Styles; the look boot in spa.html).
      if (document.querySelector('meta[name="aimeat-light"][data-look]')) return;
      setTheme(e.matches ? 'dark' : 'light', false);
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', onOsChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(onOsChange); // older Safari
    }
  }
}
