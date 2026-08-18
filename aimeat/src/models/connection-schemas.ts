/**
 * @file connection-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Types for outbound connections (TARGET-057, aimeat-connect): a principal's own
 *   account at an EXTERNAL service, held by the node so nothing else has to hold it.
 *
 *   The distinction this file exists to keep straight is the one the first spec draft got wrong.
 *   `principal` is WHOEVER CONNECTED THE ACCOUNT, which in a multi-user app is the app's USER, not
 *   the app's owner. The field is deliberately not called `owner`: that word already means the
 *   account layer in AIMEAT, and reusing it here produced a model that could not carry a multi-user
 *   app at all. See design doc-t057-modes.
 *
 *   Two modes, and the second one is not a later addition:
 *     - `personal` — the user connected their own account; only they use it.
 *     - `shared`   — an app owner connected a channel and DELEGATED a named action over it. The
 *                    delegation, not the connection, is what an app calls. Its constraints
 *                    (per-user cap, moderation, attribution) change the schema, which is why both
 *                    modes ship together.
 *
 *   The credential itself never appears in this file's read shapes. `ConnectionRecord.credential`
 *   is ciphertext (`iv:tag:ct` from services/encryption.ts) and `PublicConnection` is what an app
 *   is allowed to see.
 * @structure
 *   - ConnectionMode / ConnectionStatus / CredentialShape — the three enums
 *   - ConnectionRecord — the stored row, credential encrypted
 *   - PublicConnection — the app-facing projection (K1: no scopes, no expiry)
 *   - DelegationRecord — shared-mode only: one named action with fixed parameters
 *   - PublishAttempt — idempotency key + attribution + quota accounting, written BEFORE the attempt
 * @usage import type { ConnectionRecord } from '../models/connection-schemas.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1.
 */

/** Whose account it is and who may act through it. See doc-t057-modes. */
export type ConnectionMode = 'personal' | 'shared';

/**
 * `needs_reauth` is a user-visible state, not an error. It is what a failed refresh or a
 * provider-side revocation resolves to, and scheduled work parks on it rather than retrying.
 */
export type ConnectionStatus = 'active' | 'needs_reauth' | 'revoked';

/**
 * How the stored credential is renewed. The store records the shape rather than assuming it —
 * designing around `oauth2` alone produces a store that cannot hold a Bluesky app password or a
 * Telegram bot token, and that failure only shows up at the third provider.
 */
export type CredentialShape =
  /** Authorization code + PKCE, access + refresh. Mastodon, Google/YouTube, Meta, TikTok, LinkedIn. */
  | 'oauth2'
  /** Long-lived, never renewed; revoked at the provider. Telegram bot token, Bluesky app password. */
  | 'static'
  /** Renewed by the provider's own protocol, not OAuth2's. AT Proto refreshJwt. */
  | 'session';

/** Decrypted credential payload. Interpreted per `shape`; never leaves the node. */
export interface ConnectionCredential {
  shape: CredentialShape;
  /** oauth2/session: the token used on a call. static: the whole secret. */
  accessToken: string;
  /** oauth2/session only. Absent for `static`. */
  refreshToken?: string;
  /** Anything provider-specific the recipe needs back (Bluesky DID, Telegram chat id, ...). */
  extra?: Record<string, string>;
}

/**
 * One account at one provider. `principal` + `provider` + `externalId` is the natural key: the same
 * person may hold several accounts at one provider, and `externalId` is what stops the same account
 * being connected twice as two rows.
 */
export interface ConnectionRecord {
  id: string;
  /** GHII of whoever connected it. Always via resolveIdentity(), never req.auth!.sub. */
  principal: string;
  mode: ConnectionMode;
  /** Registry key, never free text. */
  provider: string;
  /**
   * Only set when the provider is not a single endpoint (Mastodon). The value comes from the user,
   * so it is validated and normalised on write and every call to it goes through safeFetch.
   */
  instance: string | null;
  /** What the user sees, e.g. `@jouni@mastodon.social`. Fetched from the provider, never typed. */
  accountLabel: string;
  /** The provider's own id for the account. Dedupe key; not shown. */
  externalId: string;
  /** Ciphertext `iv:tag:ct` of a JSON ConnectionCredential. Never in any response. */
  credential: string;
  credentialShape: CredentialShape;
  /** Provider's own scope vocabulary. Never exposed to an app (K1). */
  scopes: string[];
  /** null is a valid state, not a bug: some providers issue tokens that do not expire. */
  expiresAt: string | null;
  status: ConnectionStatus;
  lastOkAt: string | null;
  /** Why it stopped working, in words a person can act on. */
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * WHICH client minted this token, when it was not the node's own.
   *
   * This exists because a refresh must be made by the SAME client that issued the token. A user who
   * connects with their own app and is then refreshed with the node's app gets an invalid_grant they
   * cannot read and a connection that dies on its first renewal, hours after it appeared to work.
   *
   * null means the node's configured client, which is both the default and every connection that
   * existed before principals could bring their own.
   */
  providerClientId: string | null;
}

/**
 * What an app is allowed to see (decision K1). Enough to name the account in a picker and to show
 * that it needs attention; not enough to reason about the provider's scope vocabulary, whose
 * meaning an app cannot know. Capability questions go through a `can(capability)` ask instead.
 */
/** One published item as a history view shows it: the attempt, plus who it went to. */
export interface PublishHistoryItem {
  id: string;
  connectionId: string;
  provider: string;
  accountLabel: string;
  status: PublishStatus;
  externalRef: string | null;
  storageKey: string;
  error: string | null;
  createdAt: string;
  /** The most recent sample, when one has been taken. Null means nobody has asked yet. */
  latest: PublishMetricSample | null;
}

export interface PublicConnection {
  id: string;
  provider: string;
  mode: ConnectionMode;
  accountLabel: string;
  status: ConnectionStatus;
}

/** Whether a publish waits for the channel owner before it leaves the node. */
export type ModerationMode = 'hold' | 'auto';

/**
 * Shared mode only: ONE named action over one connection, with the parameters the app may not
 * choose already decided.
 *
 * The point of the indirection is that an app calls the delegation, never the connection. It cannot
 * retarget the channel, the visibility or the playlist because those are not its parameters. A
 * delegation is a narrow errand, not a power of attorney over the owner's account.
 */
export interface DelegationRecord {
  id: string;
  connectionId: string;
  /** The app this errand is for. One delegation per (connection, app, action). */
  appId: string;
  /** Recipe-defined, e.g. `publish-video`. */
  action: string;
  /** Parameters the app may NOT override. Merged over whatever the app sends. */
  fixed: Record<string, unknown>;
  /**
   * Per-publisher ceiling, keyed on the publisher's GHII — which is only possible because a shared
   * publish requires an identified user. Without it one publisher drains a provider quota that is
   * shared by everyone: YouTube's daily allowance is per project, not per user.
   */
  perUserLimit: { count: number; windowHours: number } | null;
  moderation: ModerationMode;
  /** The one-gesture stop. Flipping this halts every publisher at once. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A publish, written BEFORE it is attempted.
 *
 * That order is the whole point. A retry that races a slow success publishes the video twice, and
 * this repository has produced that same family of bug three times already (ORIGAMI's applyDirect
 * among them). The idempotency key makes the second attempt return the first one's outcome instead
 * of doing the work again.
 *
 * It doubles as the attribution record — a shared channel's owner has to be able to say which of
 * their app's users caused a given post — and as the quota ledger.
 */
export interface PublishAttempt {
  id: string;
  /**
   * sha256 over principal + storageKey + connectionId + caption. Deterministic, so a retry computes
   * the same key without having to remember anything.
   */
  idempotencyKey: string;
  /** WHO published. In shared mode this is the app's user, not the connection's principal. */
  publisher: string;
  connectionId: string;
  /** null for a personal-mode publish. */
  delegationId: string | null;
  storageKey: string;
  status: PublishStatus;
  /** Provider's id for the published item, once there is one. */
  externalRef: string | null;
  /** Rejection reason as the provider gave it, for translating into something a person can act on. */
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `held` is moderation, `queued` is a full shared quota. Both are honest waiting states rather than
 * failures, and neither is retried as if it were one. `rejected` is the provider refusing the
 * content — permanent, and never retried automatically.
 */
export type PublishStatus =
  | 'in_flight'
  | 'held'
  | 'queued'
  | 'done'
  | 'failed'
  | 'rejected';

/**
 * The client registration this node holds AT one provider instance.
 *
 * Not the user's token, and not `.env` either. It is the third secret in this feature: an
 * instance-scoped provider (Mastodon) issues client credentials PER INSTANCE, and since there is no
 * way to know which instance the next user arrives from, they cannot be configuration. The node
 * registers itself on first contact and remembers the result so the second user from that instance
 * reuses it.
 *
 * `clientSecret` is ciphertext. It is not personal data, but a table that stores a secret in the
 * clear teaches the next table to do the same.
 */
export interface ProviderClientRecord {
  id: string;
  provider: string;
  /**
   * Instance origin, normalised and validated: it comes from a user, so it is an SSRF vector.
   * Null on a row that belongs to a principal rather than to an instance.
   */
  instance: string | null;
  /**
   * WHOSE client this is. Null means the NODE's own registration, acquired by registering at an
   * instance and shared by everyone arriving from there.
   *
   * Non-null means a principal supplied their own app. That is the answer to the cost of a shared
   * registration: everyone on one node otherwise appears to the provider as one application and
   * shares its rate limit, its reputation and, at X, its bill. A principal who brings their own
   * spends their own.
   */
  principal: string | null;
  clientId: string;
  clientSecret: string;
  registeredAt: string;
}

/**
 * What a platform reports back about one published item, at one moment.
 *
 * A TIME SERIES AND NOT A FIELD ON THE ATTEMPT. "How did that post do" is a question about a curve:
 * a number that only ever holds the latest value can say a post has 40 likes and can never say
 * whether that happened in an hour or over a month, which is the part anyone deciding what to
 * publish next actually needs.
 *
 * NORMALISED, WITH THE ORIGINAL KEPT. Every platform names these differently and measures slightly
 * different things — a Mastodon "reblog", a Bluesky "repost", an X "retweet" and a LinkedIn "share"
 * are cousins, not synonyms. The normalised fields make a comparison possible; `raw` keeps what the
 * provider actually said, so a wrong mapping stays discoverable rather than becoming the only
 * record. A field the provider does not report is null, never 0: absent and zero are different
 * answers and collapsing them invents engagement that was never measured.
 */
export interface PublishMetricSample {
  id: string;
  attemptId: string;
  /** When THIS node asked. Not when the platform computed it, which is rarely knowable. */
  fetchedAt: string;
  /** Views/impressions. Null where the platform does not report it to the author. */
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  /** Reblogs, reposts, retweets, shares. Named once so a comparison is possible at all. */
  shares: number | null;
  /** Exactly what the provider returned, so a mapping mistake stays visible. */
  raw: Record<string, unknown>;
}

/** A principal's own client as an app or panel may see it. NEVER carries the secret. */
export interface PublicProviderClient {
  provider: string;
  clientId: string;
  registeredAt: string;
  /** How many of this principal's connections were minted by it, so deleting is an informed act. */
  connectionCount: number;
}

/** Rows a caller may set when opening an attempt; the rest is the store's business. */
export type NewPublishAttempt = Pick<
  PublishAttempt,
  'id' | 'idempotencyKey' | 'publisher' | 'connectionId' | 'delegationId' | 'storageKey' | 'status'
>;
