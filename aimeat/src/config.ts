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
  storageQuotaMb: number;
  microMemoryQuotaKb: number;
  memoryOverageMorselsPerMbMonth: number;
  storageOverageMorselsPerGbMonth: number;
  maxOperatorMintPerDay: number;
  boardPostBaseCost: number;
  boardPostCostPerKb: number;
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

  // Personal Node support (operator-side)
  personalNodesEnabled: boolean;
  personalNodeMaxSlots: number;
  personalNodeMailboxQuotaMb: number;
  personalNodeMailboxRetentionDays: number;
  personalNodeHeartbeatIntervalMs: number;
  personalNodeOfflineThresholdMs: number;
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
    storageQuotaMb: parseInt(process.env.AIMEAT_STORAGE_QUOTA_MB ?? '100', 10),
    microMemoryQuotaKb: parseInt(process.env.AIMEAT_MICRO_MEMORY_QUOTA_KB ?? '500', 10),
    memoryOverageMorselsPerMbMonth: parseInt(process.env.AIMEAT_MEMORY_OVERAGE_MORSELS ?? '10', 10),
    storageOverageMorselsPerGbMonth: parseInt(process.env.AIMEAT_STORAGE_OVERAGE_MORSELS ?? '100', 10),
    maxOperatorMintPerDay: parseInt(process.env.AIMEAT_MAX_OPERATOR_MINT_PER_DAY ?? '10000', 10),
    boardPostBaseCost: parseInt(process.env.AIMEAT_BOARD_POST_BASE_COST ?? '5', 10),
    boardPostCostPerKb: parseInt(process.env.AIMEAT_BOARD_POST_COST_PER_KB ?? '2', 10),
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
    personalNodesEnabled: process.env.AIMEAT_PERSONAL_NODES_ENABLED !== 'false',
    personalNodeMaxSlots: parseInt(process.env.AIMEAT_PERSONAL_NODE_MAX_SLOTS ?? '100', 10),
    personalNodeMailboxQuotaMb: parseInt(process.env.AIMEAT_PERSONAL_MAILBOX_QUOTA_MB ?? '50', 10),
    personalNodeMailboxRetentionDays: parseInt(process.env.AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS ?? '7', 10),
    personalNodeHeartbeatIntervalMs: parseInt(process.env.AIMEAT_PERSONAL_HEARTBEAT_MS ?? '30000', 10),
    personalNodeOfflineThresholdMs: parseInt(process.env.AIMEAT_PERSONAL_OFFLINE_MS ?? '300000', 10),
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
