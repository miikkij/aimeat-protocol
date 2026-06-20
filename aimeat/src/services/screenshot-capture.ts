/**
 * @file screenshot-capture.ts
 * @description Node-internal auto-screenshot job. On an interval it finds published apps that have
 *   no screenshot, renders each one headless (playwright-core, lazily imported, driving the machine's
 *   own Edge/Chrome via a channel — no browser download), and stores a JPEG thumbnail DIRECTLY in
 *   storage. No HTTP, no token, no operator action: it self-authenticates by virtue of running
 *   inside the node. Disables itself gracefully (one log line, no crash) if no browser is available.
 *   Opt-in via config.screenshotAutoCapture so nodes without a browser never try.
 * @structure startScreenshotAutoCapture() entry; launchBrowser() channel fallback; pass() one scan.
 * @version-history
 *   v1.0.0 — 2026-06-20 — initial: interval backfill writing straight to storage; channel-fallback
 *     browser via lazy playwright-core; graceful self-disable when no browser is present.
 *   v1.1.0 — 2026-06-20 — render the app's STORED HTML directly (fulfill the main document) instead of
 *     navigating to the inline URL, which 301s to the app origin under H-2 and 404s on a node with no
 *     app host (local dev) → captured error pages. Export runScreenshotCapturePass for manual/one-shot.
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
  for (const a of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, channel: a.channel });
      logger.info(`Screenshot auto-capture: using ${a.label}.`);
      return browser;
    } catch { /* try the next browser */ }
  }
  logger.info('Screenshot auto-capture: no browser found (run `npx playwright install chromium` to enable) — disabled.');
  return null;
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
    const missing: Array<{ ownerName: string; ownerGaii: string; filename: string }> = [];
    for (const app of apps) {
      const shot = await storage.getStorageFile(app.ownerGaii, `apps/screenshots/${app.filename}`);
      if (!shot) missing.push({ ownerName: app.ownerName, ownerGaii: app.ownerGaii, filename: app.filename });
    }
    if (missing.length === 0) return 0;

    const browser = await launchBrowser();
    if (!browser) {
      disabled = true;
      if (timer) { clearInterval(timer); timer = null; }
      return 0;
    }
    try {
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 }) as {
        newPage(): Promise<{
          goto(u: string, o: unknown): Promise<unknown>;
          waitForTimeout(ms: number): Promise<void>;
          screenshot(o: unknown): Promise<Buffer>;
          route(m: string, h: (r: { request(): { resourceType(): string }; fulfill(o: unknown): void; continue(): void }) => void): Promise<void>;
          close(): Promise<void>;
        }>;
      };
      const base = config.baseUrl.replace(/\/+$/, '');
      for (const app of missing) {
        const page = await ctx.newPage();
        try {
          // Render the app's STORED HTML directly (fulfill the main document) rather than navigating
          // to the public inline URL: that URL 301-redirects to the app origin under H-2, which 404s
          // on a node with no separate app host (e.g. local dev) and would capture an error page.
          // Sub-resources (libs, images, API) still load against the node and the page URL stays the
          // node URL so relative paths resolve. Opened anonymously; 'load' (not networkidle) since
          // polling/SSE apps never go idle.
          const full = await storage.getAppByOwnerName(app.ownerName, app.filename);
          // storage returns `data` as a Uint8Array (Prisma 6 Bytes); a plain Uint8Array's
          // .toString('utf8') comma-joins the byte values instead of decoding — wrap in Buffer.
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
          await page.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT });
          await page.waitForTimeout(2000);
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
          captured++;
        } catch (e) {
          logger.warn(`Screenshot auto-capture failed for ${app.ownerName}/${app.filename}: ${(e as Error).message}`);
        } finally {
          await page.close();
        }
      }
      if (captured > 0) {
        logger.info(`Screenshot auto-capture: ${captured}/${missing.length} app thumbnail(s) generated.`);
        emitChange('apps');
      }
    } finally {
      await browser.close();
    }
  } catch (e) {
    logger.warn(`Screenshot auto-capture pass error: ${(e as Error).message}`);
  } finally {
    running = false;
  }
  return captured;
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
