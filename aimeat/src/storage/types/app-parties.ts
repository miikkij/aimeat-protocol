/**
 * @file src/storage/types/app-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of an app's own users (services/app-parties/): the people who registered to
 *   one app with an e-mail address, and what each keeps in it. Two tables on both providers:
 *   `AppParty` / `app_parties` (one row per person per app) and `AppPartyData` / `app_party_data`
 *   (one row per collection a person keeps, or the app shares to all of them).
 *
 *   WHY TABLES. Until 2026-11-15 every party of an app sat in one memory record under the owner's GHII
 *   (1 MB per value, so 1000 people at most), and every collection a party kept was one memory key under
 *   the owner (counted toward the owner's key budget). Each request read and parsed the whole list, and
 *   each signup rewrote it. A row per person is read by its index and written on its own version.
 *
 *   THE RECORD COLUMN is the service's whole party record as JSON (services/app-parties/contract.ts
 *   AppPartyRecord), the source of truth. The other columns are copies of its fields that a lookup or
 *   the cap needs, written from it on every insert and update, never on their own.
 *
 *   LIVE AND STALE. A signup nobody confirmed holds its place for a while after its last link
 *   (consent.app_party_pending_hours). AppPartyLiveRule names the instant a pending row stops holding it:
 *   pending, never verified, no link open at `now`, and `pendingSince` before `staleBefore`. A null
 *   `staleBefore` means no row goes stale.
 * @structure AppPartyRow · AppPartyLiveRule · AppPartyInsertResult · AppPartyDataRow ·
 *   AppPartyImportResult · AppPartyRepository
 * @usage import type { AppPartyRow } from '../storage/interface.js';
 * @version-history
 *   v1.1.0 — 2026-11-26 — countAppPartiesByApp(): every app's count in one statement, for a report
 *     that reads every app.
 *   v1.0.0 — 2026-11-15 — Initial: app parties leave the memory record for their own tables.
 */

/** One person registered to one app. */
export interface AppPartyRow {
  /** The party's uid, unique on the node. */
  uid: string;
  /** The app owner's GHII: whose party this is. */
  ownerGhii: string;
  /** `owner/filename` of the app. */
  appId: string;
  /** `ap-<12 hex>`, unique among the owner's parties. */
  name: string;
  /** SHA-256 of the lowercased address. Unique in the app. */
  emailHash: string;
  /** pending | active | stopped */
  status: string;
  /** SHA-256 of the one open link, or null. */
  linkHash: string | null;
  linkExpiresAt: string | null;
  verifiedAt: string | null;
  /** The instant a pending signup's place is counted from: the signup, or the last link sent. */
  pendingSince: string;
  epoch: number;
  /** The service's whole record (services/app-parties/contract.ts AppPartyRecord). */
  record: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** When a pending signup stops holding its place (see the file header). */
export interface AppPartyLiveRule {
  /** ISO time now. */
  now: string;
  /** A pending row whose pendingSince is before this is stale. Null: no row is stale. */
  staleBefore: string | null;
}

/** What an insert under the cap did. */
export interface AppPartyInsertResult {
  /** created: the row is in. exists: the address already has a row in the app. full: the cap is reached. */
  outcome: 'created' | 'exists' | 'full';
  /** The stale signups the insert removed to make room (with their data), for the roster cleanup. */
  dropped: AppPartyRow[];
}

/** One collection a party keeps in an app, or one the app shares (`partyUid` APP_PARTY_SHARED). */
export interface AppPartyDataRow {
  appId: string;
  partyUid: string;
  key: string;
  ownerGhii: string;
  value: unknown;
  bytes: number;
  version: number;
  updatedAt: string;
}

/** The party uid of the collections an app shares to every party of it. */
export const APP_PARTY_SHARED = '_shared';

/** What the boot move did with one party: inserted, already there under its uid, or refused. */
export type AppPartyImportResult = 'inserted' | 'present' | 'conflict';

export interface AppPartyRepository {
  /**
   * Insert one party when the app holds fewer than `cap` live parties, in one transaction: the
   * address's row is looked up first (outcome exists), the live count is taken under the rule, and
   * only then are the stale rows removed and the new row written. Two signups at once cannot both
   * take the last place.
   */
  insertAppPartyCapped(row: AppPartyRow, cap: number, rule: AppPartyLiveRule): Promise<AppPartyInsertResult>;
  getAppParty(appId: string, uid: string): Promise<AppPartyRow | null>;
  /** The party of the app with this e-mail hash, name or open link hash. Exactly one field is given. */
  findAppParty(appId: string, by: { emailHash?: string; name?: string; linkHash?: string }): Promise<AppPartyRow | null>;
  /** The app's parties, oldest first, `limit` (200 by default, at most 1000) from `offset`. */
  listAppParties(appId: string, opts?: { limit?: number; offset?: number }): Promise<AppPartyRow[]>;
  /** How many parties the app holds; with a rule, only the live ones. */
  countAppParties(appId: string, rule?: AppPartyLiveRule): Promise<number>;
  /** How many parties each app holds, by app id, in one statement; an app with none is absent. */
  countAppPartiesByApp(): Promise<Record<string, number>>;
  /** Replace the row on the version read. False when another writer changed it first. */
  updateAppParty(row: AppPartyRow, expectedVersion: number): Promise<boolean>;
  /** Remove one party and every collection it keeps: whether there was one, and how many collections went. */
  deleteAppParty(appId: string, uid: string): Promise<{ removed: boolean; data: number }>;
  /** Remove every party of an app and every collection kept in it (the shared ones too). */
  deleteAppPartiesByApp(appId: string): Promise<{ parties: AppPartyRow[]; data: number }>;
  /** Remove every row of both tables this owner holds (account erasure). The number of rows removed. */
  deleteAppPartiesByOwner(ownerGhii: string): Promise<number>;
  /** The boot move: insert a row by its uid, ignoring the cap; conflict when its address or name has another uid. */
  importAppParty(row: AppPartyRow): Promise<AppPartyImportResult>;

  getAppPartyData(appId: string, partyUid: string, key: string): Promise<AppPartyDataRow | null>;
  /**
   * Write one collection. A new key is written only while the party keeps fewer than `maxCollections`
   * (the count and the write in one transaction); stored is false when that limit is reached.
   */
  putAppPartyData(row: Omit<AppPartyDataRow, 'version'>, maxCollections: number): Promise<{ stored: boolean; version: number }>;
  deleteAppPartyData(appId: string, partyUid: string, key: string): Promise<boolean>;
}
