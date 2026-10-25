/**
 * @file src/config-types-social-login.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-IN providers a node can be configured with: Google, Casdoor and Microsoft
 *   Entra ID. Mixed into AimeatConfig, which had crossed the 800-line ceiling; the fields moved
 *   here verbatim and nothing else changed. Note the direction: these decide who may sign in HERE.
 *   Connecting a user's own account at an external service so an app can publish there is the
 *   opposite direction, stays in config-types.ts, and is deliberately separate consent.
 * @structure SocialLoginConfig — one block per provider, each config-gated by its own *_ENABLED.
 * @usage export interface AimeatConfig extends SocialLoginConfig { … }
 * @version-history
 *   2026-10-25 — casdoorLinkDomains and entraLinkDomains: the domains whose addresses count as
 *     verified for each provider (secaudit2026oct22, oidc-email-verified-without-idp-proof).
 *   v1.0.0 — 2026-08-21 — Extracted from config-types.ts (max-file-lines), with the Entra tenant
 *     allowlist as the field that pushed it over.
 */

export interface SocialLoginConfig {
  // Social login — Google OAuth/OIDC sign-in (generic, config-gated)
  googleOAuthEnabled: boolean;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  googleOAuthRedirectUri: string;  // empty = derive from baseUrl

  // Social login — Casdoor OAuth/OIDC sign-in (open-source IdP, config-gated)
  casdoorOAuthEnabled: boolean;
  casdoorOAuthEndpoint: string;      // Casdoor server URL, e.g. https://casdoor.example.com
  casdoorOAuthClientId: string;
  casdoorOAuthClientSecret: string;
  casdoorOAuthRedirectUri: string;   // empty = derive from baseUrl
  /** Domains whose Casdoor addresses count as verified (comma-separated, `*` = every domain).
   *  Empty = none: a Casdoor address never links to an existing account. Read at each sign-in. */
  casdoorLinkDomains: string;

  // Social login — Microsoft Entra ID OAuth/OIDC sign-in (enterprise IdP, config-gated)
  entraOAuthEnabled: boolean;
  entraOAuthTenant: string;          // tenant GUID (single-tenant gating) | common | organizations | consumers
  /**
   * Tenant GUIDs allowed to sign in, lowercased. Empty (default) means the gate comes from
   * entraOAuthTenant alone: a GUID there admits that one tenant, `common`/`organizations` gate
   * nothing. Set this WITH `entraOAuthTenant=organizations` (a multi-tenant app registration) to
   * admit several named organisations and refuse every other tenant, which is what a node shared
   * with approved partner companies needs. The gate is the token's `tid` claim, never the domain.
   */
  entraAllowedTenants: string[];
  /** Domains whose Entra addresses count as verified (comma-separated, `*` = every domain). Empty =
   *  every domain behind a gate of exactly one tenant, none behind an allowlist of several. */
  entraLinkDomains: string;
  entraOAuthClientId: string;
  entraOAuthClientSecret: string;
  entraOAuthRedirectUri: string;     // empty = derive from baseUrl
}
