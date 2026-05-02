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
  createPushSubscription(record: PushSubscriptionRecord): Promise<PushSubscriptionRecord>;
  getPushSubscription(ownerName: string): Promise<PushSubscriptionRecord | null>;
  deletePushSubscription(ownerName: string): Promise<boolean>;
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
