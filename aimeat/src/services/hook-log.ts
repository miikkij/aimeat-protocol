/**
 * @file hook-log.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every call a hook made, and what came back.
 *
 *   WHY THIS EXISTS. A gate hook refuses a registration when the address it calls does not answer,
 *   and until this file nothing recorded that anywhere a person could read: services/hooks.ts wrote
 *   a line to the server log and returned. Nine people turned away at the door looked exactly like
 *   nine people not bothering to sign up, and an operator staring at the Hooks page saw eleven rows
 *   of "none". A gate that fails quietly is worse than no gate.
 *
 *   ONE MEMORY RECORD holding the newest 200 calls, not one record per call. The shape rule this
 *   project measured the hard way: a key per call would reach the 1000-key ceiling in a week and buy
 *   nothing, because nobody wants call 4000 — they want the last few and whether any of them
 *   refused something. Private, under the node's own `__site__` identity rather than any person's:
 *   this is operational state, not somebody's knowledge, and it must not appear in an owner's own
 *   memory listing.
 *
 *   WRITES ARE SERIALIZED IN THIS PROCESS. Appending is read-modify-write on one record, and two
 *   registrations landing at once would otherwise lose a row. The chain below queues them, which
 *   closes it for a single node; two nodes sharing one database would still race, and the cost of
 *   that race is a lost log row rather than a lost hook.
 *
 *   NEVER IN THE WAY. Recording a call must not be able to change one: every failure here is one
 *   warning and nothing else.
 *
 * @structure
 *   - HookRun                       — one call: when, which moment, what was called, what answered
 *   - recordHookRun(storage, run)   — append, keeping the newest HOOK_RUNS_KEPT
 *   - readHookRuns(storage)         — newest first
 * @usage
 *   await recordHookRun(storage, { at, hook, actionRef, answer: 'ok', status: 200, ms: 240, allowed: true });
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** The node's own identity for operational records, shared with services/site.ts. */
const SITE_OWNER_GAII = '__site__';
const KEY = 'site/hook-runs';
/** How many calls the record keeps. */
export const HOOK_RUNS_KEPT = 200;

/** What came back from the address, as one word an operator can scan a column of. */
export type HookAnswer =
  /** 2xx, and the body did not say `allowed: false`. */
  | 'ok'
  /** The address answered and said no: a non-2xx status, or `{"allowed": false}`. */
  | 'refused'
  /** Nothing came back within the time allowed, or the request could not be made at all. */
  | 'no_answer'
  /** The bound action carries no address, so there was nothing to call. */
  | 'no_address'
  /** The bound action is not published on this node any more. */
  | 'missing';

export interface HookRun {
  /** ISO timestamp of the call. */
  at: string;
  /** Which moment fired. */
  hook: string;
  /** What was bound, as the operator wrote it. */
  actionRef: string;
  /** The action's display name when it is still published, for a row a person can read. */
  actionName?: string;
  answer: HookAnswer;
  /** The HTTP status, when there was one. */
  status: number | null;
  /** How long the call took, in milliseconds. */
  ms: number;
  /** Whether this call let the thing through. A notify hook is always true: it cannot stop anything. */
  allowed: boolean;
  /**
   * What the thing WAS, in a few words: the name being registered, the board being posted to. Short
   * and drawn from the hook's own context, so a refusal names who was turned away.
   */
  subject?: string;
  /** The reason the address gave, when it gave one. */
  reason?: string;
}

/** Appends are queued so two hooks firing at once cannot lose each other's row. */
let chain: Promise<void> = Promise.resolve();

export async function readHookRuns(storage: Storage): Promise<HookRun[]> {
  const record = await storage.getMemory(SITE_OWNER_GAII, KEY);
  if (!record) return [];
  // A memory value is `unknown` by contract, and a provider is free to hand back the object or the
  // string it stored. Both shapes are read rather than assuming one.
  const raw: unknown = typeof record.value === 'string' ? safeParse(record.value) : record.value;
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { runs?: unknown }).runs;
  if (!Array.isArray(list)) return [];
  const runs: HookRun[] = [];
  for (const item of list) {
    const run = asRun(item);
    if (run) runs.push(run);
  }
  return runs.slice(0, HOOK_RUNS_KEPT);
}

export async function recordHookRun(storage: Storage, run: HookRun): Promise<void> {
  chain = chain.then(async () => {
    const previous = await readHookRuns(storage);
    const runs = [run, ...previous].slice(0, HOOK_RUNS_KEPT);
    const now = new Date().toISOString();
    await storage.setMemory({
      key: KEY,
      ownerGaii: SITE_OWNER_GAII,
      value: { runs },
      visibility: 'private',
      tags: ['site', 'hooks'],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }).catch((err: unknown) => {
    // The call already happened and its outcome already decided what it decided. A log that cannot
    // be written must not turn a working hook into a failed request.
    logger.warn('hook-log: a hook ran but its outcome was not recorded', { error: String(err) });
  });
  await chain;
}

const ANSWERS: HookAnswer[] = ['ok', 'refused', 'no_answer', 'no_address', 'missing'];

/** One stored entry as a run, or null when it is not one. */
function asRun(raw: unknown): HookRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<HookRun>;
  if (typeof r.at !== 'string' || typeof r.hook !== 'string') return null;
  return {
    at: r.at,
    hook: r.hook,
    actionRef: typeof r.actionRef === 'string' ? r.actionRef : '',
    ...(typeof r.actionName === 'string' ? { actionName: r.actionName } : {}),
    answer: ANSWERS.includes(r.answer as HookAnswer) ? (r.answer as HookAnswer) : 'ok',
    status: typeof r.status === 'number' ? r.status : null,
    ms: typeof r.ms === 'number' ? r.ms : 0,
    allowed: r.allowed !== false,
    ...(typeof r.subject === 'string' ? { subject: r.subject } : {}),
    ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
  };
}

/** Parse, or nothing. A corrupt log must not turn "where do my hooks stand" into a 500. */
function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (err) {
    logger.warn('hook-log: the record is not valid JSON; reporting no calls', { error: String(err) });
    return null;
  }
}
