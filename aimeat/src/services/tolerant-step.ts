/**
 * @file src/services/tolerant-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One helper for a multi-step operation that runs in ONE transaction and lets a step
 *   fail without stopping the steps after it (deactivation, erasure). The step runs inside
 *   `storage.savepoint()`, so on PostgreSQL a statement the database rejects in that step undoes
 *   only that step: without it the whole transaction was marked failed, the steps after it were
 *   refused, and the final COMMIT was executed as a ROLLBACK with no error (QA audit E6-01).
 * @structure
 *   - inSavepoint(storage, fn): storage.savepoint(fn), or fn() for a storage double without it
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E6-01).
 */
import type { Storage } from '../storage/interface.js';

/** Run `fn` as a tolerant step of the open transaction. The error still reaches the caller. */
export function inSavepoint<T>(storage: Storage, fn: () => Promise<T>): Promise<T> {
  // A unit-test double built as a partial Storage may not have savepoint(); both providers do.
  return typeof storage.savepoint === 'function' ? storage.savepoint(fn) : fn();
}
