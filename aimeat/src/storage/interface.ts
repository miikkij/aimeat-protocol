// Phase 0.7b — Semantic annotation for records (JSON-LD-compatible)
export interface SemanticAnnotation {
  '@context'?: Record<string, string>;
  '@type'?: string;
  [key: string]: unknown;
}

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
  semantic?: SemanticAnnotation;  // Phase 0.7b
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
  semantic?: SemanticAnnotation;  // Phase 0.7b
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
  visibility: 'private' | 'shared' | 'public' | 'system';
  ownerGaii: string;
  allowedGaiis: string[];
  createdAt: string;
  semantic?: SemanticAnnotation;  // Phase 0.7b
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
  semantic?: SemanticAnnotation;  // Phase 0.7b
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
  // TOTP 2FA (Phase 0.5)
  totpSecret?: string;          // AES-256-GCM encrypted TOTP secret (Base32)
  totpEnabled: boolean;         // Is TOTP activated (default: false)
  totpBackupCodes?: string[];   // SHA-256 hashed backup codes
  totpLastUsedAt?: string;      // Last used code timestamp (replay protection)
  totpLastUsedCode?: string;    // Last used code (replay protection)
  totpFailedAttempts?: number;  // Failed attempts (rate limiting)
  totpLockedUntil?: string;     // Locked until (rate limiting)
  semantic?: SemanticAnnotation;  // Phase 0.7b
  // Phase 1.3 — Web registration & email verification
  emailHash?: string;           // SHA-256 of verified email
  emailVerifiedAt?: string;     // ISO timestamp
  verificationMethod?: 'email' | 'phone' | 'operator' | 'eidas';
  magicLinkEnabled?: boolean;
  lastLoginAt?: string;
  loginCount?: number;
  // Phase 3.3 — EUDIW/VC identity verification
  verifiedAttributes?: string[];
  verificationIssuer?: string;
  verificationCredentialHash?: string;
  ftnVerified?: boolean;
  // Economy (documented in GHII plan, now implemented)
  trustScore?: number;              // Aggregate trust score (0-100)
  morselBalance?: number;           // Morsel wallet balance
}

export interface ChatInstanceRecord {
  id: string;              // Full identifier: "claude-myapp#jouni@node" or "anon-claude-1709337600#anonymous@node"
  platform: string;        // "claude" | "chatgpt" | "grok" | "copilot" | "gemini" | ...
  appName: string;         // App name or "anon-<timestamp>" for anonymous
  ownerName: string;       // "anonymous" or username
  ghii: string;            // Always set: "anonymous@node" or "username@node"
  nodeId: string;          // Node where this instance operates
  isAnonymous: boolean;    // true = anonymous session
  createdAt: string;       // ISO timestamp — session start
  lastSeen: string;        // ISO timestamp — last activity
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
  semantic?: SemanticAnnotation;  // Phase 0.7b
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

export interface ConsentRecord {
  id: string;                 // UUID
  ownerGaii: string;          // Data owner (consent grantor)
  dataPattern: string;        // Glob-pattern: "profile.*.interests", "iot.*"
  recipient: string;          // "*" | GAII | "organism.{id}"
  purpose: string;            // Free-form: "discovery", "marketplace", "research"
  scope: 'private' | 'dmz' | 'federation';  // DMZ zone
  expires: string | null;     // ISO 8601 or null (indefinite)
  status: 'active' | 'revoked' | 'expired';
  grantedAt: string;          // ISO timestamp
  revokedAt: string | null;   // ISO timestamp or null
  metadata?: Record<string, unknown>;  // Free-form metadata
}

export interface ConsentAuditEntry {
  id: string;                 // UUID
  consentId: string;          // References ConsentRecord.id
  ownerGaii: string;          // Whose data was accessed
  accessorGaii: string;       // Who accessed the data
  memoryKey: string;          // Which key was read
  action: 'read' | 'list' | 'search';  // What was done
  timestamp: string;          // ISO timestamp
  allowed: boolean;           // Did consent allow this?
}

export interface CsmRecord {
  name: string;                  // unique service name (e.g. "hobby-directory")
  definition: Record<string, unknown>;  // Full CsmDefinition as JSON
  jsonSchemaKey: string;         // schema locking key: "csm.{name}"
  serviceType: string;           // directory | marketplace | forum | etc.
  registeredBy: string;          // owner name who registered this CSM
  registeredAt: string;          // ISO timestamp
  updatedAt: string;             // ISO timestamp
  federate?: boolean;            // Phase 3.4 — auto-distribute to federation peers
}

// MSM — Machine Service Manifest (external API integrations)
export interface MsmRecord {
  name: string;                    // unique service name
  definition: Record<string, unknown>;  // Full MsmDefinition as JSON
  category: string;                // data | utility | image | communication | analytics | analysis
  authType: string;                // bearer | query_param | oauth2 | api_key | none
  actionsCount: number;            // number of actions defined
  registeredBy: string;            // owner name
  registeredAt: string;            // ISO timestamp
  updatedAt: string;               // ISO timestamp
  federate?: boolean;              // share across federation
}

export interface SemanticContext {
  '@context'?: Record<string, string>;
  '@type'?: string;
  properties?: Record<string, unknown>;
}

export interface SchemaRecord {
  keyPattern: string;         // memory key name or prefix
  applyTo: 'exact' | 'prefix'; // 'exact' = this key only, 'prefix' = this and all sub-keys
  schemaJson: Record<string, unknown>; // JSON Schema object
  schemaMode: 'open' | 'strict';      // open = additionalProperties: true, strict = false
  lockedBy: string;           // GAII or GHII that set the schema
  setAt: string;              // ISO timestamp
  updatedAt: string;          // ISO timestamp
  semanticContext?: SemanticContext;  // Phase 0.7 — optional JSON-LD-compatible semantic type
}

export interface EmailVerificationRecord {
  id: string;
  ownerName: string;
  emailHash: string;
  code: string;           // SHA-256 hash of 6-digit code
  purpose: 'registration' | 'login' | 'change';
  status: 'pending' | 'verified' | 'expired';
  attempts: number;
  expiresAt: string;
  createdAt: string;
  verifiedAt: string | null;
}

export interface FlagRecord {
  id: string;
  targetType: 'memory' | 'board_post' | 'action' | 'agent';
  targetId: string;
  flaggedBy: string;
  reason: 'unreliable' | 'inappropriate' | 'illegal' | 'spam' | 'other';
  description?: string;
  status: 'active' | 'dismissed' | 'actioned';
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface FlagSummary {
  targetType: string;
  targetId: string;
  totalFlags: number;
  byReason: Record<string, number>;
  latestFlag: string;
  hidden?: boolean;  // Phase 2.4 — auto-hide when flag count >= threshold
}

export interface MatchRecord {
  id: string;
  profileA: string;       // GHII of suggestion recipient
  profileB: string;       // GHII of matched profile
  score: number;          // 0.0-1.0
  breakdown: {
    sharedInterests: string[];
    distanceKm: number | null;
    activityDays: number;
    sharedInterestsScore: number;
    distanceScore: number;
    activityScore: number;
    compatibilityScore: number;
  };
  status: 'suggested' | 'notified' | 'accepted' | 'dismissed' | 'expired';
  notifiedAt: string | null;
  respondedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

// Phase 2.2 — Organisms (groups/communities)
export interface OrganismRecord {
  id: string;
  name: string;
  description: string;
  type: 'community' | 'team' | 'club' | 'cooperative' | 'project';
  location?: {
    city?: string;
    area?: string;
    country?: string;
    geo?: [number, number];
  };
  interests: string[];
  creatorGhii: string;
  admins: string[];
  members: string[];
  agentGaiis: string[];
  boardId: string;
  joinPolicy: 'open' | 'approval_required' | 'invite_only';
  maxMembers: number;
  visibility: 'public' | 'listed' | 'private';
  moderationConfig: {
    flagsEnabled: boolean;
    autoHideThreshold: number;
    appealsEnabled: boolean;
  };
  memoryNamespace: string;
  semantic?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OrganismMembershipRecord {
  id: string;
  organismId: string;
  ghii: string;
  role: 'creator' | 'admin' | 'member';
  status: 'active' | 'pending' | 'banned';
  joinedAt: string;
  invitedBy?: string;
}

export interface JoinRequestRecord {
  id: string;
  organismId: string;
  ghii: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  createdAt: string;
  reviewedAt?: string;
}

// Phase 2.6 — Marketplace
export interface ListingRecord {
  id: string;
  ownerName: string;        // Seller's owner name
  sellerGhii: string;       // Seller's GHII
  title: string;
  description: string;
  category: 'palvelut' | 'tuotteet' | 'data' | 'osaaminen' | 'muu';
  priceMorsels: number;
  condition?: 'new' | 'used' | 'digital';
  availability?: 'immediate' | 'on_request' | 'scheduled';
  location?: { city?: string; area?: string };
  tags?: string[];
  images?: string[];
  status: 'active' | 'sold' | 'expired' | 'hidden' | 'delisted';
  memoryKey: string;        // marketplace.{owner}.listing.{id}
  flagCount: number;
  createdAt: string;
  updatedAt: string;
  semantic?: Record<string, unknown>;
}

export interface PurchaseRecord {
  id: string;
  listingId: string;
  buyerOwner: string;
  sellerOwner: string;
  priceMorsels: number;
  transactionFeeMorsels: number;
  totalCostMorsels: number;
  status: 'pending_delivery' | 'delivered' | 'disputed' | 'completed' | 'cancelled';
  rating?: { score: number; comment?: string };
  trackingCode: string;
  createdAt: string;
  completedAt?: string;
}

// Phase 2.4 — Appeals (Advanced Moderation)
export interface AppealRecord {
  id: string;
  flagId: string;
  appealedBy: string;       // Content owner's GAII/GHII
  reason: string;
  status: 'pending' | 'upheld' | 'overturned';
  reviewedBy?: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

// Phase 3.1 — Push Subscriptions (PWA)
export interface PushSubscriptionRecord {
  ownerName: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: string;
  lastUsedAt: string;
}

// Phase 3.3 — Trusted Issuers
export interface TrustedIssuerRecord {
  id: string;
  name: string;
  url: string;
  publicKey: string;
  type: 'eudiw' | 'ftn' | 'w3c_vc' | 'custom';
  trusted: boolean;
  addedBy: string;
  createdAt: string;
}

// Phase 3.4 — Genesis Peering (Cross-Federation)
export interface GenesisPeerRecord {
  id: string;
  genesisNodeId: string;
  genesisUrl: string;
  publicKey: string;
  status: 'pending' | 'active' | 'suspended';
  lastSyncAt: string;
  catalogueHash: string;
  createdAt: string;
  updatedAt: string;
}

// Phase 3.4 — Organism Reputation
export interface OrganismReputationRecord {
  organismId: string;
  score: number;
  breakdown: {
    memberScore: number;
    activityScore: number;
    trustScore: number;
    ageScore: number;
    flagScore: number;
  };
  calculatedAt: string;
}

// Realtime P2P rooms
export interface RealtimeRoomRecord {
  id: string;
  appType: string;
  name: string;
  createdBy: string;
  maxPeers: number;
  isPublic: boolean;
  tags: string[];
  peerCount: number;
  createdAt: string;
  lastActivityAt: string;
}

// Node Portal (Site)
export interface SiteChangeLogEntry {
  id: string;
  action: 'template_upload' | 'template_delete' | 'import' | 'cache_invalidate';
  summary: string;
  changedBy: string;
  changedAt: string;
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
  getGHIIByEmailHash(emailHash: string): Promise<GHIIRecord | null>;
  listGHIIs(opts?: { q?: string; level?: number }): Promise<GHIIRecord[]>;
  deleteGHII(ghii: string): Promise<boolean>;

  // Chat Instances
  createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord>;
  getChatInstance(id: string): Promise<ChatInstanceRecord | null>;
  listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]>;
  updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null>;
  deleteChatInstance(id: string): Promise<boolean>;

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

  // Schema Locking (Phase 0.1)
  setSchema(record: SchemaRecord): Promise<SchemaRecord>;
  getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null>;
  deleteSchema(keyPattern: string): Promise<boolean>;
  listSchemas(prefix?: string): Promise<SchemaRecord[]>;
  findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null>;

  // Consent Layer (Phase 0.3)
  createConsent(record: ConsentRecord): Promise<ConsentRecord>;
  getConsent(id: string): Promise<ConsentRecord | null>;
  listConsents(ownerGaii: string, opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<ConsentRecord[]>;
  updateConsent(id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null>;
  deleteConsent(id: string): Promise<boolean>;
  findMatchingConsents(ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]>;

  // CSM — Community Service Manifest (Phase 0.2)
  createCsm(record: CsmRecord): Promise<CsmRecord>;
  getCsm(name: string): Promise<CsmRecord | null>;
  listCsms(opts?: { serviceType?: string }): Promise<CsmRecord[]>;
  updateCsm(name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null>;
  deleteCsm(name: string): Promise<boolean>;

  // MSM — Machine Service Manifest
  createMsm(record: MsmRecord): Promise<MsmRecord>;
  getMsm(name: string): Promise<MsmRecord | null>;
  listMsms(opts?: { category?: string }): Promise<MsmRecord[]>;
  updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null>;
  deleteMsm(name: string): Promise<boolean>;

  // Consent Audit (Phase 0.3)
  addConsentAuditEntry(entry: ConsentAuditEntry): Promise<ConsentAuditEntry>;
  listConsentAudit(ownerGaii: string, opts?: {
    days?: number;
    consentId?: string;
    accessorGaii?: string;
  }): Promise<ConsentAuditEntry[]>;

  // Email Verification (Phase 1.1)
  createEmailVerification(record: EmailVerificationRecord): Promise<EmailVerificationRecord>;
  getEmailVerification(id: string): Promise<EmailVerificationRecord | null>;
  getActiveEmailVerification(ownerName: string, purpose: string): Promise<EmailVerificationRecord | null>;
  updateEmailVerification(id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null>;
  deleteExpiredEmailVerifications(): Promise<number>;

  // Email Verification by Owner (Phase 1.6)
  getEmailVerificationsByOwner?(ownerName: string): Promise<EmailVerificationRecord[]>;

  // Flags (Phase 1.5)
  createFlag(record: FlagRecord): Promise<FlagRecord>;
  getFlag(id: string): Promise<FlagRecord | null>;
  getFlagsByTarget(targetType: string, targetId: string): Promise<FlagRecord[]>;
  getFlagByUser(targetType: string, targetId: string, flaggedBy: string): Promise<FlagRecord | null>;
  getFlagSummary(targetType: string, targetId: string): Promise<FlagSummary | null>;
  updateFlag(id: string, updates: Partial<FlagRecord>): Promise<FlagRecord | null>;
  listFlags(opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<FlagRecord[]>;

  // Matches (Phase 2.1)
  createMatch(record: MatchRecord): Promise<MatchRecord>;
  getMatch(id: string): Promise<MatchRecord | null>;
  getMatchByPair(profileA: string, profileB: string): Promise<MatchRecord | null>;
  listMatchesByProfile(profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<MatchRecord[]>;
  updateMatch(id: string, updates: Partial<MatchRecord>): Promise<MatchRecord | null>;
  deleteExpiredMatches(): Promise<number>;

  // Organisms (Phase 2.2)
  createOrganism(record: OrganismRecord): Promise<OrganismRecord>;
  getOrganism(id: string): Promise<OrganismRecord | null>;
  listOrganisms(opts?: { type?: string; city?: string; interest?: string; visibility?: string; page?: number; perPage?: number }): Promise<OrganismRecord[]>;
  updateOrganism(id: string, updates: Partial<OrganismRecord>): Promise<OrganismRecord | null>;
  deleteOrganism(id: string): Promise<boolean>;

  // Memberships (Phase 2.2)
  createMembership(record: OrganismMembershipRecord): Promise<OrganismMembershipRecord>;
  getMembership(organismId: string, ghii: string): Promise<OrganismMembershipRecord | null>;
  listMembers(organismId: string, opts?: { role?: string; status?: string }): Promise<OrganismMembershipRecord[]>;
  listMembershipsByGhii(ghii: string): Promise<OrganismMembershipRecord[]>;
  updateMembership(id: string, updates: Partial<OrganismMembershipRecord>): Promise<OrganismMembershipRecord | null>;
  deleteMembership(id: string): Promise<boolean>;

  // Join Requests (Phase 2.2)
  createJoinRequest(record: JoinRequestRecord): Promise<JoinRequestRecord>;
  getJoinRequest(id: string): Promise<JoinRequestRecord | null>;
  listJoinRequests(organismId: string, opts?: { status?: string }): Promise<JoinRequestRecord[]>;
  updateJoinRequest(id: string, updates: Partial<JoinRequestRecord>): Promise<JoinRequestRecord | null>;

  // Appeals (Phase 2.4)
  createAppeal(record: AppealRecord): Promise<AppealRecord>;
  getAppeal(id: string): Promise<AppealRecord | null>;
  getAppealByFlagId(flagId: string): Promise<AppealRecord | null>;
  listAppeals(opts?: { status?: string; page?: number; perPage?: number }): Promise<AppealRecord[]>;
  updateAppeal(id: string, updates: Partial<AppealRecord>): Promise<AppealRecord | null>;

  // Push Subscriptions (Phase 3.1)
  createPushSubscription(record: PushSubscriptionRecord): Promise<PushSubscriptionRecord>;
  getPushSubscription(ownerName: string): Promise<PushSubscriptionRecord | null>;
  deletePushSubscription(ownerName: string): Promise<boolean>;
  listPushSubscriptions(): Promise<PushSubscriptionRecord[]>;

  // Trusted Issuers (Phase 3.3)
  createTrustedIssuer(record: TrustedIssuerRecord): Promise<TrustedIssuerRecord>;
  getTrustedIssuer(id: string): Promise<TrustedIssuerRecord | null>;
  getTrustedIssuerByUrl(url: string): Promise<TrustedIssuerRecord | null>;
  listTrustedIssuers(opts?: { type?: string }): Promise<TrustedIssuerRecord[]>;
  deleteTrustedIssuer(id: string): Promise<boolean>;

  // Genesis Peers (Phase 3.4)
  createGenesisPeer(record: GenesisPeerRecord): Promise<GenesisPeerRecord>;
  getGenesisPeer(id: string): Promise<GenesisPeerRecord | null>;
  getGenesisPeerByNodeId(nodeId: string): Promise<GenesisPeerRecord | null>;
  listGenesisPeers(opts?: { status?: string }): Promise<GenesisPeerRecord[]>;
  updateGenesisPeer(id: string, updates: Partial<GenesisPeerRecord>): Promise<GenesisPeerRecord | null>;
  deleteGenesisPeer(id: string): Promise<boolean>;

  // Organism Reputation (Phase 3.4)
  setOrganismReputation(record: OrganismReputationRecord): Promise<OrganismReputationRecord>;
  getOrganismReputation(organismId: string): Promise<OrganismReputationRecord | null>;

  // Marketplace (Phase 2.6)
  createListing(record: ListingRecord): Promise<ListingRecord>;
  getListing(id: string): Promise<ListingRecord | null>;
  listListings(opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<ListingRecord[]>;
  updateListing(id: string, updates: Partial<ListingRecord>): Promise<ListingRecord | null>;
  deleteListing(id: string): Promise<boolean>;

  createPurchase(record: PurchaseRecord): Promise<PurchaseRecord>;
  getPurchase(id: string): Promise<PurchaseRecord | null>;
  listPurchasesByBuyer(buyerOwner: string): Promise<PurchaseRecord[]>;
  listPurchasesBySeller(sellerOwner: string): Promise<PurchaseRecord[]>;
  updatePurchase(id: string, updates: Partial<PurchaseRecord>): Promise<PurchaseRecord | null>;

  // Realtime Rooms (P2P)
  createRealtimeRoom(room: RealtimeRoomRecord): Promise<RealtimeRoomRecord>;
  getRealtimeRoom(id: string): Promise<RealtimeRoomRecord | null>;
  listRealtimeRooms(filter?: { appType?: string; isPublic?: boolean }): Promise<RealtimeRoomRecord[]>;
  updateRealtimeRoom(id: string, updates: Partial<RealtimeRoomRecord>): Promise<RealtimeRoomRecord | null>;
  deleteRealtimeRoom(id: string): Promise<boolean>;

  // Node Portal (Site)
  addSiteChangeLog(entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry>;
  listSiteChangeLog(limit: number, cursor?: string): Promise<SiteChangeLogEntry[]>;
}
