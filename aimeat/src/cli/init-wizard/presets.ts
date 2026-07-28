/**
 * @file src/cli/init-wizard/presets.ts
 * @description Use-case preset defaults and CONFIG_DEFAULTS map for the `aimeat init` wizard. Extracted from src/cli/init-wizard.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/cli/init-wizard.ts (max-file-lines)
 */

import type { AimeatConfig } from '../../config.js';

// ── Use-case preset defaults ────────────────────────────────────────

export type UseCase = 'public' | 'personal' | 'dev' | 'custom';

export interface Preset {
  nodeId: string;
  port: number;
  baseUrl: string;
  dbUrl: string;
  adminPassword: string;
  anonymousMode: boolean;
  devMode: boolean;
  extendedFeatures: boolean;
}

export function buildPresets(cfg: AimeatConfig): Record<Exclude<UseCase, 'custom'>, Preset> {
  return {
    public: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'aimeat-fi-001-genesis',
      port: cfg.port,
      baseUrl: cfg.baseUrl.startsWith('http://localhost') ? '' : cfg.baseUrl,
      dbUrl: cfg.dbUrl ?? '',
      adminPassword: '',
      anonymousMode: cfg.anonymousMode,
      devMode: false,
      extendedFeatures: cfg.extendedFeaturesEnabled,
    },
    personal: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'aimeat-fi-001-home',
      port: cfg.port,
      baseUrl: `http://localhost:${cfg.port}`,
      dbUrl: cfg.dbUrl ?? '',
      adminPassword: '',
      anonymousMode: true,
      devMode: false,
      extendedFeatures: cfg.extendedFeaturesEnabled,
    },
    dev: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'aimeat-local-001-dev',
      port: cfg.port,
      baseUrl: `http://localhost:${cfg.port}`,
      dbUrl: cfg.dbUrl ?? '',
      adminPassword: '',
      anonymousMode: true,
      devMode: true,
      extendedFeatures: cfg.extendedFeaturesEnabled,
    },
  };
}

// Defaults from config.ts for summary comparison
export const CONFIG_DEFAULTS: Record<string, string> = {
  AIMEAT_NODE_ID: 'aimeat-local-001-dev',
  AIMEAT_PORT: '40050',
  AIMEAT_NODE_TYPE: 'full',
  AIMEAT_BASE_URL: '',
  AIMEAT_STORAGE: 'memory',
  AIMEAT_SQLITE_PATH: './data/aimeat.db',
  DATABASE_URL: '',
  AIMEAT_ADMIN_PASSWORD: '',
  AIMEAT_DEV_MODE: 'false',
  AIMEAT_ANONYMOUS: 'false',
  AIMEAT_EXTENDED_FEATURES: 'true',
  AIMEAT_KEYED_BROWSE: 'true',
  AIMEAT_JWT_TTL: '3600',
  AIMEAT_ACCESS_TTL: '900',
  AIMEAT_REFRESH_IDLE_DAYS: '30',
  AIMEAT_REFRESH_ABSOLUTE_DAYS: '90',
  AIMEAT_REFRESH_GRACE_MS: '60000',
  AIMEAT_WELCOME_BONUS: '100',
  AIMEAT_DAILY_ALLOWANCE: '50',
  AIMEAT_DAILY_ALLOWANCE_CAP: '500',
  AIMEAT_BURN_RATE: '0.10',
  AIMEAT_MAX_OPERATOR_MINT_PER_DAY: '10000',
  AIMEAT_BOARD_POST_BASE_COST: '5',
  AIMEAT_BOARD_POST_COST_PER_KB: '2',
  AIMEAT_MARKETPLACE_FEE_MODE: 'operator',
  AIMEAT_COMMERCE_FEE_PERCENT: '',
  AIMEAT_MEMORY_QUOTA_MB: '10',
  AIMEAT_MEMORY_MAX_VALUE_SIZE_KB: '1024',
  AIMEAT_MEMORY_MAX_KEYS: '1000',
  AIMEAT_STORAGE_QUOTA_MB: '100',
  AIMEAT_STORAGE_MAX_FILE_SIZE_MB: '10',
  AIMEAT_MICRO_MEMORY_MAX_SETS: '50',
  AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET: '100',
  AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE: '16384',
  AIMEAT_MAX_ACTIONS_PER_AGENT: '20',
  AIMEAT_APP_MAX_SIZE_MB: '5',
  AIMEAT_AGENT_PORTING_FEE: '50',
  AIMEAT_MAX_RELAY_HOPS: '3',
  AIMEAT_FEDERATION_ROLE: 'standalone',
  AIMEAT_GENESIS_URL: '',
  AIMEAT_CROSS_FEDERATION_ENABLED: 'true',
  AIMEAT_MAX_GENESIS_PEERS: '10',
  AIMEAT_GENESIS_SYNC_INTERVAL_HOURS: '6',
  AIMEAT_INDEXNOW_KEY: '',
  AIMEAT_CONSENT_ENABLED: 'true',
  AIMEAT_CONSENT_MAX_PER_USER: '100',
  AIMEAT_CONSENT_AUDIT_RETENTION_DAYS: '365',
  AIMEAT_COOKIE_CONSENT_ENABLED: 'false',
  AIMEAT_COOKIE_CONSENT_CATEGORIES: 'necessary',
  AIMEAT_COOKIE_CONSENT_POLICY_URL: '',
  AIMEAT_SITE_ENABLED: 'true',
  AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB: '512',
  AIMEAT_SITE_CACHE_TTL_SECONDS: '60',
  AIMEAT_PUSH_ENABLED: 'false',
  AIMEAT_VAPID_PUBLIC_KEY: '',
  AIMEAT_VAPID_PRIVATE_KEY: '',
  AIMEAT_VAPID_SUBJECT: 'mailto:admin@aimeat.example.com',
  AIMEAT_PUSH_NOTIFY_TYPES: 'work_assignment,action_request',
  AIMEAT_PUSH_COOLDOWN_MIN: '5',
  AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE: '5',
  AIMEAT_PUSH_MAX_FAILURES: '3',
  AIMEAT_SMTP_HOST: '',
  AIMEAT_SMTP_PORT: '587',
  AIMEAT_SMTP_USER: '',
  AIMEAT_SMTP_PASS: '',
  AIMEAT_SMTP_FROM: 'AIMEAT <noreply@localhost>',
  AIMEAT_SMTP_SECURE: 'false',
  // Operator info (rendered into /v1/privacy)
  AIMEAT_OPERATOR_NAME: '',
  AIMEAT_OPERATOR_TYPE: 'natural_person',
  AIMEAT_OPERATOR_ADDRESS: '',
  AIMEAT_OPERATOR_COUNTRY: '',
  AIMEAT_OPERATOR_EMAIL: '',
  AIMEAT_OPERATOR_SECURITY_EMAIL: '',
  AIMEAT_OPERATOR_HOSTING_NAME: '',
  AIMEAT_OPERATOR_HOSTING_URL: '',
  AIMEAT_OPERATOR_HOSTING_LOCATION: '',
  AIMEAT_OPERATOR_SUPERVISORY_NAME: '',
  AIMEAT_OPERATOR_SUPERVISORY_URL: '',
  AIMEAT_OPERATOR_EFFECTIVE_DATE: '',
  AIMEAT_OPERATOR_POLICY_VERSION: '1.0',
  // Public-page links. Empty is a complete configuration: each unset value hides its link,
  // nav item or section, so a fresh node never advertises another operator's apps. The
  // wizard does not ask for these — an operator fills them in once they have apps to point at.
  AIMEAT_SITE_LEARN_URL: '',
  AIMEAT_SITE_EXCHANGE_URL: '',
  AIMEAT_SITE_ASSESSMENT_URL: '',
  AIMEAT_SITE_ROADMAP_URL: '',
  AIMEAT_SITE_PAPER_URL: '',
  AIMEAT_SITE_CRM_URL: '',
  AIMEAT_SITE_RADAR_URL: '',
  AIMEAT_SITE_BRIEFING_URL: '',
  AIMEAT_SITE_API_ACCELERATOR_URL: '',
  AIMEAT_SITE_PLAYBOOKS_URL: '',
  AIMEAT_SITE_SHOWCASE_URL: '',
  AIMEAT_SITE_CONTACTS: '',
  AIMEAT_SITE_CONTACT_NAME: '',
  AIMEAT_SITE_CONTACT_ROLE: '',
  AIMEAT_SITE_CONTACT_EMAIL: '',
  AIMEAT_SITE_CONTACT_PHONE: '',
  AIMEAT_EMAIL_RATE_LIMIT_MIN: '30',
  AIMEAT_METRICS_ENABLED: 'false',
  AIMEAT_METRICS_ACCESS: 'operator',
  AIMEAT_CORS_ALLOWED_ORIGINS: '*',
  AIMEAT_TOTP_ENABLED: 'true',
  AIMEAT_TOTP_ISSUER: 'AIMEAT',
  AIMEAT_TOTP_MAX_FAILED: '5',
  AIMEAT_TOTP_LOCKOUT_SECONDS: '300',
  AIMEAT_MATCHING_ENABLED: 'true',
  AIMEAT_MATCH_INTERVAL_HOURS: '24',
  AIMEAT_MATCH_THRESHOLD: '0.5',
  AIMEAT_MATCH_MAX_SUGGESTIONS: '5',
  AIMEAT_MATCH_MAX_DISTANCE_KM: '100',
  AIMEAT_MARKETPLACE_ENABLED: 'true',
  AIMEAT_MARKETPLACE_LISTING_FEE: '2',
  AIMEAT_MARKETPLACE_TX_FEE_PERCENT: '5',
  AIMEAT_MARKETPLACE_ESCROW: 'true',
  AIMEAT_REALTIME_ENABLED: 'true',
  AIMEAT_REALTIME_MAX_ROOMS: '100',
  AIMEAT_REALTIME_MAX_PEERS_PER_ROOM: '20',
  AIMEAT_EXTENSIONS_ENABLED: 'false',
  AIMEAT_EXT_MAX_MEMORY_MB: '64',
  AIMEAT_EXT_TIMEOUT_MS: '5000',
  AIMEAT_EXT_INSTALL_ROLE: 'operator',
  AIMEAT_MAX_EXTENSIONS_PER_OWNER: '10',
  AIMEAT_APP_HOST: '',
  AIMEAT_APP_ORIGIN_ENABLED: 'false',
  AIMEAT_PORTFOLIO_HOST: '',
  AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'false',
};
