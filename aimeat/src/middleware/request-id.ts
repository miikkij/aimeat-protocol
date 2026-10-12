/**
 * @file src/middleware/request-id.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Express middleware that assigns a request ID to every HTTP request (honoring an
 *   incoming X-Request-Id header for tracing) and runs the handler chain inside an
 *   AsyncLocalStorage context so all log entries carry the requestId and caller GAII.
 *
 * @structure
 *   - Express.Request.requestId augmentation: types the per-request id
 *   - requestIdMiddleware(): sets/generates the id, echoes the header, opens the log context
 *
 * @version-history
 *   v1.1.0 — 2026-10-12 — The context carries setHeader, so a service that accepts a deprecated form
 *     names it on this response (services/deprecation.ts, Core 2026-11 HTTP-07).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requestContext } from '../utils/logger.js';
import type { RequestContext } from '../utils/logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Assigns a unique request ID to every HTTP request.
 * Uses incoming X-Request-Id header if present (for distributed tracing).
 * Generates a UUIDv4 if absent.
 *
 * Wraps the downstream handler chain in an AsyncLocalStorage context so
 * that every Winston log entry automatically includes the requestId.
 */
export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const ctx: RequestContext = {
      requestId,
      gaii: req.auth?.sub,
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
