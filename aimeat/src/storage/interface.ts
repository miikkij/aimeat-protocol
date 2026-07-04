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
  dailySpendLimit?: number | null;
  /**
   * Default budget/run guards applied to this agent's schedules at creation
   * time (opt-in; the owner toggles these in the Agent Config tab). A schedule
   * inherits these and may override per-schedule. See ScheduleConstraint.
   */
  scheduleConstraintDefaults?: ScheduleConstraint[];
  federate?: boolean;
  technicalCapabilities?: AgentTechnicalCapability[];
  domainCapabilities?: string[];
  /** BCP-47 language codes the agent supports (kept separate from domainCapabilities). */
  languages?: string[];
  activityStats?: AgentActivityStats;
  modulesLoaded?: string[];
  agentLimitations?: string[];
  // Webhook delivery (Phase A push layer)
  webhookUrl?: string;
  webhookSecret?: string;
  webhookEnabled?: boolean;
  webhookLastSuccess?: string;
  webhookLastFailure?: string;
  webhookFailCount?: number;
  // Platform identification (Phase B prep)
  platform?: string;
  platformVersion?: string;
  platformDetectedBy?: 'auto' | 'self_report' | 'message_reply';
  // Tags for inter-agent data sharing + UI grouping (crew:*, source:*, role:*, project:*)
  tags?: string[];
  /**
   * Agent operational mode. Affects how Hello Integration is gated:
   * - `autonomous`  : runs continuously, full 13-step Hello Integration
   * - `interactive` : responds to user requests, full 13-step Hello Integration (default)
   * - `task-runner` : triggered/ephemeral, reduced 7-step flow (no commands, no messages; keeps test task)
   * - `coordinator`: orchestrates other agents, treated like `interactive` for onboarding
   * - `workstation`: node-visiting agent in the user's own env (VSCode, Claude Desktop), uses MCP
   *                  directly; not node-resident, so narrowest 4-step flow (auth + platform +
   *                  capabilities + directives)
   */
  mode?: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
  /**
   * How many tasks the agent's runner may process concurrently. Default 1 =
   * serial (the current behaviour, safe for any engine). >1 requires an engine
   * that can run a per-task liaison/worker pool (e.g. a CrewAI daemon); the
   * runner reads this value and scales its worker pool. AIMEAT only stores and
   * exposes the number — it does not enforce concurrency server-side.
   */
  maxConcurrentTasks?: number;
}

/**
 * A data-area grant captured at GEAI approval time. Expressed in the existing consent grammar
 * (recipient + key/scope pattern + read/write rights) so a later capability/data-access chunk can
 * enforce it with the same machinery agents use. In chunk 1 this is STORED ONLY — not enforced
 * beyond standard requireScope.
 */
export interface EcoDataAreaGrant {
  /** What the grant targets: 'memory' | 'storage' | 'knowledge' | 'organisms' (free-form for now). */
  area: string;
  /** Key prefix / bucket / topic / workspace id pattern this grant covers (e.g. "support.*"). */
  pattern: string;
  /** Rights granted on the target. */
  rights: ('read' | 'write')[];
}

/**
 * EcosystemAppRecord — the GEAI principal, a near-copy of AgentRecord MINUS task/agent-only fields
 * (no mode, no maxConcurrentTasks, no webhooks, no task queue) PLUS the ecosystem binding fields
 * (app, boundRef, dataAreas, status). One per (app, owner, node). The morsel balance is always 0 —
 * like agents, the human (GHII) holds the only balance.
 */
export interface EcosystemAppRecord {
  /** The ecosystem app's stable global short name (e.g. "zendesk"). */
  app: string;
  /** Bare owner name this connection belongs to (per-user). */
  owner: string;
  /** Full GEAI: eco:{app}#{owner}@{node}. */
  geai: string;
  displayName?: string;
  description?: string;
  /** The app's Ed25519 verification key, pinned TOFU at first connect (hello). */
  publicKey: string;
  /** Owner-approved scopes (same grammar + enforcement as agent scopes). */
  scopes: string[];
  /** Owner-selected data-area allowlist captured at approval (stored only in chunk 1). */
  dataAreas?: EcoDataAreaGrant[];
  /** Opaque ecosystem-side account reference — the per-user correspondence marker. Never interpreted by AIMEAT. */
  boundRef?: string;
  /** Connection lifecycle state. */
  status: 'validating' | 'pending' | 'approved' | 'active' | 'revoked';
  /** Always 0 — balance lives on the owner GHII (schema parity with AgentRecord). */
  morselBalance: number;
  /**
   * The app's declared capabilities, copied from the validated hello manifest at approval. Lets the
   * node enforce that a scheduled `eco-capability` job names a capability the app actually provides,
   * and lets the portal render the Automation controls. Stored as a JSON column in both backends.
   */
  capabilities?: { id: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> }[];
  /**
   * Optional automation hints from the manifest: which capabilities are schedulable (and at what
   * cadences) + an optional advisory sink + the agent(s) this app recommends. A HINT only — never
   * required for an owner to schedule. `recommended_agents` lets the portal mark the owner's matching
   * agents "★ Recommended" (by exact `name` and/or capability `match_tags`) and list them first.
   */
  automation?: {
    schedulable?: { id: string; produces?: string; produces_key?: string; cadences?: string[] }[];
    advisory_sink?: string;
    recommended_agents?: { name?: string; match_tags?: string[]; why: { fi: string; en: string } }[];
  };
  /**
   * The app's OWN bilingual Markdown setup guide for the owner, copied from the validated hello
   * manifest at approval. The portal renders the locale-appropriate guide in the app card (replacing
   * the old hardcoded playbook). Stored as a JSON column in both backends, mirroring `automation`.
   */
  setup?: { fi: string; en: string };
  createdAt: string;
  lastSeen: string;
}

/**
 * EcoAutomationRecipe — a per-(owner, app) automation rule (feature B4). When a connected ecosystem
 * app publishes refined data (a memory write whose key matches `trigger.keyGlob`), the recipe
 * materialises an agent task for EACH configured agent so the owner's agents reason over the fresh
 * data. The downstream fields (`organism`, `email`, `requireApproval`) are STORED here but their
 * enforcement is deferred to B5/B6/B7 — only the agent trigger is wired in B4. Keyed by bare owner
 * name + app (one recipe per app per owner). `trigger`/`agents` persist as JSON columns in both
 * backends, mirroring how EcosystemAppRecord.capabilities/automation are stored.
 */
export interface EcoAutomationRecipe {
  id: string;
  /** Bare owner name this recipe belongs to (membership/identity keyed by bare owner, per CLAUDE.md). */
  owner: string;
  /** The ecosystem app's {app} segment, e.g. 'feedback-desk'. */
  app: string;
  /** What fires the recipe: a memory write (the app's data deposit) matching `keyGlob`. */
  trigger: { kind: 'data-published'; keyGlob: string };
  /** Names of the owner's agents to run when the trigger fires. */
  agents: string[];
  /** B5 (deferred) — organism/workspace to route the agent's output to. Stored, not yet enforced. */
  organism?: string | null;
  /** B6 (deferred) — email the report to the owner. Stored, not yet enforced. */
  email?: boolean;
  /** B7 (deferred) — gate the agent's advisory output behind owner approval. Stored, not yet enforced. */
  requireApproval?: boolean;
  /** When false, the trigger never materialises tasks for this recipe. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  key: string;
  ownerGaii: string;    // the agent GAII that owns this memory
  value: unknown;
  // 'members' = readable by any authenticated user of this node (NOT the shared
  // anonymous identity); sits between 'group' and 'public'.
  visibility: 'private' | 'owner' | 'group' | 'members' | 'public';
  groupId?: string;
  tags: string[];
  ttlHours: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  flagCount?: number;   // Phase 1.5 — moderation flag counter
  allowedOrigins?: string[];  // CORS — per-key origin restrictions (Phase 4)
  /** Opt-in version tracking: when true, the PREVIOUS value is archived to the memory_history table on
   *  overwrite (latest stays here, history queried via listMemoryHistory). Default/absent = false. */
  trackable?: boolean;
  /**
   * Archive flag (organism archive feature). When true the record is read-only and EXCLUDED from the
   * bulk read/search primitives (listMemory/listAllMemory/searchText/searchMemory/countMemory) by
   * default — so it drops out of every AI-facing material assembly — yet stays resolvable by key via
   * getMemory and findable via an explicit archive search (`archived: 'only'|'include'`). Default
   * /absent = false (active). See src/services/archive.ts.
   */
  archived?: boolean;
  /** ISO timestamp the record was archived (set with `archived`). */
  archivedAt?: string;
  /** Identity (GHII/GAII) that archived the record. */
  archivedBy?: string;
  /**
   * The "archive root" — the id/key of the thing whose archival flagged this record. For a directly
   * archived single record this is its own key; for cascade archival (a record-table, workspace, or
   * organism) it is that container's ref. Unarchiving a root restores ONLY records carrying that root
   * (smart restore): a record independently archived earlier keeps its own root and stays archived.
   */
  archivedRoot?: string;
}

/**
 * How the memory read/search primitives treat archived rows.
 * - `exclude` (default): active rows only — the AI working set.
 * - `include`: active + archived together.
 * - `only`: archived rows only — backs "archive search".
 */
export type ArchiveFilter = 'exclude' | 'include' | 'only';

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
  semantic?: SemanticAnnotation;
  federate?: boolean;
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
  semantic?: SemanticAnnotation;
  federate?: boolean;
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

// App grant — a long-lived authorization issued to an in-page app so it can
// obtain agent tokens that resolve to the granting owner's GHII.
export interface AppGrantRecord {
  grantId: string;            // PK — e.g. "appgrant-<hex>"
  app: string;                // app identity, "owner/filename"
  appName: string;            // display name
  appOrigin: string;          // origin the app runs on (for display/redirect validation)
  owner: string;              // bare owner name who granted
  gaii: string;               // owner GHII (alice@node) the issued token resolves to
  scopes: string[];           // granted agent scopes (JSON array)
  refreshTokenHash: string | null;  // SHA-256 of current refresh token; null once revoked
  createdAt: string;          // ISO
  lastUsedAt: string | null;  // ISO
  revoked: boolean;
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
  /** Optional agent mode the requesting agent declared at device-authorize time. */
  mode?: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
  agentCredentials?: {
    gaii: string;
    privateKey: string;
    publicKey: string;
    token?: string;
    expires_at?: string;
  };
}

/**
 * EcoAuthorizationRecord — the pending "hello integration" handshake request for an ecosystem app,
 * a near-copy of DeviceAuthorizationRecord. Carries the eco-specific fields captured before approval
 * (app name, the TOFU-pinned publicKey, the requested scopes + data-area allowlist, the opaque
 * boundRef). On approval the GEAI credential is stashed in `appCredentials` for one-time pickup.
 */
export interface EcoAuthorizationRecord {
  deviceCode: string;
  userCode: string;
  ownerName: string;
  app: string;
  displayName?: string;
  description?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  /** The app's verification key submitted at hello, pinned TOFU. */
  publicKey?: string;
  /** Scopes requested by the app (owner may narrow at approval). */
  scopes?: string[];
  /** Data-area allowlist requested by the app (owner may edit at approval). */
  dataAreas?: EcoDataAreaGrant[];
  /** Opaque ecosystem-side account reference, carried through to the binding record. */
  boundRef?: string;
  createdAt: string;
  expiresAt: string;
  lastPolledAt?: string;
  pollInterval: number;
  approvedBy?: string;
  /**
   * Static compatibility-validation result for the submitted manifest (connector profile §5). Set at
   * hello time when a manifest is provided. The owner approves a known-good integration; an approve is
   * blocked when this exists and `ok` is false.
   */
  validationResult?: {
    ok: boolean;
    checks: { name: string; ok: boolean; detail?: string }[];
    validatedAt: string;
  };
  /**
   * The capabilities declared in the submitted manifest (stored at hello, copied onto the
   * EcosystemAppRecord at approval). Lets the binding carry the capability contract forward.
   */
  capabilities?: { id: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> }[];
  /** Optional automation hints from the manifest (schedulable capabilities + advisory sink + recommended agents). */
  automation?: {
    schedulable?: { id: string; produces?: string; produces_key?: string; cadences?: string[] }[];
    advisory_sink?: string;
    recommended_agents?: { name?: string; match_tags?: string[]; why: { fi: string; en: string } }[];
  };
  /** The app's OWN bilingual Markdown setup guide (stored at hello, copied onto the EcosystemApp at approval). */
  setup?: { fi: string; en: string };
  appCredentials?: {
    geai: string;
    /** The app's TOFU-pinned verification key (echoed back; the app already holds its private half). */
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
  visibility: 'private' | 'owner' | 'group' | 'public';
  groupId?: string;
  mimeType: string;
  size: number;
  data: Buffer;
  accessCode?: string;
  tags?: string[];
  createdAt: string;
  federate?: boolean;
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
  // Parked apps are hidden from the public catalogue/gallery/search but stay fully
  // usable by their owner (and the owner's agents). A property of the app
  // (owner+filename), mirrored onto every version row. Default false = published.
  parked?: boolean;
  // Operator moderation: when true, the app is removed from EVERY public surface
  // (catalogue/gallery/search/discovery) AND from public download — only the owner
  // (who sees a "moderated by operator: hidden" badge) and operators can still see
  // it. Unlike `parked`, the OWNER cannot lift this; only an operator can. A
  // property of the app (owner+filename), mirrored onto every version row. The
  // audit fields record who hid it, when, and why. Default false = visible.
  operatorHidden?: boolean;
  operatorHiddenBy?: string;   // operator owner name who hid it
  operatorHiddenAt?: string;   // ISO timestamp
  operatorHideReason?: string; // optional operator-supplied reason (shown to owner)
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
  // When set, parked AND operator-hidden apps are excluded UNLESS they belong to
  // this GHII, so an owner sees their own parked / operator-hidden apps in listings
  // (the latter carrying operator_hidden=true so the client can badge it) while
  // everyone else does not. Decided purely from who is authenticated — no client
  // flag. Omitted = anonymous/public view: exclude every parked / hidden app.
  viewerGhii?: string;
  // Operator-only listing: when true, return EVERY app regardless of parked or
  // operator-hidden state (the admin moderation view). Bypasses both filters.
  adminView?: boolean;
}

// Subdomain → published-app / redirect mapping (operator-managed).
// kind 'app': target is "owner/filename.html" of a published app.
// kind 'redirect': target is an absolute http(s) URL.
export interface SubdomainSiteRecord {
  subdomain: string;            // primary key, lowercase
  kind: 'app' | 'redirect';
  target: string;
  enabled: boolean;
  createdBy: string;            // GHII of the operator who created the mapping
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
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
  visibility: 'private' | 'owner' | 'group' | 'public';
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
  passwordFailedAttempts?: number;  // Failed password attempts (brute-force protection)
  passwordLockedUntil?: string;     // Password lockout expiry (brute-force protection)
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
  // Social login — stable provider subject for Google sign-in account linking
  googleSub?: string;               // Google OIDC `sub` (stable per-user id) — kept as a fast/back-compat mirror of externalIdentities.google
  // Social login — generic external-identity map: { providerId: stableSubject }, e.g.
  // { google: "1234...", casdoor: "abcd...", entra: "..." }. Lets one account link several IdPs.
  externalIdentities?: Record<string, string>;
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
  scope: 'private' | 'dmz' | 'federation' | 'auth';
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
  memoryKey: string;          // Which key was read (or the consent dataPattern for grant/revoke)
  action: 'read' | 'list' | 'search' | 'grant' | 'revoke';  // What was done
  timestamp: string;          // ISO timestamp
  allowed: boolean;           // Did consent allow this? (always true for grant/revoke)
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
  /** Who may see the member ROSTER (the members[]/agentGaiis fields + the /members listing):
   *  'public' = anyone incl. anonymous (deliberate opt-in), 'authenticated' = any signed-in caller
   *  (the DEFAULT when unset — anonymous internet never sees rosters), 'members' = active members,
   *  'admins' = creator/admins only. Creator + admins stay visible regardless (accountability),
   *  and operators/admins always see the full roster. Presentation-layer privacy: content
   *  ATTRIBUTION (comments, versions, activity) is a separate concern and unaffected. */
  memberVisibility?: 'public' | 'authenticated' | 'members' | 'admins';
  moderationConfig: {
    flagsEnabled: boolean;
    autoHideThreshold: number;
    appealsEnabled: boolean;
  };
  memoryNamespace: string;
  semantic?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Archive flag (organism archive feature). When true the organism is read-only and its content is
   *  excluded from AI-facing materials by default; its workspaces/records are cascade-archived. */
  archived?: boolean;
  /** ISO timestamp the organism was archived. */
  archivedAt?: string;
  /** Identity (GHII/GAII) that archived the organism. */
  archivedBy?: string;
}

export interface OrganismMembershipRecord {
  id: string;
  organismId: string;
  ghii: string;
  role: 'creator' | 'admin' | 'member';
  /**
   * - `active`  : a full member
   * - `pending` : legacy/reserved (join requests are tracked separately as JoinRequestRecord)
   * - `invited` : creator/admin invited this owner; awaiting their accept/decline (invite_only flow)
   * - `banned`  : removed-and-blocked; cannot re-join or be re-invited until the ban is lifted
   */
  status: 'active' | 'pending' | 'invited' | 'banned';
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

/**
 * Phase 4 — Gate primitive. A durable human-approval checkpoint for a consequential action an
 * agent (or the flow) wants to take inside an organism workspace. Created when a gate's
 * condition fires (or an `alwaysGate` action is requested); resolved by an approver. Every
 * resolution writes a decision-log entry + audit. `arguments` holds the proposed change
 * (e.g. the data model, the email payload, the plan diff) so the approver can view/edit it.
 */
export interface PendingApprovalRecord {
  id: string;
  organismId: string;
  flowGateId?: string;        // gate id from manifest flow.gates[] (omitted for ad-hoc gates)
  stageId?: string;           // the guarded flow stage id, if any
  actor: string;              // GAII/identity that requested the action
  action: string;             // e.g. 'flow:advance' | 'data-model-change' | 'deliverable:accept' | 'egress' | 'spend'
  arguments?: Record<string, unknown>;  // the proposed change payload (viewed/edited by the approver)
  risk: 'low' | 'medium' | 'high';
  approverRole: 'owner' | 'admin' | 'member';
  prompt?: string;            // human-facing question
  status: 'pending' | 'approved' | 'rejected' | 'edited';
  decidedBy?: string;         // owner name / GHII that resolved it
  decidedAt?: string;
  resolutionNote?: string;
  deadline?: string;          // ISO; durable pause — on expiry the expiry job escalates it
  createdAt: string;
  updatedAt: string;
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

// Phase 3.3 — Verification Nonces (EUDIW/FTN state tracking)
export interface VerificationNonceRecord {
  id: string;
  owner: string;
  type: 'eudiw' | 'ftn' | 'google_login' | 'casdoor_login' | 'entra_login';
  state: string;
  nonce: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
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

// Federation Peers — persisted active peer connections
export interface FederationPeerRecord {
  nodeId: string;
  url: string;
  publicKey: string;
  status: string;
  addedAt: string;
  lastSeen: string;
  shareCatalogue: boolean;
  replicateMemory: boolean;
  allowRouting: boolean;
  peerMode: 'federation' | 'private';
  allowFederatedAuth: boolean;
  federationAuthScopes: string[];
  /** Trust tier: 'genesis' | 'member' | 'visiting'. Absent (legacy rows) → 'member'. */
  tier?: 'genesis' | 'member' | 'visiting';
  /** Availability label from heartbeat uptime (Phase B): 'temporary' | 'permanent' | 'unknown'. */
  availability?: 'temporary' | 'permanent' | 'unknown' | null;
  /** Optional expiry for time-limited visiting peers (Phase B). */
  expiresAt?: string | null;
  /** Lifetime successful heartbeats (Phase B uptime). */
  heartbeatOk?: number;
  /** Lifetime attempted heartbeats (Phase B uptime). */
  heartbeatTotal?: number;
  /** JSON ring of daily heartbeat buckets `{ days: [{ d, ok, total }] }` over the availability window. */
  availabilityWindow?: string | null;
  /** Computed availability % over the window (denormalized for cheap reads). */
  availabilityPct?: number | null;
  /** Peer's AIMEAT software version (from heartbeat). */
  softwareVersion?: string | null;
  /** Hash of the peer's node-card, for federation-book change detection. */
  nodeCardHash?: string | null;
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
  action: 'template_upload' | 'template_delete' | 'import' | 'cache_invalidate' | 'app_publish' | 'app_update' | 'app_delete' | 'memory_set' | 'memory_delete';
  summary: string;
  changedBy: string;
  changedAt: string;
}

// ── Node Extensions (Sandboxed) ────────────────────────────────────

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

/**
 * A single budget/run guard attached to a schedule. Extensible: new guard
 * `type`s only need a registry entry in services/schedule-constraints.ts plus a
 * UI toggle — no schema change (constraints are stored as a JSON array).
 * `enabled` defaults to false so guards are strictly opt-in.
 */
export interface ScheduleConstraint {
  type: string;                          // e.g. 'max_runs' | 'daily_limit'
  enabled: boolean;                      // opt-in; off by default
  params: Record<string, unknown>;       // e.g. { limit: 7 }
  state?: Record<string, unknown>;       // accumulator state (e.g. spent today)
}

export interface ScheduledJobRecord {
  id: string;
  name: string;
  /**
   * 'core'/'extension' are the original server-run kinds. 'ai' runs a
   * server-side OpenRouter completion (zero agent involvement); 'agent_task'
   * materialises an AgentTaskRecord into the target agent's queue on each fire.
   * 'eco-capability' invokes a connected ecosystem app's (GEAI) capability over
   * the connect-tunnel on each fire — its `input` is
   * `{ app: string; capability_id: string; input?: Record<string,unknown> }`.
   */
  type: 'extension' | 'core' | 'ai' | 'agent_task' | 'workflow' | 'eco-capability' | 'secretary';
  extensionName?: string;
  instanceId?: string;
  actionId?: string;
  coreHandler?: string;
  cron: string;
  enabled: boolean;
  /**
   * Kind-specific config (round-tripped as JSON):
   *  - extension: scheduler input passed to the action (existing behaviour)
   *  - ai:        { inputKeys: string[]; inputNamespaces?: string[]; prompt: string;
   *                 systemPrompt?: string; model?: string; outputKey?: string;
   *                 outputVisibility?: 'private'|'owner'|'public' }
   *  - agent_task:{ taskTemplate: { title; description; scope?; rules?; verification?; resources? } }
   */
  input?: Record<string, unknown>;
  lastRunAt?: string;
  lastRunResult?: 'success' | 'error' | 'skipped';
  lastRunError?: string;
  lastRunDurationMs?: number;
  nextRunAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // ── Agent-scheduler additions (all optional / additive) ──
  ownerScope?: string;       // GHII owner — scopes the profile scheduler + authz
  agentName?: string;        // target/associated agent (agent_task; optional otherwise)
  agentGaii?: string;        // resolved GAII of the target agent
  createdByAgent?: boolean;  // true = created via MCP by an agent
  displayName?: string;      // human label ("Morning news translation")
  description?: string;      // human description
  purpose?: string;          // why this runs (shown in the master scheduler)
  timezone?: string;         // IANA tz, e.g. "Europe/Helsinki" (DST-correct via croner)
  constraints?: ScheduleConstraint[];  // budget/run guards (opt-in)
  runCount?: number;         // lifetime successful fires (constraint state)
}

// ── Execution Log (Scheduler Run History) ────────────────────────────

export interface ExecutionLogEntry {
  id: string;
  jobId: string;
  jobName: string;
  type: 'extension' | 'core' | 'ai' | 'agent_task' | 'workflow' | 'eco-capability' | 'secretary';
  extensionName?: string;
  actionId?: string;
  trigger: 'cron' | 'manual' | 'activate';
  result: 'success' | 'error' | 'skipped';
  errorMessage?: string;
  durationMs: number;
  memoryReads: string[];   // memory keys read during execution
  memoryWrites: string[];  // memory keys written during execution
  taskId?: string;         // agent_task fires: the spawned AgentTaskRecord id
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
  createdByAgent?: string;
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
  visibility: 'private' | 'owner' | 'group' | 'public';
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

  status: 'installed' | 'paused' | 'removed';
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

// ── Capability Layer ────────────────────────────────────────────────

export interface CapabilitySource {
  // 'ecosystem' = invocation routed over the connect-tunnel to a bound GEAI; ref = 'eco:{app}:{capId}'.
  type: 'extension' | 'action' | 'cortex' | 'app' | 'manual' | 'ecosystem';
  ref: string;
  version: string;
}

export interface CapabilityExport {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  example: { input: Record<string, unknown>; output: Record<string, unknown> } | null;
}

export interface CapabilityDependency {
  type: 'sdk' | 'capability';
  id: string;
  required: boolean;
  minVersion: string | null;
}

export interface CapabilityTrust {
  operatorReviewed: boolean;
  reviewedAt: string | null;
  vouchCount: number;
  publisherTrustScore: number;
  codeAudited: boolean;
  auditNotes: string | null;
}

export interface CapabilityStats {
  totalInvocations: number;
  successCount: number;
  errorCount: number;
  lastInvokedAt: string | null;
  avgResponseMs: number;
  lastError: string | null;
}

export interface CapabilityOverride {
  summary?: string;
  visibility?: 'private' | 'owner' | 'public';
  disabled?: boolean;
  notes?: string;
}

export interface CapabilityRecord {
  id: string;
  name: string;
  summary: string;
  ownerGhii: string;
  visibility: 'private' | 'owner' | 'public';
  scope: 'local';
  status: 'draft' | 'pending_review' | 'active' | 'deprecated' | 'rejected' | 'disabled';
  rejectionReason: string | null;
  deprecationMessage: string | null;
  replacedBy: string | null;
  source: CapabilitySource;
  authRequired: 'none' | 'anonymous' | 'registered';
  callable: boolean;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  exports: CapabilityExport[] | null;
  usage: string;
  whenToUse: string;
  whenNotToUse: string;
  examples: Array<{ description: string; input: Record<string, unknown>; output: Record<string, unknown> }>;
  dependencies: CapabilityDependency[];
  schemaHash: string;
  webhookUrl: string | null;
  cost: { morsels: number; perUnit?: string } | null;
  trustRequired: number | null;
  trust: CapabilityTrust;
  redactedFields: string[];
  operatorOverride: CapabilityOverride | null;
  stats: CapabilityStats;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityLogEntry {
  id: string;
  capabilityId: string;
  callerGhii: string;
  input: Record<string, unknown>;
  status: 'success' | 'error';
  durationMs: number;
  error: string | null;
  timestamp: string;
}

export interface CapabilityFilter {
  ownerGhii?: string;
  visibility?: string;
  status?: string;
  sourceType?: string;
  callable?: boolean;
  authRequired?: string;
  tags?: string[];
  search?: string;
  page?: number;
  perPage?: number;
}

// ── Agent Tasks (Phase 1) ──

export interface AgentTaskScope {
  name: string;
  value: string;
  type: 'text' | 'url' | 'memory_key' | 'number' | 'cron';
  description?: string;
}

export interface AgentTaskTodo {
  id: string;
  order: number;
  title: string;
  description: string;
  environment: 'aimeat' | 'agent';
  environmentReason?: string;
  verification: string;
  estimateMinutes?: number;
  // 'outdated' (since 1.14.5): the todo was part of a previous propose_todos
  // proposal that the owner rejected via /request-changes. The todo is kept
  // for history (so the agent and owner can see what was proposed before)
  // but is not part of the current active plan.
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped' | 'outdated';
  completedAt?: string;
}

/**
 * Context dimension a task rating is scored against. Fixed-but-extensible enum
 * (vs free-text) so ratings stay comparable across agents — no ad-hoc
 * fragmentation. Maps onto the crew "dimension" concept. The factual family
 * (factual/research/code/summarization) must be source-grounded — see
 * RATING_CONTEXTS_REQUIRING_GROUNDING and the rate endpoint.
 */
export type RatingContext =
  | 'factual' | 'creative' | 'code' | 'planning'
  | 'summarization' | 'research' | 'communication' | 'other';

/** Contexts whose ratings must be checked against sources/inputs, not output-alone. */
export const RATING_CONTEXTS_REQUIRING_GROUNDING: ReadonlySet<RatingContext> =
  new Set<RatingContext>(['factual', 'research', 'code', 'summarization']);

/**
 * Who produced a rating. Used to weight human judgement higher and to mark
 * ungrounded agent ratings as uncertain in the rollup. A source-grounded-agent
 * checked the deliverable against its inputs/spec (e.g. crew verify=factcheck).
 */
export type RaterType = 'human-owner' | 'agent' | 'source-grounded-agent';

/**
 * Peer/owner review attached to a completed task. Tamper integrity comes from
 * the recompute endpoint (anyone can recompute rollups from the tasks), not from
 * where this is stored.
 */
export interface AgentTaskRating {
  stars: number;            // 1–5
  context: RatingContext;
  comment?: string;
  ratedBy: string;          // GHII (owner) or GAII (agent) of the rater
  raterType: RaterType;
  sourceGrounded: boolean;  // was the rating checked against inputs/sources?
  unsupported?: number;     // optional: # unsupported claims (from factcheck)
  evaluatedModel?: string;  // model that PRODUCED the deliverable (baseline stamp)
  // Optional free-form evaluation context for later slicing (e.g. temperature,
  // top_p, max_tokens, tokensIn/Out, cost). Stored as-is, not aggregated yet —
  // the schema stays fixed while this side-channel grows. Capped on write.
  metadata?: Record<string, unknown>;
  ratedAt: string;
}

export interface AgentTaskRecord {
  id: string;
  agentGaii: string;
  ownerGaii: string;
  title: string;
  description: string;
  scope: AgentTaskScope[];
  rules: string[];
  verification: {
    userExpects: string;
    technicalChecks: string[];
  };
  resources?: {
    knowledgePackages?: string[];
    memoryKeys?: string[];
    memoryPrefixes?: string[];
  };
  todos: AgentTaskTodo[];
  // 'revision_requested' (since 1.14.5): the owner saw the agent's proposed
  // todos and asked for a different plan via POST /tasks/:id/request-changes.
  // The agent should read the latest 'revision_requested' event for the
  // owner's message, then call aimeat_task_propose_todos again. Old todos are
  // kept marked 'outdated' for context.
  status: 'draft' | 'queued' | 'revision_requested' | 'active' | 'paused' | 'stalled' | 'done' | 'failed';
  parentTaskId?: string;
  workTrackingCode?: string;
  telemetry?: {
    aiCalls?: number;
    tokensIn?: number;
    tokensOut?: number;
    durationSeconds?: number;
  };
  lastEventAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  // Memory key under the agent's namespace where the task's deliverable was
  // published (set by the agent on /complete). The owner UI links to it; if the
  // entry no longer exists, the UI shows that it's gone.
  deliverableKey?: string;
  // Peer/owner review of this task's deliverable (set via POST /tasks/:id/rate).
  // Feeds the per-context quality rollup computed by GET /agents/:name/statistics.
  rating?: AgentTaskRating;
  // Triage bucket for the Tasks tab (set via PATCH /tasks/:id/triage):
  //   'kept'     -> owner promoted it to the Keep tab; never auto-archived
  //   'archived' -> owner archived it (or it auto-fell when older than the window)
  //   undefined  -> default: shown in Recent, auto-archives by age if enabled
  triage?: 'kept' | 'archived';
  // Provenance + routing when this task was materialised by an ecosystem-app
  // automation recipe (features B5/B6). Tells the agent WHERE to write its report
  // (organism) and carries the downstream toggles the completion hook reads
  // (email the owner, gate behind approval). Absent for normal/scheduled tasks.
  automation?: {
    recipeId: string;
    app: string;
    organism?: string | null;
    email?: boolean;
    requireApproval?: boolean;
  };
}

export interface AgentTaskEventRecord {
  id: string;
  taskId: string;
  // 'revision_requested' (since 1.14.5): logged when the owner sends a
  // change-request message about a proposed todo list. The `message` field
  // is the owner's free-text request; the `details` field stores the count
  // of todos that were transitioned to 'outdated' by the request.
  // 'rating' (Quality tab): logged when a task's deliverable is reviewed via
  // POST /tasks/:id/rate. `details` carries { stars, context, raterType,
  // sourceGrounded }.
  type: 'started' | 'progress' | 'todo_completed' | 'todo_failed' |
        'memory_write' | 'extension_install' | 'app_publish' |
        'verification' | 'completed' | 'failed' | 'message' |
        'revision_requested' | 'rating';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ── Agent Directives (Phase 1) ──

export interface DirectiveRule {
  id: string;
  description: string;
  details?: string;
}

export interface DirectiveMemoryArea {
  keyPrefix: string;
  description: string;
  schema?: Record<string, unknown>;
  csmId?: string;
}

export interface DirectiveResource {
  type: 'knowledge_package' | 'memory_key';
  reference: string;
  description: string;
}

export interface BudgetLimits {
  maxTokensPerTask?: number;
  maxTokensPerDay?: number;
  maxTasksPerDay?: number;
  alertThreshold?: number;
}

export interface AgentDirectivesRecord {
  agentGaii: string;
  purpose: string;
  rules: DirectiveRule[];
  memoryAreas: DirectiveMemoryArea[];
  resources: DirectiveResource[];
  budgetLimits?: BudgetLimits;
  updatedAt: string;
}

export interface OwnerAgentDefaults {
  ownerGaii: string;
  rules: DirectiveRule[];
  defaultTokenBudget?: number;
  defaultMemoryAreas?: DirectiveMemoryArea[];
  updatedAt: string;
}

// ── Sharing Groups (Phase 1) ──

export interface SharingGroupMember {
  identifier: string;
  identifierType: 'gaii' | 'ghii';
  permissions: {
    read: boolean;
    write: boolean;
  };
  addedAt: string;
  addedBy: string;
}

export interface SharingGroupRecord {
  id: string;
  name: string;
  description?: string;
  ownerGaii: string;
  members: SharingGroupMember[];
  defaultPermissions: {
    read: boolean;
    write: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

// ── Agent Activity (Phase 2 prep) ──

export interface AgentTechnicalCapability {
  name: string;
  type: 'mcp' | 'skill' | 'tool';
  verified: boolean;
}

export interface AgentActivityStats {
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed30d: number;
  aiCalls30d: number;
  successRate: number;
  lastTaskAt?: string;
  extensionsCreated: number;
  appsPublished: number;
}

export interface AgentActivityRecord {
  agentGaii: string;
  date: string;
  hour: number;
  metric: string;
  value: number;
}

// ── Agent Messages (Phase 3) ──

export interface AgentMessageRecord {
  id: string;
  agentGaii: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  senderGaii: string;
  content: string;
  status: 'pending' | 'processing' | 'delivered' | 'error';
  linkedTaskId?: string;
  metadata?: {
    tokensUsed?: number;
    processingMs?: number;
    proposedTask?: {
      title: string;
      description: string;
    };
    // Single-select option-prompt attached to an outbound (agent->owner)
    // message. The UI renders `options` as chips + an implicit "Other".
    prompt?: {
      promptId: string;
      question: string;
      options: string[];
      allowOther: boolean;
    };
    // Owner's reply to a prompt, on an inbound (owner->agent) message.
    // `promptId` correlates back to the prompt above.
    promptAnswer?: {
      promptId: string;
      choice: string;
      isOther: boolean;
    };
  };
  createdAt: string;
  processedAt?: string;
}

// ── Direct Messages (human↔human GHII messaging + federation) ──

/**
 * A media object referenced by a direct message — inline in the markdown body via cid:{id}
 * or appended as a plain attachment. Every referenced storage object is one entry here: the
 * single source of truth for the duplication / grant / quota / ownership lifecycle.
 */
export interface DirectMessageAttachment {
  /** Short id used by cid:{id} inline references in the markdown body. */
  id: string;
  /** true = embedded in the body via cid:; false = appended attachment. */
  inline: boolean;
  /** Storage key at the origin (sender's node). */
  storageKey: string;
  /** Owner (sender) GHII that holds the original bytes. */
  ownerGhii: string;
  /** Node hosting the original bytes. */
  originNodeId: string;
  /** How the recipient accesses it. duplicate = the norm; reference = transient (pending/awaiting quota). */
  mode: 'reference' | 'duplicate';
  /** Recipient-side storage key, set once the attachment has been duplicated locally. */
  localKey?: string;
  /** Set when a held (reference) attachment was never duplicated within the retry TTL and was dropped. */
  expired?: boolean;
  mime: string;
  size: number;
  /** Original filename / caption. */
  name?: string;
  kind: 'image' | 'audio' | 'video' | 'file';
}

/** One option in an interactive question. `id` is stable; `label` is the human-facing text. */
export interface InteractiveOption {
  id: string;
  label: string;
}

/** A single structured question carried by an interactive message (mirrors the AskUserQuestion shape). */
export interface InteractiveQuestion {
  id: string;
  /** Short chip label (≈ ≤12 chars). */
  header: string;
  /** The full question text. */
  prompt: string;
  options: InteractiveOption[];
  /** true → the human may pick multiple options (checkboxes); false → single-select (radio). */
  multiSelect?: boolean;
  /** true (default) → also offer a freeform "Other" answer. */
  allowOther?: boolean;
  /** true → the human must answer before the reply can be sent (UI-gated). */
  required?: boolean;
}

/** The human's answer to one question: the chosen option ids plus an optional freeform "Other" value. */
export interface InteractiveAnswer {
  selected: string[];
  other?: string | null;
}

/**
 * Optional structured payload on a direct message — a federated AskUserQuestion. Discriminated by `role`:
 *  - `questions`: an agent asks the human a set of option-based questions (rendered as a form in the inbox).
 *  - `answers`: the human's reply, carrying machine-readable picks keyed by question id (the message body
 *    still holds a human-readable summary so the thread reads naturally on any peer).
 */
export type InteractivePayload =
  | { role: 'questions'; v: number; questions: InteractiveQuestion[]; submitLabel?: string }
  | { role: 'answers'; v: number; answersFor: string; answers: Record<string, InteractiveAnswer> };

/**
 * One mailbox copy of a direct message. Both sides store their own row (classic mailbox model):
 * the sender keeps an `outbound` row, the recipient an `inbound` row, sharing `id`/`conversationId`
 * so receipts and replies correlate. `ownerGhii` is whose mailbox this copy belongs to.
 */
export interface DirectMessageRecord {
  id: string;
  /** Whose mailbox copy this row is (sender's copy or recipient's copy). */
  ownerGhii: string;
  /** Groups a thread on both nodes. By default derived from the sorted GHII pair (one thread per pair);
   *  a subject thread instead uses a freshly minted id carried in the federation payload. */
  conversationId: string;
  /** Optional thread subject — set on the message that opens a new subject thread; lets a pair have
   *  more than one thread (e.g. per topic) instead of a single endless conversation. */
  subject?: string;
  senderGhii: string;
  recipientGhii: string;
  /** GFM markdown; inline media referenced as cid:{attachmentId}. May be empty if attachment-only. */
  body: string;
  attachments?: DirectMessageAttachment[];
  /** Optional structured payload — a federated AskUserQuestion (the question spec, or the human's answers). */
  interactive?: InteractivePayload;
  /** Set when this message is one copy of a broadcast (send-to-many) — groups the copies for results. */
  broadcastId?: string;
  /** false = an announcement (recipients cannot reply); omitted/true = a normal message. Travels with the
   *  message (incl. cross-node) so the recipient's node can enforce/hide replies. */
  respondable?: boolean;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undeliverable';
  direction: 'inbound' | 'outbound';
  /** Message this is a reply to (same conversationId). */
  replyToId?: string;
  origin: 'local' | 'federation';
  /** Node that created (sent) the message. */
  originNodeId: string;
  /** Last delivery error, if status is failed/undeliverable. */
  error?: string;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}

/**
 * Operator-facing delivery telemetry for one direct-message send attempt. Deliberately carries NO
 * message content and NO participant identities — only the routing/outcome metadata an operator
 * needs to see whether sends succeed or pile up in errors (status, target node, http/error, latency).
 */
export interface MessageDeliveryLog {
  id: string;
  /** The message's uuid (correlation only — not content). */
  messageId: string;
  origin: 'local' | 'federation';
  /** Recipient's node id (where it was being delivered). */
  targetNodeId: string;
  status: 'delivered' | 'queued' | 'failed' | 'undeliverable';
  httpStatus?: number;
  errorMessage?: string;
  latencyMs: number;
  createdAt: string;
}

/** Aggregated delivery stats for the operator dashboard. */
export interface MessageDeliveryStats {
  total: number;
  total24h: number;
  byStatus: Record<string, number>;
  byStatus24h: Record<string, number>;
  topTargetNodes: Array<{ nodeId: string; total: number; failed: number }>;
}

/**
 * Per-pair first-contact consent state, stored under the recipient's namespace. Drives the
 * first-contact gate: no record → pending request; accepted → free-flowing; blocked → rejected.
 */
export interface ContactConsentRecord {
  /** The human who owns this contact list (recipient side). */
  ownerGhii: string;
  /** The other party: GHII | GAII | GEAI. */
  contactId: string;
  state: 'pending' | 'accepted' | 'blocked';
  /** The request message that opened the relationship, if any. */
  firstMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Telemetry + Webhook Delivery Log (Phase A) ──

export interface TelemetryEvent {
  id: string;
  agentGaii: string;
  type: 'llm_call' | 'tool_call' | 'agent_report';
  data: Record<string, unknown>;
  sessionId?: string;
  taskId?: string;
  createdAt: string;
}

export interface WebhookDeliveryLog {
  id: string;
  agentGaii: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'success' | 'failed';
  httpStatus?: number;
  errorMessage?: string;
  attemptCount: number;
  latencyMs: number;
  createdAt: string;
}

// ── Agent Onboarding (Phase B Hello Integration) ──

export interface AgentOnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  required: boolean;
  validatedAt?: string;
  validationMethod: 'automatic' | 'api_call' | 'owner_confirm';
  details?: Record<string, unknown>;
  failureReason?: string;
}

export interface AgentOnboardingRecord {
  agentGaii: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  steps: AgentOnboardingStep[];
  readinessScore?: number;
  readinessLevel?: 'basic' | 'standard' | 'full' | 'expert';
  detectedPlatform?: string;
  installedRuntime?: string;
  onboardingBaseline?: number;
  operationalHealth?: number;
  healthComponents?: {
    deliveryHealth: number;
    telemetryContinuity: number;
    taskCompletion: number;
  };
  healthRecalculatedAt?: string;
  readinessOverride?: {
    level: 'basic' | 'standard' | 'full' | 'expert';
    setBy: string;
    setAt: string;
    expiresAt: string;
    reason?: string;
  };
}

// ── Domain Repository Interfaces ────────────────────────────────────
import type { OwnerRepository } from './repositories/owner.repository.js';
import type { AgentRepository } from './repositories/agent.repository.js';
import type { EcosystemAppRepository } from './repositories/ecosystem-app.repository.js';
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
import type { PatRepository } from './repositories/pat.repository.js';
import type { AppRepository } from './repositories/app.repository.js';
import type { AppMarketplaceRepository } from './repositories/app-marketplace.repository.js';
import type { SubdomainSiteRepository } from './repositories/subdomain-site.repository.js';
import type { AppGrantRepository } from './repositories/app-grant.repository.js';
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
import type { CapabilityRepository } from './repositories/capability.repository.js';
import type { StatsRepository } from './repositories/stats.repository.js';
import type { AgentTaskRepository } from './repositories/agent-task.repository.js';
import type { AgentDirectivesRepository } from './repositories/agent-directives.repository.js';
import type { SharingGroupRepository } from './repositories/sharing-group.repository.js';
import type { AgentActivityRepository } from './repositories/agent-activity.repository.js';
import type { AgentMessageRepository } from './repositories/agent-message.repository.js';
import type { DirectMessageRepository } from './repositories/direct-message.repository.js';
import type { AgentTelemetryRepository, AgentWebhookRepository } from './repositories/agent-webhook.repository.js';
import type { AgentOnboardingRepository } from './repositories/agent-onboarding.repository.js';
import type { InvitationRepository } from './repositories/invitation.repository.js';

export interface Storage extends
  OwnerRepository, AgentRepository, MemoryRepository,
  ActionRepository, WorkRepository, WalletRepository,
  BoardRepository, OtkRepository, DisputeRepository,
  MicroMemoryRepository, FileRepository, IdentityRepository,
  SchemaRepository, ConsentRepository, CatalogueRepository,
  ModerationRepository, OrganismRepository, MarketplaceRepository,
  FederationRepository, NodeRepository, NotificationRepository,
  AuthRepository, SessionRepository, PatRepository,
  AppRepository, AppMarketplaceRepository, SubdomainSiteRepository, AppGrantRepository, ConfigRepository,
  NotificationTemplateRepository,
  KnowledgeRepository, SchedulerRepository,
  ExtensionInstanceRepository, ReplicationQueueRepository,
  DeviceAuthRepository,
  EcosystemAppRepository,
  OAuthRepository, SystemPromptRepository,
  PackageRepository, TemplateListingRepository, PackageInstanceRepository,
  CapabilityRepository,
  AgentTaskRepository, AgentDirectivesRepository, SharingGroupRepository, AgentActivityRepository,
  AgentMessageRepository,
  DirectMessageRepository,
  AgentTelemetryRepository, AgentWebhookRepository,
  AgentOnboardingRepository,
  InvitationRepository,
  StatsRepository { }
