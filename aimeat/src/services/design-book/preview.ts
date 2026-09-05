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
  if (part.kind === 'look' || part.kind === 'motion') {
    const body = part.body as { tokens?: Record<string, string>; look?: string };
    return { ...DEMO_LAYOUT_FOR_TOKENS, look: body.look ?? 'vivid', tokens: body.tokens ?? {} };
  }
  // An ambient benches and previews as the demo arrangement with the layer RUNNING behind it —
  // the mosaic mounts a stored layout's `ambient` — on the part's look, or the first look the
  // registry says the preset fits: dust on vivid would be invisible, and a preview is only
  // honest on the ground the part was proven on.
  if (part.kind === 'ambient') {
    const body = part.body as { ambient: string; alpha?: number; speed?: number; tokens?: Record<string, string>; look?: string };
    return {
      ...DEMO_LAYOUT_FOR_TOKENS,
      look: body.look ?? ambientById(body.ambient)?.fitsLooks[0] ?? 'vivid',
      tokens: body.tokens ?? {},
      ambient: {
        preset: body.ambient,
        ...(body.alpha !== undefined ? { alpha: body.alpha } : {}),
        ...(body.speed !== undefined ? { speed: body.speed } : {}),
      },
    };
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
    if (body.on === 'layer') {
      const lookAmbient = LOOKS.find((l) => l.id === look)?.tokens['--ak-ambient'];
      return {
        ...DEMO_LAYOUT_FOR_EFFECTS, look, tokens: body.tokens ?? {},
        ambient: { preset: lookAmbient && lookAmbient !== 'none' ? lookAmbient : 'plasma', post: [spec] },
      };
    }
    return {
      ...DEMO_LAYOUT_FOR_EFFECTS, look, tokens: body.tokens ?? {},
      blocks: DEMO_LAYOUT_FOR_EFFECTS.blocks.map((b) => (b.component === body.on ? { ...b, effect: spec } : b)),
      ...(entry?.motion.includes('moment')
        ? { __fxPlay: { selector: body.on === 'hero' ? '.ak-mosaic__band .ak-hero' : '[data-ak-block="fig"]', id: body.effect } }
        : {}),
    };
  }
  if (part.kind === 'illustration') return null;
  return part.body;
}

/** The bench page: the kit, the part, demo rows per component — the gallery preview, inlined. */
export function benchPageHtml(body: Record<string, unknown>): string {
  // A genre part IS its page — serve it as-is instead of wrapping the demo frame around it.
  if (typeof body.__page === 'string') return body.__page;
  const partJson = JSON.stringify(body).replace(/<\//g, '<\\/');
  return [
    '<!DOCTYPE html><html lang="en" data-theme="light"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    '<style>.ak-fx-play { position: fixed; right: 16px; bottom: 16px; z-index: 10; }</style></head><body>',
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
    "    { id: 'r1', name: 'First row', when: '2026-08-01' }, { id: 'r2', name: 'Second row', when: '2026-08-14' } ]; };",
    "  if (component === 'timeline') return function () { return [",
    "    { id: 't1', ts: '2026-08-27T10:00:00Z', title: 'Something happened', tone: 'ok' } ]; };",
    '  return function () { return [',
    "    { id: 'i1', title: 'A sample row', sub: 'What content looks like here.', badge: 'sample' },",
    "    { id: 'i2', title: 'Another row', sub: 'Titles and lines take this shape.' } ]; };",
    '}',
    'var sources = {};',
    '(BODY.blocks || []).forEach(function (b) {',
    '  var s = b.props && b.props.source;',
    '  if (s) sources[s] = demoFor(b.component);',
    '});',
    'var frame = document.createElement("div");',
    'frame.className = "ak-root";',
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
    '  play.type = "button"; play.className = "ak-btn ak-fx-play"; play.textContent = "Play";',
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
export function partPreviewHtml(part: DesignBookPart): string | null {
  if (part.kind === 'illustration') return illustrationPageHtml(part);
  const renderable = renderableBodyFor(part);
  if (renderable === null) return null;
  return benchPageHtml(renderable);
}
