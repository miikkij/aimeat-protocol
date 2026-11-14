/**
 * @file src/services/receivers/deliveries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a receiver's deliveries leave behind, without a write per request: the delivery
 *   log and the counters the owner and the operator read, and the per-minute and per-day limits.
 *
 *   BATCHED, as the outside party's read log is (services/parties/activity.ts, whose per-minute
 *   window takeReadSlot this module reuses). Entries are held in this process per owner and written
 *   at most once every FLUSH_MS into the receiver's own log record `receiver-log.<name>` in the
 *   owner's service namespace. It is a separate record from the receiver itself, so a counter write
 *   never writes over a key rotation, a pause or a stop made in between. An owner read of a receiver
 *   flushes that owner's pending entries first (flushReceiverLogs), so what the owner sees is current.
 *   A process that stops loses at most the last few seconds of entries; nothing a delivery decides
 *   reads them, except the day count, which is kept in this process.
 *
 *   NO CONTENT IS KEPT. An entry is the time, the verb, the status and code, the size, and which key
 *   or row it reached: never the body, never the caller's address.
 *
 *   THE DAY LIMIT is counted per process from the receiver's uid and the UTC date. A node running
 *   several processes lets each count its own day, so the limit is a ceiling per process, which is
 *   said in the setting's explanation and the IT adoption page.
 * @structure LOG_CAP · DeliveryEntry · ReceiverLog · parseReceiverLog · logDelivery · noteWrongKey ·
 *   takeMinuteSlot · takeDaySlot · flushReceiverLogs · flushAllReceiverLogs · readReceiverLog ·
 *   holdReceiverLogsForErasure
 * @usage logDelivery(storage, ownerGhii, 'ruuvi', { at, verb: 'write', status: 201, bytes: 120, key: 'ruuvit.olohuone' });
 * @version-history
 *   v1.1.0 — 2026-11-14 — holdReceiverLogsForErasure: before the erasure cascade, the owner's waiting
 *     delivery entries are dropped and a write in progress answers, and none of the owner's is kept
 *     until it ends. A waiting entry wrote the receiver's log back into the erased person's service
 *     namespace (register finding f-2026-11-13-write-buffers-and-erasure).
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import type { Storage } from '../../storage/interface.js';
import { serviceNamespaceOf } from '../service-records.js';
import { updateRecord } from '../record-cas.js';
import { takeReadSlot } from '../parties/activity.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../event-bus.js';
import { RECEIVER_LOG_PREFIX } from './contract.js';
import { ErasureHolds, type ErasedAccount } from '../erasure/holds.js';

/** The most entries a receiver's log keeps: the newest ones. */
export const LOG_CAP = 200;

/** How long entries wait in this process before they are written. */
const FLUSH_MS = 5_000;

/** One delivery, served or refused. */
export interface DeliveryEntry {
    at: string;
    verb: string;
    status: number;
    /** The refusal code, absent on a success. */
    code?: string;
    /** For a refusal, the sentence the program was answered with (at most 300 characters). */
    reason?: string;
    bytes: number;
    key?: string;
    rowIds?: string[];
    dryRun?: boolean;
}

/** The log record of one receiver. */
export interface ReceiverLog {
    entries: DeliveryEntry[];
    failedAttempts: number;
    lastDeliveryAt: string | null;
    lastRefusalAt: string | null;
    /** Deliveries and refusals per UTC day, the last 14 days. */
    days: Array<{ date: string; delivered: number; refused: number }>;
}

/** The stored log, read defensively. */
export function parseReceiverLog(v: unknown): ReceiverLog {
    const o = (v && typeof v === 'object' ? v : {}) as Partial<ReceiverLog>;
    return {
        entries: Array.isArray(o.entries) ? o.entries.filter(e => e && typeof e === 'object' && typeof e.at === 'string') : [],
        failedAttempts: typeof o.failedAttempts === 'number' ? o.failedAttempts : 0,
        lastDeliveryAt: typeof o.lastDeliveryAt === 'string' ? o.lastDeliveryAt : null,
        lastRefusalAt: typeof o.lastRefusalAt === 'string' ? o.lastRefusalAt : null,
        days: Array.isArray(o.days) ? o.days.filter(d => d && typeof d.date === 'string') : [],
    };
}

interface Pending { storage: Storage; byName: Map<string, { entries: DeliveryEntry[]; wrongKeys: number }>; timer?: ReturnType<typeof setTimeout> }
// process-local: a second process keeps its own batch; both write on the record's version, so only a stopping process's last seconds are lost.
const pending = new Map<string, Pending>();
/** The owners whose erasure runs now, whose entries are not kept, and the writes in progress an
 *  erasure waits for (holdReceiverLogsForErasure). */
const erasing = new ErasureHolds();

function pendingOf(storage: Storage, ownerGhii: string): Pending {
    let p = pending.get(ownerGhii);
    if (!p) { p = { storage, byName: new Map() }; pending.set(ownerGhii, p); }
    return p;
}

function slotOf(p: Pending, name: string) {
    let s = p.byName.get(name);
    if (!s) { s = { entries: [], wrongKeys: 0 }; p.byName.set(name, s); }
    return s;
}

function schedule(ownerGhii: string, p: Pending): void {
    if (p.timer) return;
    p.timer = setTimeout(() => { void flushReceiverLogs(ownerGhii); }, FLUSH_MS);
    p.timer.unref?.();
}

/** One delivery of the receiver, for its log. */
export function logDelivery(storage: Storage, ownerGhii: string, name: string, entry: DeliveryEntry): void {
    // An owner being erased: the cascade deletes the log, so it is not started again.
    if (erasing.covers(ownerGhii)) return;
    const p = pendingOf(storage, ownerGhii);
    slotOf(p, name).entries.push(entry.reason && entry.reason.length > 300 ? { ...entry, reason: entry.reason.slice(0, 300) } : entry);
    schedule(ownerGhii, p);
}

/** A wrong key was presented for the receiver. */
export function noteWrongKey(storage: Storage, ownerGhii: string, name: string): void {
    if (erasing.covers(ownerGhii)) return;
    const p = pendingOf(storage, ownerGhii);
    slotOf(p, name).wrongKeys++;
    schedule(ownerGhii, p);
}

/** May the receiver take one more message this minute? */
export function takeMinuteSlot(uid: string, perMinute: number, now = Date.now()): boolean {
    return takeReadSlot(`receiver:${uid}`, perMinute, now);
}

// process-local: each process counts its own day, so the day limit is a ceiling per process.
const dayCounts = new Map<string, number>();

/** May the receiver take one more message today (UTC)? Counted in this process. */
export function takeDaySlot(uid: string, perDay: number, now = new Date()): boolean {
    const date = now.toISOString().slice(0, 10);
    const k = `${uid}|${date}`;
    if (dayCounts.size > 20_000) for (const key of dayCounts.keys()) if (!key.endsWith(date)) dayCounts.delete(key);
    const n = (dayCounts.get(k) ?? 0) + 1;
    dayCounts.set(k, n);
    return n <= perDay;
}

function addToDays(days: ReceiverLog['days'], entries: DeliveryEntry[]): ReceiverLog['days'] {
    const map = new Map(days.map(d => [d.date, { ...d }]));
    for (const e of entries) {
        if (e.dryRun) continue;
        const date = e.at.slice(0, 10);
        const d = map.get(date) ?? { date, delivered: 0, refused: 0 };
        if (e.status < 400) d.delivered++; else d.refused++;
        map.set(date, d);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
}

/** Write the owner's pending entries now. An owner read calls this first. */
export async function flushReceiverLogs(ownerGhii: string): Promise<void> {
    const p = pending.get(ownerGhii);
    if (!p) return;
    if (p.timer) { clearTimeout(p.timer); p.timer = undefined; }
    const batch = new Map(p.byName);
    p.byName.clear();
    if (erasing.covers(ownerGhii)) return;
    for (const [name, slot] of batch) {
        if (!slot.entries.length && !slot.wrongKeys) continue;
        try {
            await erasing.track(updateRecord(p.storage, serviceNamespaceOf(ownerGhii), `${RECEIVER_LOG_PREFIX}${name}`, parseReceiverLog, cur => {
                const delivered = slot.entries.filter(e => e.status < 400 && !e.dryRun);
                const refused = slot.entries.filter(e => e.status >= 400);
                return {
                    entries: [...cur.entries, ...slot.entries].slice(-LOG_CAP),
                    failedAttempts: cur.failedAttempts + slot.wrongKeys,
                    lastDeliveryAt: delivered.length ? delivered[delivered.length - 1].at : cur.lastDeliveryAt,
                    lastRefusalAt: refused.length ? refused[refused.length - 1].at : cur.lastRefusalAt,
                    days: addToDays(cur.days, slot.entries),
                };
            }, { tag: 'receiver-log' }));
        } catch (err) {
            logger.warn('receiver log: a batch could not be written; those entries are lost', { owner: ownerGhii, receiver: name, entries: slot.entries.length, error: String(err) });
        }
    }
    // The owner's open Receivers page learns of new deliveries from the event stream, at most once a
    // flush (every few seconds), never by asking again on a timer.
    if (batch.size) emitChange('receivers', ownerGhii);
}

/** Write every owner's pending entries now: the operator's counts read this first. */
export async function flushAllReceiverLogs(): Promise<void> {
    for (const owner of [...pending.keys()]) await flushReceiverLogs(owner);
}

/**
 * An account erasure (services/owner-erasure.ts), before its cascade: no delivery entry of the owner
 * is kept from now on, a write in progress answers first so the cascade deletes what it stored, and
 * the owner's waiting entries are dropped with their timer. The returned function ends the hold,
 * after the cascade.
 */
export async function holdReceiverLogsForErasure(account: ErasedAccount): Promise<() => void> {
    const release = erasing.hold(account);
    await erasing.writesSettled();
    for (const [owner, p] of [...pending]) {
        if (!ErasureHolds.isOf(owner, account)) continue;
        if (p.timer) clearTimeout(p.timer);
        pending.delete(owner);
    }
    return release;
}

/** The log of one receiver as stored (call flushReceiverLogs first for a current view). */
export async function readReceiverLog(storage: Storage, ownerGhii: string, name: string): Promise<ReceiverLog> {
    const rec = await storage.getMemory(serviceNamespaceOf(ownerGhii), `${RECEIVER_LOG_PREFIX}${name}`);
    return parseReceiverLog(rec?.value);
}

/** Remove the log of a deleted receiver. */
export async function deleteReceiverLog(storage: Storage, ownerGhii: string, name: string): Promise<void> {
    pending.get(ownerGhii)?.byName.delete(name);
    await storage.deleteMemory(serviceNamespaceOf(ownerGhii), `${RECEIVER_LOG_PREFIX}${name}`, serviceNamespaceOf(ownerGhii));
}
