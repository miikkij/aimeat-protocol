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

export type NodeType = 'full' | 'relay' | 'mirror';

export interface MeatConfig {
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
  extensionHooks: ExtensionHooks;
  rateLimits: RateLimitsConfig;
}

export function loadConfig(): MeatConfig {
  const nodeType = (process.env.MEAT_NODE_TYPE ?? 'full') as NodeType;
  if (!['full', 'relay', 'mirror'].includes(nodeType)) {
    throw new Error(`Invalid MEAT_NODE_TYPE: ${nodeType}. Must be 'full', 'relay', or 'mirror'.`);
  }

  const port = parseInt(process.env.MEAT_PORT ?? '40050', 10);

  return {
    port,
    baseUrl: process.env.MEAT_BASE_URL ?? `http://localhost:${port}`,
    nodeId: process.env.MEAT_NODE_ID ?? 'meat-local-001-dev',
    nodeType,
    dbUrl: process.env.DATABASE_URL ?? null,
    adminPassword: process.env.MEAT_ADMIN_PASSWORD ?? null,
    devMode: process.env.MEAT_DEV_MODE === 'true',
    anonymousMode: process.env.MEAT_ANONYMOUS === 'true',
    jwtTtlSeconds: parseInt(process.env.MEAT_JWT_TTL ?? '3600', 10),
    welcomeBonus: parseInt(process.env.MEAT_WELCOME_BONUS ?? '100', 10),
    dailyAllowance: parseInt(process.env.MEAT_DAILY_ALLOWANCE ?? '50', 10),
    dailyAllowanceCap: parseInt(process.env.MEAT_DAILY_ALLOWANCE_CAP ?? '500', 10),
    burnRate: parseFloat(process.env.MEAT_BURN_RATE ?? '0.10'),
    keyedBrowseEnabled: process.env.MEAT_KEYED_BROWSE !== 'false',
    extendedFeaturesEnabled: process.env.MEAT_EXTENDED_FEATURES !== 'false',
    maxRelayHops: parseInt(process.env.MEAT_MAX_RELAY_HOPS ?? '3', 10),
    depeeringGracePeriodHours: parseInt(process.env.MEAT_DEPEERING_GRACE_HOURS ?? '72', 10),
    keyCacheRefreshMinutes: parseInt(process.env.MEAT_KEY_CACHE_REFRESH_MINUTES ?? '5', 10),
    memoryQuotaMb: parseInt(process.env.MEAT_MEMORY_QUOTA_MB ?? '10', 10),
    storageQuotaMb: parseInt(process.env.MEAT_STORAGE_QUOTA_MB ?? '100', 10),
    microMemoryQuotaKb: parseInt(process.env.MEAT_MICRO_MEMORY_QUOTA_KB ?? '500', 10),
    memoryOverageMorselsPerMbMonth: parseInt(process.env.MEAT_MEMORY_OVERAGE_MORSELS ?? '10', 10),
    storageOverageMorselsPerGbMonth: parseInt(process.env.MEAT_STORAGE_OVERAGE_MORSELS ?? '100', 10),
    maxOperatorMintPerDay: parseInt(process.env.MEAT_MAX_OPERATOR_MINT_PER_DAY ?? '10000', 10),
    boardPostBaseCost: parseInt(process.env.MEAT_BOARD_POST_BASE_COST ?? '5', 10),
    boardPostCostPerKb: parseInt(process.env.MEAT_BOARD_POST_COST_PER_KB ?? '2', 10),
    webhookMaxRetries: parseInt(process.env.MEAT_WEBHOOK_MAX_RETRIES ?? '5', 10),
    workQueueMaxPending: parseInt(process.env.MEAT_WORK_QUEUE_MAX_PENDING ?? '10', 10),
    otkTtlMs: parseInt(process.env.MEAT_OTK_TTL_MS ?? '300000', 10),
    otkGraceMs: parseInt(process.env.MEAT_OTK_GRACE_MS ?? '60000', 10),
    maxUrlLength: parseInt(process.env.MEAT_MAX_URL_LENGTH ?? '8192', 10),
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
    rateLimits: {
      global: { windowMs: 60_000, max: parseInt(process.env.MEAT_RL_GLOBAL ?? '200', 10) },
      auth: { windowMs: 60_000, max: parseInt(process.env.MEAT_RL_AUTH ?? '20', 10) },
      work: { windowMs: 60_000, max: parseInt(process.env.MEAT_RL_WORK ?? '60', 10) },
      memory: { windowMs: 60_000, max: parseInt(process.env.MEAT_RL_MEMORY ?? '120', 10) },
      boards: { windowMs: 60_000, max: parseInt(process.env.MEAT_RL_BOARDS ?? '60', 10) },
      roleMultipliers: { operator: 10, owner: 2, agent: 1, anonymous: 0.5 },
    },
  };
}
