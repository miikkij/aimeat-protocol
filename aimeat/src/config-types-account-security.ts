/**
 * @file src/config-types-account-security.ts
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
 * @structure AccountSecurityConfig
 * @usage import type { AccountSecurityConfig } from './config-types-account-security.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted from config-types.ts, with the passkey settings.
 */

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

  // General-purpose encryption key (fallback: totpSecretEncryptionKey)
  encryptionKey: string | null;
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
    encryptionKey: process.env.AIMEAT_ENCRYPTION_KEY ?? null,
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
