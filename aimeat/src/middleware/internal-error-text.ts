/**
 * @file src/middleware/internal-error-text.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps the node's own exception text out of a 500 answer, and in the log.
 *
 *   ONE PLACE, NOT 76. The secrets audit of 2026-10-09 (07-side-channels d4) counted 76 route
 *   handlers that answer a failure with `res.status(500).json(error(..., err.message))` or
 *   `String(err)`, bypassing the global error handler's generic text. That text is whatever threw: a
 *   TypeError naming a variable, a Postgres error quoting the caller's input and the column, a host
 *   name. Editing 76 catch blocks would leave the 77th that someone writes next month, so the answer
 *   is changed where every JSON response already passes: res.json.
 *
 *   WHAT IS CHANGED. A response with status 500 whose envelope is `ok: false` and whose code means
 *   the node failed (middleware/message-audience.ts, audience `ours`: INTERNAL_ERROR, INTERNAL,
 *   anything ending in _FAILED, _ERROR or _TIMEOUT). Its message becomes one sentence that names the
 *   envelope's request id; the code, the status and the hints stay. The original message goes to
 *   the log with the same request id, through the logger's credential redaction.
 *
 *   WHAT IS NOT. A 500 with a code a caller or a person acts on is an answer someone wrote, not a
 *   crash. 502, 503 and 504 carry authored answers (a provider's reason, "not configured") and are
 *   left alone. A route whose 500 message is written for the caller ("you were not charged") passes
 *   it through keepErrorMessage().
 *
 *   It wraps res.json AFTER systemFaultReporter, so the fault report the operator receives carries
 *   the sentence the caller saw, not the exception text.
 * @structure KEEP_MESSAGE · keepErrorMessage() · internalErrorSentence() · hideInternalErrorText()
 * @usage app.use(systemFaultReporter(config, storage)); app.use(hideInternalErrorText());
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, 07-side-channels d4).
 */
import type { Request, Response, NextFunction } from 'express';
import { audienceOf } from './message-audience.js';
import { logger } from '../utils/logger.js';

/** Marks an envelope whose 500 message the route wrote for the caller. A symbol, so JSON never carries it. */
const KEEP_MESSAGE = Symbol.for('aimeat.keepErrorMessage');

interface ErrorEnvelope {
  ok?: boolean;
  request_id?: string;
  error?: { code?: string; message?: string };
  [KEEP_MESSAGE]?: true;
}

/**
 * Pass a 500 envelope's message to the caller as written. For a sentence the route authored for the
 * caller, never for text that came from an exception.
 */
export function keepErrorMessage<T extends object>(envelope: T): T {
  (envelope as ErrorEnvelope)[KEEP_MESSAGE] = true;
  return envelope;
}

/** What the caller reads instead of the exception text. */
export function internalErrorSentence(requestId: string | undefined): string {
  const ref = requestId ? ` The node logged the details under request id ${requestId}.` : '';
  return `The node could not finish this request. This was not caused by anything you did, and trying again often works.${ref}`;
}

export function hideInternalErrorText() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      const envelope = body as ErrorEnvelope | null;
      const err = envelope && typeof envelope === 'object' && envelope.ok === false ? envelope.error : undefined;
      if (res.statusCode === 500 && err && typeof err.message === 'string' && typeof err.code === 'string'
        && !envelope![KEEP_MESSAGE] && audienceOf(err.code) === 'ours') {
        const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
        logger.error(`[500] ${req.method} ${typeof route === 'string' ? route : req.path}: ${err.code}`, {
          request_id: envelope!.request_id,
          reason: err.message,
        });
        const shown = { ...envelope, error: { ...err, message: internalErrorSentence(envelope!.request_id) } };
        return originalJson(shown);
      }
      return originalJson(body);
    };
    next();
  };
}
