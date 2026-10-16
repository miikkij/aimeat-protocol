/**
 * @file src/middleware/request-id.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Express middleware that assigns a request ID to every HTTP request (honoring an
 *   incoming X-Request-Id header of a bounded, safe shape for tracing) and runs the handler chain
 *   inside an AsyncLocalStorage context so all log entries carry the requestId and the caller.
 *
 *   ONE ID PER REQUEST. The same id is the X-Request-Id response header, the `request_id` of every
 *   envelope the request answers with (middleware/envelope.ts reads it through currentRequestId())
 *   and the `requestId` of every log line written while it runs. Until 2026-10-16 the envelope drew
 *   a second random id, so an id a person copied from a 403 body was on no log line (QA audit
 *   E1-05, F5-09).
 *
 *   THE CALLER IS READ WHEN A LINE IS WRITTEN. `gaii` is a getter over `req.auth`, because the
 *   context opens before optionalAuth and requireAuth set it: a value copied here was always
 *   undefined (QA audit E1-05, E3-07).
 *
 * @structure
 *   - Express.Request.requestId augmentation: types the per-request id
 *   - acceptedRequestId(header): the client's id when it has a safe shape, else undefined
 *   - requestIdMiddleware(): sets/generates the id, echoes the header, opens the log context
 *
 * @version-history
 *   2026-10-16 — One id for header, envelope and log (generateRequestId when the client sends none
 *     or one of an unsafe shape); the caller is read from req.auth when a line is written (QA audit
 *     E1-05, F5-09, E3-07).
 *   v1.1.0 — 2026-10-12 — The context carries setHeader, so a service that accepts a deprecated form
 *     names it on this response (services/deprecation.ts, Core 2026-11 HTTP-07).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../utils/request-context.js';
import type { RequestContext } from '../utils/request-context.js';
import { generateRequestId } from '../utils/tracking-code.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * The shape a client-supplied id must have to be used: letters, digits and `. _ : -`, 1 to 128
 * characters, starting with a letter or digit. An empty header, a list of ids or text with spaces
 * or control characters gets a node-made id instead, so a client cannot blank the id its requests
 * are logged under or write arbitrary text into every line.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function acceptedRequestId(header: unknown): string | undefined {
  return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : undefined;
}

/**
 * Assigns one request ID to every HTTP request: the incoming X-Request-Id when it has a safe shape,
 * a node-made `req-…` id otherwise. Wraps the downstream handler chain in an AsyncLocalStorage
 * context so that every Winston log entry includes the requestId and the caller.
 */
export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = acceptedRequestId(req.headers['x-request-id']) ?? generateRequestId();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const ctx: RequestContext = {
      requestId,
      // Read per line: req.auth is set after this middleware, by optionalAuth or requireAuth.
      get gaii() { return req.auth?.sub; },
      // A Link header may already carry other relations (discoveryLinkHeaders), so Link is appended.
      setHeader: (name, value) => {
        if (res.headersSent) return;
        if (name.toLowerCase() === 'link') res.append('Link', value);
        else res.setHeader(name, value);
      },
    };

    requestContext.run(ctx, () => next());
  };
}
