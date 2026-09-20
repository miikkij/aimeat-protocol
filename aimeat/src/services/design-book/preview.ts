/**
 * @file src/services/design-book/preview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ONE RENDERING of a Design Book part as a real page — the bench and the gallery
 *   share it. The bench (bench.ts) has always built this page in memory and handed it to a
 *   headless browser; the gallery page a person browses needs the same render in an iframe. One
 *   builder serves both, so what the person sees IS what the bench measured, never a second
 *   implementation drifting from the first.
 *
 *   WHAT EACH KIND RENDERS AS. A layout or fill renders its own blocks through the same mosaic
 *   every app uses, with demo rows shaped per component. A look or motion sheet renders the demo
 *   arrangement WEARING it — a token sheet has nothing of its own to show. A genre IS a page:
 *   its template's own HTML, as-is. An illustration is art direction as words; its page sets the
 *   style sentence and the palette words in the kit's own type, because there is no image to
 *   show without running the imagery pipeline.
 * @structure DEMO_LAYOUT_FOR_TOKENS · DEMO_LAYOUT_FOR_EFFECTS · renderableBodyFor() ·
 *   benchPageHtml() · partPreviewHtml()
 * @usage
 *   const html = partPreviewHtml(part);   // a complete self-contained page, kit assets relative
 * @version-history
 *   v1.5.0 — 2026-09-20 — A part is shown on a stage that shows it (preview-stages.ts): a look on
 *     a page whose content fits its character, an ambient or a layer effect at full strength with
 *     nothing in front, a worn effect on its one block, a shape in a committed look. And THE
 *     FRAME PAINTS THE LOOK'S GROUND: a mosaic in a bare element painted none, so every preview
 *     was a look's cards on the browser's white. Any kit page takes the reader's theme.
 *   v1.4.1 — 2026-09-20 — partPreviewHtml takes the reader's theme for a component part.
 *   v1.4.0 — 2026-09-20 — A component previews as a page of its own (component.ts), scriptless.
 *   v1.3.1 — 2026-09-05 — Two blocks on ONE source get the plain rows both can render: the
 *     dashboard leiska binds its list and its table to the same name, and the table's own demo
 *     shape left the list drawing four empty rows.
 *   v1.3.0 — 2026-09-05 — The demo pantry carries `queue`, `steps`, `facets` and `cardGrid` (the
 *     leiskat compose with them now) and the row-shaped demos hold four to six rows instead of
 *     two: a list with two rows is not a list, a grid with two cards is not a grid, and a
 *     preview that shows one lies about the shape it is selling.
 *   v1.2.0 — 2026-09-05 — An effect part renders as the demo arrangement (with a figure after
 *     the hero) wearing the effect where it lands — the hero band, the figure, or a pass over
 *     the layer (the look's own ambient, plasma at its whisper when the look runs none) — and a
 *     moment gets a real Play control in the frame (wish-atelier-post-process-effects, stage 5).
 *   v1.1.0 — 2026-09-05 — An ambient part renders as the demo arrangement with the layer running
 *     behind it, on the part's look or the first look the registry says the preset fits — a
 *     preview is only honest on the ground the part was proven on, and dust on vivid would be
 *     invisible (wish-atelier-ambient-visuals).
 *   v1.0.0 — 2026-08-30 — Extracted whole from bench.ts (pure move: DEMO_LAYOUT_FOR_TOKENS,
 *     renderableBodyFor, benchPageHtml) and grown by the illustration page and partPreviewHtml,
 *     for the browsable Design Book gallery (wish-designbook-graafinen-selailu).
 */
import { getAppTemplates } from '../../data/app-templates.js';
import { ambientById } from '../../data/atelier-ambients.js';
import { effectById } from '../../data/atelier-effects.js';
import { LOOKS } from '../../data/atelier-looks.js';
import type { DesignBookPart } from './service.js';
import { componentPreviewHtml, type ComponentBody } from './component.js';
import { lookStage, layerStage, wornStage, lookForShape } from './preview-stages.js';

/** A representative arrangement for parts that are seasoning rather than a dish: a look or
 *  motion sheet is benched by rendering THIS demo layout wearing it, so an override that breaks
 *  the render (an enormous display size, a wild tilt) is caught in a real browser, not shipped. */
export const DEMO_LAYOUT_FOR_TOKENS = {
  v: 1,
  blocks: [
    { id: 'top', component: 'hero', props: { title: 'Bench', sub: 'The demo arrangement this sheet is proven on.' } },
    { id: 'kpis', component: 'statRow', props: { source: 'demo.stats', title: 'Numbers' } },
    { id: 'rows', component: 'list', props: { source: 'demo.rows', title: 'Rows' } },
    { id: 'grid', component: 'cardGrid', props: { source: 'demo.cards', title: 'Cards' } },
    { id: 'hist', component: 'timeline', props: { source: 'demo.events', title: 'History' } },
  ],
};

/** The demo arrangement an EFFECT part is proven on: the same blocks with one figure after the
 *  hero, because a picture effect needs a picture and one numeral is the kit's smallest. */
export const DEMO_LAYOUT_FOR_EFFECTS = {
  v: 1,
  blocks: [
    DEMO_LAYOUT_FOR_TOKENS.blocks[0]!,
    { id: 'fig', component: 'figure', props: { source: 'demo.figure', title: 'Figure' } },
    ...DEMO_LAYOUT_FOR_TOKENS.blocks.slice(1),
  ],
};

/** What the browser renders for one part: the body itself for an arrangement, the demo
 *  arrangement wearing the sheet for a look/motion part, nothing for an illustration. */
export function renderableBodyFor(part: DesignBookPart): Record<string, unknown> | null {
  // A genre benches AS THE PAGE IT IS: the template's own HTML, measured at three viewports.
  if (part.kind === 'genre') {
    const id = (part.body as { template?: string }).template || '';
    const t = getAppTemplates().find((x) => x.id === id);
    return t ? { __page: t.content } : null;
  }
  // A component is a page of its own too: its markup on the page ground and on a surface, under
  // the kit's tokens, with NO script (component.ts says why).
  if (part.kind === 'component') {
    return { __page: componentPreviewHtml(part.body as unknown as ComponentBody) };
  }
  // A LOOK (or a motion recipe) is worn by a page whose content fits its character, chosen from
  // the part's own words (preview-stages.ts), and no longer by one arrangement called "Bench".
  if (part.kind === 'look' || part.kind === 'motion') {
    const body = part.body as { tokens?: Record<string, string>; look?: string };
    return lookStage(`${part.id} ${part.title} ${body.look ?? ''}`, body.tokens ?? {}, body.look);
  }
  // A SHAPE THAT NAMES NO LOOK wears a committed one, so a shelf of shapes is not one white page.
  if ((part.kind === 'layout' || part.kind === 'fill') && !(part.body as { look?: string }).look) {
    return { ...part.body, look: lookForShape(part.id) };
  }
  // An ambient benches and previews as the demo arrangement with the layer RUNNING behind it —
  // the mosaic mounts a stored layout's `ambient` — on the part's look, or the first look the
  // registry says the preset fits: dust on vivid would be invisible, and a preview is only
  // honest on the ground the part was proven on.
  if (part.kind === 'ambient') {
    const body = part.body as { ambient: string; alpha?: number; speed?: number; tokens?: Record<string, string>; look?: string };
    const preset = ambientById(body.ambient);
    // THE LAYER IS THE PART, so it is shown with one title over it and nothing in front, at the
    // strength the shelf proves it at (shelfAlpha) when the part names none. It stood behind five
    // blocks of cards at a whisper, and nobody could see it.
    return layerStage(part.title, firstSentence(part.summary), body.look ?? preset?.fitsLooks[0] ?? 'vivid', body.tokens ?? {}, {
      preset: body.ambient,
      alpha: body.alpha ?? preset?.shelfAlpha,
      ...(body.speed !== undefined ? { speed: body.speed } : {}),
    });
  }
  // An effect renders as the demo arrangement wearing it where it lands: on the hero band, on
  // the figure, or as a pass over the layer (the look's own ambient, or plasma at its whisper
  // when the look runs none), on the part's look or the first the registry says it fits. A
  // moment gets a real Play control in the frame, so the gallery can press it.
  if (part.kind === 'effect') {
    const body = part.body as {
      effect: string; params?: Record<string, unknown>; on: 'hero' | 'figure' | 'layer';
      tokens?: Record<string, string>; look?: string;
    };
    const entry = effectById(body.effect);
    const look = body.look ?? entry?.fitsLooks[0] ?? 'vivid';
    const spec = { id: body.effect, ...(body.params ? { params: body.params } : {}) };
    const sub = firstSentence(part.summary);
    if (body.on === 'layer') {
      // A PASS OVER THE LAYER is shown on the layer alone, loud: the look's own ambient at the
      // look's own strength, or plasma at its shelf strength when the look runs none.
      const lookTokens = LOOKS.find((l) => l.id === look)?.tokens;
      const lookAmbient = lookTokens?.['--ak-ambient'];
      const own = lookAmbient && lookAmbient !== 'none';
      const preset = own ? lookAmbient : 'plasma';
      // THE STRENGTH IS SAID, never left to the preset's default: an arrangement's ambient that
      // names no alpha runs at the preset's whisper, whatever the look's own token says, and the
      // kaleidoscope stood at a few per cent on a night built to carry it at 0.8.
      const lookAlpha = Number(lookTokens?.['--ak-ambient-alpha']);
      const alpha = own && Number.isFinite(lookAlpha) && lookAlpha > 0 ? lookAlpha : ambientById(preset)?.shelfAlpha;
      return layerStage(part.title, sub, look, body.tokens ?? {}, { preset, ...(alpha !== undefined ? { alpha } : {}), post: [spec] });
    }
    return {
      ...wornStage(body.on, part.title, sub, look, body.tokens ?? {}, spec),
      ...(entry?.motion.includes('moment')
        ? { __fxPlay: { selector: body.on === 'hero' ? '.ak-mosaic__band .ak-hero' : '[data-ak-block="fig"]', id: body.effect } }
        : {}),
    };
  }
  if (part.kind === 'illustration') return null;
  return part.body;
}

/** A part's summary down to what fits under a title: its first sentence, or the first 140 characters. */
function firstSentence(text: string): string {
  const cut = /^[^.!?]{12,140}[.!?]/.exec(text.trim())?.[0];
  return cut ?? text.trim().slice(0, 140);
}

/**
 * THE FRAME PAINTS THE LOOK'S GROUND. In an app the kit's frame (`.ak-app`) paints `--ak-bg`, the
 * page image and the grain; a mosaic mounted into a bare element paints none of them. Every
 * preview was therefore a look's cards on the browser's white, which is why a night look showed
 * navy tiles on a white page and why every look read as the same page (found 2026-09-20). The
 * frame is a stacking context, so a layer at z-index -1 paints above this ground and under the
 * blocks; on a layer stage the arrangement fills the height, because the layer IS the picture.
 */
const FRAME_CSS = [
  'html, body { margin: 0; min-height: 100%; }',
  'body { background: var(--ak-bg); }',
  '.dbp-frame { min-height: 100vh; position: relative; isolation: isolate;',
  '  background-color: var(--ak-bg); background-image: var(--ak-page-grain, none), var(--ak-page-image, none); background-size: cover; }',
  // THE GUTTER GOES UNDER THE BAND, NEVER AROUND THE FRAME. A look with a full-bleed band sizes it
  // at 100vw and the mosaic clips what pokes past its own box, so a padded frame cut 40 px off the
  // poster's headline (the bench counted it as clipped content, 2026-09-20).
  '.dbp-frame .ak-mosaic__units { padding: 0 clamp(12px, 3vw, 32px) 32px; }',
  '.dbp-frame--layer > * { min-height: 100vh; }',
  // The one block wearing an effect is the picture: the band takes most of the first screen.
  '.dbp-frame--worn .ak-hero { min-height: min(62vh, 560px); }',
  // The control that plays a moment sits where a thumb and an eye both find it.
  '.ak-fx-play { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 10; min-height: 48px; padding-inline: 28px; }',
].join('\n');

/** The bench page: the kit, the part, demo rows per component — the gallery preview, inlined. */
export function benchPageHtml(body: Record<string, unknown>, theme: 'light' | 'dark' = 'light'): string {
  // A genre part IS its page — serve it as-is instead of wrapping the demo frame around it.
  if (typeof body.__page === 'string') return body.__page;
  const partJson = JSON.stringify(body).replace(/<\//g, '<\\/');
  return [
    `<!DOCTYPE html><html lang="en" data-theme="${theme === 'dark' ? 'dark' : 'light'}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    `<style>${FRAME_CSS}</style></head><body>`,
    '<script src="/v1/libs/aimeat-atelier.js"></scr' + 'ipt>',
    '<script>',
    'var BODY = ' + partJson + ';',
    'function demoFor(component) {',
    "  if (component === 'statRow') return function () { return [",
    "    { id: 'a', label: 'This week', value: 12 }, { id: 'b', label: 'Open', value: 4 }, { id: 'c', label: 'Done', value: 8 } ]; };",
    "  if (component === 'figure') return function () { return { value: 128, label: 'Sample figure', sub: 'A featured number.' }; };",
    "  if (component === 'chart') return function () { return { labels: ['Jan', 'Feb', 'Mar', 'Apr'], series: [",
    "    { id: 'in', label: 'Income', kind: 'bar', values: [1200, 1400, 1100, 1600] },",
    "    { id: 'out', label: 'Costs', kind: 'bar', values: [900, 1000, 1250, 800] },",
    "    { id: 'cash', label: 'Cash', kind: 'line', values: [300, 700, 550, 1350] } ] }; };",
    "  if (component === 'matrix') return function () { return {",
    "    cols: [{ id: 'us', label: 'Us' }, { id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],",
    "    rows: [",
    "      { id: 'r1', label: 'Search', tone: 'ok', badge: 'ahead', cells: [{ col: 'us', tone: 'ok', label: 'live' }, { col: 'a', tone: 'warn', label: 'beta' }, { col: 'b', tone: 'plain' }] },",
    "      { id: 'r2', label: 'Exports', tone: 'warn', badge: 'parity', cells: [{ col: 'us', tone: 'ok' }, { col: 'a', tone: 'ok' }, { col: 'b', tone: 'ok' }] } ] }; };",
    "  if (component === 'graph') return function () { return {",
    "    nodes: [{ id: 'a', label: 'Idea', tone: 'accent' }, { id: 'b', label: 'Risk', tone: 'err' }, { id: 'c', label: 'Decision', tone: 'ok' }],",
    "    edges: [{ from: 'a', to: 'b', label: 'raises' }, { from: 'b', to: 'c', label: 'settled by' }] }; };",
    "  if (component === 'waveform') return function () { return {",
    "    values: [0.1, 0.3, 0.7, 1.0, 0.6, 0.8, 0.4, 0.9, 0.5, 0.2, 0.6, 0.3] }; };",
    "  if (component === 'reveal') return function () { return [",
    "    { id: 'r1', title: 'A question people actually ask', sub: 'The short answer', text: 'And the answer, in the words you would use out loud.' },",
    "    { id: 'r2', title: 'A second one', sub: 'Also short', text: 'Folded until someone wants it.' } ]; };",
    "  if (component === 'table') return function () { return [",
    "    { id: 'r1', name: 'First row', when: '2026-08-01' }, { id: 'r2', name: 'Second row', when: '2026-08-14' },",
    "    { id: 'r3', name: 'Third row', when: '2026-08-21' }, { id: 'r4', name: 'Fourth row', when: '2026-08-28' } ]; };",
    "  if (component === 'timeline') return function () { return [",
    "    { id: 't1', ts: '2026-08-27T10:00:00Z', title: 'Something happened', tone: 'ok' },",
    "    { id: 't2', ts: '2026-08-26T16:30:00Z', title: 'And before it, something else', sub: 'With the line that says more.' },",
    "    { id: 't3', ts: '2026-08-25T09:15:00Z', title: 'Where the history starts', tone: 'warn' } ]; };",
    "  if (component === 'queue') return function () { return [",
    "    { id: 'q1', title: 'The piece under way', state: 'running', sub: 'Halfway through.' },",
    "    { id: 'q2', title: 'Next in line', state: 'waiting' },",
    "    { id: 'q3', title: 'Finished earlier', state: 'done', sub: 'Out at 07:10.' },",
    "    { id: 'q4', title: 'The one that failed', state: 'failed', sub: 'Worth another run.' } ]; };",
    "  if (component === 'steps') return function () { return { current: 1, steps: [",
    "    { label: 'Where this starts', sub: 'Done' }, { label: 'The choosing step', sub: 'Under way' },",
    "    { label: 'The finish line', sub: 'Ahead' } ] }; };",
    "  if (component === 'facets') return function () { return { facets: [",
    "    { id: 'kind', label: 'Kind', multi: true, options: [",
    "      { id: 'a', label: 'The first kind', count: 12 }, { id: 'b', label: 'The second', count: 7 },",
    "      { id: 'c', label: 'The third', count: 3 } ] },",
    "    { id: 'when', label: 'When', options: [",
    "      { id: 'now', label: 'This week', count: 5 }, { id: 'all', label: 'Any time', count: 22 } ] } ] }; };",
    "  if (component === 'cardGrid') return function () { return [",
    // Six DIFFERENT initials on purpose: an imageless card wears the first letter as its
    // monogram, and six cards reading "T" would be a picture of the demo rather than the block.
    "    { id: 'c1', title: 'First card', sub: 'What a card carries.' },",
    "    { id: 'c2', title: 'Another one', sub: 'Titles and lines take this shape.' },",
    "    { id: 'c3', title: 'Room to breathe', sub: 'An imageless card keeps its own wash.' },",
    "    { id: 'c4', title: 'Something else', sub: 'A grid is a shape only once it has a grid.' },",
    "    { id: 'c5', title: 'Browsing, this is it', sub: 'Five across on a wide screen.' },",
    "    { id: 'c6', title: 'Where the screen ends', sub: 'And the scroll takes over.' } ]; };",
    '  return function () { return [',
    "    { id: 'i1', title: 'A sample row', sub: 'What content looks like here.', badge: 'sample' },",
    "    { id: 'i2', title: 'Another row', sub: 'Titles and lines take this shape.' },",
    "    { id: 'i3', title: 'A third one', sub: 'A list is a shape only once it has rows.' },",
    "    { id: 'i4', title: 'And a fourth', sub: 'This is what the block looks like in use.' },",
    "    { id: 'i5', title: 'A fifth', sub: 'Enough rows to read as a list rather than a sample.' } ]; };",
    '}',
    // ONE SOURCE, ONE RECORD SHAPE. Two blocks may bind the same source — a list and a table
    // over the same rows is the ordinary case — and then the demo has to suit both, so a shared
    // name falls back to the plain rows every row-shaped component renders. Handing it the last
    // block's shape instead left the dashboard's list drawing four empty rows.
    'var sources = {};',
    'var owners = {};',
    '(BODY.blocks || []).forEach(function (b) {',
    '  var s = b.props && b.props.source;',
    '  if (!s) return;',
    // A STAGE BRINGS ITS OWN ROWS (preview-stages.ts): a look is shown on content that fits it.
    '  if (BODY.__sources && BODY.__sources[s] !== undefined) { sources[s] = (function (v) { return function () { return v; }; })(BODY.__sources[s]); return; }',
    '  if (owners[s] && owners[s] !== b.component) { sources[s] = demoFor(""); return; }',
    '  owners[s] = b.component;',
    '  sources[s] = demoFor(b.component);',
    '});',
    'var frame = document.createElement("div");',
    'frame.className = "ak-root dbp-frame" + (BODY.__stage ? " dbp-frame--" + BODY.__stage : "");',
    'frame.setAttribute("data-ak-look", BODY.look || "vivid");',
    'document.body.appendChild(frame);',
    // A DIALOG SHAPE is benched as what it is: opened as a real modal, so the guarantees are
    // measured on the surface a person will actually see, not on a flattened copy of it.
    'if (BODY.dialog) {',
    '  AIMEAT.atelier.dialog(Object.assign({ title: BODY.dialog.title || "Dialog" }, BODY.dialog,',
    '    { layout: BODY, sources: sources }));',
    '} else {',
    '  AIMEAT.atelier.mosaic({ target: frame, layout: BODY, sources: sources });',
    '}',
    // A MOMENT effect gets a real control in the frame: the person presses it in the gallery
    // and the effect the mosaic mounted plays once; the bench measures the page at rest.
    'if (BODY.__fxPlay) {',
    '  var play = document.createElement("button");',
    '  play.type = "button"; play.className = "ak-btn ak-btn--primary ak-fx-play"; play.textContent = "Play the effect";',
    '  play.setAttribute("data-ak-fx-play", BODY.__fxPlay.id);',
    '  play.addEventListener("click", function () {',
    '    var t = document.querySelector(BODY.__fxPlay.selector);',
    '    if (t) AIMEAT.atelier.fxPlay(t, BODY.__fxPlay.id);',
    '  });',
    '  document.body.appendChild(play);',
    '}',
    '</scr' + 'ipt></body></html>',
  ].join('\n');
}

/** No character from an illustration's words may close an attribute or open a tag; the propose
 *  bench already refuses declaration characters, and this escape stands even if that changes. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** An illustration is art direction as words — there is no image to show without running the
 *  imagery pipeline, so its page sets the words themselves in the kit's own type. */
function illustrationPageHtml(part: DesignBookPart): string {
  const body = part.body as { style?: string; palette_words?: string };
  const words = (body.palette_words ?? '').split(',').map((w) => w.trim()).filter(Boolean);
  return [
    '<!DOCTYPE html><html lang="en" data-theme="light"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    '<style>',
    'body { margin: 0; background: var(--ak-bg, #FAFAF8); color: var(--ak-ink, #1A1A2E);',
    '  font-family: var(--ak-font-body, system-ui, sans-serif); }',
    '.illus { max-width: 640px; margin: 0 auto; padding: 48px 24px; }',
    '.illus-label { font-family: var(--ak-font-mono, monospace); font-size: .72rem;',
    '  letter-spacing: .1em; text-transform: uppercase; color: var(--ak-accent, #E8564A); }',
    '.illus-style { font-size: 1.4rem; line-height: 1.5; margin: 12px 0 32px; }',
    '.illus-words { display: flex; flex-wrap: wrap; gap: 10px; }',
    '.illus-word { border: 2px solid currentColor; padding: 6px 12px;',
    '  font-family: var(--ak-font-mono, monospace); font-size: .8rem; }',
    '</style></head><body><div class="illus">',
    '<span class="illus-label">Art direction</span>',
    `<p class="illus-style">${esc(body.style ?? '')}</p>`,
    words.length ? '<span class="illus-label">Palette words</span>' : '',
    words.length
      ? `<div class="illus-words" style="margin-top:12px">${words.map((w) => `<span class="illus-word">${esc(w)}</span>`).join('')}</div>`
      : '',
    '</div></body></html>',
  ].join('\n');
}

/**
 * The complete preview page for ONE part, whatever its kind — self-contained, kit assets on
 * relative paths, so it renders wherever the node's own origin serves it (the bench's headless
 * browser, the gallery's iframe). Null only for a genre whose template id no longer exists.
 */
export function partPreviewHtml(part: DesignBookPart, opts: { theme?: 'light' | 'dark' } = {}): string | null {
  if (part.kind === 'illustration') return illustrationPageHtml(part);
  // A component wears the page it lands in, so its preview is asked for in the reader's theme.
  // The bench keeps measuring the light page (renderableBodyFor), which is what its stamp says.
  if (part.kind === 'component' && opts.theme) return componentPreviewHtml(part.body as unknown as ComponentBody, opts.theme);
  const renderable = renderableBodyFor(part);
  if (renderable === null) return null;
  // Every kit page may be asked for in the reader's theme; the bench measures the light one.
  // A stage whose character is a lit thing in the dark says so (`__theme`), and the reader's own
  // choice always wins over it.
  return benchPageHtml(renderable, opts.theme ?? (renderable.__theme === 'dark' ? 'dark' : 'light'));
}
