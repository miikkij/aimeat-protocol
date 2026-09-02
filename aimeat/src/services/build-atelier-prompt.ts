/**
 * @file src/services/build-atelier-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier track's build spec (TARGET-074) — the OTHER canonical app-building
 *   prompt, beside Classic's build-app-prompt.ts and deliberately separate from it. The two
 *   tracks have their own guides that never teach each other's mechanics; the only shared ground
 *   is the platform's general rules (data shapes, scopes, publishing).
 *
 *   GENERATED, NOT WRITTEN. The component catalogue and the look tables below are DATA, and the
 *   prompt text renders from them — the surface-layout lesson: a hand-written list drifts, and
 *   the builder then reads the resulting refusal as "the AI is broken". When the app-ui
 *   declaration registry lands (phase 2 of the target), these arrays move into it and this file
 *   renders from that instead; the exported names are the seam.
 *
 *   WHY THIS PROMPT IS SMALL where Classic's is ~40 kB of prose: everything the Classic spec has
 *   to TEACH (mobile safety, theme restore, chrome reserve, ARIA, animation discipline, designed
 *   states) the Atelier kit CARRIES structurally, so the spec only has to hand over the
 *   vocabulary and the few rules the structure cannot enforce.
 * @structure
 *   - ATELIER_COMPONENTS / ATELIER_FEATURE_POINTERS — the catalogue data the prompt renders from
 *   - ATELIER_LOOKS / PALETTE_COLOR_WORDS — the look picker + the imagery pipeline's style words
 *   - composeAtelierPrompt(config, opts) — { full, body }
 *   - buildAtelierSpecToken(config) — digest of the body, for the publish spec gate
 * @usage
 *   import { buildAtelierPrompt, buildAtelierSpecToken } from './build-atelier-prompt.js';
 *   const { full, body } = buildAtelierPrompt(config, { lang: 'en', mode: 'new' });
 * @version-history
 *   v1.20.0 — 2026-09-02 — A game starts from shell-phaser-game; the prompt says so under the
 *     shell line.
 *   v1.19.0 — 2026-09-02 — The motion paragraph names the spring hand: a look carries its own
 *     stiffness, damping and mass in --ak-spring-*, and the primitives read them off the
 *     element, so an author tunes the look rather than every call.
 *   v1.18.0 — 2026-09-02 — The kit's motion primitives (spring, stagger, inView, scrollLink,
 *     drag) named beside the recipes, and the three vendored animation packs (motion, anime,
 *     lenis) pointed at with the read-the-doc-first rule, because each changed its API after
 *     the version a model knows (wish-atelier-motion-libraries-and-parts).
 *   v1.17.0 — 2026-09-01 — The materials and the motion recipes named beside the scenic props,
 *     with the physics they keep (kit v0.41.0).
 *   v1.16.0 — 2026-08-29 — "A map" means the REAL map: the `map` block (Leaflet + OSM) taught
 *     as the answer to the word, the atlas demoted to its narrow choropleth truth.
 *   v1.18.0 — 2026-08-30 — Radar, steps and rating taught.
 *   v1.17.0 — 2026-08-30 — The approved expansion taught: chart kinds funnel/treemap/flow,
 *     the work-planning family (kanban/plan/schedule), scene3d kind "globe".
 *   v1.16.0 — 2026-08-30 — The grown chart family taught (stacked, horizontal, scatter, note
 *     bubble, tooltips, donut delta) and scene3d kind "model" (a .glb by URL as a product shot).
 *   v1.15.0 — 2026-08-29 — THE DEMO TRAP named in the genre section: a block stack wearing a
 *     look is never a statement — subject first, genre fork, components serving the page
 *     (docs/pitfalls.md §34, learned the hard way twice in one day).
 *   v1.14.0 — 2026-08-29 — The machine room taught: the ops family (health / queue / gauge /
 *     console), the chart family (kind + area + trend sparklines), the offline atlas, and
 *     LIVE BY DECLARATION (the mosaic's `live` map over aimeat-live).
 *   v1.13.0 — 2026-08-29 — scene3d taught beside the mural: the one-per-layout showpiece
 *     (orb / sky / bars-as-terrain) on the three-world bundle, a statement rather than a
 *     default.
 *   v1.12.0 — 2026-08-29 — THE PATTERN SHELF: every patterns.css recipe rendered from the
 *     registry (atelier-patterns.ts) with what it looks like, what it evokes and which volume
 *     it belongs in — a pattern is chosen by intent, never by trying them all.
 *   v1.11.0 — 2026-08-29 — THE GENRE MENU: thirteen complete committed registers rendered from
 *     the template registry — "fork a genre, swap the words, keep the physics" becomes the
 *     first move whenever the owner wants the app to look like something.
 *   v1.10.0 — 2026-08-29 — The next-level vocabulary: the choreography field (scroll as the
 *     camera), the chart mural, and the note that the loud looks throw their masthead in one
 *     letter at a time on their own — nothing for the builder to call.
 *   v1.9.0 — 2026-08-29 — A MOTION section: entrances and the hover greeting stay the
 *     components' work, and the one call a builder makes is the attention gesture (pulse /
 *     shake / flash / rise), with its rules — one element, never decoration, never instead of
 *     words.
 *   v1.8.0 — 2026-08-28 — The signature section teaches the COLOUR PAIR (--ak-accent as
 *     "#light/#dark", matrix-proven per mode) and the Design Book section names the five part
 *     kinds and the replace-vs-merge adopt rule.
 *   v1.7.0 — 2026-08-28 — "Two details" grows into "What the review always catches": the second
 *     AEB round's app-level root causes as rules (say a number once, content before the form,
 *     listDetail always, one top bar, filters apply on change, the tagline, no storage internals
 *     on screen) — stated once here instead of re-found per app.
 *   v1.6.0 — 2026-08-28 — "AI inside the app": the aide block over declared sources and
 *     actions, explain() from declarations, and the viewer's overlay (TARGET-074 phase 6).
 *   v1.5.0 — 2026-08-28 — The signature section: bounded token overrides, the design pass
 *     (compose three, dry-run, the owner picks) and reference-derived shape reading — colour
 *     explicitly excluded until the contrast bench can prove it (TARGET-074 phase 4).
 *   v1.4.0 — 2026-08-28 — "Two details the review always catches": edit mode says so, and counters
 *     share their source with the lists beside them. Both are the first AEB review's app-level
 *     findings, stated once here instead of waiting to be re-found per app.
 *   v1.3.0 — 2026-08-27 — Composition: per-block `span` and the `rail` nav mode reach the
 *     generated guide — compose a page, never pile cards.
 *   v1.2.0 — 2026-08-27 — The first move is a layout preset: the catalogue's `layouts` are the
 *     starting shapes, filled rather than composed (TARGET-074, leiskat v1).
 *   v1.1.0 — 2026-08-27 — The mosaic section: apps render through AIMEAT.atelier.mosaic() and
 *     declare sources; the arrangement is the stored layout record (TARGET-074 phase 2). The
 *     spec token moves with the body, as designed.
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2 pulled forward: the track's own spec).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import { LOOKS as LOOK_REGISTRY } from '../data/atelier-looks.js';
import { getAppTemplateIndex } from '../data/app-templates.js';
import { PATTERNS } from '../data/atelier-patterns.js';

/** Slot the publish gate's token is substituted into (mirrors build-app-prompt.ts). */
const SPEC_TOKEN_SLOT = '{{aimeat_spec_token}}';

/**
 * The component catalogue the prompt renders from. One entry per component: what it is in one
 * sentence, and a copyable call that is already art-directed — copying the example IS the paved
 * path. This array is the seam the app-ui declaration registry replaces later.
 */
export const ATELIER_COMPONENTS: ReadonlyArray<{ id: string; summary: string; example: string }> = [
  {
    id: 'app',
    summary: 'The shell that carries the whole ceremony: login pill + boot, language re-render, designed loading/empty/error/sign-in states, the only scrolling region, the bottom chrome reserve. Fill handle.main; switch states with handle.status().',
    example: "var a = AIMEAT.atelier.app({ title: 'Errands', look: 'vivid', onReady: function (s) { render(a, s); } });",
  },
  {
    id: 'hero',
    summary: 'The ONE focal band a screen gets (two heroes is shouting, zero is flat). With no image it paints a designed gradient mesh; with an image the text sits on a mode-following scrim. data: URIs are refused — upload to storage and pass the URL.',
    example: "AIMEAT.atelier.hero({ target: a.main, title: 'Errands', sub: '3 open', actions: [{ id: 'add', label: 'Add', kind: 'primary', onClick: addOne }] });",
  },
  {
    id: 'statRow',
    summary: 'The KPI strip. On set(), a changed figure counts up — the state-change motion arrives with the data.',
    example: "var kpis = AIMEAT.atelier.statRow({ target: a.main, tiles: [{ id: 'open', label: 'Open', value: 3 }] }); kpis.set({ tiles: [{ id: 'open', label: 'Open', value: 4 }] });",
  },
  {
    id: 'list',
    summary: 'Rows keyed by id: set() adds (slides in), removes and updates (flashes) instead of rebuilding. Rows are real buttons when onPick exists; an empty list renders the designed empty state.',
    example: "var l = AIMEAT.atelier.list({ target: a.main, items: [], onPick: open, empty: { title: 'No errands yet', action: { label: 'Add one', onClick: addOne } } }); l.set({ items: rows });",
  },
  {
    id: 'listDetail',
    summary: 'The list beside a detail pane, split by a container query: a narrow box shows one pane at a time with a back affordance. You render the detail; select() drives it.',
    example: "var ld = AIMEAT.atelier.listDetail({ target: a.main, items: rows, renderDetail: function (item, body) { body.textContent = item.title; } });",
  },
  {
    id: 'cardGrid',
    summary: 'The browsing grid. Every card has an art area with zero images: deterministic monogram washes keep a pictureless grid designed, never grey.',
    example: "AIMEAT.atelier.cardGrid({ target: a.main, items: products, onPick: openProduct });",
  },
  {
    id: 'mediaCard',
    summary: 'One card on its own — a feature, a highlight — with an optional action row.',
    example: "AIMEAT.atelier.mediaCard({ target: a.main, item: { id: 'p1', title: 'Featured' }, actions: [{ id: 'go', label: 'Open', kind: 'primary', onClick: go }] });",
  },
  {
    id: 'form',
    summary: 'Fields declared as data, accessibility wired for you (labels, hints, worded inline errors, focus to the first problem). Throw { field, message } from onSubmit and the form places your rule like its own. NEVER hand-roll inputs or ARIA.',
    example: "AIMEAT.atelier.form({ target: dlg, fields: [{ name: 'title', label: 'What', required: true }, { name: 'due', label: 'When', type: 'date' }], onSubmit: save });",
  },
  {
    id: 'table',
    summary: 'Real table semantics that scroll INSIDE THEIR OWN BOX (the page never widens), sortable headers with aria-sort, tabular numerals.',
    example: "AIMEAT.atelier.table({ target: a.main, columns: [{ key: 'name', label: 'Name', sortable: true }, { key: 'n', label: 'Count', align: 'right' }], rows: rows });",
  },
  {
    id: 'searchBar',
    summary: 'Debounced search that reports the query; what it means is your business.',
    example: "AIMEAT.atelier.searchBar({ target: a.main, onChange: function (q) { l.set({ items: filter(rows, q) }); } });",
  },
  {
    id: 'timeline',
    summary: 'Events on the vertical line every history and activity view shares.',
    example: "AIMEAT.atelier.timeline({ target: a.main, items: [{ id: 'e1', ts: Date.now(), title: 'Published', tone: 'ok' }] });",
  },
  {
    id: 'tabs',
    summary: 'A tab row that reports the pick; you swap the view.',
    example: "AIMEAT.atelier.tabs({ target: a.main, items: [{ id: 'open', label: 'Open' }, { id: 'done', label: 'Done' }], onChange: show });",
  },
  {
    id: 'figure',
    summary: 'The data IS the hero: one giant numeral with its label and context line, counting up on change — use it when a single number is what the person came to see.',
    example: "AIMEAT.atelier.figure({ target: a.main, value: 48, label: 'Combined storage', sub: 'Monday looks like the wettest day.', delta: '-19% vs last year' });",
  },
  {
    id: 'section',
    summary: 'The titled card AND the escape hatch: markup the catalogue cannot express goes inside a section body, so custom work keeps the surface, the measure and the entrance. This is the ONLY place raw HTML belongs.',
    example: "var s = AIMEAT.atelier.section({ target: a.main, title: 'Custom' }); s.body.appendChild(myOwnMarkup);",
  },
  {
    id: 'emptyState',
    summary: 'The designed empty/error/notice card — spot mark, title, hint, action. Never ship a bare string or a grey box.',
    example: "AIMEAT.atelier.emptyState({ target: host, title: 'Nothing matched', hint: 'Try another word.' });",
  },
  {
    id: 'skeleton',
    summary: 'Loading placeholder rows the real content replaces; the shimmer is finite.',
    example: 'var sk = AIMEAT.atelier.skeleton({ target: a.main, rows: 3 }); load().then(function (rows) { sk.destroy(); l.set({ items: rows }); });',
  },
];

/**
 * The look picker + each look's imagery style words — DERIVED from the look registry
 * (src/data/atelier-looks.ts), the same source the generated stylesheet and the mosaic
 * catalogue read. The prompt's look table and the CSS cannot drift apart.
 */
export const ATELIER_LOOKS: ReadonlyArray<{ id: string; feel: string; imagery: string }> =
  LOOK_REGISTRY.map((l) => ({ id: l.id, feel: l.feel, imagery: l.imagery }));

/** Palette colour words for imagery prompts, matching /lib/aimeat-theme.css. */
export const PALETTE_COLOR_WORDS: Readonly<Record<string, string>> = {
  aimeat: 'coral red accents on cool slate and off-white',
  paper: 'warm cream ground with bordeaux accents',
  circuit: 'steel blue-grey ground with cyan accents',
  contrast: 'pure black and white, no midtones',
  mist: 'low-saturation sage greens, soft neutral ground',
};

function renderCatalogue(): string {
  return ATELIER_COMPONENTS
    .map((c) => `- \`${c.id}\` — ${c.summary}\n  \`\`\`js\n  ${c.example}\n  \`\`\``)
    .join('\n');
}

function renderLooks(): string {
  return ATELIER_LOOKS.map((l) => `- \`${l.id}\` — ${l.feel}. Imagery style: ${l.imagery}.`).join('\n');
}

export interface AtelierPromptOptions {
  lang?: string;
  mode?: 'new' | 'improve';
  idea?: string;
}

/** The platform-instructions body (the part the spec token digests). */
function composeBody(config: AimeatConfig): string {
  const base = config.baseUrl.replace(/\/+$/, '');
  let body = '';

  body += '## The Atelier track\n\n';
  body += 'You are building on the ATELIER track. Its guide is THIS document and the '
    + '`node:aimeat-app-builder-atelier` skill — never the standard build spec at '
    + '/v1/prompts/build-app, whose vocabulary (daisyUI classes, hand-written boilerplate) does '
    + 'not apply here. The app declares `<meta name="aimeat-track" content="atelier">` so a '
    + 'later session loads the right guide.\n\n';
  body += 'Start from the shell — fetch it, never invent the structure:\n\n'
    + '```\n'
    + `GET ${base}/v1/app-templates/shell-atelier\n`
    + '```\n\n'
    + 'A GAME starts from the game shell instead: the same frame with a Phaser canvas, a title '
    + 'menu, pause, settings and a leaderboard already wired through aimeat-phaser:\n\n'
    + '```\n'
    + `GET ${base}/v1/app-templates/shell-phaser-game\n`
    + '```\n\n';
  body += 'The head is eight lines and stays that way: the ceremony (theme restore, login boot, '
    + 'mobile guards, designed states, accessibility wiring, motion) lives in the served kit, '
    + 'not in your file. Every byte you add is a byte you re-read on every edit.\n\n';

  body += '## The components (`AIMEAT.atelier`)\n\n';
  body += 'Every component takes a spec and returns `{ el, set(patch), destroy() }`. Copying an '
    + 'example below yields a finished, beautiful, accessible piece — that is the paved path.\n\n';
  body += renderCatalogue() + '\n\n';

  body += '## The mosaic: the arrangement lives outside your file\n\n';
  body += 'Render the screen through `AIMEAT.atelier.mosaic(...)` instead of appending components '
    + 'by hand. You declare WHAT the app has — one resolver per data source name, an `onPick`, a '
    + '`fallback` layout of blocks — and the ARRANGEMENT (order, look, navigation mode) is a '
    + 'stored record the owner\'s AI can change later with one `aimeat_app_ui_set` call, no '
    + 'republish. Source names are the binding contract: keep them stable across edits.\n\n'
    + '```js\n'
    + 'var m = AIMEAT.atelier.mosaic({\n'
    + '  app: a,\n'
    + "  sources: { 'errands.': loadErrandRows },   // name → rows (or a Promise of rows)\n"
    + "  live: { 'errands.': { keyPrefix: 'errands.' } },   // see below — optional\n"
    + '  onPick: function (blockId, item) { open(item); },\n'
    + "  fallback: { v: 1, blocks: [\n"
    + "    { id: 'top', component: 'hero', props: { title: 'Errands' } },\n"
    + "    { id: 'main', component: 'list', props: { source: 'errands.' } },\n"
    + '  ] },\n'
    + '});\n'
    + "m.refresh('errands.');   // after your data changed — the change paints with motion\n"
    + '```\n\n'
    + 'LIVE BY DECLARATION: load `' + base + '/v1/libs/aimeat-live.js` beside the kit and give '
    + 'the mosaic a `live` map — source name → { keyPrefix } naming the memory keys whose change '
    + 'means that source moved. When anything writes those keys (the owner\'s agent, another '
    + 'device, a schedule), the source re-resolves and the screen repaints with the components\' '
    + 'own motion — you never poll, never open a socket, never write a listener. The wiring '
    + 'refuses a memory subscription without a keyPrefix (that would re-fetch on every write '
    + 'anyone makes) and never fires more often than every few seconds. Without the live '
    + 'library on the page the declaration is inert, so it is always safe to write.\n\n'
    + 'The layout\'s `nav` field projects the same blocks as stacked sections, a tab row, a bottom '
    + 'bar, a swipeable deck, a step-by-step flow, a pan-zoom canvas, a desktop-grade left rail '
    + '(`rail`) or a full-screen menu in display type (`overlay`) — all of them work on every '
    + 'screen size, so never build navigation by hand. On the stacked grid, blocks below the fold '
    + 'reveal as the person scrolls; that too is the kit\'s, never yours to code.\n\n'
    + 'Two more one-field decisions, both data and both optional. `choreography: "cinema"` makes '
    + 'scroll the camera: the opening band recedes as the person leaves it and each section rises '
    + 'to meet them — right for a front, a story or a report, wrong for a tool someone lives in, '
    + 'and free at idle because it is pure CSS scroll timelines. And a chart block may carry '
    + '`presentation: "mural"`: the chart stops living in a tile and becomes the section\'s '
    + 'full-bleed ground — the data as the decor, one mural per screen.\n\n'
    + 'THE MACHINE ROOM IS AN ARRANGEMENT, NOT APP CODE. Four blocks make any admin or '
    + 'monitoring screen: `health` (one row per watched thing — lamp, name, latest reading), '
    + '`queue` (work items with states, counted in a strip), `gauge` (ONE value on a dial, '
    + 'bands turning the tone) and `console` (the log vane — monospace, capped, follows the '
    + 'tail only while the reader is at the tail). Their tones ride the theme\'s ok/warn/err '
    + 'colours, so a status screen reads at a glance in every look and mode.\n\n'
    + 'CHARTS ARE A FAMILY on one block: `chart` with `kind: "axes"` (bars, lines and filled '
    + 'areas — a series may be kind "area"; `stacked: true` piles the bars into one column per '
    + 'label, `horizontal: true` turns ranked things sideways, and a `note` puts a one-line '
    + 'story bubble on the point that matters — every axes chart answers touch with a tooltip '
    + 'on its own), `"donut"` (parts of a whole — the total in the middle, and a `delta` puts '
    + 'its change there too), `"calendar"` (a stretch of days as a heat grid, months named) or '
    + '`"scatter"` (points on two measures with an honest trend line), `"funnel"` (stages '
    + 'losing people — the survival rate written at each step), `"treemap"` (shares as area '
    + 'when the donut\'s slices would not fit), `"flow"` (where the quantity went — ribbons '
    + 'as wide as their sums) or `"radar"` (profiles on spokes — one polygon per series, for '
    + '"strong where, weak where"). A statRow tile carrying '
    + '`trend: [numbers]` draws its short history as a filled sparkline under the figure.\n\n'
    + 'WORK AGAINST PEOPLE AND TIME is its own family: `kanban` (work as columns by state — '
    + 'queue shows the same work as a list, this is the board, and with onMove wired the '
    + 'cards actually move), `plan` (stretches on a shared time axis with today drawn as a '
    + 'line — timeline tells what happened, this tells what is running) and `schedule` (a '
    + 'week as a grid, bookings as blocks — chart kind "calendar" is the year at a distance, '
    + 'this is next week). And two small truth-tellers: `steps` (where a process stands — '
    + 'done behind, current lit, the rest ahead) and `rating` (a score as stars, display '
    + 'only — collecting one is a form\'s job).\n\n'
    + 'WHEN THE OWNER SAYS "A MAP", THEY MEAN THE REAL ONE: the `map` block is Leaflet over '
    + 'OpenStreetMap street tiles — pins with popups at real addresses, the view framing the '
    + 'markers on its own, the licence\'s attribution built in, dark mode re-toning the tiles. '
    + 'The `atlas` block is the different, narrower thing: an offline choropleth of countries '
    + 'for data-by-country, no streets on it. Reaching for atlas when the owner asked for a '
    + 'map is a wrong answer with a confident face.\n\n'
    + 'And when a screen has earned a SHOWPIECE, the `scene3d` block gives it real depth: '
    + '`kind: "orb"` (a signature object turning under the hand), `"sky"` (a procedural '
    + 'atmosphere band), `"bars"` (the bound rows stand up as a field of columns — the 3D '
    + 'chart), `"model"` (a .glb/.gltf by URL, fitted, grounded and studio-lit like a '
    + 'product shot) or `"globe"` (the earth — places as dots, data travelling between them '
    + 'as lifted arcs). One per layout, loaded lazily, colours from the look\'s tokens, and the render '
    + 'loop stops at rest so an idle scene costs nothing. It is a statement, not a default: '
    + 'most screens want a chart, not a scene.\n\n'
    + 'COMPOSE, do not pile: a block may carry `span` — `full` (default), `main` + `side` for the '
    + 'asymmetric editorial split, or `half` — and the screen becomes a laid-out page instead of a '
    + 'column of cards. Narrow screens fold every span to one column on their own.\n\n'
    + 'THE FIRST MOVE IS A PRESET, not a blank page: `GET ' + base + '/v1/apps/ui/catalogue` '
    + 'carries `layouts` — finished, fillable shapes (cover, dashboard, browse, work-queue, '
    + 'story-deck, guided-flow). Pick the one nearest the app, replace every <angle-bracketed> '
    + 'value with the app\'s own words and source names, and use it as the fallback — and as the '
    + 'first stored layout when the owner wants one.\n\n';

  // THE GENRES — rendered from the template registry, never hand-listed (the surface-layout
  // lesson: a hand-written menu drifts and the builder reads the refusal as a broken AI).
  const genres = getAppTemplateIndex().filter((t) => t.kind === 'genre');
  body += '## Or start from a GENRE — a complete committed register\n\n';
  body += 'When the owner wants the app to LOOK LIKE SOMETHING — a poster, a console, a departure '
    + 'board — do not assemble blocks: FORK A GENRE. Each genre is a finished free-composition '
    + 'page in a committed register; fetch it with `GET ' + base + '/v1/app-templates/<id>`, swap '
    + 'the words, sources and images for the app at hand, and KEEP THE PHYSICS (finite entrances, '
    + 'motion only under the hand or the scroll, zero idle repaints, reduced-motion honesty). '
    + 'The kit\'s scenic props (`flapify`, `ransom`, `vu`, `typeout`, `dealIn`, the `.ak-stamp` / '
    + '`.ak-ticker` / `.ak-torn` / `.ak-polaroid` family), the MATERIALS (one class per surface: '
    + '`.ak-mat--glass`, `--aurora`, `--grain`, `--ink`, `--signal`, `--ring`, `--spot`) and the '
    + 'MOTION RECIPES (`.ak-move--magnet`, `--sheen`, `--deal` as classes; `spotlight`, `tilt`, '
    + '`sheen`, `odometer`, `thumb`, `deal` as calls — every one answers the hand or a change and '
    + 'rests, none loops), the kit\'s own MOTION PRIMITIVES (`spring`, `stagger`, `inView`, '
    + '`scrollLink`, `drag` — Web Animations API, no dependency, finite, a no-op under reduced '
    + 'motion; reach for these before a library) and the pattern shelf below carry the shared '
    + 'stagecraft. When an app needs a full animation library, the node serves three as packs — '
    + 'Motion (`motion`), anime.js (`anime`) and Lenis (`lenis`) — read the pack\'s doc before '
    + 'writing a line, because every one of them changed its API after the version you know.\n\n';
  for (const g of genres) {
    body += '- `' + g.id + '` — **' + g.title + '**: ' + g.description + '\n';
  }
  body += '\n';
  body += 'THE TRAP THIS SECTION EXISTS TO STOP: a mosaic block stack wearing a look is a tool '
    + 'screen, never a statement — assembling components and applying a world reads as "the '
    + 'same dashboard in new paint" no matter which world. When a page must IMPRESS, start '
    + 'from the SUBJECT (whose page is this, what does it say), fork the genre that carries '
    + 'that register, and let the components serve the page — they mount in any element, so a '
    + 'free-composed page can still carry a live gauge or a map. If you cannot name what the '
    + 'page is about beyond "it shows the blocks", you are building a demo, and a demo never '
    + 'looks designed.\n\n';

  // THE PATTERN SHELF — rendered from the registry (atelier-patterns.ts), same data the
  // catalogue serves, so the choosing guidance can never drift from what patterns.css ships.
  body += '## The pattern shelf\n\n';
  body += 'Backgrounds with a personality, built entirely from the `--ak-*` tokens (technique '
    + 'after Temani Afif\'s CSS-Pattern, MIT) — so they follow every look, palette and mode, and '
    + 'the contrast matrix has proven text readable on them. Class is `.ak-pat-<id>` plus ONE '
    + 'volume: `.ak-pat--ground` (a whisper the whole page stands on), `.ak-pat--prop` (one '
    + 'object\'s texture), `.ak-pat--zone` (full ink — ONE banner or divider per screen, words '
    + 'only inside solid chips; `--zone-2`/`--zone-3` take the spectrum colours, `--zone-ink` '
    + 'goes monochrome). Tile size is `--ak-pat-size` on the element. Choose by what it says:\n\n';
  for (const p of PATTERNS) {
    const uses = [
      p.use.ground ? 'as a ground: ' + p.use.ground : '',
      p.use.prop ? 'as a prop: ' + p.use.prop : '',
      p.use.zone ? 'as a zone: ' + p.use.zone : '',
    ].filter(Boolean).join(' ');
    body += '- `' + p.id + '` — ' + p.looksLike + ' Evokes: ' + p.evokes + ' ' + uses + '\n';
  }
  body += '\n';

  body += '## The look\n\n';
  body += 'One field chooses the whole art direction: `app({ look: … })`. Vivid is the default '
    + 'and flat is a choice, never an accident. Ask the owner how it should feel and map the '
    + 'answer:\n\n';
  body += renderLooks() + '\n\n';
  body += 'NEVER write a colour, an animation, a theme control or a language switch: colours are '
    + 'the `--ak-*` tokens (every preset × palette × mode combination is verified arithmetically '
    + 'on this node), motion comes from the components, and the login pill owns the theme, '
    + 'palette and language controls.\n\n';

  body += '## Motion, and the moment something needs the eye\n\n';
  body += 'Entrances, live-change repaints and the hover greeting are the components\' own work: '
    + 'you never write an animation. The one motion call you DO make is the attention gesture, '
    + 'for the moment a thing on screen needs to be noticed: `AIMEAT.atelier.attention(el, '
    + '"pulse" | "shake" | "flash" | "rise")`. One finite gesture, no repeat, and reduced motion '
    + 'makes it a no-op (it returns false, so you can tell). USE IT FOR: a fresh row that '
    + 'arrived while the person was reading (pulse), a refused action (shake — the form '
    + 'component already shakes its own invalid fields, so this is for your own controls), the '
    + 'one control you want found after an explanation (flash), a saved or promoted item '
    + '(rise). NEVER use it as decoration, never on more than one element at a time, and never '
    + 'INSTEAD of words: a gesture is on top of the message, because a person who does not see '
    + 'motion must still be told. The pace and curve come from the look (`--ak-motion`, '
    + '`--ak-ease`), so the same call feels springy in one app and snappy in another. The SPRING '
    + 'is the look\'s too: each one carries its own stiffness, damping and mass in '
    + '`--ak-spring-*`, and the kit\'s primitives (`spring`, `drag`, `stagger({ spring: true })`) '
    + 'read them off the element they move, so you tune the look and never the call.\n\n';

  body += '## Imagery\n\n';
  body += 'Images are generated, uploaded and referenced — never inlined and never stock. The '
    + 'flow: compose the prompt as HOUSE STYLE + the look\'s imagery style (table above) + the '
    + 'palette\'s colour words (aimeat: ' + PALETTE_COLOR_WORDS.aimeat + '; the app follows the '
    + 'viewer\'s palette, so describe the DEFAULT one) + your subject → `aimeat_image_generate` '
    + '→ the returned storage URL goes in the spec. Slots and shapes: hero 7:3 with the focus in '
    + 'the middle, card 4:3, empty-state 1:1 with negative space.\n\n';
  body += 'THE COST RULE: generate at most ONE hero and ONE empty-state image without asking; '
    + 'everything beyond (per-card art, textures, regeneration) you ask the owner first, because '
    + 'generation spends their money. Before generating, check the cache: a memory record at '
    + '`atelier.img.<slot>.<look>.<subject-slug>` holding a previous URL means reuse it. A `data:` '
    + 'URI is refused by the components and by the publish gate. With zero images the app still '
    + 'looks finished — the fallbacks are designed — so imagery is polish, never a blocker.\n\n';

  body += 'Two agentness handles ride the kit too: `AIMEAT.atelier.delegate({ agent, task: { '
    + 'title, description } })` puts a "let AI handle it" button on any declared piece of work '
    + '(the agents library\'s spend guard asks the person first, and the outcome lands back in '
    + 'the same view), and `AIMEAT.atelier.agentActivity({ agent })` shows what the owner\'s '
    + 'agents have been doing as the kit\'s own timeline — ownership made visible. Both degrade '
    + 'with words when no agent is connected.\n\n';

  body += '## The signature: this app\'s own hand\n\n';
  body += 'A stored layout may carry a top-level `tokens` object: bounded overrides of colour, '
    + 'shape, typography, density and motion on top of the look (the catalogue\'s '
    + '`signature_tokens` lists every legal name). The one colour door is `--ak-accent` as a '
    + 'LIGHT/DARK PAIR "#hex/#hex" — the validator runs the full contrast matrix on each half '
    + 'against its own mode, so a pair that lands is proven readable everywhere, and a failing '
    + 'one refuses with the measured numbers and which direction to move. Every other colour '
    + '(text tint, gradient, spectrum, focus) derives from the accent on its own. This is how '
    + 'one app stops looking like every other app on the same look. THE DESIGN PASS, when the '
    + 'owner asks for a distinctive style: compose two or three candidate signatures as whole '
    + 'layouts (same blocks, different `tokens`), dry-run each with the validate endpoint, '
    + 'describe each in one sentence of plain words ("sharp corners, heavy masthead, deep green '
    + 'signature"), and store the one the owner picks. FROM A REFERENCE: when the owner shows a '
    + 'page or picture they like, read its shapes and its one leading colour — corner rounding, '
    + 'type weight, density, how much things move — and translate THOSE into the token '
    + 'vocabulary; a reference colour becomes a pair the matrix accepts, never a copied hex on '
    + 'trust.\n\n';

  body += '## The Design Book first\n\n';
  body += 'Before composing a screen from nothing, search the Design Book '
    + '(`aimeat_designbook_search`, or GET /v1/designbook): it holds PROVEN parts — every one '
    + 'passed its own bench before landing, and adopting one (`aimeat_designbook_adopt`) is one '
    + 'call. Five kinds: a `layout` (a complete arrangement) or `fill` (a starting shape with '
    + '<placeholder> slots) REPLACES the app\'s arrangement; a `look` (a signature token sheet, '
    + 'colour pair included), `motion` (a motion recipe) or `illustration` (art direction for '
    + 'the imagery) MERGES into the arrangement the app already has. A starting shape from the '
    + 'Book plus your words beats a fresh composition, and when you make something worth '
    + 'keeping, propose it back (`aimeat_designbook_propose`) so the next build starts where '
    + 'you finished.\n\n';

  body += '## AI inside the app\n\n';
  body += 'The `aide` block puts an AI panel on the screen whose tools are the app\'s OWN '
    + 'declarations: hand the mosaic spec your `sources` and an `actions` list ({ id, summary, '
    + 'params?, run }) and the aide can read what the screen reads and PROPOSE what the '
    + 'buttons do — a person confirms every run, the platform AI notice and provenance labels '
    + 'are built in, and it runs on the owner\'s own key (it sleeps politely when no key is '
    + 'set). A model answer may be a small mosaic panel rendered inline over the same sources — '
    + 'arrangement from the closed vocabulary, never markup. Two more affordances every mosaic '
    + 'carries: `m.explain()` renders "what this screen holds" from the declarations (never '
    + 'hand-write a help text that will drift), and `m.setOverlay({ hidden, order, nav })` '
    + 'applies THIS VIEWER\'S own arrangement over the owner\'s page — store it in the viewer\'s '
    + 'own memory (`atelier.overlay.<filename>`), never in the owner\'s layout.\n\n';

  body += '## Data, in short\n\n';
  body += 'Login and data come from `aimeat-auth` and `aimeat-data` exactly as on the rest of the '
    + 'platform: the shell hands you the session in `onReady`; private data is '
    + '`AIMEAT.data.set/get` with a `<app-name>.`-prefixed key; one key holds one record a user '
    + 'opens as a unit, never one key per field; read back after writing. Declare the scopes the '
    + 'app uses in `<meta name="aimeat-scopes">`.\n\n';

  body += '## Finishing\n\n';
  body += 'Before you call it done: open the app at 390×844, 1280×900 and 1280×460 in BOTH '
    + 'themes; `document.body.scrollWidth === document.documentElement.clientWidth` at every '
    + 'width; every state (loading, empty, error, signed-out) reached through `a.status(...)`; '
    + 'no console errors. Publish with `aimeat_app_publish` and pass `spec_token: '
    + SPEC_TOKEN_SLOT + '` — the digest of this document — so the node can tell the app was '
    + 'built against the spec in force.\n\n';

  body += '## What the review always catches\n\n';
  body += '- A form that switches into edit mode says so: retitle it and its primary action '
    + '("Edit entry" / "Save changes"), and the row being edited stays visibly selected. A form '
    + 'still headed "Log an entry" while it edits reads as adding a duplicate.\n'
    + '- Counters and the lists beside them read from the SAME data, computed in one place. A '
    + 'screen whose numbers disagree with its rows reads as broken even when both are defensible.\n'
    + '- Say a number ONCE. The same three counts as a stat row, as tab labels, as chips and again '
    + 'in a heading is the most common defect the review finds — pick the one place the number '
    + 'earns, and delete the echoes.\n'
    + '- The content people came for comes BEFORE the form that adds to it. In a journal, reading '
    + 'is the daily act; a full-height form above the entries buries the product under its input.\n'
    + '- Master-detail is ALWAYS listDetail, never a hand-rolled pick panel: the component carries '
    + 'the selection mark, the row-to-detail morph and the narrow-screen fold, and a hand-rolled '
    + 'panel loses all three.\n'
    + '- The shell\'s bar is the ONLY top bar. Building a second header of your own puts two bars '
    + 'and the account pill in a fight for the same edge.\n'
    + '- A filter applies WHEN IT CHANGES. A separate Show/Apply button beside a dropdown is a '
    + 'second step nobody expects of a filter.\n'
    + '- Give the shell a `tagline` (one line on what the app IS): the sign-in screen presents the '
    + 'app with it, so a first visitor learns what they are looking at before they log in.\n'
    + '- Storage internals never reach the person: "under keys that start with standup." is a '
    + 'sentence for a developer, not for a screen.\n\n';

  body += '## Never\n\n';
  body += '- daisyUI/Tailwind classes outside a `section` body — the kit is the vocabulary.\n'
    + '- Hand-written ARIA, focus management or animation code — the components carry them.\n'
    + '- A theme, palette or language control — the login pill owns all three.\n'
    + '- An invented script/style URL — everything the app loads is named in the shell.\n'
    + '- The Classic build spec — two tracks, two guides, no mixing.\n';

  return body;
}

/** Interview + language header around the body, for mode=new. */
function composeFull(config: AimeatConfig, body: string, opts: AtelierPromptOptions): string {
  const lang = (opts.lang || 'en').slice(0, 2);
  let full = '';
  if (lang !== 'en') {
    full += `Converse with the user in the language of tag "${lang}" (their choice); the app you `
      + 'build ships its own translations for its declared locales.\n\n';
  }
  if (opts.idea) full += `The app idea, in the owner's words: ${opts.idea}\n\n`;
  full += '## First, a short interview\n\n'
    + 'Ask, in one message, and wait for answers:\n'
    + '1. What should the app do, in one or two sentences?\n'
    + '2. Who uses it — just you, or others too (shared data)?\n'
    + '3. How should it look and FEEL? (Map the answer to a look from the table below.)\n'
    + '4. Which languages should it speak?\n'
    + '5. Anything it must NOT do?\n\n'
    + 'Then build on the Atelier track:\n\n';
  full += body;
  return full;
}

const tokenCache = new Map<string, string>();

/** The digest of the Atelier spec body — the publish gate's proof-of-fetch for this track. */
export function buildAtelierSpecToken(config: AimeatConfig): string {
  const known = tokenCache.get(config.baseUrl);
  if (known) return known;
  const body = composeBody(config);
  const token = 'atelier-' + createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 12);
  tokenCache.set(config.baseUrl, token);
  return token;
}

/** The Atelier build prompt, token substituted. */
export function buildAtelierPrompt(
  config: AimeatConfig, opts: AtelierPromptOptions = {},
): { full: string; body: string } {
  const token = buildAtelierSpecToken(config);
  const body = composeBody(config).replaceAll(SPEC_TOKEN_SLOT, token);
  const full = (opts.mode === 'improve' ? body : composeFull(config, composeBody(config), opts).replaceAll(SPEC_TOKEN_SLOT, token));
  return { full, body };
}
