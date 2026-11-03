/**
 * @file src/services/outbox.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stored outbox: a delivery whose first attempt failed keeps its retries in the
 *   database, so a restart does not lose them. Webhook deliveries (services/webhook-dispatcher.ts)
 *   and mail through the node's own SMTP transport (services/email.ts) use it.
 *
 *   WHY. Both kept their retries only in timers: a webhook up to 2.5 minutes (5 s, 30 s, 2 min) and
 *   a mail 13 s (1 s, 3 s, 9 s). A deploy inside that window dropped the delivery, with nothing in any
 *   log to say so (codebase analysis 2026-11-03, HA stage 1 item 1.5).
 *
 *   HOW. The first attempt is made at once and writes nothing; a delivery that succeeds the first
 *   time costs no storage at all. On a failure the entry is written as one memory record in the
 *   node's own namespace (`system@<node>`, key `outbox.<kind>.<id>`) with the attempts made, the time
 *   of the next one, and a claim: which process holds it and until when. The process that holds it
 *   waits, claims the next attempt on the record's version (setMemoryIfVersion), tries, and deletes
 *   the record on success or after the last attempt. The retry schedule, the log lines and the
 *   counters are the sender's own, unchanged.
 *
 *   RESUMED AT THE NEXT START, CLAIMED ONCE. A stopping process releases its claims (releaseOutbox,
 *   at SIGTERM), and the next start sweeps the outbox (resumeOutbox, at boot and every minute as the
 *   claimed core job core:outbox-sweep). An entry whose holder died without stopping is taken over
 *   when its claim runs out. Every take-over is a conditional write on the version that was read, so
 *   two processes (a standby promoted beside a live one) cannot both send it.
 *
 *   A sender with nothing to store under (a mail when the node has no encryption key) retries in
 *   memory as before. A storage failure while keeping an entry does the same.
 * @structure OutboxKind · OutboxHandler · registerOutboxHandler · deliverWithRetries · resumeOutbox ·
 *   releaseOutbox · OUTBOX_PREFIX · outboxOwner · resetOutboxForTests
 * @usage
 *   registerOutboxHandler('mail', { delays: [1000, 3000, 9000], leaseMs: 180_000, attempt, ... });
 *   const delivered = await deliverWithRetries(storage, nodeId, 'mail', payload);
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, HA stage 1 item 1.5).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export type OutboxKind = 'webhook' | 'mail';

export const OUTBOX_PREFIX = 'outbox.';
export const outboxOwner = (nodeId: string): string => `system@${nodeId}`;

/** What one kind of delivery tells the outbox. `P` is what an attempt needs. */
export interface OutboxHandler<P> {
    /** The wait before each retry, in ms: one entry per retry after the first attempt. */
    delays: readonly number[];
    /** How long a claimed attempt may take. Past it another process may take the entry over. */
    leaseMs: number;
    /** One attempt. True when delivered; false or a throw is a failed attempt. */
    attempt(payload: P, attemptNo: number): Promise<boolean>;
    /** Told before each wait (attemptNo is the attempt that failed), for the sender's log and counters. */
    onRetry?(payload: P, attemptNo: number, delayMs: number): void;
    /** Every attempt failed. */
    onExhausted?(payload: P, attempts: number): Promise<void>;
    /** The form the payload is stored in, or null when it may not be stored (then: memory only). */
    seal(payload: P, id: string): unknown | null;
    /** The payload back from its stored form. Throws when it cannot be read. */
    open(stored: unknown, id: string): P;
}

interface StoredEntry {
    id: string;
    kind: OutboxKind;
    /** Attempts made so far. */
    attempts: number;
    /** When the next attempt is due. */
    nextAt: string;
    /** The process that holds the next attempt, and until when. Null: free to take. */
    claim: { by: string; until: string } | null;
    payload: unknown;
    createdAt: string;
}

// process-local: the identity of this process in a claim, and the handlers registered at boot.
const PROCESS_ID = randomUUID();
const handlers = new Map<OutboxKind, OutboxHandler<unknown>>();
/** Keys this process is attempting right now; releaseOutbox leaves these with their holder. */
const inFlight = new Set<string>();
let stopping = false;
/** Where this process kept or resumed entries, for releaseOutbox at shutdown. */
let known: { storage: Storage; nodeId: string } | null = null;

const sleep = (ms: number) => new Promise<void>(resolve => { const t = setTimeout(resolve, ms); t.unref?.(); });
const keyOf = (kind: OutboxKind, id: string) => `${OUTBOX_PREFIX}${kind}.${id}`;

export function registerOutboxHandler<P>(kind: OutboxKind, handler: OutboxHandler<P>): void {
    handlers.set(kind, handler as OutboxHandler<unknown>);
}

async function tryOnce<P>(h: OutboxHandler<P>, payload: P, attemptNo: number): Promise<boolean> {
    try {
        return await h.attempt(payload, attemptNo);
    } catch (err) {
        // A throw is a failed attempt, retried like any other.
        logger.warn('outbox: a delivery attempt threw', { attempt: attemptNo, error: String(err) });
        return false;
    }
}

/** writeEntry for a step that stops on a failed write: a storage error is logged and read as "lost". */
async function writeOrLost(storage: Storage, nodeId: string, entry: StoredEntry, version: number): Promise<number | null> {
    try {
        return await writeEntry(storage, nodeId, entry, version);
    } catch (err) {
        logger.warn('outbox: an entry could not be written; this process stops on it', { kind: entry.kind, error: String(err) });
        return null;
    }
}

/** Write `entry` on `version` (0: create). Answers the stored version, or null when another writer won. */
async function writeEntry(storage: Storage, nodeId: string, entry: StoredEntry, version: number): Promise<number | null> {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
        key: keyOf(entry.kind, entry.id), ownerGaii: outboxOwner(nodeId), value: entry, visibility: 'private',
        tags: ['outbox'], ttlHours: null, version: version + 1, createdAt: entry.createdAt, updatedAt: now,
    };
    const written = version === 0
        ? await storage.createMemoryIfAbsent?.(record)
        : await storage.setMemoryIfVersion?.(record, version);
    return written ? record.version : null;
}

const claimFor = (leaseMs: number, from = Date.now()) => ({ by: PROCESS_ID, until: new Date(from + leaseMs).toISOString() });

/** A stored entry as this process last wrote or read it. */
interface Held { storage: Storage; nodeId: string; entry: StoredEntry; version: number }

/**
 * Drive one delivery from its next attempt to the end. `held` null: nothing is stored, the retries
 * run in memory. Answers true when delivered, false when every attempt failed or another process
 * took the entry over.
 */
async function drive<P>(h: OutboxHandler<P>, payload: P, held: Held | null, attempts: number, nextAtMs: number): Promise<boolean> {
    for (;;) {
        const wait = nextAtMs - Date.now();
        if (wait > 0) await sleep(wait);
        let key: string | null = null;
        if (held) {
            // Leave it to the next start when this process is stopping (releaseOutbox freed the claim).
            if (stopping) return false;
            const entry: StoredEntry = { ...held.entry, claim: claimFor(h.leaseMs) };
            const v = await writeOrLost(held.storage, held.nodeId, entry, held.version);
            if (v === null) return false;   // another process holds it now
            held = { ...held, entry, version: v };
            key = keyOf(entry.kind, entry.id);
            inFlight.add(key);
        }
        attempts++;
        const ok = await tryOnce(h, payload, attempts);
        if (key) inFlight.delete(key);
        if (ok || attempts > h.delays.length) {
            if (held) {
                const kind = held.entry.kind;
                await held.storage.deleteMemory(outboxOwner(held.nodeId), keyOf(kind, held.entry.id))
                    .catch(err => logger.warn('outbox: a finished entry could not be deleted', { kind, error: String(err) }));
            }
            if (!ok) await h.onExhausted?.(payload, attempts);
            return ok;
        }
        const delay = h.delays[attempts - 1]!;
        h.onRetry?.(payload, attempts, delay);
        nextAtMs = Date.now() + delay;
        if (held) {
            const entry: StoredEntry = { ...held.entry, attempts, nextAt: new Date(nextAtMs).toISOString(), claim: claimFor(h.leaseMs, nextAtMs) };
            const v = await writeOrLost(held.storage, held.nodeId, entry, held.version);
            if (v === null) return false;
            held = { ...held, entry, version: v };
        }
    }
}

/**
 * Deliver `payload` now; when the first attempt fails, keep the retries in storage (see the file
 * header) and run them. Resolves when it is delivered (true) or every attempt failed (false). A
 * caller that must not wait does not await it. `storage` null runs the retries in memory.
 */
export async function deliverWithRetries<P>(storage: Storage | null, nodeId: string, kind: OutboxKind, payload: P): Promise<boolean> {
    const h = handlers.get(kind) as OutboxHandler<P> | undefined;
    if (!h) throw new Error(`outbox: no handler registered for ${kind}`);
    if (await tryOnce(h, payload, 1)) return true;
    if (h.delays.length === 0) { await h.onExhausted?.(payload, 1); return false; }

    const delay = h.delays[0]!;
    h.onRetry?.(payload, 1, delay);
    const nextAtMs = Date.now() + delay;
    let held: Held | null = null;
    const id = randomUUID();
    const sealed = storage && !stopping ? h.seal(payload, id) : null;
    if (storage && sealed !== null) {
        const entry: StoredEntry = {
            id, kind, attempts: 1, nextAt: new Date(nextAtMs).toISOString(), claim: claimFor(h.leaseMs, nextAtMs),
            payload: sealed, createdAt: new Date().toISOString(),
        };
        const v = await writeEntry(storage, nodeId, entry, 0).catch(err => {
            logger.warn('outbox: the retry could not be kept in storage; retrying in memory', { kind, error: String(err) });
            return null;
        });
        if (v !== null) { held = { storage, nodeId, entry, version: v }; known = { storage, nodeId }; }
    }
    return drive(h, payload, held, 1, nextAtMs);
}

/**
 * Take over every entry that is due and that no live process holds: at boot and from the core job
 * core:outbox-sweep. Each take-over is a conditional write made before the attempt (drive), so of
 * two processes sweeping at once one sends. Answers how many entries it started on; a lost take-over
 * stops quietly.
 */
export async function resumeOutbox(storage: Storage, nodeId: string): Promise<number> {
    if (stopping) return 0;
    known = { storage, nodeId };
    const now = Date.now();
    const records = await storage.listMemory(outboxOwner(nodeId), { prefix: OUTBOX_PREFIX });
    let started = 0;
    for (const rec of records) {
        const entry = rec.value as StoredEntry | null;
        if (!entry || typeof entry.id !== 'string' || typeof entry.attempts !== 'number') continue;
        const h = handlers.get(entry.kind);
        if (!h) continue;
        if (Date.parse(entry.nextAt) > now) continue;
        if (entry.claim && Date.parse(entry.claim.until) > now) continue;
        let payload: unknown;
        try {
            payload = h.open(entry.payload, entry.id);
        } catch (err) {
            logger.warn('outbox: an entry could not be read and is removed', { kind: entry.kind, error: String(err) });
            await storage.deleteMemory(rec.ownerGaii, rec.key)
                .catch(e => logger.warn('outbox: an unreadable entry could not be removed', { kind: entry.kind, error: String(e) }));
            continue;
        }
        started++;
        void drive(h, payload, { storage, nodeId, entry, version: rec.version }, entry.attempts, now)
            .catch(err => logger.warn('outbox: a resumed delivery failed', { kind: entry.kind, error: String(err) }));
    }
    if (started) logger.info(`[outbox] resuming ${started} pending deliveries`);
    return started;
}

/**
 * The process is stopping: run no further attempt, and free the claims this process holds on
 * entries it is not attempting right now, so the next start resumes them when they are due instead
 * of after the claim runs out. Called at SIGTERM (server-bootstrap/process-buffers.ts), where only
 * the storage this process kept entries in is known. Answers how many it freed.
 */
export async function releaseOutbox(): Promise<number> {
    stopping = true;
    if (!known) return 0;
    const { storage, nodeId } = known;
    const records = await storage.listMemory(outboxOwner(nodeId), { prefix: OUTBOX_PREFIX });
    let freed = 0;
    for (const rec of records) {
        const entry = rec.value as StoredEntry | null;
        if (!entry?.claim || entry.claim.by !== PROCESS_ID || inFlight.has(rec.key)) continue;
        const v = await writeOrLost(storage, nodeId, { ...entry, claim: null }, rec.version);
        if (v !== null) freed++;
    }
    return freed;
}

/** Test seam: forget the stopping state. Not used by the running node. */
export function resetOutboxForTests(): void { stopping = false; inFlight.clear(); known = null; }
