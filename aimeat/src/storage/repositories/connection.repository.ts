/**
 * @file src/storage/repositories/connection.repository.ts
 * @description Repository interface for outbound connections, delegations and publish attempts
 *   (TARGET-057, aimeat-connect). The store holds a principal's credential for an EXTERNAL service
 *   so that no app, extension or log ever has to.
 *
 *   Three things here are load-bearing and are stated as contracts rather than left to callers:
 *
 *   1. NO METHOD APPLIES AUTHORIZATION. Every read returns whatever matches; the route compares
 *      `principal` against resolveIdentity() and returns an IDENTICAL 404 for "absent" and "not
 *      yours". Same contract as the provenance repository.
 *   2. THE CREDENTIAL IS CIPHERTEXT ON THE WAY IN AND OUT. This layer never encrypts or decrypts —
 *      services/connections does. A repository that decrypted would put plaintext in every query
 *      result whether the caller wanted it or not.
 *   3. openPublishAttempt() IS THE IDEMPOTENCY GATE and must be atomic. It is the reason a retry
 *      racing a slow success does not publish twice.
 * @structure
 *   - createConnection / getConnection / findConnection / listConnections
 *   - updateConnectionCredential / setConnectionStatus / touchConnectionOk / deleteConnection
 *   - claimConnectionRefresh / releaseConnectionRefresh — the single-flight pair
 *   - upsertDelegation / getDelegation / findDelegation / listDelegations / setDelegationEnabled
 *   - openPublishAttempt / getPublishAttempt / updatePublishAttempt / listPublishAttempts
 *   - countPublishAttempts — the per-user cap and the shared daily quota, counted in SQL
 * @usage
 *   import type { ConnectionRepository } from './repositories/connection.repository.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1.
 */
import type {
  ConnectionRecord, ConnectionStatus, DelegationRecord,
  PublishAttempt, NewPublishAttempt, PublishStatus, ProviderClientRecord,
} from '../../models/connection-schemas.js';

/** Narrowing for a listing. All fields optional; omitted means "any". */
export interface ConnectionQuery {
  principal?: string;
  provider?: string;
  mode?: 'personal' | 'shared';
  status?: ConnectionStatus;
}

/** Narrowing for the counters. `since` is an ISO timestamp; the window is half-open [since, now). */
export interface PublishAttemptQuery {
  publisher?: string;
  connectionId?: string;
  delegationId?: string;
  status?: PublishStatus | PublishStatus[];
  since?: string;
}

export interface ConnectionRepository {
  createConnection(row: ConnectionRecord): Promise<void>;

  /** By node-local id. Applies NO authorization — see the file header. */
  getConnection(id: string): Promise<ConnectionRecord | undefined>;

  /**
   * The dedupe lookup: this principal's connection to this exact external account. `instance`
   * participates because the same account name at two Mastodon instances is two accounts.
   */
  findConnection(
    principal: string, provider: string, externalId: string, instance: string | null,
  ): Promise<ConnectionRecord | undefined>;

  listConnections(query?: ConnectionQuery): Promise<ConnectionRecord[]>;

  /**
   * Replace the stored credential after a refresh or a re-authorisation. Takes ciphertext.
   * Clears `lastError` and sets status back to `active`, because a successful token exchange is
   * exactly the evidence that whatever was wrong no longer is.
   */
  updateConnectionCredential(
    id: string, credential: string, expiresAt: string | null, scopes?: string[],
  ): Promise<void>;

  /** Move to `needs_reauth` or `revoked`, recording a reason the owner can act on. */
  setConnectionStatus(id: string, status: ConnectionStatus, error?: string | null): Promise<void>;

  /** Record that a call through this connection just worked. */
  touchConnectionOk(id: string): Promise<void>;

  deleteConnection(id: string): Promise<void>;

  /**
   * SINGLE-FLIGHT REFRESH, claim half. Returns true only to the caller that won the claim; every
   * other concurrent caller gets false and must wait for the winner rather than refresh too.
   *
   * This exists because several providers invalidate the old refresh token as part of issuing a new
   * one. Two concurrent publishes on one connection therefore produce one working token and one
   * connection wrongly parked in `needs_reauth` — a failure caused entirely by our own concurrency,
   * with nothing wrong at the provider.
   *
   * `staleAfterMs` releases a claim whose holder died mid-refresh, so a crash cannot wedge a
   * connection permanently.
   */
  claimConnectionRefresh(id: string, staleAfterMs: number): Promise<boolean>;

  /** Release a claim taken by claimConnectionRefresh(), win or lose. */
  releaseConnectionRefresh(id: string): Promise<void>;

  /** One delegation per (connection, app, action) — writing the same triple replaces it. */
  upsertDelegation(row: DelegationRecord): Promise<void>;

  getDelegation(id: string): Promise<DelegationRecord | undefined>;

  /** The call path's lookup: "may this app perform this action, and over which connection?" */
  findDelegation(appId: string, action: string): Promise<DelegationRecord | undefined>;

  /** For the owner's panel: everything delegated over one connection. */
  listDelegations(connectionId?: string): Promise<DelegationRecord[]>;

  /** The one-gesture stop. Halts every publisher on this delegation at once. */
  setDelegationEnabled(id: string, enabled: boolean): Promise<void>;

  /**
   * THE IDEMPOTENCY GATE. Insert the attempt if `idempotencyKey` is new and return it; if the key
   * already exists, return the EXISTING row and write nothing.
   *
   * Must be atomic (an upsert on the unique key, not read-then-write). A read-then-write leaves the
   * exact window this method exists to close: two callers both see "no such key" and both publish.
   *
   * The caller distinguishes the two outcomes by comparing `row.id` with the id it passed.
   */
  openPublishAttempt(row: NewPublishAttempt): Promise<PublishAttempt>;

  getPublishAttempt(id: string): Promise<PublishAttempt | undefined>;

  updatePublishAttempt(
    id: string, patch: Partial<Pick<PublishAttempt, 'status' | 'externalRef' | 'error'>>,
  ): Promise<void>;

  listPublishAttempts(query?: PublishAttemptQuery): Promise<PublishAttempt[]>;

  /**
   * Counted in SQL, because both callers are gates rather than displays: the per-user cap on a
   * delegation, and the shared daily quota for a provider whose allowance is per project rather
   * than per user. Paging rows in to count them would make the ceiling mean "in the first page".
   */
  countPublishAttempts(query: PublishAttemptQuery): Promise<number>;

  /**
   * Remember the client registration this node holds at one provider instance, or return the
   * registration that already exists.
   *
   * Insert-if-new and read back, for the same reason openPublishAttempt() is: two users arriving
   * from the same Mastodon instance at the same moment must converge on ONE registration. A
   * check-then-insert would let both register, and the loser's credentials would be orphaned at the
   * instance with nothing pointing at them.
   *
   * `clientSecret` is ciphertext on the way in and out. This layer never encrypts.
   */
  upsertProviderClient(row: ProviderClientRecord): Promise<ProviderClientRecord>;

  /** The registration for one (provider, instance), or undefined if this node has never registered. */
  getProviderClient(provider: string, instance: string): Promise<ProviderClientRecord | undefined>;

  /**
   * A principal's OWN client for a provider, if they brought one. Scoped to the principal by the
   * query rather than by a check afterwards: a lookup that can return someone else's row and is
   * then filtered is a lookup that leaks the day someone forgets the filter.
   */
  getPrincipalProviderClient(
    provider: string, principal: string,
  ): Promise<ProviderClientRecord | undefined>;

  /**
   * By id, for the refresh path: a connection remembers which client minted it and must renew with
   * that one. Returns undefined if the row is gone, which the caller treats as needs_reauth rather
   * than silently falling back to the node's client and producing an unreadable invalid_grant.
   */
  getProviderClientById(id: string): Promise<ProviderClientRecord | undefined>;

  /** Store or replace a principal's own client. One per principal per provider. */
  upsertPrincipalProviderClient(row: ProviderClientRecord): Promise<ProviderClientRecord>;

  /** Every client this principal brought. Secrets included; the route projects them away. */
  listPrincipalProviderClients(principal: string): Promise<ProviderClientRecord[]>;

  /** Returns false when there was nothing to delete, so absent and not-yours answer alike. */
  deletePrincipalProviderClient(provider: string, principal: string): Promise<boolean>;

  /** How many of this principal's connections were minted by a given client. */
  countConnectionsByProviderClient(providerClientId: string): Promise<number>;
}
