/**
 * @file src/utils/request-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-request context every log line and every response envelope reads: the
 *   request id and the caller. An AsyncLocalStorage opened by middleware/request-id.ts. A leaf
 *   module, so the logger (utils/logger.ts) and the envelope (middleware/envelope.ts) read it
 *   without a cycle, and a test that replaces the logger module still has it.
 * @structure RequestContext · RequestScope · requestContext · currentRequestId() · onRequestPath()
 * @usage const id = currentRequestId(); // undefined outside an HTTP request
 * @version-history
 *   2026-11-04 — RequestScope: whether the request is still being answered, and the request memo of
 *     principal reads (services/request-memo.ts). onRequestPath() answers whether a storage call is
 *     made for a request still being answered (the PostgreSQL request-path statement limit) (codebase
 *     analysis 2026-11-03, items C2 and C8).
 *   2026-10-16 — Moved out of utils/logger.ts; currentRequestId() added (QA audit E1-05, F5-09).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** One cached answer of the request memo: when it was read, and the read itself. */
export interface RequestMemoEntry { at: number; value: Promise<unknown> }

/**
 * The life of one HTTP request, as the code it runs sees it. middleware/request-id.ts opens it and
 * closes it when the response is finished or the connection closed. Work the request started and
 * left running (a job nobody waits for, a timer) still sees the scope, but closed: from then on it is
 * background work, and it reads storage as background work does.
 */
export interface RequestScope {
  /** True while the request is being answered. */
  open: boolean;
  /** The request memo (services/request-memo.ts): per storage, key → entry. Dropped on every write. */
  memo?: WeakMap<object, Map<string, RequestMemoEntry>>;
}

export interface RequestContext {
  requestId?: string;
  /** The caller's principal. middleware/request-id.ts makes it a getter over req.auth. */
  gaii?: string;
  /**
   * Set a header on this request's HTTP response, while it has not been sent. Lets a service that
   * accepts a deprecated form say so on the response without taking the Express response
   * (services/deprecation.ts). Absent outside an HTTP request.
   */
  setHeader?: (name: string, value: string) => void;
  /** The request's life and its memo. Absent outside an HTTP request. */
  scope?: RequestScope;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * True when the code runs for an HTTP request that is still being answered: not at boot, not in a
 * sweep or a scheduled job, and not in work a request left running after its response.
 */
export function onRequestPath(): boolean {
  return requestContext.getStore()?.scope?.open === true;
}

/**
 * The id of the HTTP request this code runs under, or undefined outside one. The response envelope
 * and the X-Request-Id header carry the same id, so an id a caller reports is the id on the log lines.
 */
export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
