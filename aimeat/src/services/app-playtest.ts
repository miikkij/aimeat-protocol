/**
 * @file src/services/app-playtest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE PLAYTEST BENCH: a published app opened in a real headless browser, signed out,
 *   the way a stranger opens it, with the eight things a game gets wrong MEASURED rather than
 *   assumed.
 *
 *   WHY THE STATIC LINT IS NOT ENOUGH. app-artifact-lint.ts reads the bytes: it finds a script that
 *   does not parse and an asset URL this node answers 404 for. It cannot see a game that boots,
 *   draws one black rectangle and stops, a canvas that keeps its desktop width on a phone, an audio
 *   context started before anyone touched the screen (Chrome refuses it and the game plays silent
 *   for the rest of the session), or a control the size of a full stop. Every one of those publishes
 *   clean and fails in front of the first player.
 *
 *   THE SAME BROWSER THE DESIGN BOOK BENCHES WITH. withHeadlessContext (screenshot-capture.ts) is
 *   the node's one headless-browser story; this borrows it, loads the app's stored bytes by
 *   fulfilling the document request, and points the page at the node's own LOOPBACK so the app's
 *   /v1/libs and /lib URLs resolve without the node having to reach its own public hostname.
 *
 *   A NODE WITH NO BROWSER ANSWERS WITH WORDS, in the same sentence the guarantee bench uses
 *   (NO_HEADLESS_BROWSER). An unavailable playtest is never a passed playtest, and it is never a 500
 *   either: ran:false plus the reason is the contract.
 *
 *   WHAT FAILS OPEN. A check that could not be MADE reports ok with the reason it could not run: a
 *   WebGL canvas whose drawing buffer is cleared at composite cannot be sampled from outside a
 *   frame, and calling that a black screen would teach people to ignore the bench. Only measured
 *   evidence fails a check, which is the same rule the publish-time asset probe follows.
 * @structure
 *   - AppPlaytestCheck / AppPlaytestResult — the shapes every door returns
 *   - runAppPlaytest(storage, config, owner, filename, opts?) — the eight checks, two browser passes
 *   - auditAppWithPlaytest(storage, config, app) — the static lint, then the playtest, for the audit
 *   - the in-page probes, one string each, so playwright-core stays lazily imported
 * @usage
 *   const result = await runAppPlaytest(storage, config, 'alice', 'runner.html');
 *   if (result.ran && !result.summary.ok) { ... }
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (the game playtest bench).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { withHeadlessContext, NO_HEADLESS_BROWSER } from './screenshot-capture.js';
import { lintAppArtifact, type AppArtifactLintResult } from './app-artifact-lint.js';
import { logger } from '../utils/logger.js';

/** The phone the app has to work on, and the desktop it has to survive being stretched to. */
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 720 };

const PAGE_TIMEOUT_MS = 20_000;
/** How long the app gets to draw its first frame before the boot check gives up. */
const BOOT_DEADLINE_MS = 8_000;
const BOOT_POLL_MS = 250;
/** How long the app gets to draw something worth looking at before the pixels are sampled. */
const PAINT_SETTLE_MS = 3_000;
/** After a resize, how long the layout gets to settle before it is measured. */
const RESIZE_SETTLE_MS = 600;
/** How many console errors travel back. The rest are counted, not quoted. */
const MAX_QUOTED_ERRORS = 10;
/** The touch minimum, the same number the Design Book's guarantee bench measures against. */
const TOUCH_MIN_PX = 24;

/**
 * One measured claim about the app.
 *
 * `severity` decides whether a failure counts: a `must` check that fails is a broken app, an `info`
 * check reports something the builder should know and never fails the run. The save round-trip is
 * the only `info` one, because an app with nothing to remember is a legitimate app.
 */
export interface AppPlaytestCheck {
  id: string;
  ok: boolean;
  severity: 'must' | 'info';
  /** One plain sentence, written for whoever built the app. */
  detail: string;
  /** How long this check took, where the number means anything to a reader. */
  ms?: number;
}

export interface AppPlaytestResult {
  ran: boolean;
  /** Why it did not run. Present only when ran is false. */
  reason?: string;
  at: string;
  checks: AppPlaytestCheck[];
  console: { errors: string[]; warnings: number };
  summary: { ok: boolean; failed: number };
}

export interface AppPlaytestOptions {
  /** The app's bytes, when the caller already has them (the audit door lints them first). */
  html?: string;
  /** How long the app gets to draw before its pixels are sampled. Default 3000 ms. */
  settleMs?: number;
}

/** The app as this service addresses it. */
export interface PlaytestTarget { ownerName: string; filename: string }

// ── The slice of the Playwright surface this file drives (playwright-core stays lazy) ────────────

interface PlaytestConsoleMessage { type(): string; text(): string }
interface PlaytestResponse { url(): string; status(): number }
interface PlaytestPage {
  goto(u: string, o: unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  route(m: string, h: (r: { request(): { resourceType(): string }; fulfill(o: unknown): void; continue(): void }) => void): Promise<void>;
  addInitScript(s: unknown): Promise<void>;
  emulateMedia(o: unknown): Promise<void>;
  setViewportSize(o: { width: number; height: number }): Promise<void>;
  evaluate<T>(fn: string): Promise<T>;
  on(event: string, handler: (arg: never) => void): void;
  mouse: { move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void> };
  close(): Promise<void>;
}

// ── The in-page probes ──────────────────────────────────────────────────────────────────────────

/**
 * Recorded BEFORE the app's own scripts run, because the question is what the app does on load.
 *
 * Chrome refuses to start an AudioContext before a gesture and leaves it suspended; a game that
 * builds its sound on load and never resumes it plays silent for the whole session and nothing in
 * its console says so. The Proxy keeps the constructor's prototype and statics, so an app that
 * subclasses AudioContext still works while it is being watched.
 */
const AUDIO_PROBE_JS = `(() => {
  if (window.__aimeatPlaytestAudio) return;
  const rec = { created: 0, gestured: false, runningBefore: 0, runningAfter: 0, states: [] };
  window.__aimeatPlaytestAudio = rec;
  const note = (ctx) => {
    const state = String(ctx && ctx.state);
    if (rec.states.length < 12) rec.states.push((rec.gestured ? 'after:' : 'before:') + state);
    if (state === 'running') { if (rec.gestured) rec.runningAfter++; else rec.runningBefore++; }
  };
  const watch = (Orig) => new Proxy(Orig, {
    construct(target, args) {
      const ctx = Reflect.construct(target, args);
      rec.created++;
      note(ctx);
      try { ctx.addEventListener('statechange', () => note(ctx)); } catch (err) { rec.states.push('no-statechange'); }
      return ctx;
    },
  });
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Orig = window[name];
    if (typeof Orig === 'function') window[name] = watch(Orig);
  }
  window.addEventListener('pointerdown', () => { rec.gestured = true; }, true);
})()`;

/** Has the app drawn its own surface yet: a canvas, or a main region it fills itself. */
const BOOT_JS = `(() => {
  const canvas = document.querySelector('canvas');
  const main = document.querySelector('main, [role="main"], #app, #game, #root, .app');
  const painted = !!canvas || (!!main && main.getBoundingClientRect().height > 40);
  return {
    painted,
    canvas: !!canvas,
    main: !!main,
    bodyChildren: document.body ? document.body.children.length : 0,
    title: (document.title || '').slice(0, 80),
  };
})()`;

/**
 * The black-screen sample: the biggest canvas, read down to a 32x32 thumbnail and counted for
 * distinct colours.
 *
 * Three ways to read it, in order of how trustworthy the answer is: a 2D context reads directly, a
 * WebGL context that KEPT its drawing buffer reads with readPixels, and anything else is copied
 * with drawImage. When the copy comes back fully transparent from a WebGL canvas whose buffer is
 * cleared at composite, that is the buffer being gone rather than the game being blank, and the
 * probe says so instead of guessing.
 */
const PAINT_JS = `(() => {
  const list = Array.from(document.querySelectorAll('canvas'));
  if (!list.length) return { kind: 'none' };
  const c = list.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  if (!c.width || !c.height) return { kind: 'empty' };
  const S = 32;
  const count = (data) => {
    const seen = new Set();
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 8) opaque++;
      seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',' + data[i + 3]);
    }
    return { colours: seen.size, opaque, samples: data.length / 4, first: Array.from(seen)[0] };
  };
  let two = null;
  try { two = c.getContext('2d'); } catch (err) { two = null; }
  if (two && typeof two.getImageData === 'function') {
    try {
      const w = Math.min(S, c.width), h = Math.min(S, c.height);
      return Object.assign({ kind: 'read', how: '2d' }, count(two.getImageData(0, 0, w, h).data));
    } catch (err) { return { kind: 'unreadable', why: String((err && err.message) || err) }; }
  }
  let gl = null;
  try { gl = c.getContext('webgl2') || c.getContext('webgl'); } catch (err) { gl = null; }
  const kept = !!(gl && gl.getContextAttributes && gl.getContextAttributes().preserveDrawingBuffer);
  if (gl && kept) {
    try {
      const w = Math.min(S, c.width), h = Math.min(S, c.height);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return Object.assign({ kind: 'read', how: 'webgl' }, count(buf));
    } catch (err) { return { kind: 'unreadable', why: String((err && err.message) || err) }; }
  }
  const scratch = document.createElement('canvas');
  scratch.width = S; scratch.height = S;
  const g = scratch.getContext('2d', { willReadFrequently: true });
  if (!g) return { kind: 'unreadable', why: 'this browser gave no 2d context to copy the canvas into' };
  try { g.drawImage(c, 0, 0, S, S); } catch (err) { return { kind: 'unreadable', why: String((err && err.message) || err) }; }
  let read;
  try { read = count(g.getImageData(0, 0, S, S).data); } catch (err) { return { kind: 'unreadable', why: String((err && err.message) || err) }; }
  if (read.opaque === 0 && gl && !kept) {
    return { kind: 'unreadable', why: 'this canvas is WebGL with preserveDrawingBuffer off, so its pixels are gone by the time anything outside the frame can read them' };
  }
  return Object.assign({ kind: 'read', how: 'copy' }, read);
})()`;

/** Layout at whatever viewport the page is currently at: overflow, the canvas box, the controls. */
const LAYOUT_JS = `(() => {
  const doc = document.documentElement;
  const list = Array.from(document.querySelectorAll('canvas'));
  const c = list.length ? list.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)) : null;
  const box = c ? c.getBoundingClientRect() : null;
  let controls = 0, small = 0, worst = '';
  for (const el of document.querySelectorAll('button, [role="button"], a, input, select, textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    controls++;
    if (r.height < ${TOUCH_MIN_PX} || r.width < ${TOUCH_MIN_PX}) {
      small++;
      if (!worst) worst = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' at ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' px';
    }
  }
  return {
    overflow: doc.scrollWidth - doc.clientWidth,
    viewport: window.innerWidth,
    canvas: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
    controls, small, worst,
  };
})()`;

/** Can this page keep anything: the platform data library loaded, or memory named in its head. */
const SAVE_JS = `(() => {
  const meta = document.querySelector('meta[name="aimeat-scopes"]');
  return {
    library: !!(window.AIMEAT && window.AIMEAT.data),
    declared: meta ? String(meta.getAttribute('content') || '') : '',
  };
})()`;

const AUDIO_READ_JS = `(() => window.__aimeatPlaytestAudio || null)()`;

// ── The run ─────────────────────────────────────────────────────────────────────────────────────

interface AudioProbe { created: number; gestured: boolean; runningBefore: number; runningAfter: number; states: string[] }
interface BootProbe { painted: boolean; canvas: boolean; main: boolean; bodyChildren: number; title: string }
interface PaintProbe { kind: 'none' | 'empty' | 'read' | 'unreadable'; how?: string; why?: string; colours?: number; opaque?: number; samples?: number; first?: string }
interface LayoutProbe { overflow: number; viewport: number; canvas: { w: number; h: number } | null; controls: number; small: number; worst: string }
interface SaveProbe { library: boolean; declared: string }

/** What one page pass collected, before any of it is turned into a sentence. */
interface PassRecord {
  errors: string[];
  errorCount: number;
  warnings: number;
  badResponses: string[];
}

function newPassRecord(): PassRecord {
  return { errors: [], errorCount: 0, warnings: 0, badResponses: [] };
}

/** Wire a page's console, page errors and same-origin failures into one record. */
function listen(page: PlaytestPage, record: PassRecord, origin: string): void {
  page.on('console', ((msg: PlaytestConsoleMessage) => {
    const type = msg.type();
    if (type === 'error') {
      record.errorCount++;
      if (record.errors.length < MAX_QUOTED_ERRORS) record.errors.push(msg.text().slice(0, 240));
    } else if (type === 'warning') {
      record.warnings++;
    }
  }) as (arg: never) => void);
  page.on('pageerror', ((err: Error) => {
    record.errorCount++;
    if (record.errors.length < MAX_QUOTED_ERRORS) record.errors.push(String(err?.message ?? err).slice(0, 240));
  }) as (arg: never) => void);
  page.on('response', ((res: PlaytestResponse) => {
    const status = res.status();
    if (status < 400) return;
    // Only this node's own answers: a stranger's CDN refusing us is not this app's fault, and the
    // static lint already warns about loading from one.
    if (!res.url().startsWith(origin)) return;
    const path = res.url().slice(origin.length) || '/';
    // The browser asks for a favicon nobody wrote into the page. Reporting that as the app's
    // broken file would fail every correct app, which is how a check teaches people to ignore it.
    if (path.startsWith('/favicon.')) return;
    if (record.badResponses.length < MAX_QUOTED_ERRORS) record.badResponses.push(`${status} ${path}`);
  }) as (arg: never) => void);
}

/** Serve the app's own bytes as the document, exactly as the screenshot capturer does. */
async function serveApp(page: PlaytestPage, html: string): Promise<void> {
  let fulfilled = false;
  await page.route('**/*', (route) => {
    if (!fulfilled && route.request().resourceType() === 'document') {
      fulfilled = true;
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    } else {
      route.continue();
    }
  });
}

function check(id: string, ok: boolean, severity: AppPlaytestCheck['severity'], detail: string, ms?: number): AppPlaytestCheck {
  return ms === undefined ? { id, ok, severity, detail } : { id, ok, severity, detail, ms };
}

/**
 * Open a published app the way a stranger does and measure the eight things a game gets wrong.
 *
 * Two browser passes: the first boots the app on a phone viewport, samples its pixels, presses it
 * once and stretches it to a desktop; the second reloads it with reduced motion asked for. Nothing
 * is written anywhere — the caller decides what to do with the answer.
 */
export async function runAppPlaytest(
  storage: Storage, config: AimeatConfig, owner: string, filename: string, opts: AppPlaytestOptions = {},
): Promise<AppPlaytestResult> {
  const at = new Date().toISOString();
  let html = opts.html;
  if (html === undefined) {
    const app = await storage.getAppByOwnerName(owner, filename);
    // A Uint8Array's own toString comma-joins the byte values instead of decoding them.
    html = app?.data ? Buffer.from(app.data).toString('utf8') : undefined;
  }
  if (!html) {
    return {
      ran: false,
      reason: `There is no published app named "${filename}" to open. Publish it first: a draft has no page for anyone to play.`,
      at, checks: [], console: { errors: [], warnings: 0 }, summary: { ok: true, failed: 0 },
    };
  }

  // Relative and root-absolute URLs in the app resolve against THIS address, so it points at the
  // node's own loopback rather than its public hostname: a server often cannot reach its own public
  // name from inside, and the playtest must not depend on that (the same lesson as the Design Book
  // bench, learned in production).
  const origin = `http://127.0.0.1:${config.port}`;
  const url = `${origin}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}?mode=inline`;
  const settleMs = Math.max(0, Math.min(15_000, opts.settleMs ?? PAINT_SETTLE_MS));

  const main = newPassRecord();
  let pass: MainPassMeasurements | null;
  try {
    pass = await withHeadlessContext(MOBILE, async (ctx) => {
      const page = await (ctx as { newPage(): Promise<PlaytestPage> }).newPage();
      try {
        listen(page, main, origin);
        await page.addInitScript({ content: AUDIO_PROBE_JS });
        await serveApp(page, html as string);
        return await measureMainPass(page, url, settleMs);
      } finally {
        await page.close();
      }
    });
  } catch (err) {
    return {
      ran: false,
      reason: `The browser started but the app did not get through its playtest: ${(err as Error)?.message ?? 'unknown error'}. `
        + 'A load timeout here usually means this node could not answer its own loopback for the libraries the app loads.',
      at, checks: [], console: { errors: main.errors, warnings: main.warnings }, summary: { ok: true, failed: 0 },
    };
  }
  if (pass === null) {
    return {
      ran: false, reason: NO_HEADLESS_BROWSER, at,
      checks: [], console: { errors: [], warnings: 0 }, summary: { ok: true, failed: 0 },
    };
  }

  const reduced = newPassRecord();
  const reducedRan = await runReducedMotionPass(html, url, origin, reduced, settleMs);

  const checks = [
    ...bootAndPaintChecks(pass),
    consoleCheck(main),
    resizeCheck(pass),
    audioCheck(pass),
    touchCheck(pass),
    saveCheck(pass, html),
    reducedMotionCheck(reduced, reducedRan),
  ];
  const failed = checks.filter((c) => c.severity === 'must' && !c.ok).length;
  return {
    ran: true, at, checks,
    console: { errors: [...main.errors, ...reduced.errors].slice(0, MAX_QUOTED_ERRORS), warnings: main.warnings + reduced.warnings },
    summary: { ok: failed === 0, failed },
  };
}

/** Everything the first pass measured, in the order it was measured. */
interface MainPassMeasurements {
  boot: BootProbe;
  bootMs: number;
  paint: PaintProbe;
  paintMs: number;
  mobile: LayoutProbe;
  desktop: LayoutProbe;
  audio: AudioProbe | null;
  gesture: string;
  save: SaveProbe;
}

async function measureMainPass(page: PlaytestPage, url: string, settleMs: number): Promise<MainPassMeasurements> {
  // domcontentloaded rather than load: one slow image on another host must never time the whole
  // playtest out, and everything measured here is measured after the settle anyway.
  const started = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });

  let boot = await page.evaluate<BootProbe>(BOOT_JS);
  while (!boot.painted && Date.now() - started < BOOT_DEADLINE_MS) {
    await page.waitForTimeout(BOOT_POLL_MS);
    boot = await page.evaluate<BootProbe>(BOOT_JS);
  }
  const bootMs = Date.now() - started;

  await page.waitForTimeout(settleMs);
  const paintStarted = Date.now();
  const paint = await page.evaluate<PaintProbe>(PAINT_JS);
  const paintMs = Date.now() - paintStarted;
  const mobile = await page.evaluate<LayoutProbe>(LAYOUT_JS);
  const save = await page.evaluate<SaveProbe>(SAVE_JS);

  // One real press, in the middle of the canvas where a game expects it. A trusted gesture is what
  // lifts the browser's audio block, so this is the only honest way to ask whether the app waited
  // for one. A press that navigates away costs the rest of the pass, so it is guarded.
  let gesture = 'pressed once in the middle of the page';
  try {
    await page.mouse.move(Math.round(MOBILE.width / 2), Math.round(MOBILE.height / 2));
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(400);
  } catch (err) {
    gesture = `the press could not be delivered (${(err as Error)?.message ?? 'unknown error'})`;
  }
  const audio = await page.evaluate<AudioProbe | null>(AUDIO_READ_JS);

  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(RESIZE_SETTLE_MS);
  const desktop = await page.evaluate<LayoutProbe>(LAYOUT_JS);

  return { boot, bootMs, paint, paintMs, mobile, desktop, audio, gesture, save };
}

/**
 * The second pass: the same app, told the person prefers reduced motion. An app that reads the
 * media query and takes a branch it has never run is where a crash hides, and the player who set
 * that preference is the least likely to report it.
 */
async function runReducedMotionPass(
  html: string, url: string, origin: string, record: PassRecord, settleMs: number,
): Promise<boolean> {
  try {
    const done = await withHeadlessContext(MOBILE, async (ctx) => {
      const page = await (ctx as { newPage(): Promise<PlaytestPage> }).newPage();
      try {
        listen(page, record, origin);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveApp(page, html);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        await page.waitForTimeout(Math.min(settleMs, PAINT_SETTLE_MS));
        return true;
      } finally {
        await page.close();
      }
    });
    return done === true;
  } catch (err) {
    // The pass itself failing is the finding: the check below reports it in words rather than
    // taking the whole playtest down with it.
    record.errors.push(`the reduced-motion run did not complete: ${(err as Error)?.message ?? 'unknown error'}`);
    logger.debug('app-playtest: the reduced-motion pass did not complete', { error: String(err) });
    return false;
  }
}

// ── The eight checks, each one sentence a person can act on ─────────────────────────────────────

function bootAndPaintChecks(pass: MainPassMeasurements): AppPlaytestCheck[] {
  const { boot, bootMs, paint, paintMs } = pass;
  const bootCheck = boot.painted
    ? check('boots', true, 'must',
      `The app opened with nobody signed in and had ${boot.canvas ? 'a canvas' : 'its main area'} on screen after ${(bootMs / 1000).toFixed(1)} seconds.`, bootMs)
    : check('boots', false, 'must',
      `Nothing was on screen ${(bootMs / 1000).toFixed(0)} seconds after the app opened with nobody signed in: no canvas, and no main area taller than 40 pixels `
      + `(the page had ${boot.bodyChildren} element(s) in its body). A visitor who is not logged in sees this. Draw something before you need a sign-in, `
      + 'or draw the sign-in itself.', bootMs);

  let paintCheck: AppPlaytestCheck;
  if (paint.kind === 'none') {
    paintCheck = check('paints', true, 'must', 'This app draws no canvas, so there is no black screen to look for.', paintMs);
  } else if (paint.kind === 'empty') {
    paintCheck = check('paints', false, 'must',
      'The canvas is on the page with no size at all (zero pixels wide or tall), so nothing can be drawn on it. Give it a size in the markup, in CSS, or from the code that sets it up.', paintMs);
  } else if (paint.kind === 'unreadable') {
    paintCheck = check('paints', true, 'must',
      `The canvas could not be sampled, so this check did not run: ${paint.why ?? 'no reason given'}. Nothing here says the app is blank, and nothing says it is not.`, paintMs);
  } else if ((paint.opaque ?? 0) === 0) {
    paintCheck = check('paints', false, 'must',
      `Three seconds in, every pixel on the canvas is still see-through, so the player is looking at the page background. Draw a first frame at start-up rather than waiting for the first tick.`, paintMs);
  } else if ((paint.colours ?? 0) < 2) {
    paintCheck = check('paints', false, 'must',
      `Three seconds in, the whole canvas is one colour (${paint.first ?? 'unknown'} as red, green, blue and opacity). That is the black screen a player calls broken: `
      + 'the game booted and drew nothing on top of its background. Check that the first scene starts and that its assets arrived.', paintMs);
  } else {
    paintCheck = check('paints', true, 'must',
      `Three seconds in, the canvas has ${paint.colours} distinct colours on it, so something is actually drawn.`, paintMs);
  }
  return [bootCheck, paintCheck];
}

function consoleCheck(record: PassRecord): AppPlaytestCheck {
  const bad = record.badResponses;
  if (record.errorCount === 0 && bad.length === 0) {
    return check('clean-console', true, 'must',
      `The app ran without a single error in the browser console, and every file it asked this node for came back${record.warnings ? ` (${record.warnings} warning(s), which nothing here fails on)` : ''}.`);
  }
  const parts: string[] = [];
  if (record.errorCount) parts.push(`${record.errorCount} error(s) in the browser console: ${record.errors.join(' · ')}`);
  if (bad.length) parts.push(`${bad.length} file(s) this node refused to serve: ${bad.join(' · ')}`);
  return check('clean-console', false, 'must', `${parts.join('. ')}. Each of these happens for every player, every time.`);
}

function resizeCheck(pass: MainPassMeasurements): AppPlaytestCheck {
  const { mobile, desktop } = pass;
  const problems: string[] = [];
  if (mobile.overflow > 0) problems.push(`on a phone the page is ${mobile.overflow} px wider than the screen, so it scrolls sideways`);
  if (desktop.overflow > 0) problems.push(`on a desktop the page is ${desktop.overflow} px wider than the window`);
  if (mobile.canvas && mobile.canvas.w > mobile.viewport + 1) problems.push(`the canvas is ${mobile.canvas.w} px wide inside a ${mobile.viewport} px phone screen`);
  if (desktop.canvas && desktop.canvas.w > desktop.viewport + 1) problems.push(`the canvas is ${desktop.canvas.w} px wide inside a ${desktop.viewport} px window`);
  if (problems.length) {
    return check('resizes', false, 'must',
      `${problems.join('; ')}. Size the canvas from the space it is given rather than from a fixed number, and let the page decide the width.`);
  }
  const fixed = mobile.canvas && desktop.canvas && mobile.canvas.w === desktop.canvas.w;
  const shape = mobile.canvas
    ? `The canvas is ${mobile.canvas.w}x${mobile.canvas.h} on a phone and ${desktop.canvas?.w}x${desktop.canvas?.h} on a desktop`
      + (fixed ? ', a fixed size that fits both, ' : ', following the space it is given, ')
    : 'The page carries no canvas, ';
  return check('resizes', true, 'must', `${shape}and neither screen scrolls sideways.`);
}

function audioCheck(pass: MainPassMeasurements): AppPlaytestCheck {
  const probe = pass.audio;
  if (!probe || probe.created === 0) {
    return check('audio-gated', true, 'must', 'This app never asks for sound, so there is nothing for the browser to block.');
  }
  if (probe.runningBefore > 0) {
    return check('audio-gated', false, 'must',
      `The app started its sound before anyone touched the screen (${probe.created} sound engine(s), states seen: ${probe.states.join(', ')}). `
      + 'Chrome refuses that and leaves the sound switched off for the whole visit, silently. Build the sound when the app loads if you like, '
      + 'but start it on the first tap or key press.');
  }
  const woke = probe.runningAfter > 0;
  return check('audio-gated', true, 'must',
    `The app waited for a gesture before starting its sound${woke ? ', and the sound came on when the page was pressed' : ' (it stayed off after one press, which is fine if the player starts it from a control)'}. `
    + `The press was: ${pass.gesture}.`);
}

function touchCheck(pass: MainPassMeasurements): AppPlaytestCheck {
  const { mobile } = pass;
  if (mobile.controls === 0) {
    return check('touch-targets', true, 'must',
      'The app draws no buttons or links of its own on a phone, so there is nothing here to measure. Anything drawn inside the canvas is yours to size.');
  }
  if (mobile.small === 0) {
    return check('touch-targets', true, 'must',
      `All ${mobile.controls} control(s) on a 390 px phone screen are at least ${TOUCH_MIN_PX} px across, so a thumb can hit them.`);
  }
  return check('touch-targets', false, 'must',
    `${mobile.small} of ${mobile.controls} control(s) are smaller than ${TOUCH_MIN_PX} px on a 390 px phone screen, starting with ${mobile.worst}. `
    + 'A thumb misses those. Give them padding, or a minimum height and width.');
}

function saveCheck(pass: MainPassMeasurements, html: string): AppPlaytestCheck {
  const declared = pass.save.declared || (/<meta\b[^>]*name\s*=\s*["']aimeat-scopes["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(html.slice(0, 65536))?.[1] ?? '');
  const canWrite = /memory:write/i.test(declared);
  const loads = pass.save.library || /aimeat-data\.js/i.test(html);
  if (loads && canWrite) {
    return check('saves', true, 'info', `The app can keep a player's progress: it loads the platform data library and asks for "${declared.trim()}" when someone signs in.`);
  }
  if (loads) {
    return check('saves', true, 'info',
      'The app loads the platform data library but never asks to write anything when someone signs in, so it can read a saved game and not save one. '
      + 'Add memory:write to the list in the head if progress is meant to survive a reload.');
  }
  return check('saves', true, 'info',
    'Nothing this app draws survives a reload: it does not load the platform data library, so there is no saved game. That is fine for a toy and a gap for anything with progress.');
}

function reducedMotionCheck(record: PassRecord, ran: boolean): AppPlaytestCheck {
  if (!ran) {
    return check('reduced-motion', false, 'must',
      `Opening the app with reduced motion asked for did not finish: ${record.errors.join(' · ') || 'no reason given'}.`);
  }
  if (record.errorCount === 0) {
    return check('reduced-motion', true, 'must', 'Opened again with reduced motion asked for, the app started without a single error.');
  }
  return check('reduced-motion', false, 'must',
    `With reduced motion asked for, the app threw ${record.errorCount} error(s): ${record.errors.join(' · ')}. `
    + 'That branch runs for the players least likely to tell you about it.');
}

// ── The audit door's bundle ─────────────────────────────────────────────────────────────────────

export interface AppPlaytestBundle {
  /** What the bytes say, the same check every publish runs. */
  artifact: AppArtifactLintResult;
  /** What the browser saw. */
  playtest: AppPlaytestResult;
}

/**
 * The static check on the published bytes, then the playtest of the same bytes: what every door
 * that offers a playtest returns, so the answer does not depend on which door was used.
 */
export async function auditAppWithPlaytest(
  storage: Storage, config: AimeatConfig, app: PlaytestTarget,
): Promise<AppPlaytestBundle | null> {
  const record = await storage.getAppByOwnerName(app.ownerName, app.filename);
  if (!record?.data) return null;
  const html = Buffer.from(record.data).toString('utf8');
  const artifact = await lintAppArtifact(html, config);
  const playtest = await runAppPlaytest(storage, config, app.ownerName, app.filename, { html });
  return { artifact, playtest };
}
