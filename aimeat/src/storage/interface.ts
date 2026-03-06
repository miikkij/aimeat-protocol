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
  installedBy: string;
  installedAt: string;
  activatedAt?: string;
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
import type { AppRepository } from './repositories/app.repository.js';
import type { AppMarketplaceRepository } from './repositories/app-marketplace.repository.js';

export interface Storage extends
  OwnerRepository, AgentRepository, MemoryRepository,
  ActionRepository, WorkRepository, WalletRepository,
  BoardRepository, OtkRepository, DisputeRepository,
  MicroMemoryRepository, FileRepository, IdentityRepository,
  SchemaRepository, ConsentRepository, CatalogueRepository,
  ModerationRepository, OrganismRepository, MarketplaceRepository,
  FederationRepository, NodeRepository, NotificationRepository,
  AppRepository, AppMarketplaceRepository { }
