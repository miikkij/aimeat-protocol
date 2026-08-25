/**
 * @file indexnow-log.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When this node last told IndexNow that something changed, and how many addresses it
 *   sent.
 *
 *   ONE memory record, overwritten each time, not one per submission. That is the shape rule this
 *   project measured the hard way: a key written on every publish would reach the 1000-key ceiling
 *   inside a year and buy nothing, because nobody wants the history — they want to know whether the
 *   last one went out. A record rather than a table for the same reason the memory-contracts guide
 *   gives: there is no query here that a key lookup does not answer.
 *
 *   Private, and under the node's own `__site__` identity rather than any person's: this is
 *   operational state, not somebody's knowledge, and it must not appear in an owner's own memory
 *   listing.
 *
 * @structure
 *   - readIndexNowLastRun(storage)             — the last submission, or null
 *   - writeIndexNowLastRun(storage, run)       — record one
 * @usage
 *   const last = await readIndexNowLastRun(storage);
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** The node's own identity for operational records, shared with services/site.ts. */
const SITE_OWNER_GAII = '__site__';
const KEY = 'site/indexnow-last-run';

export interface IndexNowRun {
  /** ISO timestamp of the submission. */
  at: string;
  /** How many addresses were sent. */
  urlCount: number;
  /** What IndexNow answered, so a rejected submission does not read as a successful one. */
  ok: boolean;
  /** HTTP status, or null when the request never completed. */
  status: number | null;
}

export async function readIndexNowLastRun(storage: Storage): Promise<IndexNowRun | null> {
  const record = await storage.getMemory(SITE_OWNER_GAII, KEY);
  if (!record) return null;
  // A memory value is `unknown` by contract, and a provider is free to hand back the object or the
  // string it stored. Both shapes are accepted here rather than assuming one, because the wrong
  // assumption would show an operator "never submitted" on a node that submits every day.
  const raw: unknown = typeof record.value === 'string'
    ? safeParse(record.value)
    : record.value;
  if (!raw || typeof raw !== 'object') return null;
  const run = raw as Partial<IndexNowRun>;
  if (typeof run.at !== 'string' || typeof run.urlCount !== 'number') {
    logger.warn('IndexNow last-run record is not the shape we write; reporting no previous submission');
    return null;
  }
  return { at: run.at, urlCount: run.urlCount, ok: !!run.ok, status: run.status ?? null };
}

/** Parse, or nothing. A corrupt status record must not turn "is my node findable" into a 500. */
function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (err) {
    logger.warn('IndexNow last-run record is not valid JSON; reporting no previous submission', {
      error: String(err),
    });
    return null;
  }
}

export async function writeIndexNowLastRun(storage: Storage, run: IndexNowRun): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: KEY,
    ownerGaii: SITE_OWNER_GAII,
    value: run,
    visibility: 'private',
    tags: ['site', 'indexnow'],
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
}
