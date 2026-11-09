/**
 * @file src/storage/repositories/ephemeral-claim.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic contract for short-lived values every process of a node must see:
 *   one-time values (an authorization code, a connection ticket, a sign-in ceremony, an upload
 *   address), values spent once (a signature, a request nonce), and window counters (how many mails
 *   one account sent this minute, how many wrong passwords one address sent). One table in both
 *   providers, EphemeralClaim (PostgreSQL migration 0126) and ephemeral_claim (SQLite).
 *
 *   WHY. Ten in-memory Maps held these until 2026-11-04, so a value made on one process was unknown
 *   to a second one over the same database, and a value spent on one could be spent again on the
 *   other (codebase analysis 2026-11-03, high-availability report section 2c and 2d).
 *
 *   THE CALLER'S CLOCK. Every method that compares a time takes `now` in epoch milliseconds from the
 *   caller, never the database's clock, so the rule a process applies is the one its code states, and
 *   a test with a fake clock gets the answer it computes.
 *
 *   NO PLAIN VALUE. The service in front of this (services/ephemeral-claims.ts) hands in an `id` that
 *   is already a hash of the value it stands for, and a `payload` that is already sealed under a key
 *   derived from that value, so a copy of the table names no live code or ticket. This layer stores
 *   what it is given.
 * @structure EphemeralClaimRow · EphemeralCount · EphemeralClaimRepository
 * @usage implemented by both storage providers; called through services/ephemeral-claims.ts only.
 * @version-history
 *   v1.1.0 — 2026-11-08 — releaseEphemeralCounter, so a limit can reserve its count before the check it
 *     guards (secaudit2026nov08 round 14, services/admin-password.ts).
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, high-availability stage 2, item 2.3 and 2.4).
 */

/** One stored value: what was put, and when it stops being valid (epoch ms). */
export interface EphemeralClaimRow {
  payload: string;
  expiresAt: number;
}

/** A counter as it stands after a change: its count, and when its window ends (epoch ms). */
export interface EphemeralCount {
  count: number;
  expiresAt: number;
}

export interface EphemeralClaimRepository {
  /** Store `payload` under (kind, id) until `expiresAt`, replacing what was there. */
  putEphemeralClaim(kind: string, id: string, payload: string, expiresAt: number): Promise<void>;

  /** The row under (kind, id), expired or not, or null. Reads only; the row stays. */
  getEphemeralClaim(kind: string, id: string): Promise<EphemeralClaimRow | null>;

  /**
   * Delete the row under (kind, id) and answer what it held, expired or not, or null when there was
   * none. Of two callers that take one row at the same moment exactly one receives it.
   */
  takeEphemeralClaim(kind: string, id: string): Promise<EphemeralClaimRow | null>;

  /** Delete the row under (kind, id). True when there was one. */
  deleteEphemeralClaim(kind: string, id: string): Promise<boolean>;

  /**
   * Spend (kind, id) until `expiresAt`. True when nothing held it, or what held it had expired at
   * `now` (expiresAt <= now): the row is written and the caller is first. False when an unexpired
   * row holds it. One statement, so of two callers at the same moment exactly one is first.
   */
  spendEphemeralClaim(kind: string, id: string, expiresAt: number, now: number): Promise<boolean>;

  /** How many rows of `kind` are valid at `now` (expiresAt > now). */
  countEphemeralClaims(kind: string, now: number): Promise<number>;

  /**
   * Count one against the counter (kind, id), in one statement. When there is no row, or its window
   * ended before `staleBefore` (expiresAt < staleBefore), the count starts again at 1 and the window
   * ends at now + windowMs. Otherwise the count rises by one, and the window keeps its end, or moves
   * to now + windowMs when `sliding`. Answers the counter as it stands after the change.
   */
  bumpEphemeralCounter(kind: string, id: string, opts: {
    now: number; windowMs: number; staleBefore: number; sliding: boolean;
  }): Promise<EphemeralCount>;

  /**
   * Take back one count from the counter (kind, id), in one statement: the count falls by one while
   * it is above 0 and its window has not ended at `now`; otherwise nothing changes. For a count that
   * was reserved before a check and turned out not to belong in it (a right admin password).
   */
  releaseEphemeralCounter(kind: string, id: string, now: number): Promise<void>;

  /** The counter (kind, id) as stored, its window ended or not, or null. */
  readEphemeralCounter(kind: string, id: string): Promise<EphemeralCount | null>;

  /** Delete every row whose time ended before `now`. Answers how many went. */
  sweepEphemeralClaims(now: number): Promise<number>;
}
