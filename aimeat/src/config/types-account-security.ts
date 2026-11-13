/**
 * @file src/config/types-account-security.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The settings behind the doors into a person's own account: two-step sign-in,
 *   passkeys, and the key that encrypts what those two store at rest.
 *
 *   PURE EXTRACTION from config-types.ts on 2026-09-04, when the passkey settings took that file
 *   past the 800-line ceiling. The fields are the same fields; AimeatConfig extends this interface,
 *   so nothing that reads a config knows the difference. It follows the pattern the AI, site,
 *   social-login, connections and SSO settings already use.
 *
 *   THE RELYING PARTY ID IS NOT A PREFERENCE. A passkey is bound to it forever, so changing this
 *   node's domain makes every registered key unusable. config.ts derives it from baseUrl for that
 *   reason; the override exists only for a node served under a subdomain that wants its keys to
 *   work across the parent domain.
 *
 *   THE SIGN-IN POLICY. Two operator settings decide which sign-ins a person may use at all:
 *   twoStepRequired (auth.two_step_required) and passwordSignIn (auth.password_sign_in). Both default
 *   to what a node did before they existed, so nothing changes until the operator sets them. The
 *   rules that read them are in services/sign-in-policy.ts.
 *
 *   THE LOCKOUT IS OFF UNLESS THE OPERATOR TURNS IT ON (signInLockout, auth.sign_in_lockout; Jouni,
 *   2026-11-02 08.02). A lock lets anyone who knows a username keep its owner out; the per-address
 *   tarpit and the login rate limit bound guessing without doing that.
 *
 * @structure AccountSecurityConfig · TwoStepRequired · PasswordSignIn · SignInLockout ·
 *   TWO_STEP_REQUIRED_VALUES · PASSWORD_SIGN_IN_VALUES · SIGN_IN_LOCKOUT_VALUES · accountSecurityDefaults()
 * @usage import type { AccountSecurityConfig } from './types-account-security.js';
 * @version-history
 *   v1.4.0 — 2026-11-11 — signInTitle{En,Fi,Es} and signInLine{En,Fi,Es} (AIMEAT_SIGN_IN_TITLE_* and
 *     AIMEAT_SIGN_IN_LINE_*): the sign-in dialog's headline and line per node and language; empty keeps
 *     the built-in text (wish sign-in-dialog-texts-settable-per-node-and-language).
 *   v1.3.0 — 2026-11-05 — encryptionKey1 (AIMEAT_ENCRYPTION_KEY_1) and encryptionKeyCurrent
 *     (AIMEAT_ENCRYPTION_KEY_CURRENT, default 0): a second data key in the ring (codebase analysis
 *     2026-11-03, decision 4a of 2026-11-05).
 *   v1.2.0 — 2026-11-02 — signInLockout (AIMEAT_SIGN_IN_LOCKOUT: off, on), off by default (Jouni, 08.02).
 *   v1.1.0 — 2026-11-02 — twoStepRequired (AIMEAT_TWO_STEP_REQUIRED: off, operators, everyone) and
 *     passwordSignIn (AIMEAT_PASSWORD_SIGN_IN: on, operators, off), from an IT review of the node.
 *   v1.0.0 — 2026-09-04 — Extracted from config-types.ts, with the passkey settings.
 */

/** Whose password sign-in must also carry a code from an authenticator app. Ordered from open to strict. */
export const TWO_STEP_REQUIRED_VALUES = ['off', 'operators', 'everyone'] as const;
export type TwoStepRequired = typeof TWO_STEP_REQUIRED_VALUES[number];

/** Who may sign in with a password at all. Ordered from open to strict. */
export const PASSWORD_SIGN_IN_VALUES = ['on', 'operators', 'off'] as const;
export type PasswordSignIn = typeof PASSWORD_SIGN_IN_VALUES[number];

/** Whether wrong passwords and wrong codes lock an account for a while. Ordered from open to strict. */
export const SIGN_IN_LOCKOUT_VALUES = ['off', 'on'] as const;
export type SignInLockout = typeof SIGN_IN_LOCKOUT_VALUES[number];

/** The environment's value when it is one of `values`, the default otherwise. The start check reports a wrong one. */
function pick<T extends string>(raw: string | undefined, values: readonly T[], fallback: T): T {
  const v = (raw ?? '').trim().toLowerCase();
  return (values as readonly string[]).includes(v) ? v as T : fallback;
}

export interface AccountSecurityConfig {
  // TOTP / 2FA (Phase 0.5)
  totpEnabled: boolean;
  totpIssuer: string;
  totpPeriod: number;
  totpWindow: number;
  totpBackupCodeCount: number;
  totpSecretEncryptionKey: string | null;
  totpMaxFailedAttempts: number;
  totpLockoutSeconds: number;

  // Passkeys (WebAuthn). A sign-in method of its own, not a second factor on top of the password.
  passkeyEnabled: boolean;
  /** The relying party id: the registrable domain a passkey is bound to. Derived from baseUrl. */
  passkeyRpId: string;
  /** What the person sees named in their device's prompt. */
  passkeyRpName: string;
  /** Origins a passkey ceremony may come from. baseUrl always counts; this adds to it. */
  passkeyExtraOrigins: string[];

  // The sign-in policy (services/sign-in-policy.ts). Read on every sign-in, so a change applies at once.
  /** off: as before · operators: an operator account needs two-step sign-in · everyone: every account does. */
  twoStepRequired: TwoStepRequired;
  /** on: as before · operators: only an operator account signs in with a password · off: no account does. */
  passwordSignIn: PasswordSignIn;
  /** off (default): no lockout · on: wrong passwords and wrong codes lock the account (services/password-check.ts). */
  signInLockout: SignInLockout;

  // What the sign-in dialog says on its sign-in side (sdk-libs/auth/modal.js), per language. Empty
  // keeps the built-in text of that language. Carried to the browser in the aimeat-auth prelude.
  /** The headline. */
  signInTitleEn: string;
  signInTitleFi: string;
  signInTitleEs: string;
  /** The line under the headline. */
  signInLineEn: string;
  signInLineFi: string;
  signInLineEs: string;

  // General-purpose encryption key (fallback: totpSecretEncryptionKey)
  encryptionKey: string | null;
  /** AIMEAT_ENCRYPTION_KEY_1: a second data key, key 1 of the ring (services/encryption.ts). Null on a node with one key. */
  encryptionKey1: string | null;
  /** AIMEAT_ENCRYPTION_KEY_CURRENT: which data key seals new values, 0 (default, AIMEAT_ENCRYPTION_KEY) or 1. */
  encryptionKeyCurrent: number;
}

/**
 * The values, from the environment.
 *
 * `baseUrl` and `siteName` are passed in rather than read here: the relying party id is derived from
 * the address, the prompt shows the site's own name, and config.ts already resolves both once for
 * everything else.
 */
export function accountSecurityDefaults(baseUrl: string, siteName: string): AccountSecurityConfig {
  return {
    totpEnabled: process.env.AIMEAT_TOTP_ENABLED !== 'false',
    totpIssuer: process.env.AIMEAT_TOTP_ISSUER ?? 'AIMEAT',
    totpPeriod: parseInt(process.env.AIMEAT_TOTP_PERIOD ?? '30', 10),
    totpWindow: parseInt(process.env.AIMEAT_TOTP_WINDOW ?? '1', 10),
    totpBackupCodeCount: parseInt(process.env.AIMEAT_TOTP_BACKUP_CODE_COUNT ?? '10', 10),
    totpSecretEncryptionKey: process.env.AIMEAT_TOTP_ENCRYPTION_KEY ?? null,
    totpMaxFailedAttempts: parseInt(process.env.AIMEAT_TOTP_MAX_FAILED ?? '5', 10),
    totpLockoutSeconds: parseInt(process.env.AIMEAT_TOTP_LOCKOUT_SECONDS ?? '300', 10),
    passkeyEnabled: process.env.AIMEAT_PASSKEY_ENABLED !== 'false',
    passkeyRpId: process.env.AIMEAT_PASSKEY_RP_ID ?? hostOf(baseUrl),
    passkeyRpName: process.env.AIMEAT_PASSKEY_RP_NAME ?? (siteName || 'AIMEAT'),
    passkeyExtraOrigins: (process.env.AIMEAT_PASSKEY_EXTRA_ORIGINS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
    twoStepRequired: pick(process.env.AIMEAT_TWO_STEP_REQUIRED, TWO_STEP_REQUIRED_VALUES, 'off'),
    passwordSignIn: pick(process.env.AIMEAT_PASSWORD_SIGN_IN, PASSWORD_SIGN_IN_VALUES, 'on'),
    signInLockout: pick(process.env.AIMEAT_SIGN_IN_LOCKOUT, SIGN_IN_LOCKOUT_VALUES, 'off'),
    signInTitleEn: (process.env.AIMEAT_SIGN_IN_TITLE_EN ?? '').trim(),
    signInTitleFi: (process.env.AIMEAT_SIGN_IN_TITLE_FI ?? '').trim(),
    signInTitleEs: (process.env.AIMEAT_SIGN_IN_TITLE_ES ?? '').trim(),
    signInLineEn: (process.env.AIMEAT_SIGN_IN_LINE_EN ?? '').trim(),
    signInLineFi: (process.env.AIMEAT_SIGN_IN_LINE_FI ?? '').trim(),
    signInLineEs: (process.env.AIMEAT_SIGN_IN_LINE_ES ?? '').trim(),
    encryptionKey: process.env.AIMEAT_ENCRYPTION_KEY ?? null,
    encryptionKey1: process.env.AIMEAT_ENCRYPTION_KEY_1 || null,
    encryptionKeyCurrent: process.env.AIMEAT_ENCRYPTION_KEY_CURRENT === '1' ? 1 : 0,
  };
}

/** The host of an address, with no port and no scheme: what a passkey is actually bound to. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    // A base URL that will not parse is a misconfiguration the boot posture check reports on its
    // own. Here it only decides the relying party id, and localhost is right for the case that
    // actually produces it, which is a dev node with no address set.
    return 'localhost';
  }
}
