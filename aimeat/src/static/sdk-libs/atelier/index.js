/**
 * @file atelier/index.js
 * @description The aimeat-atelier library (TARGET-074). Exposes AIMEAT.atelier — the Atelier
 *   track's UI kit: the app shell that eats the ceremony every app used to copy, the focal hero
 *   and KPI row, the designed empty/loading states, tabs and bottom navigation, and the DOM and
 *   i18n layers underneath. Load one script and an Atelier app has its frame, its states and its
 *   motion without writing any of it.
 *
 *   IT RENDERS; IT DOES NOT FETCH — WITH TWO NAMED EXCEPTIONS. The library imports no
 *   `_core/session.js`, holds no credentials, no state beyond what it was last told, and reports
 *   events rather than acting on them. The mosaic module is the first exception: one sessionless
 *   GET of the app's OWN public layout record (`/v1/apps/:owner/:filename/ui`), which is as
 *   public as the app itself and read the way the stylesheet is read. The commercial module is
 *   the second, in the same class: one sessionless GET of the app's OWN public legal surface
 *   (`/v1/apps/:owner/:filename/legal`) — pre-contract information, served without the access
 *   code. The other outward glance is feature-detecting window.AIMEAT.auth (and, in the
 *   commercial module, AIMEAT.rows / AIMEAT.intake) so components can ride the libraries the
 *   app loaded; with none of them on the page everything still renders and degrades in words.
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
 *   v0.47.0 — 2026-09-05 — THE AMBIENT (wish-atelier-ambient-visuals): the one layer allowed to
 *     move at idle. The contract gains --ak-ambient, --ak-ambient-alpha and --ak-ambient-speed,
 *     named by the look and proven by the matrix (AK-AMBIENT); ambient(), ambientStage(),
 *     weather(), attract(), setWeather() and weatherLevel() join the surface; app() mounts the
 *     layer behind the frame with the weather switch beside the motion switch; a stored
 *     arrangement's `ambient` reaches the frame through the mosaic; lounge and dawn are the
 *     two worlds built for it. The doctrine stays: every component still repaints zero times
 *     at idle, and the layer pauses on a hidden tab, stills under Less motion and reduced
 *     motion, and goes quiet under the viewer's weather.
 *   v0.46.0 — 2026-09-02 — ROUND THREE (wish-atelier-motion-round-three): layoutMove, swipeStack
 *     and micro on Motion; morph, draggable, burst and scrub on anime.js; the director learns
 *     snap and sideways chapters, with parallax and readingRail beside it; the transitions reach
 *     the kit's own places (the theme switch as an iris, a look change under a curtain, a picked
 *     row morphing into its detail, intro() for the first paint) and setMotion with the visible
 *     less-motion switch; every look carries its spring hand in --ak-spring-*.
 *   v0.45.0 — 2026-09-02 — THE SHOW (wish-atelier-story-director-show): director and storyRail
 *     on Lenis (scenes in order, each with its entrance, hold and progress; the rail; the keys),
 *     the anime.js show pieces textReveal, drawPath, gridWave, sequence and orbit, and the
 *     transitions screenTransition, panelTransition and curtain (View Transitions where the
 *     browser has them, a curtain layer where not). The AIMEAT story page is the first app on
 *     the director.
 *   v0.44.0 — 2026-09-02 — MOTION (wish-atelier-motion-libraries-and-parts, stages 2 and 3).
 *     The kit's own primitives: spring, stagger, inView, scrollLink and drag on the Web
 *     Animations API (springFrames for the curve, flipFrom for a FLIP on the spring) — no
 *     dependency, finite, a no-op under reduced motion. Eleven parts on top, each riding ONE
 *     library lazy-loaded from this node: carousel and lightbox (Motion), calendar and
 *     priceTable (anime.js), thread and checkout (Lenis), sortable, cart, notices and facets
 *     (the primitives), and the kanban card now travels to its column on a spring. Every part
 *     renders and works before its library lands; the library only adds the travel.
 *   v0.42.0 — 2026-09-01 — NINE PARTS the canvas found missing (stage 3): ring (progress toward
 *     a whole), crew (people and agents as one stack, with the live dot), poll (one question,
 *     live shares), keys (declared shortcuts, rendered), dropzone (bring-a-file; the app
 *     uploads), toast (the stacked confirmation with an undo), palette (one keystroke to every
 *     declared action), compare (two states under one handle) and tour (a few steps over the
 *     real screen). ring, crew, poll and keys join the mosaic vocabulary; the behaviour-shaped
 *     rest stay component-only, the dialog family's own rule.
 *   v0.41.0 — 2026-09-01 — MATERIALS AND MOTION (the Atelier Next canvas, stage 2): materials.css
 *     carries seven surfaces (glass, aurora, grain, ink, signal, ring, spot) and six recipes
 *     (magnet, tilt, sheen, thumb, odometer, deal) as classes on the tokens; materials.js adds
 *     the six helpers that need a hand on the wheel — spotlight, tilt, sheen, odometer, thumb,
 *     deal. Nothing loops on idle; reduced motion collapses all of it.
 *   v0.40.0 — 2026-09-01 — Kit release marker (the JS↔CSS pin): BROADCAST, the look — the
 *     night-gallery world in light and dark, and the channel colours promoted to contract
 *     tokens so a look retunes the broadcast family under the matrix's proof. Stylesheet-only.
 *   v0.39.0 — 2026-08-30 — THE BROADCAST FAMILY AND THE SAMPLE STATES (the owner's ask, on the
 *     Design Book wall): crt (the television set with the credits box — the provenance is the
 *     point), countdown (ranked rows in channel colours) and crawl (the star-separated news
 *     strip, standing still) extract the Music Television genre's parts as components and join
 *     the mosaic vocabulary; the commercial components gain a marked sample state (`sample:
 *     true`, or a fill's <angle-bracketed> placeholder in a prop) so a gallery shows what they
 *     look like instead of the grey refusals that are only honest inside a running app.
 *   v0.38.0 — 2026-08-30 — THE COMMERCIAL SIDE (the wish of 2026-08-29): eight components so a
 *     builder never re-derives how the money-adjacent facts are shown — legalLinks (the app's
 *     own pages with state, readiness and the reason each exists, localised in the kit's three
 *     languages), readinessChip (the owner's nudge, never a block), legalPageFrame (the frame
 *     with the who-answers footer), auditTrail + recordEvent (the append-only organism-rows
 *     trail with the two-hand rule spoken on refusal), feedbackForm (Public Intake with the
 *     honeypot built in), reviewerLine (what a named review lifts and what it never lifts,
 *     law linked) and marksSwitches (the owner's badge and install switches). legalLinks,
 *     auditTrail, feedbackForm and reviewerLine join the mosaic vocabulary.
 *   v0.37.0 — 2026-08-30 — MORE OF EVERYTHING (the developer's ask): chart kind radar
 *     (profiles on spokes), steps (the process tracker — done / current / ahead), rating
 *     (a score as part-filled SVG stars).
 *   v0.36.0 — 2026-08-30 — THE APPROVED EXPANSION, all three baskets: chart kinds funnel,
 *     treemap and flow (own layouts, no library); the work-planning family kanban (cards
 *     move — drag or arrow keys — and the app is told), plan (stretches against months,
 *     today as a line) and schedule (the week grid); and scene3d kind `globe` — the earth
 *     with data travelling as arcs, on the three-world bundle already vendored.
 *   v0.35.0 — 2026-08-30 — THE APPROVED LEVEL: the chart family grown whole (stacked and
 *     horizontal bars, scatter with an honest trend, the note bubble, a touch tooltip on every
 *     axes chart, sheened rounded bars, the donut's total-and-delta centre, named calendar
 *     months) — chart.js split into chart-core/chart/chart-shapes; the gauge redrawn as a real
 *     half-dial; hero sparklines gain area fills; and scene3d kind `model`: a loaded .glb/.gltf
 *     fitted, grounded and studio-lit like a product shot (three-world-loaders bundle,
 *     lazy-loaded).
 *   v0.34.0 — 2026-08-29 — `map`: the REAL map — Leaflet over OpenStreetMap tiles, served by
 *     this node, one clean card, token pins and popups, dark-mode tile toning. The atlas
 *     stays the offline world choropleth; the map is what "a map" means.
 *   v0.33.0 — 2026-08-29 — THE NEXT LEVEL, second wave: the ops family (health wall, work
 *     queue, gauge, console), the offline atlas (Natural Earth shapes served by the node —
 *     no tile server), the chart family (donut, calendar; area series; statRow trend
 *     sparklines), and LIVE BY DECLARATION (the mosaic's `live` map rides aimeat-live with
 *     firehose guards built in).
 *   v0.32.0 — 2026-08-29 — scene3d: real depth on the three-world bundle (lazy-loaded), three
 *     kinds (orb, sky, bars-as-terrain), token colours read live, render loop stops at rest.
 *   v0.31.0 — 2026-08-29 — THE SCENIC LAYER: scenics.css/js (ticker, stamp, torn edge, flap
 *     board, polaroid, plaque, spotlight, receipt roll, ransom letters, VU, barcode, scanlines
 *     — with builders flapify/ransom/vu/typeout/dealIn) and patterns.css (eight gradient-built
 *     pattern recipes × three volumes on kit tokens; technique after Temani Afif, MIT).
 *   v0.30.0 — 2026-08-29 — The bones freed (CSS-side): press-sheet and marquee compositions.
 *   v0.29.0 — 2026-08-29 — WORLDS OWN THEIR GROUNDS (CSS-side): riso paper, terminal phosphor,
 *     stage night — literal ground pairs proven by the matrix in both modes, glass re-declared
 *     per block so chrome follows the world.
 *   v0.28.0 — 2026-08-29 — THE NEXT LEVEL, first landing: kinetic() (the masthead arrives one
 *     letter at a time, opted in per look), the chart mural presentation, the cinema scroll
 *     choreography, the page-grain layer, and two new worlds in the look registry (riso, stage).
 *   v0.27.0 — 2026-08-29 — The milk-coffee film removed from every card and the page ambient;
 *     [hidden] finally hides inside the kit (CSS-side).
 *   v0.26.0 — 2026-08-29 — The lane and the band (CSS-side): a page takes the whole window by
 *     default and a hero is sized by its content; the AIMEAT palette speaks the house faces.
 *   v0.25.0 — 2026-08-29 — THE THINGS THAT OPEN: reveal() (the fan — animated true-height
 *     panels, one or many), drawer() (the menu that slides from an edge) and the DIALOG
 *     DEPARTMENT — dialog(), confirm(), prompt(), sheet() — all on the native <dialog> top
 *     layer, so the focus trap, Escape and focus return are the browser's own.
 *   v0.24.0 — 2026-08-29 — MOTION grows up: attention() — the notice-me gesture (pulse, shake,
 *     flash, rise) exported for the moment something needs the eye, and wired into the form's
 *     own refusal; entrances ride the look's `--ak-ease`; the signature opens `--ak-ease` and
 *     `--ak-enter-stagger`, so a motion recipe can change the curve and the deal, not just the
 *     speed.
 *   v0.23.0 — 2026-08-28 — Billboard (the full-canvas look) and the Voltage palette land beside
 *     the kit (CSS-side; the palette rides the golden pill like every other).
 *   v0.22.0 — 2026-08-28 — The volume rule freed (CSS-side): tilt becomes a hover greeting,
 *     the monogram grounds commit to real chroma with a gradient-cut letter, the vivid aurora
 *     deepens. Readability floors unmoved; matrix 3292/3292.
 *   v0.21.0 — 2026-08-28 — The nesting guard (CSS-side): every look block declares the
 *     inverse-band trio, so a look previewed inside another never wears the outer band's type.
 *   v0.20.0 — 2026-08-28 — The harvest trio: matrix (suunta's comparison grid), graph (suunta's
 *     node map, ring layout when coordinates are absent) and waveform (the sound strip as data —
 *     the app owns the audio, the kit owns the picture).
 *   v0.19.0 — 2026-08-28 — The chart (TARGET-074, the harvest): grouped bars + drawn lines over
 *     one label axis, data-driven and library-free, colours from the look's spectrum, entrance
 *     animated and reduced-motion-safe. In the mosaic as the `chart` block; budjetti's
 *     costs/income/cash shape is the reason it exists.
 *   v0.18.0 — 2026-08-28 — The carnival look and the inverse band (CSS-side: the hero's own
 *     text-colour pair joins the contract, the subline no longer dims by default, and the
 *     matrix models the band's true grounds). No JS change; the version rides the pin.
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
import { el, append, $, $$, clear, uid, busy, guardButtons, whileBusy, injectStyle, reducedMotion, enter, kinetic, countUp, attention } from './dom.js';
import { i18n } from './i18n.js';
import { flapify, ransom, vu, typeout, dealIn } from './scenics.js';
import { app, section, tabs, bottomNav } from './shell.js';
import { hero, statRow, figure, rating } from './hero.js';
import { aide } from './aide.js';
import { delegate, agentActivity } from './agentic.js';
import { emptyState, skeleton } from './state.js';
import { list, listDetail } from './list.js';
import { cardGrid, mediaCard } from './grid.js';
import { form } from './form.js';
import { table, searchBar } from './table.js';
import { timeline } from './timeline.js';
import { chart } from './chart.js';
import { dialog, confirm, prompt, sheet } from './dialog.js';
import { reveal, drawer } from './disclose.js';
import { matrix } from './matrix.js';
import { graph } from './graph.js';
import { waveform } from './waveform.js';
import { scene3d } from './scene3d.js';
import { health, queue, gauge } from './ops.js';
import { kanban, plan, schedule, steps } from './planner.js';
import { konsole } from './konsole.js';
import { atlas } from './atlas.js';
import { map } from './map.js';
import { mosaic, appRef } from './mosaic.js';
import {
  legalLinks, readinessChip, legalPageFrame, auditTrail, recordEvent, feedbackForm,
  reviewerLine, marksSwitches,
} from './commercial.js';
import { crt, countdown, crawl } from './mtv.js';
import { spotlight, tilt, sheen, odometer, thumb, deal } from './materials.js';
import { ring, crew, poll, keys, dropzone } from './parts.js';
import { toast, palette, compare, tour } from './parts-ui.js';
import { springFrames, spring, stagger, inView, scrollLink, drag } from './motion.js';
import { carousel, lightbox } from './motion-parts.js';
import { calendar, priceTable } from './anime-parts.js';
import { thread, checkout } from './lenis-parts.js';
import { sortable, cart, notices, facets, flipFrom } from './flow-parts.js';
import { director, storyRail } from './lenis-director.js';
import { parallax, readingRail } from './lenis-more.js';
import { textReveal, drawPath, gridWave, sequence, orbit } from './anime-show.js';
import { morph, draggable, burst, scrub } from './anime-more.js';
import { layoutMove, swipeStack, micro } from './motion-show.js';
import { screenTransition, panelTransition, curtain, intro } from './transitions.js';
import { setMotion } from './dom.js';
import { ambient, setWeather, weatherLevel } from './ambient.js';
import { ambientStage, weather, attract } from './ambient-parts.js';

const atelier = {
  /**
   * The library version, so an app can require a floor before using a newer component. It MUST
   * match the newest entry in the /lib/aimeat-atelier.css version history; e2e-libs.ts fails
   * when the two drift, because a version string that never moves is worse than none.
   */
  version: '0.47.0',

  // ── Shell and navigation ──
  app, section, tabs, bottomNav,

  // ── The stored layout, rendered ──
  mosaic, appRef,

  // ── Focal content ──
  hero, statRow, figure, rating,
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
  list, listDetail, cardGrid, mediaCard, timeline, chart, matrix, graph, waveform, scene3d,

  // ── The ops family and the maps (an admin panel is an arrangement, not app code) ──
  health, queue, gauge, console: konsole, atlas, map,

  // ── The work-planning family (work against people and time) ──
  kanban, plan, schedule, steps,

  // ── The things that open ──
  reveal, drawer, dialog, confirm, prompt, sheet,

  // ── The commercial side (legal pages, marks, reviewer, audit trail, feedback) ──
  legalLinks, readinessChip, legalPageFrame, auditTrail, recordEvent, feedbackForm,
  reviewerLine, marksSwitches,

  // ── The broadcast family (the Music Television genre's parts as components) ──
  crt, countdown, crawl,

  // ── Materials and motion recipes that need a hand on the wheel (materials.css has the rest) ──
  spotlight, tilt, sheen, odometer, thumb, deal,

  // ── The nine parts the canvas found missing (ring, crew, poll, keys also mosaic blocks) ──
  ring, crew, poll, keys, dropzone, toast, palette, compare, tour,

  // ── The kit's own motion primitives (Web Animations API, no dependency, finite, reduced-motion safe) ──
  springFrames, spring, stagger, inView, scrollLink, drag, flipFrom,

  // ── The parts that ride the motion libraries: Motion (carousel, lightbox), anime.js (calendar,
  //    priceTable), Lenis (thread, checkout) — each lazy-loads its pack from this node ──
  carousel, lightbox, calendar, priceTable, thread, checkout,

  // ── The parts on the kit's own primitives (sortable, notices, facets also mosaic blocks) ──
  sortable, cart, notices, facets,

  // ── The show: the Lenis director (scenes in order, each with its motion), the anime.js show
  //    pieces, and the transitions between screens and between panels ──
  director, storyRail, parallax, readingRail,
  textReveal, drawPath, gridWave, sequence, orbit,
  morph, draggable, burst, scrub,
  layoutMove, swipeStack, micro,
  screenTransition, panelTransition, curtain, intro, setMotion,

  // ── The ambient: the one layer allowed to move at idle, its stage, the weather switch and
  //    attract mode (the look decides; the viewer's weather and Less motion always win) ──
  ambient, ambientStage, weather, attract, setWeather, weatherLevel,

  // ── Data ──
  form, table, searchBar,

  // ── Designed states ──
  emptyState, skeleton,

  // ── Theme, i18n, helpers ──
  injectStyle, i18n, el, append, $, $$, clear, uid, busy, whileBusy, guardButtons,
  reducedMotion, enter, kinetic, countUp, attention,

  // ── Scenic props (the genre stagecraft) ──
  flapify, ransom, vu, typeout, dealIn,
};

attach('atelier', atelier);
