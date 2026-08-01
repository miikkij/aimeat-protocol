/**
 * @file connection-schemas.ts
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
}

/**
 * What an app is allowed to see (decision K1). Enough to name the account in a picker and to show
 * that it needs attention; not enough to reason about the provider's scope vocabulary, whose
 * meaning an app cannot know. Capability questions go through a `can(capability)` ask instead.
 */
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
  /** Instance origin, normalised and validated: it comes from a user, so it is an SSRF vector. */
  instance: string;
  clientId: string;
  clientSecret: string;
  registeredAt: string;
}

/** Rows a caller may set when opening an attempt; the rest is the store's business. */
export type NewPublishAttempt = Pick<
  PublishAttempt,
  'id' | 'idempotencyKey' | 'publisher' | 'connectionId' | 'delegationId' | 'storageKey' | 'status'
>;
