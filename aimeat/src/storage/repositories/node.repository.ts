/**
 * @file src/storage/repositories/node.repository.ts
 * @description Storage-backend-agnostic interface for node-level state: node keypair, maintenance
 *   mode, push subscriptions, trusted issuers, verification nonces, realtime rooms, site change log,
 *   extensions, escrow holds, and cortex extensions/lib files. Implemented per backend.
 *
 * @structure
 *   - NodeRepository: node key + maintenance getters/setters
 *   - push/trusted-issuer/verification-nonce CRUD; realtime room + site-change-log ops
 *   - extension, escrow-hold, and cortex-extension/lib-file CRUD
 *
 * @version-history
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
  EscrowHoldRecord,
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
  getTrustedIssuer(id: string): Promise<TrustedIssuerRecord | null>;
  getTrustedIssuerByUrl(url: string): Promise<TrustedIssuerRecord | null>;
  listTrustedIssuers(opts?: { type?: string }): Promise<TrustedIssuerRecord[]>;
  deleteTrustedIssuer(id: string): Promise<boolean>;
  createVerificationNonce(record: VerificationNonceRecord): Promise<VerificationNonceRecord>;
  getVerificationNonce(state: string): Promise<VerificationNonceRecord | null>;
  deleteVerificationNonce(state: string): Promise<void>;
  cleanExpiredNonces(): Promise<number>;
  createRealtimeRoom(room: RealtimeRoomRecord): Promise<RealtimeRoomRecord>;
  getRealtimeRoom(id: string): Promise<RealtimeRoomRecord | null>;
  listRealtimeRooms(filter?: { appType?: string; isPublic?: boolean }): Promise<RealtimeRoomRecord[]>;
  updateRealtimeRoom(id: string, updates: Partial<RealtimeRoomRecord>): Promise<RealtimeRoomRecord | null>;
  deleteRealtimeRoom(id: string): Promise<boolean>;
  addSiteChangeLog(entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry>;
  listSiteChangeLog(limit: number, cursor?: string): Promise<SiteChangeLogEntry[]>;
  createExtension(record: ExtensionRecord): Promise<ExtensionRecord>;
  getExtension(name: string): Promise<ExtensionRecord | null>;
  listExtensions(opts?: { status?: string }): Promise<ExtensionRecord[]>;
  updateExtension(name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null>;
  deleteExtension(name: string): Promise<boolean>;
  createEscrowHold(record: EscrowHoldRecord): Promise<EscrowHoldRecord>;
  getEscrowHold(holdId: string): Promise<EscrowHoldRecord | null>;
  listEscrowHolds(fromGaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]>;
  releaseEscrowHold(holdId: string, toGaii: string): Promise<EscrowHoldRecord | null>;
  refundEscrowHold(holdId: string): Promise<EscrowHoldRecord | null>;
  createCortexExtension(record: CortexExtensionRecord): Promise<CortexExtensionRecord>;
  getCortexExtension(name: string): Promise<CortexExtensionRecord | null>;
  listCortexExtensions(opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]>;
  updateCortexExtension(name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null>;
  deleteCortexExtension(name: string): Promise<boolean>;
  setCortexLibFile(extName: string, libName: string, content: string): Promise<void>;
  getCortexLibFile(extName: string, libName: string): Promise<string | null>;
  deleteCortexLibFile(extName: string, libName: string): Promise<boolean>;
}
