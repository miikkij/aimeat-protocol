/**
 * @file src/middleware/fallback-handlers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two handlers mounted after every route: the JSON 404 for an address no route
 *   answers, and the global error handler for whatever a route or a body parser throws.
 *
 *   Both built their JSON by hand until 2026-10-15, so neither carried a request id or the support
 *   next step every other error carries (feature-list audit #194), and the 404 put the method and the
 *   path in its sentence. They go through the shared error() envelope now (middleware/envelope.ts),
 *   with the identifiers in `details`. The error codes are unchanged: NOT_FOUND, QUOTA_EXCEEDED,
 *   INTERNAL_ERROR and REQUEST_ERROR, which callers and suites already read.
 *
 *   A 500 still passes through hideInternalErrorText (internal-error-text.ts) and the fault reporter
 *   (system-fault.ts), which read the envelope's code; nothing here changes what they see.
 * @structure notFoundHandler(nodeId) · errorHandler(nodeId)
 * @usage app.use(notFoundHandler(config.nodeId)); app.use(errorHandler(config.nodeId));
 * @version-history
 *   2026-10-15 — Moved out of server.ts and built with error() (feature-list audit #194).
 */
import type { Request, Response, NextFunction } from 'express';
import { error } from './envelope.js';
import { logger } from '../utils/logger.js';

/** The JSON 404: Express would otherwise answer an unknown address with an HTML page. */
export function notFoundHandler(nodeId: string) {
  return (req: Request, res: Response): void => {
    res.status(404).json(error(nodeId, 'NOT_FOUND',
      'Nothing on this node answers that address. Check the address and the method in the API reference.',
      404, { method: req.method, path: req.path },
      [{ description: 'Read the API reference', method: 'GET', url: '/v1/docs' }]));
  };
}

/** The global error handler: a thrown error, a body over the size limit, a body that does not parse. */
export function errorHandler(nodeId: string) {
  return (err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction): void => {
    const status = err.status ?? 500;
    const isPayloadError = err.type === 'entity.too.large' || status === 413;
    if (status >= 500) {
      logger.error('Unhandled error', { error: err.message, stack: err.stack });
    }
    if (isPayloadError) {
      res.status(status).json(error(nodeId, 'QUOTA_EXCEEDED',
        'The request body is larger than this node accepts. Send a smaller body, or split it into several requests.',
        status, { reason: 'entity.too.large' }));
      return;
    }
    if (status >= 500) {
      res.status(status).json(error(nodeId, 'INTERNAL_ERROR',
        'Something went wrong on this node. Try again in a moment.', status, undefined,
        [{ description: 'Try again, or check whether the node is up', method: 'GET', url: '/' }]));
      return;
    }
    // A caller's error the body parser or a route threw (a body that does not parse, a bad header).
    // The thrown text names the parser's view of it, so it goes in details, not in the sentence.
    res.status(status).json(error(nodeId, 'REQUEST_ERROR',
      'The request could not be read. Check that the body is well formed and matches its Content-Type, then send it again.',
      status, { reason: err.message, ...(err.type ? { type: err.type } : {}) }));
  };
}
