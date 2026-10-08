/**
 * @file src/services/visibility/visibility-counter.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Counts what reaches a place, by default and with no setup: page loads by channel,
 *   AI fetches by family and target, discovery-file fetches, and purchases by the channel they came
 *   from. The counts go into the owner's own month record (models/visibility-schemas.ts).
 *
 *   ON BY DEFAULT, AND THAT IS ONLY POSSIBLE BECAUSE OF WHAT IS NOT KEPT. No address, no cookie, no
 *   visitor id, no Referer, no query string. The owner can switch it off (visibility-settings.ts)
 *   and the operator can switch it off for the node (AIMEAT_AI_VISIBILITY). A request that sends
 *   `Sec-GPC: 1` or `DNT: 1` is counted in the day's total and nowhere else.
 *
 *   COUNTS ARE BUFFERED IN MEMORY AND MERGED, NOT WRITTEN PER REQUEST. Every app open now passes
 *   through here, and a month record of up to a few hundred kB rewritten on every page load would
 *   make serving an app cost a large write. The deltas are added up per owner and per day, and
 *   merged into the month record every FLUSH_MS, when BUFFER_LIMIT counts are waiting, and before
 *   any report is read. Every count is additive, so two node processes merging their own deltas
 *   with a compare-and-swap give the right sum. What a crash costs is the last FLUSH_MS of counts,
 *   which for an aggregate report is an accepted loss, written here so nobody mistakes it for one
 *   that is exact to the request.
 *
 *   NEVER BLOCKS AND NEVER THROWS. The callers are serve paths; a counter must not cost anybody
 *   their page.
 * @structure ownerCounts · resolvePlaceOwner · countVisit · recordPurchase ·
 *   flushVisibility · mergeDay · resetVisibilityState (tests)
 * @usage countVisit(storage, config, { ownerGaii, target: app.filename, ...visit });
 * @version-history
 *   v1.1.0 — 2026-10-08 — The owner's settings moved to visibility-settings.ts, which also holds the
 *     analytics tag ids of layer B.
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import {
  VISIBILITY_DOCS, PURCHASE_VIA, VISIT_CHANNELS, AI_FAMILIES, MAX_PATHS_PER_DAY, MAX_TARGET_LEN,
  VISIBILITY_RETAIN_MONTHS, VISIBILITY_MONTH_PREFIX, visibilityMonthKey,
  emptyVisibilityDay, emptyVisibilityMonth,
  type VisibilityDay, type VisibilityDoc, type VisibilityMonthRecord,
  type PurchaseVia, type VisitChannel, type AiFamily,
} from '../../models/visibility-schemas.js';
import { monthOf, dayOf } from '../../models/signal-schemas.js';
import { classifyVisitor } from '../signals/visitor-class.js';
import { withKeyLock } from '../signals/signal-service.js';
import { classifyChannel } from './channel.js';
import { cachedVisibilitySettings, resetVisibilitySettingsCache } from './visibility-settings.js';
import { ownerGhiiOf, localAccountOf } from '../../utils/gaii.js';
import { isOperatorAccount } from '../../utils/operator-account.js';
import { logger } from '../../utils/logger.js';

/** How long buffered counts wait before they are merged. */
const FLUSH_MS = 10_000;
/** Merge sooner when this many counts are waiting for one storage. */
const BUFFER_LIMIT = 500;
/** How many times a merge re-reads after losing a swap to another process. */
const CAS_ATTEMPTS = 25;

const nowIso = (): string => new Date().toISOString();

/** Keys that would reach an object's prototype if used as a map key. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const bump = (obj: Record<string, number>, key: string, by = 1): void => {
  obj[key] = (obj[key] ?? 0) + by;
};

// ── The owner's switch ────────────────────────────────────────────────────────────────────────

/** Whether this owner counts, from the settings record (visibility-settings.ts). Absent means on. */
async function ownerCounts(storage: Storage, ownerGhii: string): Promise<boolean> {
  return (await cachedVisibilitySettings(storage, ownerGhii)).enabled;
}

/** Whether the operator left this layer on for the node. On unless set to false. */
export const nodeCountsVisibility = (config: AimeatConfig): boolean => config.aiVisibilityEnabled !== false;

// ── Whose place the apex is ───────────────────────────────────────────────────────────────────

const placeOwnerCache = new Map<string, string>();

/**
 * The owner the node's own documents count into (the apex `llms.txt`, `/.well-known/ucp`): the
 * operator account. On a place sold to one customer that is the customer; on a shared node it is
 * whoever runs it. Null on a node with no operator yet, and then nothing is counted.
 */
export async function resolvePlaceOwner(storage: Storage, config: AimeatConfig): Promise<string | null> {
  // The cached answer is re-checked with one key read, because the operator can change (and a test
  // node is emptied between suites): counting into an account that no longer runs the node would
  // put the counts where nobody reads them. The full list is read only when the check fails.
  const cached = placeOwnerCache.get(config.nodeId);
  if (cached) {
    const name = localAccountOf(cached);
    if (name && isOperatorAccount(await storage.getOwner(name))) return cached;
    placeOwnerCache.delete(config.nodeId);
  }
  const owners = await storage.listOwners();
  const op = owners.find(isOperatorAccount);
  const ghii = op ? `${op.name}@${config.nodeId}` : null;
  // A node with no operator yet is asked again on the next request rather than cached as "nobody".
  if (ghii) placeOwnerCache.set(config.nodeId, ghii);
  return ghii;
}

// ── The buffer ────────────────────────────────────────────────────────────────────────────────

interface Pending {
  /** owner GHII → day → delta. */
  owners: Map<string, Map<string, VisibilityDay>>;
  count: number;
  timer: NodeJS.Timeout | null;
  /** A merge is already scheduled because the buffer reached its limit. */
  soon: boolean;
}
const pendingByStorage = new WeakMap<Storage, Pending>();
/** Storages with counts waiting, so a shutdown or a test can flush them all. */
const liveStorages = new Set<Storage>();

function pendingFor(storage: Storage): Pending {
  let p = pendingByStorage.get(storage);
  if (!p) { p = { owners: new Map(), count: 0, timer: null, soon: false }; pendingByStorage.set(storage, p); }
  return p;
}

function deltaDay(storage: Storage, ownerGhii: string, day: string): VisibilityDay {
  const p = pendingFor(storage);
  let days = p.owners.get(ownerGhii);
  if (!days) { days = new Map(); p.owners.set(ownerGhii, days); }
  let d = days.get(day);
  if (!d) { d = emptyVisibilityDay(); days.set(day, d); }
  p.count++;
  liveStorages.add(storage);
  // setImmediate rather than a direct call: the caller fills `d` in after this returns, and a merge
  // started synchronously could take the delta out of the buffer before it holds the count.
  if (p.count >= BUFFER_LIMIT) {
    if (!p.soon) { p.soon = true; setImmediate(() => { void flushVisibility(storage); }); }
  } else if (!p.timer) {
    p.timer = setTimeout(() => { void flushVisibility(storage); }, FLUSH_MS);
    p.timer.unref?.();
  }
  return d;
}

/** A target made safe to be a map key: printable, no prototype name, bounded. */
function cleanTarget(raw: string): string | null {
  let out = '';
  for (const ch of raw) out += ch.charCodeAt(0) < 32 ? ' ' : ch;
  const t = out.trim().slice(0, MAX_TARGET_LEN);
  return t && !FORBIDDEN_KEYS.has(t) ? t : null;
}

const familyOrOther = (name: string | null | undefined): string =>
  name && (AI_FAMILIES as readonly string[]).includes(name) ? name : (name ? name.replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'other' : 'other');

// ── Counting ──────────────────────────────────────────────────────────────────────────────────

export interface VisitInput {
  /** The publisher, as stored on the record. An agent GAII resolves to its owner. */
  ownerGaii: string;
  /** What was fetched: an app's filename, `portfolio`, a document path. Owner-published, never a raw URL. */
  target: string;
  /** Set when the target is one of the discovery files. */
  doc?: VisibilityDoc | null;
  userAgent?: string | null;
  referer?: string | null;
  utmSource?: string | null;
  /** `Sec-GPC: 1` or `DNT: 1` was sent. */
  optedOut?: boolean;
  /** Hosts that belong to this place, so a move between its pages reads as internal. */
  selfHosts?: Array<string | null | undefined>;
}

/** Count one request. Fire and forget: callers do not await this. */
export function countVisit(storage: Storage, config: AimeatConfig, input: VisitInput): void {
  if (!nodeCountsVisibility(config)) return;
  void (async () => {
    try {
      const ownerGhii = ownerGhiiOf(input.ownerGaii);
      if (!(await ownerCounts(storage, ownerGhii))) return;
      const d = deltaDay(storage, ownerGhii, dayOf(nowIso()));
      d.total += 1;
      if (input.optedOut) { d.optedOut += 1; return; }

      const visitor = classifyVisitor(input.userAgent);
      bump(d.classes, visitor.klass);
      const target = cleanTarget(input.target);
      const path = target ? (d.paths[target] ??= { h: 0, a: {}, c: {} }) : null;
      const family = familyOrOther(visitor.aiAgent);

      if (visitor.klass === 'ai') {
        if (visitor.aiKind === 'assistant') { bump(d.assistant, family); if (path) bump(path.a, family); }
        else { bump(d.crawler, family); if (path) bump(path.c, family); }
      } else if (visitor.klass === 'human') {
        if (path) path.h += 1;
        // A discovery file is read by a program, so where a person "came from" when opening one
        // means nothing; channels are counted for pages only.
        if (!input.doc) {
          const ch = classifyChannel({ referer: input.referer, utmSource: input.utmSource, selfHosts: input.selfHosts });
          bump(d.channels as Record<string, number>, ch.channel);
          if (ch.family) bump(d.aiReferrals, ch.family);
        }
      }
      if (input.doc && (VISIBILITY_DOCS as readonly string[]).includes(input.doc)) {
        const by = (d.discovery[input.doc] ??= {});
        bump(by, visitor.klass === 'ai' ? family : visitor.klass);
      }
    } catch (e) {
      logger.warn('visibility: a visit could not be counted', { error: String(e) });
    }
  })();
}

export interface PurchaseInput {
  sellerGhii: string;
  /** `none`: not attributed (the buyer opted out, or nothing said where they came from). */
  channel: VisitChannel | 'none';
  family?: AiFamily | string | null;
  via: PurchaseVia;
  /** In the session's currency unit: 6-decimal micro-units for money, whole morsels for morsels. */
  amount: number;
  currency: string;
}

/** Count one completed purchase under the channel it came from. Never throws. */
export function recordPurchase(storage: Storage, config: AimeatConfig, input: PurchaseInput): void {
  if (!nodeCountsVisibility(config)) return;
  void (async () => {
    try {
      const ownerGhii = ownerGhiiOf(input.sellerGhii);
      if (!(await ownerCounts(storage, ownerGhii))) return;
      const channel = (VISIT_CHANNELS as readonly string[]).includes(input.channel) ? input.channel : 'none';
      const via = (PURCHASE_VIA as readonly string[]).includes(input.via) ? input.via : 'page';
      const family = channel === 'ai' ? familyOrOther(input.family ?? null) : '';
      const currency = /^[A-Za-z]{3,10}$/.test(input.currency) ? input.currency.toUpperCase() : 'OTHER';
      const d = deltaDay(storage, ownerGhii, dayOf(nowIso()));
      const p = (d.purchases[`${channel}|${family}|${via}`] ??= { n: 0, amounts: {} });
      p.n += 1;
      if (Number.isFinite(input.amount) && input.amount > 0) bump(p.amounts, currency, Math.round(input.amount));
    } catch (e) {
      logger.warn('visibility: a purchase could not be counted', { error: String(e) });
    }
  })();
}

// ── Merging ───────────────────────────────────────────────────────────────────────────────────

const addAll = (into: Record<string, number>, from: Record<string, number | undefined>): void => {
  for (const [k, v] of Object.entries(from)) if (!FORBIDDEN_KEYS.has(k)) bump(into, k, v ?? 0);
};

/** Add one day's delta into the stored day. The path table stops at `pathCap` (a stored day keeps
 *  MAX_PATHS_PER_DAY; a report summing many days passes Infinity). */
export function mergeDay(into: VisibilityDay, delta: VisibilityDay, pathCap = MAX_PATHS_PER_DAY): void {
  into.total += delta.total;
  into.optedOut += delta.optedOut;
  addAll(into.classes, delta.classes);
  addAll(into.channels as Record<string, number>, delta.channels as Record<string, number>);
  addAll(into.aiReferrals, delta.aiReferrals);
  addAll(into.assistant, delta.assistant);
  addAll(into.crawler, delta.crawler);
  into.pathsOther += delta.pathsOther;
  for (const [target, counts] of Object.entries(delta.paths)) {
    if (FORBIDDEN_KEYS.has(target)) continue;
    let slot = Object.hasOwn(into.paths, target) ? into.paths[target] : undefined;
    if (!slot) {
      if (Object.keys(into.paths).length >= pathCap) {
        into.pathsOther += counts.h + sumOf(counts.a) + sumOf(counts.c);
        continue;
      }
      slot = { h: 0, a: {}, c: {} };
      into.paths[target] = slot;
    }
    slot.h += counts.h;
    addAll(slot.a, counts.a);
    addAll(slot.c, counts.c);
  }
  for (const [doc, by] of Object.entries(delta.discovery)) {
    if (FORBIDDEN_KEYS.has(doc)) continue;
    addAll((into.discovery[doc] ??= {}), by);
  }
  for (const [key, p] of Object.entries(delta.purchases)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const slot = (into.purchases[key] ??= { n: 0, amounts: {} });
    slot.n += p.n;
    addAll(slot.amounts, p.amounts);
  }
}

export const sumOf = (o: Record<string, number | undefined>): number =>
  Object.values(o).reduce<number>((n, v) => n + (v ?? 0), 0);

/** Fill the fields a day written by an older shape may lack, so a merge never meets undefined. */
function normalizeDay(day: Partial<VisibilityDay> | undefined): VisibilityDay {
  return { ...emptyVisibilityDay(), ...(day ?? {}) } as VisibilityDay;
}

async function mergeOwnerMonth(
  storage: Storage, ownerGhii: string, month: string, days: Map<string, VisibilityDay>,
): Promise<void> {
  const key = visibilityMonthKey(month);
  await withKeyLock(`${ownerGhii}|${key}`, async () => {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const row = await storage.getMemory(ownerGhii, key);
      const version = row?.version ?? 0;
      const now = nowIso();
      const rec: VisibilityMonthRecord = row
        ? (row.value as unknown as VisibilityMonthRecord)
        : emptyVisibilityMonth(month, now);
      rec.days = rec.days ?? {};
      for (const [day, delta] of days) {
        const stored = normalizeDay(rec.days[day]);
        mergeDay(stored, delta);
        rec.days[day] = stored;
      }
      rec.updatedAt = now;
      const record = {
        key, ownerGaii: ownerGhii, value: rec as unknown as Record<string, unknown>,
        visibility: 'owner' as const, tags: ['signal-visibility'], ttlHours: null,
        version: version + 1, createdAt: row?.createdAt ?? now, updatedAt: now,
      } as MemoryRecord;
      let won: boolean;
      if (version === 0) {
        won = storage.createMemoryIfAbsent ? !!(await storage.createMemoryIfAbsent(record)) : (await storage.setMemory(record), true);
      } else {
        won = storage.setMemoryIfVersion ? !!(await storage.setMemoryIfVersion(record, version)) : (await storage.setMemory(record), true);
      }
      if (won) {
        if (version === 0) await pruneOldMonths(storage, ownerGhii, month);
        return;
      }
    }
    logger.warn('visibility: gave up merging counts after repeated write conflicts', { ownerGhii, month });
  });
}

/** Drop months past the retention window. Runs when a new month record is created. */
async function pruneOldMonths(storage: Storage, ownerGhii: string, currentMonth: string): Promise<void> {
  try {
    const rows = await storage.listMemoryMeta(ownerGhii, { prefix: VISIBILITY_MONTH_PREFIX });
    const months = rows
      .map((r) => r.key.slice(VISIBILITY_MONTH_PREFIX.length))
      .filter((m) => m < currentMonth)
      .sort()
      .reverse();
    for (const stale of months.slice(VISIBILITY_RETAIN_MONTHS - 1)) {
      await storage.deleteMemory(ownerGhii, visibilityMonthKey(stale));
    }
  } catch (e) {
    logger.warn('visibility: pruning old months failed', { ownerGhii, error: String(e) });
  }
}

/**
 * Merge every buffered count for one storage (or one owner on it) into the month records. Called
 * by the timer, by the buffer limit, and by the report before it reads, so an owner who asks
 * always sees what this process has counted.
 */
export async function flushVisibility(storage: Storage, onlyOwner?: string): Promise<void> {
  const p = pendingByStorage.get(storage);
  if (!p) return;
  if (!onlyOwner) p.soon = false;
  if (p.owners.size === 0) return;
  const owners = onlyOwner ? [onlyOwner].filter((o) => p.owners.has(o)) : [...p.owners.keys()];
  const taken = new Map<string, Map<string, VisibilityDay>>();
  for (const owner of owners) {
    taken.set(owner, p.owners.get(owner)!);
    p.owners.delete(owner);
  }
  if (p.owners.size === 0) {
    p.count = 0;
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
    liveStorages.delete(storage);
  }
  for (const [owner, days] of taken) {
    // An account erased while its counts waited here gets no record back: a merge would recreate
    // data the erasure removed. One key read per owner per merge.
    try {
      const name = localAccountOf(owner);
      if (!name || !(await storage.getOwner(name))) continue;
    } catch (e) {
      logger.warn('visibility: the owner could not be read before a merge', { owner, error: String(e) });
      continue;
    }
    const byMonth = new Map<string, Map<string, VisibilityDay>>();
    for (const [day, delta] of days) {
      const m = monthOf(day);
      if (!byMonth.has(m)) byMonth.set(m, new Map());
      byMonth.get(m)!.set(day, delta);
    }
    for (const [month, monthDays] of byMonth) {
      try {
        await mergeOwnerMonth(storage, owner, month, monthDays);
      } catch (e) {
        logger.warn('visibility: merging counts failed', { owner, month, error: String(e) });
      }
    }
  }
}

/** Merge everything waiting on every storage. For a clean shutdown. */
export async function flushAllVisibility(): Promise<void> {
  for (const storage of [...liveStorages]) await flushVisibility(storage);
}

/** Test seam: forget the caches. Buffered counts are flushed first. */
export async function resetVisibilityState(storage?: Storage): Promise<void> {
  if (storage) await flushVisibility(storage);
  resetVisibilitySettingsCache();
  placeOwnerCache.clear();
}
