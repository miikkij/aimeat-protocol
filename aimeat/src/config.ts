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
  roleMultipliers: RoleMultipliers;
}

export type NodeType = 'full' | 'relay' | 'mirror' | 'personal';
export type FederationRole = 'operator' | 'contributor' | 'standalone';

export interface AimeatConfig {
  port: number;
  baseUrl: string;
  nodeId: string;
  nodeType: NodeType;
  dbUrl: string | null;
  storageProvider: 'memory' | 'sqlite' | 'mongodb';
  sqlitePath: string;
  adminPassword: string | null;
  devMode: boolean;
  anonymousMode: boolean;
  jwtTtlSeconds: number;
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

  // Federation role
  federationRole: FederationRole;
  genesisUrl: string | null;

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

  // Personal Node support (operator-side)
  personalNodesEnabled: boolean;
  personalNodeMaxSlots: number;
  personalNodeMailboxQuotaMb: number;
  personalNodeMailboxRetentionDays: number;
  personalNodeHeartbeatIntervalMs: number;
  personalNodeOfflineThresholdMs: number;
  personalNodeRequestTimeoutMs: number;

  // Email / SMTP (Phase 1.1)
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string;
  smtpSecure: boolean;
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
  vcIssuerDid: string;

  // Cross-Federation (Phase 3.4)
  crossFederationEnabled: boolean;
  maxGenesisPeers: number;
  genesisSyncIntervalHours: number;

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

  // Prometheus Metrics
  metricsEnabled: boolean;
  metricsAccess: 'public' | 'authenticated' | 'operator';

  // Node Extensions (V8 Isolates)
  extensionsEnabled: boolean;
  extensionMaxMemoryMb: number;
  extensionTimeoutMs: number;
  extensionMaxApiCalls: number;
  extensionMaxCodeSizeKb: number;
  extensionMaxInstalled: number;

  // Cortex Extensions (Manifest-based)
  cortexEnabled: boolean;
  cortexMaxInstalled: number;
  cortexMaxLibSizeKb: number;

  // Portfolio
  portfolioEnabled: boolean;
  portfolioMaxSizeKb: number;
  portfolioMaxImages: number;

  // CORS
  corsAllowedOrigins: string[];
}

export function loadConfig(): AimeatConfig {
  const nodeType = (process.env.AIMEAT_NODE_TYPE ?? 'full') as NodeType;
  if (!['full', 'relay', 'mirror', 'personal'].includes(nodeType)) {
    throw new Error(`Invalid AIMEAT_NODE_TYPE: ${nodeType}. Must be 'full', 'relay', 'mirror', or 'personal'.`);
  }

  const port = parseInt(process.env.AIMEAT_PORT ?? '40050', 10);

  return {
    port,
    baseUrl: process.env.AIMEAT_BASE_URL ?? `http://localhost:${port}`,
    nodeId: process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev',
    nodeType,
    dbUrl: process.env.DATABASE_URL ?? null,
    storageProvider: (process.env.AIMEAT_STORAGE ?? 'memory') as 'memory' | 'sqlite' | 'mongodb',
    sqlitePath: process.env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db',
    adminPassword: process.env.AIMEAT_ADMIN_PASSWORD ?? null,
    devMode: process.env.AIMEAT_DEV_MODE === 'true',
    anonymousMode: process.env.AIMEAT_ANONYMOUS === 'true',
    jwtTtlSeconds: parseInt(process.env.AIMEAT_JWT_TTL ?? '3600', 10),
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
    microMemoryMaxValueSizeBytes: parseInt(process.env.AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE ?? '16384', 10),
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
    personalNodesEnabled: process.env.AIMEAT_PERSONAL_NODES_ENABLED !== 'false',
    personalNodeMaxSlots: parseInt(process.env.AIMEAT_PERSONAL_NODE_MAX_SLOTS ?? '100', 10),
    personalNodeMailboxQuotaMb: parseInt(process.env.AIMEAT_PERSONAL_MAILBOX_QUOTA_MB ?? '50', 10),
    personalNodeMailboxRetentionDays: parseInt(process.env.AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS ?? '7', 10),
    personalNodeHeartbeatIntervalMs: parseInt(process.env.AIMEAT_PERSONAL_HEARTBEAT_MS ?? '30000', 10),
    personalNodeOfflineThresholdMs: parseInt(process.env.AIMEAT_PERSONAL_OFFLINE_MS ?? '300000', 10),
    personalNodeRequestTimeoutMs: parseInt(process.env.AIMEAT_PERSONAL_REQUEST_TIMEOUT_MS ?? '60000', 10),
    smtpHost: process.env.AIMEAT_SMTP_HOST ?? null,
    smtpPort: parseInt(process.env.AIMEAT_SMTP_PORT ?? '587', 10),
    smtpUser: process.env.AIMEAT_SMTP_USER ?? null,
    smtpPass: process.env.AIMEAT_SMTP_PASS ?? null,
    smtpFrom: process.env.AIMEAT_SMTP_FROM ?? 'AIMEAT <noreply@localhost>',
    smtpSecure: process.env.AIMEAT_SMTP_SECURE === 'true',
    emailConfirmationRequired: process.env.AIMEAT_EMAIL_CONFIRMATION_REQUIRED === 'true',
    emailEnabled: (process.env.AIMEAT_SMTP_HOST ?? null) !== null,
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
    vcIssuerDid: process.env.AIMEAT_VC_ISSUER_DID ?? '',
    crossFederationEnabled: process.env.AIMEAT_CROSS_FEDERATION_ENABLED !== 'false',
    maxGenesisPeers: parseInt(process.env.AIMEAT_MAX_GENESIS_PEERS ?? '10', 10),
    genesisSyncIntervalHours: parseInt(process.env.AIMEAT_GENESIS_SYNC_INTERVAL_HOURS ?? '6', 10),
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
    defaultAgentScopes: (process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? 'memory:read,memory:write,catalogue:read').split(',').map(s => s.trim()),
    maxAgentScopes: (process.env.AIMEAT_MAX_AGENT_SCOPES ?? '*').split(',').map(s => s.trim()),

    // Node Extensions (V8 Isolates)
    extensionsEnabled: process.env.AIMEAT_EXTENSIONS_ENABLED === 'true',
    extensionMaxMemoryMb: parseInt(process.env.AIMEAT_EXT_MAX_MEMORY_MB ?? '64', 10),
    extensionTimeoutMs: parseInt(process.env.AIMEAT_EXT_TIMEOUT_MS ?? '5000', 10),
    extensionMaxApiCalls: parseInt(process.env.AIMEAT_EXT_MAX_API_CALLS ?? '50', 10),
    extensionMaxCodeSizeKb: parseInt(process.env.AIMEAT_EXT_MAX_CODE_SIZE_KB ?? '256', 10),
    extensionMaxInstalled: parseInt(process.env.AIMEAT_EXT_MAX_INSTALLED ?? '20', 10),

    // Cortex Extensions (Manifest-based)
    cortexEnabled: process.env.AIMEAT_CORTEX_ENABLED !== 'false',
    cortexMaxInstalled: parseInt(process.env.AIMEAT_CORTEX_MAX_INSTALLED ?? '50', 10),
    cortexMaxLibSizeKb: parseInt(process.env.AIMEAT_CORTEX_MAX_LIB_SIZE_KB ?? '512', 10),

    // Portfolio
    portfolioEnabled: process.env.AIMEAT_PORTFOLIO !== 'false',
    portfolioMaxSizeKb: parseInt(process.env.AIMEAT_PORTFOLIO_MAX_SIZE_KB ?? '512', 10),
    portfolioMaxImages: parseInt(process.env.AIMEAT_PORTFOLIO_MAX_IMAGES ?? '20', 10),

    // CORS
    corsAllowedOrigins: (process.env.AIMEAT_CORS_ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim()).filter(Boolean),

    rateLimits: {
      global: { windowMs: 1_000, max: parseInt(process.env.AIMEAT_RL_GLOBAL ?? '300', 10) },
      auth: { windowMs: 1_000, max: parseInt(process.env.AIMEAT_RL_AUTH ?? '20', 10) },
      work: { windowMs: 1_000, max: parseInt(process.env.AIMEAT_RL_WORK ?? '60', 10) },
      memory: { windowMs: 1_000, max: parseInt(process.env.AIMEAT_RL_MEMORY ?? '120', 10) },
      boards: { windowMs: 1_000, max: parseInt(process.env.AIMEAT_RL_BOARDS ?? '60', 10) },
      roleMultipliers: { operator: 10, owner: 2, agent: 1, anonymous: 0.5 },
    },
  };
}
