/**
 * @file src/services/app/scenario-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scenario run an audit with a playtest asks for: started once, run on the node
 *   past the caller's wait when it is long, and answered from the note the node keeps of it.
 *
 *   WHY. A builder's own scenarios run at four sizes and in both themes, and a real one takes about
 *   thirty seconds a run: four of them are sixteen minutes of browser time, and four at a time is
 *   still four. An MCP client waits one minute for a tool's answer. Measured on five builds on
 *   2026-11-27: every audit of an app with scenarios ended in the client's timeout, so no builder
 *   got one criterion evidenced by a scenario.
 *
 *   HOW. The first call starts the run and waits INLINE_WAIT_MS for it. A short run ends inside
 *   that wait and is answered in the same call. A longer one goes on, and the answer says it is
 *   running and how to read it: the same call again, which starts nothing while the app's version
 *   and its scenarios are the ones that run was started for. The finished answer is kept in the
 *   design spec record, beside the scenarios it ran (design-spec.ts, `scenarioRun`), so it is read
 *   back after a restart and is deleted with the spec.
 *
 *   NO STATE IN THE PROCESS. Whether a run is under way is read from the note: `running`, started
 *   less than the deadline ago. A node that stops mid-run leaves such a note, and once the deadline
 *   has passed the next call starts the run again.
 * @structure scenarioRunKey · ScenarioRunAnswer · scenarioRunFor
 * @usage
 *   const scenarios = await scenarioRunFor(storage, config, app, list, () => takePlaytestSlot(owner));
 * @version-history
 *   v1.1.0 — 2026-11-27 — With the app's `ownerGaii`, the run keeps a picture per run at the phone
 *     and the desktop size in the owner's files, removes the pictures it did not write, and every
 *     answer names an address per picture (scenario-pictures.ts).
 *   v1.0.0 — 2026-11-27 — Initial (wish-rakentajan-skenaarioajo-vastaa-mcp-kutsun-aikana-ja-jokainen).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { readAppDesignSpec, writeAppScenarioRun, type AppScenarioRunNote } from './design-spec.js';
import { runAppScenarios, type ScenarioRunResult } from './playtest-scenarios.js';
import { keepScenarioPicture, sweepScenarioPictures, withPictureAddresses } from './scenario-pictures.js';
import type { AppScenario } from './scenarios.js';
import type { HeadlessBrowser } from '../screenshot-capture.js';

/** How long the call that starts a run waits for it before it answers "running": the audit's own playtest took up to 17 seconds of the caller's minute before it. */
const INLINE_WAIT_MS = 25_000;
/**
 * How long a later call waits for a run that is under way. Such a call runs no playtest of its own
 * (the one taken at the start is kept with the run), so it has most of the caller's minute. A call
 * that answered "running" at once made five builds ask 17 times for 13 runs.
 */
const READ_WAIT_MS = 45_000;
const READ_EVERY_MS = 2_000;
/** The whole run in the background: ten scenarios of thirty seconds a run, four at a time, and room. */
const BACKGROUND_DEADLINE_MS = 8 * 60_000;
/** A `running` note older than this belongs to a run whose node stopped: the next call starts again. */
const RUNNING_NOTE_MAX_MS = BACKGROUND_DEADLINE_MS + 60_000;

/** What a caller reads: the run's answer, and where the run stands. */
export interface ScenarioRunAnswer extends ScenarioRunResult {
  /** How the pictures are read, when a run has any (scenario-pictures.ts). */
  pictures?: string;
  /** True while the run goes on in the background: `scenarios` is empty and the same call reads it later. */
  running?: boolean;
  /** The criteria the node marked evidenced from this run: no criteria_set is owed for them. */
  criteria_evidenced?: string[];
  /** The app version the run was started for. */
  app_version?: number;
  started_at?: string;
  finished_at?: string;
}

/**
 * The audit's own playtest that was taken when the run of `scenarios` on this version started, when
 * the node has such a run: the audit then answers it and runs no browser of its own.
 */
export async function keptPlaytestFor(
  storage: Storage, app: { ownerName: string; filename: string; appVersion: number }, scenarios: readonly AppScenario[],
): Promise<unknown | undefined> {
  const note = (await readAppDesignSpec(storage, `${app.ownerName}/${app.filename}`))?.scenarioRun;
  return note?.key === scenarioRunKey(app.appVersion, scenarios) ? note.playtest : undefined;
}

/** Names one run: the app's version and the scenarios as they are. A change of either is a new run. */
export function scenarioRunKey(appVersion: number, scenarios: readonly AppScenario[]): string {
  return createHash('sha256').update(JSON.stringify([appVersion, scenarios])).digest('hex').slice(0, 24);
}

const runningAnswer = (note: AppScenarioRunNote): ScenarioRunAnswer => ({
  ran: false, running: true, app_version: note.appVersion, started_at: note.startedAt,
  reason: `The scenarios are running on this node, started ${note.startedAt}. Ask for the audit with the playtest again: `
    + 'the same call waits up to 45 seconds for the run and answers it when it has ended, and starts nothing new while the app\'s version and its scenarios are unchanged.',
  member: 'Not known until the run ends.', scenarios: [], criteria_evidence: [],
});

/**
 * The run of `scenarios` on this version of the app: the finished one when the node has it, the one
 * under way when there is one, and otherwise a new one, waited for briefly. `takeSlot` is the
 * playtest's own limit (services/app/playtest.ts), taken only when a run starts.
 */
export async function scenarioRunFor(
  storage: Storage, config: AimeatConfig,
  app: { ownerName: string; filename: string; html: string; appName: string; appVersion: number; ownerGaii?: string },
  scenarios: readonly AppScenario[],
  takeSlot: () => { release(): void } | { reason: string },
  opts: { launch?: () => Promise<HeadlessBrowser | null>; now?: () => number; inlineWaitMs?: number; readWaitMs?: number; playtest?: unknown } = {},
): Promise<ScenarioRunAnswer> {
  const appId = `${app.ownerName}/${app.filename}`;
  const now = opts.now ?? Date.now;
  const key = scenarioRunKey(app.appVersion, scenarios);
  const ownerGaii = app.ownerGaii;
  // The note keeps each picture's key; the address is made when the answer is, so it is valid from then.
  const addressed = (a: ScenarioRunAnswer): Promise<ScenarioRunAnswer> | ScenarioRunAnswer =>
    (ownerGaii && a.scenarios.length ? withPictureAddresses(storage, config, ownerGaii, a) : a);
  const done = (n: AppScenarioRunNote): Promise<ScenarioRunAnswer> | ScenarioRunAnswer =>
    addressed({ ...(n.result as ScenarioRunResult), app_version: n.appVersion, started_at: n.startedAt, ...(n.finishedAt ? { finished_at: n.finishedAt } : {}) });
  let note = (await readAppDesignSpec(storage, appId))?.scenarioRun;
  if (note?.key === key) {
    if (note.state === 'done' && note.result) return done(note);
    if (note.state === 'running' && now() - Date.parse(note.startedAt) < RUNNING_NOTE_MAX_MS) {
      // The run is under way: wait for it here, so one later call reads the result where three did.
      const until = now() + (opts.readWaitMs ?? READ_WAIT_MS);
      while (now() < until) {
        await new Promise<void>((resolve) => { setTimeout(resolve, READ_EVERY_MS); });
        note = (await readAppDesignSpec(storage, appId))?.scenarioRun;
        if (note?.key !== key) break;
        if (note.state === 'done' && note.result) return done(note);
      }
      if (note?.key === key) return runningAnswer(note);
    }
  }

  const slot = takeSlot();
  if ('reason' in slot) return { ran: false, reason: slot.reason, member: 'Not started.', scenarios: [], criteria_evidence: [] };
  const started: AppScenarioRunNote = {
    key, appVersion: app.appVersion, state: 'running', startedAt: new Date(now()).toISOString(),
    ...(opts.playtest !== undefined ? { playtest: opts.playtest } : {}),
  };
  if (await writeAppScenarioRun(storage, appId, started) === null) {
    slot.release();
    return { ran: false, reason: 'The app has no design spec to keep the run beside: write it with spec_set first.', member: 'Not started.', scenarios: [], criteria_evidence: [] };
  }

  // The run goes on whether or not this call is still waiting for it. Its answer is written to the
  // note it started under, and only there: a newer run's note is never overwritten by an older one.
  const work = runAppScenarios(storage, config, app, scenarios, {
    deadlineMs: BACKGROUND_DEADLINE_MS, ...(opts.launch ? { launch: opts.launch } : {}),
    ...(ownerGaii ? { keepPicture: (p) => keepScenarioPicture(storage, ownerGaii, app.filename, p) } : {}),
  })
    .catch((err: unknown): ScenarioRunResult => ({ ran: false, reason: `The scenarios did not finish: ${(err as Error)?.message ?? 'unknown error'}.`, member: 'Not known.', scenarios: [], criteria_evidence: [] }))
    .then(async (ran) => {
      const finishedAt = new Date(now()).toISOString();
      // The pictures of this run are the app's pictures now: one of a scenario that is gone, or of
      // a size this run did not reach, would be read as this run's.
      if (ownerGaii && ran.ran) {
        const kept = new Set(ran.scenarios.flatMap(s => s.runs.flatMap(r => (r.picture_key ? [r.picture_key] : []))));
        await sweepScenarioPictures(storage, ownerGaii, app.filename, kept);
      }
      // What a scenario proved at every size and theme is written as evidence in the same write as
      // the result: the node saw it, so the builder does not send the whole criteria list back.
      const result: ScenarioRunResult & { criteria_evidenced?: string[] } = { ...ran };
      await writeAppScenarioRun(
        storage, appId,
        (marked) => { if (marked.length) result.criteria_evidenced = marked; return { ...started, state: 'done', finishedAt, result }; },
        { onlyIfKey: key, evidence: ran.criteria_evidence, appVersion: app.appVersion },
      ).catch((err: unknown) => { logger.warn('scenario run: the result was not kept', { app: appId, error: String(err) }); });
      return addressed({ ...result, app_version: app.appVersion, started_at: started.startedAt, finished_at: finishedAt });
    })
    .finally(() => slot.release());

  let timer: NodeJS.Timeout | undefined;
  const waited = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), opts.inlineWaitMs ?? INLINE_WAIT_MS); });
  const first = await Promise.race([work, waited]);
  clearTimeout(timer);
  return first ?? runningAnswer(started);
}
