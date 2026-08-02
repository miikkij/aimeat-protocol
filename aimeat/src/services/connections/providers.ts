/**
 * @file providers.ts
 * @description Registry of OUTBOUND connection providers (TARGET-057) — the services a principal
 *   can connect their own account at. Mirrors the shape of services/oidc-providers.ts, which is the
 *   inbound half, and is deliberately a separate registry: signing IN with Google and PUBLISHING to
 *   a Google account are different directions, different consent and different client credentials.
 *
 *   THE CAPABILITY IS OFF UNTIL IT IS CONFIGURED. A provider is `enabled` only when the node has
 *   what it needs to talk to it. Nothing here fails open, and nothing here half-works: an
 *   unconfigured provider is absent from discovery and refused at start, with a reason.
 *
 *   Two axes decide everything else about a provider, and both were chosen because getting either
 *   wrong is invisible until the third provider:
 *     - `credentialShape` — oauth2 | static | session. Designing around oauth2 alone produces a
 *       store that cannot hold a Bluesky app password.
 *     - `instanceScoped`  — whether the provider IS one endpoint. Mastodon is not: its client
 *       credentials are per instance and acquired at runtime (see storage ProviderClient).
 * @structure
 *   - OutboundProvider — the descriptor
 *   - buildOutboundProviders(config) — the enabled list, gated on configuration
 *   - findProvider(list, id) / listProviderMeta(list) — lookup + the safe public projection
 * @usage const providers = buildOutboundProviders(config);
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1b. Mastodon, YouTube, Bluesky.
 */

import type { AimeatConfig } from '../../config.js';
import type { CredentialShape } from '../../models/connection-schemas.js';

/** Stable provider identifiers. Also the value stored in `Connection.provider`. */
export type OutboundProviderId = 'mastodon' | 'youtube' | 'bluesky' | 'fake' | 'fake-static';

/**
 * What a user must supply for a provider that has NO authorization round.
 *
 * Declared here rather than hardcoded in a form so the panel renders whatever a provider needs
 * without knowing about that provider. A provider with `attachFields: null` uses the OAuth round
 * instead, and the two paths never overlap.
 */
export interface AttachField {
  name: string;
  label: string;
  /** Rendered as a password input, and never echoed back in any response. */
  secret: boolean;
  placeholder?: string;
}

/** OAuth2 endpoints. Derived from the instance origin for an instance-scoped provider. */
export interface OAuthEndpoints {
  authorize: string;
  token: string;
  /** Null when the provider offers no revocation endpoint — revoking is then local-only. */
  revoke: string | null;
}

export interface OutboundProvider {
  id: OutboundProviderId;
  /** Fallback English label; the SDK lib overrides it from i18n. */
  label: string;
  credentialShape: CredentialShape;
  /**
   * True when the provider is a FEDERATION rather than one endpoint. Client credentials are then
   * per instance and acquired at runtime; `client` is null and `endpoints()` needs the instance.
   */
  instanceScoped: boolean;
  /** Config-gated. False = absent from discovery and refused at start, with a reason. */
  enabled: boolean;
  /** Why it is disabled, in words an operator can act on. Null when enabled. */
  disabledReason: string | null;
  /** Fixed-endpoint client credentials from config. Null for an instance-scoped provider. */
  client: { id: string; secret: string } | null;
  /** Scopes requested at authorize time. Empty for a `static` credential. */
  scopes: string[];
  /** Whether to send a PKCE challenge. Always true where the provider supports it. */
  pkce: boolean;
  /**
   * What an app may ASK about a connection at this provider (decision K1). An app never reads the
   * provider's own scope vocabulary — it cannot know what those names mean — so it asks a question
   * in AIMEAT's vocabulary and gets a yes or no.
   */
  capabilities: string[];
  /**
   * The provider's own daily ceiling on publishes, when it has one that is shared rather than
   * per-user. YouTube's allowance is per Google PROJECT, so ten publishers on one shared channel
   * close it before lunch unless somebody counts.
   *
   * null means "no known shared ceiling", which is the honest value until the real number has been
   * READ from the provider's console rather than guessed. The counting mechanism does not wait for
   * it — publish-gate measures usage either way, so the number can be filled in with evidence.
   */
  sharedDailyLimit: number | null;
  /**
   * Non-null when this provider is connected by SUPPLYING a credential rather than by an
   * authorization round. Null for an OAuth provider. Advertising a provider without one of the two
   * is how a "Connect" button appears that cannot work.
   */
  attachFields: AttachField[] | null;
  /** Endpoints. `instance` is required exactly when `instanceScoped` is true. */
  endpoints(instance: string | null): OAuthEndpoints | null;
}

/** What discovery may show. Deliberately free of anything an app could not act on. */
export interface OutboundProviderMeta {
  id: OutboundProviderId;
  label: string;
  instanceScoped: boolean;
  credentialShape: CredentialShape;
  capabilities: string[];
  attachFields: AttachField[] | null;
}

/**
 * Mastodon. The awkward one, and the reason the store carries an `instance` column at all: the same
 * handle at two instances is two accounts, and the client credentials are issued per instance by
 * `POST /api/v1/apps` with no human in the loop. There is nothing to put in .env because nobody
 * knows which instance the next user arrives from.
 */
function mastodon(enabled: boolean): OutboundProvider {
  return {
    id: 'mastodon',
    label: 'Mastodon',
    credentialShape: 'oauth2',
    instanceScoped: true,
    enabled,
    disabledReason: enabled ? null : 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)',
    client: null,
    scopes: ['read:accounts', 'write:statuses', 'write:media'],
    pkce: true,
    capabilities: ['publish-post', 'publish-video'],
    attachFields: null,
    // Instances rate-limit, but there is no single daily publish ceiling to state, and inventing
    // one would be a guess wearing a number.
    sharedDailyLimit: null,
    endpoints(instance) {
      // The caller validates and normalises `instance` before this is reached; building a URL from
      // an unvalidated user-supplied host is exactly the SSRF this feature has to not have.
      if (!instance) return null;
      return {
        authorize: `${instance}/oauth/authorize`,
        token: `${instance}/oauth/token`,
        revoke: `${instance}/oauth/revoke`,
      };
    },
  };
}

/**
 * YouTube via Google. One endpoint, one client, credentials from config.
 *
 * `access_type=offline` + `prompt=consent` are added at authorize time by the OAuth service, not
 * here: without them Google returns no refresh token at all on a repeat authorization, and the
 * connection silently becomes a one-hour connection that dies and cannot renew.
 */
function youtube(clientId: string, clientSecret: string, capabilityOn: boolean): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const enabled = capabilityOn && configured;
  return {
    id: 'youtube',
    label: 'YouTube',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_GOOGLE_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    pkce: true,
    capabilities: ['publish-video'],
    attachFields: null,
    // VARMISTETTAVA in the spec and still unread: the quota is per Google PROJECT and an upload
    // costs a large slice of it, which is believed to leave a single-digit number of uploads per
    // day for EVERY publisher on the node combined. Phase 5 reads the real figure from the console
    // and sets it here. Until then the counter runs and the ceiling does not, because a made-up
    // limit that refuses a legitimate publish is worse than none.
    sharedDailyLimit: null,
    endpoints() {
      return {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        revoke: 'https://oauth2.googleapis.com/revoke',
      };
    },
  };
}

/**
 * Bluesky. Present in the first slice specifically because it is NOT oauth2-shaped: an app password
 * exchanged for a session. A store that only ever saw Mastodon and YouTube would be built around
 * authorization codes, and the mistake would surface at the third provider rather than the first.
 *
 * It is also the one place a user copies a secret to us. That is worse than a consent screen and
 * the connect dialog has to say so plainly.
 */
function bluesky(capabilityOn: boolean): OutboundProvider {
  return {
    id: 'bluesky',
    label: 'Bluesky',
    // What is STORED is a session, even though what the user supplies is a static app password.
    // Both are kept: the session is what calls use, and the app password is what lets a dead
    // session be re-minted without asking the user to go and find it again.
    credentialShape: 'session',
    instanceScoped: false,
    enabled: capabilityOn,
    disabledReason: capabilityOn ? null : 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)',
    // No client credentials at all: the user's app password IS the credential.
    client: null,
    scopes: [],
    pkce: false,
    capabilities: ['publish-post', 'publish-video'],
    sharedDailyLimit: null,
    // The one provider a user hands us a secret for, so it is the one that needs a form.
    attachFields: [
      { name: 'identifier', label: 'Handle', secret: false, placeholder: 'you.bsky.social' },
      { name: 'password', label: 'App password', secret: true, placeholder: 'xxxx-xxxx-xxxx-xxxx' },
    ],
    endpoints() {
      // Not an OAuth2 flow. The session endpoints live in the attach recipe, not here.
      return null;
    },
  };
}

/**
 * A stand-in provider for the end-to-end tests. Present ONLY when a base URL is configured, which
 * nothing but the E2E environment does, so it cannot appear on a real node.
 *
 * It exists because the alternative is mocking the connection service, and a mocked service proves
 * the mock. Against a real HTTP server the tests drive the actual code path: state, PKCE, the token
 * exchange, the identity lookup, a ROTATING refresh token and revocation. The rotation is the point
 * — it is the provider behaviour that makes concurrent refresh destructive, and it cannot be
 * demonstrated against a stub that always returns the same token.
 */
function fake(baseUrl: string, capabilityOn: boolean): OutboundProvider {
  const enabled = capabilityOn && Boolean(baseUrl);
  return {
    id: 'fake',
    label: 'Test provider',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    disabledReason: enabled ? null : 'no AIMEAT_CONNECT_FAKE_BASE_URL (this provider is test-only)',
    client: baseUrl ? { id: 'fake-client', secret: 'fake-secret' } : null,
    scopes: ['publish'],
    pkce: true,
    capabilities: ['publish-video', 'publish-post'],
    sharedDailyLimit: null,
    attachFields: null,
    endpoints() {
      if (!baseUrl) return null;
      return {
        authorize: `${baseUrl}/authorize`,
        token: `${baseUrl}/token`,
        revoke: `${baseUrl}/revoke`,
      };
    },
  };
}

/**
 * The session-shaped test provider. Exists for the same reason `fake` does, one axis over: the
 * supplied-credential path (no authorization round, a session minted from a secret the user hands
 * over, and a refresh that is not OAuth2) has to be provable without a real Bluesky account.
 *
 * Without it, "attach" would ship tested only against the one provider nobody on this node has.
 */
function fakeStatic(baseUrl: string, capabilityOn: boolean): OutboundProvider {
  const enabled = capabilityOn && Boolean(baseUrl);
  return {
    id: 'fake-static',
    label: 'Test provider (supplied credential)',
    credentialShape: 'session',
    instanceScoped: false,
    enabled,
    disabledReason: enabled ? null : 'no AIMEAT_CONNECT_FAKE_BASE_URL (this provider is test-only)',
    client: null,
    scopes: [],
    pkce: false,
    capabilities: ['publish-post'],
    sharedDailyLimit: null,
    attachFields: [
      { name: 'identifier', label: 'Handle', secret: false, placeholder: 'someone' },
      { name: 'password', label: 'Secret', secret: true },
    ],
    endpoints() { return null; },
  };
}

/**
 * The providers this node offers. Disabled ones are RETURNED rather than filtered, so a route can
 * answer "why can I not connect YouTube" with the reason instead of a bare absence — an operator
 * staring at an empty list has nothing to act on.
 */
export function buildOutboundProviders(config: AimeatConfig): OutboundProvider[] {
  const on = config.connectionsEnabled;
  const list = [
    mastodon(on),
    youtube(config.connectGoogleClientId, config.connectGoogleClientSecret, on),
    bluesky(on),
  ];
  // Appended only when configured, so a production node's list is exactly the three above.
  if (config.connectFakeBaseUrl) {
    list.push(fake(config.connectFakeBaseUrl, on));
    list.push(fakeStatic(config.connectFakeBaseUrl, on));
  }
  return list;
}

/** Lookup by id. Returns disabled providers too; the caller decides what to do about that. */
export function findProvider(
  providers: OutboundProvider[], id: string,
): OutboundProvider | undefined {
  return providers.find((p) => p.id === id);
}

/** The public projection for discovery. Enabled providers only, and no credentials in it. */
export function listProviderMeta(providers: OutboundProvider[]): OutboundProviderMeta[] {
  return providers.filter((p) => p.enabled).map((p) => ({
    id: p.id,
    label: p.label,
    instanceScoped: p.instanceScoped,
    credentialShape: p.credentialShape,
    capabilities: p.capabilities,
    attachFields: p.attachFields,
  }));
}
