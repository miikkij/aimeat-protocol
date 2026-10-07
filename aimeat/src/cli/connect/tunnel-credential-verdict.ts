/**
 * @file tunnel-credential-verdict.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When a forwarded answer is a verdict on the CALLER'S credential, and what the tunnel
 *   client does about one before it gives an identity up.
 *
 *   A 401 IS NOT ALWAYS ABOUT THE CALLER. Until 2026-10-07 the node's AI routes answered 401
 *   INVALID_API_KEY when the provider refused the key the NODE (or the owner) holds, and the agent's
 *   own credential was fine. They answer 424 now (services/ai/errors.ts PROVIDER_KEY_REFUSED_STATUS),
 *   but a connector also talks to nodes older than that, and other routes answer their own 401s.
 *   Until 2026-10-07 the client read every forwarded 401 as its credential dying: on a fresh place
 *   (aimeat-commercial, stripetestiydqzuo) the crm agent's first model call met a provider refusal,
 *   the client detached crm, every later call for it waited out the request timeout on an
 *   UNKNOWN_IDENTITY error frame, and the serve daemon reported it auth_failed so the next spawn exited
 *   at once. When the socket's OWN identity met the same 401, the whole client stopped, taking every
 *   agent on the daemon with it. The node's credential refusals carry their own codes (auth/deny.ts
 *   answers AUTH_REQUIRED), and only those count.
 *
 *   A CREDENTIAL THAT CAN BE REPLACED IS REPLACED FIRST. A key-holding agent mints its credential, and
 *   the node authorizes a forwarded call against the token pinned when the identity attached, which
 *   a mint cannot reach. So a refused pin gets one fresh mint and one attach before the identity is
 *   given up, and the call that met the refusal is sent once more. An identity that can produce no
 *   different credential (a stored bearer) is given up exactly as before.
 * @structure isCredentialVerdict() · errorFrameAnswer() · CredentialRecovery
 * @usage
 *   if (isCredentialVerdict(status, code)) { const p = recovery.begin(identity); ... }
 * @version-history
 *   v1.0.0 -- 2026-10-07 -- Initial: the forwarded-401 verdict narrowed to credential codes, error
 *     frames answer their forward, one re-mint and re-attach before an identity is given up.
 */
import type { ForwardResult, TunnelFrame, TunnelIdentity } from './tunnel-client-types.js';
import { TOKEN_DEAD_CODES } from './tunnel-client-types.js';
import { logger } from '../../utils/logger.js';

/** What the node answers when it refuses the bearer itself: requireAuth's 401 (auth/deny.ts). */
const CREDENTIAL_401_CODES = new Set(['AUTH_REQUIRED', ...TOKEN_DEAD_CODES]);

/**
 * Does this forwarded answer say the CALLER'S credential was refused?
 *
 * A dead-token code at any status, or a 401 with a credential code or with no code at all. A 401
 * carrying any other code (INVALID_API_KEY, INVALID_PASSWORD, INVALID_ASSERTION) is about something
 * else the route checked, and the identity stays where it is.
 */
export function isCredentialVerdict(status: number | undefined, code: string): boolean {
  if (TOKEN_DEAD_CODES.has(code)) return true;
  return status === 401 && (code === '' || CREDENTIAL_401_CODES.has(code));
}

/** The error code inside a forwarded envelope, or ''. */
export function errorCodeOf(body: unknown): string {
  return ((body as { error?: { code?: string } } | null)?.error?.code) ?? '';
}

/**
 * The answer a forward gets when the node refuses its `request` frame with an `error` frame instead
 * of a `response`: a malformed frame (400), or an identity this socket does not carry (503, because
 * nothing the caller can change in the request fixes it, and a re-attach may).
 */
export function errorFrameAnswer(frame: TunnelFrame): ForwardResult {
  const code = frame.code ?? 'TUNNEL_ERROR';
  return {
    status: code === 'BAD_REQUEST_FRAME' ? 400 : 503,
    body: { ok: false, error: { code, message: frame.message ?? 'The node refused this request on the tunnel.' } },
  };
}

/** How long after one recovery attempt another verdict for the same identity is taken as final. */
const RECOVERY_WINDOW_MS = 60_000;

export interface RecoveryContext {
  /** Put the identity back on the socket with exactly this credential. True when the node accepts. */
  reattach: (identity: TunnelIdentity, token: string) => Promise<boolean>;
  /** The credential the identity's current attach pinned, if this client recorded one. */
  pinned: (gaii: string) => string | undefined;
}

/**
 * One re-mint and one re-attach per identity per window, shared by every forward that met the same
 * verdict: twelve calls refused together wait on one attempt rather than starting twelve.
 */
export class CredentialRecovery {
  private inFlight = new Map<string, Promise<boolean>>();
  private lastTry = new Map<string, number>();

  constructor(private readonly ctx: RecoveryContext) {}

  /**
   * Start (or join) the recovery of one identity. Null when it cannot recover: it has no way to drop
   * its cached credential, or it already tried within the window. The promise resolves true when the
   * identity is back on the socket with a new credential.
   */
  begin(identity: TunnelIdentity): Promise<boolean> | null {
    const running = this.inFlight.get(identity.gaii);
    if (running) return running;
    if (!identity.forgetToken) return null;
    const now = Date.now();
    if (now - (this.lastTry.get(identity.gaii) ?? 0) < RECOVERY_WINDOW_MS) return null;
    this.lastTry.set(identity.gaii, now);

    const attempt = (async () => {
      try {
        identity.forgetToken!();
        const token = await identity.getToken();
        // The same string again is the same refusal again: a stored bearer cannot be renewed here.
        if (!token || token === this.ctx.pinned(identity.gaii)) return false;
        return await this.ctx.reattach(identity, token);
      } catch (err) {
        // A mint that failed now ends this attempt; the verdict stands and the identity is given up.
        logger.warn('tunnel credential recovery: no new credential', { agent: identity.gaii, error: String(err) });
        return false;
      }
    })();
    this.inFlight.set(identity.gaii, attempt);
    void attempt.finally(() => this.inFlight.delete(identity.gaii));
    return attempt;
  }

  /** The recovery running for this identity right now, if any. */
  pending(gaii: string): Promise<boolean> | undefined {
    return this.inFlight.get(gaii);
  }
}
