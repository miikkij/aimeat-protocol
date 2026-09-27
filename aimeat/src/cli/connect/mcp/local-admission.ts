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
 *
 *   A CALLER THAT SENDS NO SECRET, FOR ONE RELEASE. Some crew runtimes do not send the secret yet,
 *   and aimeat-crewai before 0.29.0 sends the placeholder `Bearer loopback-trusted` in its place.
 *   So that the daemon and those runtimes can be updated in either order, a daemon older than
 *   SECRETLESS_CALLER_REFUSED_FROM lets such a caller in and names it in its log, once per caller
 *   per start. From that release the same code refuses it: the daemon reads its own version when it
 *   starts. Questions 1 and 2 are asked of every caller in every release, and a wrong secret is
 *   always refused. test/unit/serve-secretless-caller-follows-the-release.test.ts fails when the
 *   package reaches that release, because the grace is dead code from then on.
 * @structure LOOPBACK_REFUSAL · SECRETLESS_CALLER_REFUSED_FROM · LEGACY_PLACEHOLDER_BEARER ·
 *   MAX_SECRETLESS_CALLERS_NAMED · newLoopbackSecret() · isLoopbackHostFor() ·
 *   secretlessCallerAdmitted() · admitLoopbackCaller()
 * @usage
 *   const secret = newLoopbackSecret();
 *   app.use(admitLoopbackCaller(secret));   // first, before express.json()
 *   // serve.json carries `secret`; a client sends `Authorization: Bearer <secret>`.
 * @version-history
 *   v1.1.0 — 2026-09-26 — A caller that sends no secret is let in, and named once per start in the
 *     daemon's log, while the daemon's version is below SECRETLESS_CALLER_REFUSED_FROM (3.20.0);
 *     from that release it is refused. The placeholder bearer of aimeat-crewai before 0.29.0 counts
 *     as no secret.
 *   v1.0.0 — 2026-09-24 — Created (secaudit 2026-09, A9-1): the daemon answered any caller that
 *     reached 127.0.0.1, whatever its Host, its Origin or its credential.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { compareVersions } from '../../../services/federation-overview.js';
import { getSoftwareVersion } from '../../../utils/version.js';

/** The codes a refusal carries. A client reads these to tell "the daemon said no" from the node. */
export const LOOPBACK_REFUSAL = {
  host: 'LOOPBACK_HOST_REFUSED',
  origin: 'LOOPBACK_ORIGIN_REFUSED',
  secret: 'LOOPBACK_SECRET_REQUIRED',
} as const;

/**
 * The release from which the daemon refuses a caller that sends no secret. A daemon older than this
 * lets such a caller in and names it in its log. The release that reaches this number removes the
 * grace, and the unit test named in the header fails until it does.
 */
export const SECRETLESS_CALLER_REFUSED_FROM = '3.20.0';

/**
 * The bearer aimeat-crewai before 0.29.0 sends on a loopback MCP session, in place of a secret it did
 * not have. It carries no secret, so it counts as none, never as a wrong one.
 */
export const LEGACY_PLACEHOLDER_BEARER = 'loopback-trusted';

/**
 * How many callers without the secret one start names: enough for a fleet of about a hundred agents
 * that each call with two programs. After this many, one more line says that the daemon names no more
 * of them, so a caller that changes its User-Agent on every call cannot fill the log.
 */
export const MAX_SECRETLESS_CALLERS_NAMED = 256;

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

/**
 * Whether a daemon of this version lets in a caller that sends no secret: only below
 * SECRETLESS_CALLER_REFUSED_FROM, and only when the version reads as numbers. A daemon that cannot
 * tell its own version lets no such caller in.
 */
export function secretlessCallerAdmitted(version: string): boolean {
  return /^\d+\.\d+\.\d+/.test(version) && compareVersions(version, SECRETLESS_CALLER_REFUSED_FROM) < 0;
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
 * A value the caller typed, made fit for one line of the log: printable ASCII only, at most 120
 * characters. Undefined when there is none.
 */
function printable(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const clean = value.trim().replace(/[^\x20-\x7e]/g, '?');
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
}

/** The same, quoted, so that a quote the caller typed cannot end the value early. */
function quoted(value: unknown): string | undefined {
  const clean = printable(value);
  return clean === undefined ? undefined : JSON.stringify(clean);
}

/**
 * Who a caller without the secret is, from what its request carries: the agent it names (the
 * `X-Aimeat-Agent` header, else `?agent=`, as the daemon's routes read it), its User-Agent, and
 * whether it sent no Authorization header or the placeholder bearer. The same caller gives the
 * same words on every call, so the words are also the key it is named once by.
 */
function callerWithoutSecret(req: Request, placeholder: boolean): string {
  const agent = quoted(req.headers['x-aimeat-agent']) ?? quoted(req.query.agent);
  const program = quoted(req.headers['user-agent']);
  return [
    agent ? `agent ${agent}` : 'no agent named',
    program ? `User-Agent ${program}` : 'no User-Agent',
    placeholder ? `the placeholder "Authorization: Bearer ${LEGACY_PLACEHOLDER_BEARER}"` : 'no Authorization header',
  ].join(', ');
}

export interface LoopbackAdmissionOptions {
  /** The daemon's own version. The default is the one the package reports; a test passes its own. */
  version?: string;
  /** Where the line naming a caller without the secret goes. The default is the daemon's log. */
  warn?: (line: string) => void;
}

/**
 * The admission middleware. Mount it FIRST, before the body parser and before any route, so that
 * nothing the daemon serves is reachable without it.
 */
export function admitLoopbackCaller(secret: string, options: LoopbackAdmissionOptions = {}): RequestHandler {
  const expected = digest(secret);
  const secretlessAdmitted = secretlessCallerAdmitted(options.version ?? getSoftwareVersion());
  const warn = options.warn ?? ((line: string) => { console.error(line); });
  // The callers without the secret this start has named, and whether it has said it names no more.
  const named = new Set<string>();
  let stoppedNaming = false;

  const nameOnce = (req: Request, placeholder: boolean): void => {
    const caller = callerWithoutSecret(req, placeholder);
    if (stoppedNaming || named.has(caller)) return;
    if (named.size >= MAX_SECRETLESS_CALLERS_NAMED) {
      stoppedNaming = true;
      warn('[serve] More callers sent no secret, and this daemon let them in. It names no more of them until it '
        + `restarts. From aimeat ${SECRETLESS_CALLER_REFUSED_FROM} the daemon refuses such a caller.`);
      return;
    }
    named.add(caller);
    warn(`[serve] A caller sent no secret, and this daemon let it in: ${caller}, first request ${req.method} `
      + `${printable(req.path) ?? '/'}. From aimeat ${SECRETLESS_CALLER_REFUSED_FROM} the daemon refuses such a caller. `
      + 'The caller must send "Authorization: Bearer <secret>" with the secret from serve.json in the connector '
      + 'folder. The daemon names each caller once per start.');
  };

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
    const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
    const presented = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
    const placeholder = presented === LEGACY_PLACEHOLDER_BEARER;
    if (secretlessAdmitted && (auth === '' || placeholder)) {
      nameOnce(req, placeholder);
      next();
      return;
    }
    if (!presented || !timingSafeEqual(digest(presented), expected)) {
      refuse(res, 401, LOOPBACK_REFUSAL.secret,
        'Send the secret from serve.json in the connector home as "Authorization: Bearer <secret>". '
        + 'A new secret is made every time the daemon starts.');
      return;
    }
    next();
  };
}
