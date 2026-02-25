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

export interface MeatConfig {
  port: number;
  nodeId: string;
  dbUrl: string | null;
  adminPassword: string | null;
  jwtTtlSeconds: number;
  welcomeBonus: number;
  dailyAllowance: number;
  dailyAllowanceCap: number;
  burnRate: number;
  keyedBrowseEnabled: boolean;
  extensionHooks: ExtensionHooks;
}

export function loadConfig(): MeatConfig {
  return {
    port: parseInt(process.env.MEAT_PORT ?? '3117', 10),
    nodeId: process.env.MEAT_NODE_ID ?? 'meat-local-001-dev',
    dbUrl: process.env.DATABASE_URL ?? null,
    adminPassword: process.env.MEAT_ADMIN_PASSWORD ?? null,
    jwtTtlSeconds: parseInt(process.env.MEAT_JWT_TTL ?? '3600', 10),
    welcomeBonus: parseInt(process.env.MEAT_WELCOME_BONUS ?? '100', 10),
    dailyAllowance: parseInt(process.env.MEAT_DAILY_ALLOWANCE ?? '50', 10),
    dailyAllowanceCap: parseInt(process.env.MEAT_DAILY_ALLOWANCE_CAP ?? '500', 10),
    burnRate: parseFloat(process.env.MEAT_BURN_RATE ?? '0.10'),
    keyedBrowseEnabled: process.env.MEAT_KEYED_BROWSE !== 'false',
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
  };
}
