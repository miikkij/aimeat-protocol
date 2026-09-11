/**
 * @file indexnow-log.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The last few times this node told IndexNow that something changed: when, how many
 *   addresses, on how many hosts, and what the endpoint answered.
 *
 *   ONE memory record, holding the newest five notices, not one record per notice. That is the
 *   shape rule this project measured the hard way: a key written on every publish would reach the
 *   1000-key ceiling inside a year and buy nothing. Five is what an operator reads: the one that
 *   just went out, and enough before it to see whether the answers have changed. Nobody wants the
 *   history beyond that, and the sitemap is the record of what is out there.
 *
 *   Private, and under the node's own `__site__` identity rather than any person's: this is
 *   operational state, not somebody's knowledge, and it must not appear in an owner's own memory
 *   listing.
 *
 * @structure
 *   - readIndexNowRuns(storage)              — the newest notices first, at most five
 *   - readIndexNowLastRun(storage)           — the newest one, or null
 *   - recordIndexNowRun(storage, run)        — add one, dropping the oldest past five
 * @usage
 *   const last = await readIndexNowLastRun(storage);
 * @version-history
 *   v1.1.0 — 2026-09-11 — The record keeps the newest five runs rather than the last one alone, and
 *     a run says how many hosts it reached, which hosts refused, what it covered (one app, the
 *     pages, everything) and who sent it. A record written by v1.0.0 (one flat run) still reads.
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** The node's own identity for operational records, shared with services/site.ts. */
const SITE_OWNER_GAII = '__site__';
const KEY = 'site/indexnow-last-run';
/** How many notices the record keeps. */
export const INDEXNOW_RUNS_KEPT = 5;

/** What one notice covered. */
export type IndexNowScope = 'app' | 'pages' | 'all';

export interface IndexNowRun {
  /** ISO timestamp of the submission. */
  at: string;
  /** How many addresses were sent, over every host. */
  urlCount: number;
  /** How many hosts they were grouped into: one POST each, with that host's own key file. */
  hosts: number;
  /** Every host was accepted (200 or 202). */
  ok: boolean;
  /**
   * What IndexNow answered: the first refusal's status when one host was refused, otherwise the
   * accepted status. Null when a request never completed.
   */
  status: number | null;
  /** The hosts whose batch was refused or never answered. Empty on a clean run. */
  failed: string[];
  /** What the notice covered. Absent on a record written before this field existed. */
  scope?: IndexNowScope;
  /** Who asked for it, for an explicit run; absent when a publish fired it. */
  by?: string;
}

export async function readIndexNowRuns(storage: Storage): Promise<IndexNowRun[]> {
  const record = await storage.getMemory(SITE_OWNER_GAII, KEY);
  if (!record) return [];
  // A memory value is `unknown` by contract, and a provider is free to hand back the object or the
  // string it stored. Both shapes are accepted here rather than assuming one, because the wrong
  // assumption would show an operator "never submitted" on a node that submits every day.
  const raw: unknown = typeof record.value === 'string'
    ? safeParse(record.value)
    : record.value;
  if (!raw || typeof raw !== 'object') return [];
  // v1.1.0 writes { runs: [...] }; v1.0.0 wrote the one run flat. Both are read, so the upgrade
  // does not turn a node that submitted yesterday into one that reads "never sent".
  const list = Array.isArray((raw as { runs?: unknown }).runs)
    ? (raw as { runs: unknown[] }).runs
    : [raw];
  const runs: IndexNowRun[] = [];
  for (const item of list) {
    const run = asRun(item);
    if (run) runs.push(run);
  }
  if (runs.length !== list.length) {
    logger.warn('IndexNow log holds an entry that is not the shape we write; it is left out');
  }
  return runs.slice(0, INDEXNOW_RUNS_KEPT);
}

export async function readIndexNowLastRun(storage: Storage): Promise<IndexNowRun | null> {
  const runs = await readIndexNowRuns(storage);
  return runs[0] ?? null;
}

/** One stored entry as a run, or null when it is not one. Fields added later default rather than reject. */
function asRun(raw: unknown): IndexNowRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<IndexNowRun>;
  if (typeof r.at !== 'string' || typeof r.urlCount !== 'number') return null;
  return {
    at: r.at,
    urlCount: r.urlCount,
    hosts: typeof r.hosts === 'number' ? r.hosts : 1,
    ok: !!r.ok,
    status: typeof r.status === 'number' ? r.status : null,
    failed: Array.isArray(r.failed) ? r.failed.filter((h): h is string => typeof h === 'string') : [],
    ...(r.scope === 'app' || r.scope === 'pages' || r.scope === 'all' ? { scope: r.scope } : {}),
    ...(typeof r.by === 'string' ? { by: r.by } : {}),
  };
}

/** Parse, or nothing. A corrupt status record must not turn "is my node findable" into a 500. */
function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (err) {
    logger.warn('IndexNow log is not valid JSON; reporting no previous submission', {
      error: String(err),
    });
    return null;
  }
}

export async function recordIndexNowRun(storage: Storage, run: IndexNowRun): Promise<void> {
  const previous = await readIndexNowRuns(storage);
  const runs = [run, ...previous].slice(0, INDEXNOW_RUNS_KEPT);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: KEY,
    ownerGaii: SITE_OWNER_GAII,
    value: { runs },
    visibility: 'private',
    tags: ['site', 'indexnow'],
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
}
