/**
 * @file src/services/value/signal-buffer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The value signals: what happened to a record an AI made, derived where a principal
 *   writes, deletes or opens a memory record. Nobody acknowledges anything; a person corrects, deletes
 *   or uses a result, and the node counts it (types/value.ts names the signals).
 *
 *   WHERE THE TOUCHES COME FROM. Writes and deletes come through the write tally's one entry point
 *   (data-map/write-tally-buffer.ts recordMemoryTouch), so every write endpoint the tally counts is
 *   counted here too. Opens come from the endpoints that open ONE record for a reader (GET
 *   /v1/memory/:key, the MCP tool aimeat_memory_read, a workspace read by id): a list or a search is
 *   not a use. VALUE_READ_ENDPOINTS names them, so a reader of the numbers sees what they cover.
 *
 *   WHO IS AN AI. An agent (a GAII) and a scheduled AI job (`schedule:{id}`). A person, an app the
 *   person uses (`eco:{app}#…`, an app grant) and an extension are not: their write on an AI-made
 *   record is someone else changing it. A person's own chat AI is an agent, so the content it writes
 *   is AI-made, and its change to another agent's result is a correction; the same AI writing its own
 *   result again is a revision, its own next round.
 *
 *   SYNCHRONOUS AND RETURNS VOID, like recordMemoryTouch: a request path never waits on this. Touches
 *   queue in order and a timer flushes them; the flush reads the stored state of the touched records,
 *   replays the touches against it, and writes the per-record state and the day counts.
 *
 *   ERASURE. holdValueSignalsForErasure drops the account's waiting touches and keeps no new ones
 *   until the cascade has run (services/erasure/holds.ts), as every other write buffer does.
 * @structure VALUE_READ_ENDPOINTS · REJECTION_WINDOW_DAYS · isAiPrincipal · recordValueWrite ·
 *   recordValueDelete · recordValueRead · flushValueSignals · holdValueSignalsForErasure ·
 *   initValueSignals · shutdownValueSignals · resetValueSignals
 * @usage recordValueRead({ ownerGaii, key, readerPrincipal });  // after a read was authorized
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import type { Storage } from '../../storage/interface.js';
import type { ValueKeyRow, ValueKeyDelta, ValueDailyDelta, ValueSignal } from '../../storage/types/value.js';
import { classifyKey, baseKeyOf } from '../../utils/key-family.js';
import { parseGAII, ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { ErasureHolds, type ErasedAccount } from '../erasure/holds.js';

/** The endpoints whose opens count as a use, in the words a person would use. */
export const VALUE_READ_ENDPOINTS = [
  'opening a record (GET /v1/memory/:key)',
  'an AI reading a record (aimeat_memory_read)',
  'opening a workspace record or document by its id',
] as const;

/** An AI-made record deleted within this many days of being made counts as rejected. */
export const REJECTION_WINDOW_DAYS = 14;

const DEFAULT_FLUSH_INTERVAL_MS = 15_000;
/** Ceiling on waiting touches. Past it the oldest go: a gap in a count beats taking the node down. */
const MAX_PENDING = 50_000;
/** Ceiling on the (day, key, reader) opens remembered, so one reader reopening a record counts once a day. */
const MAX_SEEN_OPENS = 100_000;

type TouchKind = 'write' | 'delete' | 'read';
interface Touch {
  kind: TouchKind;
  ownerGaii: string;
  key: string;
  principal: string;
  at: string;
  bytes?: number;
  level?: string;
}

// process-local: each process keeps and flushes its own waiting touches; a second process counts its own.
let storageRef: Storage | null = null;
// process-local: each process runs its own flush timer over its own touches.
let flushTimer: ReturnType<typeof setInterval> | null = null;
// process-local: guards this process's own flush against a second flush running at once.
let flushing = false;
// process-local: this process's waiting touches; two processes touching one record replay in two batches.
let pending: Touch[] = [];
// process-local: this process's count of touches dropped at its own ceiling.
let dropped = 0;
// process-local: one reader reopening a record counts once a day per process; with two, at most twice.
const seenOpens = new Set<string>();
// process-local: the day seenOpens belongs to, per process.
let seenDay = '';
const erasing = new ErasureHolds();

/** True for an agent and for a scheduled AI job; false for a person, an app grant and an extension. */
export function isAiPrincipal(principal: string): boolean {
  return principal.startsWith('schedule:') || parseGAII(principal) !== null;
}

/**
 * The one record a key belongs to. A workspace record is one thing whatever copy is touched: its
 * draft (under the writer), its published `.latest` (under the holder) and its `.version.N` rows all
 * name the same record, so a workspace key is identified by the key alone, under the empty namespace.
 * Any other key is its namespace and its base key.
 */
export function valueRecordOf(ownerGaii: string, key: string): { ownerGaii: string; key: string } {
  const base = baseKeyOf(key);
  if (!base.startsWith('organism.')) return { ownerGaii, key: base };
  return { ownerGaii: '', key: base.replace(WORKSPACE_COPY, '') };
}

/** The copy suffixes of a workspace record: its draft and its published copy (versions go by baseKeyOf). */
const WORKSPACE_COPY = /\.(draft|latest)$/;

/** The size of a value as the write path stores it, for a correction's size. */
export function valueBytes(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null), 'utf8');
}

function push(t: Touch): void {
  try {
    if (!t.ownerGaii || !t.key || !t.principal) return;
    if (erasing.covers(t.ownerGaii) || erasing.covers(t.principal)) return;
    const rec = valueRecordOf(t.ownerGaii, t.key);
    if (pending.length >= MAX_PENDING) { pending.shift(); dropped++; }
    pending.push({ ...t, ownerGaii: rec.ownerGaii, key: rec.key });
  } catch (err) {
    logger.warn('value-signals: refused to let a bookkeeping failure reach a request', { error: String(err) });
  }
}

/** A principal wrote a memory record. `bytes` is the value's size, `level` the declared provenance level. */
export function recordValueWrite(t: { ownerGaii: string; key: string; writerPrincipal: string; at?: string; bytes?: number; level?: string }): void {
  push({ kind: 'write', ownerGaii: t.ownerGaii, key: t.key, principal: t.writerPrincipal, at: t.at ?? new Date().toISOString(), bytes: t.bytes, level: t.level });
}

/** A principal deleted a memory record. */
export function recordValueDelete(t: { ownerGaii: string; key: string; principal: string; at?: string }): void {
  push({ kind: 'delete', ownerGaii: t.ownerGaii, key: t.key, principal: t.principal, at: t.at ?? new Date().toISOString() });
}

/** A reader opened one memory record, after the read was authorized. */
export function recordValueRead(t: { ownerGaii: string; key: string; readerPrincipal: string; at?: string }): void {
  const at = t.at ?? new Date().toISOString();
  const day = at.slice(0, 10);
  if (day !== seenDay) { seenOpens.clear(); seenDay = day; }
  const id = `${day}\u0000${t.ownerGaii}\u0000${t.key}\u0000${t.readerPrincipal}`;
  if (seenOpens.has(id)) return;
  if (seenOpens.size >= MAX_SEEN_OPENS) seenOpens.clear();
  seenOpens.add(id);
  push({ kind: 'read', ownerGaii: t.ownerGaii, key: t.key, principal: t.readerPrincipal, at });
}

const WORKSPACE_KEY = /^organism\.([^.]+)\.w\.([^.]+)\./;

/**
 * The day-count coordinates of a record: whose AI made it (the producer's owner, so a person's own
 * view counts what their agents made wherever it landed), which organism and workspace, which family.
 */
function coordinates(key: string, producer: string): { ownerGhii: string; orgId: string; wsId: string; family: string } {
  const ws = WORKSPACE_KEY.exec(key);
  return {
    ownerGhii: ownerGhiiOf(producer),
    orgId: ws?.[1] ?? '',
    wsId: ws?.[2] ?? '',
    family: classifyKey(key).family,
  };
}

interface KeyWork {
  stored: ValueKeyRow | null;
  cur: ValueKeyRow | null;
}

const pairId = (ownerGaii: string, key: string): string => `${ownerGaii}\u0000${key}`;

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

/**
 * Replay one batch of touches against the stored state. Pure: takes the stored rows and the touches,
 * answers what to delete, what to fold in and which day counts to add. Exported for the unit test.
 */
export function replayValueTouches(stored: ValueKeyRow[], touches: Touch[]): {
  deletes: Array<{ ownerGaii: string; key: string }>;
  upserts: ValueKeyDelta[];
  daily: ValueDailyDelta[];
} {
  const work = new Map<string, KeyWork>();
  for (const r of stored) work.set(pairId(r.ownerGaii, r.key), { stored: r, cur: { ...r } });
  const dailyMap = new Map<string, ValueDailyDelta>();
  const day = (_ownerGaii: string, key: string, producer: string, signal: ValueSignal, at: string, bytes: number): void => {
    const c = coordinates(key, producer);
    const d = at.slice(0, 10);
    const id = [d, c.ownerGhii, c.orgId, c.wsId, producer, c.family, signal].join('\u0000');
    const row = dailyMap.get(id);
    if (row) { row.count += 1; row.bytes += bytes; return; }
    dailyMap.set(id, { day: d, ownerGhii: c.ownerGhii, orgId: c.orgId, wsId: c.wsId, producer, family: c.family, signal, count: 1, bytes });
  };
  // A record deleted and made again in one batch: the old row goes first, the new one is inserted.
  const recreated = new Set<string>();

  for (const t of touches) {
    const id = pairId(t.ownerGaii, t.key);
    let w = work.get(id);
    if (!w) { w = { stored: null, cur: null }; work.set(id, w); }
    const cur = w.cur;
    if (t.kind === 'write') {
      if (!cur) {
        if (!isAiPrincipal(t.principal)) continue;
        if (w.stored) recreated.add(id);
        w.cur = {
          ownerGaii: t.ownerGaii, key: t.key, producer: t.principal, producerLevel: t.level ?? null,
          producedAt: t.at, revisions: 0, corrections: 0, correctionBytes: 0, lastCorrectedAt: null,
          readsByOthers: 0, lastReadAt: null, lastBytes: t.bytes ?? 0,
        };
        day(t.ownerGaii, t.key, t.principal, t.level === 'synthesized' ? 'refined' : 'produced', t.at, t.bytes ?? 0);
      } else if (t.principal === cur.producer) {
        cur.revisions += 1;
        if (t.bytes !== undefined) cur.lastBytes = t.bytes;
        day(t.ownerGaii, t.key, cur.producer, 'revised', t.at, 0);
      } else if (t.bytes !== undefined && t.bytes === cur.lastBytes) {
        // Someone else saved it unchanged in size: a publish of the draft as it was, or a re-save.
        // Not a correction.
        continue;
      } else {
        const changed = t.bytes !== undefined ? Math.abs(t.bytes - cur.lastBytes) : 0;
        cur.corrections += 1;
        cur.correctionBytes += changed;
        cur.lastCorrectedAt = t.at;
        if (t.bytes !== undefined) cur.lastBytes = t.bytes;
        day(t.ownerGaii, t.key, cur.producer, 'corrected', t.at, changed);
      }
    } else if (t.kind === 'delete') {
      if (!cur) continue;
      if (daysBetween(cur.producedAt, t.at) <= REJECTION_WINDOW_DAYS) day(t.ownerGaii, t.key, cur.producer, 'rejected', t.at, 0);
      w.cur = null;
    } else {
      if (!cur || t.principal === cur.producer) continue;
      cur.readsByOthers += 1;
      cur.lastReadAt = t.at;
      day(t.ownerGaii, t.key, cur.producer, 'used', t.at, 0);
    }
  }

  const deletes: Array<{ ownerGaii: string; key: string }> = [];
  const upserts: ValueKeyDelta[] = [];
  for (const [id, w] of work) {
    const { stored, cur } = w;
    const sameLife = !!stored && !!cur && !recreated.has(id) && stored.producedAt === cur.producedAt;
    if (stored && !sameLife) deletes.push({ ownerGaii: stored.ownerGaii, key: stored.key });
    if (!cur) continue;
    const base = sameLife ? stored! : null;
    const delta: ValueKeyDelta = {
      ownerGaii: cur.ownerGaii, key: cur.key, producer: cur.producer, producerLevel: cur.producerLevel,
      producedAt: cur.producedAt,
      revisions: cur.revisions - (base?.revisions ?? 0),
      corrections: cur.corrections - (base?.corrections ?? 0),
      correctionBytes: cur.correctionBytes - (base?.correctionBytes ?? 0),
      lastCorrectedAt: cur.lastCorrectedAt,
      readsByOthers: cur.readsByOthers - (base?.readsByOthers ?? 0),
      lastReadAt: cur.lastReadAt,
      lastBytes: base && base.lastBytes === cur.lastBytes ? null : cur.lastBytes,
    };
    const changed = !base || delta.revisions || delta.corrections || delta.readsByOthers || delta.lastBytes !== null;
    if (changed) upserts.push(delta);
  }
  return { deletes, upserts, daily: [...dailyMap.values()] };
}

/** Write the waiting touches out. Snapshot-and-clear first, so touches arriving now wait for the next window. */
export async function flushValueSignals(): Promise<void> {
  if (!storageRef || flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending;
  pending = [];
  if (dropped > 0) {
    logger.warn('value-signals: dropped the oldest touches to stay under the memory ceiling', { dropped, ceiling: MAX_PENDING });
    dropped = 0;
  }
  const storage = storageRef;
  try {
    await erasing.track((async () => {
      const pairs = new Map<string, { ownerGaii: string; key: string }>();
      for (const t of batch) pairs.set(pairId(t.ownerGaii, t.key), { ownerGaii: t.ownerGaii, key: t.key });
      const all = [...pairs.values()];
      const stored: ValueKeyRow[] = [];
      for (let i = 0; i < all.length; i += 1000) stored.push(...await storage.getValueKeys(all.slice(i, i + 1000)));
      const out = replayValueTouches(stored, batch);
      await storage.deleteValueKeys(out.deletes);
      await storage.upsertValueKeys(out.upserts);
      await storage.upsertValueDaily(out.daily);
    })());
  } catch (err) {
    logger.warn('value-signals: flush failed, this window of signals is lost', { count: batch.length, error: String(err) });
  } finally {
    flushing = false;
  }
}

/**
 * An account erasure (services/owner/erasure.ts), before its cascade: the account's waiting touches
 * are dropped, the writes in progress answer, and no touch of the account is kept until the returned
 * function ends the hold.
 */
export async function holdValueSignalsForErasure(account: ErasedAccount): Promise<() => void> {
  const release = erasing.hold(account);
  await erasing.writesSettled();
  pending = pending.filter(t => !ErasureHolds.isOf(t.ownerGaii, account) && !ErasureHolds.isOf(t.principal, account));
  await flushValueSignals();
  return release;
}

/** Wire storage and start the flush interval. Idempotent: the interval is the first call's. */
export function initValueSignals(storage: Storage, flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS): void {
  storageRef = storage;
  if (flushTimer) return;
  // process-local: each process flushes its own touches on its own timer.
  flushTimer = setInterval(() => { void flushValueSignals(); }, Math.max(100, flushIntervalMs));
  flushTimer.unref?.();
}

/** Stop the interval and flush once. Called from graceful shutdown. */
export async function shutdownValueSignals(): Promise<void> {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flushValueSignals();
}

/** Test seam: drop everything in flight. Not used by the running node. */
export function resetValueSignals(): void {
  pending = [];
  dropped = 0;
  seenOpens.clear();
  seenDay = '';
}
