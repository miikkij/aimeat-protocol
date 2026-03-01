export interface OwnerRecord {
  name: string;
  displayName?: string;
  publicKey: string;   // base64 Ed25519 public key
  roles: string[];     // ['owner'] or ['owner', 'operator']
  createdAt: string;
}

export interface AgentRecord {
  name: string;
  owner: string;
  gaii: string;
  displayName?: string;
  description?: string;
  capabilities: string[];
  publicKey: string;
  trustScore: number;
  morselBalance: number;
  createdAt: string;
  lastSeen: string;
}

export interface MemoryRecord {
  key: string;
  ownerGaii: string;    // the agent GAII that owns this memory
  value: unknown;
  visibility: 'private' | 'owner' | 'public';
  tags: string[];
  ttlHours: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActionRecord {
  id: string;
  providerGaii: string;
  displayName: string;
  description: string;
  category?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  pricing: { baseMorsels: number; perUnit?: { unit: string; morselsPer1000: number } };
  estimatedTimeSeconds?: number;
  maxInputSizeBytes?: number;
  tags: string[];
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkRecord {
  trackingCode: string;
  status: string;
  actionId: string;
  providerGaii: string;
  requesterGaii: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  cost: { basePrice: number; networkFee: number; total: number; inEscrow: number };
  ttlExpiresAt: string;
  callbackUrl?: string;
  rating?: { score: number; comment?: string };
  createdAt: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  gaii: string;
  type: string;
  amount: number;
  counterpartyGaii?: string;
  trackingCode?: string;
  timestamp: string;
}

export interface BoardRecord {
  id: string;
  name: string;
  description?: string;
  visibility: 'private' | 'shared' | 'public';
  ownerGaii: string;
  allowedGaiis: string[];
  createdAt: string;
}

export interface BoardPostRecord {
  id: string;
  boardId: string;
  authorGaii: string;
  title: string;
  body: string;
  category?: string;
  tags: string[];
  ttlExpiresAt?: string;
  reactions: Record<string, string[]>; // emoji -> gaiis
  replyTo?: string;
  createdAt: string;
}

export interface OtkRecord {
  key: string;
  ownerGaii: string;
  action: string;         // 'write_memory' | 'post_board' | 'session' | 'initial'
  params: Record<string, unknown>;
  expiresAt: string;      // ISO timestamp; for initial OTKs, set to far-future until first use
  initial: boolean;       // true = timer starts on first use, not at creation
  used: boolean;
  usedAt: string | null;  // ISO timestamp of first use (grace window starts here)
  sessionId: string | null; // links OTKs to a session for inactivity timeout
  createdAt: string;
}

export interface DisputeRecord {
  id: string;
  trackingCode: string;
  status: 'open' | 'contested' | 'escalated' | 'resolved';
  openedBy: string;        // GAII
  reason: string;
  ruling?: { ruling: string; distribution: { toRequester: number; toProvider: number; burned: number }; reason?: string };
  createdAt: string;
  updatedAt: string;
}

export interface DisputeAuditEntry {
  sequence: number;
  event: string;
  actor: string;
  timestamp: string;
  data: Record<string, unknown>;
  hash: string;
  previousHash: string;
}

export interface MicroMemoryRecord {
  gaii: string;
  set: string;
  entries: Record<string, string>;
  visibility: 'private' | 'public_read' | 'shared_read' | 'shared_write' | 'public_write';
  accessCode?: string;    // required for shared_read / shared_write
  updatedAt: string;
}

export interface StorageFileRecord {
  key: string;
  ownerGaii: string;
  visibility: 'private' | 'owner' | 'public';
  mimeType: string;
  size: number;
  data: Buffer;
  accessCode?: string;
  createdAt: string;
}

export interface PeeringRequestRecord {
  id: string;
  fromNodeUrl: string;
  fromNodeId?: string;
  toNodeId?: string;
  targetUrl?: string;
  publicKey?: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  createdAt: string;
  updatedAt: string;
}

export interface ChunkedUploadRecord {
  uploadId: string;
  ownerGaii: string;
  key: string;
  mimeType: string;
  visibility: 'private' | 'owner' | 'public';
  chunkSize: number;
  totalChunks?: number;
  receivedChunks: Map<number, Buffer>;
  createdAt: string;
  expiresAt: string;   // 6 hours after creation
}

export interface BoardSubscriptionRecord {
  id: string;
  boardId: string;
  gaii: string;
  callbackUrl?: string;
  filters?: { categories?: string[]; tags?: string[] };
  createdAt: string;
}

export interface GHIIRecord {
  username: string;               // e.g. "alice"
  nodeId: string;                 // home node ID
  ghii: string;                   // full identifier: "alice@node-id"
  displayName: string;
  bio?: string;
  avatar?: string;                // emoji or storage key
  locale?: string;                // preferred language
  passwordHash?: string;          // scrypt hash for cross-device login
  verificationLevel: 0 | 1 | 2;  // basic / confirmed / strong
  ownerName: string;              // links to OwnerRecord.name
  createdAt: string;
  updatedAt: string;
}

export interface PersonalNodeRecord {
  nodeId: string;               // e.g. "personal-jouni-001"
  ownerName: string;            // links to OwnerRecord
  anchorNodeId: string;         // the operator node hosting this personal node
  publicKey: string;            // Ed25519 public key for tunnel auth
  status: 'online' | 'offline' | 'degraded' | 'detached';
  agentGaiis: string[];         // agents hosted on this personal node
  lastSeen: string;             // ISO timestamp
  mailboxQuotaBytes: number;    // allocated quota
  mailboxUsedBytes: number;     // current usage
  visibility: 'private' | 'public';  // federation directory visibility
  createdAt: string;
  updatedAt: string;
}

export interface MailboxItemRecord {
  id: string;                   // unique message ID
  personalNodeId: string;       // target personal node
  type: 'action_request' | 'work_assignment' | 'board_notification' | 'federation_sync';
  fromGaii: string;             // sender GAII
  toGaii: string;               // target GAII on the personal node
  payload: string;              // encrypted JSON string
  sizeBytes: number;
  retentionDays: number;        // 7 for action/work, 3 for board, 7 for federation
  expiresAt: string;            // ISO timestamp
  createdAt: string;
}

export interface MaintenanceState {
  enabled: boolean;
  message: string;
  enabledAt: string | null;
  enabledBy: string | null;
}

export interface Storage {
  // Owners
  createOwner(owner: OwnerRecord): Promise<OwnerRecord>;
  getOwner(name: string): Promise<OwnerRecord | null>;
  listOwners(): Promise<OwnerRecord[]>;
  updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null>;
  deleteOwner(name: string): Promise<boolean>;

  // Agents
  createAgent(agent: AgentRecord): Promise<AgentRecord>;
  getAgent(gaii: string): Promise<AgentRecord | null>;
  getAgentsByOwner(owner: string): Promise<AgentRecord[]>;
  updateAgent(gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null>;
  deleteAgent(gaii: string): Promise<boolean>;
  listAgents(): Promise<AgentRecord[]>;

  // Memory
  setMemory(record: MemoryRecord): Promise<MemoryRecord>;
  getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null>;
  listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[] }): Promise<MemoryRecord[]>;
  deleteMemory(ownerGaii: string, key: string): Promise<boolean>;
  deleteAllMemory(ownerGaii: string): Promise<number>;

  // Actions
  createAction(action: ActionRecord): Promise<ActionRecord>;
  getAction(id: string, providerGaii: string): Promise<ActionRecord | null>;
  listActions(opts?: { search?: string; category?: string }): Promise<ActionRecord[]>;
  deleteAction(id: string, providerGaii: string): Promise<boolean>;
  deleteActionsByProvider(gaii: string): Promise<number>;
  listActionsByProvider(gaii: string): Promise<ActionRecord[]>;

  // Work
  createWork(work: WorkRecord): Promise<WorkRecord>;
  getWork(trackingCode: string): Promise<WorkRecord | null>;
  updateWork(trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null>;
  listWorkByProvider(gaii: string): Promise<WorkRecord[]>;
  listWorkByRequester(gaii: string): Promise<WorkRecord[]>;
  listAllWork(): Promise<WorkRecord[]>;

  // Transactions
  addTransaction(tx: WalletTransaction): Promise<WalletTransaction>;
  getTransactions(gaii: string, limit?: number): Promise<WalletTransaction[]>;
  listAllTransactions(): Promise<WalletTransaction[]>;
  deleteTransactions(gaii: string): Promise<number>;

  // Boards
  createBoard(board: BoardRecord): Promise<BoardRecord>;
  getBoard(id: string): Promise<BoardRecord | null>;
  listBoards(opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]>;
  deleteBoard(id: string): Promise<boolean>;
  createPost(post: BoardPostRecord): Promise<BoardPostRecord>;
  getPost(boardId: string, postId: string): Promise<BoardPostRecord | null>;
  listPosts(boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]>;
  deletePost(boardId: string, postId: string): Promise<boolean>;
  addReaction(boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean>;

  // Board Subscriptions
  createBoardSubscription(sub: BoardSubscriptionRecord): Promise<BoardSubscriptionRecord>;
  getBoardSubscription(boardId: string, gaii: string): Promise<BoardSubscriptionRecord | null>;
  listBoardSubscriptions(boardId: string): Promise<BoardSubscriptionRecord[]>;
  listSubscriptionsByAgent(gaii: string): Promise<BoardSubscriptionRecord[]>;
  deleteBoardSubscription(boardId: string, gaii: string): Promise<boolean>;

  // OTK (One-Time Keys)
  createOtk(otk: OtkRecord): Promise<OtkRecord>;
  getOtk(key: string): Promise<OtkRecord | null>;
  consumeOtk(key: string, graceMs?: number): Promise<OtkRecord | null>;
  listOtksBySession(sessionId: string): Promise<OtkRecord[]>;
  expireSessionOtks(sessionId: string): Promise<number>;

  // Disputes
  createDispute(dispute: DisputeRecord): Promise<DisputeRecord>;
  getDispute(id: string): Promise<DisputeRecord | null>;
  getDisputeByTrackingCode(tc: string): Promise<DisputeRecord | null>;
  updateDispute(id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null>;
  addDisputeAuditEntry(disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry>;
  getDisputeAuditLog(disputeId: string): Promise<DisputeAuditEntry[]>;
  listDisputesByProvider(gaii: string): Promise<DisputeRecord[]>;
  listAllDisputes(): Promise<DisputeRecord[]>;

  // Micro-Memory
  setMicroMemory(record: MicroMemoryRecord): Promise<MicroMemoryRecord>;
  getMicroMemory(gaii: string, set: string): Promise<MicroMemoryRecord | null>;
  listMicroMemorySets(gaii: string): Promise<MicroMemoryRecord[]>;
  deleteMicroMemory(gaii: string, set: string): Promise<boolean>;
  deleteMicroMemoryEntry(gaii: string, set: string, key: string): Promise<boolean>;
  findMicroMemoryByAccessCode(set: string, accessCode: string): Promise<MicroMemoryRecord | null>;

  // Storage (binary files)
  createStorageFile(file: StorageFileRecord): Promise<StorageFileRecord>;
  getStorageFile(ownerGaii: string, key: string): Promise<StorageFileRecord | null>;
  listStorageFiles(ownerGaii: string): Promise<StorageFileRecord[]>;
  deleteStorageFile(ownerGaii: string, key: string): Promise<boolean>;

  // Peering requests
  createPeeringRequest(req: PeeringRequestRecord): Promise<PeeringRequestRecord>;
  getPeeringRequest(id: string): Promise<PeeringRequestRecord | null>;
  listPeeringRequests(status?: string): Promise<PeeringRequestRecord[]>;
  updatePeeringRequest(id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null>;

  // Memory search
  searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string }): Promise<MemoryRecord[]>;

  // Action update
  updateAction(id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null>;

  // Chunked uploads
  createChunkedUpload(record: ChunkedUploadRecord): Promise<ChunkedUploadRecord>;
  getChunkedUpload(uploadId: string): Promise<ChunkedUploadRecord | null>;
  addChunk(uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean>;
  deleteChunkedUpload(uploadId: string): Promise<boolean>;

  // Node key
  setNodeKey(publicKey: string, privateKey: string): Promise<void>;
  getNodeKey(): Promise<{ publicKey: string; privateKey: string } | null>;

  // GHII (human identity)
  createGHII(record: GHIIRecord): Promise<GHIIRecord>;
  getGHII(ghii: string): Promise<GHIIRecord | null>;
  getGHIIByOwner(ownerName: string): Promise<GHIIRecord | null>;
  updateGHII(ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null>;
  listGHIIs(opts?: { q?: string; level?: number }): Promise<GHIIRecord[]>;
  deleteGHII(ghii: string): Promise<boolean>;

  // Personal Nodes
  createPersonalNode(node: PersonalNodeRecord): Promise<PersonalNodeRecord>;
  getPersonalNode(nodeId: string): Promise<PersonalNodeRecord | null>;
  getPersonalNodeByOwner(ownerName: string): Promise<PersonalNodeRecord | null>;
  listPersonalNodes(opts?: { status?: string }): Promise<PersonalNodeRecord[]>;
  updatePersonalNode(nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null>;
  deletePersonalNode(nodeId: string): Promise<boolean>;

  // Mailbox (for offline personal nodes)
  createMailboxItem(item: MailboxItemRecord): Promise<MailboxItemRecord>;
  getMailboxItem(id: string): Promise<MailboxItemRecord | null>;
  listMailboxItems(personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]>;
  deleteMailboxItem(id: string): Promise<boolean>;
  deleteMailboxItemsByNode(personalNodeId: string): Promise<number>;
  getMailboxStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }>;
  cleanExpiredMailboxItems(): Promise<number>;

  // Maintenance mode
  getMaintenanceMode(): Promise<MaintenanceState>;
  setMaintenanceMode(state: MaintenanceState): Promise<MaintenanceState>;
}
