/**
 * @file src/services/auth-audit.ts
 * @description The refusal log: one line per request this node turned away at the door, written to
 *   a file an operator can read, grep and keep.
 *
 *   WHY A FILE AND NOT A COUNTER. `aimeat_auth_failures_total` says five people were refused since
 *   boot and nothing else. The question an operator actually has is who tried, from where, at which
 *   door, and with what — and a counter cannot answer any of it. This is the answer, in the one
 *   shape that survives being read a month later by somebody with grep and no tooling.
 *
 *   WHY NOT ACCOUNT EVENTS. Those are things that happened to a PERSON, keyed on their account. A
 *   401 from a stranger has no account to key on: not knowing who they are is the whole event.
 *
 *   WHAT IS NEVER WRITTEN. The credential itself, in any form that could be replayed: no bearer
 *   token, no password, no cookie. What IS written is a short digest of the credential presented,
 *   which is what turns a wall of refusals into a story — the same eight characters four hundred
 *   times is one dead token being retried, and four hundred different ones is somebody guessing.
 *   The digest is truncated so it identifies a credential across lines without being one.
 *
 *   BOUNDED BY CONSTRUCTION. The volume here is chosen by whoever is attacking, not by this node,
 *   so an unbounded file is a way to fill an operator's disk from the outside. The file rotates at
 *   a byte ceiling and exactly one generation is kept. Losing the oldest refusals is the right
 *   trade against losing the node.
 *
 *   NEVER IN THE WAY. Recording a refusal must not be able to change one. Every write is
 *   synchronous but tiny, and every failure is swallowed after one warning: a node that cannot
 *   write its log still has to be able to refuse people.
 * @structure AuthFailureContext · AuthFailureRecord · recordAuthFailure · credentialDigest · configureAuthAudit
 * @usage
 *   configureAuthAudit(config);                       // once, at boot
 *   recordAuthFailure(ctx, { status: 401, code: 'AUTH_REQUIRED', reason: 'no credential' });
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial: who was refused, at which door, and with what.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { AimeatConfig } from '../config-types.js';
import { logger } from '../utils/logger.js';

/**
 * Everything about the refused request this log needs, as PLAIN DATA.
 *
 * Deliberately not a `Request`. A service that takes one can only ever be called from an HTTP door,
 * and this project has already paid for that once: an ownership check written around a Request
 * could not be called from the MCP surface, so the MCP surface called nothing and any agent with
 * the right scope could act on another owner's extension. Whoever refuses somebody hands over what
 * they know; the shape does not care where they were standing.
 */
export interface AuthFailureContext {
  method: string;
  path: string;
  ip: string;
  host: string;
  userAgent: string;
  /** The Authorization header AS PRESENTED. Used only to derive `kind` and a truncated digest; the
   *  value itself is never written anywhere. */
  authorization?: string;
  /** Whether a cookie was presented, when no Authorization header was. */
  hasCookie: boolean;
  /** Who the caller claimed to be, when the credential parsed far enough to say. */
  principal?: { sub: string; owner: string; roles: string[]; app?: string; anonymous?: boolean };
}

/** One refused request. Written as a single JSON line so a file of them is both greppable and parsable. */
export interface AuthFailureRecord {
  /** 401 when no usable credential was presented, 403 when a real one lacked the authority. */
  status: 401 | 403;
  /** The envelope code the caller received, so a line here matches what they saw. */
  code: string;
  /** Why, in the node's own words. The 401 message, or the role/scope that was missing. */
  reason: string;
}

let filePath = '';
let maxBytes = 0;
let warned = false;

/** Wire the log at boot. Called once; an unset path disables the log entirely. */
export function configureAuthAudit(config: Pick<AimeatConfig, 'authLogPath' | 'authLogMaxBytes'>): void {
  filePath = config.authLogPath ?? '';
  maxBytes = config.authLogMaxBytes ?? 0;
  warned = false;
}

/** Test seam: the same wiring without a whole config. */
export function configureAuthAuditForTest(path: string, bytes: number): void {
  filePath = path;
  maxBytes = bytes;
  warned = false;
}

/**
 * A short, stable digest of the credential that was presented.
 *
 * Enough to say "this is the same one again" across lines and across days; far too little to be
 * one. Twelve hex characters of a SHA-256, which is not reversible and not replayable, and the
 * empty string when nothing was presented — because "they sent no credential at all" is itself the
 * finding on most of these lines.
 */
export function credentialDigest(raw: string | undefined | null): string {
  if (!raw) return '';
  return createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

/** The credential as presented, without reading its value: only where it came from and its digest. */
function credentialOf(ctx: AuthFailureContext): { kind: string; digest: string } {
  const header = ctx.authorization;
  if (typeof header === 'string' && header.length > 0) {
    const space = header.indexOf(' ');
    const scheme = space > 0 ? header.slice(0, space).toLowerCase() : 'raw';
    const value = space > 0 ? header.slice(space + 1) : header;
    // `pat-` and `eyJ` are the two shapes worth telling apart on sight: a personal access token
    // being retried is an operator's own thing gone stale, a JWT is a session or an agent.
    const kind = value.startsWith('pat-') ? 'pat' : value.startsWith('eyJ') ? `${scheme}-jwt` : scheme;
    return { kind, digest: credentialDigest(value) };
  }
  if (ctx.hasCookie) return { kind: 'cookie', digest: '' };
  return { kind: 'none', digest: '' };
}

/** Rotate when the file has grown past the ceiling. One generation, then the oldest is dropped. */
function rotateIfNeeded(): void {
  if (maxBytes <= 0 || !existsSync(filePath)) return;
  if (statSync(filePath).size < maxBytes) return;
  renameSync(filePath, `${filePath}.1`);
}

/**
 * Record one refusal. Fire and forget: this never throws and never changes the response.
 *
 * The path is deliberately synchronous. These are rare by design and each line is a few hundred
 * bytes, and an async write would let the process exit with the most interesting refusal still in
 * a buffer — which is exactly the one an operator went looking for.
 */
export function recordAuthFailure(ctx: AuthFailureContext, record: AuthFailureRecord): void {
  if (!filePath) return;
  try {
    const cred = credentialOf(ctx);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      status: record.status,
      code: record.code,
      reason: record.reason,
      method: ctx.method,
      // The path only. A query string on a refused request is caller-controlled text, and copying
      // it into a file an operator later opens is how a log becomes an injection surface.
      path: ctx.path,
      ip: ctx.ip,
      host: ctx.host,
      ua: ctx.userAgent.slice(0, 200),
      credential: cred.kind,
      credential_digest: cred.digest,
      ...(ctx.principal ? { principal: ctx.principal } : {}),
    });
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotateIfNeeded();
    appendFileSync(filePath, line + '\n', 'utf-8');
  } catch (err) {
    // Warned once per boot. A node that cannot write this file must still be able to refuse people,
    // and a warning per refusal would turn a full disk into a second flood.
    if (!warned) {
      warned = true;
      logger.warn('auth-audit: cannot write the refusal log; refusals still happen, they are just not recorded', {
        path: filePath, error: String(err),
      });
    }
  }
}
