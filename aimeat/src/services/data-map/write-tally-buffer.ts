/**
 * @file src/services/data-map/write-tally-buffer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one door for recording that somebody touched a memory key. Every write door in
 *   the node calls `recordMemoryTouch`, which folds in memory and flushes on an interval.
 *
 *   SYNCHRONOUS AND RETURNS VOID, for the reason `recordUsageCall` is: a door that COULD be awaited
 *   would eventually be awaited inside a request path, and then a slow database is a slow node. The
 *   signature refuses it — there is nothing to await and nothing to catch. What a write pays is one
 *   regex pass over the key and two Map updates.
 *
 *   THE ONE PLACE PERMANENT AND BEST-EFFORT COLLIDE is the FIRST sighting of a (key, principal)
 *   pair. A lost increment is a wrong number; a lost first sighting is a fact that never existed, and
 *   this ledger's whole purpose is to hold facts nothing else can reconstruct. So a pair not yet
 *   known to be stored is written through immediately as a floating promise, and every later touch of
 *   that pair is pure buffering. Stated plainly, and repeated wherever a surface renders these
 *   numbers: THE EXISTENCE OF A HAND IS DURABLE WITHIN MILLISECONDS; THE COUNT IS EXACT TO WITHIN
 *   THE LAST FLUSH WINDOW. A hard kill loses at most fifteen seconds of increments and no facts.
 *
 *   WHAT IT DOES NOT COUNT, and this is not a rounding error. `storage.setMemory` is called from
 *   about a hundred files; the doors instrumented here are the ones a PRINCIPAL comes through. A
 *   node-internal service write has no principal and is deliberately ABSENT rather than attributed to
 *   a synthetic `system@` identity — lumping the beneficiary book, the onboarding funnel and
 *   federation sync into one fictitious hand would make a coverage number look complete when it is
 *   not, which is the failure this whole feature exists to prevent.
 * @structure initWriteTallyBuffer · recordMemoryTouch · flushWriteTallyBuffer ·
 *   shutdownWriteTallyBuffer · resetWriteTallyBuffer · holdWriteTallyForErasure · TALLY_DOORS
 * @usage
 *   import { recordMemoryTouch } from '../data-map/write-tally-buffer.js';
 *   recordMemoryTouch({ ownerGaii, key, writerPrincipal, kind: 'write' });
 * @version-history
 *   v1.3.0 — 2026-11-20 — recordMemoryTouch hands each touch to the value signals too
 *     (services/value/signal-buffer.ts), with the value's size and declared level when the endpoint
 *     knows them, so every endpoint this counts is counted there.
 *   v1.2.0 — 2026-11-14 — holdWriteTallyForErasure: before the erasure cascade, the account's waiting
 *     counts are dropped, the writes in progress answer, and its touches of other accounts' keys are
 *     written so the cascade gives them the erasure's pseudonym; no touch of the account is kept until
 *     it ends. A count that waited was stored after the cascade, under the erased person's name
 *     (register finding f-2026-11-13-write-buffers-and-erasure). The pair key's separator is written
 *     as the \u0000 escape, the same string, so the file is plain text.
 *   v1.1.0 — 2026-10-25 — The flush interval is the caller's (usage.tally_buffer_ms from the config),
 *     not AIMEAT_TALLY_BUFFER_MS read at import.
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 steps 9-10.
 */
import type { Storage } from '../../storage/interface.js';
import { classifyKey } from '../../utils/key-family.js';
import { logger } from '../../utils/logger.js';
import { ErasureHolds, type ErasedAccount } from '../erasure/holds.js';
import { recordValueWrite, recordValueDelete } from '../value/signal-buffer.js';

/**
 * Flush cadence when the caller names none. The counts are at most this stale; the first sighting of
 * a pair never is. The node passes usage.tally_buffer_ms (config.tallyBufferMs) at start.
 */
const DEFAULT_FLUSH_INTERVAL_MS = 15_000;

/**
 * How many (key, principal) pairs to remember as already-stored. Past this the oldest are forgotten,
 * which costs one redundant write-through the next time such a pair is touched — never a lost fact.
 */
const MAX_KNOWN_PAIRS = 200_000;

/** Ceiling on unflushed folds. Past this the oldest go: a gap in a count beats taking the node down. */
const MAX_PENDING = 50_000;

/**
 * The write doors this counts, in the words a person would use. Served alongside every tally number
 * so a reader can see what the number covers — a coverage figure that silently omits a hundred write
 * sites reads as complete and is not.
 */
export const TALLY_DOORS = [
  'what you save yourself',
  'what your agents save through the memory tools',
  'what gets written into an organism workspace',
  'what an extension saves',
  'what a scheduled job saves',
] as const;

interface Pending {
  ownerGaii: string;
  key: string;
  writerPrincipal: string;
  family: string;
  tier: string;
  writeCount: number;
  deleteCount: number;
  at: string;
}

let storageRef: Storage | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let pending = new Map<string, Pending>();
const knownPairs = new Set<string>();
let droppedSinceLastWarning = 0;
/** The accounts whose erasure runs now, whose touches are not kept, and the flush and first-sighting
 *  writes in progress an erasure waits for (holdWriteTallyForErasure). */
const erasing = new ErasureHolds();

const pairKey = (ownerGaii: string, key: string, writer: string): string => `${ownerGaii}\u0000${key}\u0000${writer}`;

/**
 * Record one touch. Never throws, never blocks.
 *
 * `writerPrincipal` is who DID it, which is not the namespace it lands in: an agent writing into its
 * owner's store is the owner's namespace and the agent's hand, and telling those apart is the entire
 * point. A caller that cannot name the principal must not call this at all rather than pass a
 * placeholder.
 */
export function recordMemoryTouch(t: {
  ownerGaii: string;
  key: string;
  writerPrincipal: string;
  kind: 'write' | 'delete';
  at?: string;
  /** The value's size after a write, when the endpoint knows it (the value signals' correction size). */
  bytes?: number;
  /** The provenance level the writer declared, when the endpoint knows it. */
  level?: string;
}): void {
  try {
    if (!t.ownerGaii || !t.key || !t.writerPrincipal) return;
    // The value signals read the same touches: what happened to a record an AI made
    // (services/value/signal-buffer.ts). Synchronous, like this function.
    if (t.kind === 'write') recordValueWrite({ ownerGaii: t.ownerGaii, key: t.key, writerPrincipal: t.writerPrincipal, at: t.at, bytes: t.bytes, level: t.level });
    else recordValueDelete({ ownerGaii: t.ownerGaii, key: t.key, principal: t.writerPrincipal, at: t.at });
    // A touch by or of an account being erased: the cascade deletes the account's counts and renames
    // it where it touched another account's key, so neither is started again.
    if (erasing.covers(t.ownerGaii) || erasing.covers(t.writerPrincipal)) return;
    const at =t.at ?? new Date().toISOString();
    const id = pairKey(t.ownerGaii, t.key, t.writerPrincipal);

    const existing = pending.get(id);
    if (existing) {
      if (t.kind === 'write') existing.writeCount++; else existing.deleteCount++;
      if (at > existing.at) existing.at = at;
      return;
    }

    if (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next().value;
      if (oldest !== undefined) { pending.delete(oldest); droppedSinceLastWarning++; }
    }

    const fam = classifyKey(t.key);
    const row: Pending = {
      ownerGaii: t.ownerGaii, key: t.key, writerPrincipal: t.writerPrincipal,
      family: fam.family, tier: fam.tier,
      writeCount: t.kind === 'write' ? 1 : 0,
      deleteCount: t.kind === 'delete' ? 1 : 0,
      at,
    };
    pending.set(id, row);

    // First sighting: write it through NOW rather than waiting for the flush. The count can be a
    // window behind; whether a hand was ever here cannot.
    if (!knownPairs.has(id) && storageRef) {
      rememberPair(id);
      void erasing.track(writeThrough(storageRef, row)).catch(err => {
        // It stays in `pending`, so the next flush carries it. Losing this attempt costs latency.
        logger.warn('write-tally: first-sighting write-through failed, leaving it to the flush', {
          key: t.key, error: String(err),
        });
      });
    }
  } catch (err) {
    logger.warn('write-tally: refused to let a bookkeeping failure reach a write', { error: String(err) });
  }
}

/** Both grains for one row, with counts of exactly what has been seen so far. */
async function writeThrough(storage: Storage, row: Pending): Promise<void> {
  await Promise.all([
    storage.upsertMemoryWriteTally([{
      ownerGaii: row.ownerGaii, key: row.key, writerPrincipal: row.writerPrincipal,
      writeCount: row.writeCount, deleteCount: row.deleteCount, at: row.at,
    }]),
    storage.upsertMemoryFamilyTally([{
      ownerGaii: row.ownerGaii, keyFamily: row.family, writerPrincipal: row.writerPrincipal,
      tier: row.tier, writeCount: row.writeCount, deleteCount: row.deleteCount, at: row.at,
    }]),
  ]);
  // What went through now must not be added again by the flush.
  row.writeCount = 0;
  row.deleteCount = 0;
}

function rememberPair(id: string): void {
  if (knownPairs.size >= MAX_KNOWN_PAIRS) {
    const oldest = knownPairs.values().next().value;
    if (oldest !== undefined) knownPairs.delete(oldest);
  }
  knownPairs.add(id);
}

/**
 * Write the folded counts out.
 *
 * Snapshot-and-clear up front so touches arriving mid-flush accumulate for the next window. Rows
 * whose counts a write-through already carried are skipped rather than added twice.
 */
export async function flushWriteTallyBuffer(): Promise<void> {
  if (!storageRef || flushing || pending.size === 0) return;
  flushing = true;
  const batch = [...pending.values()].filter(r => r.writeCount > 0 || r.deleteCount > 0);
  pending = new Map();

  if (droppedSinceLastWarning > 0) {
    logger.warn('write-tally: dropped oldest folds to stay under the memory ceiling', {
      dropped: droppedSinceLastWarning, ceiling: MAX_PENDING,
    });
    droppedSinceLastWarning = 0;
  }

  const storage = storageRef;
  try {
    if (batch.length > 0) {
      await erasing.track((async () => {
        await storage.upsertMemoryWriteTally(batch.map(r => ({
          ownerGaii: r.ownerGaii, key: r.key, writerPrincipal: r.writerPrincipal,
          writeCount: r.writeCount, deleteCount: r.deleteCount, at: r.at,
        })));
        await storage.upsertMemoryFamilyTally(batch.map(r => ({
          ownerGaii: r.ownerGaii, keyFamily: r.family, writerPrincipal: r.writerPrincipal,
          tier: r.tier, writeCount: r.writeCount, deleteCount: r.deleteCount, at: r.at,
        })));
      })());
    }
  } catch (err) {
    logger.warn('write-tally: flush failed, this window of counts is lost', {
      count: batch.length, error: String(err),
    });
  } finally {
    flushing = false;
  }
}

/**
 * An account erasure (services/owner/erasure.ts), before its cascade. No touch by or of the account is
 * kept from now on, and the writes in progress answer first, so the cascade reaches what they stored.
 * The account's own counts that wait are dropped: the cascade deletes the stored ones. Its touches of
 * other accounts' keys that wait are written now, so the cascade gives them the erasure's pseudonym
 * as it does the stored ones, and the other account's count stays whole; written after it, they
 * would carry the erased person's name. The pairs it was part of are forgotten, so the next holder of
 * the name gets a first sighting of their own. The returned function ends the hold, after the cascade.
 */
export async function holdWriteTallyForErasure(account: ErasedAccount): Promise<() => void> {
  const release = erasing.hold(account);
  await erasing.writesSettled();
  for (const [id, row] of pending) {
    if (ErasureHolds.isOf(row.ownerGaii, account)) pending.delete(id);
  }
  await flushWriteTallyBuffer();
  for (const id of knownPairs) {
    const [ownerGaii, , writer] = id.split('\u0000');
    if (ErasureHolds.isOf(ownerGaii, account) || ErasureHolds.isOf(writer, account)) knownPairs.delete(id);
  }
  return release;
}

/** Wire storage and start the flush interval. Idempotent: the interval is the first call's. */
export function initWriteTallyBuffer(storage: Storage, flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS): void {
  storageRef = storage;
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushWriteTallyBuffer(); }, Math.max(100, flushIntervalMs));
  flushTimer.unref?.();
}

/** Stop the interval and perform one final flush. Called from graceful shutdown. */
export async function shutdownWriteTallyBuffer(): Promise<void> {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flushWriteTallyBuffer();
}

/** Test seam: drop everything in flight. Not used by the running node. */
export function resetWriteTallyBuffer(): void {
  pending = new Map();
  knownPairs.clear();
  droppedSinceLastWarning = 0;
}
