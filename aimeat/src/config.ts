/**
 * @file config.ts
 * @description Central AimeatConfig type and loadConfig() entry point. Reads
 *   env vars + optional file source + CLI overrides into a single config
 *   object consumed by every module. Also defines OperatorConfig (privacy
 *   policy fields rendered into /v1/privacy) and helpers missingOperatorConfig
 *   / operatorTypeLabel used by the portal router to fail loud when the
 *   operator has not identified themselves.
 * @structure
 *   - AimeatConfig (interface)
 *   - OperatorConfig (interface) + OperatorType (union)
 *   - LoadConfigOptions / LoadConfigResult
 *   - loadConfig() (function)
 *   - missingOperatorConfig() / operatorTypeLabel() (helpers)
 * @version-history
 *   v1.0.0 -- pre-2026-05 -- Initial central config module
 *   v1.1.0 -- 2026-05-29 -- Add OperatorConfig section + helpers. Required for
 *     privacy policy template substitution per CLAUDE.md self-host architecture.
 *   v1.1.1 -- 2026-06-02 -- Raise default taskStallThresholdMinutes 30 -> 120 so
 *     long-running orchestrated tasks aren't falsely marked stalled.
 */
import { loadFileSource } from './services/config-loader.js';
import { CONFIG_FIELDS, DOT_PATH_TO_ENV, MUTABLE_CONFIG_MAP, parseConfigValue, isImmutable } from './services/config-schema.js';
import type { ConfigProvenance } from './services/config-provenance.js';

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
  nodeId: string;
  nodeType: NodeType;
  dbUrl: string | null;
  storageProvider: 'memory' | 'sqlite' | 'mongodb' | 'postgresql';
  sqlitePath: string;
  adminPassword: string | null;
  devMode: boolean;
  testMode: boolean;
  anonymousMode: boolean;
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

/**
 * Derive the app-origin host (`apps.<apexHost>`) from a baseUrl. Returns '' for
 * localhost / IP / host-less baseUrls where a public app subdomain makes no sense
 * (the operator can still set AIMEAT_APP_HOST explicitly, e.g. for local testing).
 */
function deriveAppHost(baseUrl: string): string {
  let host: string;
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { return ''; }
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.endsWith('.localhost')) return '';
  return `apps.${host}`;
}

export function loadConfig(options?: LoadConfigOptions): LoadConfigResult {
  const { configPath, cliOverrides } = options ?? {};

  // ── Source tracking for provenance ──
  const cliKeys: string[] = [];
  const envKeys: string[] = [];
  const fileKeys: string[] = [];

  // 1. Apply CLI overrides to process.env (highest non-DB priority)
  if (cliOverrides) {
    for (const [dotPath, value] of Object.entries(cliOverrides)) {
      const envVar = DOT_PATH_TO_ENV[dotPath];
      if (envVar) {
        process.env[envVar] = value;
        cliKeys.push(dotPath);
      }
    }
  }

  // 2. Track which env vars are already set (before file population)
  for (const field of CONFIG_FIELDS) {
    if (process.env[field.envVar] !== undefined && !cliKeys.includes(field.dotPath)) {
      envKeys.push(field.dotPath);
    }
  }

  // 3. Load file config and populate process.env for unset values
  const fileSource = loadFileSource(configPath);
  if (fileSource) {
    for (const [dotPath, value] of Object.entries(fileSource.values)) {
      const envVar = DOT_PATH_TO_ENV[dotPath];
      if (envVar && process.env[envVar] === undefined) {
        process.env[envVar] = value;
        fileKeys.push(dotPath);
      }
    }
    console.log(`[config] Loaded ${Object.keys(fileSource.values).length} values from ${fileSource.name}`);
  }

  // ── Build config from process.env (now includes CLI + env + file layers) ──
  const nodeType = (process.env.AIMEAT_NODE_TYPE ?? 'full') as NodeType;
  if (!['full', 'relay', 'mirror', 'personal'].includes(nodeType)) {
    throw new Error(`Invalid AIMEAT_NODE_TYPE: ${nodeType}. Must be 'full', 'relay', 'mirror', or 'personal'.`);
  }

  const port = parseInt(process.env.AIMEAT_PORT ?? '40050', 10);

  // Rate limits — parse individual values, per-endpoint falls back to global
  const rlGlobal = Math.max(1, parseInt(process.env.AIMEAT_RL_GLOBAL ?? '300', 10));
  const rlAuth = Math.max(1, parseInt(process.env.AIMEAT_RL_AUTH ?? '20', 10));
  const rlWork = Math.max(1, parseInt(process.env.AIMEAT_RL_WORK ?? '60', 10));
  const rlMemory = Math.max(1, parseInt(process.env.AIMEAT_RL_MEMORY ?? '120', 10));
  const rlBoards = Math.max(1, parseInt(process.env.AIMEAT_RL_BOARDS ?? '60', 10));
  const rlOwners = Math.max(1, parseInt(process.env.AIMEAT_RL_OWNERS ?? String(rlGlobal), 10));
  const rlGhii = Math.max(1, parseInt(process.env.AIMEAT_RL_GHII ?? String(rlGlobal), 10));
  const rlFlags = Math.max(1, parseInt(process.env.AIMEAT_RL_FLAGS ?? String(rlGlobal), 10));
  const rlAppeals = Math.max(1, parseInt(process.env.AIMEAT_RL_APPEALS ?? String(rlGlobal), 10));
  const rlAdminSetup = Math.max(1, parseInt(process.env.AIMEAT_RL_ADMIN_SETUP ?? String(rlGlobal), 10));
  const rlFederation = Math.max(1, parseInt(process.env.AIMEAT_RL_FEDERATION ?? String(rlGlobal), 10));
  const rlCatalogue = Math.max(1, parseInt(process.env.AIMEAT_RL_CATALOGUE ?? String(rlGlobal), 10));
  const rlAuthChallenge = Math.max(1, parseInt(process.env.AIMEAT_RL_AUTH_CHALLENGE ?? String(rlGlobal), 10));

  const config: AimeatConfig = {
    port,
    baseUrl: (process.env.AIMEAT_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    // App origin: explicit AIMEAT_APP_HOST wins; otherwise derive `apps.<apexHost>`
    // from the baseUrl. Left empty for host-less baseUrls (so nothing breaks in dev).
    appHost: (process.env.AIMEAT_APP_HOST ?? deriveAppHost(process.env.AIMEAT_BASE_URL ?? `http://localhost:${port}`)).trim().toLowerCase(),
    appOriginEnabled: process.env.AIMEAT_APP_ORIGIN_ENABLED === 'true',
    nodeId: process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev',
    nodeType,
    dbUrl: process.env.DATABASE_URL ?? null,
    // Accept `postgres` as an alias for `postgresql`.
    storageProvider: ((process.env.AIMEAT_STORAGE ?? 'memory') === 'postgres'
      ? 'postgresql'
      : (process.env.AIMEAT_STORAGE ?? 'memory')) as 'memory' | 'sqlite' | 'mongodb' | 'postgresql',
    sqlitePath: process.env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db',
    adminPassword: process.env.AIMEAT_ADMIN_PASSWORD ?? null,
    devMode: process.env.AIMEAT_DEV_MODE === 'true',
    testMode: process.env.AIMEAT_TEST_MODE === 'true',
    anonymousMode: process.env.AIMEAT_ANONYMOUS === 'true',
    jwtTtlSeconds: parseInt(process.env.AIMEAT_JWT_TTL ?? '3600', 10),
    agentJwtTtlSeconds: parseInt(process.env.AIMEAT_AGENT_JWT_TTL ?? '7776000', 10), // 90 days
    ecoJwtTtlSeconds: parseInt(process.env.AIMEAT_ECO_JWT_TTL ?? '7776000', 10),     // 90 days
    accessTtlSeconds: parseInt(process.env.AIMEAT_ACCESS_TTL ?? '900', 10),          // 15 min
    refreshIdleDays: parseInt(process.env.AIMEAT_REFRESH_IDLE_DAYS ?? '30', 10),
    refreshAbsoluteDays: parseInt(process.env.AIMEAT_REFRESH_ABSOLUTE_DAYS ?? '90', 10),
    refreshGraceMs: parseInt(process.env.AIMEAT_REFRESH_GRACE_MS ?? '60000', 10),     // 60s

    welcomeBonus: parseInt(process.env.AIMEAT_WELCOME_BONUS ?? '100', 10),
    dailyAllowance: parseInt(process.env.AIMEAT_DAILY_ALLOWANCE ?? '50', 10),
    dailyAllowanceCap: parseInt(process.env.AIMEAT_DAILY_ALLOWANCE_CAP ?? '500', 10),
    burnRate: parseFloat(process.env.AIMEAT_BURN_RATE ?? '0.10'),
    keyedBrowseEnabled: process.env.AIMEAT_KEYED_BROWSE !== 'false',
    extendedFeaturesEnabled: process.env.AIMEAT_EXTENDED_FEATURES !== 'false',
    maxRelayHops: parseInt(process.env.AIMEAT_MAX_RELAY_HOPS ?? '3', 10),
    depeeringGracePeriodHours: parseInt(process.env.AIMEAT_DEPEERING_GRACE_HOURS ?? '72', 10),
    keyCacheRefreshMinutes: parseInt(process.env.AIMEAT_KEY_CACHE_REFRESH_MINUTES ?? '5', 10),
    memoryQuotaMb: parseInt(process.env.AIMEAT_MEMORY_QUOTA_MB ?? '10', 10),
    memoryMaxValueSizeKb: parseInt(process.env.AIMEAT_MEMORY_MAX_VALUE_SIZE_KB ?? '1024', 10),
    memoryMaxKeysPerAgent: parseInt(process.env.AIMEAT_MEMORY_MAX_KEYS ?? '1000', 10),
    storageQuotaMb: parseInt(process.env.AIMEAT_STORAGE_QUOTA_MB ?? '100', 10),
    storageMaxFileSizeMb: parseInt(process.env.AIMEAT_STORAGE_MAX_FILE_SIZE_MB ?? '10', 10),
    storageMaxChunkedFileSizeGb: parseInt(process.env.AIMEAT_STORAGE_MAX_CHUNKED_FILE_SIZE_GB ?? '5', 10),
    microMemoryQuotaKb: parseInt(process.env.AIMEAT_MICRO_MEMORY_QUOTA_KB ?? '500', 10),
    microMemoryMaxSetsPerAgent: parseInt(process.env.AIMEAT_MICRO_MEMORY_MAX_SETS ?? '50', 10),
    microMemoryMaxKeysPerSet: parseInt(process.env.AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET ?? '100', 10),
    microMemoryMaxValueSizeBytes: parseInt(process.env.AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE ?? '1024', 10),
    maxActionsPerAgent: parseInt(process.env.AIMEAT_MAX_ACTIONS_PER_AGENT ?? '20', 10),
    minTrustForPaidActions: parseInt(process.env.AIMEAT_MIN_TRUST_PAID_ACTIONS ?? '10', 10),
    appMaxSizeMb: parseInt(process.env.AIMEAT_APP_MAX_SIZE_MB ?? '5', 10),
    maxAppsPerAgent: parseInt(process.env.AIMEAT_MAX_APPS_PER_AGENT ?? '50', 10),
    agentPortingFeeMorsels: parseInt(process.env.AIMEAT_AGENT_PORTING_FEE ?? '50', 10),
    memoryOverageMorselsPerMbMonth: parseInt(process.env.AIMEAT_MEMORY_OVERAGE_MORSELS ?? '10', 10),
    storageOverageMorselsPerGbMonth: parseInt(process.env.AIMEAT_STORAGE_OVERAGE_MORSELS ?? '100', 10),
    maxOperatorMintPerDay: parseInt(process.env.AIMEAT_MAX_OPERATOR_MINT_PER_DAY ?? '10000', 10),
    boardPostBaseCost: parseInt(process.env.AIMEAT_BOARD_POST_BASE_COST ?? '5', 10),
    boardPostCostPerKb: parseInt(process.env.AIMEAT_BOARD_POST_COST_PER_KB ?? '2', 10),
    appAnnouncementBoardId: process.env.AIMEAT_APP_ANNOUNCEMENT_BOARD_ID ?? 'app-announcements',
    webhookMaxRetries: parseInt(process.env.AIMEAT_WEBHOOK_MAX_RETRIES ?? '5', 10),
    workQueueMaxPending: parseInt(process.env.AIMEAT_WORK_QUEUE_MAX_PENDING ?? '10', 10),
    otkTtlMs: parseInt(process.env.AIMEAT_OTK_TTL_MS ?? '300000', 10),
    otkGraceMs: parseInt(process.env.AIMEAT_OTK_GRACE_MS ?? '60000', 10),
    maxUrlLength: parseInt(process.env.AIMEAT_MAX_URL_LENGTH ?? '8192', 10),
    indexNowKey: process.env.AIMEAT_INDEXNOW_KEY ?? null,
    extensionHooks: {
      pre_owner_registration: [],
      post_owner_registration: [],
      pre_agent_registration: [],
      post_agent_registration: [],
      owner_recovery: [],
      agent_rekey: [],
      pre_work_request: [],
      post_work_delivery: [],
      post_settlement: [],
      pre_board_post: [],
      pre_federation_peer: [],
    },
    federationRole: (process.env.AIMEAT_FEDERATION_ROLE ?? 'standalone') as FederationRole,
    federationAuthPolicy: (process.env.AIMEAT_FEDERATION_AUTH_POLICY ?? 'disabled') as 'disabled' | 'all_peers' | 'specific_peers',
    federationDefaultScopes: (process.env.AIMEAT_FEDERATION_DEFAULT_SCOPES ?? 'memory:read,catalogue:read').split(',').filter(Boolean),
    federationOpenJoin: process.env.AIMEAT_FEDERATION_OPEN_JOIN === 'true',
    federationBookListed: process.env.AIMEAT_FEDERATION_BOOK_LISTED !== 'false',
    federationAvailabilityWindowDays: parseInt(process.env.AIMEAT_FEDERATION_AVAILABILITY_WINDOW_DAYS ?? '30', 10),
    federationAvailabilityPermanentThreshold: parseInt(process.env.AIMEAT_FEDERATION_AVAILABILITY_PERMANENT_THRESHOLD ?? '90', 10),
    federationAvailabilityMinSamples: parseInt(process.env.AIMEAT_FEDERATION_AVAILABILITY_MIN_SAMPLES ?? '288', 10),

    // Security limits
    loginRateLimitMax: parseInt(process.env.AIMEAT_LOGIN_RATE_LIMIT_MAX ?? '15', 10),
    loginRateLimitWindowMs: parseInt(process.env.AIMEAT_LOGIN_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    registrationRateLimitMax: parseInt(process.env.AIMEAT_REGISTRATION_RATE_LIMIT_MAX ?? '5', 10),
    registrationRateLimitWindowMs: parseInt(process.env.AIMEAT_REGISTRATION_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    adminAuthRateLimitMax: parseInt(process.env.AIMEAT_ADMIN_AUTH_RATE_LIMIT_MAX ?? '5', 10),
    adminAuthRateLimitWindowMs: parseInt(process.env.AIMEAT_ADMIN_AUTH_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    passwordLockoutAttempts: parseInt(process.env.AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS ?? '5', 10),
    passwordLockoutMinutes: parseInt(process.env.AIMEAT_PASSWORD_LOCKOUT_MINUTES ?? '15', 10),
    jsonBodyLimitMb: parseInt(process.env.AIMEAT_JSON_BODY_LIMIT_MB ?? '5', 10),
    jsonBodyLimitLargeMb: parseInt(process.env.AIMEAT_JSON_BODY_LIMIT_LARGE_MB ?? '15', 10),
    genesisUrl: process.env.AIMEAT_GENESIS_URL ?? null,
    consentEnabled: process.env.AIMEAT_CONSENT_ENABLED !== 'false',
    consentAuditRetentionDays: parseInt(process.env.AIMEAT_CONSENT_AUDIT_RETENTION_DAYS ?? '365', 10),
    consentMaxPerUser: parseInt(process.env.AIMEAT_CONSENT_MAX_PER_USER ?? '100', 10),
    totpEnabled: process.env.AIMEAT_TOTP_ENABLED !== 'false',
    totpIssuer: process.env.AIMEAT_TOTP_ISSUER ?? 'AIMEAT',
    totpPeriod: parseInt(process.env.AIMEAT_TOTP_PERIOD ?? '30', 10),
    totpWindow: parseInt(process.env.AIMEAT_TOTP_WINDOW ?? '1', 10),
    totpBackupCodeCount: parseInt(process.env.AIMEAT_TOTP_BACKUP_CODE_COUNT ?? '10', 10),
    totpSecretEncryptionKey: process.env.AIMEAT_TOTP_ENCRYPTION_KEY ?? null,
    totpMaxFailedAttempts: parseInt(process.env.AIMEAT_TOTP_MAX_FAILED ?? '5', 10),
    totpLockoutSeconds: parseInt(process.env.AIMEAT_TOTP_LOCKOUT_SECONDS ?? '300', 10),
    encryptionKey: process.env.AIMEAT_ENCRYPTION_KEY ?? null,
    msmInstallRole: (process.env.AIMEAT_MSM_INSTALL_ROLE as 'operator' | 'owner') || 'owner',
    extInstallRole: (process.env.AIMEAT_EXT_INSTALL_ROLE as 'operator' | 'owner') || 'owner',
    personalNodesEnabled: process.env.AIMEAT_PERSONAL_NODES_ENABLED !== 'false',
    personalNodeMaxSlots: parseInt(process.env.AIMEAT_PERSONAL_NODE_MAX_SLOTS ?? '100', 10),
    personalNodeMailboxQuotaMb: parseInt(process.env.AIMEAT_PERSONAL_MAILBOX_QUOTA_MB ?? '50', 10),
    personalNodeMailboxRetentionDays: parseInt(process.env.AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS ?? '7', 10),
    personalNodeHeartbeatIntervalMs: parseInt(process.env.AIMEAT_PERSONAL_HEARTBEAT_MS ?? '30000', 10),
    personalNodeOfflineThresholdMs: parseInt(process.env.AIMEAT_PERSONAL_OFFLINE_MS ?? '300000', 10),
    personalNodeRequestTimeoutMs: parseInt(process.env.AIMEAT_PERSONAL_REQUEST_TIMEOUT_MS ?? '60000', 10),

    // Connector Forward Tunnel — one persistent WS per agent identity carrying
    // forward API calls + realtime reverse delivery. OPT-IN (off by default):
    // the Node connector client that drives it is Phase 3 (unbuilt), so a node
    // shouldn't expose an endpoint nothing uses yet. Flip the default to on once
    // the connector ships. aimeat.io enables it explicitly.
    connectTunnelEnabled: process.env.AIMEAT_CONNECT_TUNNEL_ENABLED === 'true',
    connectTunnelHeartbeatIntervalMs: parseInt(process.env.AIMEAT_CONNECT_TUNNEL_HEARTBEAT_MS ?? '30000', 10),
    connectTunnelOfflineThresholdMs: parseInt(process.env.AIMEAT_CONNECT_TUNNEL_OFFLINE_MS ?? '90000', 10),
    connectTunnelRequestTimeoutMs: parseInt(process.env.AIMEAT_CONNECT_TUNNEL_REQUEST_TIMEOUT_MS ?? '30000', 10),
    smtpHost: process.env.AIMEAT_SMTP_HOST || null,
    smtpPort: parseInt(process.env.AIMEAT_SMTP_PORT ?? '587', 10),
    smtpUser: process.env.AIMEAT_SMTP_USER ?? null,
    smtpPass: process.env.AIMEAT_SMTP_PASS ?? null,
    smtpFrom: process.env.AIMEAT_SMTP_FROM ?? 'AIMEAT <noreply@localhost>',
    smtpSecure: process.env.AIMEAT_SMTP_SECURE === 'true',
    smtpRejectUnauthorized: process.env.AIMEAT_SMTP_REJECT_UNAUTHORIZED !== 'false',
    emailConfirmationRequired: process.env.AIMEAT_EMAIL_CONFIRMATION_REQUIRED === 'true',
    emailEnabled: !!(process.env.AIMEAT_SMTP_HOST),
    matchNotificationIntervalHours: parseInt(process.env.AIMEAT_MATCH_NOTIFICATION_INTERVAL_HOURS ?? '24', 10),
    matchNotificationEnabled: process.env.AIMEAT_MATCH_NOTIFICATION_ENABLED !== 'false',
    matchingEnabled: process.env.AIMEAT_MATCHING_ENABLED !== 'false',
    matchIntervalHours: parseInt(process.env.AIMEAT_MATCH_INTERVAL_HOURS ?? '24', 10),
    matchThreshold: parseFloat(process.env.AIMEAT_MATCH_THRESHOLD ?? '0.5'),
    matchMaxSuggestions: parseInt(process.env.AIMEAT_MATCH_MAX_SUGGESTIONS ?? '5', 10),
    matchMaxDistanceKm: parseInt(process.env.AIMEAT_MATCH_MAX_DISTANCE_KM ?? '100', 10),
    matchCooldownDays: parseInt(process.env.AIMEAT_MATCH_COOLDOWN_DAYS ?? '7', 10),
    marketplaceEnabled: process.env.AIMEAT_MARKETPLACE_ENABLED !== 'false',
    marketplaceListingFeeMorsels: parseInt(process.env.AIMEAT_MARKETPLACE_LISTING_FEE ?? '2', 10),
    marketplaceTransactionFeePercent: parseInt(process.env.AIMEAT_MARKETPLACE_TX_FEE_PERCENT ?? '5', 10),
    marketplaceEscrowEnabled: process.env.AIMEAT_MARKETPLACE_ESCROW !== 'false',
    pushEnabled: process.env.AIMEAT_PUSH_ENABLED !== 'false',
    vapidPublicKey: process.env.AIMEAT_VAPID_PUBLIC_KEY ?? null,
    vapidPrivateKey: process.env.AIMEAT_VAPID_PRIVATE_KEY ?? null,
    vapidSubject: process.env.AIMEAT_VAPID_SUBJECT ?? 'mailto:admin@aimeat.example.com',
    pushNotifyTypes: (process.env.AIMEAT_PUSH_NOTIFY_TYPES ?? 'work_assignment,action_request').split(',').map(s => s.trim()),
    pushCooldownMin: parseInt(process.env.AIMEAT_PUSH_COOLDOWN_MIN ?? '5', 10),
    pushMaxSubscriptionsPerNode: parseInt(process.env.AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE ?? '5', 10),
    pushMaxFailures: parseInt(process.env.AIMEAT_PUSH_MAX_FAILURES ?? '3', 10),
    emailRateLimitMin: parseInt(process.env.AIMEAT_EMAIL_RATE_LIMIT_MIN ?? '30', 10),
    eudiwEnabled: process.env.AIMEAT_EUDIW_ENABLED === 'true',
    eudiwClientId: process.env.AIMEAT_EUDIW_CLIENT_ID ?? 'aimeat-verifier-001',
    eudiwRedirectUri: process.env.AIMEAT_EUDIW_REDIRECT_URI ?? '',
    ftnEnabled: process.env.AIMEAT_FTN_ENABLED === 'true',
    ftnProviderUrl: process.env.AIMEAT_FTN_PROVIDER_URL ?? 'https://tunnistautuminen.suomi.fi',
    ftnClientId: process.env.AIMEAT_FTN_CLIENT_ID ?? '',
    ftnClientSecret: process.env.AIMEAT_FTN_CLIENT_SECRET ?? '',
    vcIssuerDid: process.env.AIMEAT_VC_ISSUER_DID ?? '',
    nonceTtlSeconds: parseInt(process.env.AIMEAT_NONCE_TTL_SECONDS ?? '300', 10),
    nationalEidPidClaim: process.env.AIMEAT_NATIONAL_EID_PID_CLAIM ?? 'personal_identity_code',
    googleOAuthEnabled: process.env.AIMEAT_GOOGLE_OAUTH_ENABLED === 'true',
    googleOAuthClientId: process.env.AIMEAT_GOOGLE_OAUTH_CLIENT_ID ?? '',
    googleOAuthClientSecret: process.env.AIMEAT_GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    googleOAuthRedirectUri: process.env.AIMEAT_GOOGLE_OAUTH_REDIRECT_URI ?? '',
    crossFederationEnabled: process.env.AIMEAT_CROSS_FEDERATION_ENABLED !== 'false',
    maxGenesisPeers: parseInt(process.env.AIMEAT_MAX_GENESIS_PEERS ?? '10', 10),
    genesisSyncIntervalHours: parseInt(process.env.AIMEAT_GENESIS_SYNC_INTERVAL_HOURS ?? '6', 10),
    syncMode: (process.env.AIMEAT_SYNC_MODE ?? 'hybrid') as 'bulk' | 'instant' | 'hybrid',
    syncIntervalHours: parseInt(process.env.AIMEAT_SYNC_INTERVAL_HOURS ?? '6', 10),
    syncBatchDelayMs: parseInt(process.env.AIMEAT_SYNC_BATCH_DELAY_MS ?? '5000', 10),
    replicationQueueMax: parseInt(process.env.AIMEAT_REPLICATION_QUEUE_MAX ?? '10000', 10),
    replicationQueueTtlHours: parseInt(process.env.AIMEAT_REPLICATION_QUEUE_TTL_HOURS ?? '72', 10),
    maxConcurrentSyncs: parseInt(process.env.AIMEAT_MAX_CONCURRENT_SYNCS ?? '5', 10),
    federationTimeoutMs: parseInt(process.env.AIMEAT_FEDERATION_TIMEOUT_MS ?? '10000', 10),
    messageRetryIntervalMs: parseInt(process.env.AIMEAT_MESSAGE_RETRY_INTERVAL_MS ?? '60000', 10),
    messageRetryTtlHours: parseInt(process.env.AIMEAT_MESSAGE_RETRY_TTL_HOURS ?? '168', 10),
    genesisMemoryCache: process.env.AIMEAT_GENESIS_MEMORY_CACHE === 'true',
    genesisMemoryCacheTtlHours: parseInt(process.env.AIMEAT_GENESIS_MEMORY_CACHE_TTL_HOURS ?? '4', 10),
    cookieConsentEnabled: process.env.AIMEAT_COOKIE_CONSENT_ENABLED === 'true',
    cookieConsentCategories: (process.env.AIMEAT_COOKIE_CONSENT_CATEGORIES ?? 'necessary').split(',').map(s => s.trim()).filter(Boolean),
    cookieConsentPolicyUrl: process.env.AIMEAT_COOKIE_CONSENT_POLICY_URL ?? null,
    realtimeEnabled: process.env.AIMEAT_REALTIME_ENABLED !== 'false',
    realtimeMaxRooms: parseInt(process.env.AIMEAT_REALTIME_MAX_ROOMS ?? '100', 10),
    realtimeMaxPeersPerRoom: parseInt(process.env.AIMEAT_REALTIME_MAX_PEERS_PER_ROOM ?? '20', 10),
    realtimeRoomIdleTimeoutMs: parseInt(process.env.AIMEAT_REALTIME_ROOM_IDLE_TIMEOUT_MS ?? '3600000', 10),
    realtimeMaxMessageSizeBytes: parseInt(process.env.AIMEAT_REALTIME_MAX_MESSAGE_SIZE ?? '16384', 10),
    realtimeRateLimitPerSecond: parseInt(process.env.AIMEAT_REALTIME_RATE_LIMIT ?? '50', 10),
    stunServers: (process.env.AIMEAT_STUN_SERVERS ?? 'stun:stun.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean),
    turnServer: process.env.AIMEAT_TURN_SERVER ?? null,
    turnUsername: process.env.AIMEAT_TURN_USERNAME ?? null,
    turnCredential: process.env.AIMEAT_TURN_CREDENTIAL ?? null,
    echatAnonymous: process.env.AIMEAT_ECHAT_ANONYMOUS === 'true',
    siteEnabled: process.env.AIMEAT_SITE_ENABLED !== 'false',
    siteMaxTemplateSizeKb: parseInt(process.env.AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB ?? '512', 10),
    siteCacheTtlSeconds: parseInt(process.env.AIMEAT_SITE_CACHE_TTL_SECONDS ?? '60', 10),
    siteKv: Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => k.startsWith('AIMEAT_SITE_KV_'))
        .map(([k, v]) => [k.replace('AIMEAT_SITE_KV_', '').toLowerCase(), v ?? ''])
    ),
    siteLbEnabled: process.env.AIMEAT_SITE_LB_ENABLED === 'true',
    siteLbOriginUrl: process.env.AIMEAT_SITE_LB_ORIGIN_URL ?? null,
    siteLbSyncIntervalMin: parseInt(process.env.AIMEAT_SITE_LB_SYNC_INTERVAL_MIN ?? '30', 10),
    siteLbSyncOnStartup: process.env.AIMEAT_SITE_LB_SYNC_ON_STARTUP !== 'false',
    setupAllowedIps: (process.env.AIMEAT_SETUP_ALLOWED_IPS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
    autoHideThreshold: parseInt(process.env.AIMEAT_AUTO_HIDE_THRESHOLD ?? '5', 10),
    statsEnabled: process.env.AIMEAT_STATS_ENABLED !== 'false',
    statsAccess: (process.env.AIMEAT_STATS_ACCESS as 'public' | 'authenticated' | 'operator') ?? 'public',
    metricsEnabled: process.env.AIMEAT_METRICS_ENABLED === 'true',
    metricsAccess: (process.env.AIMEAT_METRICS_ACCESS as 'public' | 'authenticated' | 'operator') ?? 'operator',

    // Scoped Agent Capabilities (REQ-006)
    defaultAgentScopes: (process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? 'memory:read,memory:write,memory:delete,catalogue:read').split(',').map(s => s.trim()),
    maxAgentScopes: (process.env.AIMEAT_MAX_AGENT_SCOPES ?? '*').split(',').map(s => s.trim()),
    // MCP audit Phase 3 (F1): enforce per-agent scopes on the public /v1/mcp tool surface
    // (mirrors the REST requireScope gates). Default true — closes the least-privilege hole.
    // Set false for a warn-only rollout: tools are still registered, but would-be-filtered
    // tools are logged so you can measure impact before enforcing.
    mcpEnforceScopes: process.env.AIMEAT_MCP_ENFORCE_SCOPES !== 'false',

    // Ecosystem application (GEAI) scope bounds. Defaults lean read + deposit (ecosystem apps mostly
    // deposit refined data into owner areas). Events/capability scopes are deferred to later chunks.
    defaultEcoScopes: (process.env.AIMEAT_DEFAULT_ECO_SCOPES ?? 'memory:read,memory:write,knowledge:contribute,organism:read').split(',').map(s => s.trim()),
    maxEcoScopes: (process.env.AIMEAT_MAX_ECO_SCOPES ?? '*').split(',').map(s => s.trim()),

    // Node Extensions (Sandboxed)
    extensionsEnabled: process.env.AIMEAT_EXTENSIONS_ENABLED !== 'false',
    extensionMaxMemoryMb: parseInt(process.env.AIMEAT_EXT_MAX_MEMORY_MB ?? '64', 10),
    extensionTimeoutMs: parseInt(process.env.AIMEAT_EXT_TIMEOUT_MS ?? '5000', 10),
    extensionMaxApiCalls: parseInt(process.env.AIMEAT_EXT_MAX_API_CALLS ?? '500', 10),
    extensionMaxDebitPerCall: parseInt(process.env.AIMEAT_EXT_MAX_DEBIT ?? '100', 10),
    extensionMaxCodeSizeKb: parseInt(process.env.AIMEAT_EXT_MAX_CODE_SIZE_KB ?? '256', 10),
    extensionMaxInstalled: parseInt(process.env.AIMEAT_EXT_MAX_INSTALLED ?? '20', 10),
    maxExtensionsPerOwner: parseInt(process.env.AIMEAT_MAX_EXTENSIONS_PER_OWNER || '10', 10),

    // Service Generator
    generatorEnabled: process.env.AIMEAT_GENERATOR_ENABLED !== 'false',

    // Foundry (prompt-driven service builder)
    foundryEnabled: process.env.AIMEAT_FOUNDRY_ENABLED
      ? process.env.AIMEAT_FOUNDRY_ENABLED !== 'false'
      : (process.env.AIMEAT_GENERATOR_ENABLED !== 'false'),

    // Prompt Calibrator
    calibratorEnabled: process.env.AIMEAT_CALIBRATOR_ENABLED !== 'false',

    // Cortex Extensions (Manifest-based)
    cortexEnabled: process.env.AIMEAT_CORTEX_ENABLED !== 'false',
    cortexMaxInstalled: parseInt(process.env.AIMEAT_CORTEX_MAX_INSTALLED ?? '50', 10),
    cortexMaxLibSizeKb: parseInt(process.env.AIMEAT_CORTEX_MAX_LIB_SIZE_KB ?? '512', 10),

    // Packages & Templates
    packagesEnabled: process.env.AIMEAT_PACKAGES_ENABLED !== 'false',
    packageCreateRole: (process.env.AIMEAT_PACKAGE_CREATE_ROLE as 'operator' | 'owner') || 'operator',
    packageMaxSizeMb: parseInt(process.env.AIMEAT_PACKAGE_MAX_SIZE_MB ?? '50', 10),
    packageMaxComponents: parseInt(process.env.AIMEAT_PACKAGE_MAX_COMPONENTS ?? '20', 10),
    packageMaxPerAuthor: parseInt(process.env.AIMEAT_PACKAGE_MAX_PER_AUTHOR ?? '50', 10),
    templatesEnabled: process.env.AIMEAT_TEMPLATES_ENABLED !== 'false',
    templateReviewsEnabled: process.env.AIMEAT_TEMPLATE_REVIEWS_ENABLED !== 'false',
    templateDiscussionsEnabled: process.env.AIMEAT_TEMPLATE_DISCUSSIONS_ENABLED !== 'false',
    packageFederationEnabled: process.env.AIMEAT_PACKAGE_FEDERATION_ENABLED === 'true',
    packageFederationAutoAccept: process.env.AIMEAT_PACKAGE_FEDERATION_AUTO_ACCEPT === 'true',

    // Portfolio
    portfolioEnabled: process.env.AIMEAT_PORTFOLIO !== 'false',
    portfolioMaxSizeKb: parseInt(process.env.AIMEAT_PORTFOLIO_MAX_SIZE_KB ?? '512', 10),
    portfolioMaxImages: parseInt(process.env.AIMEAT_PORTFOLIO_MAX_IMAGES ?? '20', 10),

    // CORS
    capabilityPublishing: (process.env.AIMEAT_CAPABILITY_PUBLISHING ?? 'disabled') as 'disabled' | 'self_only' | 'moderated' | 'open',
    capabilityPublishers: (process.env.AIMEAT_CAPABILITY_PUBLISHERS ?? 'all_users') as 'all_users' | 'trusted_only' | 'allowlist',
    capabilityMinPublisherTrust: parseInt(process.env.AIMEAT_CAPABILITY_MIN_PUBLISHER_TRUST ?? '50', 10),
    capabilityPublisherAllowlist: (process.env.AIMEAT_CAPABILITY_PUBLISHER_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean),
    capabilityWebhooks: (process.env.AIMEAT_CAPABILITY_WEBHOOKS ?? 'disabled') as 'disabled' | 'allowlist_only' | 'open',
    capabilityWebhookDomainAllowlist: (process.env.AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean),
    capabilityLogRetentionDays: parseInt(process.env.AIMEAT_CAPABILITY_LOG_RETENTION_DAYS ?? '30', 10),

    // Agent Tasks (Phase 1)
    // Default 2h: orchestrated/multi-agent tasks (e.g. aimeat-app-conductor running
    // the full generator pipeline) can legitimately run quiet for long stretches; 30m
    // was too aggressive and falsely failed them. Override via env var if needed.
    taskStallThresholdMinutes: parseInt(process.env.AIMEAT_TASK_STALL_THRESHOLD_MINUTES ?? '120', 10),
    taskAutoArchive: process.env.AIMEAT_TASK_AUTO_ARCHIVE !== 'false',
    taskArchiveAfterHours: parseInt(process.env.AIMEAT_TASK_ARCHIVE_AFTER_HOURS ?? '24', 10),

    // Agent Directives (Phase 1)
    agentSystemPrinciples: JSON.parse(process.env.AIMEAT_AGENT_SYSTEM_PRINCIPLES || '["AIMEAT-first: prefer native systems", "Log all significant actions"]'),
    agentMaxTokensPerTask: parseInt(process.env.AIMEAT_AGENT_MAX_TOKENS_PER_TASK || '100000', 10),
    agentMandatoryLogging: process.env.AIMEAT_AGENT_MANDATORY_LOGGING !== 'false',
    agentAimeatFirstEnabled: process.env.AIMEAT_AGENT_AIMEAT_FIRST !== 'false',

    corsAllowedOrigins: (process.env.AIMEAT_CORS_ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim()).filter(Boolean),

    operator: {
      name: process.env.AIMEAT_OPERATOR_NAME ?? '',
      type: (process.env.AIMEAT_OPERATOR_TYPE as OperatorType) ?? 'natural_person',
      address: process.env.AIMEAT_OPERATOR_ADDRESS ?? '',
      country: process.env.AIMEAT_OPERATOR_COUNTRY ?? '',
      email: process.env.AIMEAT_OPERATOR_EMAIL ?? '',
      securityEmail: process.env.AIMEAT_OPERATOR_SECURITY_EMAIL ?? '',
      hostingName: process.env.AIMEAT_OPERATOR_HOSTING_NAME ?? '',
      hostingUrl: process.env.AIMEAT_OPERATOR_HOSTING_URL ?? '',
      hostingLocation: process.env.AIMEAT_OPERATOR_HOSTING_LOCATION ?? '',
      supervisoryName: process.env.AIMEAT_OPERATOR_SUPERVISORY_NAME ?? '',
      supervisoryUrl: process.env.AIMEAT_OPERATOR_SUPERVISORY_URL ?? '',
      effectiveDate: process.env.AIMEAT_OPERATOR_EFFECTIVE_DATE ?? '',
      policyVersion: process.env.AIMEAT_OPERATOR_POLICY_VERSION ?? '1.0',
    },

    // Consul
    consulEnabled: process.env.AIMEAT_CONSUL_ENABLED === 'true',
    consulUrl: process.env.AIMEAT_CONSUL_URL ?? 'http://localhost:8500',
    consulPrefix: process.env.AIMEAT_CONSUL_PREFIX ?? 'aimeat/config',
    consulToken: process.env.AIMEAT_CONSUL_TOKEN ?? '',
    consulWatchIntervalSeconds: parseInt(process.env.AIMEAT_CONSUL_WATCH_INTERVAL ?? '30', 10),
    consulDatacenter: process.env.AIMEAT_CONSUL_DATACENTER ?? '',

    rlGlobal,
    rlAuth,
    rlWork,
    rlMemory,
    rlBoards,
    rlOwners,
    rlGhii,
    rlFlags,
    rlAppeals,
    rlAdminSetup,
    rlFederation,
    rlCatalogue,
    rlAuthChallenge,

    rateLimits: {
      global: { windowMs: 1_000, max: rlGlobal },
      auth: { windowMs: 1_000, max: rlAuth },
      work: { windowMs: 1_000, max: rlWork },
      memory: { windowMs: 1_000, max: rlMemory },
      boards: { windowMs: 1_000, max: rlBoards },
      owners: { windowMs: 1_000, max: rlOwners },
      ghii: { windowMs: 1_000, max: rlGhii },
      flags: { windowMs: 1_000, max: rlFlags },
      appeals: { windowMs: 1_000, max: rlAppeals },
      adminSetup: { windowMs: 1_000, max: rlAdminSetup },
      federation: { windowMs: 1_000, max: rlFederation },
      catalogue: { windowMs: 1_000, max: rlCatalogue },
      authChallenge: { windowMs: 1_000, max: rlAuthChallenge },
      openrouter: { windowMs: 60_000, max: parseInt(process.env.AIMEAT_RL_OPENROUTER ?? '30', 10) },
      roleMultipliers: { operator: 10, owner: 2, agent: 1, anonymous: 0.5 },
    },
  };

  return { config, envKeys, fileKeys, cliKeys, fileName: fileSource?.name ?? null };
}

// ── Database Config Overrides ──

import type { Storage } from './storage/interface.js';

/**
 * Apply config overrides from database (called after storage is initialized).
 * Only applies to mutable fields — immutable fields are ignored.
 * Updates provenance registry.
 */
export async function applyConfigOverrides(
  config: AimeatConfig,
  storage: Storage,
  provenance: ConfigProvenance,
): Promise<{ applied: string[]; skipped: string[] }> {
  if (!storage.supportsConfigPersistence()) {
    return { applied: [], skipped: [] };
  }

  const dbValues = await storage.getAllConfigValues();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const [dotPath, rawValue] of Object.entries(dbValues)) {
    if (isImmutable(dotPath)) {
      skipped.push(dotPath);
      continue;
    }
    const field = MUTABLE_CONFIG_MAP[dotPath];
    if (!field) { skipped.push(dotPath); continue; }

    try {
      const value = parseConfigValue(field, rawValue);
      if (!field.validate(value)) { skipped.push(dotPath); continue; }
      (config as any)[field.key] = value;
      applied.push(dotPath);
    } catch {
      skipped.push(dotPath);
    }
  }

  // Sync rl* individual keys back to rateLimits tiers
  const rlKeys: Array<{ key: keyof AimeatConfig; tier: keyof Omit<RateLimitsConfig, 'roleMultipliers'> }> = [
    { key: 'rlGlobal', tier: 'global' },
    { key: 'rlAuth', tier: 'auth' },
    { key: 'rlWork', tier: 'work' },
    { key: 'rlMemory', tier: 'memory' },
    { key: 'rlBoards', tier: 'boards' },
    { key: 'rlOwners', tier: 'owners' },
    { key: 'rlGhii', tier: 'ghii' },
    { key: 'rlFlags', tier: 'flags' },
    { key: 'rlAppeals', tier: 'appeals' },
    { key: 'rlAdminSetup', tier: 'adminSetup' },
    { key: 'rlFederation', tier: 'federation' },
    { key: 'rlCatalogue', tier: 'catalogue' },
    { key: 'rlAuthChallenge', tier: 'authChallenge' },
  ];
  for (const { key, tier } of rlKeys) {
    const val = config[key] as number;
    if (typeof val === 'number' && val >= 1) {
      (config.rateLimits[tier] as RateLimitTier).max = val;
    }
  }

  if (applied.length > 0) provenance.markDatabase(applied);
  return { applied, skipped };
}

/**
 * Required operator fields that MUST be set for the privacy page to be
 * served publicly. Returns the list of missing field names, or an empty
 * array if everything is in place.
 *
 * Used by the `/v1/privacy` route handler in `src/routes/portal.ts` to
 * return 503 instead of silently shipping a partly-filled-in policy.
 *
 * Required because every running AIMEAT node identifies the operator as
 * the GDPR data controller. AIMEAT is self-hostable open source; nodes
 * must not ship the upstream author's name and address as a default.
 */
export function missingOperatorConfig(operator: OperatorConfig): string[] {
  const required: Array<keyof OperatorConfig> = [
    'name',
    'address',
    'country',
    'email',
    'hostingName',
    'hostingLocation',
    'supervisoryName',
    'supervisoryUrl',
    'effectiveDate',
  ];
  return required.filter(key => !operator[key] || operator[key].trim() === '');
}

/**
 * Human-readable label for the operator type, used in the privacy policy
 * Controller section ("Controller: X, a natural person").
 */
export function operatorTypeLabel(type: OperatorType, locale: 'en' | 'fi' = 'en'): string {
  const labels: Record<OperatorType, { en: string; fi: string }> = {
    natural_person: { en: 'a natural person', fi: 'luonnollinen henkilö' },
    company: { en: 'a company', fi: 'yritys' },
    organisation: { en: 'an organisation', fi: 'organisaatio' },
    association: { en: 'an association', fi: 'yhdistys' },
  };
  return labels[type][locale];
}
