/**
 * @file src/utils/request-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-request context every log line and every response envelope reads: the
 *   request id and the caller. An AsyncLocalStorage opened by middleware/request-id.ts. A leaf
 *   module, so the logger (utils/logger.ts) and the envelope (middleware/envelope.ts) read it
 *   without a cycle, and a test that replaces the logger module still has it.
 * @structure RequestContext · requestContext · currentRequestId()
 * @usage const id = currentRequestId(); // undefined outside an HTTP request
 * @version-history
 *   2026-10-16 — Moved out of utils/logger.ts; currentRequestId() added (QA audit E1-05, F5-09).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

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
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * The id of the HTTP request this code runs under, or undefined outside one. The response envelope
 * and the X-Request-Id header carry the same id, so an id a caller reports is the id on the log lines.
 */
export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
