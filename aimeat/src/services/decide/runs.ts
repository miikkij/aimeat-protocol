/**
 * @file src/services/decide/runs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One decision asked of many records, built once so no app builds it again (TARGET-080).
 *
 *   TypeSafe has no batch endpoint, no job queue and no bulk evaluation: a run over an organism's
 *   documents is N separate requests. Every app that wanted one would otherwise write its own loop,
 *   and each would get the same three things wrong: too many requests at once (a cookbook of theirs
 *   hit the limit at eight workers on a shared key), a retry storm on 429, and a run that dies halfway
 *   and starts again from the first record.
 *
 *   SO: a run is a record, `decide.runs.<id>`, holding the questions, the items and a result per item.
 *   It returns a handle at once and works in the background with at most `decideConcurrency` requests
 *   open. Every item goes through decideForOwner(), so each is scrubbed, metered and recorded exactly
 *   as a single decision is. Progress is written as it goes, so a run the process lost (a restart)
 *   reads as `interrupted` and `resume` carries on from the first item without a result.
 *
 *   WHERE THE ITEMS COME FROM. `items` (the caller sends each state), `keys` (the owner's memory
 *   records, each value one state) or `prefix` (every owner record under it). A memory value is often
 *   a collection rather than one thing, so `items` is the general form and the other two are
 *   conveniences. `fields` narrows each state to the named top-level fields: the model's accuracy
 *   falls as unrelated content grows, and the cost is in the state.
 *
 *   THE KEY CEILING. One record per run, and only the newest RUNS_KEPT per owner are kept, so a
 *   scheduled run every day does not fill the owner's 1000 keys in three years.
 * @structure
 *   startDecideRun · getDecideRun · resumeDecideRun · stopDecideRun · listDecideRuns
 * @usage
 *   const run = await startDecideRun(storage, config, caller, { questions, keys, fields });
 * @version-history
 *   v1.0.1 — 2026-09-19 — A run records its app under the one name (services/ai-app-id.ts).
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { upsertPrivateRecord } from '../private-record.js';
import { emitChange } from '../event-bus.js';
import { canonicalAiAppId } from '../ai-app-id.js';
import type { JevQuestion } from './limits.js';
import { decideForOwner, type DecideCaller } from './service.js';
import { DecideError } from './errors.js';
import { Semaphore } from './pacer.js';

const RUN_PREFIX = 'decide.runs.';
const RUNS_KEPT = 50;
const MAX_ITEMS = 1000;
const MAX_RATE_RETRIES = 5;
const SAVE_EVERY = 10;

export type RunState = 'running' | 'done' | 'stopped' | 'interrupted';

export interface RunItem { subject: string; state?: unknown }
export interface RunResult {
  decision_id?: string;
  /** One value per question: the choice, the score, or the yes-probability. The record has the rest. */
  values?: Record<string, number | string>;
  cached?: boolean;
  error?: { code: string; message: string };
}
export interface DecideRun {
  id: string;
  state: RunState;
  questions: Record<string, JevQuestion>;
  /** Items the caller sent carry their state; key items are read when their turn comes. */
  items: RunItem[];
  source: 'items' | 'keys' | 'prefix';
  fields: string[] | null;
  gates: string | null;
  thresholds: Record<string, unknown> | null;
  names: string[];
  results: Record<string, RunResult>;
  counts: { total: number; done: number; failed: number; pending: number };
  cost_usd: number;
  principal: string;
  app_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StartRunInput {
  questions: Record<string, JevQuestion>;
  items?: RunItem[];
  keys?: string[];
  prefix?: string;
  fields?: string[];
  gates?: string;
  thresholds?: Record<string, unknown>;
  names?: string[];
}

/** Runs this process is working on right now, by id, with the flag that stops them. */
const active = new Map<string, { stop: boolean }>();

// Named for this module: the workflow store exports a `runKey` too, and a scanner that resolves
// builders by name read this one as the workflows prefix.
const decideRunKey = (id: string) => `${RUN_PREFIX}${id}`;

async function save(storage: Storage, owner: string, run: DecideRun): Promise<void> {
  run.updated_at = new Date().toISOString();
  const done = Object.values(run.results).filter(r => r.decision_id).length;
  const failed = Object.values(run.results).filter(r => r.error).length;
  run.counts = { total: run.items.length, done, failed, pending: run.items.length - done - failed };
  await upsertPrivateRecord(storage, owner, decideRunKey(run.id), run, ['decide', 'run']);
  emitChange('ai-decisions', owner);
}

function project(value: unknown, fields: string[] | null): unknown {
  if (!fields || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const o = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter(f => f in o).map(f => [f, o[f]]));
}

/** Keep the newest RUNS_KEPT runs; a finished older one is deleted. A running one is never touched. */
async function pruneRuns(storage: Storage, owner: string): Promise<void> {
  const runs = await storage.listMemoryMeta(owner, { prefix: RUN_PREFIX });
  if (runs.length <= RUNS_KEPT) return;
  const old = [...runs].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(RUNS_KEPT);
  for (const r of old) {
    const id = r.key.slice(RUN_PREFIX.length);
    if (!active.has(id)) await storage.deleteMemory(owner, r.key);
  }
}

async function work(storage: Storage, config: AimeatConfig, caller: DecideCaller, run: DecideRun): Promise<void> {
  const flag = { stop: false };
  active.set(run.id, flag);
  const gate = new Semaphore(config.decideConcurrency);
  let sinceSave = 0;
  const pending = run.items.filter(i => !run.results[i.subject]?.decision_id);

  const one = async (item: RunItem): Promise<void> => {
    if (flag.stop) return;
    let state = item.state;
    if (run.source !== 'items') {
      const rec = await storage.getMemory(caller.gaii, item.subject);
      if (!rec) {
        run.results[item.subject] = { error: { code: 'NOT_FOUND', message: 'The record is gone.' } };
        return;
      }
      state = rec.value;
    }
    for (let attempt = 0; ; attempt++) {
      if (flag.stop) return;
      try {
        const r = await decideForOwner(storage, config, caller, {
          state: project(state, run.fields), questions: run.questions, subject: item.subject,
          ...(run.gates ? { gates: run.gates } : {}),
          ...(run.thresholds ? { thresholds: run.thresholds } : {}),
          ...(run.names.length ? { names: run.names } : {}),
        });
        run.results[item.subject] = {
          decision_id: r.decision_id, cached: r.cached,
          values: Object.fromEntries(Object.entries(r.answers).map(([q, a]) => [q, a.value])),
        };
        run.cost_usd += r.usage.cost_usd;
        return;
      } catch (e) {
        const de = e as DecideError & { status?: number; code?: string; details?: { retry_after_ms?: number } };
        // A rate limit is a wait, not a failure. Everything else is this item's answer.
        if (de.code === 'RATE_LIMITED' && attempt < MAX_RATE_RETRIES) {
          await new Promise(r => setTimeout(r, Math.min(60_000, de.details?.retry_after_ms ?? 5_000)));
          continue;
        }
        // A run that has run out of money or been switched off stops: every next item would fail the same way.
        if (['QUOTA_EXHAUSTED', 'APP_QUOTA_EXHAUSTED', 'DECIDE_DISABLED', 'NO_API_KEY', 'INVALID_API_KEY', 'DATAMAP_REQUIRED'].includes(de.code ?? '')) {
          flag.stop = true;
        }
        run.results[item.subject] = { error: { code: de.code ?? 'ERROR', message: (e as Error).message } };
        return;
      }
    }
  };

  try {
    await Promise.all(pending.map(item => gate.run(async () => {
      await one(item);
      if (++sinceSave >= SAVE_EVERY) {
        sinceSave = 0;
        await save(storage, caller.gaii, run).catch(err =>
          logger.warn('[decide] run progress save failed; it is saved again at the end', { id: run.id, error: String(err) }));
      }
    })));
    run.state = flag.stop && run.items.some(i => !run.results[i.subject]) ? 'stopped' : 'done';
  } catch (err) {
    run.state = 'interrupted';
    logger.error('[decide] run failed', { id: run.id, error: String(err) });
  } finally {
    active.delete(run.id);
    await save(storage, caller.gaii, run).catch(err =>
      logger.error('[decide] run final save failed', { id: run.id, error: String(err) }));
  }
}

function validateInput(input: StartRunInput): void {
  const sources = [input.items, input.keys, input.prefix].filter(s => s !== undefined).length;
  if (sources !== 1) {
    throw new DecideError('INVALID_BODY', 400, 'Give exactly one of items, keys or prefix.');
  }
  if (input.fields !== undefined && (!Array.isArray(input.fields) || input.fields.some(f => typeof f !== 'string'))) {
    throw new DecideError('INVALID_BODY', 400, 'fields must be a list of field names.');
  }
}

/** Start a run. Returns the run record at once; the work continues in the background. */
export async function startDecideRun(
  storage: Storage, config: AimeatConfig, caller: DecideCaller, input: StartRunInput,
): Promise<DecideRun> {
  if (!config.decideEnabled) {
    throw new DecideError('DECIDE_DISABLED', 503, 'The operator has turned the decision model off on this node.');
  }
  validateInput(input);
  let items: RunItem[];
  let source: DecideRun['source'];
  if (input.items) {
    if (!Array.isArray(input.items) || input.items.some(i => !i || typeof i.subject !== 'string' || !i.subject)) {
      throw new DecideError('INVALID_BODY', 400, 'items must be a list of { subject, state }, each with its own subject.');
    }
    items = input.items.map(i => ({ subject: i.subject.slice(0, 500), state: i.state }));
    source = 'items';
  } else if (input.keys) {
    if (!Array.isArray(input.keys) || input.keys.some(k => typeof k !== 'string' || !k)) {
      throw new DecideError('INVALID_BODY', 400, 'keys must be a list of memory keys.');
    }
    items = [...new Set(input.keys)].map(k => ({ subject: k }));
    source = 'keys';
  } else {
    if (typeof input.prefix !== 'string' || input.prefix.length < 2 || input.prefix.startsWith('decide.')) {
      throw new DecideError('INVALID_BODY', 400, 'prefix must name a key prefix of your own records.');
    }
    const meta = await storage.listMemoryMeta(caller.gaii, { prefix: input.prefix });
    items = meta.map(m => ({ subject: m.key }));
    source = 'prefix';
  }
  if (items.length === 0) throw new DecideError('INVALID_BODY', 400, 'There is nothing to decide: no items.');
  if (new Set(items.map(i => i.subject)).size !== items.length) {
    throw new DecideError('INVALID_BODY', 400, 'Two items share a subject. Each item needs its own.');
  }
  if (items.length > MAX_ITEMS) {
    throw new DecideError('TOO_MANY_ITEMS', 400, `A run takes at most ${MAX_ITEMS} items; this one has ${items.length}. Split it.`);
  }

  const now = new Date().toISOString();
  const run: DecideRun = {
    id: randomUUID(), state: 'running', questions: input.questions, items, source,
    fields: input.fields ?? null, gates: input.gates ?? null, thresholds: input.thresholds ?? null,
    names: input.names ?? [], results: {},
    counts: { total: items.length, done: 0, failed: 0, pending: items.length },
    cost_usd: 0, principal: caller.principal, app_id: canonicalAiAppId(caller.appId, caller.gaii) ?? null, created_at: now, updated_at: now,
  };
  await save(storage, caller.gaii, run);
  await pruneRuns(storage, caller.gaii).catch(err =>
    logger.warn('[decide] run prune failed', { owner: caller.gaii, error: String(err) }));
  void work(storage, config, caller, run);
  return run;
}

/** One run as stored. A `running` run this process is not working on reads as `interrupted`. */
export async function getDecideRun(storage: Storage, owner: string, id: string): Promise<DecideRun | null> {
  const rec = await storage.getMemory(owner, decideRunKey(id));
  const run = rec?.value as DecideRun | undefined;
  if (!run || typeof run !== 'object') return null;
  if (run.state === 'running' && !active.has(id)) run.state = 'interrupted';
  return run;
}

export type RunSummary = Omit<DecideRun, 'items' | 'results' | 'questions'>;

/** A run without its per-item results and its questions: what a start, a stop or a list answers. */
export function runSummary(run: DecideRun): RunSummary {
  const copy: Partial<DecideRun> = { ...run };
  delete copy.items;
  delete copy.results;
  delete copy.questions;
  return copy as RunSummary;
}

export async function listDecideRuns(storage: Storage, owner: string): Promise<RunSummary[]> {
  const recs = await storage.listMemory(owner, { prefix: RUN_PREFIX });
  return recs
    .map(r => r.value as DecideRun)
    .filter(r => r && typeof r === 'object' && typeof r.id === 'string')
    .map(r => ({ ...runSummary(r), state: r.state === 'running' && !active.has(r.id) ? 'interrupted' as const : r.state }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Carry on from the first item without a result. The caller's current rights apply, not the old ones. */
export async function resumeDecideRun(
  storage: Storage, config: AimeatConfig, caller: DecideCaller, id: string,
): Promise<DecideRun | null> {
  const run = await getDecideRun(storage, caller.gaii, id);
  if (!run) return null;
  if (active.has(id)) return run;
  if (run.state === 'done') return run;
  // Failed items get another chance too: the reason they failed (money, a key) may be fixed now.
  for (const [k, r] of Object.entries(run.results)) if (r.error) delete run.results[k];
  run.state = 'running';
  await save(storage, caller.gaii, run);
  void work(storage, config, caller, run);
  return run;
}

/** Stop a run after the requests already open finish. What was decided stays decided and recorded. */
export async function stopDecideRun(storage: Storage, owner: string, id: string): Promise<DecideRun | null> {
  const flag = active.get(id);
  if (flag) flag.stop = true;
  return getDecideRun(storage, owner, id);
}
