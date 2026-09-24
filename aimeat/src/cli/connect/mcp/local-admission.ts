/**
 * @file cli/connect/mcp/local-admission.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may use the serve daemon. ONE check, in front of every route the daemon has, so
 *   no route can be added without it: the MCP endpoint, the REST proxy, the tool-call dispatch, the
 *   long-polls, status, stats and shutdown all sit behind the same three questions.
 *
 *   1. IS THE HOST HEADER A LOOPBACK NAME FOR THIS PORT? A web page that rebinds its own domain to
 *      127.0.0.1 is same-origin with the daemon and can read every answer, but its requests still
 *      carry its own domain in Host. The names are the three the MCP SDK's localhostHostValidation
 *      accepts; the port is compared as well, which that middleware does not do.
 *   2. DOES THE REQUEST CARRY AN ORIGIN HEADER? Browsers send one on a cross-site request, and a
 *      simple POST with no body or a text/plain body needs no preflight, so a page can stop the
 *      daemon or post through the proxy blind. The CLI, the terminal UI and the Python liaison never
 *      send Origin, so a request that has one is refused.
 *   3. DOES IT PRESENT THE SECRET? A random value made at every start and written into serve.json
 *      (owner-only where the OS supports it). This is the only one of the three that also stops
 *      another local process or another user on the same machine, which on a fleet host is every
 *      other owner's crew runtime. Compared in constant time.
 *
 *   Refused before the body is parsed, so a stranger's 25 MB body is never read.
 * @structure LOOPBACK_REFUSAL · newLoopbackSecret() · isLoopbackHostFor() · admitLoopbackCaller()
 * @usage
 *   const secret = newLoopbackSecret();
 *   app.use(admitLoopbackCaller(secret));   // first, before express.json()
 *   // serve.json carries `secret`; a client sends `Authorization: Bearer <secret>`.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Created (secaudit 2026-09, A9-1): the daemon answered any caller that
 *     reached 127.0.0.1, whatever its Host, its Origin or its credential.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** The codes a refusal carries. A client reads these to tell "the daemon said no" from the node. */
export const LOOPBACK_REFUSAL = {
  host: 'LOOPBACK_HOST_REFUSED',
  origin: 'LOOPBACK_ORIGIN_REFUSED',
  secret: 'LOOPBACK_SECRET_REQUIRED',
} as const;

/** A fresh secret for one daemon start: 32 random bytes, base64url. */
export function newLoopbackSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>`, and nothing else: no other name, no
 * missing port, no user part. The whole header must match, because a URL parser reads
 * `evil@127.0.0.1:1` as the loopback host.
 */
export function isLoopbackHostFor(host: string | undefined, port: number | undefined): boolean {
  if (!host || !port) return false;
  const m = /^(localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})$/i.exec(host.trim());
  return !!m && Number(m[2]) === port;
}

/** SHA-256 of the value, so the constant-time compare always sees two buffers of one length. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function refuse(res: Response, status: number, code: string, message: string): void {
  if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="aimeat connect serve"');
  res.status(status).json({ ok: false, error: { code, message } });
}

/**
 * The admission middleware. Mount it FIRST, before the body parser and before any route, so that
 * nothing the daemon serves is reachable without it.
 */
export function admitLoopbackCaller(secret: string): RequestHandler {
  const expected = digest(secret);
  return (req: Request, res: Response, next: NextFunction): void => {
    // The port the request actually arrived on, read from the socket: it is known here without
    // waiting for listen() to report it, and it is the one port a Host header may name.
    if (!isLoopbackHostFor(req.headers.host, req.socket.localPort)) {
      refuse(res, 403, LOOPBACK_REFUSAL.host,
        'This daemon answers only requests addressed to 127.0.0.1 or localhost on its own port.');
      return;
    }
    if (req.headers.origin !== undefined) {
      refuse(res, 403, LOOPBACK_REFUSAL.origin,
        'This daemon does not answer requests from a web page. Call it from a local program.');
      return;
    }
    const auth = req.headers.authorization;
    const presented = typeof auth === 'string' && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
    if (!presented || !timingSafeEqual(digest(presented), expected)) {
      refuse(res, 401, LOOPBACK_REFUSAL.secret,
        'Send the secret from serve.json in the connector home as "Authorization: Bearer <secret>". '
        + 'A new secret is made every time the daemon starts.');
      return;
    }
    next();
  };
}
