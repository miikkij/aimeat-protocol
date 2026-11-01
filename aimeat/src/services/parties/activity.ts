/**
 * @file src/services/parties/activity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an outside party's reads leave behind, without a write per request (plan
 *   doc-mvwxcas3dom3, D2.9, D3.5; lead decision L3).
 *
 *   THREE THINGS ARE KEPT, EACH BATCHED:
 *     - the read log, `party-reads.<yyyy-mm>` per owner: every read a party made, served or refused,
 *       held in this process and written at most once every READ_LOG_FLUSH_MS per owner;
 *     - the party's own counters on the `parties` record: `lastSeenAt`, each key's `lastUsedAt` and
 *       `failedAttempts`, written at most once a minute per owner (TOUCH_FLUSH_MS);
 *     - the rate limit: a fixed one-minute window per party uid, in this process only.
 *   An owner read of the parties or the read log flushes that owner's pending entries first
 *   (flushOwner), so what the owner sees is current. A process that stops loses at most the entries
 *   of the last few seconds of the read log and the last minute of counters; nothing a read decides
 *   depends on them.
 *
 *   THE CAP. A month's record holds at most READ_LOG_MONTH_CAP entries (a record is at most 1024 kB;
 *   an entry is about 200 bytes). Past the cap an entry is not stored and the record's `dropped`
 *   counts it, so the owner sees how many reads the log could not keep. The first entries of the month
 *   stay; a refused read past the cap is counted the same way.
 * @structure READ_LOG_MONTH_CAP · PartyReadEntry · PartyReadLog · logPartyRead · noteKeyUse ·
 *   noteFailedAttempt · takeReadSlot · flushOwner · flushAll · readLogKey · parseReadLog
 * @usage logPartyRead(storage, ownerGhii, { at, share, party, uid, what, verdict: 'served' });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2.9, D3.5).
 */
import type { Storage } from '../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { logger } from '../../utils/logger.js';
import { PARTIES_KEY, PARTY_READS_PREFIX, parsePartiesValue } from './contract.js';

/** The most read entries one owner's month record keeps; past it they are counted in `dropped`. */
export const READ_LOG_MONTH_CAP = 4000;
/** How long read entries wait before they are written, per owner. */
const READ_LOG_FLUSH_MS = 2_000;
/** The shortest time between two writes of an owner's party counters. */
const TOUCH_FLUSH_MS = 60_000;

/** One read a party made. */
export interface PartyReadEntry {
    at: string;
    /** The share (consent id) the read was decided on, or null when no share named the package. */
    share: string | null;
    /** The party's name, and its uid so a name reused later is told apart. */
    party: string;
    uid: string;
    /** What was read: `<package>` or `<package>/<resource>`, and the endpoint kind. */
    what: string;
    rows?: number;
    verdict: 'served' | 'refused';
    /** The refusal's code, for a refused read. */
    code?: string;
}

export interface PartyReadLog {
    month: string;
    entries: PartyReadEntry[];
    dropped: number;
}

/** The read log key of the month `at` falls in. */
export function readLogKey(at: string | Date = new Date()): string {
    return `${PARTY_READS_PREFIX}${new Date(at).toISOString().slice(0, 7)}`;
}

export function parseReadLog(v: unknown, month: string): PartyReadLog {
    const r = (v && typeof v === 'object' ? v : {}) as Partial<PartyReadLog>;
    return { month: typeof r.month === 'string' ? r.month : month, entries: Array.isArray(r.entries) ? r.entries : [], dropped: Number(r.dropped) || 0 };
}

interface Touch { failed: number; lastSeenAt?: string; keys: Map<string, string> }
interface OwnerPending {
    storage: Storage;
    reads: PartyReadEntry[];
    readTimer?: ReturnType<typeof setTimeout>;
    touches: Map<string, Touch>;
    touchTimer?: ReturnType<typeof setTimeout>;
    lastTouchFlush: number;
}

const pending = new Map<string, OwnerPending>();

function pendingOf(storage: Storage, ownerGhii: string): OwnerPending {
    let p = pending.get(ownerGhii);
    if (!p) { p = { storage, reads: [], touches: new Map(), lastTouchFlush: 0 }; pending.set(ownerGhii, p); }
    p.storage = storage;
    return p;
}

function touchOf(p: OwnerPending, uid: string): Touch {
    let t = p.touches.get(uid);
    if (!t) { t = { failed: 0, keys: new Map() }; p.touches.set(uid, t); }
    return t;
}

function scheduleTouchFlush(ownerGhii: string, p: OwnerPending): void {
    if (p.touchTimer) return;
    const wait = Math.max(0, p.lastTouchFlush + TOUCH_FLUSH_MS - Date.now());
    p.touchTimer = setTimeout(() => { void flushTouches(ownerGhii); }, wait);
    p.touchTimer.unref?.();
}

/** A key of the party was used: the key's lastUsedAt and the party's lastSeenAt move, at most once a minute. */
export function noteKeyUse(storage: Storage, ownerGhii: string, uid: string, kid: string, at = new Date().toISOString()): void {
    const p = pendingOf(storage, ownerGhii);
    const t = touchOf(p, uid);
    t.lastSeenAt = at;
    t.keys.set(kid, at);
    scheduleTouchFlush(ownerGhii, p);
}

/** A wrong key was presented for the party (D2.9). */
export function noteFailedAttempt(storage: Storage, ownerGhii: string, uid: string): void {
    const p = pendingOf(storage, ownerGhii);
    touchOf(p, uid).failed++;
    scheduleTouchFlush(ownerGhii, p);
}

/** One read, served or refused, for the owner's read log. */
export function logPartyRead(storage: Storage, ownerGhii: string, entry: PartyReadEntry): void {
    const p = pendingOf(storage, ownerGhii);
    p.reads.push(entry);
    if (p.readTimer) return;
    p.readTimer = setTimeout(() => { void flushReads(ownerGhii); }, READ_LOG_FLUSH_MS);
    p.readTimer.unref?.();
}

async function flushReads(ownerGhii: string): Promise<void> {
    const p = pending.get(ownerGhii);
    if (!p) return;
    if (p.readTimer) { clearTimeout(p.readTimer); p.readTimer = undefined; }
    const batch = p.reads.splice(0);
    if (!batch.length) return;
    // An entry belongs to the month it happened in; a batch across a month boundary writes two records.
    const byKey = new Map<string, PartyReadEntry[]>();
    for (const e of batch) { const k = readLogKey(e.at); (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e); }
    for (const [key, entries] of byKey) {
        const month = key.slice(PARTY_READS_PREFIX.length);
        try {
            await updateRecord(p.storage, ownerGhii, key, v => parseReadLog(v, month), cur => {
                const room = Math.max(0, READ_LOG_MONTH_CAP - cur.entries.length);
                return { month, entries: [...cur.entries, ...entries.slice(0, room)], dropped: cur.dropped + Math.max(0, entries.length - room) };
            }, { tag: 'party-reads' });
        } catch (err) {
            logger.warn('party read log: a batch could not be written; those entries are lost', { owner: ownerGhii, entries: entries.length, error: String(err) });
        }
    }
}

async function flushTouches(ownerGhii: string): Promise<void> {
    const p = pending.get(ownerGhii);
    if (!p) return;
    if (p.touchTimer) { clearTimeout(p.touchTimer); p.touchTimer = undefined; }
    if (!p.touches.size) return;
    const touches = new Map(p.touches);
    p.touches.clear();
    p.lastTouchFlush = Date.now();
    try {
        await updateRecord(p.storage, ownerGhii, PARTIES_KEY, parsePartiesValue, cur => {
            let changed = false;
            const parties = cur.parties.map(party => {
                const t = touches.get(party.uid);
                if (!t) return party;
                changed = true;
                return {
                    ...party,
                    failedAttempts: (party.failedAttempts ?? 0) + t.failed,
                    ...(t.lastSeenAt ? { lastSeenAt: t.lastSeenAt } : {}),
                    keys: party.keys.map(k => (t.keys.has(k.id) ? { ...k, lastUsedAt: t.keys.get(k.id)! } : k)),
                };
            });
            // A party deleted meanwhile is not written back: its touches are dropped.
            return changed ? { parties } : UNCHANGED;
        }, { tag: 'parties' });
    } catch (err) {
        logger.warn('party counters: could not be written; the last minute of key use is lost', { owner: ownerGhii, error: String(err) });
    }
}

/** Write the owner's pending read entries and counters now. An owner read calls this first. */
export async function flushOwner(ownerGhii: string): Promise<void> {
    await flushReads(ownerGhii);
    await flushTouches(ownerGhii);
}

/** Write every owner's pending entries now: the node-wide counts read this first. */
export async function flushAll(): Promise<void> {
    for (const owner of [...pending.keys()]) await flushOwner(owner);
}

const windows = new Map<string, { start: number; count: number }>();

/**
 * May the party make one more read this minute? A fixed one-minute window per party uid, counted in
 * this process. False past `perMinute`; the caller answers 429.
 */
export function takeReadSlot(uid: string, perMinute: number, now = Date.now()): boolean {
    const w = windows.get(uid);
    if (!w || now - w.start >= 60_000) {
        if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
        windows.set(uid, { start: now, count: 1 });
        return true;
    }
    w.count++;
    return w.count <= perMinute;
}
