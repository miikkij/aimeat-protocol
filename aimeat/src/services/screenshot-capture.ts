/**
 * @file screenshot-capture.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Node-internal auto-screenshot job. On an interval it finds published apps that have
 *   no screenshot, renders each one headless (playwright-core, lazily imported, driving the machine's
 *   own Edge/Chrome via a channel — no browser download), and stores a JPEG thumbnail DIRECTLY in
 *   storage. No HTTP, no token, no operator action: it self-authenticates by virtue of running
 *   inside the node. With no usable browser it goes off for an hour and tries again (no crash); at
 *   start it downloads the Chromium build playwright-core names when that is what is missing, and
 *   tells the operator on the Security page when the browser still does not start.
 *   Opt-in via config.screenshotAutoCapture so nodes without a browser never try.
 *
 *   It also serves ONE app on demand (captureAppScreenshot), which is a different job wearing the
 *   same machinery. The batch exists so a catalogue is not full of blank cards; the on-demand call
 *   exists because an agent that has just published an app cannot otherwise see what it made. A
 *   hosted agent has no browser and no shell, so without this it ships blind and says "done" on the
 *   strength of a 200.
 * @structure startScreenshotAutoCapture() entry; ensureHeadlessBrowser() the check at start, which
 *   installs a missing build; launchLadder() channel fallback, launchBrowser() the same with the
 *   log line; runScreenshotCapturePass() one batch scan; captureAppScreenshot() one app, with its
 *   own per-owner throttle; renderAndStore() the shared render both paths use.
 * @version-history
 *   v1.8.2 — 2026-10-25 — secaudit2026oct22: withHeadlessContext starts its deadline before the
 *     launch, closes a browser that arrives after the deadline, and waits for a close at most until
 *     the deadline plus HEADLESS_CLOSE_GRACE_MS. opts.launch replaces the launcher in tests.
 *   v1.8.1 — 2026-10-25 — secaudit2026oct22: withHeadlessContext closes the browser after a deadline
 *     (HEADLESS_DEADLINE_MS, 120 s, or opts.deadlineMs) and rejects with HeadlessDeadlineError.
 *   v1.8.0 — 2026-10-12 — ensureHeadlessBrowser(): a node with auto-capture on checks its browser at
 *     start, downloads the Chromium build its playwright-core names when that is what is missing
 *     (headless-browser-install.ts), and opens one incident on the Security page when the browser
 *     still does not start. A failed launch switches capture off for an hour, not for the life of
 *     the process, so a build installed by hand is found without a restart. Every message names the
 *     installer of this installation; `npx playwright install` could fetch another version's build.
 *     aimeat.io took no screenshot from 2026-10-10 to 2026-10-12 after playwright-core 1.63.0.
 *   v1.7.0 — 2026-10-05 — The browser has no network of its own: it starts with a proxy that leads
 *     nowhere and service workers blocked, and every context it hands out answers each request
 *     through headless-network.ts (the node's own origin from loopback, public addresses through
 *     safeFetch, private ones refused). A rendered app reached the node's private network before
 *     (secaudit 2026-10, SSRF-1). withHeadlessContext takes the config for that guard.
 *   v1.6.0 — 2026-09-19 — browserLaunchEnv(): the browser starts without the node's own LD_PRELOAD,
 *     MALLOC_CONF and NODE_OPTIONS, which deploy/aimeat.service sets for node and the browser
 *     inherited. Under the unit every launch died ("browser.newContext: Target page, context or
 *     browser has been closed", on every rung of the ladder including no-sandbox), and aimeat.io
 *     took no app thumbnail from about 2026-09-04 and said nothing about it. Proven on production:
 *     141 of 163 thumbnails before the deploy, 163 of 163 three minutes after it.
 *   v1.5.0 — 2026-09-02 — NO_HEADLESS_BROWSER: the "there is none" sentence moves here, beside the
 *     launcher that decides it, so the guarantee bench and the app playtest answer alike.
 *   v1.4.0 — 2026-08-28 — launchBrowser() PROVES a page opens before handing the browser out
 *     (a root chromium launches fine and then crashes every target — the first production
 *     bench found it), and a final no-sandbox/-dev-shm attempt joins the ladder, tried only
 *     after every sandboxed launch failed its probe.
 *   v1.3.0 — 2026-08-16 — captureAppScreenshot(): one named app, on demand, answering with a reason
 *     instead of a number. The render moved into renderAndStore() so the batch and the request run
 *     the same code. The module-level `running` flag stays a BATCH guard only — it used to make any
 *     second caller return 0 silently, which is the wrong answer to give someone who asked a
 *     question. Rendering is expensive and unauthenticated rendering is a denial-of-service shape,
 *     so the on-demand path carries a per-owner throttle of its own.
 *   v1.0.0 — 2026-06-20 — initial: interval backfill writing straight to storage; channel-fallback
 *     browser via lazy playwright-core; graceful self-disable when no browser is present.
 *     withHeadlessContext (2026-08-28) lends the same renderer to the Design Book's guarantee
 *     bench, so the node has one headless browser story rather than two.
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
import {
  HEADLESS_NO_NETWORK_ARGS, HEADLESS_CONTEXT_OPTIONS, guardHeadlessContext, serveDocumentOnce, type HeadlessRoutable,
} from './headless-network.js';
import {
  isBrowserBuildMissing, installPinnedBrowser, browserInstallHint, reportBrowserFault, clearBrowserFault, type InstallResult,
} from './headless-browser-install.js';

const VIEWPORT = { width: 1200, height: 750 };
const PAGE_TIMEOUT = 20_000;
const FIRST_PASS_DELAY_MS = 30_000; // let the server settle (and be reachable at baseUrl) first
/** How long a failed launch switches capture off before the next one is tried. */
const RETRY_AFTER_MS = 3_600_000;

let running = false;
/** Capture is off until this moment (0: on). Set by a failed launch, cleared by a browser that starts. */
let offUntil = 0;
let timer: NodeJS.Timeout | null = null;

const captureOff = (): boolean => Date.now() < offUntil;

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
 * What the node process is started with and a browser must not inherit. deploy/aimeat.service sets
 * all three for node itself: jemalloc through LD_PRELOAD (with its MALLOC_CONF), and the V8 heap
 * ceiling through NODE_OPTIONS. A child process inherits the environment, and with these three the
 * browser under the unit died before it opened a page; without them it works. Which of the three
 * does it is not known: from a shell, LD_PRELOAD alone did not reproduce it. → docs/pitfalls.md §12
 */
const NODE_ONLY_ENV = ['LD_PRELOAD', 'MALLOC_CONF', 'NODE_OPTIONS'];

/** The environment the headless browser starts with: the node's own, minus NODE_ONLY_ENV. */
export function browserLaunchEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !NODE_ONLY_ENV.includes(name)) out[name] = value;
  }
  return out;
}

export interface HeadlessBrowser { close(): Promise<void>; newContext(o: unknown): Promise<unknown> }

/** What one pass over the launch ladder gave: a browser, or the last error. No error and no browser: no playwright-core. */
export interface LaunchOutcome { browser: HeadlessBrowser | null; error?: unknown }

/**
 * Launch a headless browser: prefer the machine's installed Edge/Chrome via `channel`, then a
 * Playwright-installed Chromium. playwright-core is imported lazily so a node that never runs this
 * never loads it.
 */
async function launchLadder(): Promise<LaunchOutcome> {
  let chromium: { launch(o: unknown): Promise<HeadlessBrowser> };
  try {
    ({ chromium } = await import('playwright-core') as unknown as { chromium: typeof chromium });
  } catch {
    logger.info('Screenshot auto-capture: playwright-core not available — disabled.');
    return { browser: null };
  }
  // Sandboxed first, relaxed only as the fallback: a root-run server chromium crashes its
  // targets under the sandbox ("Target crashed" — the first production bench found it), and a
  // container's small /dev/shm kills tabs the same way. The relaxed args trade renderer
  // isolation for a working bench, so they are tried ONLY after every sandboxed launch failed.
  const RELAXED = ['--no-sandbox', '--disable-dev-shm-usage'];
  const attempts: Array<{ channel?: string; label: string; args?: string[] }> = [
    { channel: 'msedge', label: 'system Edge' },
    { channel: 'chrome', label: 'system Chrome' },
    { label: 'Playwright Chromium' },
    { label: 'Playwright Chromium (no sandbox)', args: RELAXED },
  ];
  let lastErr: unknown;
  for (const a of attempts) {
    let browser: HeadlessBrowser | null = null;
    try {
      // No network of its own: every request is answered by the context's guard (headless-network.ts).
      browser = await chromium.launch({
        headless: true, channel: a.channel, args: [...HEADLESS_NO_NETWORK_ARGS, ...(a.args ?? [])], env: browserLaunchEnv(process.env),
      });
      // Prove the browser can actually open a page — a root chromium LAUNCHES fine under the
      // sandbox and then crashes every target, which a launch-only probe never sees.
      const probe = await browser.newContext({ ...HEADLESS_CONTEXT_OPTIONS }) as {
        newPage(): Promise<{ close(): Promise<void> }>; close(): Promise<void>;
      };
      const page = await probe.newPage();
      await page.close();
      await probe.close();
      logger.info(`Screenshot auto-capture: using ${a.label}.`);
      return { browser };
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line aimeat/no-silent-catch -- a browser that failed its probe may also fail to close; the attempt loop moves on either way
      if (browser) { try { await browser.close(); } catch { /* already gone */ } }
    }
  }
  return { browser: null, error: lastErr };
}

const launchErrorText = (out: LaunchOutcome): string => (out.error as Error | undefined)?.message ?? 'unknown';

/** The ladder, with the log line when nothing started. Returns null (and the caller switches capture off) if none is usable. */
async function launchBrowser(): Promise<HeadlessBrowser | null> {
  const out = await launchLadder();
  // Surface the real launch failure — a downloaded browser that can't start (missing Linux libs)
  // looks identical to "not installed" otherwise.
  if (!out.browser && out.error !== undefined) {
    logger.info(`Screenshot auto-capture: no usable browser — off for an hour. Install one with: ${browserInstallHint()}. `
      + `Last error: ${launchErrorText(out)}`);
  }
  return out.browser;
}

/**
 * The check at start, for a node with auto-capture on: does the browser start? When the build this
 * playwright-core names is what is missing, download it and try again. When the browser still does
 * not start, capture goes off for an hour and the operator gets one incident on the Security page;
 * when it starts, an incident left by an earlier start is closed.
 *
 * It runs at start and not at the first screenshot, because a missing build would otherwise wait
 * for the next published app to be noticed. It installs nothing for an on-demand capture, a
 * playtest or a bench: a request never waits for a download, and never causes one.
 */
export async function ensureHeadlessBrowser(
  config: AimeatConfig, storage: Storage,
  deps: { launch?: () => Promise<LaunchOutcome>; install?: () => Promise<InstallResult> } = {},
): Promise<boolean> {
  const launch = deps.launch ?? launchLadder;
  const install = deps.install ?? (() => installPinnedBrowser(browserLaunchEnv(process.env)));
  running = true; // the batch waits: a download can outlast its interval
  try {
    let out = await launch();
    let installError: string | undefined;
    if (!out.browser && isBrowserBuildMissing(out.error)) {
      logger.info('Screenshot auto-capture: the Chromium build this playwright-core starts is not installed. Downloading it.');
      const installed = await install();
      if (installed.ok) {
        logger.info(`Screenshot auto-capture: Chromium build installed${installed.ipv4Only ? ' (over IPv4 only)' : ''}.`);
        out = await launch();
      } else {
        installError = installed.error;
      }
    }
    if (out.browser) {
      await out.browser.close();
      offUntil = 0;
      await clearBrowserFault(storage, config);
      return true;
    }
    if (out.error === undefined) return false; // no playwright-core: launchLadder said so
    offUntil = Date.now() + RETRY_AFTER_MS;
    logger.warn(`Screenshot auto-capture: the browser does not start — off for an hour. Last error: ${launchErrorText(out)}`
      + (installError !== undefined ? ` Download error: ${installError}` : ''));
    await reportBrowserFault(storage, config, { launchError: launchErrorText(out), installError });
    return false;
  } finally {
    running = false;
  }
}

/** One app row as both paths address it. */
interface TargetApp { ownerName: string; ownerGaii: string; filename: string }

/** The slice of the Playwright surface this file uses, kept local so playwright-core stays lazy. */
interface RenderPage extends HeadlessRoutable {
  goto(u: string, o: unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(o: unknown): Promise<Buffer>;
  close(): Promise<void>;
}
interface RenderCtx { newPage(): Promise<RenderPage> }

/**
 * Render one app and store its thumbnail. The bytes come from storage and are served to the page by
 * intercepting the main document, rather than navigating to the public URL: that URL 301-redirects
 * to the app origin under H-2, which 404s on a node with no separate app host and would capture an
 * error page. Sub-resources load through the context's guard (headless-network.ts): the node's own
 * from its loopback, public ones through safeFetch, private ones not at all.
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
    if (html) await serveDocumentOnce(page, html, 'text/html');
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

/**
 * What every bench says when this machine has no browser to run it in. One sentence, in one place,
 * because the Design Book's guarantee bench and the app playtest are both answering the same
 * question and an operator reading two different wordings would go looking for two problems.
 */
export const NO_HEADLESS_BROWSER =
  `No headless browser on this node. An operator installs one with: ${browserInstallHint()} `
  + '(or run this on a node that has Edge or Chrome).';

/**
 * The same headless browser, lent out: launch, hand over a context, always close, and answer null
 * when no browser exists on this machine (the caller words its own "unavailable"). Exported for
 * the Design Book's guarantee bench — one renderer on the node, not two.
 */
export async function withHeadlessContext<T>(
  config: AimeatConfig,
  viewport: { width: number; height: number },
  fn: (ctx: { newPage(): Promise<unknown> }) => Promise<T>,
  opts: { deadlineMs?: number; launch?: () => Promise<HeadlessBrowser | null> } = {},
): Promise<T | null> {
  // The deadline starts before the launch: a launch or its page probe can stall under machine load,
  // and the caller's wait is the whole of it. The browser is closed by the deadline whatever the
  // page does: an evaluate against a renderer whose main thread never yields has no timeout of its
  // own, and closing the browser is what makes it reject. The callback's own promise is then settled
  // by that rejection and is ignored here.
  const ms = Math.max(1, opts.deadlineMs ?? HEADLESS_DEADLINE_MS);
  const endsAt = Date.now() + ms;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HeadlessDeadlineError(ms)), ms);
  });
  // The races below read the deadline's rejection; this keeps one nobody races any more from being unhandled.
  deadline.catch((err: unknown) => { logger.debug('headless: deadline passed', { error: String(err) }); });
  const launching = (opts.launch ?? launchBrowser)();
  let browser: HeadlessBrowser | null;
  try {
    browser = await Promise.race([launching, deadline]);
  } catch (err) {
    clearTimeout(timer);
    // The launch outlived the deadline: the browser it brings later is closed when it arrives.
    void launching.then(
      (late) => (late ? closeWithin(late, HEADLESS_CLOSE_GRACE_MS) : undefined),
      (lateErr: unknown) => { logger.debug('headless: launch failed after its deadline', { error: String(lateErr) }); },
    );
    throw err;
  }
  if (!browser) { clearTimeout(timer); return null; }
  try {
    const work = guardedContext<{ newPage(): Promise<unknown> }>(browser, config, viewport).then(fn);
    // The work's own rejection, which follows the deadline's close; the race below has already answered.
    work.catch((err: unknown) => { logger.debug('headless: work ended after its browser closed', { error: String(err) }); });
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    // The close is waited for until the deadline, and for a short grace after it at most.
    await closeWithin(browser, Math.max(HEADLESS_CLOSE_GRACE_MS, endsAt - Date.now()));
  }
}

/**
 * Close a browser, waiting at most `ms`. A close that hangs (a renderer that does not answer) is left
 * to finish on its own; the caller has its answer either way.
 */
async function closeWithin(browser: HeadlessBrowser, ms: number): Promise<void> {
  let t: NodeJS.Timeout | undefined;
  const closing = browser.close().catch((err: unknown) => {
    logger.debug('headless: the browser close failed', { error: String(err) });
  });
  const waited = new Promise<void>((resolve) => { t = setTimeout(resolve, ms); });
  try {
    await Promise.race([closing, waited]);
  } finally {
    clearTimeout(t);
  }
}

/** How long one lent browser may stay open: the launch, page loads, settle waits and measurements included. */
export const HEADLESS_DEADLINE_MS = 120_000;

/** How long a close is waited for once the deadline has passed. */
export const HEADLESS_CLOSE_GRACE_MS = 1_000;

/** The browser was closed because the work in it did not finish within the deadline. */
export class HeadlessDeadlineError extends Error {
  constructor(public readonly deadlineMs: number) {
    super(`the page did not finish within ${Math.round(deadlineMs / 1000)} seconds, so the browser was closed`);
  }
}

/** A context whose every request the guard answers (headless-network.ts). The one way a context is made here. */
async function guardedContext<C>(
  browser: { newContext(o: unknown): Promise<unknown> }, config: AimeatConfig, viewport: { width: number; height: number },
): Promise<C> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...HEADLESS_CONTEXT_OPTIONS }) as C & HeadlessRoutable;
  await guardHeadlessContext(ctx, config);
  return ctx;
}

/** Launch, hand over a context, and always close. */
async function withBrowser<T>(config: AimeatConfig, fn: (ctx: RenderCtx) => Promise<T>): Promise<T | null> {
  const browser = await launchBrowser();
  if (!browser) {
    offUntil = Date.now() + RETRY_AFTER_MS;
    return null;
  }
  try {
    return await fn(await guardedContext<RenderCtx>(browser, config, VIEWPORT));
  } finally {
    await browser.close();
  }
}

/**
 * One scan: capture + store a thumbnail for every published app that still has none. Returns the
 * number captured. Exported so a manual trigger / test can run a single pass on demand.
 */
export async function runScreenshotCapturePass(config: AimeatConfig, storage: Storage): Promise<number> {
  if (running || captureOff()) return 0;
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

    await withBrowser(config, async (ctx) => {
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
  if (captureOff()) {
    return {
      ok: false, status: 503, code: 'NO_BROWSER',
      message: 'This node has no usable browser, so it cannot render app screenshots. An operator can '
        + `install one with: ${browserInstallHint()}`,
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
    const bytes = await withBrowser(config, (ctx) => renderAndStore(ctx, config, storage,
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
  setTimeout(() => {
    void ensureHeadlessBrowser(config, storage).then(() => runScreenshotCapturePass(config, storage));
  }, FIRST_PASS_DELAY_MS);
  timer = setInterval(() => { void runScreenshotCapturePass(config, storage); }, minutes * 60 * 1000);
  if (timer.unref) timer.unref(); // don't keep the process alive for this alone
  logger.info(`Screenshot auto-capture: enabled (scanning every ${minutes} min, writes thumbnails directly to storage).`);
}
