/**
 * @file src/services/turn-credentials.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The TURN entry GET /v1/realtime/ice-servers hands a caller, and the expiring
 *   credential in it. Pure functions: the route passes the config, the caller and the clock.
 *
 *   WHY. The route used to hand every principal holding social:read the node's one static TURN
 *   credential, which the Config page treats as a secret. Anyone who received it could relay through
 *   the operator's TURN server for as long as the credential stayed unchanged. With a shared secret
 *   set (coturn `use-auth-secret` + `static-auth-secret`), each caller receives the credential the
 *   TURN REST API draft defines and coturn checks:
 *     username   = `<expiry unix seconds>:<opaque id>`
 *     credential = base64(HMAC-SHA1(secret, username))
 *   coturn refuses the username after its expiry, and the secret never leaves the node.
 *
 *   The opaque id is a keyed hash of the caller's resolved identity, so a TURN server log names no
 *   account, and an account name cannot be confirmed from the log by hashing guessed names.
 *
 *   An anonymous caller and a visitor from another node get no TURN entry: the relay costs the
 *   operator bandwidth, and these callers have no account on this node to answer for it.
 * @structure
 *   - IceServer, TurnSettings, TurnCaller
 *   - turnOpaqueId(secret, identity): the short keyed hash in the username
 *   - deriveTurnCredential(secret, identity, ttlSeconds, nowMs): username, credential, expiry
 *   - turnEntryFor(settings, caller, nowMs): the TURN entry for this caller, or null
 *   - turnDeprecationWarning(settings): the boot warning for the static pair, or null
 * @usage
 *   const turn = turnEntryFor(config, caller, Date.now());
 *   if (turn) iceServers.push(turn);
 * @version-history
 *   v1.1.0 — 2026-10-12 — The static pair is a version gate: from TURN_STATIC_PAIR_REMOVED_IN a node
 *     without AIMEAT_TURN_SECRET serves the TURN address without it; before it, serving the pair is counted and named
 *     on the response (deprecated_use: turn_static_pair; Core 2026-11 HTTP-07, HTTP-08).
 *   v1.0.0 — 2026-10-09 — Initial: expiring TURN credentials from AIMEAT_TURN_SECRET; anonymous
 *     callers and visitors get no TURN entry; the static pair is deprecated, removed in 4.0.0.
 */
import { createHmac } from 'node:crypto';
import {
  TURN_STATIC_PAIR_REMOVED_IN, TURN_TTL_DEFAULT_SECONDS, TURN_TTL_MAX_SECONDS, TURN_TTL_MIN_SECONDS, type TurnConfig,
} from '../config-turn.js';
import { noteDeprecatedUse, removedFrom } from './deprecation.js';

/** One RTCIceServer entry as the route serves it. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type TurnSettings = TurnConfig;

/** What turnEntryFor needs to know about the caller: CallerContext satisfies it. */
export interface TurnCaller {
  readonly kind: string;
  readonly visitor: boolean;
  /** The resolved identity (resolveIdentity), e.g. `alice@node` or `claude#alice@node`. */
  readonly principal: string;
}

/** Domain-separation label, so the opaque id is never an HMAC that coturn would accept as a credential. */
const OPAQUE_ID_LABEL = 'aimeat-turn-user:';

/** A 16-hex-character keyed hash of the identity. The same caller gets the same id while the secret is unchanged. */
export function turnOpaqueId(secret: string, identity: string): string {
  return createHmac('sha256', secret).update(OPAQUE_ID_LABEL + identity).digest('hex').slice(0, 16);
}

function clampTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds)) return TURN_TTL_DEFAULT_SECONDS;
  return Math.min(TURN_TTL_MAX_SECONDS, Math.max(TURN_TTL_MIN_SECONDS, Math.floor(ttlSeconds)));
}

/** The TURN REST API credential for one identity: valid until `expiresAt` (unix seconds). */
export function deriveTurnCredential(
  secret: string, identity: string, ttlSeconds: number, nowMs: number,
): { username: string; credential: string; expiresAt: number } {
  const expiresAt = Math.floor(nowMs / 1000) + clampTtl(ttlSeconds);
  const username = `${expiresAt}:${turnOpaqueId(secret, identity)}`;
  // HMAC-SHA1 is what coturn computes for use-auth-secret; any other digest is a credential it refuses.
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt };
}

/**
 * The TURN entry for this caller, or null when there is none to give: no TURN server is set, or the
 * caller is anonymous (null caller included) or a visitor from another node.
 */
export function turnEntryFor(settings: TurnSettings, caller: TurnCaller | null, nowMs: number, version?: string): IceServer | null {
  if (!settings.turnServer) return null;
  if (!caller || caller.kind === 'anonymous' || caller.visitor) return null;
  if (settings.turnSecret) {
    const { username, credential } = deriveTurnCredential(settings.turnSecret, caller.principal, settings.turnTtlSeconds, nowMs);
    return { urls: settings.turnServer, username, credential };
  }
  // From TURN_STATIC_PAIR_REMOVED_IN the static pair is not served, whatever is set (Core 2026-11
  // HTTP-08): the entry carries the relay's URL alone, as it did on a node that set no pair.
  if (removedFrom(TURN_STATIC_PAIR_REMOVED_IN, version)) return { urls: settings.turnServer };
  // Deprecated static pair: still served, so a deployment without a secret keeps its relay; the use
  // is counted and named on the response (HTTP-07).
  if (settings.turnUsername || settings.turnCredential) {
    noteDeprecatedUse({
      kind: 'turn_static_pair', removedIn: TURN_STATIC_PAIR_REMOVED_IN,
      notice: 'GET /v1/realtime/ice-servers served the static TURN pair (AIMEAT_TURN_USERNAME / AIMEAT_TURN_CREDENTIAL). Set AIMEAT_TURN_SECRET.',
    });
  }
  return {
    urls: settings.turnServer,
    ...(settings.turnUsername ? { username: settings.turnUsername } : {}),
    ...(settings.turnCredential ? { credential: settings.turnCredential } : {}),
  };
}

/** The one boot warning about the static TURN pair, or null when there is nothing to say. */
export function turnDeprecationWarning(settings: TurnSettings): string | null {
  const staticPair = !!(settings.turnUsername || settings.turnCredential);
  if (!staticPair) return null;
  if (settings.turnSecret) {
    return 'AIMEAT_TURN_USERNAME / AIMEAT_TURN_CREDENTIAL are ignored because AIMEAT_TURN_SECRET is set. Remove them.';
  }
  if (removedFrom(TURN_STATIC_PAIR_REMOVED_IN)) {
    return `AIMEAT_TURN_USERNAME / AIMEAT_TURN_CREDENTIAL were removed in ${TURN_STATIC_PAIR_REMOVED_IN} and are not served: clients receive the TURN address without a credential until AIMEAT_TURN_SECRET is set. `
      + 'Set it to the coturn static-auth-secret (coturn: use-auth-secret); each caller then receives a credential that expires.';
  }
  return `AIMEAT_TURN_USERNAME / AIMEAT_TURN_CREDENTIAL are deprecated and removed in ${TURN_STATIC_PAIR_REMOVED_IN}: they give every caller the same TURN credential, and it does not expire. `
    + 'Set AIMEAT_TURN_SECRET to the coturn static-auth-secret (coturn: use-auth-secret) instead; each caller then receives a credential that expires.';
}
