/**
 * @file src/services/ephemeral-claims.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Short-lived values every process of a node sees: one-time values (an authorization
 *   code, a connection ticket, a sign-in ceremony, an upload address), values spent once (a signature,
 *   a request nonce), and window counters (a per-account limit, the sign-in tarpit, wrong admin
 *   passwords). One table in both storage providers (EphemeralClaimRepository) under three shapes.
 *
 *   WHY. Ten Maps held these, one per process, so a code minted on one process failed on a second
 *   one over the same database, a nonce spent on one could be spent again on the other, and a limit
 *   counted N times on N processes (codebase analysis 2026-11-03, high-availability report section
 *   2c and 2d). With one active process the answers are the ones the Maps gave: the same lifetimes,
 *   the same limits, the same refusals.
 *
 *   WHERE A VALUE LIVES. In the storage of the node the code runs as (auth/node-auth.ts
 *   sessionStorage, registered at boot). Where none is registered (a unit test, a CLI command that
 *   opens no node) it lives in this process's memory, which is also what each `here` form uses: the
 *   synchronous functions some callers and their tests keep (a socket ticket minted for a test, a
 *   signed message checked in one call) answer from this process's memory only.
 *
 *   NO PLAIN VALUE AT REST. The row's id is a SHA-256 of the kind and the value, and its payload is
 *   sealed with AES-256-GCM under a key derived (HKDF-SHA256) from the value itself. A connection
 *   ticket carries the bearer it was minted with, and an upload address the signed upload token: a
 *   copy of the table, a backup or a log of its statements names neither, and opens nothing without
 *   the value, which only its holder has.
 *
 *   THE CLOCK. Every time is epoch milliseconds from this process (`now`, defaulting to Date.now()),
 *   compared in the statement, so a rule reads the same here and in the database.
 *
 *   EXPIRED ROWS are deleted by a sweep that runs at most once a minute per storage, started by a
 *   write. A row that has expired and is not swept yet answers as expired; nothing reads it as valid.
 * @structure ClaimEntry · ClaimCodec · oneTimeStore(kind, codec) · spendOnce / spendOnceHere ·
 *   windowCounter(kind)
 * @usage
 *   const codes = oneTimeStore<AuthCode>('mcp-oauth-code');
 *   await codes.put(code, record, Date.now() + 600_000);
 *   const entry = await codes.take(code);              // null, or { data, expiresAt } (expired or not)
 *   if (!await spendOnce('signature', sig, Date.now() + 300_000)) refuse();
 *   const c = await windowCounter('mail-send').bump(account, { windowMs: 60_000 });
 * @version-history
 *   v1.0.1 — 2026-11-04 — The payload's AES-GCM goes through utils/aes-gcm.ts, the node's one
 *     implementation; the stored form is unchanged (codebase analysis 2026-11-03, item B9).
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, high-availability stage 2, items 2.3 and 2.4).
 */
import { createHash, hkdfSync } from 'node:crypto';
import { gcmOpen, gcmSeal } from '../utils/aes-gcm.js';
import type { Storage } from '../storage/interface.js';
import type { EphemeralCount } from '../storage/repositories/ephemeral-claim.repository.js';
import { sessionStorage } from '../auth/node-auth.js';
import { logger } from '../utils/logger.js';

/** A stored value and when it stops being valid. `expiresAt` is returned so the caller decides. */
export interface ClaimEntry<T> { data: T; expiresAt: number }

/** How a value that is not plain JSON (a Set, a Date) is written and read back. */
export interface ClaimCodec<T> {
  encode(data: T): unknown;
  decode(raw: unknown): T;
}

// ── This process's memory: the store when no storage is registered, and every `here` form ──────────

interface LocalRow { data: unknown; count: number; expiresAt: number }

// process-local: the fallback when no storage is registered (unit tests, CLI) and the `here` forms; a
// node's processes share the EphemeralClaim table instead.
const local = new Map<string, Map<string, LocalRow>>();

/** How many rows one kind may hold before a write first clears the expired ones. */
const LOCAL_SWEEP_AT = 10_000;

function localKind(kind: string): Map<string, LocalRow> {
  let rows = local.get(kind);
  if (!rows) { rows = new Map(); local.set(kind, rows); }
  return rows;
}

function localWrite(kind: string, id: string, row: LocalRow, now: number): void {
  const rows = localKind(kind);
  if (rows.size >= LOCAL_SWEEP_AT) for (const [k, r] of rows) if (r.expiresAt < now) rows.delete(k);
  rows.set(id, row);
}

// ── The node's storage ───────────────────────────────────────────────────────────────────────────

/** The storage of the node the code runs as, or null when none is registered. */
function claimStorage(): Storage | null {
  return sessionStorage();
}

/** When each storage was last swept, so a sweep runs at most once a minute per storage. */
const lastSweep = new WeakMap<Storage, number>();
const SWEEP_EVERY_MS = 60_000;

function sweepSoon(storage: Storage, now: number): void {
  const last = lastSweep.get(storage) ?? 0;
  if (now - last < SWEEP_EVERY_MS) return;
  lastSweep.set(storage, now);
  storage.sweepEphemeralClaims(Date.now()).catch((err: unknown) => {
    logger.warn('[ephemeral-claims] the sweep of expired values failed; it runs again on a later write', { error: String(err) });
  });
}

/** The row id: a hash of the kind and the value, so the table never holds the value itself. */
function rowId(kind: string, value: string): string {
  return createHash('sha256').update(`${kind}\u0000${value}`).digest('hex');
}

/** The payload key: derived from the value, so only a holder of the value can open the payload. */
function payloadKey(kind: string, value: string): Buffer {
  return Buffer.from(hkdfSync('sha256', value, 'aimeat-ephemeral-claim', kind, 32));
}

function seal(kind: string, value: string, data: unknown): string {
  const { iv, tag, ct } = gcmSeal(payloadKey(kind, value), JSON.stringify(data ?? null));
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function open(kind: string, value: string, sealed: string): unknown {
  const buf = Buffer.from(sealed, 'base64');
  return JSON.parse(gcmOpen(payloadKey(kind, value), { iv: buf.subarray(0, 12), tag: buf.subarray(12, 28), ct: buf.subarray(28) }).toString('utf8'));
}

// ── One-time values ──────────────────────────────────────────────────────────────────────────────

export interface OneTimeStore<T> {
  /** Store `data` under `id` until `expiresAt`, replacing what was there. */
  put(id: string, data: T, expiresAt: number): Promise<void>;
  /** The value under `id`, expired or not, or null. It stays. */
  get(id: string): Promise<ClaimEntry<T> | null>;
  /** Delete the value under `id` and answer it, expired or not, or null. One caller receives it. */
  take(id: string): Promise<ClaimEntry<T> | null>;
  /** Delete the value under `id`. */
  remove(id: string): Promise<void>;
  /** How many values of this kind are valid at `now`. */
  count(now?: number): Promise<number>;
  /** The same store in this process's memory only, for a caller that cannot wait. */
  here: {
    put(id: string, data: T, expiresAt: number): void;
    take(id: string): ClaimEntry<T> | null;
    /** Forget every value of this kind this process holds in memory (a test's clean start). */
    clear(): void;
  };
}

/**
 * The one-time values of one kind. `kind` names the store in the table and is never reused for
 * another meaning. A value that is not plain JSON passes a `codec`.
 */
export function oneTimeStore<T>(kind: string, codec?: ClaimCodec<T>): OneTimeStore<T> {
  const encode = (d: T): unknown => (codec ? codec.encode(d) : d);
  const decode = (raw: unknown): T => (codec ? codec.decode(raw) : raw as T);
  const here = {
    put(id: string, data: T, expiresAt: number): void {
      localWrite(kind, id, { data, count: 0, expiresAt }, Date.now());
    },
    take(id: string): ClaimEntry<T> | null {
      const rows = local.get(kind);
      const row = rows?.get(id);
      if (!row) return null;
      rows!.delete(id);
      return { data: row.data as T, expiresAt: row.expiresAt };
    },
    clear(): void {
      local.delete(kind);
    },
  };
  return {
    async put(id, data, expiresAt) {
      const storage = claimStorage();
      if (!storage) { here.put(id, data, expiresAt); return; }
      await storage.putEphemeralClaim(kind, rowId(kind, id), seal(kind, id, encode(data)), expiresAt);
      sweepSoon(storage, Date.now());
    },
    async get(id) {
      const storage = claimStorage();
      if (!storage) {
        const row = local.get(kind)?.get(id);
        return row ? { data: row.data as T, expiresAt: row.expiresAt } : null;
      }
      const row = await storage.getEphemeralClaim(kind, rowId(kind, id));
      return row ? { data: decode(open(kind, id, row.payload)), expiresAt: row.expiresAt } : null;
    },
    async take(id) {
      const storage = claimStorage();
      if (!storage) return here.take(id);
      const row = await storage.takeEphemeralClaim(kind, rowId(kind, id));
      return row ? { data: decode(open(kind, id, row.payload)), expiresAt: row.expiresAt } : null;
    },
    async remove(id) {
      const storage = claimStorage();
      if (!storage) { local.get(kind)?.delete(id); return; }
      await storage.deleteEphemeralClaim(kind, rowId(kind, id));
    },
    async count(now = Date.now()) {
      const storage = claimStorage();
      if (!storage) {
        let n = 0;
        for (const row of local.get(kind)?.values() ?? []) if (row.expiresAt > now) n++;
        return n;
      }
      return storage.countEphemeralClaims(kind, now);
    },
    here,
  };
}

// ── Values spent once ────────────────────────────────────────────────────────────────────────────

/**
 * Spend `value` of `kind` until `expiresAt`, in this process's memory only. True the first time, and
 * again once an earlier spend's time has passed (expiresAt <= now); false while it holds.
 */
export function spendOnceHere(kind: string, value: string, expiresAt: number, now = Date.now()): boolean {
  const held = local.get(kind)?.get(value);
  if (held && held.expiresAt > now) return false;
  localWrite(kind, value, { data: null, count: 0, expiresAt }, now);
  return true;
}

/**
 * Spend `value` of `kind` until `expiresAt` across every process of the node. True the first time,
 * and again once an earlier spend's time has passed; false while it holds, whichever process spent it.
 */
export async function spendOnce(kind: string, value: string, expiresAt: number, now = Date.now()): Promise<boolean> {
  const storage = claimStorage();
  if (!storage) return spendOnceHere(kind, value, expiresAt, now);
  const first = await storage.spendEphemeralClaim(kind, rowId(kind, value), expiresAt, now);
  sweepSoon(storage, now);
  return first;
}

// ── Window counters ──────────────────────────────────────────────────────────────────────────────

/**
 * How one count is made. `staleBefore` (default `now`): a window that ended before it starts again
 * at 1. `sliding`: every count moves the window's end to now + windowMs.
 */
export interface BumpOptions { windowMs: number; now?: number; staleBefore?: number; sliding?: boolean }

export interface WindowCounter {
  /** Count one against `key` and answer the counter after it. */
  bump(key: string, opts: BumpOptions): Promise<EphemeralCount>;
  /** The counter under `key`, its window ended or not, or null. */
  read(key: string): Promise<EphemeralCount | null>;
  /** Forget the counter under `key`. */
  clear(key: string): Promise<void>;
  /** The same counter in this process's memory only, for a caller that cannot wait. */
  here: {
    bump(key: string, opts: BumpOptions): EphemeralCount;
    read(key: string): EphemeralCount | null;
    clear(key: string): void;
    /** Forget every counter of this kind this process holds in memory (a test's clean start). */
    clearAll(): void;
  };
}

/** The window counters of one kind (a limit, a tarpit). */
export function windowCounter(kind: string): WindowCounter {
  const here = {
    bump(key: string, opts: BumpOptions): EphemeralCount {
      const now = opts.now ?? Date.now();
      const staleBefore = opts.staleBefore ?? now;
      const row = local.get(kind)?.get(key);
      const fresh = !row || row.expiresAt < staleBefore;
      const next: LocalRow = {
        data: null,
        count: fresh ? 1 : row!.count + 1,
        expiresAt: fresh || opts.sliding ? now + opts.windowMs : row!.expiresAt,
      };
      localWrite(kind, key, next, now);
      return { count: next.count, expiresAt: next.expiresAt };
    },
    read(key: string): EphemeralCount | null {
      const row = local.get(kind)?.get(key);
      return row ? { count: row.count, expiresAt: row.expiresAt } : null;
    },
    clear(key: string): void {
      local.get(kind)?.delete(key);
    },
    clearAll(): void {
      local.delete(kind);
    },
  };
  return {
    async bump(key, opts) {
      const storage = claimStorage();
      if (!storage) return here.bump(key, opts);
      const now = opts.now ?? Date.now();
      const counted = await storage.bumpEphemeralCounter(kind, rowId(kind, key), {
        now, windowMs: opts.windowMs, staleBefore: opts.staleBefore ?? now, sliding: opts.sliding ?? false,
      });
      sweepSoon(storage, now);
      return counted;
    },
    async read(key) {
      const storage = claimStorage();
      if (!storage) return here.read(key);
      return storage.readEphemeralCounter(kind, rowId(kind, key));
    },
    async clear(key) {
      const storage = claimStorage();
      if (!storage) { here.clear(key); return; }
      await storage.deleteEphemeralClaim(kind, rowId(kind, key));
    },
    here,
  };
}
