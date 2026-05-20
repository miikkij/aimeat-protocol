import type { PeeringRequestRecord, PersonalNodeRecord, MailboxItemRecord, GenesisPeerRecord, FederationPeerRecord } from '../interface.js';

export interface FederationRepository {
  saveFederationPeer(peer: FederationPeerRecord): Promise<void>;
  listFederationPeers(): Promise<FederationPeerRecord[]>;
  deleteFederationPeer(nodeId: string): Promise<boolean>;
  createPeeringRequest(req: PeeringRequestRecord): Promise<PeeringRequestRecord>;
  getPeeringRequest(id: string): Promise<PeeringRequestRecord | null>;
  listPeeringRequests(status?: string): Promise<PeeringRequestRecord[]>;
  updatePeeringRequest(id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null>;
  createPersonalNode(node: PersonalNodeRecord): Promise<PersonalNodeRecord>;
  getPersonalNode(nodeId: string): Promise<PersonalNodeRecord | null>;
  getPersonalNodeByOwner(ownerName: string): Promise<PersonalNodeRecord | null>;
  listPersonalNodes(opts?: { status?: string }): Promise<PersonalNodeRecord[]>;
  updatePersonalNode(nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null>;
  deletePersonalNode(nodeId: string): Promise<boolean>;
  createMailboxItem(item: MailboxItemRecord): Promise<MailboxItemRecord>;
  getMailboxItem(id: string): Promise<MailboxItemRecord | null>;
  listMailboxItems(personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]>;
  deleteMailboxItem(id: string): Promise<boolean>;
  deleteMailboxItemsByNode(personalNodeId: string): Promise<number>;
  getMailboxStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }>;
  cleanExpiredMailboxItems(): Promise<number>;
  createGenesisPeer(record: GenesisPeerRecord): Promise<GenesisPeerRecord>;
  getGenesisPeer(id: string): Promise<GenesisPeerRecord | null>;
  getGenesisPeerByNodeId(nodeId: string): Promise<GenesisPeerRecord | null>;
  listGenesisPeers(opts?: { status?: string }): Promise<GenesisPeerRecord[]>;
  updateGenesisPeer(id: string, updates: Partial<GenesisPeerRecord>): Promise<GenesisPeerRecord | null>;
  deleteGenesisPeer(id: string): Promise<boolean>;
}
