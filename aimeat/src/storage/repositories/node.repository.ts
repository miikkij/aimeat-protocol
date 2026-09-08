/**
 * @file src/storage/repositories/node.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-backend-agnostic interface for node-level state: node keypair, maintenance
 *   mode, push subscriptions, trusted issuers, verification nonces, realtime rooms, site change log,
 *   extensions, and cortex extensions/lib files. Implemented per backend.
 *
 * @structure
 *   - NodeRepository: node key + maintenance getters/setters
 *   - push CRUD, trusted-issuer create/list, verification-nonce CRUD; realtime room + site-change-log ops
 *   - extension and cortex-extension/lib-file CRUD
 *
 * @version-history
 *   v1.3.0 — 2026-09-09 — Generic escrow holds (create/get/list/release/refund), getTrustedIssuer,
 *     getTrustedIssuerByUrl, deleteTrustedIssuer and listRealtimeRooms deleted: no caller.
 *   v1.2.0 — 2026-08-17 — `lean` option on listExtensions (no scriptContent) and
 *     listCortexExtensions (no manifest / seed-data entries) for metadata-only readers.
 *   v1.1.0 — 2026-08-11 — Push subscriptions are per DEVICE (audit H-8): listPushSubscriptionsByOwner
 *     added, deletePushSubscription takes an optional endpoint.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type {
  MaintenanceState,
  PushSubscriptionRecord,
  TrustedIssuerRecord,
  VerificationNonceRecord,
  RealtimeRoomRecord,
  SiteChangeLogEntry,
  ExtensionRecord,
  CortexExtensionRecord,
} from '../interface.js';

export interface NodeRepository {
  setNodeKey(publicKey: string, privateKey: string): Promise<void>;
  getNodeKey(): Promise<{ publicKey: string; privateKey: string } | null>;
  getMaintenanceMode(): Promise<MaintenanceState>;
  setMaintenanceMode(state: MaintenanceState): Promise<MaintenanceState>;
  /**
   * Register one DEVICE. The identity of a push subscription is (ownerName, endpoint), so a second
   * browser arrives BESIDE the first instead of replacing it; the same endpoint twice refreshes its
   * keys and lastUsedAt. Keyed on ownerName alone until 2026-08-11, which meant whoever subscribed
   * last owned the person's whole notification stream (audit H-8).
   */
  createPushSubscription(record: PushSubscriptionRecord): Promise<PushSubscriptionRecord>;
  /** ONE of the owner's devices, the most recently used. Use listPushSubscriptionsByOwner to reach them all. */
  getPushSubscription(ownerName: string): Promise<PushSubscriptionRecord | null>;
  /** Every device this owner has registered, oldest first. This is what a notification fans out to. */
  listPushSubscriptionsByOwner(ownerName: string): Promise<PushSubscriptionRecord[]>;
  /** With `endpoint`, unregister that one device; without it, every device of the owner. */
  deletePushSubscription(ownerName: string, endpoint?: string): Promise<boolean>;
  listPushSubscriptions(): Promise<PushSubscriptionRecord[]>;
  createTrustedIssuer(record: TrustedIssuerRecord): Promise<TrustedIssuerRecord>;
  listTrustedIssuers(opts?: { type?: string }): Promise<TrustedIssuerRecord[]>;
  createVerificationNonce(record: VerificationNonceRecord): Promise<VerificationNonceRecord>;
  getVerificationNonce(state: string): Promise<VerificationNonceRecord | null>;
  deleteVerificationNonce(state: string): Promise<void>;
  cleanExpiredNonces(): Promise<number>;
  createRealtimeRoom(room: RealtimeRoomRecord): Promise<RealtimeRoomRecord>;
  getRealtimeRoom(id: string): Promise<RealtimeRoomRecord | null>;
  updateRealtimeRoom(id: string, updates: Partial<RealtimeRoomRecord>): Promise<RealtimeRoomRecord | null>;
  deleteRealtimeRoom(id: string): Promise<boolean>;
  addSiteChangeLog(entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry>;
  listSiteChangeLog(limit: number, cursor?: string): Promise<SiteChangeLogEntry[]>;
  createExtension(record: ExtensionRecord): Promise<ExtensionRecord>;
  getExtension(name: string): Promise<ExtensionRecord | null>;
  /**
   * `lean: true` returns every action with `scriptContent: ''` — for callers that read schemas and
   * metadata but never execute (the capability aggregator loaded every extension's full source on
   * each cron run; measured as part of a +203 MB/run native churn on production, 2026-08-17).
   * Postgres strips it IN SQL so the bytes never leave the database.
   */
  listExtensions(opts?: { status?: string; lean?: boolean }): Promise<ExtensionRecord[]>;
  updateExtension(name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null>;
  deleteExtension(name: string): Promise<boolean>;
  createCortexExtension(record: CortexExtensionRecord): Promise<CortexExtensionRecord>;
  getCortexExtension(name: string): Promise<CortexExtensionRecord | null>;
  /**
   * `lean: true` returns `manifest: ''` and every seed-data component with `entries: []` — the two
   * payloads a metadata reader (the capability aggregator) never touches. Lib exports, api_surface
   * and prompt content are kept. Postgres strips both IN SQL.
   */
  listCortexExtensions(opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string; lean?: boolean }): Promise<CortexExtensionRecord[]>;
  updateCortexExtension(name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null>;
  deleteCortexExtension(name: string): Promise<boolean>;
  setCortexLibFile(extName: string, libName: string, content: string): Promise<void>;
  getCortexLibFile(extName: string, libName: string): Promise<string | null>;
  deleteCortexLibFile(extName: string, libName: string): Promise<boolean>;
}
