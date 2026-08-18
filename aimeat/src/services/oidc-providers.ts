/**
 * @file oidc-providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Registry of social-login OIDC providers (Google, Casdoor, Microsoft Entra ID) —
 *   the single source of truth for AIMEAT's configurable sign-in providers. Each provider is a
 *   thin descriptor over the generic {@link OidcClient}: it carries its config-gated enabled flag,
 *   its (lazily discovered) client, the scopes to request, the verification-nonce type used to
 *   isolate its login state, a pure `mapClaims()` that normalises the IdP's ID-token claims into a
 *   common {@link MappedClaims} shape, and an optional `validateClaims()` gate (used by Entra to
 *   enforce single-tenant sign-in). oauth-login.ts loops over this list to register identical
 *   authorize/callback/finalize routes per provider, so adding a fourth provider is a few lines here.
 * @structure
 *   buildOidcProviders(config): OidcProvider[]  — creates + initialises the clients (boot-time).
 *   listEnabledProviderMeta(config): {id,label,i18nKey}[] — PURE, no client creation; baked into
 *     the browser auth lib so the sign-in modal can render one button per enabled provider.
 *   mapGoogleClaims/mapCasdoorClaims/makeEntraMapper/makeEntraValidator — pure, exported for tests.
 * @usage const providers = buildOidcProviders(config); app.use(oauthLoginRouter(config, storage, providers));
 * @version-history
 *   v1.0.0 — 2026-07-01 — Initial registry: Google (folded in from oauth-login.ts) + Casdoor + Entra.
 */

import type { AimeatConfig } from '../config.js';
import { createOidcClient, type OidcClient } from './oidc-client.js';
import { logger } from '../utils/logger.js';

/** Stable provider identifiers. Also the URL segment (`/v1/ghii/login/<id>`) and nonce prefix. */
export type ProviderId = 'google' | 'casdoor' | 'entra';

/** IdP ID-token claims normalised into the shape the login router works with. */
export interface MappedClaims {
  /** Stable per-user subject at the IdP — the linking key. */
  sub: string;
  /** Email if the IdP provided one, else null. */
  email: string | null;
  /** Whether the email may be trusted for cross-account linking (see per-provider rules). */
  emailVerified: boolean;
  /** Best-effort human display name. */
  displayName: string;
}

/** A configured social-login provider. */
export interface OidcProvider {
  id: ProviderId;
  /** Fallback button label (English) — overridden by the i18n key in the SPA when present. */
  label: string;
  /** Modal i18n key for the button label (under the `modal` namespace). */
  i18nKey: string;
  /** config-gated: true only when enabled AND client id/secret (+ issuer) are present. */
  enabled: boolean;
  /** The RP client — null when the provider is not configured. */
  client: OidcClient | null;
  /** Scopes requested at authorize time. */
  scopes: string[];
  /** VerificationNonce.type used to isolate this provider's login state (e.g. 'google_login'). */
  nonceType: string;
  /** Normalise the IdP claims. Returns null when the mandatory `sub` is missing. */
  mapClaims(claims: Record<string, unknown>): MappedClaims | null;
  /** Optional pre-mapping gate. Returns an ERROR CODE string to reject, or null to allow. */
  validateClaims?(claims: Record<string, unknown>): string | null;
}

/** Display metadata per provider (button label + its modal i18n key). */
const PROVIDER_META: Record<ProviderId, { label: string; i18nKey: string }> = {
  google: { label: 'Continue with Google', i18nKey: 'googleSignIn' },
  casdoor: { label: 'Continue with Casdoor', i18nKey: 'casdoorSignIn' },
  entra: { label: 'Continue with Microsoft', i18nKey: 'entraSignIn' },
};

const OIDC_SCOPES = ['openid', 'email', 'profile'];

/** Narrow a claim to a non-empty string, else undefined. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** True when a value is a concrete Entra tenant GUID (not `common`/`organizations`/`consumers`). */
export function isTenantGuid(tenant: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant.trim());
}

// ── Claim mappers (pure; exported so tests exercise the real mapping) ──

/** Google: honours `email_verified`; display name from name → given_name → email-local. */
export function mapGoogleClaims(claims: Record<string, unknown>): MappedClaims | null {
  const sub = str(claims.sub);
  if (!sub) return null;
  const email = str(claims.email) ?? null;
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  const displayName = str(claims.name) || str(claims.given_name) || email?.split('@')[0] || 'AIMEAT User';
  return { sub, email, emailVerified, displayName };
}

/**
 * Casdoor: it is the authority for its organisation's accounts, so a present email is treated as
 * verified (enabling safe link-by-verified-email). Display name from name → preferred_username.
 */
export function mapCasdoorClaims(claims: Record<string, unknown>): MappedClaims | null {
  const sub = str(claims.sub);
  if (!sub) return null;
  const email = str(claims.email) ?? null;
  const emailVerified = !!email;
  const displayName = str(claims.name) || str(claims.preferred_username) || email?.split('@')[0] || 'AIMEAT User';
  return { sub, email, emailVerified, displayName };
}

/**
 * Entra: email may arrive as `email`, `preferred_username`, or `upn`. The email is only treated as
 * verified (auto-linkable) when signing into a PINNED single tenant — for the multi-tenant/personal
 * (`common`/`organizations`/`consumers`) modes we can't vouch for the address, so new users go
 * through the username-choice step and are never silently linked.
 */
export function makeEntraMapper(tenant: string): (claims: Record<string, unknown>) => MappedClaims | null {
  const pinned = isTenantGuid(tenant);
  return function mapEntraClaims(claims: Record<string, unknown>): MappedClaims | null {
    const sub = str(claims.sub);
    if (!sub) return null;
    const email = str(claims.email) || str(claims.preferred_username) || str(claims.upn) || null;
    const emailVerified = pinned && !!email && email.includes('@');
    const displayName = str(claims.name) || str(claims.preferred_username) || email?.split('@')[0] || 'AIMEAT User';
    return { sub, email, emailVerified, displayName };
  };
}

/**
 * Entra tenant gating: when a concrete tenant GUID is configured, require the token's `tid` to
 * match it (blocks users from other tenants / personal accounts). Returns undefined for the
 * non-pinned modes (no gating possible), so the router applies no extra validation there.
 */
export function makeEntraValidator(tenant: string): ((claims: Record<string, unknown>) => string | null) | undefined {
  if (!isTenantGuid(tenant)) return undefined;
  const want = tenant.trim().toLowerCase();
  return function validateEntraTenant(claims: Record<string, unknown>): string | null {
    const tid = str(claims.tid)?.toLowerCase();
    return tid === want ? null : 'ENTRA_WRONG_TENANT';
  };
}

/** Entra OIDC authority (issuer) for a tenant value. */
export function entraIssuerUrl(tenant: string): string {
  const t = (tenant || 'common').trim();
  return `https://login.microsoftonline.com/${t}/v2.0`;
}

// ── Registry construction ──

/**
 * Build the full provider list. Providers are always present in the list (so the router can return
 * a 503 for a disabled provider rather than a 404); `enabled`/`client` reflect configuration.
 * Clients are discovered lazily (fire-and-forget) exactly like the FTN client in routes-loader.
 */
export function buildOidcProviders(config: AimeatConfig): OidcProvider[] {
  const providers: OidcProvider[] = [];

  // ── Google ──
  {
    const enabled = config.googleOAuthEnabled && !!config.googleOAuthClientId && !!config.googleOAuthClientSecret;
    let client: OidcClient | null = null;
    if (enabled) {
      client = createOidcClient({
        issuerUrl: 'https://accounts.google.com',
        clientId: config.googleOAuthClientId,
        clientSecret: config.googleOAuthClientSecret,
        redirectUri: config.googleOAuthRedirectUri || `${config.baseUrl}/v1/ghii/login/google/callback`,
        scopes: OIDC_SCOPES,
      });
      client.initialize().catch(err =>
        logger.warn('Google OIDC discovery failed, Google sign-in will return 503', { error: String(err) }));
    }
    providers.push({
      id: 'google', ...PROVIDER_META.google, enabled, client, scopes: OIDC_SCOPES,
      nonceType: 'google_login', mapClaims: mapGoogleClaims,
    });
  }

  // ── Casdoor ──
  {
    const enabled = config.casdoorOAuthEnabled && !!config.casdoorOAuthEndpoint
      && !!config.casdoorOAuthClientId && !!config.casdoorOAuthClientSecret;
    let client: OidcClient | null = null;
    if (enabled) {
      client = createOidcClient({
        issuerUrl: config.casdoorOAuthEndpoint,
        clientId: config.casdoorOAuthClientId,
        clientSecret: config.casdoorOAuthClientSecret,
        redirectUri: config.casdoorOAuthRedirectUri || `${config.baseUrl}/v1/ghii/login/casdoor/callback`,
        scopes: OIDC_SCOPES,
      });
      client.initialize().catch(err =>
        logger.warn('Casdoor OIDC discovery failed, Casdoor sign-in will return 503', { error: String(err) }));
    }
    providers.push({
      id: 'casdoor', ...PROVIDER_META.casdoor, enabled, client, scopes: OIDC_SCOPES,
      nonceType: 'casdoor_login', mapClaims: mapCasdoorClaims,
    });
  }

  // ── Microsoft Entra ID ──
  {
    const enabled = config.entraOAuthEnabled && !!config.entraOAuthClientId && !!config.entraOAuthClientSecret;
    const tenant = config.entraOAuthTenant || 'common';
    let client: OidcClient | null = null;
    if (enabled) {
      client = createOidcClient({
        issuerUrl: entraIssuerUrl(tenant),
        clientId: config.entraOAuthClientId,
        clientSecret: config.entraOAuthClientSecret,
        redirectUri: config.entraOAuthRedirectUri || `${config.baseUrl}/v1/ghii/login/entra/callback`,
        scopes: OIDC_SCOPES,
      });
      client.initialize().catch(err =>
        logger.warn('Entra OIDC discovery failed, Microsoft sign-in will return 503', { error: String(err) }));
    }
    providers.push({
      id: 'entra', ...PROVIDER_META.entra, enabled, client, scopes: OIDC_SCOPES,
      nonceType: 'entra_login', mapClaims: makeEntraMapper(tenant), validateClaims: makeEntraValidator(tenant),
    });
  }

  return providers;
}

/**
 * Pure list of enabled providers for the browser: id + fallback label + modal i18n key. Computed
 * from config alone (no client creation / discovery), so it is safe to call per-request in libs.ts.
 */
export function listEnabledProviderMeta(config: AimeatConfig): Array<{ id: ProviderId; label: string; i18nKey: string }> {
  const enabled: Record<ProviderId, boolean> = {
    google: config.googleOAuthEnabled && !!config.googleOAuthClientId && !!config.googleOAuthClientSecret,
    casdoor: config.casdoorOAuthEnabled && !!config.casdoorOAuthEndpoint && !!config.casdoorOAuthClientId && !!config.casdoorOAuthClientSecret,
    entra: config.entraOAuthEnabled && !!config.entraOAuthClientId && !!config.entraOAuthClientSecret,
  };
  return (Object.keys(PROVIDER_META) as ProviderId[])
    .filter(id => enabled[id])
    .map(id => ({ id, label: PROVIDER_META[id].label, i18nKey: PROVIDER_META[id].i18nKey }));
}
