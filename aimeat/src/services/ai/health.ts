/**
 * @file health.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether one provider's one capability is answering, from what real calls and the
 *   owner's tests found (docs/internal/llmproviderintegrations/11, section 8).
 *
 *   - A call or a test that works: `ok`.
 *   - Three failures in a row of the kind the node moves on from (timeout, rate limit, server error,
 *     unavailable): `failing`, and the node skips the capability for five minutes. Then one call
 *     probes it: success is `ok`, another failure doubles the wait, up to an hour.
 *   - A key the provider refused (401, 403): `failing` at once, skipped until the owner tests the
 *     provider or changes its key.
 *
 *   The state lives in this process and is written to the owner's provider record only when the
 *   status changes (provider-store.ts persistHealth), never on every call. A node with several
 *   processes has one view per process, which is enough: each learns within three calls. The node's
 *   and the builtin providers keep their state here only, since they have no owner record.
 *
 *   A pure state machine with an injectable clock, so the five-minute wait is tested without waiting.
 * @structure
 *   FailureClass · FALLBACK_CLASSES · HealthKey · healthKey · skipReason · recordSuccess ·
 *   recordFailure · clearHealth · seedHealth · setClock
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import type { AiCapability } from './types.js';
import type { HealthStatus } from './providers.js';

/** What went wrong with one attempt, as the routing rules name it. */
export type FailureClass =
  | 'timeout' | 'rate_limit' | 'server_error' | 'unavailable' | 'auth'
  | 'bad_request' | 'content' | 'empty' | 'cancelled' | 'other';

/** The classes a rule may list in `fallbackOn`. The others never move to the next provider. */
export const FALLBACK_CLASSES: readonly FailureClass[] = ['timeout', 'rate_limit', 'server_error', 'unavailable', 'auth'];

const FAILURES_TO_FAIL = 3;
const FIRST_WAIT_MS = 5 * 60_000;
const MAX_WAIT_MS = 60 * 60_000;

interface Entry {
  status: HealthStatus;
  /** Consecutive failures of a fallback class. */
  failures: number;
  /** Skip until this time. Infinity for a refused key: until the owner tests or changes it. */
  until: number;
  /** The wait the next failure after a probe starts from. */
  waitMs: number;
}

let now = (): number => Date.now();
/** Tests only: a clock that moves when told to. */
export function setClock(fn: (() => number) | null): void { now = fn ?? (() => Date.now()); }

const state = new Map<string, Entry>();

/** One capability of one provider as one owner sees it; the node's own providers are shared. */
export type HealthKey = string;
export function healthKey(scope: 'node' | string, providerId: string, capability: AiCapability): HealthKey {
  return `${scope}|${providerId}|${capability}`;
}

/**
 * Seed the process state from the owner's stored record the first time it is read. A stored
 * `failing` after a refused key keeps the capability skipped across a restart; any other stored
 * failure is probed at once.
 */
export function seedHealth(key: HealthKey, stored: { status: HealthStatus; lastError?: { code: string } } | undefined): void {
  if (state.has(key) || !stored) return;
  const auth = stored.status === 'failing' && stored.lastError?.code === 'auth';
  state.set(key, { status: stored.status, failures: 0, until: auth ? Infinity : 0, waitMs: FIRST_WAIT_MS });
}

/** The status now, or undefined when this process has seen nothing of it. */
export function statusOf(key: HealthKey): HealthStatus | undefined {
  return state.get(key)?.status;
}

/** Why the node skips this capability now, or null when it may be called (a probe included). */
export function skipReason(key: HealthKey): string | null {
  const e = state.get(key);
  if (!e || e.status !== 'failing') return null;
  if (e.until === Infinity) return 'the provider refused its key; the owner tests the provider or sets a new key';
  if (now() < e.until) return `failed ${FAILURES_TO_FAIL} times in a row; skipped until ${new Date(e.until).toISOString()}`;
  return null;
}

/** A working call. Returns the new status when it changed, so the caller persists only then. */
export function recordSuccess(key: HealthKey): HealthStatus | null {
  const e = state.get(key);
  state.set(key, { status: 'ok', failures: 0, until: 0, waitMs: FIRST_WAIT_MS });
  return e?.status === 'ok' ? null : 'ok';
}

/**
 * A failed call of this class. Returns the new status when it changed. Only the classes that move
 * to the next provider count toward `failing`; a bad request or a content refusal says nothing
 * about the provider's health.
 */
export function recordFailure(key: HealthKey, cls: FailureClass): HealthStatus | null {
  const e = state.get(key) ?? { status: 'untested' as HealthStatus, failures: 0, until: 0, waitMs: FIRST_WAIT_MS };
  const before = e.status;
  if (cls === 'auth') {
    state.set(key, { status: 'failing', failures: e.failures + 1, until: Infinity, waitMs: e.waitMs });
    return before === 'failing' ? null : 'failing';
  }
  if (!FALLBACK_CLASSES.includes(cls)) return null;
  // A failed probe after the wait: back to skipping, for twice as long, up to an hour.
  if (before === 'failing') {
    const waitMs = Math.min(MAX_WAIT_MS, e.waitMs * 2);
    state.set(key, { status: 'failing', failures: e.failures + 1, until: now() + waitMs, waitMs });
    return null;
  }
  const failures = e.failures + 1;
  if (failures >= FAILURES_TO_FAIL) {
    state.set(key, { status: 'failing', failures, until: now() + FIRST_WAIT_MS, waitMs: FIRST_WAIT_MS });
    return 'failing';
  }
  state.set(key, { ...e, failures, status: before === 'ok' ? 'degraded' : before });
  return before === 'ok' ? 'degraded' : null;
}

/** The owner tested the provider or changed its key: what the process knew no longer holds. */
export function clearHealth(scope: string, providerId: string): void {
  const prefix = `${scope}|${providerId}|`;
  for (const k of [...state.keys()]) if (k.startsWith(prefix)) state.delete(k);
}
