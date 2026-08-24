/**
 * @file src/services/signals/signal-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The signals engine: define what is measured, count a hit, read the report back.
 *   One implementation behind every door — the tracking image, the JSON hit, the page-serve
 *   counter and any future channel all land here, so the caps, the vocabulary check and the
 *   record shape are written once (CLAUDE.md: one capability, one implementation).
 *
 *   COUNTING IS A COMPARE-AND-SWAP, NOT A READ-THEN-WRITE. Hits arrive in parallel by nature: one
 *   send goes to two hundred people who open it in the same minute. Read-modify-write would lose
 *   whichever increments landed inside another's gap, and the loss would be invisible, which is
 *   the worst property a counter can have. The month record is swapped on its version, and a lost
 *   swap re-reads and re-applies instead of clobbering.
 *
 *   THE PUBLIC DOOR WRITES INTO AN OWNER'S NAMESPACE WITH NO AUTHENTICATION, which is unusual here
 *   and is the reason for every cap in signal-schemas.ts. What a stranger can do at worst: add
 *   counts to a stream whose id they know, up to the daily ceiling, in a record whose size is
 *   bounded and whose key count does not grow with traffic. What they cannot do: create a stream,
 *   read a report, learn who else was counted, reach another key, or make the record grow without
 *   bound. Refusals come BEFORE any write (security DNA invariant 14).
 *
 *   NO IP ADDRESS IS STORED, anywhere, ever. The request's address is used by the rate limiter and
 *   then forgotten. A per-visitor identity exists only when the SENDER minted an opaque subject
 *   token, which only the sender can map back to a person.
 *
 * @structure SignalError · createStream/listStreams/getStream/deleteStream · recordHit · readReport
 * @usage await recordHit(storage, { ownerGhii, streamId, event: 'open', userAgent });
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial: the generic hit collector.
 *   v1.0.1 — 2026-08-24 — SECURITY (CodeQL js/prototype-polluting-assignment): `subject` is the one
 *     map key a stranger supplies, so a prototype key (`__proto__`) let a public hit reach
 *     Object.prototype through rec.subjects. Rejected at source and read back with Object.hasOwn.
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import {
  SIGNAL_EVENTS, SIGNAL_CHANNELS, MAX_STREAMS_PER_OWNER, MAX_SUBJECTS_PER_MONTH,
  MAX_HITS_PER_STREAM_PER_DAY, RETAIN_MONTHS, MAX_SUBJECT_LEN, MAX_REF_LEN, STREAM_ID_RE,
  streamKey, STREAM_KEY_PREFIX, monthKey, monthKeyPrefix, monthOf, dayOf, emptyDay, emptyMonth,
  type SignalStreamConfig, type SignalMonthRecord, type SignalEvent, type SignalChannel,
} from '../../models/signal-schemas.js';
import { classifyVisitor } from './visitor-class.js';
import { logger } from '../../utils/logger.js';

export class SignalError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
    this.name = 'SignalError';
  }
}

const nowIso = (): string => new Date().toISOString();

/**
 * Bumped whenever any stream is created, changed or deleted.
 *
 * The page-view counter keeps a short negative cache so serving an app that nobody measures costs
 * no database read, and this is what stops that cache from outliving the owner's decision: turning
 * measurement on took effect a minute later without it, which the first page-view test caught by
 * counting zero. A version number rather than a callback, so nothing has to import backwards.
 */
let streamsVersion = 0;
export const streamsRevision = (): number => streamsVersion;

/** Bump `obj[key]` by one, treating an absent key as zero. */
function bump<K extends string>(obj: Partial<Record<K, number>>, key: K): void {
  obj[key] = (obj[key] ?? 0) + 1;
}

/**
 * Keys that are not data: assigning to one reaches an object's prototype rather than adding an entry.
 * `subject` is the one map key here a stranger controls (it rides in on the public hit), so it is
 * checked against this set before it is ever used to index rec.subjects. The other dynamic keys are
 * an allowlisted event/channel, a fixed visitor class, or an aiAgent name from a closed table.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ── Streams ───────────────────────────────────────────────────────────────────────────────────

export interface StreamInput {
  streamId: string;
  label?: string;
  channel?: string;
  perSubject?: boolean;
  group?: string | null;
  enabled?: boolean;
}

async function readStreamRecord(
  storage: Storage, ownerGhii: string, streamId: string,
): Promise<{ cfg: SignalStreamConfig; version: number } | null> {
  const row = await storage.getMemory(ownerGhii, streamKey(streamId));
  if (!row) return null;
  return { cfg: row.value as unknown as SignalStreamConfig, version: row.version ?? 1 };
}

export async function getStream(
  storage: Storage, ownerGhii: string, streamId: string,
): Promise<SignalStreamConfig | null> {
  return (await readStreamRecord(storage, ownerGhii, streamId))?.cfg ?? null;
}

export async function listStreams(storage: Storage, ownerGhii: string): Promise<SignalStreamConfig[]> {
  const { items } = await storage.listAllMemory({ prefix: STREAM_KEY_PREFIX, limit: MAX_STREAMS_PER_OWNER + 50 });
  return items
    .filter((r) => r.ownerGaii === ownerGhii && r.key.startsWith(STREAM_KEY_PREFIX))
    .map((r) => r.value as unknown as SignalStreamConfig)
    .filter((c): c is SignalStreamConfig => !!c && typeof c.streamId === 'string')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Define or update a stream. The ceiling is checked before the write, never after. */
export async function saveStream(
  storage: Storage, ownerGhii: string, input: StreamInput,
): Promise<SignalStreamConfig> {
  const streamId = (input.streamId ?? '').trim().toLowerCase();
  if (!STREAM_ID_RE.test(streamId)) {
    throw new SignalError('INVALID_STREAM', 400, 'stream_id must be a slug of [a-z0-9-], 2-64 characters');
  }
  const channel = (input.channel ?? 'other') as SignalChannel;
  if (!SIGNAL_CHANNELS.includes(channel)) {
    throw new SignalError('INVALID_STREAM', 400, `channel must be one of: ${SIGNAL_CHANNELS.join(', ')}`);
  }
  const label = (input.label ?? '').trim().slice(0, 200);
  const group = input.group ? String(input.group).trim().slice(0, 80) : null;

  const existing = await readStreamRecord(storage, ownerGhii, streamId);
  if (!existing) {
    const streams = await listStreams(storage, ownerGhii);
    if (streams.length >= MAX_STREAMS_PER_OWNER) {
      throw new SignalError('TOO_MANY_STREAMS', 409,
        `This account already holds ${MAX_STREAMS_PER_OWNER} signal streams. Delete one before adding another.`);
    }
  }

  const now = nowIso();
  const cfg: SignalStreamConfig = {
    streamId,
    ownerGhii,
    label: label || existing?.cfg.label || streamId,
    channel,
    perSubject: input.perSubject ?? existing?.cfg.perSubject ?? true,
    enabled: input.enabled ?? existing?.cfg.enabled ?? true,
    group: group ?? existing?.cfg.group ?? null,
    createdAt: existing?.cfg.createdAt ?? now,
    updatedAt: now,
  };
  await storage.setMemory({
    key: streamKey(streamId), ownerGaii: ownerGhii,
    value: cfg as unknown as Record<string, unknown>,
    visibility: 'owner', tags: ['signal-stream'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: cfg.createdAt, updatedAt: now,
  } as MemoryRecord);
  streamsVersion++;
  return cfg;
}

/** Remove a stream and every month it collected. The public link stops counting immediately. */
export async function deleteStream(
  storage: Storage, ownerGhii: string, streamId: string,
): Promise<{ deleted: boolean; monthsRemoved: number }> {
  const existing = await readStreamRecord(storage, ownerGhii, streamId);
  const { items } = await storage.listAllMemory({ prefix: monthKeyPrefix(streamId), limit: 500 });
  let monthsRemoved = 0;
  for (const row of items) {
    if (row.ownerGaii !== ownerGhii) continue;
    if (await storage.deleteMemory(ownerGhii, row.key)) monthsRemoved++;
  }
  const deleted = existing ? await storage.deleteMemory(ownerGhii, streamKey(streamId)) : false;
  streamsVersion++;
  return { deleted, monthsRemoved };
}

// ── Counting ──────────────────────────────────────────────────────────────────────────────────

export interface HitInput {
  ownerGhii: string;
  streamId: string;
  event?: string;
  channel?: string;
  /** Opaque sender-minted token. The node never learns who it stands for. */
  subject?: string | null;
  /** Which link, page or item inside the stream. */
  ref?: string | null;
  userAgent?: string | null;
}

export interface HitOutcome {
  counted: boolean;
  /** Why not, when `counted` is false: `unknown-stream`, `disabled`, `daily-cap`. */
  reason?: string;
  klass?: string;
  aiAgent?: string | null;
}

/**
 * How many times a writer re-reads and re-applies after losing a swap.
 *
 * The number is for CROSS-PROCESS contention only, because same-process hits are queued by
 * `withKeyLock` below and never fight each other. It still has to be generous: a second node
 * instance counting the same campaign contends per round, and a dropped hit is invisible.
 */
const CAS_ATTEMPTS = 25;

/**
 * One writer at a time per key, within this process.
 *
 * Measured rather than assumed, and it is why this exists at all: twenty simultaneous opens against
 * a compare-and-swap alone landed SIX. Every writer reads the same version, one wins the round and
 * the other nineteen retry, so the last one in needs twenty rounds and gave up long before. A
 * campaign to two hundred people is exactly that shape. Queueing here turns the contention into a
 * line, and the swap stays as the guard for the case a queue cannot see: a second process.
 *
 * The tail is deleted when the chain drains, so this map holds only keys being written right now.
 */
const keyLocks = new Map<string, Promise<unknown>>();

async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  // `.then(fn, fn)` rather than `.then(fn)`: a failed predecessor must not cancel the whole line.
  const run = previous.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  keyLocks.set(key, tail);
  try {
    return await run;
  } finally {
    // Clear only if nobody queued behind this one, so a line still forming is never dropped.
    if (keyLocks.get(key) === tail) keyLocks.delete(key);
  }
}

/**
 * Count one hit.
 *
 * NEVER THROWS ON A COLLECTION FAILURE. Every caller is a public door whose real job is to serve
 * the image or the redirect the visitor is waiting for; a person must not see a broken page because
 * a counter lost a race. Failures return `counted: false` and are logged.
 */
export async function recordHit(storage: Storage, input: HitInput): Promise<HitOutcome> {
  const { ownerGhii, streamId } = input;

  // Refuse before writing: does this stream exist, and is it on?
  const stream = await getStream(storage, ownerGhii, streamId);
  if (!stream) return { counted: false, reason: 'unknown-stream' };
  if (!stream.enabled) return { counted: false, reason: 'disabled' };

  const event = (SIGNAL_EVENTS as readonly string[]).includes(input.event ?? '')
    ? (input.event as SignalEvent) : 'view';
  const channel = (SIGNAL_CHANNELS as readonly string[]).includes(input.channel ?? '')
    ? (input.channel as SignalChannel) : stream.channel;
  const rawSubject = stream.perSubject && input.subject
    ? String(input.subject).trim().slice(0, MAX_SUBJECT_LEN) : null;
  // A stranger picks this value and it becomes a map key below, so a prototype key would let them
  // reach Object.prototype through rec.subjects. Reject it: the hit still counts in the totals, it
  // simply is not tracked under that subject.
  const subject = rawSubject && !FORBIDDEN_KEYS.has(rawSubject) ? rawSubject : null;
  const ref = input.ref ? String(input.ref).trim().slice(0, MAX_REF_LEN) : null;
  const visitor = classifyVisitor(input.userAgent);

  const now = nowIso();
  const month = monthOf(now);
  const day = dayOf(now);
  const key = monthKey(streamId, month);

  return withKeyLock(`${ownerGhii}|${key}`, async () => {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const row = await storage.getMemory(ownerGhii, key);
      const version = row?.version ?? 0;
      const rec: SignalMonthRecord = row
        ? (row.value as unknown as SignalMonthRecord)
        : emptyMonth(streamId, month, now);

      const dayCounts = rec.days[day] ?? emptyDay();
      if (dayCounts.total >= MAX_HITS_PER_STREAM_PER_DAY) {
        // The ceiling is reached: record that it happened, count nothing more. A suppressed flood
        // has to be visible in the record, or a quiet day and a blocked day look identical.
        rec.dropped = (rec.dropped ?? 0) + 1;
        rec.updatedAt = now;
        rec.days[day] = dayCounts;
        if (await writeMonth(storage, ownerGhii, key, rec, version, row?.createdAt ?? now)) {
          return { counted: false, reason: 'daily-cap' };
        }
        continue;
      }

      dayCounts.total += 1;
      bump(dayCounts.events, event);
      bump(dayCounts.channels, channel);
      bump(dayCounts.classes, visitor.klass);
      if (visitor.aiAgent) {
        const agentKey = visitor.aiKind === 'assistant' ? `${visitor.aiAgent}:asked` : visitor.aiAgent;
        dayCounts.aiAgents[agentKey] = (dayCounts.aiAgents[agentKey] ?? 0) + 1;
      }
      rec.days[day] = dayCounts;

      if (subject) {
        // Own-property read only: an inherited name (`toString` and the like) must never masquerade
        // as an existing subject and hand back a builtin off the prototype chain.
        const known = Object.hasOwn(rec.subjects, subject) ? rec.subjects[subject] : undefined;
        if (known) {
          known.lastAt = now;
          bump(known.events, event);
          if (ref) known.lastRef = ref;
          if (visitor.klass !== 'human') known.machine = true;
        } else if (Object.keys(rec.subjects).length < MAX_SUBJECTS_PER_MONTH) {
          rec.subjects[subject] = {
            firstAt: now, lastAt: now, events: { [event]: 1 }, lastRef: ref,
            machine: visitor.klass !== 'human',
          };
        } else {
          rec.subjectsTruncated = true;
        }
      }
      rec.updatedAt = now;

      if (await writeMonth(storage, ownerGhii, key, rec, version, row?.createdAt ?? now)) {
        if (version === 0) await pruneOldMonths(storage, ownerGhii, streamId, month);
        return { counted: true, klass: visitor.klass, aiAgent: visitor.aiAgent };
      }
      // Lost the swap: another process counted between the read and the write. Read and re-apply.
    }
    logger.warn('signals: gave up counting a hit after repeated write conflicts', { streamId });
    return { counted: false, reason: 'conflict' };
  });
}

/** One swap attempt. True when this writer won. */
async function writeMonth(
  storage: Storage, ownerGhii: string, key: string, rec: SignalMonthRecord,
  version: number, createdAt: string,
): Promise<boolean> {
  const record = {
    key, ownerGaii: ownerGhii, value: rec as unknown as Record<string, unknown>,
    visibility: 'owner' as const, tags: ['signal-hits'], ttlHours: null,
    version: version + 1, createdAt, updatedAt: rec.updatedAt,
  } as MemoryRecord;
  try {
    if (version === 0) {
      if (!storage.createMemoryIfAbsent) { await storage.setMemory(record); return true; }
      return !!(await storage.createMemoryIfAbsent(record));
    }
    if (!storage.setMemoryIfVersion) { await storage.setMemory(record); return true; }
    return !!(await storage.setMemoryIfVersion(record, version));
  } catch (e) {
    logger.warn('signals: month record write failed', { key, error: String(e) });
    return false;
  }
}

/**
 * Drop month records past the retention window. Runs only when a NEW month record was created,
 * which is once per stream per month — cheap, self-cleaning, and no scheduled job to forget.
 */
async function pruneOldMonths(
  storage: Storage, ownerGhii: string, streamId: string, currentMonth: string,
): Promise<void> {
  try {
    const { items } = await storage.listAllMemory({ prefix: monthKeyPrefix(streamId), limit: 200 });
    const months = items
      .filter((r) => r.ownerGaii === ownerGhii)
      .map((r) => r.key.slice(monthKeyPrefix(streamId).length))
      .filter((m) => m < currentMonth)
      .sort()
      .reverse();
    for (const stale of months.slice(RETAIN_MONTHS - 1)) {
      await storage.deleteMemory(ownerGhii, monthKey(streamId, stale));
    }
  } catch (e) {
    logger.warn('signals: pruning old months failed', { streamId, error: String(e) });
  }
}

// ── Reading it back ───────────────────────────────────────────────────────────────────────────

export interface ReportOptions {
  /** `YYYY-MM` bounds, inclusive. Defaults to the current month only. */
  from?: string;
  to?: string;
  /** Include the per-subject roll-up. Off by default: a report is usually read as totals. */
  includeSubjects?: boolean;
}

export interface SignalReport {
  streamId: string;
  label: string;
  months: string[];
  totals: {
    hits: number;
    events: Record<string, number>;
    channels: Record<string, number>;
    classes: Record<string, number>;
    aiAgents: Record<string, number>;
    dropped: number;
  };
  days: Record<string, { total: number; events: Record<string, number>; classes: Record<string, number> }>;
  subjects?: Record<string, { firstAt: string; lastAt: string; events: Record<string, number>; lastRef: string | null; machine: boolean }>;
  subjectsTruncated: boolean;
  /**
   * What each number is worth, carried WITH the numbers rather than left to whoever renders them.
   * An open count that travels without this line gets read as "people who read it", which it is
   * not, and the person who repeats it to their own customer is the one who pays for the gap.
   */
  reading: { opens: string; clicks: string; ai: string };
}

export async function readReport(
  storage: Storage, ownerGhii: string, streamId: string, opts: ReportOptions = {},
): Promise<SignalReport> {
  const stream = await getStream(storage, ownerGhii, streamId);
  if (!stream) throw new SignalError('NOT_FOUND', 404, 'No such signal stream');

  const thisMonth = monthOf(nowIso());
  const from = opts.from && /^\d{4}-\d{2}$/.test(opts.from) ? opts.from : thisMonth;
  const to = opts.to && /^\d{4}-\d{2}$/.test(opts.to) ? opts.to : thisMonth;

  const { items } = await storage.listAllMemory({ prefix: monthKeyPrefix(streamId), limit: 200 });
  const records = items
    .filter((r) => r.ownerGaii === ownerGhii)
    .map((r) => r.value as unknown as SignalMonthRecord)
    .filter((m): m is SignalMonthRecord => !!m && typeof m.month === 'string')
    .filter((m) => m.month >= from && m.month <= to)
    .sort((a, b) => a.month.localeCompare(b.month));

  const totals: SignalReport['totals'] = {
    hits: 0, events: {}, channels: {}, classes: {}, aiAgents: {}, dropped: 0,
  };
  const days: SignalReport['days'] = {};
  const subjects: NonNullable<SignalReport['subjects']> = {};
  let truncated = false;

  const add = (into: Record<string, number>, from2: Record<string, number | undefined>): void => {
    for (const [k, v] of Object.entries(from2)) into[k] = (into[k] ?? 0) + (v ?? 0);
  };

  for (const rec of records) {
    totals.dropped += rec.dropped ?? 0;
    truncated = truncated || !!rec.subjectsTruncated;
    for (const [day, counts] of Object.entries(rec.days ?? {})) {
      totals.hits += counts.total;
      add(totals.events, counts.events);
      add(totals.channels, counts.channels);
      add(totals.classes, counts.classes);
      add(totals.aiAgents, counts.aiAgents ?? {});
      days[day] = {
        total: counts.total,
        events: { ...counts.events } as Record<string, number>,
        classes: { ...counts.classes } as Record<string, number>,
      };
    }
    if (opts.includeSubjects) {
      for (const [token, roll] of Object.entries(rec.subjects ?? {})) {
        const prev = subjects[token];
        subjects[token] = prev
          ? {
            firstAt: prev.firstAt < roll.firstAt ? prev.firstAt : roll.firstAt,
            lastAt: prev.lastAt > roll.lastAt ? prev.lastAt : roll.lastAt,
            events: (() => { const e = { ...prev.events }; add(e, roll.events); return e; })(),
            lastRef: roll.lastRef ?? prev.lastRef,
            machine: prev.machine || roll.machine,
          }
          : {
            firstAt: roll.firstAt, lastAt: roll.lastAt,
            events: { ...roll.events } as Record<string, number>,
            lastRef: roll.lastRef, machine: roll.machine,
          };
      }
    }
  }

  return {
    streamId, label: stream.label,
    months: records.map((r) => r.month),
    totals, days,
    subjects: opts.includeSubjects ? subjects : undefined,
    subjectsTruncated: truncated,
    reading: {
      opens: 'An estimate. Mail apps fetch images on the reader\'s behalf (Apple Mail always, and it cannot be told apart from a person), so treat opens as a floor with machine noise in it.',
      clicks: 'An act. Somebody chose the link, and known scanners are counted as machines instead.',
      ai: 'Named AI fetchers, split by why they came: a name ending in :asked means a person asked an AI something and it fetched this to answer.',
    },
  };
}
