/**
 * @file src/config-types.ts
 * @description AimeatConfig and its supporting type/interface declarations
 *   (ExtensionHooks, RateLimits, OperatorConfig, LoadConfig* result types).
 *   Extracted from config.ts to satisfy max-file-lines; config.ts re-exports
 *   every symbol so no consumer import changes.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from config.ts (max-file-lines)
 */

export interface ExtensionHooks {
  pre_owner_registration: string[];
  post_owner_registration: string[];
  pre_agent_registration: string[];
  post_agent_registration: string[];
  owner_recovery: string[];
  agent_rekey: string[];
  pre_work_request: string[];
  post_work_delivery: string[];
  post_settlement: string[];
  pre_board_post: string[];
  pre_federation_peer: string[];
}

export type HookName = keyof ExtensionHooks;

export interface RateLimitTier {
  windowMs: number;
  max: number;
}

export interface RoleMultipliers {
  operator: number;
  owner: number;
  agent: number;
  anonymous: number;
}

export interface RateLimitsConfig {
  global: RateLimitTier;
  auth: RateLimitTier;
  work: RateLimitTier;
  memory: RateLimitTier;
  boards: RateLimitTier;
  // Per-endpoint overrides (fall back to global when not configured)
  owners: RateLimitTier;
  ghii: RateLimitTier;
  flags: RateLimitTier;
  appeals: RateLimitTier;
  adminSetup: RateLimitTier;
  federation: RateLimitTier;
  catalogue: RateLimitTier;
  authChallenge: RateLimitTier;
  openrouter: RateLimitTier;
  roleMultipliers: RoleMultipliers;
}

export type NodeType = 'full' | 'relay' | 'mirror' | 'personal';
export type FederationRole = 'operator' | 'contributor' | 'standalone';

/**
 * Operator info rendered into the public privacy policy at `/v1/privacy`.
 * AIMEAT is open-source self-hostable -- every node operator becomes the
 * data controller for their node and MUST identify themselves on the policy.
 * Defaults are deliberately empty so unconfigured deployments fail loudly
 * (503 on the privacy page) rather than silently shipping the upstream
 * author's information.
 */
export type OperatorType = 'natural_person' | 'company' | 'organisation' | 'association';

export interface OperatorConfig {
  /** Legal name of the controller (person or org). */
  name: string;
  /** Controller type. Drives display strings ("a natural person" / "a company" ...). */
  type: OperatorType;
  /** Postal address. GDPR requires a contact address for the controller. */
  address: string;
  /** Country of operation (e.g. "Finland"). Used in international-transfers section. */
  country: string;
  /** Primary privacy contact email. */
  email: string;
  /** Security contact email. Falls back to `email` when empty. */
  securityEmail: string;
  /** Hosting provider name (e.g. "Scaleway SAS"). */
  hostingName: string;
  /** Optional URL of the hosting provider for the privacy-page link. */
  hostingUrl: string;
  /** Hosting jurisdiction (e.g. "France (EU/EEA)"). */
  hostingLocation: string;
  /** Name of the national data-protection supervisory authority. */
  supervisoryName: string;
  /** URL of the supervisory authority (e.g. https://tietosuoja.fi). */
  supervisoryUrl: string;
  /** Effective date of the privacy policy (YYYY-MM-DD). */
  effectiveDate: string;
  /** Privacy policy version string. */
  policyVersion: string;
}

export interface AimeatConfig {
  port: number;
  baseUrl: string;
  /**
   * Dedicated origin for serving user-published apps, isolating them from the
   * authenticated apex SPA (closes H-2). Host form, e.g. `apps.aimeat.io`; apps
   * resolve at `<sub>.apps.aimeat.io` or `apps.aimeat.io/<owner>/<file>`. Empty
   * when unset (no usable app origin → apex serving stays as-is).
   */
  appHost: string;
  /**
   * Feature flag gating the app-origin behaviour (apex app HTML → 301 to the app
   * origin; app-origin serve router active). OFF until DNS/TLS/nginx for
   * `*.appHost` are provisioned, so enabling it without infra can't break app serving.
   */
  appOriginEnabled: boolean;
  /**
   * Dedicated origin family for standalone published portfolios: a portfolio
   * resolves at `<username>.portfolio.<apex>` as a top-level document (same
   * isolation argument as the app origin — host-only cookies mean no visitor
   * session exists there). Host form, e.g. `portfolio.aimeat.io`; empty when unset.
   */
  portfolioHost: string;
  /**
   * Feature flag for the portfolio origin. OFF until DNS/TLS/nginx for
   * `*.portfolioHost` are provisioned; when off, standalone URLs are not
   * advertised and the serve route stays inert.
   */
  portfolioOriginEnabled: boolean;
  nodeId: string;
  nodeType: NodeType;
  dbUrl: string | null;
  storageProvider: 'memory' | 'sqlite' | 'mongodb' | 'postgresql';
  sqlitePath: string;
  adminPassword: string | null;
  devMode: boolean;
  testMode: boolean;
  anonymousMode: boolean;
  /** Security posture: `local` (localhost-flexible) or `public` (hardened). Sets safe DEFAULTS for
   *  the egress + AI-allowlist knobs below; any explicit AIMEAT_* var overrides. Resolved from
   *  AIMEAT_SECURITY_PROFILE, else the baseUrl host / nodeType. See security-development-dna.md. */
  securityProfile: 'local' | 'public';
  /** May a server-side fetch of a principal-influenced URL target loopback (127.0.0.1/::1)?
   *  Default: profile==='local'. Consumed by url-validator via AIMEAT_ALLOW_PRIVATE_EGRESS.
   *  (RFC1918/link-local/cloud-metadata stay blocked server-side regardless.) */
  allowPrivateEgress: boolean;
  /** Host allowlist an AI `baseUrl` may point at before a decrypted key is sent (openrouter.ai,
   *  api.openai.com, …). Empty = any host (local dev / self-hosted). Enforced in ai-completion. */
  aiProviderAllowlist: string[];
  /** Node auto-generates thumbnails for published apps that have none (needs a headless browser). */
  screenshotAutoCapture: boolean;
  /** Minutes between auto-screenshot scans (default 15). */
  screenshotIntervalMin: number;
  /** Ms to wait after load before the screenshot, so apps that fetch/render late aren't captured blank (default 6000). */
  screenshotSettleMs: number;
  jwtTtlSeconds: number;
  agentJwtTtlSeconds: number;
  ecoJwtTtlSeconds: number; // GEAI (ecosystem app) credential lifetime
  // Owner session refresh tokens (plan 2026-06-03-owner-session-refresh-tokens)
  accessTtlSeconds: number;     // owner access-token (JWT) lifetime — short
  refreshIdleDays: number;      // sliding idle window for the refresh cookie
  refreshAbsoluteDays: number;  // hard cap for the refresh cookie, never extended
  refreshGraceMs: number;       // previous token honored this long after rotation (concurrency)
  welcomeBonus: number;
  dailyAllowance: number;
  dailyAllowanceCap: number;
  burnRate: number;
  keyedBrowseEnabled: boolean;
  extendedFeaturesEnabled: boolean;
  maxRelayHops: number;
  depeeringGracePeriodHours: number;
  keyCacheRefreshMinutes: number;
  memoryQuotaMb: number;
  memoryMaxValueSizeKb: number;
  memoryMaxKeysPerAgent: number;
  storageQuotaMb: number;
  storageMaxFileSizeMb: number;
  storageMaxChunkedFileSizeGb: number;
  microMemoryQuotaKb: number;
  microMemoryMaxSetsPerAgent: number;
  microMemoryMaxKeysPerSet: number;
  microMemoryMaxValueSizeBytes: number;
  maxActionsPerAgent: number;
  minTrustForPaidActions: number;
  appMaxSizeMb: number;
  maxAppsPerAgent: number;
  agentPortingFeeMorsels: number;
  memoryOverageMorselsPerMbMonth: number;
  storageOverageMorselsPerGbMonth: number;
  maxOperatorMintPerDay: number;
  boardPostBaseCost: number;
  boardPostCostPerKb: number;
  appAnnouncementBoardId: string;
  webhookMaxRetries: number;
  workQueueMaxPending: number;
  otkTtlMs: number;
  otkGraceMs: number;
  maxUrlLength: number;
  indexNowKey: string | null;
  extensionHooks: ExtensionHooks;
  rateLimits: RateLimitsConfig;

  // Per-endpoint rate limits (individual keys for config-schema compatibility)
  rlGlobal: number;
  rlAuth: number;
  rlWork: number;
  rlMemory: number;
  rlBoards: number;
  rlOwners: number;
  rlGhii: number;
  rlFlags: number;
  rlAppeals: number;
  rlAdminSetup: number;
  rlFederation: number;
  rlCatalogue: number;
  rlAuthChallenge: number;

  // Federation role
  federationRole: FederationRole;
  genesisUrl: string | null;
  federationAuthPolicy: 'disabled' | 'all_peers' | 'specific_peers';
  federationDefaultScopes: string[];
  /** Open federation join: when true, a signed `introduce` self-admits as a low-trust 'visiting' peer (no manual approval). Default off. */
  federationOpenJoin: boolean;
  /** List this node (operators + resources) in the federation book. Default on; off = privacy opt-out. */
  federationBookListed: boolean;
  /** Peer availability window (days) over which heartbeat uptime % is computed. */
  federationAvailabilityWindowDays: number;
  /** Uptime % at/above which a peer is labelled 'permanent' (else 'temporary'). */
  federationAvailabilityPermanentThreshold: number;
  /** Minimum heartbeat samples in the window before a real availability label is assigned. */
  federationAvailabilityMinSamples: number;

  // Security limits (configurable per security audit)
  loginRateLimitMax: number;
  loginRateLimitWindowMs: number;
  registrationRateLimitMax: number;
  registrationRateLimitWindowMs: number;
  adminAuthRateLimitMax: number;
  adminAuthRateLimitWindowMs: number;
  passwordLockoutAttempts: number;
  passwordLockoutMinutes: number;
  jsonBodyLimitMb: number;
  jsonBodyLimitLargeMb: number;

  // Consent Layer (Phase 0.3)
  consentEnabled: boolean;
  consentAuditRetentionDays: number;
  executionLogRetentionDays: number;
  consentMaxPerUser: number;

  // TOTP / 2FA (Phase 0.5)
  totpEnabled: boolean;
  totpIssuer: string;
  totpPeriod: number;
  totpWindow: number;
  totpBackupCodeCount: number;
  totpSecretEncryptionKey: string | null;
  totpMaxFailedAttempts: number;
  totpLockoutSeconds: number;

  // General-purpose encryption key (fallback: totpSecretEncryptionKey)
  encryptionKey: string | null;

  // MSM installation role restriction
  msmInstallRole: 'operator' | 'owner';

  // Extension installation role restriction
  extInstallRole: 'operator' | 'owner';

  // Personal Node support (operator-side)
  personalNodesEnabled: boolean;
  personalNodeMaxSlots: number;
  personalNodeMailboxQuotaMb: number;
  personalNodeMailboxRetentionDays: number;
  personalNodeHeartbeatIntervalMs: number;
  personalNodeOfflineThresholdMs: number;
  personalNodeRequestTimeoutMs: number;

  // Connector Forward Tunnel (agent ⇄ server single persistent WS)
  connectTunnelEnabled: boolean;
  connectTunnelHeartbeatIntervalMs: number;
  connectTunnelOfflineThresholdMs: number;
  connectTunnelRequestTimeoutMs: number;

  // Email / SMTP (Phase 1.1)
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string;
  smtpSecure: boolean;
  smtpRejectUnauthorized: boolean;
  emailConfirmationRequired: boolean;
  emailEnabled: boolean;

  // Match Notifications (Phase 1.6)
  matchNotificationIntervalHours: number;
  matchNotificationEnabled: boolean;

  // AI Matching (Phase 2.1)
  matchingEnabled: boolean;
  matchIntervalHours: number;
  matchThreshold: number;
  matchMaxSuggestions: number;
  matchMaxDistanceKm: number;
  matchCooldownDays: number;

  // Marketplace (Phase 2.6)
  marketplaceEnabled: boolean;
  marketplaceListingFeeMorsels: number;
  marketplaceTransactionFeePercent: number;
  marketplaceEscrowEnabled: boolean;

  // Push Notifications / PWA (Phase 3.1)
  pushEnabled: boolean;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string;
  pushNotifyTypes: string[];
  pushCooldownMin: number;
  pushMaxSubscriptionsPerNode: number;
  pushMaxFailures: number;
  emailRateLimitMin: number;

  // EUDIW / Identity Verification (Phase 3.3)
  eudiwEnabled: boolean;
  eudiwClientId: string;
  eudiwRedirectUri: string;
  ftnEnabled: boolean;
  ftnProviderUrl: string;
  ftnClientId: string;
  ftnClientSecret: string;
  vcIssuerDid: string;
  nonceTtlSeconds: number;
  nationalEidPidClaim: string;

  // Social login — Google OAuth/OIDC sign-in (generic, config-gated)
  googleOAuthEnabled: boolean;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  googleOAuthRedirectUri: string;  // empty = derive from baseUrl

  // Social login — Casdoor OAuth/OIDC sign-in (open-source IdP, config-gated)
  casdoorOAuthEnabled: boolean;
  casdoorOAuthEndpoint: string;      // Casdoor server URL, e.g. https://casdoor.example.com
  casdoorOAuthClientId: string;
  casdoorOAuthClientSecret: string;
  casdoorOAuthRedirectUri: string;   // empty = derive from baseUrl

  // Social login — Microsoft Entra ID OAuth/OIDC sign-in (enterprise IdP, config-gated)
  entraOAuthEnabled: boolean;
  entraOAuthTenant: string;          // tenant GUID (single-tenant gating) | common | organizations | consumers
  entraOAuthClientId: string;
  entraOAuthClientSecret: string;
  entraOAuthRedirectUri: string;     // empty = derive from baseUrl

  // Cross-Federation (Phase 3.4)
  crossFederationEnabled: boolean;
  maxGenesisPeers: number;
  genesisSyncIntervalHours: number;

  // Federation Data Sync
  syncMode: 'bulk' | 'instant' | 'hybrid';
  syncIntervalHours: number;
  syncBatchDelayMs: number;
  replicationQueueMax: number;
  replicationQueueTtlHours: number;
  maxConcurrentSyncs: number;
  federationTimeoutMs: number;
  // Direct-message federation delivery retry (DECISION #6): retry queued cross-node messages
  // ~every interval, giving up (→ undeliverable) after the TTL. Only reachable peers are attempted.
  messageRetryIntervalMs: number;
  messageRetryTtlHours: number;
  genesisMemoryCache: boolean;
  genesisMemoryCacheTtlHours: number;

  // Cookie Consent (optional, for service builders)
  cookieConsentEnabled: boolean;
  cookieConsentCategories: string[];
  cookieConsentPolicyUrl: string | null;

  // Realtime P2P
  realtimeEnabled: boolean;
  realtimeMaxRooms: number;
  realtimeMaxPeersPerRoom: number;
  realtimeRoomIdleTimeoutMs: number;
  realtimeMaxMessageSizeBytes: number;
  realtimeRateLimitPerSecond: number;
  stunServers: string[];
  turnServer: string | null;
  turnUsername: string | null;
  turnCredential: string | null;

  // Encrypted Chat (extension)
  echatAnonymous: boolean;

  // Node Portal (Site)
  siteEnabled: boolean;
  siteMaxTemplateSizeKb: number;
  siteCacheTtlSeconds: number;
  siteKv: Record<string, string>;
  siteLbEnabled: boolean;
  siteLbOriginUrl: string | null;
  siteLbSyncIntervalMin: number;
  siteLbSyncOnStartup: boolean;

  // Setup Wizard (Phase 1.2)
  setupAllowedIps: string[];

  // Content Moderation
  autoHideThreshold: number;

  // Statistics
  statsEnabled: boolean;
  statsAccess: 'public' | 'authenticated' | 'operator';

  // Scoped Agent Capabilities (REQ-006)
  defaultAgentScopes: string[];
  maxAgentScopes: string[];
  /** F1: enforce per-agent scopes on the /v1/mcp tool surface (default true; false = warn-only). */
  mcpEnforceScopes: boolean;

  // Ecosystem application (GEAI) scope bounds — parallel to the agent knobs above, so an operator
  // can bound ecosystem connections independently of agents.
  defaultEcoScopes: string[];
  maxEcoScopes: string[];

  // Prometheus Metrics
  metricsEnabled: boolean;
  metricsAccess: 'public' | 'authenticated' | 'operator';

  // Node Extensions (Sandboxed)
  extensionsEnabled: boolean;
  extensionMaxMemoryMb: number;
  extensionTimeoutMs: number;
  extensionMaxApiCalls: number;
  extensionMaxDebitPerCall: number;
  extensionMaxCodeSizeKb: number;
  extensionMaxInstalled: number;
  maxExtensionsPerOwner: number;

  // Service Generator
  generatorEnabled: boolean;

  // Foundry (prompt-driven service builder)
  foundryEnabled: boolean;

  // Prompt Calibrator
  calibratorEnabled: boolean;

  // Cortex Extensions (Manifest-based)
  cortexEnabled: boolean;
  cortexMaxInstalled: number;
  cortexMaxLibSizeKb: number;

  // Packages & Templates
  packagesEnabled: boolean;
  packageCreateRole: 'operator' | 'owner';
  packageMaxSizeMb: number;
  packageMaxComponents: number;
  packageMaxPerAuthor: number;
  templatesEnabled: boolean;
  templateReviewsEnabled: boolean;
  templateDiscussionsEnabled: boolean;
  packageFederationEnabled: boolean;
  packageFederationAutoAccept: boolean;

  // Portfolio
  portfolioEnabled: boolean;
  portfolioMaxSizeKb: number;
  portfolioMaxImages: number;

  // Capabilities
  capabilityPublishing: 'disabled' | 'self_only' | 'moderated' | 'open';
  capabilityPublishers: 'all_users' | 'trusted_only' | 'allowlist';
  capabilityMinPublisherTrust: number;
  capabilityPublisherAllowlist: string[];
  capabilityWebhooks: 'disabled' | 'allowlist_only' | 'open';
  capabilityWebhookDomainAllowlist: string[];
  capabilityLogRetentionDays: number;

  // Agent Tasks (Phase 1)
  taskStallThresholdMinutes: number;
  // Tasks-tab triage: when on, un-triaged terminal (done/failed) tasks fall to
  // the Archive bucket once older than taskArchiveAfterHours. Off = they stay in
  // Recent until the owner archives them manually.
  taskAutoArchive: boolean;
  taskArchiveAfterHours: number;

  // Agent Directives (Phase 1)
  agentSystemPrinciples: string[];
  agentMaxTokensPerTask: number;
  agentMandatoryLogging: boolean;
  agentAimeatFirstEnabled: boolean;

  // Operator info (rendered into the public privacy policy page).
  // Required by GDPR for any node serving EU users. If a required
  // field is missing, the privacy page returns 503 "Privacy not
  // configured" so the operator is forced to fill it in before going
  // public. See `requireOperatorConfig()` for the validation rule.
  operator: OperatorConfig;

  // CORS
  corsAllowedOrigins: string[];

  // Consul (fleet management)
  consulEnabled: boolean;
  consulUrl: string;
  consulPrefix: string;
  consulToken: string;
  consulWatchIntervalSeconds: number;
  consulDatacenter: string;
}

export interface LoadConfigOptions {
  /** Path to config file (from --config CLI arg) */
  configPath?: string;
  /** CLI bootstrap overrides keyed by dot-path (e.g. { 'node.port': '8080' }) */
  cliOverrides?: Record<string, string>;
}

export interface LoadConfigResult {
  config: AimeatConfig;
  /** Dot-paths that resolved from env vars */
  envKeys: string[];
  /** Dot-paths that resolved from file config (aimeat.ini / aimeat.json) */
  fileKeys: string[];
  /** Dot-paths that resolved from CLI args */
  cliKeys: string[];
  /** Name of the file source (e.g. 'file:/path/to/aimeat.ini'), null if no file found */
  fileName: string | null;
}
