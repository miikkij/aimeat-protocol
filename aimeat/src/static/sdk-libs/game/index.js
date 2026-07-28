/**
 * @file game/index.js
 * @description The aimeat-game library (NOSTE prompt 01). Exposes AIMEAT.game — a general-purpose
 *   gamification UI kit: full-screen menus, screens, overlays, progression rails and meters, the
 *   clickable score breakdown, badges, coming-soon cards, counters, streaks, leaderboards, stat
 *   grids, tables and showcase cards. Load one script and an app has game-grade UI without
 *   writing any of it.
 *
 *   IT IS A LIBRARY, NOT A GAME. Nothing here assumes a particular one. The test every component
 *   had to pass: would a quiz app, an onboarding streak, a training tracker and a business
 *   simulation all use this? Anything only one of them would want lives in that app instead.
 *
 *   IT RENDERS; IT DOES NOT FETCH. There is no network call anywhere in this library — it imports
 *   neither `_core/session.js` nor `_core/config.js`, holds no state beyond what it was last told,
 *   and reports events rather than acting on them. A component that called an API would have the
 *   wrong boundary.
 *
 *   THE LOOK IS NOT BAKED IN. Every colour, radius, shadow, font, density and motion value is a
 *   `--ag-*` custom property declared in /lib/aimeat-game.css, which IS the theming contract. A
 *   skin sets those variables and nothing else; switching one changes no JavaScript. Light is the
 *   default and `:root[data-theme="dark"]` carries dark, so both work out of the box.
 * @structure imports the component modules (dom · i18n · units · menu · screen · overlay ·
 *   progress · score · markers · board), composes the AIMEAT.game surface, attaches it via
 *   _core/namespace.
 * @usage
 *   <script src="/v1/libs/aimeat-game.js"></script>
 *   AIMEAT.game.injectStyle();
 *   AIMEAT.game.menu({ title: 'Chapters', entries, onPick(e) { … } });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial: the general-purpose gamification UI kit (NOSTE prompt 01 / requirements R-K3).
 */
import { attach } from '../_core/namespace.js';
import { el, append, $, $$, clear, uid, busy, guardButtons, whileBusy, injectStyle, reducedMotion } from './dom.js';
import { i18n } from './i18n.js';
import { money, morsels, isMoneyCurrency, MONEY_UNIT } from './units.js';
import { menu } from './menu.js';
import { screen } from './screen.js';
import { modal, toast, confirm } from './overlay.js';
import { rail, meter, counter, streak } from './progress.js';
import { scoreBreakdown } from './score.js';
import { badge, comingSoon } from './markers.js';
import { leaderboard, statGrid, dataTable, card } from './board.js';

const game = {
  /** The library version, so an app can require a floor before using a newer component. */
  version: '1.0.0',

  // ── Shell and navigation ──
  menu, screen, modal, toast, confirm,

  // ── Progression ──
  rail, meter, scoreBreakdown, badge, comingSoon, counter, streak,

  // ── Competition and tables ──
  leaderboard, statGrid, dataTable, card,

  // ── Units (money and morsels never render in one figure) ──
  money, morsels, isMoneyCurrency, MONEY_UNIT,

  // ── Theme, i18n, helpers ──
  injectStyle, i18n, el, append, $, $$, clear, uid, busy, whileBusy, guardButtons, reducedMotion,
};

attach('game', game);
