/**
 * @file src/config-turn.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The TURN relay settings that GET /v1/realtime/ice-servers reads: the relay's URL, the
 *   coturn shared secret the node derives each client's expiring credential from, and how long that
 *   credential stays valid. The static username and credential pair is deprecated and still served
 *   when no secret is set, so an existing deployment keeps its relay.
 *
 *   Its own file because config.ts and config-types.ts are at the line ceiling. The three existing
 *   fields moved here unchanged; turnSecret and turnTtlSeconds are new.
 * @structure TurnConfig · TURN_TTL_* · turnTtlFrom(raw) · turnDefaults()
 * @usage
 *   import { turnDefaults } from './config-turn.js';
 *   const config = { ...turnDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial: turnServer, turnUsername and turnCredential moved from config.ts
 *     unchanged; turnSecret (AIMEAT_TURN_SECRET) and turnTtlSeconds (AIMEAT_TURN_TTL_SECONDS) added.
 */

/** Default, lowest and highest lifetime of a derived TURN credential, in seconds. */
export const TURN_TTL_DEFAULT_SECONDS = 3600;
export const TURN_TTL_MIN_SECONDS = 60;
export const TURN_TTL_MAX_SECONDS = 86400;

/** Declared here, not picked from AimeatConfig, so this file imports nothing (config-decide.ts gives the reason). */
export interface TurnConfig {
  /** TURN relay URL handed to WebRTC clients, e.g. `turn:turn.example.com:3478`. Null: no relay. */
  turnServer: string | null;
  /** Deprecated static username, served only when turnSecret is not set. */
  turnUsername: string | null;
  /** Deprecated static credential, served only when turnSecret is not set. */
  turnCredential: string | null;
  /**
   * The coturn `static-auth-secret` (coturn runs with `use-auth-secret`). Never sent to a client:
   * each client receives a username carrying an expiry and an HMAC of that username under this
   * secret (services/turn-credentials.ts). Null: the static pair above is served instead.
   */
  turnSecret: string | null;
  /** Lifetime of a derived TURN credential in seconds, 60 to 86400. */
  turnTtlSeconds: number;
}

/** The TTL from its raw env string: the default when absent or not a number, else clamped to the range. */
export function turnTtlFrom(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return TURN_TTL_DEFAULT_SECONDS;
  return Math.min(TURN_TTL_MAX_SECONDS, Math.max(TURN_TTL_MIN_SECONDS, n));
}

export function turnDefaults(): TurnConfig {
  return {
    turnServer: process.env.AIMEAT_TURN_SERVER ?? null,
    turnUsername: process.env.AIMEAT_TURN_USERNAME ?? null,
    turnCredential: process.env.AIMEAT_TURN_CREDENTIAL ?? null,
    // An empty value means unset: an empty HMAC key would still derive credentials coturn rejects.
    turnSecret: process.env.AIMEAT_TURN_SECRET || null,
    turnTtlSeconds: turnTtlFrom(process.env.AIMEAT_TURN_TTL_SECONDS),
  };
}
