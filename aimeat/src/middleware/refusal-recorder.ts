/**
 * @file src/middleware/refusal-recorder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes every 401 and 403 this node answers to the refusal log
 *   (services/auth-audit.ts), whichever code path answered it.
 *
 *   WHY ONE PLACE. The refusal log had two writers: the auth middleware (auth/deny.ts) and the
 *   sign-in tarpit on four routes. Every other route that refused a credential or an owner answered
 *   401 or 403 itself and left no line: the admin password routes, MCP OAuth, the refresh cookie
 *   (its reuse answer included), the access-token exchange, the v2 agent assertion, the passkey
 *   sign-in, and the ownership refusals written inside route handlers (QA audit S1-02, E2-07,
 *   E2-08; Core evidence AUTHZ-17). Asking each of them to remember is how they were missed, so the
 *   line is written where every response passes, as middleware/system-fault.ts does for faults.
 *
 *   NOT TWICE. A refusal auth/deny.ts or the tarpit already wrote is marked on the response
 *   (services/auth-audit.ts markRefusalRecorded), and this middleware skips it. A 401 deny401 has not counted moves
 *   `auth_failures_total` here, so the counter covers a wrong password and a refused token too.
 *
 *   WHAT IS WRITTEN. The status, the code and the sentence the caller received, the route, and what
 *   auth/deny.ts auditContext() reads off the request (the address, the user agent, the kind and a
 *   digest of the credential presented, the principal when one was resolved). Never a credential.
 * @structure refusalRecorder()
 * @usage app.use(requestIdMiddleware()); app.use(refusalRecorder()); app.use(optionalAuth());
 * @version-history
 *   2026-10-16 — Initial (QA audit S1-02, E2-07, E2-08).
 */
import type { Request, Response, NextFunction } from 'express';
import { recordAuthFailure, refusalMarkOf } from '../services/auth-audit.js';
import { getStats } from '../services/stats.js';
import { getPromMetrics } from '../services/prometheus.js';
import { auditContext } from '../auth/deny.js';

/** The longest reason written for one line; the caller's sentence can carry their own input. */
const MAX_REASON = 300;

/** The code and the sentence a refusal body carries, in the three shapes this node answers with. */
function refusalOf(body: unknown): { code: string; reason: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { error?: unknown; error_description?: unknown; message?: unknown };
  if (b.error && typeof b.error === 'object') {
    const e = b.error as { code?: unknown; message?: unknown };
    return { code: typeof e.code === 'string' ? e.code : 'REFUSED', reason: typeof e.message === 'string' ? e.message : '' };
  }
  if (typeof b.error === 'string') {
    // The OAuth shape (RFC 6749 §5.2): `error` is the code, `error_description` the sentence.
    if (typeof b.error_description === 'string') return { code: b.error, reason: b.error_description };
    return { code: 'REFUSED', reason: b.error };
  }
  return null;
}

export function refusalRecorder() {
  return (req: Request, res: Response, next: NextFunction): void => {
    let seen: { code: string; reason: string } | null = null;
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      if (res.statusCode === 401 || res.statusCode === 403) seen = refusalOf(body);
      return originalJson(body);
    };
    res.on('finish', () => {
      const status = res.statusCode;
      if (status !== 401 && status !== 403) return;
      const mark = refusalMarkOf(res);
      const route = (req.route as { path?: string } | undefined)?.path;
      const where = `${req.method} ${req.baseUrl ?? ''}${typeof route === 'string' ? route : req.path}`;
      if (!mark?.logged) {
        const reason = (seen?.reason || `refused at ${where}`).slice(0, MAX_REASON);
        recordAuthFailure(auditContext(req), { status, code: seen?.code ?? 'REFUSED', reason });
      }
      if (status === 401 && !mark?.counted) {
        getStats()?.increment('auth_failures_total');
        getPromMetrics()?.authFailuresTotal.inc();
      }
    });
    next();
  };
}
