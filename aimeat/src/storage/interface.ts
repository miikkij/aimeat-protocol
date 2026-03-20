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
  defaultScopes?: string[];      // REQ-006 — scopes assigned at registration
  allowedOrigins?: string[];     // CORS — per-agent origin restrictions (Phase 3)
  dailySpendLimit?: number | null;  // Per-agent daily spend cap (null = no limit)
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
  flagCount?: number;   // Phase 1.5 — moderation flag counter
  allowedOrigins?: string[];  // CORS — per-key origin restrictions (Phase 4)
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
  action: string;         // 'write_memory' | 'post_board' | 'session' | 'initial' | 'register_agent'
  params: Record<string, unknown>;
  expiresAt: string;      // ISO timestamp; for initial OTKs, set to far-future until first use
  initial: boolean;       // true = timer starts on first use, not at creation
  used: boolean;
  usedAt: string | null;  // ISO timestamp of first use (grace window starts here)
  sessionId: string | null; // links OTKs to a session for inactivity timeout
  createdAt: string;
}

export interface OAuthClientRecord {
  clientId: string;           // primary key
  clientSecret: string;       // stored hashed (SHA-256)
  clientName: string;
  redirectUris: string[];
  createdAt: string;
}

export interface OAuthRefreshTokenRecord {
  tokenHash: string;          // primary key — SHA-256 of the raw refresh token
  clientId: string;
  gaii: string;
  owner: string;
  roles: string[];
  createdAt: string;
}

export interface OAuthApprovalRecord {
  clientId: string;           // compound key: clientId + gaii
  gaii: string;
  owner: string;
  scope: string;              // e.g. 'aimeat:full'
  approvedAt: string;
}

export interface DeviceAuthorizationRecord {
  deviceCode: string;
  userCode: string;
  ownerName: string;
  agentName: string;
  displayName?: string;
  description?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  scopes?: string[];
  createdAt: string;
  expiresAt: string;
  lastPolledAt?: string;
  pollInterval: number;
  approvedBy?: string;
  agentCredentials?: {
    gaii: string;
    privateKey: string;
    publicKey: string;
    token?: string;
    expires_at?: string;
  };
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
  tags?: string[];
  createdAt: string;
}

export interface AppManifest {
  name: string;
  description: string;
  version: string;              // semver string (display-only)
  category: string;
  tags: string[];
  icon?: string;
  authorDisplay: string;
  usesCortex: string[];         // cortex extension names used
  priceMorsels?: number;        // 0 or absent = free
  licenseType?: 'single' | 'lifetime';
}

export interface AppRecord {
  ownerGaii: string;
  ownerName: string;
  filename: string;
  versionNumber: number;        // auto-incremented per filename+owner
  manifest: AppManifest;
  mimeType: string;
  size: number;
  data: Buffer;
  accessCode?: string;
  createdAt: string;
}

export interface AppListOptions {
  ownerGaii?: string;
  category?: string;
  q?: string;
  tag?: string;
  sort?: 'newest' | 'popular';
  limit?: number;
  offset?: number;
  freeOnly?: boolean;
}

// Phase E — App Marketplace purchase receipts (immutable, self-contained)
export interface AppPurchaseRecord {
  transactionId: string;          // "mktx_..."
  buyerGaii: string;
  buyerOwner: string;
  sellerGaii: string;
  sellerOwner: string;
  appFilename: string;
  appName: string;                // from manifest at purchase time
  appVersionNumber: number;
  licenseType: 'single' | 'lifetime';
  priceMorsels: number;
  transactionFeeMorsels: number;
  purchasedAt: string;            // ISO timestamp
  appContent: string;             // base64-encoded full app content
  appManifest: AppManifest;       // manifest snapshot at purchase time
  appScreenshot?: string;         // base64-encoded screenshot if any
  signature: string;              // Ed25519 signature over transaction fields
  nodeId: string;                 // originating node
  nodePublicKey: string;          // node public key for verification
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
  verificationLevel: 0 | 1 | 2 | 3;  // 0=none, 1=email, 2=eidas/ftn, 3=eudiw-wallet
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
  notificationEmail?: string;       // plaintext email for users who opt in to notifications
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
  // CORS — per-GHII origin restrictions (Phase 2)
  allowedOrigins?: string[];        // undefined = inherit from node default
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
  agentGaii?: string;      // Which agent is bound to this session (MCP sessions)
  mcpClientId?: string;    // OAuth client ID for audit trail (MCP sessions)
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

// ── Personal Push Subscriptions (REQ-007) ──────────────────

export interface PersonalPushSubscriptionRecord {
  id: string;
  personalNodeId: string;
  ownerName: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  failureCount: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface NotificationPreferences {
  personalNodeId: string;
  enabled: boolean;
  channels: ('web_push' | 'email')[];
  notifyTypes: string[];
  cooldownMinutes: number;
  quietHoursUtc: { start: string; end: string } | null;
  email: string | null;
  locale?: string;  // defaults to "en"
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
  semantic?: SemanticAnnotation;  // Phase 0.7 — JSON-LD-compatible semantic annotation from CSM service.semantic
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
  purpose: 'registration' | 'login' | 'change' | 'password_reset' | 'account_recovery' | 'email_verification';
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

// Phase 2.6 — Marketplace (DEPRECATED: listings now live in extension memory via marketplace-behaviors extension)
/** @deprecated Use marketplace-behaviors extension instead */
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

/** @deprecated Use marketplace-behaviors extension instead */
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

// Phase 3.2 — Notification Templates (editable, per-locale)
export interface NotificationTemplateRecord {
  id: string;              // "web_push_mailbox", "email_mailbox"
  locale: string;          // "en", "fi"
  fields: {
    title?: string;        // web push title (null for email)
    body: string;          // web push body or email body
    subject?: string;      // email subject (null for web push)
  };
  placeholders: string[];  // informational: ["{count}", "{type}", "{nodeId}", "{age}"]
  updatedAt: string;
  updatedBy: string;       // operator owner name
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

// Phase B.1 — Replication Queue (federation data sync)
export interface ReplicationQueueEntry {
  id: string;
  type: 'catalogue_sync' | 'memory_replicate' | 'trust_advisory';
  targetPeers: string[];    // peer IDs to send to
  payload: unknown;          // serialized sync payload
  createdAt: string;         // ISO timestamp
  attempts: number;
  lastAttemptAt: string | null;
  status: 'pending' | 'sent' | 'failed';
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
  action: 'template_upload' | 'template_delete' | 'import' | 'cache_invalidate' | 'app_publish' | 'app_update' | 'app_delete';
  summary: string;
  changedBy: string;
  changedAt: string;
}

// ── Node Extensions (V8 Isolates) ──────────────────────────────────

export interface ExtensionRecord {
  name: string;                        // Unique name: "marketplace-behaviors"
  version: string;
  description: string;
  author: string;
  status: 'inactive' | 'active';
  requiredApis: string[];              // ['wallet', 'memory', 'consent', 'trust']
  actions: Array<{
    id: string;
    method: string;
    path: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    scriptContent: string;
  }>;
  config: Record<string, unknown>;
  limits: {
    memoryMb: number;
    timeoutMs: number;
    maxApiCalls: number;
  };
  federation: {
    advertise: boolean;
    capabilities: string[];
  };
  instances?: {
    supported: boolean;
    configSchema?: Record<string, unknown>;  // JSON Schema for per-instance config
  };
  installedBy: string;
  installedAt: string;
  activatedAt?: string;
}

// ── Scheduled Jobs ────────────────────────────────────────────────

export interface ScheduledJobRecord {
  id: string;
  name: string;
  type: 'extension' | 'core';
  extensionName?: string;
  instanceId?: string;
  actionId?: string;
  coreHandler?: string;
  cron: string;
  enabled: boolean;
  input?: Record<string, unknown>;
  lastRunAt?: string;
  lastRunResult?: 'success' | 'error';
  lastRunError?: string;
  lastRunDurationMs?: number;
  nextRunAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Execution Log (Scheduler Run History) ────────────────────────────

export interface ExecutionLogEntry {
  id: string;
  jobId: string;
  jobName: string;
  type: 'extension' | 'core';
  extensionName?: string;
  actionId?: string;
  trigger: 'cron' | 'manual' | 'activate';
  result: 'success' | 'error' | 'skipped';
  errorMessage?: string;
  durationMs: number;
  memoryReads: string[];   // memory keys read during execution
  memoryWrites: string[];  // memory keys written during execution
  createdAt: string;
}

// ── Extension Instances ──────────────────────────────────────────────

export interface ExtensionInstanceRecord {
  id: string;
  extensionName: string;
  config: Record<string, unknown>;
  status: 'active' | 'paused';
  /** Per-locale translation overrides: { "en": { "mkt.cat.foo": "Foo" }, "fi": { ... } } */
  translations?: Record<string, Record<string, string>>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Generic Escrow ─────────────────────────────────────────────────

export interface EscrowHoldRecord {
  holdId: string;
  fromGaii: string;
  amount: number;
  reason: string;
  status: 'held' | 'released' | 'disputed' | 'refunded';
  extensionName: string;
  createdAt: string;
  releasedAt?: string;
  releasedTo?: string;
}

// ── Cortex Extensions (Manifest-based) ────────────────────────────

export interface CortexSchemaComponent {
  type: 'schema';
  name: string;
  key_pattern: string;
  apply_to: 'prefix' | 'exact';
  schema: Record<string, unknown>;
}

export interface CortexPromptComponent {
  type: 'prompt';
  name: string;
  content: string;
  variables?: string[];
}

export interface CortexActionComponent {
  type: 'action';
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CortexBoardTemplateComponent {
  type: 'board-template';
  name: string;
  title: string;
  description: string;
  visibility: 'public' | 'private' | 'shared';
  seed_posts?: Array<{ title: string; body: string }>;
}

export interface CortexOntologyComponent {
  type: 'ontology';
  name: string;
  description: string;
  concepts: Record<string, {
    label: Record<string, string>;
    properties?: string[];
    broader?: string;
    related_to?: string;
    values?: string[];
  }>;
}

export interface CortexSeedDataComponent {
  type: 'seed-data';
  entries: Array<{ key: string; value: unknown }>;
}

export interface CortexLibComponent {
  type: 'lib';
  name: string;
  filename: string;
  exports: string[];
  api_surface: string;
}

export type CortexComponent =
  | CortexSchemaComponent
  | CortexPromptComponent
  | CortexActionComponent
  | CortexBoardTemplateComponent
  | CortexOntologyComponent
  | CortexSeedDataComponent
  | CortexLibComponent;

export interface CortexActivationArtifacts {
  schemaKeys: string[];
  promptKeys: string[];
  actionIds: string[];
  boardIds: string[];
  seedDataKeys: string[];
  ontologyKeys: string[];
  libFiles: string[];
}

export interface CortexExtensionRecord {
  name: string;
  namespace: string;
  shortName: string;
  apiVersion: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  tags: string[];
  labels: Record<string, string>;
  aimeatCompat?: string;
  status: 'inactive' | 'active';
  visibility: 'private' | 'public';
  installedAt: string;
  activatedAt?: string;
  installedBy: string;
  manifest: string;  // raw YAML string
  components: CortexComponent[];
  activationArtifacts: CortexActivationArtifacts;
}

// ── Knowledge System types ──────────────────────────────────────────

export type KnowledgeContentType =
  | 'idea' | 'research' | 'plan' | 'dataset' | 'document'
  | 'tutorial' | 'collection' | 'article' | 'story' | 'fiction';

export type KnowledgeSynthesisLevel = 'original' | 'assisted' | 'synthesized' | 'ai-generated';
export type KnowledgeMaturity = 'draft' | 'review' | 'published';
export type KnowledgeLinkRelation = 'related-to' | 'extends' | 'derived-from' | 'contradicts' | 'supersedes' | 'references';

export interface KnowledgeReference {
  url: string;
  title: string;
  accessed: string;           // ISO 8601
  verified: boolean;
  note?: string;
}

export interface KnowledgeEntryRelation {
  key: string;                              // Target entry key within same package
  relation: KnowledgeLinkRelation;          // How entries relate
}

export interface KnowledgeEntryDescriptor {
  key: string;
  title: string;
  visibility: 'private' | 'owner' | 'public';
  schema?: string;
  references?: KnowledgeReference[];        // Per-entry citations (independent knowledge unit)
  related_entries?: KnowledgeEntryRelation[]; // Intra-package relationships
}

export interface KnowledgeLink {
  target: string;
  relation: KnowledgeLinkRelation;
  description: string;
  linked_at: string;          // ISO 8601
}

export interface KnowledgeSynthesis {
  level: KnowledgeSynthesisLevel;
  description: string;
  model?: string;
}

export interface KnowledgeSharing {
  catalog_listed: boolean;
  allow_clone: boolean;
  license?: string;
  morsel_price: number;       // 0 = free
}

export interface KnowledgeManifest {
  type: 'knowledge-package';
  name: string;
  version: string;
  author: string;             // GHII of the package creator
  created: string;            // ISO 8601
  updated: string;            // ISO 8601
  content_type: KnowledgeContentType;
  tags: string[];
  language: string;           // ISO 639-1
  maturity: KnowledgeMaturity;
  synthesis: KnowledgeSynthesis;
  references: KnowledgeReference[];
  entries: KnowledgeEntryDescriptor[];
  links: KnowledgeLink[];
  sharing: KnowledgeSharing;
}

export interface MemoryLinkRecord {
  source: string;             // Source memory key
  target: string;             // Target memory key
  relation: KnowledgeLinkRelation;
  description: string;
  linked_at: string;          // ISO 8601
  linked_by: string;          // GHII of who created the link
}

export type OperatorReviewReason =
  | 'routine_review' | 'legal_compliance' | 'community_report'
  | 'content_quality' | 'storage_issue' | 'custom';

export type OperatorReviewAction = 'approve' | 'flag' | 'delist' | 'restrict' | 'note';

export interface OperatorReviewRecord {
  id: string;                 // UUID
  packageId: string;          // The packages/{uuid}/manifest key
  operatorGaii: string;       // Operator who reviewed
  reason: OperatorReviewReason;
  customText?: string;        // For 'custom' reason
  action: OperatorReviewAction;
  timestamp: string;          // ISO 8601
}

// ── System Prompts ──────────────────────────────────────────────────

export interface SystemPromptRecord {
  id: string;
  group: string;
  name: string;
  description: string;
  content: string;
  locales?: Record<string, string>;
  active: boolean;
  variables: string[];
  usedIn: string[];
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface SystemPromptVersionRecord {
  promptId: string;
  version: number;
  content: string;
  locales?: Record<string, string>;
  changedBy: string;
  changedAt: string;
  changeNote?: string;
}

// ── Packages & Templates ────────────────────────────────────────────

/** Shared type alias for all AIMEAT component types that can be included in a package. */
export type PackageComponentType = 'csm' | 'extension' | 'cortex' | 'app' | 'msm' | 'memory' | 'translation';

/** A single component within a package version. */
export interface PackageComponent {
  id: string;                      // "csm-signage", "app-kiosk", "cortex-signage"
  type: PackageComponentType;
  label: string;                   // human-readable "Kiosk Display App"
  content: string;                 // raw content (YAML, JS, HTML, JSON)
  contentHash: string;             // SHA-256 of content (for change detection)
  dependencies: string[];          // references to other component IDs ["csm-signage"]
}

/**
 * One record per package version. All versions of the same package share a packageGroupId.
 * Version format: v{YYYY}-{MM}-{DD}-{HHmm} — e.g. v2026-03-15-1701
 */
export interface PackageRecord {
  id: string;                      // UUID — unique per version
  packageGroupId: string;          // "{name}::{author}" — groups all versions
  name: string;                    // "digital-signage" (unique per author)
  author: string;                  // owner name or "operator"
  authorGhii: string;             // creator's GHII

  version: string;                 // "v2026-03-15-1701" (date-time sortable)
  changelog: string;               // what changed from previous version

  description: string;             // short description
  category: string;                // "signage" | "marketplace" | "iot" | "social" | "productivity" | "communication" | "other"
  tags: string[];                  // free-form tags for search
  visibility: 'private' | 'public';
  status: 'draft' | 'published' | 'archived';

  components: PackageComponent[];  // all components in this version
  manifest: string;                // full package YAML manifest (human-readable)

  createdAt: string;               // ISO 8601
  updatedAt: string;               // ISO 8601 — updated when metadata changes
}

export interface PackageFilter {
  author?: string;
  category?: string;
  status?: string;
  visibility?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Social/discovery layer. One record per package group (not per version). */
export interface TemplateListingRecord {
  id: string;                      // UUID
  packageGroupId: string;          // links to PackageRecord group
  packageName: string;             // denormalized for queries
  packageAuthor: string;           // denormalized

  publishedBy: string;             // who created the listing
  publishedByGhii: string;        // publisher's GHII

  title: string;                   // display name
  description: string;             // longer markdown description
  screenshots: string[];           // base64 data URIs or relative URLs
  category: string;                // gallery category
  tags: string[];                  // gallery tags

  featured: boolean;               // operator-promoted
  installCount: number;            // incremented on each install
  rating: number;                  // average 0.0–5.0 (denormalized)
  reviewCount: number;             // denormalized count

  status: 'listed' | 'unlisted' | 'moderated' | 'pending_review' | 'rejected' | 'suspended';
  createdAt: string;
  updatedAt: string;

  // Moderation fields
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComment?: string;
  proposedAt?: string;
  proposedBy?: string;
}

export interface TemplateReview {
  id: string;                      // UUID
  listingId: string;               // FK to TemplateListingRecord.id
  authorGhii: string;             // reviewer's GHII
  authorName: string;              // display name
  rating: number;                  // 1–5
  comment: string;                 // review text
  createdAt: string;
}

export interface TemplateDiscussion {
  id: string;                      // UUID
  listingId: string;               // FK to TemplateListingRecord.id
  authorGhii: string;
  authorName: string;
  message: string;                 // discussion message
  parentId?: string;               // for threading (reply to another message)
  createdAt: string;
}

export interface TemplateFilter {
  category?: string;
  tags?: string[];
  featured?: boolean;
  status?: string;
  sort?: 'rating' | 'installs' | 'newest';
  search?: string;
  limit?: number;
  offset?: number;
}

/** Tracks an installed copy of a package. */
export interface PackageInstanceRecord {
  id: string;                      // UUID
  packageGroupId: string;          // which package group
  packageVersion: string;          // which version was installed
  packageRecordId: string;         // direct reference to the PackageRecord.id

  owner: string;                   // who installed it
  ownerGhii: string;              // installer's GHII

  label: string;                   // user's name for this instance

  installedComponents: InstalledComponent[];

  status: 'active' | 'paused' | 'removed';
  installedAt: string;
  updatedAt: string;
}

export interface InstalledComponent {
  componentId: string;             // original ID from package "app-kiosk"
  type: PackageComponentType;
  registeredAs: string;            // actual name in system "signage-user1-app-kiosk"
  originalHash: string;            // SHA-256 at install time (for customization detection)
  customized: boolean;             // true if current hash differs from originalHash
  customizedAt?: string;           // when first customization was detected
}

export interface InstanceFilter {
  owner?: string;
  ownerGhii?: string;
  packageGroupId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// ── Domain Repository Interfaces ────────────────────────────────────
import type { OwnerRepository } from './repositories/owner.repository.js';
import type { AgentRepository } from './repositories/agent.repository.js';
import type { MemoryRepository } from './repositories/memory.repository.js';
import type { ActionRepository } from './repositories/action.repository.js';
import type { WorkRepository } from './repositories/work.repository.js';
import type { WalletRepository } from './repositories/wallet.repository.js';
import type { BoardRepository } from './repositories/board.repository.js';
import type { OtkRepository } from './repositories/otk.repository.js';
import type { DisputeRepository } from './repositories/dispute.repository.js';
import type { MicroMemoryRepository } from './repositories/micro-memory.repository.js';
import type { FileRepository } from './repositories/file.repository.js';
import type { IdentityRepository } from './repositories/identity.repository.js';
import type { SchemaRepository } from './repositories/schema.repository.js';
import type { ConsentRepository } from './repositories/consent.repository.js';
import type { CatalogueRepository } from './repositories/catalogue.repository.js';
import type { ModerationRepository } from './repositories/moderation.repository.js';
import type { OrganismRepository } from './repositories/organism.repository.js';
import type { MarketplaceRepository } from './repositories/marketplace.repository.js';
import type { FederationRepository } from './repositories/federation.repository.js';
import type { NodeRepository } from './repositories/node.repository.js';
import type { NotificationRepository } from './repositories/notification.repository.js';
import type { AuthRepository } from './repositories/auth.repository.js';
import type { SessionRepository } from './repositories/session.repository.js';
import type { AppRepository } from './repositories/app.repository.js';
import type { AppMarketplaceRepository } from './repositories/app-marketplace.repository.js';
import type { ConfigRepository } from './repositories/config.repository.js';
import type { NotificationTemplateRepository } from './repositories/notification-template.repository.js';
import type { KnowledgeRepository } from './repositories/knowledge.repository.js';
import type { SchedulerRepository } from './repositories/scheduler.repository.js';
import type { ExtensionInstanceRepository } from './repositories/extension-instance.repository.js';
import type { ReplicationQueueRepository } from './repositories/replication-queue.repository.js';
import type { DeviceAuthRepository } from './repositories/device-auth.repository.js';
import type { OAuthRepository } from './repositories/oauth.repository.js';
import type { SystemPromptRepository } from './repositories/system-prompt.repository.js';
import type { PackageRepository } from './repositories/package.repository.js';
import type { TemplateListingRepository } from './repositories/template-listing.repository.js';
import type { PackageInstanceRepository } from './repositories/package-instance.repository.js';

export interface Storage extends
  OwnerRepository, AgentRepository, MemoryRepository,
  ActionRepository, WorkRepository, WalletRepository,
  BoardRepository, OtkRepository, DisputeRepository,
  MicroMemoryRepository, FileRepository, IdentityRepository,
  SchemaRepository, ConsentRepository, CatalogueRepository,
  ModerationRepository, OrganismRepository, MarketplaceRepository,
  FederationRepository, NodeRepository, NotificationRepository,
  AuthRepository, SessionRepository,
  AppRepository, AppMarketplaceRepository, ConfigRepository,
  NotificationTemplateRepository,
  KnowledgeRepository, SchedulerRepository,
  ExtensionInstanceRepository, ReplicationQueueRepository,
  DeviceAuthRepository,
  OAuthRepository, SystemPromptRepository,
  PackageRepository, TemplateListingRepository, PackageInstanceRepository { }
