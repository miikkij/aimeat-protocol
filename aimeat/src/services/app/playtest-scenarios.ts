/**
 * @file src/services/app/playtest-scenarios.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Run the builder's own scenarios (services/app/scenarios.ts) on a published app in the
 *   node's headless browser: each scenario at every size of the one size matrix and in both themes,
 *   signed in as a throwaway member (services/app/playtest-member.ts) unless it says otherwise. Every
 *   run of one size and theme has a member of its own, so each starts from an account that holds
 *   nothing: with one member for the whole run, a scenario that began from the app's empty state
 *   passed at the first size and failed at the seven after it, on what the first had saved. The
 *   answer is pass or fail per scenario and per size and theme, the step that failed, the console
 *   errors and the node's own failed answers, and for every scenario that passed everywhere one
 *   evidence line per criterion it names, ready for criteria_set.
 *
 *   THE NETWORK. The page is served from the stored bytes and every request still goes through the
 *   headless guard (services/headless/network.ts): no private address, only GET and HEAD to the
 *   world, nothing of anybody's sent along. A signed-in run adds one route in front of it, for the
 *   node's own `/v1/` addresses only (every address the node answers on): every method, the body, and
 *   the member's token. It also answers the two sign-in calls a page makes, the silent bridge and the
 *   cookie refresh, with the member's grant and token, so the page signs in the way an app does. The
 *   token is a throwaway account's, for this one app, valid for minutes, and the account is erased
 *   when the run ends, so a page that leaks it leaks nothing.
 *
 *   THE BOUNDS. One browser for the run with RUNS_AT_ONCE pages in it at a time, at most
 *   SCENARIOS_MAX scenarios and SCENARIO_STEPS_MAX steps each, a step waits at most 5 s, and the
 *   whole run stops at RUN_DEADLINE_MS: what did not run is named as not run, never as passed, and
 *   what did run is still answered. The deadline is what an MCP client's wait leaves: a client that
 *   waits 60 seconds for a tool got no answer at all from a run that was allowed 170.
 * @structure runAppScenarios(storage, config, app, scenarios, opts) · ScenarioRunResult
 * @version-history
 *   v1.2.0 — 2026-11-27 — Two stages: the phone and the desktop in the light theme first, and the
 *     other six runs only for a scenario that passed them. The answer says which runs were left
 *     for that reason, apart from the ones the deadline left. `deadlineMs` is the caller's.
 *   v1.1.0 — 2026-11-27 — A member per run of one size and theme, four runs at a time, and a
 *     deadline of 35 seconds with the finished runs answered when it passes
 *     (wish-rakentajan-skenaarioajo-vastaa-mcp-kutsun-aikana-ja-jokainen). Measured on five builds
 *     that day: every audit of an app with scenarios ended in the client's 60-second timeout.
 *   v1.0.0 — 2026-11-26 — Initial (wish-builder-scenarios-in-the-playtest-signed-in-four-widths-both).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { safeFetch } from '../../utils/url-validator.js';
import { readBodyCapped } from '../../utils/read-capped.js';
import { parseAppScopes } from '../protected-resource.js';
import { MAX_RESOURCE_BYTES, serveDocumentOnce, type HeadlessRoute } from '../headless/network.js';
import { HeadlessDeadlineError, NO_HEADLESS_BROWSER, withHeadlessContext, type HeadlessBrowser } from '../screenshot-capture.js';
import { makePlaytestMember, type PlaytestMember } from './playtest-member.js';
import { SCENARIO_SIZES, SCENARIO_THEMES, type AppScenario, type ScenarioStep } from './scenarios.js';

/**
 * The whole run when the caller names no deadline: launch, every scenario at every size and theme,
 * and the close. An MCP client waits 60 seconds for a tool's answer, and the audit's own playtest
 * (10 to 17 seconds, measured) runs before this, so a run that is waited for has to end inside that
 * minute. The audit starts its run in the background with a longer deadline (scenario-run.ts).
 */
const RUN_DEADLINE_MS = 35_000;
/** Runs of one size and theme in the browser at the same time. */
const RUNS_AT_ONCE = 4;
/**
 * How many sizes of the matrix, in the light theme, a scenario runs at first: the phone and the
 * desktop. Only a scenario that passes those runs at the other sizes and in the dark theme. Measured
 * on five builds on 2026-11-27: with every scenario run at all eight each time, the builders spent
 * about ten minutes a build on runs of scenarios they were still correcting.
 */
const FIRST_SIZES = 2;
const STEP_DEFAULT_MS = 3000;
const BOOT_SETTLE_MS = 800;
const MAX_QUOTED = 5;

export interface ScenarioRun {
  size: string;
  theme: 'light' | 'dark';
  ok: boolean;
  /** The step that failed: its index, what it did and what the browser said. */
  failed_step?: { index: number; do: string; target?: string; error: string };
  console_errors: string[];
  /** The node's own answers of 400 or more, `status path`. */
  bad_responses: string[];
}

export interface ScenarioResult {
  id: string;
  name: string;
  criteria: string[];
  signed_in: boolean;
  /** Passed at every size and theme it ran at, and ran at all of them. */
  ok: boolean;
  runs: ScenarioRun[];
  /** Sizes and themes the deadline left unrun. */
  not_run: string[];
}

export interface ScenarioRunResult {
  ran: boolean;
  reason?: string;
  /** How the signed-in scenarios signed in, or why they ran signed out. */
  member: string;
  scenarios: ScenarioResult[];
  /** One line per criterion a scenario that passed everywhere names, for criteria_set. */
  criteria_evidence: Array<{ id: string; evidence: string }>;
}

/** A Playwright route with the request's body, which the member route forwards. */
interface MemberRouteArg {
  request(): { url(): string; method(): string; resourceType(): string; headers(): Record<string, string>; postDataBuffer(): Buffer | null };
  fulfill: HeadlessRoute['fulfill'];
  abort: HeadlessRoute['abort'];
  fallback: HeadlessRoute['fallback'];
}

/** The slice of a Playwright page and locator the runner uses. */
interface ScenarioLocator {
  first(): ScenarioLocator;
  click(o: { timeout: number }): Promise<void>;
  fill(v: string, o: { timeout: number }): Promise<void>;
  press(k: string, o: { timeout: number }): Promise<void>;
  waitFor(o: { state: 'visible' | 'hidden'; timeout: number }): Promise<void>;
}
interface ScenarioPage {
  goto(url: string, o: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  addInitScript(o: { content: string }): Promise<void>;
  route(match: string, handler: (route: MemberRouteArg) => unknown): Promise<void>;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  emulateMedia(o: { colorScheme: 'light' | 'dark' }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  locator(sel: string): ScenarioLocator;
  getByText(t: string): ScenarioLocator;
  on(ev: string, fn: (arg: never) => void): void;
  close(): Promise<void>;
}


/**
 * The route a signed-in run puts in front of the guard: the node's own `/v1/` addresses get the
 * member's token, the method and the body; everything else falls through to the guard unchanged.
 */
function memberRoute(config: AimeatConfig, member: PlaytestMember) {
  const token = member.token;
  const loopback = `http://127.0.0.1:${config.port}`;
  // Every address the node answers on, as the guard reads them: the libraries call the node at its
  // configured base address, which is seldom the loopback the page was opened on.
  const own = [loopback, `http://localhost:${config.port}`, `http://[::1]:${config.port}`];
  if (URL.canParse(config.baseUrl)) own.push(new URL(config.baseUrl).origin);
  return async (route: MemberRouteArg) => {
    const req = route.request();
    const url = URL.canParse(req.url()) ? new URL(req.url()) : null;
    if (!url || !own.includes(url.origin) || !url.pathname.startsWith('/v1/') || req.resourceType() === 'document') {
      await route.fallback();
      return;
    }
    // The page is served from the loopback, which the auth library reads as an app on an origin of
    // its own, so it signs in through the silent bridge (/v1/auth/app-grant-silent, routes/app-grants.ts),
    // and a session on the node's own origin refreshes through the httpOnly cookie. A throwaway run
    // has no cookie for either: both are answered here with the member's own grant and token, in the
    // shapes those routes answer.
    const json = (data: Record<string, unknown>) => route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, data }) });
    if (url.pathname === '/v1/auth/app-grant-silent') {
      await json({ ok: true, access_token: token, expires_in: member.ttlSeconds, scope: member.scopes.join(' '), grant_id: member.grantId, app: member.app, own: false, display_name: 'Playtest member' });
      return;
    }
    if (url.pathname === '/v1/auth/refresh') {
      await json({ token });
      return;
    }
    try {
      const h = req.headers();
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      for (const name of ['accept', 'content-type']) if (h[name]) headers[name] = h[name];
      const method = req.method().toUpperCase();
      const raw = method === 'GET' || method === 'HEAD' ? null : req.postDataBuffer();
      const resp = await safeFetch(`${loopback}${url.pathname}${url.search}`, {
        method, headers, ...(raw ? { body: new Uint8Array(raw) } : {}),
        allowOrigins: [loopback], sensitiveHeaders: ['authorization'], signal: AbortSignal.timeout(15_000),
      });
      const data = method === 'HEAD' ? Buffer.alloc(0) : await readBodyCapped(resp, MAX_RESOURCE_BYTES);
      if (data === null) { await route.abort('failed'); return; }
      const ct = resp.headers.get('content-type');
      await route.fulfill({ status: resp.status, ...(ct ? { headers: { 'content-type': ct } } : {}), body: data });
    } catch (err) {
      logger.debug('playtest scenario: a member request failed', { url: req.url().slice(0, 200), error: String(err) });
      await route.abort('failed').catch((e: unknown) => logger.debug('playtest scenario: abort failed', { error: String(e) }));
    }
  };
}

/** Run one step; throws with the browser's sentence when it fails. */
async function runStep(page: ScenarioPage, step: ScenarioStep): Promise<void> {
  const timeout = step.ms ?? STEP_DEFAULT_MS;
  const at = () => page.locator(step.target as string).first();
  switch (step.do) {
    case 'click': return at().click({ timeout });
    case 'fill': return at().fill(step.value ?? '', { timeout });
    case 'press': return at().press(step.value ?? 'Enter', { timeout });
    case 'wait': return page.waitForTimeout(Math.min(5000, step.ms ?? 500));
    case 'expect_text': return page.getByText(step.value ?? '').first().waitFor({ state: 'visible', timeout });
    case 'expect_visible': return at().waitFor({ state: 'visible', timeout });
    case 'expect_absent': return at().waitFor({ state: 'hidden', timeout });
  }
}

/** One scenario at one size and theme, in a fresh page of the run's context. */
async function runOnce(
  ctx: { newPage(): Promise<unknown> }, config: AimeatConfig, html: string, url: string, origin: string,
  scenario: AppScenario, size: { width: number; height: number }, theme: 'light' | 'dark', member: PlaytestMember | null,
): Promise<ScenarioRun> {
  const run: ScenarioRun = { size: `${size.width}x${size.height}`, theme, ok: false, console_errors: [], bad_responses: [] };
  const page = await ctx.newPage() as ScenarioPage;
  try {
    page.on('console', ((m: { type(): string; text(): string }) => {
      if (m.type() === 'error' && run.console_errors.length < MAX_QUOTED) run.console_errors.push(m.text().slice(0, 240));
    }) as (arg: never) => void);
    page.on('pageerror', ((e: Error) => {
      if (run.console_errors.length < MAX_QUOTED) run.console_errors.push(String(e?.message ?? e).slice(0, 240));
    }) as (arg: never) => void);
    page.on('response', ((r: { status(): number; url(): string }) => {
      if (r.status() >= 400 && r.url().startsWith(origin) && run.bad_responses.length < MAX_QUOTED) run.bad_responses.push(`${r.status()} ${r.url().slice(origin.length)}`);
    }) as (arg: never) => void);
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: theme });
    // A signed-in run signs in the way an app does, through the silent bridge the member route answers.
    if (member && scenario.signed_in) await page.route('**/*', memberRoute(config, member));
    // Registered last, so it answers first: the document is the stored bytes.
    await serveDocumentOnce(page as never, html);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(BOOT_SETTLE_MS);
    for (const [index, step] of scenario.steps.entries()) {
      try {
        await runStep(page, step);
      } catch (err) {
        run.failed_step = { index, do: step.do, ...(step.target ? { target: step.target } : {}), error: String((err as Error)?.message ?? err).split('\n')[0].slice(0, 300) };
        return run;
      }
    }
    run.ok = true;
    return run;
  } finally {
    await page.close().catch((e: unknown) => logger.debug('playtest scenario: page close failed', { error: String(e) }));
  }
}

/**
 * Every scenario of the app at every size and theme. `app` is the published app as stored; nothing is
 * written except the throwaway member, which is erased before this answers.
 */
export async function runAppScenarios(
  storage: Storage, config: AimeatConfig,
  app: { ownerName: string; filename: string; html: string; appName: string },
  scenarios: readonly AppScenario[],
  opts: { launch?: () => Promise<HeadlessBrowser | null>; now?: () => number; deadlineMs?: number } = {},
): Promise<ScenarioRunResult> {
  const origin = `http://127.0.0.1:${config.port}`;
  const url = `${origin}/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}?mode=inline`;
  const now = opts.now ?? Date.now;
  const deadlineMs = Math.max(10_000, opts.deadlineMs ?? RUN_DEADLINE_MS);
  const needsMember = scenarios.some(s => s.signed_in);
  const memberOf = { id: `${app.ownerName}/${app.filename}`, name: app.appName, origin, scopes: parseAppScopes(app.html) };
  // Every member a run made, so each is erased whichever way the run ends.
  const made: PlaytestMember[] = [];
  // The first member says whether this node can make one at all; the first signed-in run uses it.
  let spare: PlaytestMember | null = null;
  let canSignIn = false;
  let memberLine = 'No scenario asks to be signed in.';
  if (needsMember) {
    const first = await makePlaytestMember(storage, config, memberOf);
    if ('reason' in first) memberLine = first.reason;
    else {
      spare = first; made.push(first); canSignIn = true;
      memberLine = 'Each run signed in as a throwaway member account of its own, made for that run and erased after it.';
    }
  }
  /** A member nobody has used: each run starts from an account that holds nothing. */
  const freshMember = async (): Promise<PlaytestMember | null> => {
    if (spare) { const m = spare; spare = null; return m; }
    const next = await makePlaytestMember(storage, config, memberOf);
    if ('reason' in next) return null;
    made.push(next);
    return next;
  };
  const results: ScenarioResult[] = scenarios.map(s => ({ id: s.id, name: s.name, criteria: s.criteria, signed_in: s.signed_in && canSignIn, ok: false, runs: [], not_run: [] }));
  // One job per scenario, size and theme, in the order the answer lists them.
  const jobs = scenarios.flatMap((scenario, i) => SCENARIO_SIZES.flatMap((size, s) => SCENARIO_THEMES.map((theme, t) => ({
    scenario, i, size, theme, run: null as ScenarioRun | null, skipped: false,
    // FIRST: the phone and the desktop in the light theme. A scenario that fails there is being
    // corrected, and its six other runs would say the same thing six more times.
    first: s < FIRST_SIZES && t === 0,
  }))));
  let cutShort = false;
  try {
    // New runs stop early enough for the ones in the browser to end before the deadline closes it.
    const endsAt = now() + deadlineMs - 8_000;
    const out = await withHeadlessContext(config, SCENARIO_SIZES[0], async (ctx) => {
      const runAll = async (list: typeof jobs): Promise<void> => {
        let next = 0;
        const worker = async (): Promise<void> => {
          for (;;) {
            const job = list[next++];
            if (!job || now() > endsAt) return;
            const member = job.scenario.signed_in && canSignIn ? await freshMember() : null;
            try {
              job.run = await runOnce(ctx, config, app.html, url, origin, job.scenario, job.size, job.theme, member);
            } finally {
              await member?.erase();
            }
          }
        };
        await Promise.all(Array.from({ length: RUNS_AT_ONCE }, worker));
      };
      await runAll(jobs.filter(j => j.first));
      // The other sizes and the dark theme, for the scenarios that passed the first ones.
      const passedFirst = new Set(scenarios.map((_, i) => i).filter(i => jobs.filter(j => j.i === i && j.first).every(j => j.run?.ok)));
      for (const j of jobs) if (!j.first && !passedFirst.has(j.i)) j.skipped = true;
      await runAll(jobs.filter(j => !j.first && !j.skipped));
      return true;
    }, { deadlineMs, ...(opts.launch ? { launch: opts.launch } : {}) });
    if (out === null) return { ran: false, reason: NO_HEADLESS_BROWSER, member: memberLine, scenarios: [], criteria_evidence: [] };
  } catch (err) {
    // The deadline closed the browser under the runs still in it: what finished is answered, and
    // the rest is named as not run. Any other failure is the run's own, and nothing is claimed.
    if (!(err instanceof HeadlessDeadlineError)) {
      return {
        ran: false, reason: `The scenarios did not finish: ${(err as Error)?.message ?? 'unknown error'}.`,
        member: memberLine, scenarios: results, criteria_evidence: [],
      };
    }
    cutShort = true;
  } finally {
    await Promise.all(made.map(m => m.erase()));
  }
  for (const job of jobs) {
    if (job.run) results[job.i].runs.push(job.run);
    else results[job.i].not_run.push(`${job.size.width}x${job.size.height} ${job.theme}`);
  }
  const notRun = results.reduce((n, r) => n + r.not_run.length, 0);
  for (const r of results) r.ok = r.not_run.length === 0 && r.runs.length > 0 && r.runs.every(x => x.ok);
  const evidence: Array<{ id: string; evidence: string }> = [];
  for (const r of results.filter(x => x.ok)) {
    for (const c of r.criteria) {
      evidence.push({ id: c, evidence: `Playtest scenario "${r.id}" passed ${r.signed_in ? 'signed in' : 'signed out'} at ${SCENARIO_SIZES.length} sizes in both themes (${new Date(now()).toISOString().slice(0, 10)}).` });
    }
  }
  // The answer still says what ran. What was left is named, apart by why: a scenario that failed at
  // the first sizes is not run at the others, and a run the deadline left is another matter.
  const skipped = jobs.filter(j => j.skipped).length;
  const late = notRun - skipped;
  const reasons = [
    ...(skipped > 0
      ? [`${skipped} run(s) were not started: their scenario failed at the phone or the desktop size in the light theme, so the other sizes and the dark theme were left until it passes there. Correct what the failed step names and ask again.`]
      : []),
    ...(late > 0
      ? [`${late} run(s) of size and theme did not ${cutShort ? 'finish' : 'start'} within the ${Math.round(deadlineMs / 1000)} seconds a scenario run gets; each is listed under not_run. `
        + 'Fewer scenarios, fewer steps or shorter waits fit: a step that waits for something that never comes costs its whole wait at every size and theme.']
      : []),
  ];
  return { ran: true, ...(reasons.length ? { reason: reasons.join(' ') } : {}), member: memberLine, scenarios: results, criteria_evidence: evidence };
}
