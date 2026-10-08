/**
 * @file src/services/visibility/behaviour-counter.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Counts what the behaviour script reports for one page view (AI visibility, layer D)
 *   into the app's own record (`signals.behaviour.app.<filename>`, models/behaviour-schemas.ts).
 *
 *   BUFFERED AND MERGED, like the visibility counter: a view's counts are added to a delta per owner,
 *   app and day, and merged into the record with a compare-and-swap every FLUSH_MS, when
 *   BUFFER_LIMIT views wait, and before a report is read. A crash loses the last FLUSH_MS of counts.
 *
 *   A BEACON IS UNTRUSTED. Anyone can post one, so everything is bounded twice: here, per view
 *   (MAX_CLICKS_PER_BEACON clicks, MAX_ELEMENTS_PER_BEACON elements, grid cells in range, element
 *   names cleaned), and in the stored day (MAX_HEAT_CELLS_PER_DAY, MAX_ELEMENTS_PER_DAY). A forged
 *   beacon buys wrong rows in one app's report and nothing else, the same posture as a forged
 *   User-Agent in the visibility counts.
 *
 *   NEVER THROWS. The caller is a public endpoint whose answer does not depend on the count.
 * @structure recordBehaviour · flushBehaviour · mergeBehaviourDay · BehaviourBeacon
 * @usage recordBehaviour(storage, { ownerGhii, app, optedOut, vc, scroll, heat, dead, rage });
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer D).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import {
  VIEWPORT_CLASSES, SCROLL_BUCKETS, HEAT_COLS, HEAT_ROWS, BEHAVIOUR_RETAIN_DAYS,
  MAX_HEAT_CELLS_PER_DAY, MAX_ELEMENTS_PER_DAY, MAX_ELEMENT_LEN, MAX_CLICKS_PER_BEACON, MAX_ELEMENTS_PER_BEACON,
  behaviourAppKey, emptyBehaviourDay, type BehaviourDay, type BehaviourAppRecord,
} from '../../models/behaviour-schemas.js';
import { dayOf } from '../../models/signal-schemas.js';
import { withKeyLock } from '../signals/signal-service.js';
import { localAccountOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

const FLUSH_MS = 10_000;
const BUFFER_LIMIT = 300;
const CAS_ATTEMPTS = 25;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const bump = (o: Record<string, number>, k: string, by = 1): void => { o[k] = (o[k] ?? 0) + by; };

/** One page view's report, as the endpoint parsed it. */
export interface BehaviourBeacon {
  ownerGhii: string;
  app: string;
  /** The browser asked not to be followed: the view counts in `views` and `optedOut` only. */
  optedOut: boolean;
  vc?: string;
  scroll?: string;
  heat?: Record<string, Record<string, number>>;
  dead?: Record<string, number>;
  rage?: Record<string, number>;
}

/** An element name made safe to be a key: the script's own shape (`tag#id.class`), nothing else. */
function cleanElement(raw: string): string | null {
  const s = raw.slice(0, MAX_ELEMENT_LEN);
  return /^[a-z][a-z0-9-]*(#[\w-]{1,30})?(\.[\w-]{1,30})?$/i.test(s) && !FORBIDDEN_KEYS.has(s) ? s.toLowerCase() : null;
}

const isVc = (v: unknown): v is string => typeof v === 'string' && (VIEWPORT_CLASSES as readonly string[]).includes(v);

/** The view's counts, bounded, as a day delta. */
export function beaconDelta(b: BehaviourBeacon): BehaviourDay {
  const d = emptyBehaviourDay();
  d.views = 1;
  if (b.optedOut) { d.optedOut = 1; return d; }
  if (isVc(b.vc)) d.vc[b.vc] = 1;
  if (typeof b.scroll === 'string' && (SCROLL_BUCKETS as readonly string[]).includes(b.scroll)) d.scroll[b.scroll] = 1;
  let clicks = 0;
  for (const [vc, cells] of Object.entries(b.heat ?? {})) {
    if (!isVc(vc) || !cells || typeof cells !== 'object') continue;
    for (const [cell, n] of Object.entries(cells)) {
      const m = /^(\d{1,2}),(\d{1,2})$/.exec(cell);
      if (!m || Number(m[1]) >= HEAT_COLS || Number(m[2]) >= HEAT_ROWS) continue;
      const take = Math.min(Math.floor(Number(n)) || 0, MAX_CLICKS_PER_BEACON - clicks);
      if (take <= 0) continue;
      bump((d.heat[vc] ??= {}), `${Number(m[1])},${Number(m[2])}`, take);
      clicks += take;
    }
  }
  for (const [field, into] of [['dead', d.dead], ['rage', d.rage]] as const) {
    let kept = 0;
    for (const [key, n] of Object.entries(b[field] ?? {})) {
      if (kept >= MAX_ELEMENTS_PER_BEACON) break;
      const [vc, el] = key.split('|');
      const element = el ? cleanElement(el) : null;
      const count = Math.min(Math.floor(Number(n)) || 0, 50);
      if (!isVc(vc) || !element || count <= 0) continue;
      bump(into, `${vc}|${element}`, count);
      kept++;
    }
  }
  return d;
}

// ── The buffer ────────────────────────────────────────────────────────────────────────────────

interface Pending {
  /** `owner|app` → day → delta. */
  apps: Map<string, Map<string, BehaviourDay>>;
  count: number;
  timer: NodeJS.Timeout | null;
}
const pendingByStorage = new WeakMap<Storage, Pending>();

function pendingFor(storage: Storage): Pending {
  let p = pendingByStorage.get(storage);
  if (!p) { p = { apps: new Map(), count: 0, timer: null }; pendingByStorage.set(storage, p); }
  return p;
}

/** Count one page view. Never throws. */
export function recordBehaviour(storage: Storage, beacon: BehaviourBeacon): void {
  try {
    const delta = beaconDelta(beacon);
    const p = pendingFor(storage);
    const slot = `${beacon.ownerGhii}|${beacon.app}`;
    let days = p.apps.get(slot);
    if (!days) { days = new Map(); p.apps.set(slot, days); }
    const day = dayOf(new Date().toISOString());
    const into = days.get(day);
    if (into) mergeBehaviourDay(into, delta, true); else days.set(day, delta);
    p.count++;
    if (p.count >= BUFFER_LIMIT) setImmediate(() => { void flushBehaviour(storage); });
    else if (!p.timer) {
      p.timer = setTimeout(() => { void flushBehaviour(storage); }, FLUSH_MS);
      p.timer.unref?.();
    }
  } catch (e) {
    logger.warn('behaviour: a page view could not be counted', { error: String(e) });
  }
}

const addAll = (into: Record<string, number>, from: Record<string, number | undefined>): void => {
  for (const [k, v] of Object.entries(from)) if (!FORBIDDEN_KEYS.has(k)) bump(into, k, v ?? 0);
};

/** Counts added in; no new key past `cap`, and what does not fit is `other`. */
function addCapped(into: Record<string, number>, from: Record<string, number>, cap: number): number {
  let spilled = 0;
  for (const [k, v] of Object.entries(from)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (Object.hasOwn(into, k) || Object.keys(into).length < cap) bump(into, k, v ?? 0);
    else spilled += v ?? 0;
  }
  return spilled;
}

/** Add one day's delta into another. A stored day keeps the caps; a buffer or a report summing days is `uncapped`. */
export function mergeBehaviourDay(into: BehaviourDay, delta: BehaviourDay, uncapped = false): void {
  const cells = uncapped ? Infinity : MAX_HEAT_CELLS_PER_DAY;
  const elements = uncapped ? Infinity : MAX_ELEMENTS_PER_DAY;
  into.views += delta.views;
  into.optedOut += delta.optedOut;
  addAll(into.vc, delta.vc);
  addAll(into.scroll, delta.scroll);
  into.heatOther += delta.heatOther;
  for (const [vc, grid] of Object.entries(delta.heat)) {
    if (FORBIDDEN_KEYS.has(vc)) continue;
    into.heatOther += addCapped((into.heat[vc] ??= {}), grid, cells);
  }
  const deadSpill = addCapped(into.dead, delta.dead, elements);
  if (deadSpill) bump(into.dead, 'other|other', deadSpill);
  const rageSpill = addCapped(into.rage, delta.rage, elements);
  if (rageSpill) bump(into.rage, 'other|other', rageSpill);
}

export function normalizeBehaviourDay(day: Partial<BehaviourDay> | undefined): BehaviourDay {
  return { ...emptyBehaviourDay(), ...(day ?? {}) } as BehaviourDay;
}

async function mergeApp(storage: Storage, ownerGhii: string, app: string, days: Map<string, BehaviourDay>): Promise<void> {
  const key = behaviourAppKey(app);
  await withKeyLock(`${ownerGhii}|${key}`, async () => {
    const oldest = dayOf(new Date(Date.now() - BEHAVIOUR_RETAIN_DAYS * 86_400_000).toISOString());
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const row = await storage.getMemory(ownerGhii, key);
      const version = row?.version ?? 0;
      const now = new Date().toISOString();
      const rec: BehaviourAppRecord = row
        ? (row.value as unknown as BehaviourAppRecord)
        : { type: 'aimeat.behaviour.app', spec: '/docs/specs/visibility-contract.md', app, days: {}, updatedAt: now };
      rec.days = rec.days ?? {};
      for (const [day, delta] of days) {
        const stored = normalizeBehaviourDay(rec.days[day]);
        mergeBehaviourDay(stored, delta);
        rec.days[day] = stored;
      }
      // The window moves on every merge, so the record never holds more than BEHAVIOUR_RETAIN_DAYS.
      for (const day of Object.keys(rec.days)) if (day < oldest) delete rec.days[day];
      rec.updatedAt = now;
      const record = {
        key, ownerGaii: ownerGhii, value: rec as unknown as Record<string, unknown>,
        visibility: 'owner' as const, tags: ['signal-visibility'], ttlHours: null,
        version: version + 1, createdAt: row?.createdAt ?? now, updatedAt: now,
      } as MemoryRecord;
      const won = version === 0
        ? (storage.createMemoryIfAbsent ? !!(await storage.createMemoryIfAbsent(record)) : (await storage.setMemory(record), true))
        : (storage.setMemoryIfVersion ? !!(await storage.setMemoryIfVersion(record, version)) : (await storage.setMemory(record), true));
      if (won) return;
    }
    logger.warn('behaviour: gave up merging counts after repeated write conflicts', { ownerGhii, app });
  });
}

/** Merge every buffered view (or one owner's) into the app records. */
export async function flushBehaviour(storage: Storage, onlyOwner?: string): Promise<void> {
  const p = pendingByStorage.get(storage);
  if (!p || p.apps.size === 0) return;
  const slots = [...p.apps.keys()].filter((s) => !onlyOwner || s.startsWith(`${onlyOwner}|`));
  const taken = new Map<string, Map<string, BehaviourDay>>();
  for (const s of slots) { taken.set(s, p.apps.get(s)!); p.apps.delete(s); }
  if (p.apps.size === 0) {
    p.count = 0;
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  }
  for (const [slot, days] of taken) {
    const cut = slot.indexOf('|');
    const owner = slot.slice(0, cut);
    const app = slot.slice(cut + 1);
    try {
      // An account erased while its counts waited gets no record back.
      const name = localAccountOf(owner);
      if (!name || !(await storage.getOwner(name))) continue;
      await mergeApp(storage, owner, app, days);
    } catch (e) {
      logger.warn('behaviour: a merge failed; these counts are lost', { owner, app, error: String(e) });
    }
  }
}
