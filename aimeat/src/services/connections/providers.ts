/**
 * @file providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.3.0 — 2026-08-17 — A provider may declare `resources`: things that can be READ from a
 *     connected account, by name, with the node building every URL. Gmail is the first, read-only,
 *     because mail is the connector everybody already has and nothing of theirs can see it.
 *   v1.2.0 — 2026-08-08 — `read-metrics` joins the capability vocabulary, so an app can tell before
 *     spending a request (and, on X, money) whether a channel will ever report numbers to its
 *     author. LinkedIn does not carry it, which is the whole point.
 *   v1.1.0 — 2026-08-02 — Mastodon asks for read:statuses: without it the metric reader 403'd forever,
 *     so the capability was advertised and could never work.
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1b. Mastodon, YouTube, Bluesky.
 */

import type { AimeatConfig } from '../../config.js';
import type { CredentialShape } from '../../models/connection-schemas.js';

/** Stable provider identifiers. Also the value stored in `Connection.provider`. */
export type OutboundProviderId = 'mastodon' | 'youtube' | 'linkedin' | 'x' | 'bluesky' | 'google-mail' | 'fake' | 'fake-static';

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
  /** Endpoints. `instance` is required exactly when `instanceScoped` is true. */
  endpoints(instance: string | null): OAuthEndpoints | null;
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

/**
 * Mastodon. The awkward one, and the reason the store carries an `instance` column at all: the same
 * handle at two instances is two accounts, and the client credentials are issued per instance by
 * `POST /api/v1/apps` with no human in the loop. There is nothing to put in .env because nobody
 * knows which instance the next user arrives from.
 */
function mastodon(capabilityOn: boolean): OutboundProvider {
  return {
    id: 'mastodon',
    label: 'Mastodon',
    credentialShape: 'oauth2',
    instanceScoped: true,
    // Mastodon registers itself per instance, so it needs no node client: the capability switch is
    // the only thing that can turn it off.
    enabled: capabilityOn,
    capabilityOn,
    disabledReason: capabilityOn ? null : 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)',
    client: null,
    // read:statuses is what lets an author READ BACK how their own post did. Without it the metric
    // reader gets a 403 forever — the capability was advertised and could never work, which is the
    // "the gate is decorative" failure this registry is written against. Connections made before
    // this was added keep working for publishing and must be reconnected to read numbers.
    scopes: ['read:accounts', 'read:statuses', 'write:statuses', 'write:media'],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: false,
    capabilities: ['publish-post', 'publish-video', 'read-metrics'],
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
    capabilityOn,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_GOOGLE_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    // BOTH, and the second one is not optional. `youtube.upload` grants the write and nothing else,
    // so `channels.list?mine=true` — how the node learns WHICH channel this connection is for —
    // comes back 403 with a valid token. Asking only for the write and then reading is a
    // contradiction that shows up at the very last step of a user's first connection attempt.
    // The channel identity is what the dedupe key and the account label are built from, so this is
    // the narrowest pair that actually works rather than a convenience.
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: true,
    capabilities: ['publish-video', 'read-metrics'],
    attachFields: null,
    // SIX. Read from the project's own quota page on 2026-08-02, not guessed:
    //
    //   Queries per day .......... 10,000   <- the budget, and the one that binds
    //   Video Uploads per day ....... 100   <- looks like the limit, and is not
    //
    // The allowance is spent in UNITS, and one videos.insert costs 1,600 of them, so the budget
    // runs out after six uploads while the upload counter is still at 6 of 100. Anyone reading that
    // page would take the 100 and be wrong by a factor of sixteen.
    //
    // It is per Google PROJECT, so this is six uploads a day for EVERY publisher on the node
    // combined — which is exactly why a shared channel needs a per-publisher cap on top.
    //
    // The 1,600 is Google's documented per-call cost rather than something measured here. The
    // measurement is one step away and belongs to the first real upload: the quota page shows
    // Current usage, so a single publish either moves it by 1,600 or corrects this number. (It
    // already reads 1 from the channels.list the node makes when an account is connected.)
    sharedDailyLimit: 6,
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
 * LinkedIn.
 *
 * IT SHOULD HAVE BEEN IN THE FIRST SLICE. The provider map put it behind a product approval, which
 * was wrong: "Sign In with LinkedIn (OpenID Connect)" and "Share on LinkedIn" are the Consumer
 * tier, self-serve, no human review. That error kept the platform that matters most for business
 * at the back of the queue for the whole build. The mistake was factual, the cost was real.
 *
 * TWO THINGS DIFFER FROM THE OTHER OAUTH PROVIDERS and both are handled rather than assumed:
 *
 *   NO PKCE. LinkedIn's authorization-code flow does not document a code_challenge, and sending one
 *   to a server that does not expect it is a way to fail at the consent screen. `pkce: false`.
 *
 *   PROBABLY NO REFRESH TOKEN. Programmatic refresh is a gated feature on LinkedIn; a Consumer-tier
 *   app typically gets a ~60-day access token and nothing to renew it with. That is not a failure
 *   mode this code has to invent anything for — a session with no refresh token already resolves to
 *   needs_reauth with a reason the owner can act on. It does mean a LinkedIn connection asks to be
 *   reconnected a few times a year, and the panel note says so before anyone connects.
 *
 * VARMISTETTAVA against a real app: whether a refresh token arrives at all, and the daily call
 * ceiling (reported as roughly 100/day/member, with no self-serve way to raise it).
 */
function linkedin(clientId: string, clientSecret: string, capabilityOn: boolean): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const enabled = capabilityOn && configured;
  return {
    id: 'linkedin',
    label: 'LinkedIn',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    capabilityOn,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_LINKEDIN_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    // openid+profile identify WHICH member this connection is for, which is what the dedupe key and
    // the account label are built from. w_member_social is the write. Asking for the write alone and
    // then reading is the mistake that cost an hour on YouTube.
    scopes: ['openid', 'profile', 'w_member_social'],
    pkce: false,
    tokenAuth: 'body',
    offlineAccess: false,
    // Text and images at the Consumer tier. NOT publish-video and NOT a native PDF carousel: the
    // Documents API sits behind the partner-gated Community Management product, and advertising a
    // capability the recipe cannot perform is the bug the attach route was already fixed for.
    // NO read-metrics, and its absence is load-bearing: analytics is behind the same partner gate,
    // so an app that offered "read the numbers" here would render a button whose only possible
    // answer is a refusal. A production user pressed it repeatedly and concluded the app was broken.
    capabilities: ['publish-post'],
    // Roughly 100 calls a day per member, but that is a per-MEMBER limit rather than a shared pool,
    // so it is not the kind of ceiling sharedDailyLimit models.
    sharedDailyLimit: null,
    attachFields: null,
    endpoints() {
      return {
        authorize: 'https://www.linkedin.com/oauth/v2/authorization',
        token: 'https://www.linkedin.com/oauth/v2/accessToken',
        // LinkedIn offers a revocation endpoint; revoking locally alone would be forgetting.
        revoke: 'https://www.linkedin.com/oauth/v2/revoke',
      };
    },
  };
}

/**
 * X.
 *
 * WHY IT IS HERE NOW AND WAS NOT BEFORE. X had no usable free write access; the entry price was a
 * monthly subscription, which put it out of scope for a node that anyone can run. That changed on
 * 2026-02-06: the free tier closed to new developers and pay-per-use replaced it, with NO monthly
 * minimum, prepaid credits, a spend cap the developer sets, and roughly $0.015 per post created.
 * The blocker was the subscription floor, and the subscription floor is gone.
 *
 * THREE THINGS DIFFER FROM THE OTHER OAUTH PROVIDERS:
 *
 *   The secret goes in an Authorization header, not the body — see tokenAuth above.
 *
 *   PKCE is mandatory rather than optional.
 *
 *   offline.access is what makes the connection survive. Without that scope X issues no refresh
 *   token and the connection dies in two hours. It is the same trap as Google's access_type=offline
 *   and it is silent in exactly the same way: the authorization succeeds, nothing in the response
 *   says anything is missing, and the failure arrives hours later.
 *
 * COSTS REAL MONEY PER POST, which nothing else in this registry does. The operator's spend cap
 * lives at X rather than here, and that is the right place for it: a limit this node enforced could
 * be bypassed by anything else using the same credentials.
 */
function x(clientId: string, clientSecret: string, capabilityOn: boolean): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const enabled = capabilityOn && configured;
  return {
    id: 'x',
    label: 'X',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    capabilityOn,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_X_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    // users.read identifies the account, tweet.write publishes, offline.access keeps it alive.
    // Dropping any one of the three breaks something that only shows up later.
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    pkce: true,
    tokenAuth: 'basic',
    offlineAccess: false,
    // Text only for now. Media goes through a separate chunked endpoint with its own processing
    // wait, and claiming video before that exists is the failure the recipe guard now catches.
    // read-metrics is real here and it BILLS: public_metrics is charged per read, which is why
    // nothing on this node reads it on a timer.
    capabilities: ['publish-post', 'read-metrics'],
    // Pay-per-use has no daily ceiling to model; the limit is a spend cap set at X.
    sharedDailyLimit: null,
    attachFields: null,
    endpoints() {
      return {
        authorize: 'https://x.com/i/oauth2/authorize',
        token: 'https://api.x.com/2/oauth2/token',
        revoke: 'https://api.x.com/2/oauth2/revoke',
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
    capabilityOn,
    disabledReason: capabilityOn ? null : 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)',
    // No client credentials at all: the user's app password IS the credential.
    client: null,
    scopes: [],
    pkce: false,
    tokenAuth: 'body',
    offlineAccess: false,
    // publish-post ONLY, and publish-video is deliberately absent. Video on Bluesky goes through a
    // separate video service with its own job queue and limits, which is not built. Listing a
    // capability the recipe cannot perform is the same "advertised but unconnectable" mistake the
    // attach route was just fixed for, one field over.
    capabilities: ['publish-post', 'read-metrics'],
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
    capabilityOn,
    disabledReason: enabled ? null : 'no AIMEAT_CONNECT_FAKE_BASE_URL (this provider is test-only)',
    client: baseUrl ? { id: 'fake-client', secret: 'fake-secret' } : null,
    scopes: ['publish'],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: false,
    capabilities: ['publish-video', 'publish-post', 'read-metrics', 'read-items'],
    sharedDailyLimit: null,
    attachFields: null,
    // A readable resource, so the read direction can be driven against a real HTTP round rather
    // than against a mock of one. `publish` is deliberately the scope it needs: the point is that
    // the check compares against what the connection was GRANTED, whatever the words are.
    resources: baseUrl ? {
      items: {
        label: 'the test items',
        requiresScopes: ['publish'],
        url(params) {
          const u = new URL(`${baseUrl}/items`);
          const n = Number(params.limit);
          u.searchParams.set('limit', String(Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 10));
          return u.toString();
        },
      },
      'needs-more': {
        label: 'something this connection was never allowed',
        requiresScopes: ['publish', 'read:everything'],
        url() { return `${baseUrl}/items`; },
      },
    } : undefined,
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
    capabilityOn,
    disabledReason: enabled ? null : 'no AIMEAT_CONNECT_FAKE_BASE_URL (this provider is test-only)',
    client: null,
    scopes: [],
    pkce: false,
    tokenAuth: 'body',
    offlineAccess: false,
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
 * Build the token-endpoint request the way THIS provider wants to be asked.
 *
 * Two providers, two conventions, one place. RFC 6749 allows either, and X is strict about wanting
 * the header form: a confidential client that puts its secret in the body gets a 401 whose message
 * does not mention the secret at all.
 */
export function tokenRequest(
  provider: OutboundProvider,
  client: { clientId: string; clientSecret: string },
  fields: Record<string, string>,
): { headers: Record<string, string>; body: string } {
  const body = new URLSearchParams({ ...fields, client_id: client.clientId });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (provider.tokenAuth === 'basic') {
    const pair = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${pair}`;
  } else {
    body.set('client_secret', client.clientSecret);
  }
  return { headers, body: body.toString() };
}

/**
 * The providers this node offers. Disabled ones are RETURNED rather than filtered, so a route can
 * answer "why can I not connect YouTube" with the reason instead of a bare absence — an operator
 * staring at an empty list has nothing to act on.
 */
/**
 * Gmail, read-only.
 *
 * THE FIRST CONNECTION THAT EXISTS TO BE READ RATHER THAN WRITTEN TO, and the reason the read
 * direction was built at all: mail is the connector everybody already has. A person forwards
 * themselves an invoice, a booking, a meter reading, and it sits in a mailbox no tool of theirs can
 * see.
 *
 * `gmail.readonly` and NOTHING else. Google offers scopes that send, delete and modify, and none of
 * them are asked for: a permission that is never requested cannot be misused, cannot be leaked and
 * does not have to be explained to the person on the consent screen. If sending ever becomes a
 * feature it becomes a SECOND provider entry with its own consent, not a wider scope on this one.
 *
 * Shares the Google client with YouTube, because they are one registered application at Google. The
 * scopes are what differ, and the consent screen names them.
 */
function googleMail(clientId: string, clientSecret: string, capabilityOn: boolean): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const enabled = capabilityOn && configured;
  const READ = 'https://www.googleapis.com/auth/gmail.readonly';
  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

  return {
    id: 'google-mail',
    label: 'Gmail',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    capabilityOn,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_GOOGLE_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: [READ],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: true,
    // Reading is all it does. It carries no publish capability, so no surface offers it a post box.
    capabilities: ['read-mail'],
    sharedDailyLimit: null,
    attachFields: null,
    resources: {
      messages: {
        label: 'the list of messages',
        requiresScopes: [READ],
        url(params) {
          const limit = clampLimit(params.limit, 25, 100);
          const q = typeof params.query === 'string' ? params.query.slice(0, 500) : '';
          const page = typeof params.page_token === 'string' ? params.page_token.slice(0, 200) : '';
          const u = new URL(`${API}/messages`);
          u.searchParams.set('maxResults', String(limit));
          if (q) u.searchParams.set('q', q);
          if (page) u.searchParams.set('pageToken', page);
          return u.toString();
        },
      },
      message: {
        label: 'one message',
        requiresScopes: [READ],
        url(params) {
          const id = typeof params.id === 'string' ? params.id.trim() : '';
          // The id goes into the PATH, so it is checked rather than trusted: Gmail ids are
          // hexadecimal, and anything else here is either a mistake or an attempt to walk the URL
          // somewhere this node never meant to send a token.
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
            throw new Error('Name which message to open. The id comes from the message list.');
          }
          const u = new URL(`${API}/messages/${id}`);
          u.searchParams.set('format', params.format === 'raw' ? 'raw' : 'full');
          return u.toString();
        },
      },
      attachment: {
        label: 'a file attached to a message',
        requiresScopes: [READ],
        url(params) {
          // Gmail hands back attachments by REFERENCE rather than inline, so a message with a
          // 3 MB invoice on it is still a small answer and the bytes are fetched only when
          // somebody wants them. Both ids go into the path, so both are checked.
          const message = typeof params.message_id === 'string' ? params.message_id.trim() : '';
          const attachment = typeof params.attachment_id === 'string' ? params.attachment_id.trim() : '';
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(message)) {
            throw new Error('Name which message the attachment is on. The id comes from the message list.');
          }
          if (!/^[A-Za-z0-9_-]{1,512}$/.test(attachment)) {
            throw new Error('Name which attachment. The id is on the message, under its parts.');
          }
          return `${API}/messages/${message}/attachments/${attachment}`;
        },
      },
      profile: {
        label: 'which mailbox this is',
        requiresScopes: [READ],
        url() { return `${API}/profile`; },
      },
    },
    endpoints: () => ({
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      revoke: 'https://oauth2.googleapis.com/revoke',
    }),
  };
}

/** A caller-supplied count, made safe without an error: a silly number is a small number. */
function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function buildOutboundProviders(config: AimeatConfig): OutboundProvider[] {
  const on = config.connectionsEnabled;
  const list = [
    mastodon(on),
    youtube(config.connectGoogleClientId, config.connectGoogleClientSecret, on),
    linkedin(config.connectLinkedinClientId, config.connectLinkedinClientSecret, on),
    x(config.connectXClientId, config.connectXClientSecret, on),
    googleMail(config.connectGoogleClientId, config.connectGoogleClientSecret, on),
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
  return providers
    // The master switch first: off means nothing is offered, whoever brought what.
    .filter((p) => p.capabilityOn)
    // Then: a provider the NODE has no client for is still listed, as long as someone could bring
    // their own. Hiding it was right when the node's registration was the only way in; now it would
    // mean the operator's decision not to register an app silently removes a choice from every
    // user. The `fake` test providers stay out: they are gated on config and have nothing to bring.
    .filter((p) => p.enabled || (p.credentialShape === 'oauth2' && !p.id.startsWith('fake')))
    .map((p) => ({
      id: p.id,
      label: p.label,
      instanceScoped: p.instanceScoped,
      credentialShape: p.credentialShape,
      capabilities: p.capabilities,
      attachFields: p.attachFields,
      /** False means: this node has no client. Bring your own and it works anyway. */
      nodeConfigured: p.enabled,
    }));
}
