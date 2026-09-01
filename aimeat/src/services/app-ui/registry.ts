/**
 * @file src/services/app-ui/registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier mosaic's component registry (TARGET-074) — the app-side sibling of
 *   the surface-layout block registry, built on the SAME typed prop grammar (BlockPropDef), so
 *   the two systems can never grow different validation rules for the same idea.
 *
 *   ONE DECLARATION, MANY SURFACES. Each entry below is DATA, and from it derive: the validator
 *   (validate.ts), the AI catalogue every read answers with (the get tool and GET
 *   /v1/apps/ui/catalogue carry it, so the first write is never a refusal), and — later — the
 *   gallery and the client renderer's contract. A component missing here does not exist, on any
 *   door.
 *
 *   MOSAIC DESCRIBES ARRANGEMENT AND CONFIGURATION, NEVER BEHAVIOUR. A block's `source` is a
 *   memory-key prefix the APP binds and resolves; handlers, formatting and data live in the
 *   app's own code and in the served kit. That boundary is what keeps a stored layout valid
 *   arithmetic instead of a program (the eval-free CSP settles this — see the target).
 *
 *   APPEND-ONLY FROM THE FIRST STORED LAYOUT (decided 2026-08-27): a component's props may only
 *   gain entries; a breaking change is a NEW component id. Stored layouts outlive every runtime
 *   version.
 * @structure AppUiPropDef / AppUiComponentDef · NAV_MODES · LOOKS · UI_COMPONENTS ·
 *   componentById() · buildUiCatalogue()
 * @usage
 *   import { UI_COMPONENTS, componentById, buildUiCatalogue } from './registry.js';
 * @version-history
 *   v1.19.0 — 2026-09-02 — THE MOTION PARTS (append-only, wish-atelier-motion-libraries-and-
 *     parts): `thread`, `calendar`, `priceTable`, `carousel`, `sortable`, `notices` and `facets`
 *     join the components — the parts that ride the vendored Motion, anime.js and Lenis packs
 *     and the kit's own primitives. lightbox, cart and checkout stay component-only, the
 *     dialog family's rule.
 *   v1.18.0 — 2026-09-01 — FOUR OF THE NINE (append-only): `ring`, `crew`, `poll` and `keys` —
 *     the data-shaped parts the Atelier Next canvas found the kit lacked — join the
 *     components; toast, palette, compare, tour and dropzone stay component-only.
 *   v1.17.0 — 2026-08-30 — THE BROADCAST FAMILY (append-only): `crt`, `countdown` and `crawl`
 *     join the components — the Music Television genre's parts extracted as reusable blocks
 *     (the set with the credits box, the ranked rows in channel colours, the star-separated
 *     strip), asked for by name on the Design Book wall.
 *   v1.16.0 — 2026-08-30 — THE COMMERCIAL SIDE (append-only): `legalLinks`, `auditTrail`,
 *     `feedbackForm` and `reviewerLine` join the components — self-sourced blocks carrying the
 *     money-adjacent facts (the app's own legal pages with the reason each exists, the
 *     organism-rows audit trail with the two-hand rule, the Public Intake feedback form, the
 *     named reviewer with what a review lifts and what it never lifts).
 *   v1.15.0 — 2026-08-30 — More of everything (append-only): chart kind radar, `steps` (the
 *     process tracker) and `rating` (a score as stars, display only).
 *   v1.14.0 — 2026-08-30 — THE APPROVED EXPANSION (append-only): chart kinds funnel, treemap
 *     and flow; the work-planning family kanban, plan and schedule; scene3d kind "globe".
 *   v1.13.0 — 2026-08-29 — The chart family grown to the approved level (stacked, horizontal,
 *     scatter, the note bubble, tooltips) and scene3d kind "model" (a loaded .glb shown like
 *     a product) — the Näyteikkuna canvas round, accepted by the developer.
 *   v1.12.0 — 2026-08-29 — `map` joins the components (append-only): the REAL map, Leaflet
 *     over OpenStreetMap — the developer's words, after the atlas abstraction missed them:
 *     "a map" means the real one.
 *   v1.11.0 — 2026-08-29 — THE OPS FAMILY joins the components (append-only): `health`,
 *     `queue`, `gauge`, `console` — an admin panel becomes an arrangement — plus `atlas`
 *     (the offline data map) and the chart family (`kind`: axes / donut / calendar; area
 *     series; statRow trend sparklines).
 *   v1.10.0 — 2026-08-29 — `scene3d` joins the components (append-only): the 3D band on the
 *     three-world bundle — orb, sky, bars-as-terrain — one per layout, lazy-loaded.
 *   v1.9.0 — 2026-08-29 — The catalogue carries the pattern shelf: every patterns.css recipe
 *     described from the registry (atelier-patterns.ts) — what it looks like, what it evokes,
 *     which volume it belongs in — so an AI can choose a pattern by intent.
 *   v1.8.0 — 2026-08-29 — `reveal` joins the components (append-only): the fan of panels, so a
 *     questions-and-answers or terms screen is an arrangement rather than app code. The dialog
 *     family stays component-only on purpose — a modal is behaviour, not layout.
 *   v1.7.0 — 2026-08-28 — The harvest trio (append-only): `matrix` (suunta's comparison grid),
 *     `graph` (suunta's node map) and `waveform` (the sound strip kaiku, band-jam and
 *     freepartylights each hand-rolled) join the components.
 *   v1.6.0 — 2026-08-28 — THE HARVEST BEGINS (append-only): `chart` joins the components —
 *     grouped bars + drawn lines over one label axis, the shape budjetti proved every money
 *     view needs. The Book can now carry chart-bearing arrangements as data.
 *   v1.5.0 — 2026-08-28 — COLOUR OPENS AS A PAIR (append-only): `--ak-accent` joins the signature
 *     as "light/dark" — measurement proved no single hex survives both modes, so the validator
 *     runs the contrast matrix per mode against each half before accepting (TARGET-074).
 *   v1.4.0 — 2026-08-28 — SIGNATURE arrives (append-only): the bounded `--ak-*` token subset a
 *     layout may override (shape, typography, density, motion — deliberately no colour until the
 *     contrast bench can prove an override), listed in the catalogue as signature_tokens.
 *   v1.3.0 — 2026-08-27 — COMPOSITION arrives (append-only): per-block `span` (full/main/side/
 *     half) turns the stack into a composed page, and `rail` joins the nav modes — the
 *     desktop-grade left rail. The developer's award-site references made the gap plain: the
 *     missing axis was layout, not colour.
 *   v1.2.0 — 2026-08-27 — The catalogue carries the layout presets (layouts.ts): a first layout
 *     starts from a finished shape, not from nothing (TARGET-074, leiskat v1).
 *   v1.1.0 — 2026-08-27 — Append-only: every unit-forming component gains an optional `title` —
 *     the block's name in tabs, decks and canvas tiles. The first real-browser run showed
 *     component ids leaking into tab labels because most blocks had no prop to name them with.
 *   v1.0.0 — 2026-08-27 — Initial: eleven mosaic components mirroring the served kit
 *     (TARGET-074 phase 2).
 */
import type { BlockPropDef } from '../surface-layout/registry-types.js';
import { LOOKS as LOOK_REGISTRY, STRUCTURES } from '../../data/atelier-looks.js';
import { UI_LAYOUT_PRESETS, type AppUiLayoutPreset } from './layouts.js';
import { PATTERNS } from '../../data/atelier-patterns.js';

/** A mosaic prop: the shared grammar, plus whether a layout must supply it. */
export type AppUiPropDef = BlockPropDef & {
  /** The validator refuses a block that omits this prop. Most props default instead. */
  required?: true;
};

export interface AppUiComponentDef {
  /** Stable id — the kit's own component name (AIMEAT.atelier.<id>). */
  id: string;
  /** One sentence for the catalogue and the picker. */
  summary: string;
  /** The declared settings. Append-only once a layout is stored. */
  props: Record<string, AppUiPropDef>;
  /** At most this many instances per layout (the hero rule: one focal point). */
  maxPerLayout?: number;
}

/** Every navigation projection a layout may ask for — all supported on every screen size
 *  (decided 2026-08-27); the renderer carries each mode's own ergonomics. `rail` is the
 *  desktop-grade left rail that folds to a strip on a narrow screen; `overlay` is the
 *  award-site move — one Menu control opening a full-screen list in display type (both
 *  append-only additions, 2026-08-27). */
export const NAV_MODES = ['tabs', 'bottom-bar', 'canvas', 'deck', 'flow', 'rail', 'overlay'] as const;

/** How the page moves under the reader's hand. 'still' is the default and what every layout has
 *  been until now. 'cinema' is scroll-as-the-camera: the opening band recedes as you leave it and
 *  each section rises to meet you — pure CSS scroll timelines, so an idle page repaints zero
 *  times and reduced motion collapses the whole thing to end states. */
export const CHOREOGRAPHIES = ['still', 'cinema'] as const;

/** How much of the composition grid one block takes. The default is the full line; the other
 *  values are what turn a stack of cards into a COMPOSED PAGE — an asymmetric editorial split
 *  is two blocks, `main` beside `side`. */
export const BLOCK_SPANS = ['full', 'main', 'side', 'half'] as const;

/** The look presets the stylesheet ships — DERIVED from the look registry
 *  (src/data/atelier-looks.ts), the same source the generated stylesheet and the build prompt
 *  read, so the three can never disagree. check:atelier verifies every one arithmetically. */
export const LOOKS: readonly string[] = LOOK_REGISTRY.map((l) => l.id);

const text = (description: string, maxLength = 200): AppUiPropDef => ({ type: 'string', maxLength, description });
const requiredText = (description: string, maxLength = 200): AppUiPropDef => ({ type: 'string', maxLength, description, required: true });
/** A memory-key prefix the app binds this block to; the app resolves it to rows. */
const source = (): AppUiPropDef => ({
  type: 'string', maxLength: 120, required: true,
  description: 'The data binding: a memory-key prefix the app resolves to this block\'s rows.',
});

export const UI_COMPONENTS: readonly AppUiComponentDef[] = [
  {
    id: 'hero',
    summary: 'The one focal band a screen gets — gradient-mesh ground with no image, a mode-surviving scrim over one.',
    props: {
      title: requiredText('The headline.', 120),
      sub: text('The line under it.'),
      image: text('A storage URL painted under the scrim. Never a data: URI.', 500),
    },
    maxPerLayout: 1,
  },
  {
    id: 'statRow',
    summary: 'The KPI strip; figures count up when the bound data changes. A tile carrying `trend: number[]` shows its short history as a sparkline under the number.',
    props: { source: source(), title: text('The block\'s name in tabs, decks and canvas tiles.', 80) },
  },
  {
    id: 'figure',
    summary: 'The data IS the hero: ONE giant display numeral with its label and a context line, counting up on change. The source resolves to { value, label, sub?, delta? }.',
    props: { source: source(), title: text('The block\'s name in tabs, decks and canvas tiles.', 80) },
  },
  {
    id: 'list',
    summary: 'Keyed rows with live-change motion; empty renders the designed empty state.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'cardGrid',
    summary: 'The browsing grid; imageless cards keep their deterministic monogram washes.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'table',
    summary: 'Real table semantics that scroll inside their own box.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      caption: text('The screen-reader caption.', 120),
    },
  },
  {
    id: 'searchBar',
    summary: 'Debounced search that reports the query to the app.',
    props: {
      bind: text('What the app filters with this query (its own name for it).', 80),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
    },
  },
  {
    id: 'tabs',
    summary: 'A tab row; the app swaps views on the pick.',
    props: {
      items: { type: 'string[]', maxItems: 8, required: true, description: 'The tab labels, in order.' },
    },
  },
  {
    id: 'section',
    summary: 'The titled card — and the escape hatch whose body the app fills itself.',
    props: { title: text('The section title.', 80), hint: text('The line under it.', 160) },
  },
  {
    id: 'emptyState',
    summary: 'The designed empty/error/notice card.',
    props: {
      title: requiredText('What it says.', 80),
      hint: text('The line under it.', 160),
      tone: { type: 'enum', values: ['quiet', 'error', 'celebrate'], default: 'quiet', description: 'How it reads.' },
    },
  },
  {
    id: 'timeline',
    summary: 'Events on the vertical line every history shares.',
    props: { source: source(), title: text('The block\'s name in tabs, decks and canvas tiles.', 80) },
  },
  {
    id: 'mediaCard',
    summary: 'One feature card on its own.',
    props: {
      title: requiredText('The card title.', 80),
      sub: text('The line under it.', 160),
      image: text('A storage URL. Never a data: URI.', 500),
    },
  },
  {
    id: 'chart',
    summary: 'The whole chart family in one block, chosen by `kind`, drawn to the approved level (rounded sheened bars, smooth curves, a touch tooltip on every axes chart). axes (default): grouped bars, lines and soft-filled areas over one label axis — { labels, series: [{ id, label, kind: "bar"|"line"|"area", values }], stacked?: true (bars pile into one column), horizontal?: true (ranked things read sideways), note?: { label, text } (a story bubble on the one point that matters) }. donut: parts of a whole — { slices: [{ label, value }], delta?: { text, tone } } with the total and its change in the middle. calendar: days as a heat grid — { days: [{ date: "YYYY-MM-DD", value }] }, months named, the ramp explained. scatter: { points: [{ x, y, label? }], xLabel?, yLabel? } with an honest least-squares trend. funnel: stages losing people — { steps: [{ label, value }] }, the survival rate written at each step. treemap: shares as area when the donut\'s slices would not fit — { items: [{ label, value }] }. flow: where the quantity went — { nodes: [{ id, label }], links: [{ from, to, value }] }, ribbons as wide as their sums. radar: profiles on spokes — { axes: string[] (3–10), series: [{ label, values }], max? }, one polygon per series over a shared ring grid. Colours come from the look\'s own accent spectrum. presentation "mural" makes the chart the room instead of a tile.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      kind: {
        type: 'enum', values: ['axes', 'donut', 'calendar', 'scatter', 'funnel', 'treemap', 'flow', 'radar'], default: 'axes',
        description: 'The chart\'s shape — and the record shape the source must resolve to (see the summary).',
      },
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
      presentation: {
        type: 'enum', values: ['tile', 'mural'], default: 'tile',
        description: 'tile: the chart lives in its card. mural: it becomes the section\'s full-bleed ground — the data as the decor.',
      },
    },
  },
  {
    id: 'matrix',
    summary: 'Labelled rows against labelled columns, every cell a toned word — the comparison grid (capabilities × competitors, coverage, readiness). The source resolves to ONE record: { cols: [{ id, label }], rows: [{ id, label, badge?, tone?, cells: [{ col, tone: "ok"|"warn"|"err"|"accent"|"plain", label? }] }] }. Wide grids scroll inside their own box.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'graph',
    summary: 'Named nodes and the lines between them, read-only — a capability map, a dependency web. The source resolves to ONE record: { nodes: [{ id, label, tone?, x?, y? }], edges: [{ from, to, label? }] }; coordinates are 0-100 when given, and nodes without them sit on a deterministic ring.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'waveform',
    summary: 'Sound (or any magnitudes) as mirrored bars, quiet ink to loud accent. The source resolves to ONE record: { values: number[], max? }; the app owns the audio, the kit owns the picture.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'health',
    summary: 'The "is everything up" wall: one row per watched thing — a tone lamp (ok / warn / err), the name, the latest reading. The source resolves to rows of { id, label, tone?, reading?, sub? }. The first block of every monitoring screen.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'queue',
    summary: 'Work with states: a count strip (waiting / running / done / failed) over the item list, each row wearing its state as a pill. The source resolves to rows of { id, title, state?, sub? }. The "what is the system doing" view every ops screen hand-rolls.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'gauge',
    summary: 'ONE value on a dial, bands turning the tone — the number that owns a wall (CPU, balance, fill rate). The source resolves to ONE record: { value, max?, min?, label?, unit?, bands?: [{ upTo, tone }] }. The needle draws in once; nothing moves at idle.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'console',
    summary: 'The log vane: monospace lines with a time, a tone and the words, newest at the tail, capped so it never grows without bound. Follows the tail only while the reader is AT the tail. The source resolves to ONE record: { lines: [{ ts?, tone?, text }] }.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      cap: { type: 'number', min: 20, max: 2000, default: 400, description: 'How many lines the vane keeps before the oldest fall off.' },
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'atlas',
    summary: 'The data map, fully offline — country shapes ship on this node (Natural Earth), no tile server and no external host. The source resolves to ONE record: { regions?: [{ name (in English, e.g. "Finland"), value?, tone? }], markers?: [{ label?, lon, lat, tone? }] }. Regions fill with the accent at an intensity riding the value (or a tone); the view frames the data\'s extent on its own, so a Nordic dataset shows the Nordics.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      fit: { type: 'enum', values: ['auto', 'world'], default: 'auto', description: 'auto frames the matched regions and markers; world pins the whole map.' },
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'steps',
    summary: 'Where a process stands: the stations in order, done behind, current lit, the rest ahead — an order, an application, an onboarding at a glance. The source resolves to ONE record: { steps: [{ label, sub? }], current (index of the station under way) }.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'rating',
    summary: 'A score as stars: the number leads, five glyphs part-fill to it, the vote count says who. The source resolves to ONE record: { value, max? (default 5), count?, label? }. Display only — collecting a rating is a form\'s job.',
    props: {
      source: source(),
      title: text('The words beside the stars when the record carries no label.', 80),
    },
  },
  {
    id: 'kanban',
    summary: 'Work as columns by state, a card per piece — the board every team tool wants (queue shows the same work as a LIST; this is the same data as lanes). The source resolves to ONE record: { columns: [{ id, label, tone? }], cards: [{ id, column, title, sub?, badge?, tone? }] }. In an app the builder may wire onMove so cards move — drag between columns, or arrow keys on a focused card — and the app is told; bound read-only, it is the honest picture of the board.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'plan',
    summary: 'Stretches on a shared time axis — project phases, campaigns, leases: what is under way and how long still, with today drawn as a line through everything (timeline tells what HAPPENED; this tells what is RUNNING). The source resolves to ONE record: { rows: [{ label, spans: [{ from: "YYYY-MM-DD", to, label?, tone? }] }], start?, end?, today? }. Months name themselves along the top.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'schedule',
    summary: 'A week as a grid, bookings as blocks — appointments, rooms, shifts: next week at a glance, where chart kind "calendar" shows the year at a distance. The source resolves to ONE record: { days?: string[] (column names, up to 7), from?: "HH:MM", to?: "HH:MM", events: [{ day (column index), from, to, label, sub?, tone? }] }. The hour scale sizes itself to the events when from/to are omitted.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'map',
    summary: 'The REAL map: Leaflet over OpenStreetMap street tiles (the node serves Leaflet; the tiles carry their required attribution). The source resolves to ONE record: { markers: [{ label?, lon, lat, tone? }], center?: { lon, lat }, zoom? }. Two or more markers frame themselves; one centres on itself. Pins and popups ride the look\'s tokens, dark mode re-tones the tiles. When the owner says "a map", this is the block — the atlas is the offline country choropleth for data-by-country.',
    props: {
      source: source(),
      title: text('The floating chip naming the map, and the block\'s name in tabs and decks.', 80),
      zoom: { type: 'number', min: 1, max: 19, default: 12, description: 'Zoom used when the data does not decide the frame (a single marker, or a bare center).' },
      emptyTitle: text('What the empty state says when the map cannot load.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'scene3d',
    summary: 'Real depth: a 3D band on the node\'s own three-world bundle (lazy-loaded, ~745 kB, so use it as the ONE showpiece a screen gets). kind "orb" is a signature object turning under the hand; "sky" is a procedural atmosphere band; "bars" stands the bound rows up as a field of columns — the 3D chart, source rows { label?, value }; "model" shows a loaded .glb/.gltf like a product shot; "globe" is the earth with places as dots and data travelling as lifted arcs. Colours come from the look\'s tokens and the render loop stops at rest, so an idle scene costs nothing.',
    props: {
      kind: { type: 'enum', values: ['orb', 'sky', 'bars', 'model', 'globe'], default: 'orb', description: 'What the scene is: a signature object, an atmosphere band, data as terrain, a loaded 3D model shown like a product (kind "model": the source resolves to { url } — a .glb/.gltf address; it is fitted, grounded and studio-lit for you), or the earth (kind "globe": the source resolves to { points: [{ lat, lon, label? }], routes: [{ from: [lat, lon], to: [lat, lon] }] } — places as dots, data travelling as lifted arcs).' },
      source: {
        type: 'string', maxLength: 120,
        description: 'For kind "bars": the data binding the app resolves to rows of { label?, value }. Omit for orb and sky.',
      },
      title: text('The floating chip naming the scene, and the block\'s name in tabs and decks.', 80),
      emptyTitle: text('What the empty state says when 3D cannot load.', 80),
      emptyHint: text('The line under it.', 160),
    },
    maxPerLayout: 1,
  },
  {
    id: 'reveal',
    summary: 'The fan: stacked panels that open and close on a real animated height — questions and answers, terms, a spec sheet, anything long that should arrive folded. The source resolves to rows of { id, title, sub?, text? }. The header is a real button carrying its own expanded state, so nothing about it is the app\'s to get right.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      mode: { type: 'enum', values: ['one', 'many'], default: 'one', description: 'Whether one panel opens at a time, or several can stand open.' },
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'aide',
    summary: 'The in-app AI: a chat panel whose tools are the app\'s OWN declared sources and actions — it reads what the screen reads and proposes what the buttons do, a person confirms every run. Runs on the owner\'s AI key; shows the platform AI notice and per-message provenance labels itself.',
    maxPerLayout: 1,
    props: {
      title: text('The app name the aide speaks as.', 80),
      intro: text('The opening line the panel greets with.', 200),
    },
  },
  // ── The commercial side (2026-08-30, append-only): self-sourced blocks that carry the
  //    money-adjacent facts by construction. No memory source — legalLinks reads the app's own
  //    public legal surface, auditTrail the organism row space its props name, feedbackForm the
  //    named Public Intake form, reviewerLine the reviewer meta the node stamps on a served app.
  {
    id: 'legalLinks',
    summary: 'The app\'s own legal pages (terms, privacy, imprint, refunds, accessibility, cookies, support) as a list with state, links to the served pages, the reason each page exists and the readiness sentence — localised by the kit in its three languages. Reads the app\'s own public legal surface; nothing to bind.',
    maxPerLayout: 1,
    props: {
      title: text('The section title, when the kit\'s own is not wanted.', 120),
    },
  },
  {
    id: 'auditTrail',
    summary: 'The append-only trail from an organism row space, newest first: when, what, who. Needs the two-hand rule open (the organism names the app in the space; the person approves organism:rows), and shows the node\'s own refusal sentence with the rule beside it when it is not.',
    props: {
      org: requiredText('The organism id whose workspace holds the row space.', 80),
      ws: requiredText('The workspace id.', 80),
      space: requiredText('The row space name, e.g. "event".', 80),
      title: text('The section title, when the kit\'s own is not wanted.', 120),
      hint: text('The line under the title.', 200),
    },
  },
  {
    id: 'feedbackForm',
    summary: 'The public feedback form (topic, message, optional contact, honeypot) bound to a Public Intake form — works signed in or not, and places the node\'s refusal sentence on the field it concerns.',
    maxPerLayout: 1,
    props: {
      org: requiredText('The organism id the intake form belongs to.', 80),
      ws: requiredText('The workspace id.', 80),
      formId: requiredText('The intake form id, e.g. "palaute".', 80),
      title: text('The section title, when the kit\'s own is not wanted.', 120),
      hint: text('The line under the title.', 200),
    },
  },
  {
    id: 'reviewerLine',
    summary: '"Reviewed by NAME, who answers for this app" — with what a named review lifts (the visible AI-content label) and what it never lifts (the you-are-talking-to-an-AI notice), law linked. Reads the reviewer meta the node stamps on a served app; renders nothing when no reviewer is declared.',
    maxPerLayout: 1,
    props: {},
  },
  // ── The broadcast family (2026-08-30, append-only): the Music Television genre's parts as
  //    reusable components, so a builder takes the set, the countdown or the crawl without
  //    forking the whole page. Static by the register's physics — entrances only, no idle
  //    repaints; the waveform component is the standalone VU meter.
  {
    id: 'crt',
    summary: 'The CRT television set: a status strip (channel, slot, LIVE), a dark screen with static level bars, the credits box naming what plays and who made it — the provenance line is the point — and a tracking footer with progress. Display only; the app wires any transport around it. The source resolves to one record: { channel?, status?, live?, title, artist?, meta?, note?, bars?, progress? { value, total } }.',
    maxPerLayout: 1,
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says when nothing is on air.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'countdown',
    summary: 'The chart countdown: ranked rows with a big numeral, title and a sub line, votes when given, each row wearing the next channel colour. The source resolves to rows of { rank?, title, sub?, votes? } — omitted ranks count down from the top. For charts, standings with theatre, anything announced one at a time.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'crawl',
    summary: 'The news crawl: one loud strip of short items separated by stars, uppercase, standing still — it enters once and holds, because a stored arrangement never repaints on idle. The source resolves to rows of { text }, or plain strings.',
    maxPerLayout: 1,
    props: {
      source: source(),
      tone: { type: 'enum', values: ['signal', 'ink'], default: 'signal', description: 'The strip\'s ground: the signal-yellow band with ink words, or ink with paper words.' },
    },
  },
  // ── The nine parts the Atelier Next canvas found missing (2026-09-01, append-only): the four
  //    data-shaped ones join the vocabulary here — ring, crew, poll, keys. The behaviour-shaped
  //    five (toast, palette, compare, tour, dropzone) stay component-only, like the dialog family.
  {
    id: 'ring',
    summary: 'Progress toward a whole, as a ring: the value over the total in the centre, a label and a line beside it. The gauge is a dial that reads a level; the ring is a journey with an end (pages written, steps done). The source resolves to one record: { value, total, label?, sub? }.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'crew',
    summary: 'Who is on this: people and agents as ONE stack of faces (a person round, an agent square), the overflow folded into "+N", and the live dot with how many are here now. The source resolves to one record: { people: [{ id, label, agent? }], live?, max? }.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says when nobody is on it.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'poll',
    summary: 'One question, live shares: each option a bar filled to its share, the picked one marked, a pick reported to the app which records the vote wherever votes live. The source resolves to one record: { question, options: [{ id, label, count? | share? }], picked? }.',
    props: {
      source: source(),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'keys',
    summary: 'Declared shortcuts, rendered as key caps with their meaning — the app states them once and the sheet, the hints and the handlers agree. The source resolves to rows of { keys, label }.',
    maxPerLayout: 1,
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
    },
  },
  // ── v1.19.0: the parts that ride the motion libraries and the kit's own primitives ──
  {
    id: 'thread',
    summary: 'A discussion: bubbles grouped by day in a well that scrolls smoothly to the newest, what this person said on the right in the accent tint, an agent squared the way the crew stack squares an agent, and a composer where Enter sends. The source resolves to one record: { messages: [{ id, who, label?, text, at, mine?, agent?, status? }] } (a bare array of messages works too). status is sent | read | failed.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      placeholder: text('What the composer says before anything is typed.', 80),
      emptyTitle: text('What the empty state says before the first message.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'calendar',
    summary: 'A month a hand turns: ISO weeks (Monday first), today outlined, days outside the month dimmed, and each day\'s events as tinted pips (three, then "+N"). Prev and next month sit under two buttons, and turning the month staggers the day cells in. The source resolves to one record: { month: \'YYYY-MM\', events: [{ id, date: \'YYYY-MM-DD\', title, tone? }] }.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      weekStart: { type: 'number', min: 0, max: 1, default: 1, description: 'Which day a week opens on: 1 for Monday (the ISO week), 0 for Sunday.' },
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'carousel',
    summary: 'A strip of media cards you push along: each one a picture with a caption band (or a tinted card carrying the title when there is no picture), one of them current and standing a touch taller, moved by the arrows, the dots, the arrow keys or a swipe. For a set you look THROUGH rather than at — photos, covers, rooms, a week of shots. The source resolves to rows of { id, title?, sub?, image?, tone? }; tone is ok, warn or err and paints the caption edge.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says when there are no pictures.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'sortable',
    summary: 'A list whose order is the point, and a hand can change it: each row carries a grip, the carried row rides the pointer while the rows it crosses spring out of its way, and the new order reaches the app on release (Alt+ArrowUp / Alt+ArrowDown on a focused grip does the same without a mouse). The source resolves to rows of { id, label, sub?, tone? }. For a priority list, a running order, a queue somebody decides.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'notices',
    summary: 'The notification centre: items under day headings (Today, Yesterday, then the date), the unread ones wearing an accent dot and a firmer face, the kind (info / ok / warn / err) as a bar on the left edge, the time on the right, and one "Mark all read" control. A tap opens the item. The source resolves to rows of { id, title, text?, at ("YYYY-MM-DDTHH:MM:SSZ"), kind?, read?, href? }. Items that arrive on a repaint stagger in; the ones already there stand still, which is what says something is new.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says when there is nothing new.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'facets',
    summary: 'Filters over a list: one labelled group of chips per facet, the count on each chip, the picked ones in the accent, and a summary line saying how many filters stand with a Clear beside it. A multi facet toggles; a single one holds the last pick. The source resolves to ONE record: { facets: [{ id, label, multi?, options: [{ id, label, count? }] }] }. A count that moves on a repaint rolls to its new figure instead of blinking.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says when there is nothing to filter by.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'priceTable',
    summary: 'What each plan costs, side by side: one plan lifted with the accent edge and a "Most chosen" chip, the features as a check list, one call to action each. Where the data carries yearly prices a month/year control appears and the figures ROLL to their new value without the cards remounting. The source resolves to one record: { plans: [{ id, name, price, priceYearly?, features: [], highlight?, cta?, note? }], currency?, periods? }.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says when no plan is offered.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
];

/**
 * The SIGNATURE TOKENS: the bounded `--ak-*` subset a layout may override to give one app its own
 * hand — colour, shape, typography, density and motion. COLOUR IS ONE TOKEN AND IT IS A PAIR:
 * measurement proved no single hex survives every palette in both modes (the house coral fails 32
 * light-mode checks and passes dark completely), so `--ak-accent` takes "light/dark" and the
 * validator runs the full contrast matrix per mode before accepting it — colour ships proven, not
 * on trust. Growing this list is append-only, and every other entry stays provable-safe by
 * construction (a radius cannot break contrast).
 */
export const SIGNATURE_TOKENS: Record<string, string> = {
  '--ak-accent': 'The signature colour, as a LIGHT/DARK PAIR "#hex/#hex" — the light-mode value first, the dark-mode value second, e.g. "#0e7c66/#e8564a". Both values run the full contrast matrix at validation, each against its own mode, and a pair that breaks readability anywhere refuses with the numbers. Every accent derivation (text tint, gradient, spectrum, focus ring) follows the pair.',
  '--ak-radius': 'Corner rounding of cards and surfaces, e.g. "2px" for a sharp hand, "18px" for a soft one.',
  '--ak-radius-sm': 'Corner rounding of rows and inputs.',
  '--ak-radius-pill': 'Rounding of pills and chips.',
  '--ak-gap': 'The grid gap between blocks.',
  '--ak-pad': 'The base padding inside surfaces.',
  '--ak-main-max': 'The content column width, e.g. "56rem" for a tight editorial measure.',
  '--ak-font': 'The body face (a stack; the platform webfonts are already loaded).',
  '--ak-font-display': 'The display face for titles and figures.',
  '--ak-weight-display': 'The display weight, e.g. "900" for a heavy masthead.',
  '--ak-text-hero': 'The hero title size, e.g. "clamp(2.2rem, 7vw, 4.4rem)".',
  '--ak-kinetic': 'The masthead letter-throw: "letters" (each glyph arrives on the look\'s spring), "words", or "none". One kinetic headline per screen; the hero runs it, apps call nothing.',
  '--ak-tilt': 'The playful tilt of cards and tiles, e.g. "1.2deg". "0deg" is calm.',
  '--ak-motion': 'The base transition duration, e.g. "120ms" for a snappy hand.',
  '--ak-ease': 'The curve every transition and entrance rides, e.g. "cubic-bezier(0.34, 1.56, 0.64, 1)" for a springy overshoot, "linear" for a machine hand.',
  '--ak-enter-distance': 'How far content travels on entry, e.g. "0px" turns reveals off.',
  '--ak-enter-stagger': 'The gap between one entering element and the next, e.g. "0ms" lands everything at once, "90ms" deals them like cards.',
  '--ak-blur': 'The glass blur of the chrome, e.g. "0px" for solid chrome.',
};

const byId = new Map(UI_COMPONENTS.map((c) => [c.id, c]));

/** The component, or undefined — the validator words the refusal. */
export function componentById(id: string): AppUiComponentDef | undefined {
  return byId.get(id);
}

/**
 * The catalogue every read answers with: ids, summaries and full prop schemas, the nav modes
 * and looks, and the LAYOUT PRESETS — the whole vocabulary in one payload, so an AI asked to
 * change a layout never has to guess at names, and one asked to write a first layout starts
 * from a finished shape rather than from nothing.
 */
export function buildUiCatalogue(): {
  components: Array<{ id: string; summary: string; props: Record<string, AppUiPropDef>; max_per_layout?: number }>;
  nav_modes: readonly string[];
  choreographies: { values: readonly string[]; summary: string };
  looks: readonly string[];
  spans: { values: readonly string[]; summary: string };
  look_sheets: Array<{ id: string; feel: string; structures: string[] }>;
  structures: Array<{ id: string; summary: string }>;
  layouts: readonly AppUiLayoutPreset[];
  signature_tokens: { values: Record<string, string>; summary: string };
  dialog: { tones: string[]; sizes: string[]; from: string[]; summary: string };
  imagery: { summary: string };
  patterns: {
    summary: string;
    recipes: Array<{
      id: string;
      looks_like: string;
      evokes: string;
      use: { ground?: string; prop?: string; zone?: string };
      default_size: string;
    }>;
  };
} {
  return {
    components: UI_COMPONENTS.map((c) => ({
      id: c.id,
      summary: c.summary,
      props: c.props,
      ...(c.maxPerLayout !== undefined ? { max_per_layout: c.maxPerLayout } : {}),
    })),
    nav_modes: NAV_MODES,
    choreographies: {
      values: CHOREOGRAPHIES,
      summary: 'How the page moves under the reader\'s hand. still: nothing scroll-driven. cinema: the opening band recedes and each section rises as it enters the view — right for fronts, stories and reports; wrong for a tool someone lives in.',
    },
    looks: LOOKS,
    spans: {
      values: BLOCK_SPANS,
      summary: 'Optional per-block `span`: how much of the composition grid the block takes. '
        + '`full` (the default) is the whole line; `main` + `side` side by side make the '
        + 'asymmetric editorial split; two `half` blocks share a line. Narrow screens stack '
        + 'everything, so a span is layout ambition, never a mobile risk.',
    },
    // The look data sheets: what each look feels like and which page structures it carries —
    // enough for an AI to pick by intent instead of by trying them all.
    look_sheets: LOOK_REGISTRY.map((l) => ({ id: l.id, feel: l.feel, structures: l.structures })),
    structures: STRUCTURES.map((s) => ({ id: s.id, summary: s.summary })),
    layouts: UI_LAYOUT_PRESETS,
    signature_tokens: {
      values: SIGNATURE_TOKENS,
      summary: 'Optional top-level `tokens`: the app\'s SIGNATURE — bounded overrides of colour, '
        + 'shape, typography, density and motion, applied on top of the look. Only the names '
        + 'listed here are legal. The one colour door is --ak-accent as a light/dark pair '
        + '"#hex/#hex", proven by the full contrast matrix at validation — every other colour '
        + 'derives from it. The design pass: propose two or three token-sets as whole layouts, '
        + 'dry-run each, show the owner, store the one they pick.',
    },
    dialog: {
      tones: ['plain', 'danger', 'celebrate', 'ai'],
      sizes: ['compact', 'roomy', 'wide'],
      from: ['center', 'bottom'],
      summary: 'Optional top-level `dialog`: this arrangement is the INSIDE OF A MODAL rather '
        + 'than a screen — { title?, tone?, size?, from? }. The tone says what kind of moment it '
        + 'is before a word is read (plain, danger, celebrate, ai), the size how much room it '
        + 'takes, and from whether it arrives centred or up from the bottom edge for a phone. '
        + 'Open it with AIMEAT.atelier.dialog({ layout, sources, ...the shape }); the buttons and '
        + 'when it opens stay your app\'s. A dialog SHAPE travels through the Design Book like '
        + 'any other arrangement.',
    },
    imagery: {
      summary: 'Optional top-level `imagery`: art direction for the imagery pipeline as data — '
        + '{ style: "the illustration prompt fragment", palette_words?: "colour words" }. '
        + 'Builders and the Design Book\'s illustration parts write it; image generation reads it.',
    },
    patterns: {
      summary: 'The pattern shelf (patterns.css): gradient-built background recipes on the '
        + '--ak-* tokens, technique after Temani Afif\'s CSS-Pattern (MIT). Class is '
        + '.ak-pat-<id> plus ONE volume: .ak-pat--ground (a whole page stands on it, body text '
        + 'proven readable), .ak-pat--prop (one object\'s texture — a chip, an edge, an empty '
        + 'state), .ak-pat--zone (full ink, ONE banner or divider per screen, words only inside '
        + 'solid chips; -2/-3 take the spectrum colours, -ink goes monochrome). Tile size: '
        + '--ak-pat-size on the element. Both text-bearing volumes are proven by the contrast '
        + 'matrix (AK-PAT) in every look × palette × mode.',
      recipes: PATTERNS.map((p) => ({
        id: p.id,
        looks_like: p.looksLike,
        evokes: p.evokes,
        use: p.use,
        default_size: p.defaultSize,
      })),
    },
  };
}
