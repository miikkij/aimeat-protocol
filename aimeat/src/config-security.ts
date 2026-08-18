/**
 * @file src/config-security.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two door-defence settings and their defaults, kept together because they answer
 *   one question: what happens when somebody is refused.
 *
 *   The refusal LOG answers who tried, from where, at which door and with what — the detail a
 *   counter cannot carry. The TARPIT answers what it should cost them to try again.
 *
 *   Its own file rather than more lines in config.ts and config-types.ts, which were both one
 *   change away from the 800-line ceiling. Splitting by pure extraction keeps the diff to the thing
 *   being added instead of reflowing a file two sessions are working in.
 * @structure SecurityDoorConfig · securityDoorDefaults()
 * @usage
 *   interface AimeatConfig extends SecurityDoorConfig { … }
 *   return { ...securityDoorDefaults(), … };
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial: the refusal log and the credential-door tarpit.
 */

export interface SecurityDoorConfig {
  /**
   * The refusal log: every 401 and 403 this node answers, one JSON line each, so an operator can
   * see who is trying and with what rather than only how many were refused since boot.
   * Empty disables it. AIMEAT_AUTH_LOG_PATH.
   */
  authLogPath: string;
  /** Byte ceiling before the refusal log rotates (one generation kept). AIMEAT_AUTH_LOG_MAX_BYTES. */
  authLogMaxBytes: number;

  // ── Credential-door tarpit (per IP, growing with each refusal) ──
  loginTarpitEnabled: boolean;
  /** Refusals that cost nothing, so a mistyped password is not punished. */
  loginTarpitFreeFailures: number;
  /** Added delay per refusal beyond the free ones. */
  loginTarpitStepMs: number;
  /** The longest any single request is held. */
  loginTarpitMaxDelayMs: number;
  /** Refusals after which the door answers 429 immediately instead of holding the connection. */
  loginTarpitBlockAfter: number;
  /** How long a penalty takes to decay if nothing else arrives. */
  loginTarpitWindowMs: number;
  /** How many requests may be asleep in the tarpit at once before it sheds instead of holding. */
  loginTarpitMaxConcurrent: number;
}

/**
 * Defaults, read from the environment.
 *
 * Both are ON out of the box, and both are BOUNDED out of the box, because the volume through
 * either is chosen by whoever is attacking rather than by this node. An unbounded log is a way to
 * fill an operator's disk from the outside, and an unbounded delay is a way to hold every socket.
 *
 * The tarpit numbers say: two refusals cost nothing, so a mistyped password is not punished; each
 * one after that adds four seconds, to a ceiling of thirty; and past twelve the door stops holding
 * the connection at all and answers 429 with a Retry-After, which is cheap for us and final for
 * them. A penalty decays after fifteen quiet minutes, so nobody is locked out of their own account
 * by an attacker who shares their office address.
 */
export function securityDoorDefaults(): SecurityDoorConfig {
  return {
    authLogPath: process.env.AIMEAT_AUTH_LOG_PATH ?? './data/auth-failures.log',
    authLogMaxBytes: parseInt(process.env.AIMEAT_AUTH_LOG_MAX_BYTES ?? '5242880', 10),
    loginTarpitEnabled: process.env.AIMEAT_LOGIN_TARPIT_ENABLED !== 'false',
    loginTarpitFreeFailures: parseInt(process.env.AIMEAT_LOGIN_TARPIT_FREE ?? '2', 10),
    loginTarpitStepMs: parseInt(process.env.AIMEAT_LOGIN_TARPIT_STEP_MS ?? '4000', 10),
    loginTarpitMaxDelayMs: parseInt(process.env.AIMEAT_LOGIN_TARPIT_MAX_DELAY_MS ?? '30000', 10),
    loginTarpitBlockAfter: parseInt(process.env.AIMEAT_LOGIN_TARPIT_BLOCK_AFTER ?? '12', 10),
    loginTarpitWindowMs: parseInt(process.env.AIMEAT_LOGIN_TARPIT_WINDOW_MS ?? '900000', 10),
    loginTarpitMaxConcurrent: parseInt(process.env.AIMEAT_LOGIN_TARPIT_MAX_CONCURRENT ?? '50', 10),
  };
}
