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
    };

    requestContext.run(ctx, () => next());
  };
}
