/**
 * @file screenshot-capture.ts
 * @description Node-internal auto-screenshot job. On an interval it finds published apps that have
 *   no screenshot, renders each one headless (playwright-core, lazily imported, driving the machine's
 *   own Edge/Chrome via a channel — no browser download), and stores a JPEG thumbnail DIRECTLY in
 *   storage. No HTTP, no token, no operator action: it self-authenticates by virtue of running
 *   inside the node. Disables itself gracefully (one log line, no crash) if no browser is available.
 *   Opt-in via config.screenshotAutoCapture so nodes without a browser never try.
 *
 *   It also serves ONE app on demand (captureAppScreenshot), which is a different job wearing the
 *   same machinery. The batch exists so a catalogue is not full of blank cards; the on-demand call
 *   exists because an agent that has just published an app cannot otherwise see what it made. A
 *   hosted agent has no browser and no shell, so without this it ships blind and says "done" on the
 *   strength of a 200.
 * @structure startScreenshotAutoCapture() entry; launchBrowser() channel fallback;
 *   runScreenshotCapturePass() one batch scan; captureAppScreenshot() one app, with its own
 *   per-owner throttle; renderAndStore() the shared render both paths use.
 * @version-history
 *   v1.3.0 — 2026-08-16 — captureAppScreenshot(): one named app, on demand, answering with a reason
 *     instead of a number. The render moved into renderAndStore() so the batch and the request run
 *     the same code. The module-level `running` flag stays a BATCH guard only — it used to make any
 *     second caller return 0 silently, which is the wrong answer to give someone who asked a
 *     question. Rendering is expensive and unauthenticated rendering is a denial-of-service shape,
 *     so the on-demand path carries a per-owner throttle of its own.
 *   v1.0.0 — 2026-06-20 — initial: interval backfill writing straight to storage; channel-fallback
 *     browser via lazy playwright-core; graceful self-disable when no browser is present.
 *   v1.1.0 — 2026-06-20 — render the app's STORED HTML directly (fulfill the main document) instead of
 *     navigating to the inline URL, which 301s to the app origin under H-2 and 404s on a node with no
 *     app host (local dev) → captured error pages. Export runScreenshotCapturePass for manual/one-shot.
 *   v1.2.0 — 2026-06-20 — configurable post-load settle wait (AIMEAT_SCREENSHOT_SETTLE_MS, default 6s)
 *     so apps that fetch/render after load aren't captured blank; surface the real launch error on disable.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';

const VIEWPORT = { width: 1200, height: 750 };
const PAGE_TIMEOUT = 20_000;
const FIRST_PASS_DELAY_MS = 30_000; // let the server settle (and be reachable at baseUrl) first

let running = false;
let disabled = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Owner GHII -> the moments they asked for an on-demand capture, newest last. In-process on purpose:
 * this is throttling, not accounting, and a node restart handing out a fresh allowance costs a few
 * seconds of rendering rather than money.
 */
const onDemandHistory = new Map<string, number[]>();

/** What one on-demand capture can answer. Every failure names itself, because the caller is an agent
 *  deciding what to do next rather than a log nobody reads. */
export type CaptureResult =
  | { ok: true; sizeBytes: number }
  | { ok: false; status: number; code: string; message: string };

/**
 * Launch a headless browser WITHOUT a Playwright browser download: prefer the machine's installed
 * Edge/Chrome via `channel`, then a Playwright-installed Chromium. Returns null (and the caller
 * disables the job) if none is usable. playwright-core is imported lazily so a node that never runs
 * this never loads it.
 */
async function launchBrowser(): Promise<{ close(): Promise<void>; newContext(o: unknown): Promise<unknown> } | null> {
  let chromium: { launch(o: unknown): Promise<{ close(): Promise<void>; newContext(o: unknown): Promise<unknown> }> };
  try {
    ({ chromium } = await import('playwright-core') as unknown as { chromium: typeof chromium });
  } catch {
    logger.info('Screenshot auto-capture: playwright-core not available — disabled.');
    return null;
  }
  const attempts: Array<{ channel?: string; label: string }> = [
    { channel: 'msedge', label: 'system Edge' },
    { channel: 'chrome', label: 'system Chrome' },
    { label: 'Playwright Chromium' },
  ];
  let lastErr: unknown;
  for (const a of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, channel: a.channel });
      logger.info(`Screenshot auto-capture: using ${a.label}.`);
      return browser;
    } catch (e) { lastErr = e; /* try the next browser */ }
  }
  // Surface the real launch failure — a downloaded browser that can't start (missing Linux libs)
  // looks identical to "not installed" otherwise. On Linux: `sudo npx playwright install-deps chromium`.
  logger.info('Screenshot auto-capture: no usable browser — disabled. Install one with '
    + '`npx playwright install --with-deps chromium`. Last error: ' + ((lastErr as Error)?.message ?? 'unknown'));
  return null;
}

/** One app row as both paths address it. */
interface TargetApp { ownerName: string; ownerGaii: string; filename: string }

/** The slice of the Playwright surface this file uses, kept local so playwright-core stays lazy. */
interface RenderPage {
  goto(u: string, o: unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(o: unknown): Promise<Buffer>;
  route(m: string, h: (r: { request(): { resourceType(): string }; fulfill(o: unknown): void; continue(): void }) => void): Promise<void>;
  close(): Promise<void>;
}
interface RenderCtx { newPage(): Promise<RenderPage> }

/**
 * Render one app and store its thumbnail. The bytes come from storage and are served to the page by
 * intercepting the main document, rather than navigating to the public URL: that URL 301-redirects
 * to the app origin under H-2, which 404s on a node with no separate app host and would capture an
 * error page. Sub-resources still load against the node and the page URL stays the node URL, so
 * relative paths and API calls resolve.
 *
 * Throws on failure; each caller words its own answer.
 */
async function renderAndStore(
  ctx: RenderCtx, config: AimeatConfig, storage: Storage, app: TargetApp,
): Promise<number> {
  const base = config.baseUrl.replace(/\/+$/, '');
  const page = await ctx.newPage();
  try {
    const full = await storage.getAppByOwnerName(app.ownerName, app.filename);
    // storage returns `data` as a Uint8Array; a plain Uint8Array's .toString('utf8') comma-joins the
    // byte values instead of decoding — wrap in Buffer.
    const html = full?.data ? Buffer.from(full.data).toString('utf8') : null;
    const url = `${base}/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}?mode=inline`;
    if (html) {
      let fulfilled = false;
      await page.route('**/*', (route) => {
        if (!fulfilled && route.request().resourceType() === 'document') {
          fulfilled = true;
          route.fulfill({ status: 200, contentType: 'text/html', body: html });
        } else {
          route.continue();
        }
      });
    }
    // 'load' rather than networkidle: polling and SSE apps never go idle. The settle wait after it is
    // what stops an app that fetches its data post-load from being captured blank.
    await page.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(Math.max(0, config.screenshotSettleMs));
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 80 });
    await storage.createStorageFile({
      key: `apps/screenshots/${app.filename}`,
      ownerGaii: app.ownerGaii,   // match the app row's bucket so the GET route finds it
      visibility: 'public',
      mimeType: 'image/jpeg',
      size: jpeg.length,
      data: jpeg,
      createdAt: new Date().toISOString(),
    });
    return jpeg.length;
  } finally {
    await page.close();
  }
}

/** Launch, hand over a context, and always close. */
async function withBrowser<T>(fn: (ctx: RenderCtx) => Promise<T>): Promise<T | null> {
  const browser = await launchBrowser();
  if (!browser) {
    disabled = true;
    if (timer) { clearInterval(timer); timer = null; }
    return null;
  }
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 }) as RenderCtx;
    return await fn(ctx);
  } finally {
    await browser.close();
  }
}

/**
 * One scan: capture + store a thumbnail for every published app that still has none. Returns the
 * number captured. Exported so a manual trigger / test can run a single pass on demand.
 */
export async function runScreenshotCapturePass(config: AimeatConfig, storage: Storage): Promise<number> {
  if (running || disabled) return 0;
  running = true;
  let captured = 0;
  try {
    const { apps } = await storage.listApps({ limit: 200 });
    const missing: TargetApp[] = [];
    for (const app of apps) {
      const shot = await storage.getStorageFile(app.ownerGaii, `apps/screenshots/${app.filename}`);
      if (!shot) missing.push({ ownerName: app.ownerName, ownerGaii: app.ownerGaii, filename: app.filename });
    }
    if (missing.length === 0) return 0;

    await withBrowser(async (ctx) => {
      for (const app of missing) {
        try {
          await renderAndStore(ctx, config, storage, app);
          captured++;
        } catch (e) {
          logger.warn(`Screenshot auto-capture failed for ${app.ownerName}/${app.filename}: ${(e as Error).message}`);
        }
      }
    });
    if (captured > 0) {
      logger.info(`Screenshot auto-capture: ${captured}/${missing.length} app thumbnail(s) generated.`);
      emitChange('apps');
    }
  } catch (e) {
    logger.warn(`Screenshot auto-capture pass error: ${(e as Error).message}`);
  } finally {
    running = false;
  }
  return captured;
}

/**
 * Capture ONE app now, for a caller who asked.
 *
 * Separate from the batch on purpose. The batch may skip, retry next interval and answer with a
 * count; someone who just published an app and wants to look at it needs either a picture or a
 * reason. The batch's `running` flag is deliberately NOT consulted here: a scan in progress is no
 * reason to refuse a person, and the two writing the same key is an upsert either way.
 *
 * Rendering is the most expensive thing this node does per request, so it is throttled per owner.
 */
export async function captureAppScreenshot(
  config: AimeatConfig, storage: Storage, app: { ownerName: string; filename: string },
): Promise<CaptureResult> {
  if (disabled) {
    return {
      ok: false, status: 503, code: 'NO_BROWSER',
      message: 'This node has no usable browser, so it cannot render app screenshots. An operator can '
        + 'install one with `npx playwright install --with-deps chromium`.',
    };
  }

  // The lookup lives here rather than at each door: it decides both "is there anything to render"
  // and WHICH storage bucket the thumbnail belongs in, and a door that answered the first half for
  // itself would be the second implementation of the same decision.
  const live = await storage.getAppByOwnerName(app.ownerName, app.filename);
  if (!live) {
    return {
      ok: false, status: 404, code: 'NOT_FOUND',
      message: `No published app "${app.filename}" to render. Publish it first; a draft has no public `
        + 'page to photograph.',
    };
  }

  const ownerGaii = live.ownerGaii;
  const perHour = Math.max(1, config.screenshotOnDemandPerHour);
  const now = Date.now();
  const recent = (onDemandHistory.get(ownerGaii) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= perHour) {
    const waitMin = Math.ceil((3_600_000 - (now - recent[0]!)) / 60_000);
    return {
      ok: false, status: 429, code: 'RATE_LIMITED',
      message: `Screenshot limit reached (${perHour} per hour). Try again in about ${waitMin} minute(s).`,
    };
  }
  recent.push(now);
  onDemandHistory.set(ownerGaii, recent);

  try {
    const bytes = await withBrowser((ctx) => renderAndStore(ctx, config, storage,
      { ownerName: app.ownerName, ownerGaii, filename: app.filename }));
    if (bytes === null) {
      return {
        ok: false, status: 503, code: 'NO_BROWSER',
        message: 'This node has no usable browser, so it cannot render app screenshots.',
      };
    }
    emitChange('apps');
    logger.info(`Screenshot captured on demand: ${app.ownerName}/${app.filename} (${bytes} bytes)`);
    return { ok: true, sizeBytes: bytes };
  } catch (e) {
    return {
      ok: false, status: 502, code: 'RENDER_FAILED',
      message: `The page did not render: ${(e as Error).message}`,
    };
  }
}

/** Start the interval-driven auto-capture job (no-op unless config.screenshotAutoCapture is on). */
export function startScreenshotAutoCapture(config: AimeatConfig, storage: Storage): void {
  if (!config.screenshotAutoCapture) return;
  const minutes = Math.max(1, config.screenshotIntervalMin || 15);
  setTimeout(() => { void runScreenshotCapturePass(config, storage); }, FIRST_PASS_DELAY_MS);
  timer = setInterval(() => { void runScreenshotCapturePass(config, storage); }, minutes * 60 * 1000);
  if (timer.unref) timer.unref(); // don't keep the process alive for this alone
  logger.info(`Screenshot auto-capture: enabled (scanning every ${minutes} min, writes thumbnails directly to storage).`);
}
