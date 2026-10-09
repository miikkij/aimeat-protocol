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
 *   v1.3.0 — 2026-10-09 — wsQueryToken (AIMEAT_WS_QUERY_TOKEN, default true, deprecated, removed in
 *     4.0.0): a WebSocket upgrade still takes ?token=; off, it is refused (secrets audit 2026-10-09, d3).
 *   v1.2.0 — 2026-10-09 — ownerKeyLogin (AIMEAT_OWNER_KEY_LOGIN, default true, deprecated, removed in
 *     4.0.0): the legacy owner-key sign-in can be switched off now (secrets audit 2026-10-09, S2).
 *   v1.1.0 — 2026-10-09 — adminSetupOpenAfterFirstOperator (AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR,
 *     default false): POST /v1/admin/setup/register stays open after the first operator, for test
 *     nodes only (secrets audit 2026-10-09, 1.4). Here because config.ts and config-types.ts are at
 *     799 lines.
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

  /**
   * Whether POST /v1/admin/setup/register still creates an operator once the node has one. Off: the
   * route answers 410 SETUP_CLOSED after the first operator, and an operator adds another through
   * the Owners page (POST /v1/admin/roles/grant). On only for a test node whose suites register
   * several operators with the admin password; never on a public node.
   * AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR, default false.
   */
  adminSetupOpenAfterFirstOperator: boolean;

  /**
   * Whether POST /v1/auth/token still signs an owner in with the account's Ed25519 signing key (the
   * legacy owner-key sign-in RFC v4.0 deprecates). DEPRECATED: default on in 3.x, because the auth
   * SDK's password-less registration and existing scripts use it; removed in 4.0.0. Even when on, an
   * account with two-step sign-in armed is refused on this route, and the key is replaced when the
   * password is reset. AIMEAT_OWNER_KEY_LOGIN, default true.
   */
  ownerKeyLogin: boolean;

  /**
   * Whether a WebSocket upgrade (/v1/realtime/ws, /v1/personal/tunnel, /v1/connect/tunnel) still takes
   * the session token in its URL as `?token=`. A reverse proxy writes URLs to its access log, so that
   * log held live session tokens (secrets audit 2026-10-09, d3); current clients use a single-use
   * ticket (POST /v1/ws/ticket) or an Authorization header. DEPRECATED: default on in 3.x for older
   * clients, removed in 4.0.0. Off: the upgrade answers 401 WS_QUERY_TOKEN_DISABLED. Read on every
   * upgrade, so a live change applies at once. AIMEAT_WS_QUERY_TOKEN, default true.
   */
  wsQueryToken: boolean;
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
    adminSetupOpenAfterFirstOperator: process.env.AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR === 'true',
    ownerKeyLogin: process.env.AIMEAT_OWNER_KEY_LOGIN !== 'false',
    wsQueryToken: process.env.AIMEAT_WS_QUERY_TOKEN !== 'false',
  };
}
