/**
 * @file atelier/index.js
 * @description The aimeat-atelier library (TARGET-074). Exposes AIMEAT.atelier — the Atelier
 *   track's UI kit: the app shell that eats the ceremony every app used to copy, the focal hero
 *   and KPI row, the designed empty/loading states, tabs and bottom navigation, and the DOM and
 *   i18n layers underneath. Load one script and an Atelier app has its frame, its states and its
 *   motion without writing any of it.
 *
 *   IT RENDERS; IT DOES NOT FETCH. There is no network call anywhere in this library — it
 *   imports neither `_core/session.js` nor `_core/config.js`, holds no state beyond what it was
 *   last told, and reports events rather than acting on them. The one outward glance is
 *   feature-detecting window.AIMEAT.auth so the shell can mount the login pill the AUTH library
 *   owns; with no auth library on the page the shell still renders and boots sessionless.
 *
 *   THE LOOK IS NOT BAKED IN. Every colour, radius, shadow, font, density and motion value is an
 *   `--ak-*` custom property declared in /lib/aimeat-atelier.css, which IS the theming contract,
 *   and the look presets are `[data-ak-look]` blocks in that same file: vivid is the default and
 *   flat is the deliberate opt-out. A skin or a preset sets variables and nothing else.
 *
 *   MOTION IS THE KIT'S, NOT THE APP'S. Entrances, count-ups and state changes come from the
 *   components, tuned by the preset's motion tokens, finite by construction — an idle Atelier
 *   surface repaints zero times, and the finish gate measures that.
 * @structure imports the component modules (dom · i18n · shell · hero · state), composes the
 *   AIMEAT.atelier surface, attaches it via _core/namespace.
 * @usage
 *   <script src="/v1/libs/aimeat-atelier.js"></script>
 *   const a = AIMEAT.atelier.app({ title: 'Errands', onReady(session) { render(a); } });
 * @version-history
 *   v0.1.0 — 2026-08-27 — Initial slice: app shell, section, tabs, bottomNav, hero, statRow,
 *     emptyState, skeleton, dom + i18n layers (TARGET-074 phase 1, slice 1).
 */
import { attach } from '../_core/namespace.js';
import { el, append, $, $$, clear, uid, busy, guardButtons, whileBusy, injectStyle, reducedMotion, enter, countUp } from './dom.js';
import { i18n } from './i18n.js';
import { app, section, tabs, bottomNav } from './shell.js';
import { hero, statRow } from './hero.js';
import { emptyState, skeleton } from './state.js';

const atelier = {
  /**
   * The library version, so an app can require a floor before using a newer component. It MUST
   * match the newest entry in the /lib/aimeat-atelier.css version history; e2e-libs.ts fails
   * when the two drift, because a version string that never moves is worse than none.
   */
  version: '0.1.0',

  // ── Shell and navigation ──
  app, section, tabs, bottomNav,

  // ── Focal content ──
  hero, statRow,

  // ── Designed states ──
  emptyState, skeleton,

  // ── Theme, i18n, helpers ──
  injectStyle, i18n, el, append, $, $$, clear, uid, busy, whileBusy, guardButtons,
  reducedMotion, enter, countUp,
};

attach('atelier', atelier);
