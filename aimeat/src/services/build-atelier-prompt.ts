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
    + '  onPick: function (blockId, item) { open(item); },\n'
    + "  fallback: { v: 1, blocks: [\n"
    + "    { id: 'top', component: 'hero', props: { title: 'Errands' } },\n"
    + "    { id: 'main', component: 'list', props: { source: 'errands.' } },\n"
    + '  ] },\n'
    + '});\n'
    + "m.refresh('errands.');   // after your data changed — the change paints with motion\n"
    + '```\n\n'
    + 'The layout\'s `nav` field projects the same blocks as stacked sections, a tab row, a bottom '
    + 'bar, a swipeable deck, a step-by-step flow, a pan-zoom canvas, a desktop-grade left rail '
    + '(`rail`) or a full-screen menu in display type (`overlay`) — all of them work on every '
    + 'screen size, so never build navigation by hand. On the stacked grid, blocks below the fold '
    + 'reveal as the person scrolls; that too is the kit\'s, never yours to code.\n\n'
    + 'COMPOSE, do not pile: a block may carry `span` — `full` (default), `main` + `side` for the '
    + 'asymmetric editorial split, or `half` — and the screen becomes a laid-out page instead of a '
    + 'column of cards. Narrow screens fold every span to one column on their own.\n\n'
    + 'THE FIRST MOVE IS A PRESET, not a blank page: `GET ' + base + '/v1/apps/ui/catalogue` '
    + 'carries `layouts` — finished, fillable shapes (cover, dashboard, browse, work-queue, '
    + 'story-deck, guided-flow). Pick the one nearest the app, replace every <angle-bracketed> '
    + 'value with the app\'s own words and source names, and use it as the fallback — and as the '
    + 'first stored layout when the owner wants one.\n\n';

  body += '## The look\n\n';
  body += 'One field chooses the whole art direction: `app({ look: … })`. Vivid is the default '
    + 'and flat is a choice, never an accident. Ask the owner how it should feel and map the '
    + 'answer:\n\n';
  body += renderLooks() + '\n\n';
  body += 'NEVER write a colour, an animation, a theme control or a language switch: colours are '
    + 'the `--ak-*` tokens (every preset × palette × mode combination is verified arithmetically '
    + 'on this node), motion comes from the components, and the login pill owns the theme, '
    + 'palette and language controls.\n\n';

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
