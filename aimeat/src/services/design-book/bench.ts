/**
 * @file src/services/design-book/bench.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The GUARANTEE BENCH, automated (TARGET-074): a Design Book part rendered in a real
 *   headless browser at three viewports, with the guarantees MEASURED — horizontal overflow zero,
 *   something actually painted, every control at the touch minimum — and the numbers stored on
 *   the part's bench field. "Ajetaan, ei luvata": what the propose-time validator proves about
 *   the DATA, this proves about the RENDER.
 *
 *   NO NEW ROUTE SERVES THE PAGE. The bench builds a self-contained HTML page in memory (the kit
 *   from this node's own /v1/libs and /lib URLs, the part's body rendered by the same mosaic
 *   every app uses, demo rows shaped per component exactly like the gallery's preview) and hands
 *   it to the browser by fulfilling the document request — the screenshot capturer's own trick,
 *   through the same shared renderer (one headless-browser story on the node, not two).
 *
 *   A NODE WITH NO BROWSER ANSWERS WITH WORDS. withHeadlessContext returns null where no
 *   Chromium/Edge/Chrome exists; the bench then reports ran:false with the reason, and the part's
 *   record is left untouched — an unavailable bench is not a passed bench.
 * @structure BENCH_VIEWPORTS · runPartBench(storage, config, id) → DesignBookBenchResult
 * @usage
 *   const result = await runPartBench(storage, config, 'leiska-cover');
 * @version-history
 *   v1.2.0 — 2026-08-28 — Three production lessons in one: the page loads from the node's own
 *     LOOPBACK (a server often cannot reach its own public hostname from inside, and the first
 *     prod run proved it), readiness is domcontentloaded + settle (a slow remote hero image must
 *     never time the bench out), and a render-time failure answers ran:false WITH THE REAL
 *     REASON instead of a 500 — a crash is not a contract answer.
 *   v1.1.0 — 2026-08-28 — The new kinds meet the browser: a look or motion part is benched by
 *     rendering the DEMO arrangement wearing its token sheet (an override that breaks the render
 *     is caught here, not shipped), and an illustration answers ran:false with the reason — its
 *     bench is the field validation at propose time.
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074, the guarantee bench automated).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { systemGhiiFor } from '../compliance-register.js';
import { withHeadlessContext } from '../screenshot-capture.js';
import { DesignBookService, partKey, type DesignBookPart } from './service.js';
import { DesignBookError } from './validate.js';

export const BENCH_VIEWPORTS = [
  { id: '390x844', width: 390, height: 844 },
  { id: '1280x900', width: 1280, height: 900 },
  { id: '1280x460', width: 1280, height: 460 },
] as const;

const PAGE_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_200;

export interface BenchViewportResult {
  viewport: string;
  overflow_px: number;
  units_rendered: number;
  controls_below_touch_min: number;
}

export interface DesignBookBenchResult {
  ran: boolean;
  reason?: string;
  passed?: boolean;
  viewports?: BenchViewportResult[];
  at: string;
}

/** The slice of the Playwright page surface the bench drives; playwright-core stays lazy. */
interface BenchPage {
  goto(u: string, o: unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  route(m: string, h: (r: { request(): { resourceType(): string }; fulfill(o: unknown): void; continue(): void }) => void): Promise<void>;
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
}

/** A representative arrangement for parts that are seasoning rather than a dish: a look or
 *  motion sheet is benched by rendering THIS demo layout wearing it, so an override that breaks
 *  the render (an enormous display size, a wild tilt) is caught in a real browser, not shipped. */
const DEMO_LAYOUT_FOR_TOKENS = {
  v: 1,
  blocks: [
    { id: 'top', component: 'hero', props: { title: 'Bench', sub: 'The demo arrangement this sheet is proven on.' } },
    { id: 'kpis', component: 'statRow', props: { source: 'demo.stats', title: 'Numbers' } },
    { id: 'rows', component: 'list', props: { source: 'demo.rows', title: 'Rows' } },
    { id: 'grid', component: 'cardGrid', props: { source: 'demo.cards', title: 'Cards' } },
    { id: 'hist', component: 'timeline', props: { source: 'demo.events', title: 'History' } },
  ],
};

/** What the browser renders for one part: the body itself for an arrangement, the demo
 *  arrangement wearing the sheet for a look/motion part, nothing for an illustration. */
function renderableBodyFor(part: DesignBookPart): Record<string, unknown> | null {
  if (part.kind === 'look' || part.kind === 'motion') {
    const body = part.body as { tokens?: Record<string, string>; look?: string };
    return { ...DEMO_LAYOUT_FOR_TOKENS, look: body.look ?? 'vivid', tokens: body.tokens ?? {} };
  }
  if (part.kind === 'illustration') return null;
  return part.body;
}

/** The bench page: the kit, the part, demo rows per component — the gallery preview, inlined. */
function benchPageHtml(body: Record<string, unknown>): string {
  const partJson = JSON.stringify(body).replace(/<\//g, '<\\/');
  return [
    '<!DOCTYPE html><html lang="en" data-theme="light"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css"></head><body>',
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
    'AIMEAT.atelier.mosaic({ target: frame, layout: BODY, sources: sources });',
    '</scr' + 'ipt></body></html>',
  ].join('\n');
}

/** The in-page measurements, one string so the lazy page surface needs no function serializer. */
const MEASURE_JS = `(() => {
  const doc = document.documentElement;
  const overflow = doc.scrollWidth - doc.clientWidth;
  const units = document.querySelectorAll('.ak-mosaic__unit, .ak-mosaic__band > *').length;
  let smallControls = 0;
  for (const el of document.querySelectorAll('button, [role="button"], a, input, select')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;    // not rendered (hidden projection state)
    if (r.height < 24 || r.width < 24) smallControls++;
  }
  return { overflow, units, smallControls };
})()`;

/**
 * Render one part at the three bench viewports and measure the guarantees. Reads the part through
 * the service (a part that does not exist refuses there); writes NOTHING here — the caller
 * decides whether and where the result lands.
 */
export async function runPartBench(
  storage: Storage, config: AimeatConfig, id: string,
): Promise<DesignBookBenchResult> {
  const book = new DesignBookService(storage, config);
  const { part } = await book.get(id);
  const renderable = renderableBodyFor(part);
  if (renderable === null) {
    return {
      ran: false,
      reason: 'An illustration style has nothing of its own to render — it is proven by its field bench at propose time.',
      at: new Date().toISOString(),
    };
  }
  const html = benchPageHtml(renderable);
  // The page's kit assets are RELATIVE, and they resolve against this address — so it points at
  // the node's own loopback, not its public URL: a server often cannot reach its own public
  // hostname from inside (hairpin NAT), and the bench must not depend on that.
  const url = `http://127.0.0.1:${config.port}/v1/designbook/${encodeURIComponent(id)}/bench-page`;
  const at = new Date().toISOString();

  const viewports: BenchViewportResult[] = [];
  for (const vp of BENCH_VIEWPORTS) {
    // A render-time failure (the page never loads, the browser dies mid-run) is part of the
    // CONTRACT, not an exception: the bench answers ran:false WITH THE REAL REASON, because a
    // 500 tells the operator nothing and an unavailable bench is never a passed bench.
    let measured: { overflow: number; units: number; smallControls: number } | null;
    try {
      measured = await withHeadlessContext({ width: vp.width, height: vp.height }, async (ctx) => {
        const page = await ctx.newPage() as BenchPage;
        try {
          let fulfilled = false;
          await page.route('**/*', (route) => {
            if (!fulfilled && route.request().resourceType() === 'document') {
              fulfilled = true;
              route.fulfill({ status: 200, contentType: 'text/html', body: html });
            } else {
              route.continue();
            }
          });
          // domcontentloaded, not load: a slow or unreachable IMAGE (a hero photo on another
          // host) must never time the whole bench out — layout is measured after the settle.
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
          await page.waitForTimeout(SETTLE_MS);
          return await page.evaluate<{ overflow: number; units: number; smallControls: number }>(MEASURE_JS);
        } finally {
          await page.close();
        }
      });
    } catch (err) {
      return {
        ran: false,
        reason: `The browser launched but the render failed at ${vp.id}: ${(err as Error)?.message ?? 'unknown error'}. `
          + 'A page-load timeout here usually means this node cannot reach its own public URL from inside — the kit assets never arrive.',
        at,
      };
    }
    if (measured === null) {
      return { ran: false, reason: 'No headless browser on this node — install one with `npx playwright install --with-deps chromium`, or run the bench on a node that has Edge or Chrome.', at };
    }
    viewports.push({
      viewport: vp.id,
      overflow_px: measured.overflow,
      units_rendered: measured.units,
      controls_below_touch_min: measured.smallControls,
    });
  }

  const passed = viewports.every((v) => v.overflow_px === 0 && v.units_rendered > 0 && v.controls_below_touch_min === 0);
  return { ran: true, passed, viewports, at };
}

/**
 * Run the bench and STAMP the result onto the part's record — the operator's and the proposer's
 * call, decided by the caller through the same rule setStatus uses. The stamp keeps the
 * propose-time checks and appends the browser result beside them.
 */
export async function benchAndStamp(
  storage: Storage, config: AimeatConfig, id: string,
): Promise<DesignBookBenchResult> {
  const result = await runPartBench(storage, config, id);
  if (!result.ran) return result;

  const system = systemGhiiFor(config.nodeId);
  const record = await storage.getMemory(system, partKey(id));
  if (!record) throw new DesignBookError('NOT_FOUND', `No Design Book part "${id}".`, 404);
  const part = JSON.parse(typeof record.value === 'string' ? record.value : JSON.stringify(record.value)) as DesignBookPart;
  const now = new Date().toISOString();
  const next: DesignBookPart = {
    ...part,
    updated_at: now,
    bench: {
      ...part.bench,
      checks: Array.from(new Set([...(part.bench?.checks ?? []), 'browser-render'])),
      passed_at: result.passed ? now : part.bench?.passed_at ?? now,
      browser: result,
    },
  };
  await storage.setMemory({
    key: record.key,
    ownerGaii: system,
    value: JSON.stringify(next),
    visibility: 'public',
    tags: record.tags ?? ['designbook'],
    ttlHours: null,
    version: record.version + 1,
    createdAt: record.createdAt,
    updatedAt: now,
    trackable: true,
  });
  return result;
}
