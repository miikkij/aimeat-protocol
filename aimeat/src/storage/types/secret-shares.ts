/**
 * @file src/storage/types/secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Secret shares: one person (or their agent) deposits a secret and names who may pick it
 *   up, for how long and how protected; or one person makes a REQUEST, an empty share another person
 *   fills. The maker of the share (the sharer, or the requester) decides recipients, retention and
 *   protection (Jouni, 2026-11-14).
 *
 *   NOT THE OWNER VAULT. The vault in types/secrets.ts promises that a value never comes out of any
 *   API, and it keeps that promise. A share carries its OWN copy of the content, and handing it to a
 *   named recipient is the whole point of the row. A pickup into the vault copies the content into
 *   the vault, where the vault's promise then holds.
 *
 *   CONTENT IS SEALED AT REST. `ciphertext` is `iv:authTag:ct` from services/encryption.ts under the
 *   node key for protection `open` and `sealed`. For `e2e` it is an envelope the depositor's browser
 *   made for the recipients' device keys (or for the pickup code), which the node cannot open. The
 *   column is NULL while a request waits, and set to NULL the moment a share ends or is revoked.
 *
 *   EVENTS ARE A TABLE OF THEIR OWN. Who deposited, who picked up (a person or an agent, in whose
 *   name, into what), who revoked. The maker and the recipients read them; nothing else does.
 *
 *   RECIPIENT ROWS. Named people and named depositors are rows in SecretShareMember, so "what waits
 *   for me" is one indexed query instead of a scan of every share's JSON.
 * @structure SecretShareRecord · SecretShareRecipients · SecretShareEvent · SecretShareMember ·
 *   VaultDeviceKey · SecretShareListOptions · SecretShareRepository
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 *   2026-11-14 — record properties secretFormat, protectionLevel, fileType (field-reach vocabulary); columns unchanged.
 *   2026-11-14 — share lists take opts.limit (500, at most 1000); purgeClosedSecretShares.
 */

export type SecretShareKind = 'share' | 'request';
export type SecretShareFormat = 'text' | 'pairs' | 'file';
/** open: an agent may receive the content. sealed: an agent never receives it; a person in person
 *  does. e2e: only the recipient's own device opens it, and the node cannot. */
export type SecretShareProtection = 'open' | 'sealed' | 'e2e';
export type SecretShareRetention = 'once' | 'count' | 'until' | 'keep';
/** waiting: a request not yet filled. ready: may be picked up. ended: its pickups or its time ran
 *  out. revoked: its maker withdrew it. Content exists only while ready. */
export type SecretShareStatus = 'waiting' | 'ready' | 'ended' | 'revoked';

/** Who may pick a share up. Several may be chosen at once. */
export interface SecretShareRecipients {
  /** Named people, as GHIIs. Each also has a SecretShareMember row with role 'pickup'. */
  people: string[];
  /** The named people's own agents may pick up in their name. */
  agents: boolean;
  /** Every active member of the share's organism (and their agents, when `agents`). */
  organism: boolean;
  /** Anyone who presents the pickup code. */
  code: boolean;
}

/** What the node learned about a deposited secret from the service it belongs to (a bundled recipe,
 *  services/secret-shares/check.ts). Never contains the secret. */
export interface SecretShareCheck {
  service: string;
  ok: boolean;
  /** HTTP status of the check call, or 0 when it did not answer. */
  status: number;
  /** A short tag of the account the secret opens (a hash suffix of the service's account id). */
  account?: string;
  /** Readable facts the recipe extracted: plan, usage, limit, reset. Strings only. */
  facts?: Record<string, string>;
  at: string;
}

export interface SecretShareRecord {
  id: string;
  /** The maker: who made the share or the request, and decides its terms. A GHII. */
  ownerGhii: string;
  /** The principal that made it: the owner, or one of the owner's agents. */
  createdBy: string;
  /** The organism whose vault this share sits in, or null for the maker's own. */
  organismId: string | null;
  kind: SecretShareKind;
  /** A name a person recognises, e.g. ELEVENLABS_API_KEY. 1 to 128 characters. */
  name: string;
  /** Free text from the maker: why, what rights the key needs, where to make it. */
  note: string;
  /** Column `format`. Named apart so field-reach does not match every generic `format`. */
  secretFormat: SecretShareFormat;
  fileName: string | null;
  /** Column `contentType`: the file's media type. */
  fileType: string | null;
  ciphertext: string | null;
  sizeBytes: number;
  /** Column `protection`. */
  protectionLevel: SecretShareProtection;
  recipients: SecretShareRecipients;
  /** HMAC of the pickup code under the node key, hex; null when `recipients.code` is false. */
  codeHash: string | null;
  /** The code also needs a signed-in account. */
  codeLogin: boolean;
  /** For e2e with a code: the salt the browser derived the content key from. */
  codeSalt: string | null;
  retention: SecretShareRetention;
  /** The most pickups (`once` is 1); null for until and keep. */
  maxPickups: number | null;
  /** When the share ends (`until`), ISO; null otherwise. */
  expiresAt: string | null;
  pickups: number;
  status: SecretShareStatus;
  /** HMAC of a request's deposit token; null for a share. */
  depositTokenHash: string | null;
  /** Until when a request can be filled, ISO; null for a share. */
  requestExpiresAt: string | null;
  depositedAt: string | null;
  depositedBy: string | null;
  check: SecretShareCheck | null;
  /** For e2e: the wrapped content keys, one per recipient device key, as the browser made them. */
  e2eKeys: Array<{ ghii: string; keyId: string; wrapped: string }> | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

export type SecretShareEventKind =
  | 'created' | 'requested' | 'deposited' | 'checked' | 'picked_up' | 'refused' | 'ended' | 'revoked';

export interface SecretShareEvent {
  id: string;
  shareId: string;
  at: string;
  kind: SecretShareEventKind;
  /** The principal that acted: a GHII, an agent GAII, or `code` for an anonymous code holder. */
  actor: string;
  /** The person in whose name an agent acted; equal to actor for a person. */
  onBehalfOf: string;
  /** What else a reader needs: `to` (reveal, vault), the vault name, the refusal code. No content. */
  detail: Record<string, string>;
}

/** A person named on a share: as one who may pick it up, or as one asked to fill a request. */
export interface SecretShareMember {
  shareId: string;
  ghii: string;
  role: 'pickup' | 'deposit';
}

/** A browser's public key for end-to-end shares. The private key never leaves that browser. */
export interface VaultDeviceKey {
  ownerGhii: string;
  keyId: string;
  /** The public key as a JWK (P-256 ECDH), JSON text. */
  publicKey: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** How many shares a list answers: `limit` defaults to 500 and is capped at 1000. */
export interface SecretShareListOptions {
  limit?: number;
}

export interface SecretShareRepository {
  /** Insert the share and its member rows. */
  createSecretShare(record: SecretShareRecord, members: SecretShareMember[]): Promise<void>;
  getSecretShare(id: string): Promise<SecretShareRecord | null>;
  /** Shares this person made, newest first, at most `opts.limit` (500 by default, 1000 at most). */
  listSecretSharesByOwner(ownerGhii: string, opts?: SecretShareListOptions): Promise<SecretShareRecord[]>;
  /** Shares in these organisms' vaults, newest first, at most `opts.limit` (500 by default, 1000 at most). */
  listSecretSharesByOrganisms(organismIds: string[], opts?: SecretShareListOptions): Promise<SecretShareRecord[]>;
  /** Shares naming this person in a role, newest first, at most `opts.limit` (500 by default, 1000 at most). */
  listSecretSharesForMember(ghii: string, role: SecretShareMember['role'], opts?: SecretShareListOptions): Promise<SecretShareRecord[]>;
  /** One share's named people. Bounded by the service: at most MAX_PEOPLE (50) per role (rules.ts). */
  listSecretShareMembers(shareId: string): Promise<SecretShareMember[]>;
  /**
   * Fill a waiting request, in one statement conditional on `status = 'waiting'`. False when it was
   * already filled, ended or revoked.
   */
  depositSecretShare(id: string, fill: {
    ciphertext: string; sizeBytes: number; secretFormat: SecretShareFormat; fileName: string | null;
    fileType: string | null; check: SecretShareCheck | null; e2eKeys: SecretShareRecord['e2eKeys'];
    codeSalt: string | null; depositedAt: string; depositedBy: string;
  }): Promise<boolean>;
  /**
   * Count one pickup, in one statement conditional on the share being ready, under its pickup limit
   * and not past its end, and answer the row as it is after the count (ciphertext included). Null
   * when no pickup may be made. Two pickers racing for the last pickup: exactly one gets a row.
   */
  claimSecretSharePickup(id: string, now: string): Promise<SecretShareRecord | null>;
  /**
   * End or revoke a share: status set, content and wrapped keys removed, in one statement. Only a
   * share that is waiting or ready changes. `by` is recorded for a revoke.
   */
  closeSecretShare(id: string, status: 'ended' | 'revoked', at: string, by: string | null): Promise<boolean>;
  /** End every ready share past its end and every waiting request past its time. Answers the ids. */
  endExpiredSecretShares(now: string): Promise<string[]>;
  addSecretShareEvent(event: SecretShareEvent): Promise<void>;
  /** Newest first, at most `limit`. */
  listSecretShareEvents(shareId: string, limit: number): Promise<SecretShareEvent[]>;
  /** Every share this person made, their events and member rows, and their member rows on others'. */
  deleteSecretSharesByOwner(ownerGhii: string): Promise<number>;
  /**
   * Delete every share whose status is `ended` or `revoked` and whose `updatedAt` is before `before`
   * (ISO), with its events and member rows, in one transaction. Answers the number of shares deleted.
   * A closed share holds no content, only its terms and events, so it ages out.
   */
  purgeClosedSecretShares(before: string): Promise<number>;

  putVaultDeviceKey(key: VaultDeviceKey): Promise<void>;
  /** One account's device keys. Bounded by the service: at most MAX_DEVICE_KEYS (20) (device-keys.ts). */
  listVaultDeviceKeys(ownerGhii: string): Promise<VaultDeviceKey[]>;
  deleteVaultDeviceKey(ownerGhii: string, keyId: string): Promise<boolean>;
  deleteVaultDeviceKeysByOwner(ownerGhii: string): Promise<number>;
}
