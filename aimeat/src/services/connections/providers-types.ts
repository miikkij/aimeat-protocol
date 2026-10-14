/**
 * @file providers-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outbound provider descriptor and the types around it. A pure move out of
 *   providers.ts on 2026-10-15, so a file that DESCRIBES providers (providers-social.ts) can name
 *   the type without importing the registry that lists it, which dependency-cruiser counts as a
 *   cycle. providers.ts re-exports every one of them, so existing imports are unchanged.
 * @structure OutboundProviderId · AttachField · OAuthEndpoints · ProviderResource · OutboundProvider · OutboundProviderMeta
 * @usage import type { OutboundProvider } from './providers-types.js';
 * @version-history
 *   v1.0.0 — 2026-10-15 — Moved from providers.ts unchanged.
 */

import type { CredentialShape } from '../../models/connection-schemas.js';

/** Stable provider identifiers. Also the value stored in `Connection.provider`. */
export type OutboundProviderId =
  | 'mastodon' | 'youtube' | 'linkedin' | 'x' | 'bluesky'
  | 'facebook' | 'instagram' | 'reddit'
  // Mail comes in READ/SEND pairs rather than as one provider with both scopes. Reading somebody's
  // mail and writing in their name are different consent, and a permission that is never requested
  // cannot be misused, leaked, or need explaining to a person who only wanted one of the two.
  | 'google-mail' | 'google-mail-send'
  | 'microsoft-mail' | 'microsoft-mail-send'
  | 'fake' | 'fake-static' | 'fake-mail';

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

/**
 * One thing that may be READ from a connected account.
 *
 * A caller names a resource and supplies parameters; this builds the URL. The direction of that
 * arrow is the security property: the moment a caller can name the host, a connection stops being
 * "read my mail" and becomes an open proxy standing behind somebody's Google account.
 *
 * `requiresScopes` is checked against what the connection was actually granted BEFORE the request
 * goes out, because a provider answering 403 tells the person nothing they can act on, while
 * "this connection was made without permission to read mail" names the fix.
 */
export interface ProviderResource {
  /** What it is, in words a person reads in a refusal. */
  label: string;
  /** Provider scopes this resource cannot work without. */
  requiresScopes: string[];
  /** Build the URL from caller parameters. Throws with a plain sentence on a bad parameter. */
  url(params: Record<string, unknown>, instance: string | null): string;
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
  /**
   * Config-gated: this node can serve the provider itself. False = the node holds no client.
   *
   * NOT the same as unavailable. A principal who brings their own app can still use a provider the
   * node never registered, which is exactly what bringing one is for.
   */
  enabled: boolean;
  /**
   * The capability master switch (AIMEAT_CONNECTIONS_ENABLED). False means the whole feature is off
   * and NOTHING is offered, whoever brought what.
   *
   * This used to be encoded only in `disabledReason` as a string, which meant the difference
   * between "off" and "no client" was a substring match away from being wrong. It is a field now
   * because the two answers differ: one hides the provider, the other invites you to bring an app.
   */
  capabilityOn: boolean;
  /** Why it is disabled, in words an operator can act on. Null when enabled. */
  disabledReason: string | null;
  /** Fixed-endpoint client credentials from config. Null for an instance-scoped provider. */
  client: { id: string; secret: string } | null;
  /** Scopes requested at authorize time. Empty for a `static` credential. */
  scopes: string[];
  /**
   * How the scopes are joined in the authorize URL. RFC 6749 says a space, and that is the default;
   * Meta's dialogs document a comma, and a space-joined list there is read as one unknown scope.
   */
  scopeSeparator?: ',' | ' ';
  /**
   * Extra parameters the provider's authorize round needs and no other provider has. Reddit's
   * `duration=permanent` is the one: without it no refresh token arrives and the connection dies in
   * an hour, with nothing in any answer to say why.
   */
  authorizeParams?: Record<string, string>;
  /** Headers every call to this provider's token endpoint carries (Reddit's User-Agent rule). */
  tokenHeaders?: Record<string, string>;
  /**
   * How far ahead of expiry the credential is renewed, when the default five minutes is wrong for
   * the provider. Instagram renews a 60-day token by a GET it accepts only while the token is still
   * valid, so a connection used weekly has to renew days ahead rather than minutes.
   */
  refreshSkewMs?: number;
  /** Whether to send a PKCE challenge. Always true where the provider supports it. */
  pkce: boolean;
  /**
   * WHERE THE CLIENT SECRET GOES at the token endpoint.
   *
   * 'body' is the common case and the default. 'basic' is HTTP Basic authentication, which X
   * REQUIRES for a confidential client: sending its secret in the form body is a 401 with a message
   * that does not name the cause. This is a field rather than a check on the provider id because
   * two places mint tokens (the first exchange and every refresh), and a rule that lives in one of
   * them is a connection that authorises and then cannot renew.
   */
  tokenAuth: 'body' | 'basic';
  /**
   * Ask for a token that outlives the browser session.
   *
   * A PROPERTY OF THE PROVIDER'S OAUTH SERVER, not of what the connection is for, which is why it
   * is a field. Google returns no refresh token at all unless `access_type=offline` and
   * `prompt=consent` are sent, and the failure is silent: the connection authorises, works for an
   * hour, and then cannot renew. That rule lived as a check on one provider id until 2026-08-18,
   * when a SECOND Google provider was added and inherited a one-hour lifetime nobody would have
   * seen until the second day.
   */
  offlineAccess: boolean;
  /**
   * What an app may ASK about a connection at this provider (decision K1). An app never reads the
   * provider's own scope vocabulary — it cannot know what those names mean — so it asks a question
   * in AIMEAT's vocabulary and gets a yes or no.
   *
   * The vocabulary: `publish-post`, `publish-video`, `read-metrics`. `read-metrics` is here because
   * an app that cannot ask it has to FIND OUT by calling — which costs a provider request and, on
   * X, money, to be told what the registry already knew. It also renders a "read the numbers"
   * button on LinkedIn, where the answer is a permanent refusal: a control that can never work.
   * A provider carries it exactly when metrics.ts has a reader that can succeed for it.
   */
  capabilities: string[];
  /**
   * What may be read from this connection, by name. Absent on a publish-only provider, which is
   * every provider that existed before the read direction did.
   */
  resources?: Record<string, ProviderResource>;
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
  /**
   * Endpoints. `instance` is required exactly when `instanceScoped` is true.
   *
   * `tenant` is Microsoft's alone and is a SECOND axis, not a rename of the first: an instance is a
   * different SERVER (Mastodon), while a tenant is a different directory on the same one. It arrives
   * from the client credentials rather than from the connection, because it is a property of the app
   * registration: a principal who brings a single-tenant Entra app brings its tenant with it, and
   * the node's own app uses the configured one. Every other provider ignores it.
   */
  endpoints(instance: string | null, tenant?: string | null): OAuthEndpoints | null;
}

/** What discovery may show. Deliberately free of anything an app could not act on. */
export interface OutboundProviderMeta {
  id: OutboundProviderId;
  /** False when the node holds no client for it; a principal's own app still works. */
  nodeConfigured?: boolean;
  label: string;
  instanceScoped: boolean;
  credentialShape: CredentialShape;
  capabilities: string[];
  attachFields: AttachField[] | null;
}
