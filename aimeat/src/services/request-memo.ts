/**
 * @file src/services/request-memo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The request memo: one HTTP request asks storage about its caller's agent, owner and
 *   account once, and every later question about the same record in the same request gets the first
 *   answer.
 *
 *   WHY. The auth chain asked the same question many times in one request. An agent's MCP tool call
 *   read the agent record five times and the owner record three times before the tool ran: the
 *   revocation check (auth/agent-alive.ts, auth/credential-revoked.ts), the current scopes
 *   (auth/effective-scopes.ts), CORS (middleware/cors.ts), the MCP permission check
 *   (services/permission-ask.ts) and the MCP admission (services/mcp-agent-admission.ts) each read
 *   for themselves (codebase analysis 2026-11-03, item C2; efficiency.md E4).
 *
 *   WHAT STAYS THE SAME. Each of those checks was already decided once per request: the record they
 *   read is the record as it stood when the request reached them, and an owner who presses Delete
 *   is answered on the next request, as before. The memo keeps exactly that:
 *   - it lives only while its request is being answered (utils/request-context.ts RequestScope), so
 *     work a request left running, a sweep or a job reads storage itself;
 *   - any write through the storage drops the whole memo, at the start of the write and again when
 *     it ends, so a request that changes an agent, an owner or an account reads the change next;
 *   - an answer older than MEMO_MAX_AGE_MS is read again, so a request that runs long reads fresh;
 *   - a failed read is not kept;
 *   - a storage that installRequestMemo() did not prepare is read directly, every time.
 *   The memo answers only the read sites named above. A route handler reads storage itself.
 * @structure installRequestMemo(storage) · memoGetAgent · memoGetOwner · memoGetGHIIByOwner ·
 *   forgetRequestMemo() · MEMO_MAX_AGE_MS
 * @usage
 *   installRequestMemo(storage);                 // once, at boot (server-bootstrap/config-init.ts)
 *   const agent = await memoGetAgent(storage, gaii);
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C2).
 */
import type { Storage } from '../storage/interface.js';
import type { AgentRecord, GHIIRecord, OwnerRecord } from '../storage/types/identity.js';
import { requestContext } from '../utils/request-context.js';
import { logger } from '../utils/logger.js';

/** How long one answer stands inside a request. The auth chain reads within milliseconds. */
export const MEMO_MAX_AGE_MS = 10_000;

/** Marks a storage whose writes drop the memo; only such a storage is memoised. */
const PREPARED = Symbol.for('aimeat.requestMemo.prepared');

/**
 * Storage method names that only read, and the providers' row-shaping helpers (deserializeX, mapXRow,
 * memoryAnnotation), which a read calls on itself. Every other method is a write for the memo,
 * whatever it writes: over-forgetting costs one read, under-forgetting would answer from a record the
 * request itself changed.
 */
const READ_ONLY = /^(get|list|count|search|sum|is|has|find|deserialize|map)[A-Z]|^memoryAnnotation$/;

/** Drop every memoised answer of the request this code runs for. */
export function forgetRequestMemo(): void {
  const scope = requestContext.getStore()?.scope;
  if (scope) scope.memo = undefined;
}

/**
 * Prepare a storage for the memo: every method that is not a read drops the memo when it starts and
 * when it ends (also when it fails). Called once, at boot, on the storage the node serves with. Each
 * function property is wrapped on the instance, which keeps `this` and every earlier wrapper (the
 * file-store wrapper, the perf-trace proxy) as it was.
 */
export function installRequestMemo(storage: Storage): void {
  const target = storage as unknown as Record<string | symbol, unknown>;
  if (target[PREPARED]) return;
  const names = new Set<string>();
  for (let o: object | null = storage; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name === 'constructor' || READ_ONLY.test(name) || name.startsWith('_')) continue;
      const d = Object.getOwnPropertyDescriptor(o, name);
      if (d && typeof d.value === 'function') names.add(name);
    }
  }
  for (const name of names) {
    const original = target[name] as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') continue;
    target[name] = function forgettingWrite(this: unknown, ...args: unknown[]): unknown {
      forgetRequestMemo();
      const out = original.apply(this, args);
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        return (out as Promise<unknown>).then(
          (v) => { forgetRequestMemo(); return v; },
          (err: unknown) => { forgetRequestMemo(); throw err; },
        );
      }
      forgetRequestMemo();
      return out;
    };
  }
  target[PREPARED] = true;
}

/** The first answer of this request for `key`, else `read()`, kept for the rest of the request. */
function memoised<T>(storage: Storage, key: string, read: () => Promise<T>): Promise<T> {
  const scope = requestContext.getStore()?.scope;
  if (!scope?.open || !(storage as unknown as Record<symbol, unknown>)[PREPARED]) return read();
  const byStorage = scope.memo ?? (scope.memo = new WeakMap());
  let entries = byStorage.get(storage);
  if (!entries) { entries = new Map(); byStorage.set(storage, entries); }
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now - hit.at < MEMO_MAX_AGE_MS) return hit.value as Promise<T>;
  const value = Promise.resolve(read());
  const kept = entries;
  kept.set(key, { at: now, value });
  // A failed read is not kept: the next asker reads again. The caller still gets the rejection.
  value.catch((err: unknown) => {
    if (kept.get(key)?.value === value) kept.delete(key);
    logger.debug('request-memo: a read failed and is not kept; its caller answers for it', { key: key.split('\u0000')[0], error: String(err) });
  });
  return value;
}

/** storage.getAgent, answered once per request. */
export function memoGetAgent(storage: Storage, gaii: string): Promise<AgentRecord | null> {
  return memoised(storage, `agent\u0000${gaii}`, () => storage.getAgent(gaii));
}

/** storage.getOwner, answered once per request. */
export function memoGetOwner(storage: Storage, name: string): Promise<OwnerRecord | null> {
  return memoised(storage, `owner\u0000${name}`, () => storage.getOwner(name));
}

/** storage.getGHIIByOwner, answered once per request. */
export function memoGetGHIIByOwner(storage: Storage, ownerName: string): Promise<GHIIRecord | null> {
  return memoised(storage, `ghii\u0000${ownerName}`, () => storage.getGHIIByOwner(ownerName));
}
