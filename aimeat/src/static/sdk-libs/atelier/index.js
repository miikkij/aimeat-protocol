/**
 * @file atelier/index.js
 * @description The aimeat-atelier library (TARGET-074). Exposes AIMEAT.atelier — the Atelier
 *   track's UI kit: the app shell that eats the ceremony every app used to copy, the focal hero
 *   and KPI row, the designed empty/loading states, tabs and bottom navigation, and the DOM and
 *   i18n layers underneath. Load one script and an Atelier app has its frame, its states and its
 *   motion without writing any of it.
 *
 *   IT RENDERS; IT DOES NOT FETCH — WITH ONE NAMED EXCEPTION. The library imports no
 *   `_core/session.js`, holds no credentials, no state beyond what it was last told, and reports
 *   events rather than acting on them. The mosaic module is the single exception: one sessionless
 *   GET of the app's OWN public layout record (`/v1/apps/:owner/:filename/ui`), which is as
 *   public as the app itself and read the way the stylesheet is read. The other outward glance is
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
 *   v0.17.0 — 2026-08-28 — The signature colour pair: a layout's `--ak-accent` token in the form
 *     "#light/#dark" is applied per mode by the mosaic (style element scoped to the host), so an
 *     app can carry its own proven brand colour in both themes. Validation and the contrast
 *     proof live on the server; the kit only applies what was accepted.
 *   v0.16.0 — 2026-08-28 — Agentness in the app (phase 6's tail): delegate() — "let AI handle
 *     it" on a declared task, spend-guarded through the agents library, outcome in the same
 *     view — and agentActivity(), the owner's agents' work as the kit's own timeline. Both
 *     degrade with words when no agent surface exists.
 *   v0.15.0 — 2026-08-28 — The boot gate presents the app (shell: centered sign-in with name +
 *     tagline, main hidden while gated; body overflow clipped so the frame owns all scrolling).
 *   v0.14.0 — 2026-08-28 — copilot → aide, everywhere (function, mosaic block id, classes, i18n
 *     keys), before any app uses it: the old name collides with a large product family. The
 *     developer picked the new name; UI titles are Aide / Apuri / Ayudante.
 *   v0.13.0 — 2026-08-28 — The AI-native layer (phase 6): aide() (shipped briefly as copilot())
 *     whose tools are the app's own
 *     declarations, the mosaic `aide` block, the viewer's overlay (setOverlay), explain(),
 *     exposeActions() (the same declarations as a visiting agent's WebMCP tools) — and phase 7's
 *     free pair: set({ density }) on the shell and readAloud() over the speech library.
 *   v0.12.0 — 2026-08-28 — The signature (bounded token overrides from the stored layout) and the
 *     shared-element morphs (canvas tile → focused screen, list row → detail).
 *   v0.11.0 — 2026-08-28 — The first AEB review's kit fixes: designed sign-in after the boot
 *     grace, the hero claiming a repeated title, visible list selection with the detail brought
 *     into view, and the styling round in shell.css/content.css.
 *   v0.10.0 — 2026-08-27 — Scroll reveals on the composition grid and the `overlay` projection
 *     (the full-screen menu in display type) — the award-site motion vocabulary, kit-owned.
 *   v0.9.0 — 2026-08-27 — figure(): the data IS the hero — one giant display numeral with its
 *     mono label and context line, counting up on change (the Cape Town move from the research
 *     base). Reaches the mosaic vocabulary as the `figure` component.
 *   v0.8.0 — 2026-08-27 — Kit release marker (the JS↔CSS pin): the look factory — presets are
 *     generated from the one look registry, and five new looks (broadsheet, gallery, brutalist,
 *     terminal, aurora) arrive as data entries. Stylesheet-only.
 *   v0.7.0 — 2026-08-27 — Composition: the mosaic's stack becomes a six-column composition grid
 *     driven by per-block `span`, and `rail` joins the projections (desktop left rail, phone
 *     strip). The CSS reshapes editorial into a front page and lets poster run edge to edge.
 *   v0.6.0 — 2026-08-27 — Kit release marker (the JS↔CSS pin): the spectrum release — OKLCh-derived
 *     hues, the drifting aurora hero, ambient page ground, glass chrome, grain, dark with a soul.
 *     Stylesheet-only.
 *   v0.5.0 — 2026-08-27 — Kit release marker (the JS↔CSS pin): the energetic presets commit —
 *     poster on the brand gradient, sticker tilts the grid, neon-dense glows. Stylesheet-only.
 *   v0.4.1 — 2026-08-27 — Kit release marker (the JS↔CSS pin): the stylesheet imports its own
 *     token upstream, so palette accents, webfonts and display personalities reach every app.
 *     Stylesheet-only fix.
 *   v0.4.0 — 2026-08-27 — The mosaic renderer (TARGET-074 phase 2): `mosaic(spec)` reads the
 *     app's stored layout record and renders it from the kit's own components — the app binds
 *     sources by name, the layout arranges. All five navigation projections from day one: stack,
 *     tabs, bottom-bar, deck (scroll-snap), flow (stepper) and canvas (pan-zoom tiles that expand
 *     to full view). Unit switches ride View Transitions where the browser has them.
 *   v0.3.4 — 2026-08-27 — Kit release marker (the JS↔CSS pin): every .ak-root is a positioning
 *     context, so component-internal absolutes never stretch the page. Stylesheet-only fix.
 *   v0.3.3 — 2026-08-27 — Kit release marker (the JS↔CSS pin): the main scroller's children
 *     never flex-shrink — the tab row was crushed to 12px. Stylesheet-only fix.
 *   v0.3.2 — 2026-08-27 — A full-frame app stamps .ak-body on <body> (margin 0, page ground):
 *     the browser's default 8px body margin left a gutter around the frame, because no preflight
 *     resets it on this track. Second real-browser finding of the run.
 *   v0.3.1 — 2026-08-27 — The shell's boot defers one tick: with requireLogin off (or a session
 *     already live) onReady fired before app() returned, so the host's own handle was undefined
 *     inside it. Found by the first real-browser verification run, not by the string tests.
 *   v0.3.0 — 2026-08-27 — The content and data components arrive: list (keyed rows, live-change
 *     motion), listDetail (container-query master–detail), cardGrid + mediaCard (deterministic
 *     monogram washes where no image exists), form (declared fields with the accessibility
 *     wiring built in), table (scrolls in its own box, sortable, tabular numerals), searchBar
 *     and timeline.
 *   v0.2.0 — 2026-08-27 — The look system arrives: seven presets (vivid · calm-card · editorial ·
 *     sticker · neon-dense · poster · flat) in the stylesheet, verified by pnpm check:atelier —
 *     the full 70-combination preset × palette × mode matrix, run arithmetically. No JS surface
 *     change; the version moves with the stylesheet it is pinned to.
 *   v0.1.0 — 2026-08-27 — Initial slice: app shell, section, tabs, bottomNav, hero, statRow,
 *     emptyState, skeleton, dom + i18n layers (TARGET-074 phase 1, slice 1).
 */
import { attach } from '../_core/namespace.js';
import { el, append, $, $$, clear, uid, busy, guardButtons, whileBusy, injectStyle, reducedMotion, enter, countUp } from './dom.js';
import { i18n } from './i18n.js';
import { app, section, tabs, bottomNav } from './shell.js';
import { hero, statRow, figure } from './hero.js';
import { aide } from './aide.js';
import { delegate, agentActivity } from './agentic.js';
import { emptyState, skeleton } from './state.js';
import { list, listDetail } from './list.js';
import { cardGrid, mediaCard } from './grid.js';
import { form } from './form.js';
import { table, searchBar } from './table.js';
import { timeline } from './timeline.js';
import { mosaic, appRef } from './mosaic.js';

const atelier = {
  /**
   * The library version, so an app can require a floor before using a newer component. It MUST
   * match the newest entry in the /lib/aimeat-atelier.css version history; e2e-libs.ts fails
   * when the two drift, because a version string that never moves is worse than none.
   */
  version: '0.17.0',

  // ── Shell and navigation ──
  app, section, tabs, bottomNav,

  // ── The stored layout, rendered ──
  mosaic, appRef,

  // ── Focal content ──
  hero, statRow, figure,
  aide, delegate, agentActivity,

  /**
   * Read something aloud through the platform's speech library, when the page carries it.
   * Opt-in by construction: nothing speaks until the app puts a control on the screen and a
   * person presses it. Returns false when the speech library is absent, so the app can hide
   * the control instead of showing a dead one.
   * @param {Element|string} target - an element (its text is read) or the text itself
   * @returns {boolean}
   */
  readAloud(target) {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (!ns || !ns.speech || typeof ns.speech.say !== 'function') return false;
    const text = target instanceof Element ? (target.textContent || '') : String(target);
    if (text.trim()) ns.speech.say(text.trim());
    return true;
  },

  // ── Content ──
  list, listDetail, cardGrid, mediaCard, timeline,

  // ── Data ──
  form, table, searchBar,

  // ── Designed states ──
  emptyState, skeleton,

  // ── Theme, i18n, helpers ──
  injectStyle, i18n, el, append, $, $$, clear, uid, busy, whileBusy, guardButtons,
  reducedMotion, enter, countUp,
};

attach('atelier', atelier);
