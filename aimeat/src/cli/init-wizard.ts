/**
 * Interactive `aimeat init` wizard using @clack/prompts.
 * Guides users through node configuration with use-case-based defaults.
 * Reads existing .env / config values so users see their current settings.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import ini from 'ini';
import { createT, type Locale, type TFunction } from '../i18n.js';
import type { AimeatConfig } from '../config.js';
import { ENV_TO_DOT_PATH } from '../services/config-schema.js';

// Package root: from dist/src/cli/init-wizard.js -> go up 3 levels to aimeat/
const __pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ── Use-case preset defaults ────────────────────────────────────────

type UseCase = 'public' | 'personal' | 'dev' | 'custom';

interface Preset {
  nodeId: string;
  port: number;
  baseUrl: string;
  dbUrl: string;
  adminPassword: string;
  anonymousMode: boolean;
  devMode: boolean;
  extendedFeatures: boolean;
}

function buildPresets(cfg: AimeatConfig): Record<Exclude<UseCase, 'custom'>, Preset> {
  return {
    public: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'my-node-001',
      port: cfg.port,
      baseUrl: cfg.baseUrl.startsWith('http://localhost') ? '' : cfg.baseUrl,
      dbUrl: cfg.dbUrl ?? '',
      adminPassword: '',
      anonymousMode: cfg.anonymousMode,
      devMode: false,
      extendedFeatures: cfg.extendedFeaturesEnabled,
    },
    personal: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'personal-home',
      port: cfg.port,
      baseUrl: `http://localhost:${cfg.port}`,
      dbUrl: cfg.dbUrl ?? '',
      adminPassword: '',
      anonymousMode: true,
      devMode: false,
      extendedFeatures: cfg.extendedFeaturesEnabled,
    },
    dev: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'dev-local',
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
const CONFIG_DEFAULTS: Record<string, string> = {
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
  AIMEAT_GENERATOR_ENABLED: 'true',
};

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse a .env file into key-value pairs (ignores comments, handles quotes). */
function parseEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(path)) return result;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Handle quoted values: extract content between first pair of quotes
    if (val.startsWith('"')) {
      const closeIdx = val.indexOf('"', 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else if (val.startsWith("'")) {
      const closeIdx = val.indexOf("'", 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else {
      // Unquoted: strip inline comments
      const hashIdx = val.indexOf('#');
      if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    }
    result[key] = val;
  }
  return result;
}

function bail(t: TFunction): never {
  p.cancel(t('init.cancelled'));
  process.exit(0);
}

function checkCancel<T>(value: T | symbol, t: TFunction): T {
  if (p.isCancel(value)) bail(t);
  return value as T;
}

// Note: @clack/prompts calls validate() with undefined when input is empty,
// BEFORE applying defaultValue. So all validators must allow empty/undefined
// when a defaultValue is set (the prompt handles it).

function validatePort(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;  // empty = will use defaultValue
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1 || n > 65535) return t('init.portInvalid');
}

function validateUrl(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  if (!val.startsWith('http://') && !val.startsWith('https://')) {
    return t('init.baseUrlInvalid');
  }
}

function validateDbUrl(val: string | undefined, t: TFunction, backend: 'mongodb' | 'postgresql' = 'mongodb'): string | undefined {
  if (!val) return;
  const ok = backend === 'postgresql'
    ? (val.startsWith('postgresql://') || val.startsWith('postgres://'))
    : (val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'));
  if (!ok) {
    return t('init.dbUrlInvalid');
  }
}

function validatePositiveNum(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  const n = Number(val);
  if (isNaN(n) || n < 0) return t('init.numInvalid');
}

function validateBurnRate(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  const n = parseFloat(val);
  if (isNaN(n) || n < 0 || n > 1) return t('init.burnRateInvalid');
}

// ── .env generation ─────────────────────────────────────────────────

function generateEnvContent(settings: Record<string, string>): string {
  const lines: string[] = [
    '# AIMEAT Node Configuration',
    '# Generated by: aimeat init',
    '',
  ];

  const sections: Array<{ title: string; vars: Array<{ key: string; comment?: string }> }> = [
    {
      title: 'Node Identity',
      vars: [
        { key: 'AIMEAT_NODE_ID' },
        { key: 'AIMEAT_PORT' },
        { key: 'AIMEAT_NODE_TYPE' },
        { key: 'AIMEAT_BASE_URL', comment: 'Public URL (default: http://localhost:$PORT)' },
      ],
    },
    {
      title: 'Storage Backend',
      vars: [
        { key: 'AIMEAT_STORAGE', comment: 'Storage backend: memory (default), sqlite (file-based), mongodb (production)' },
        { key: 'AIMEAT_SQLITE_PATH', comment: 'SQLite database file path (when AIMEAT_STORAGE=sqlite)' },
        { key: 'DATABASE_URL', comment: 'MongoDB connection URL (when AIMEAT_STORAGE=mongodb)' },
      ],
    },
    {
      title: 'Operator / Admin',
      vars: [
        { key: 'AIMEAT_ADMIN_PASSWORD', comment: 'Auto-generated on startup if not set' },
      ],
    },
    {
      title: 'Modes',
      vars: [
        { key: 'AIMEAT_DEV_MODE' },
        { key: 'AIMEAT_ANONYMOUS' },
      ],
    },
    {
      title: 'Auth & Tokens',
      vars: [
        { key: 'AIMEAT_JWT_TTL', comment: 'Legacy / agent JWT lifetime in seconds (default: 1h)' },
        { key: 'AIMEAT_ACCESS_TTL', comment: 'Owner access-token lifetime in seconds (default: 15min)' },
        { key: 'AIMEAT_REFRESH_IDLE_DAYS', comment: 'Owner refresh-cookie idle window in days (default: 30)' },
        { key: 'AIMEAT_REFRESH_ABSOLUTE_DAYS', comment: 'Owner refresh-cookie hard cap in days (default: 90)' },
        { key: 'AIMEAT_REFRESH_GRACE_MS', comment: 'Refresh-rotation grace window in ms (default: 60s)' },
      ],
    },
    {
      title: 'Morsel Economy',
      vars: [
        { key: 'AIMEAT_WELCOME_BONUS' },
        { key: 'AIMEAT_DAILY_ALLOWANCE' },
        { key: 'AIMEAT_DAILY_ALLOWANCE_CAP' },
        { key: 'AIMEAT_BURN_RATE' },
        { key: 'AIMEAT_MAX_OPERATOR_MINT_PER_DAY' },
        { key: 'AIMEAT_BOARD_POST_BASE_COST' },
        { key: 'AIMEAT_BOARD_POST_COST_PER_KB' },
      ],
    },
    {
      title: 'Features',
      vars: [
        { key: 'AIMEAT_KEYED_BROWSE' },
        { key: 'AIMEAT_EXTENDED_FEATURES' },
      ],
    },
    {
      title: 'Quotas',
      vars: [
        { key: 'AIMEAT_MEMORY_QUOTA_MB' },
        { key: 'AIMEAT_MEMORY_MAX_VALUE_SIZE_KB', comment: 'Max size of a single memory value (KB)' },
        { key: 'AIMEAT_MEMORY_MAX_KEYS', comment: 'Max memory keys per agent' },
        { key: 'AIMEAT_STORAGE_QUOTA_MB' },
        { key: 'AIMEAT_STORAGE_MAX_FILE_SIZE_MB', comment: 'Max single file upload size (MB)' },
        { key: 'AIMEAT_MICRO_MEMORY_MAX_SETS', comment: 'Max micro-memory sets per agent' },
        { key: 'AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET', comment: 'Max keys per micro-memory set' },
        { key: 'AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE', comment: 'Max micro-memory value size (bytes)' },
        { key: 'AIMEAT_MAX_ACTIONS_PER_AGENT', comment: 'Max action definitions per agent' },
        { key: 'AIMEAT_APP_MAX_SIZE_MB', comment: 'Max app file size (MB)' },
        { key: 'AIMEAT_AGENT_PORTING_FEE', comment: 'Morsels charged for agent porting' },
      ],
    },
    {
      title: 'Federation',
      vars: [
        { key: 'AIMEAT_FEDERATION_ROLE', comment: 'operator = genesis directory | contributor = join genesis | standalone = independent' },
        { key: 'AIMEAT_GENESIS_URL', comment: 'Genesis node URL (for contributor role)' },
        { key: 'AIMEAT_MAX_RELAY_HOPS' },
        { key: 'AIMEAT_CROSS_FEDERATION_ENABLED', comment: 'Enable cross-federation genesis peering (connects independent nodes/clusters)' },
        { key: 'AIMEAT_MAX_GENESIS_PEERS', comment: 'Max genesis peer connections (1-100)' },
        { key: 'AIMEAT_GENESIS_SYNC_INTERVAL_HOURS', comment: 'Hours between catalogue sync with genesis peers (1-168)' },
      ],
    },
    {
      title: 'IndexNow (Bing/Yandex search indexing)',
      vars: [
        { key: 'AIMEAT_INDEXNOW_KEY', comment: 'Hex key for IndexNow. Generate: openssl rand -hex 16. After setting, run: pnpm indexnow' },
      ],
    },
    {
      title: 'Node Portal (Site)',
      vars: [
        { key: 'AIMEAT_SITE_ENABLED', comment: 'Enable custom HTML template portal at GET /' },
        { key: 'AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB', comment: 'Max template size in KB' },
        { key: 'AIMEAT_SITE_CACHE_TTL_SECONDS', comment: 'Resolved template cache TTL (0 = no cache)' },
      ],
    },
    {
      title: 'Push Notifications (REQ-007)',
      vars: [
        { key: 'AIMEAT_PUSH_ENABLED' },
        { key: 'AIMEAT_VAPID_PUBLIC_KEY', comment: 'Generate: npx web-push generate-vapid-keys' },
        { key: 'AIMEAT_VAPID_PRIVATE_KEY' },
        { key: 'AIMEAT_VAPID_SUBJECT' },
        { key: 'AIMEAT_PUSH_NOTIFY_TYPES', comment: 'Comma-separated message types that trigger push' },
        { key: 'AIMEAT_PUSH_COOLDOWN_MIN' },
        { key: 'AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE' },
        { key: 'AIMEAT_PUSH_MAX_FAILURES' },
        { key: 'AIMEAT_EMAIL_RATE_LIMIT_MIN' },
      ],
    },
    {
      title: 'Email / SMTP',
      vars: [
        { key: 'AIMEAT_SMTP_HOST' },
        { key: 'AIMEAT_SMTP_PORT' },
        { key: 'AIMEAT_SMTP_USER' },
        { key: 'AIMEAT_SMTP_PASS' },
        { key: 'AIMEAT_SMTP_FROM' },
        { key: 'AIMEAT_SMTP_SECURE' },
      ],
    },
    {
      title: 'Metrics & Observability (REQ-008)',
      vars: [
        { key: 'AIMEAT_METRICS_ENABLED', comment: 'Enable Prometheus metrics at GET /v1/metrics' },
        { key: 'AIMEAT_METRICS_ACCESS', comment: 'public | authenticated | operator' },
      ],
    },
    {
      title: 'CORS',
      vars: [
        { key: 'AIMEAT_CORS_ALLOWED_ORIGINS', comment: 'Comma-separated origins, or * for all' },
      ],
    },
    {
      title: 'TOTP / 2FA',
      vars: [
        { key: 'AIMEAT_TOTP_ENABLED', comment: 'Enable TOTP two-factor authentication' },
        { key: 'AIMEAT_TOTP_ISSUER', comment: 'Issuer name shown in authenticator apps' },
        { key: 'AIMEAT_TOTP_MAX_FAILED', comment: 'Max failed attempts before lockout' },
        { key: 'AIMEAT_TOTP_LOCKOUT_SECONDS', comment: 'Lockout duration (seconds)' },
      ],
    },
    {
      title: 'AI Matching',
      vars: [
        { key: 'AIMEAT_MATCHING_ENABLED', comment: 'Enable AI-powered interest matching' },
        { key: 'AIMEAT_MATCH_INTERVAL_HOURS', comment: 'Hours between matching runs' },
        { key: 'AIMEAT_MATCH_THRESHOLD', comment: 'Min similarity score (0-1)' },
        { key: 'AIMEAT_MATCH_MAX_SUGGESTIONS', comment: 'Max match suggestions per user' },
        { key: 'AIMEAT_MATCH_MAX_DISTANCE_KM', comment: 'Max distance for location matching (km)' },
      ],
    },
    {
      title: 'Marketplace',
      vars: [
        { key: 'AIMEAT_MARKETPLACE_ENABLED', comment: 'Enable marketplace features' },
        { key: 'AIMEAT_MARKETPLACE_LISTING_FEE', comment: 'Morsels charged to list an item' },
        { key: 'AIMEAT_MARKETPLACE_TX_FEE_PERCENT', comment: 'Transaction fee percentage' },
        { key: 'AIMEAT_MARKETPLACE_ESCROW', comment: 'Enable escrow for transactions' },
      ],
    },
    {
      title: 'Realtime P2P',
      vars: [
        { key: 'AIMEAT_REALTIME_ENABLED', comment: 'Enable realtime P2P signaling (WebRTC)' },
        { key: 'AIMEAT_REALTIME_MAX_ROOMS', comment: 'Max concurrent rooms' },
        { key: 'AIMEAT_REALTIME_MAX_PEERS_PER_ROOM', comment: 'Max peers per room' },
      ],
    },
    {
      title: 'Node Extensions (Sandboxed)',
      vars: [
        { key: 'AIMEAT_EXTENSIONS_ENABLED', comment: 'Enable sandboxed extension system' },
        { key: 'AIMEAT_EXT_MAX_MEMORY_MB', comment: 'Max memory per extension sandbox (MB)' },
        { key: 'AIMEAT_EXT_TIMEOUT_MS', comment: 'Extension execution timeout (ms)' },
      ],
    },
  ];

  for (const section of sections) {
    const hasValues = section.vars.some(v => v.key in settings);
    if (!hasValues) continue;

    lines.push(`# ${'─'.repeat(2)} ${section.title} ${'─'.repeat(Math.max(0, 55 - section.title.length))}`);

    for (const v of section.vars) {
      if (v.comment) lines.push(`# ${v.comment}`);
      if (v.key in settings) {
        const val = settings[v.key];
        const isNumOrBool = /^(\d+(\.\d+)?|true|false)$/.test(val);
        lines.push(`${v.key}=${isNumOrBool ? val : `"${val}"`}`);
      } else {
        lines.push(`# ${v.key}=`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateJsonContent(settings: Record<string, string>): string {
  const keyMap: Record<string, string> = {
    AIMEAT_NODE_ID: 'nodeId',
    AIMEAT_PORT: 'port',
    AIMEAT_NODE_TYPE: 'nodeType',
    AIMEAT_BASE_URL: 'baseUrl',
    AIMEAT_STORAGE: 'storageProvider',
    AIMEAT_SQLITE_PATH: 'sqlitePath',
    DATABASE_URL: 'db',
    AIMEAT_ADMIN_PASSWORD: 'adminPassword',
    AIMEAT_DEV_MODE: 'devMode',
    AIMEAT_ANONYMOUS: 'anonymousMode',
    AIMEAT_JWT_TTL: 'jwtTtlSeconds',
    AIMEAT_ACCESS_TTL: 'accessTtlSeconds',
    AIMEAT_REFRESH_IDLE_DAYS: 'refreshIdleDays',
    AIMEAT_REFRESH_ABSOLUTE_DAYS: 'refreshAbsoluteDays',
    AIMEAT_REFRESH_GRACE_MS: 'refreshGraceMs',
    AIMEAT_WELCOME_BONUS: 'welcomeBonus',
    AIMEAT_DAILY_ALLOWANCE: 'dailyAllowance',
    AIMEAT_DAILY_ALLOWANCE_CAP: 'dailyAllowanceCap',
    AIMEAT_BURN_RATE: 'burnRate',
    AIMEAT_MAX_OPERATOR_MINT_PER_DAY: 'maxOperatorMintPerDay',
    AIMEAT_BOARD_POST_BASE_COST: 'boardPostBaseCost',
    AIMEAT_BOARD_POST_COST_PER_KB: 'boardPostCostPerKb',
    AIMEAT_EXTENDED_FEATURES: 'extendedFeaturesEnabled',
    AIMEAT_KEYED_BROWSE: 'keyedBrowseEnabled',
    AIMEAT_MEMORY_QUOTA_MB: 'memoryQuotaMb',
    AIMEAT_MEMORY_MAX_VALUE_SIZE_KB: 'memoryMaxValueSizeKb',
    AIMEAT_MEMORY_MAX_KEYS: 'memoryMaxKeysPerAgent',
    AIMEAT_STORAGE_QUOTA_MB: 'storageQuotaMb',
    AIMEAT_STORAGE_MAX_FILE_SIZE_MB: 'storageMaxFileSizeMb',
    AIMEAT_MICRO_MEMORY_MAX_SETS: 'microMemoryMaxSetsPerAgent',
    AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET: 'microMemoryMaxKeysPerSet',
    AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE: 'microMemoryMaxValueSizeBytes',
    AIMEAT_MAX_ACTIONS_PER_AGENT: 'maxActionsPerAgent',
    AIMEAT_APP_MAX_SIZE_MB: 'appMaxSizeMb',
    AIMEAT_AGENT_PORTING_FEE: 'agentPortingFeeMorsels',
    AIMEAT_MAX_RELAY_HOPS: 'maxRelayHops',
    AIMEAT_FEDERATION_ROLE: 'federationRole',
    AIMEAT_GENESIS_URL: 'genesisUrl',
    AIMEAT_INDEXNOW_KEY: 'indexNowKey',
    AIMEAT_SITE_ENABLED: 'siteEnabled',
    AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB: 'siteMaxTemplateSizeKb',
    AIMEAT_SITE_CACHE_TTL_SECONDS: 'siteCacheTtlSeconds',
  };

  const cfg: Record<string, unknown> = {};
  for (const [envKey, val] of Object.entries(settings)) {
    const jsonKey = keyMap[envKey] ?? envKey;
    if (/^\d+$/.test(val)) cfg[jsonKey] = parseInt(val, 10);
    else if (/^\d+\.\d+$/.test(val)) cfg[jsonKey] = parseFloat(val);
    else if (val === 'true') cfg[jsonKey] = true;
    else if (val === 'false') cfg[jsonKey] = false;
    else cfg[jsonKey] = val;
  }

  return JSON.stringify(cfg, null, 2) + '\n';
}

function generateIniContent(settings: Record<string, string>): string {
  // Build INI structure using dot-path sections from ENV_TO_DOT_PATH
  const sections: Record<string, Record<string, string>> = {};
  for (const [envKey, val] of Object.entries(settings)) {
    const dotPath = ENV_TO_DOT_PATH[envKey];
    if (!dotPath) continue;
    const parts = dotPath.split('.');
    const section = parts.length > 1 ? parts.slice(0, -1).join('.') : 'node';
    const key = parts[parts.length - 1];
    if (!sections[section]) sections[section] = {};
    sections[section][key] = val;
  }
  // Add a comment header
  const header = '; AIMEAT Node Configuration (INI format)\n; Generated by aimeat init\n\n';
  return header + ini.stringify(sections);
}

// ── Wizard steps ────────────────────────────────────────────────────

async function askCoreSettings(
  t: TFunction,
  preset: Preset,
  useCase: UseCase,
  env: Record<string, string>,
): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};

  // Node ID — prefer existing env value, then preset
  const nodeIdDefault = env.AIMEAT_NODE_ID || preset.nodeId;
  const nodeId = checkCancel(
    await p.text({
      message: t('init.nodeId'),
      placeholder: nodeIdDefault,
      defaultValue: nodeIdDefault,
    }),
    t,
  );
  settings.AIMEAT_NODE_ID = nodeId;

  // Port — prefer existing env value
  const portDefault = env.AIMEAT_PORT || String(preset.port);
  const port = checkCancel(
    await p.text({
      message: t('init.port'),
      placeholder: portDefault,
      defaultValue: portDefault,
      validate: val => validatePort(val, t),
    }),
    t,
  );
  settings.AIMEAT_PORT = port;

  // Public URL — required for public nodes
  if (useCase === 'public') {
    const urlDefault = env.AIMEAT_BASE_URL || preset.baseUrl || '';
    const baseUrl = checkCancel(
      await p.text({
        message: t('init.baseUrl'),
        placeholder: urlDefault || 'https://mynode.example.com',
        ...(urlDefault ? { defaultValue: urlDefault } : {}),
        validate: val => {
          if (!val) return urlDefault ? undefined : t('init.baseUrlInvalid');
          return validateUrl(val, t);
        },
      }),
      t,
    );
    settings.AIMEAT_BASE_URL = baseUrl;
  } else if (useCase === 'custom') {
    const urlDefault = env.AIMEAT_BASE_URL || `http://localhost:${port}`;
    const baseUrl = checkCancel(
      await p.text({
        message: t('init.baseUrl'),
        placeholder: urlDefault,
        defaultValue: urlDefault,
        validate: val => validateUrl(val, t),
      }),
      t,
    );
    if (baseUrl && baseUrl !== `http://localhost:${port}`) {
      settings.AIMEAT_BASE_URL = baseUrl;
    }
  }

  // Storage backend selection
  const storageBackend = checkCancel(
    await p.select({
      message: t('init.storage_label'),
      options: [
        { value: 'memory', label: t('init.storage_memory') },
        { value: 'sqlite', label: t('init.storage_sqlite') },
        { value: 'mongodb', label: t('init.storage_mongodb') },
        { value: 'postgresql', label: t('init.storage_postgresql') },
      ],
      initialValue: useCase === 'dev' ? 'memory' : useCase === 'personal' ? 'sqlite' : 'mongodb',
    }),
    t,
  );
  settings.AIMEAT_STORAGE = storageBackend as string;

  // If sqlite, ask for path
  if (storageBackend === 'sqlite') {
    const sqlitePath = checkCancel(
      await p.text({
        message: t('init.sqlite_path_label'),
        placeholder: './data/aimeat.db',
        defaultValue: './data/aimeat.db',
      }),
      t,
    );
    settings.AIMEAT_SQLITE_PATH = sqlitePath;
  }

  // DATABASE_URL — when mongodb or postgresql storage is selected
  if (storageBackend === 'mongodb' || storageBackend === 'postgresql') {
    const dbBackend = storageBackend as 'mongodb' | 'postgresql';
    const samplePlaceholder = dbBackend === 'postgresql'
      ? 'postgresql://user:pass@localhost:5432/aimeat'
      : 'mongodb://user:pass@localhost:27017/aimeat';
    if (useCase === 'public') {
      const dbDefault = env.DATABASE_URL || preset.dbUrl || '';
      const dbUrl = checkCancel(
        await p.text({
          message: t('init.dbUrl'),
          placeholder: dbDefault || samplePlaceholder,
          ...(dbDefault ? { defaultValue: dbDefault } : {}),
          validate: val => {
            if (!val) return undefined;
            return validateDbUrl(val, t, dbBackend);
          },
        }),
        t,
      );
      if (dbUrl) settings.DATABASE_URL = dbUrl;
    } else {
      const dbDefault = env.DATABASE_URL || preset.dbUrl || '';
      const dbUrl = checkCancel(
        await p.text({
          message: t('init.dbUrl'),
          placeholder: dbDefault || samplePlaceholder,
          defaultValue: dbDefault,
          validate: val => validateDbUrl(val, t, dbBackend),
        }),
        t,
      );
      if (dbUrl) settings.DATABASE_URL = dbUrl;
    }
  }

  // Admin password — required for public, optional for others
  if (useCase === 'public') {
    const pw = checkCancel(
      await p.password({
        message: t('init.adminPassword'),
        validate: val => {
          if (!val || val.length < 8) return t('init.adminPasswordWeak');
        },
      }),
      t,
    );
    settings.AIMEAT_ADMIN_PASSWORD = pw;
  } else if (useCase === 'personal' || useCase === 'custom') {
    const pw = checkCancel(
      await p.password({
        message: `${t('init.adminPassword')} (${t('init.adminPasswordSkip')})`,
        validate: val => {
          if (val && val.length < 8) return t('init.adminPasswordWeak');
        },
      }),
      t,
    );
    if (pw) settings.AIMEAT_ADMIN_PASSWORD = pw;
  }

  // Anonymous mode
  if (useCase === 'public') {
    const anonDefault = env.AIMEAT_ANONYMOUS === 'true' || preset.anonymousMode;
    const anon = checkCancel(
      await p.confirm({
        message: t('init.anonymous'),
        initialValue: anonDefault,
      }),
      t,
    );
    if (anon) settings.AIMEAT_ANONYMOUS = 'true';
  } else if (preset.anonymousMode) {
    settings.AIMEAT_ANONYMOUS = 'true';
  }

  // Dev mode
  if (preset.devMode) {
    settings.AIMEAT_DEV_MODE = 'true';
  }

  // Extended features — ask for public
  if (useCase === 'public') {
    const extDefault = env.AIMEAT_EXTENDED_FEATURES !== 'false';
    const ext = checkCancel(
      await p.confirm({
        message: t('init.extended'),
        initialValue: extDefault,
      }),
      t,
    );
    if (!ext) settings.AIMEAT_EXTENDED_FEATURES = 'false';
  }

  // Network role — ask for public and custom
  if (useCase === 'public' || useCase === 'custom') {
    const currentRole = env.AIMEAT_FEDERATION_ROLE || 'standalone';
    const role = checkCancel(
      await p.select({
        message: t('init.networkRole'),
        initialValue: currentRole,
        options: [
          { value: 'operator', label: t('init.networkRoleOperator'), hint: t('init.networkRoleOperatorDesc') },
          { value: 'contributor', label: t('init.networkRoleContributor'), hint: t('init.networkRoleContributorDesc') },
          { value: 'standalone', label: t('init.networkRoleStandalone'), hint: t('init.networkRoleStandaloneDesc') },
        ],
      }),
      t,
    );
    settings.AIMEAT_FEDERATION_ROLE = role as string;

    // Contributor needs genesis URL
    if (role === 'contributor') {
      const genesisDefault = env.AIMEAT_GENESIS_URL || '';
      const genesisUrl = checkCancel(
        await p.text({
          message: t('init.genesisUrl'),
          placeholder: genesisDefault || 'https://aimeat.io',
          ...(genesisDefault ? { defaultValue: genesisDefault } : {}),
          validate: val => {
            if (!val) return genesisDefault ? undefined : t('init.genesisUrlInvalid');
            return validateUrl(val, t);
          },
        }),
        t,
      );
      settings.AIMEAT_GENESIS_URL = genesisUrl;
    }
  }

  // IndexNow key — ask for public nodes (enables Bing/Yandex search indexing)
  if (useCase === 'public') {
    const indexNowDefault = env.AIMEAT_INDEXNOW_KEY || '';
    const indexNow = checkCancel(
      await p.text({
        message: t('init.indexNowKey'),
        placeholder: indexNowDefault || t('init.indexNowKeyHint'),
        defaultValue: indexNowDefault,
      }),
      t,
    );
    if (indexNow) settings.AIMEAT_INDEXNOW_KEY = indexNow;
  }

  // Cookie consent banner — ask for public and custom (service builders)
  if (useCase === 'public' || useCase === 'custom') {
    const ccDefault = env.AIMEAT_COOKIE_CONSENT_ENABLED === 'true';
    const ccEnabled = checkCancel(
      await p.confirm({
        message: t('init.cookieConsent'),
        initialValue: ccDefault,
      }),
      t,
    );
    if (ccEnabled) {
      settings.AIMEAT_COOKIE_CONSENT_ENABLED = 'true';

      // Categories
      const catDefault = env.AIMEAT_COOKIE_CONSENT_CATEGORIES || 'necessary,analytics,marketing';
      const categories = checkCancel(
        await p.text({
          message: t('init.cookieConsentCategories'),
          placeholder: catDefault,
          defaultValue: catDefault,
        }),
        t,
      );
      if (categories && categories !== 'necessary') {
        settings.AIMEAT_COOKIE_CONSENT_CATEGORIES = categories;
      }

      // Privacy policy URL
      const policyDefault = env.AIMEAT_COOKIE_CONSENT_POLICY_URL || '';
      const policyUrl = checkCancel(
        await p.text({
          message: t('init.cookieConsentPolicyUrl'),
          placeholder: policyDefault || 'https://example.com/privacy',
          ...(policyDefault ? { defaultValue: policyDefault } : {}),
          validate: val => {
            if (!val) return undefined; // optional
            return validateUrl(val, t);
          },
        }),
        t,
      );
      if (policyUrl) settings.AIMEAT_COOKIE_CONSENT_POLICY_URL = policyUrl;
    }
  }

  // ── Push Notifications ──
  if (useCase === 'public' || useCase === 'custom') {
    const pushDefault = env.AIMEAT_PUSH_ENABLED === 'true';
    const pushEnabled = checkCancel(
      await p.confirm({
        message: t('init.pushEnabled'),
        initialValue: pushDefault,
      }),
      t,
    );

    if (pushEnabled) {
      settings.AIMEAT_PUSH_ENABLED = 'true';

      const pubKeyDefault = env.AIMEAT_VAPID_PUBLIC_KEY || '';
      const pubKey = checkCancel(
        await p.text({
          message: t('init.vapidPublicKey'),
          placeholder: pubKeyDefault || t('init.vapidPublicKeyHint'),
          ...(pubKeyDefault ? { defaultValue: pubKeyDefault } : {}),
        }),
        t,
      );
      if (pubKey) settings.AIMEAT_VAPID_PUBLIC_KEY = pubKey;

      const privKeyDefault = env.AIMEAT_VAPID_PRIVATE_KEY || '';
      const privKey = checkCancel(
        await p.text({
          message: t('init.vapidPrivateKey'),
          placeholder: privKeyDefault ? '••••••••' : t('init.vapidPrivateKeyHint'),
          ...(privKeyDefault ? { defaultValue: privKeyDefault } : {}),
        }),
        t,
      );
      if (privKey) settings.AIMEAT_VAPID_PRIVATE_KEY = privKey;

      const subjectDefault = env.AIMEAT_VAPID_SUBJECT || 'mailto:admin@aimeat.example.com';
      const subject = checkCancel(
        await p.text({
          message: t('init.vapidSubject'),
          placeholder: t('init.vapidSubjectHint'),
          defaultValue: subjectDefault,
          validate: (val) => {
            if (val && !val.startsWith('mailto:') && !val.startsWith('https://')) {
              return t('init.vapidSubjectInvalid');
            }
          },
        }),
        t,
      );
      settings.AIMEAT_VAPID_SUBJECT = subject;
    }

    // ── Email / SMTP ──
    const smtpDefault = !!env.AIMEAT_SMTP_HOST;
    const smtpEnabled = checkCancel(
      await p.confirm({
        message: t('init.smtpEnabled'),
        initialValue: smtpDefault,
      }),
      t,
    );

    if (smtpEnabled) {
      const hostDefault = env.AIMEAT_SMTP_HOST || '';
      const smtpHost = checkCancel(
        await p.text({
          message: t('init.smtpHost'),
          placeholder: hostDefault || t('init.smtpHostHint'),
          ...(hostDefault ? { defaultValue: hostDefault } : {}),
        }),
        t,
      );
      if (smtpHost) settings.AIMEAT_SMTP_HOST = smtpHost;

      const portDefault = env.AIMEAT_SMTP_PORT || '587';
      const smtpPort = checkCancel(
        await p.text({
          message: t('init.smtpPort'),
          placeholder: t('init.smtpPortHint'),
          defaultValue: portDefault,
          validate: (val) => validatePort(val, t),
        }),
        t,
      );
      settings.AIMEAT_SMTP_PORT = smtpPort;

      const userDefault = env.AIMEAT_SMTP_USER || '';
      const smtpUser = checkCancel(
        await p.text({
          message: t('init.smtpUser'),
          placeholder: userDefault || t('init.smtpUserHint'),
          ...(userDefault ? { defaultValue: userDefault } : {}),
        }),
        t,
      );
      if (smtpUser) settings.AIMEAT_SMTP_USER = smtpUser;

      const smtpPass = checkCancel(
        await p.text({
          message: t('init.smtpPass'),
          placeholder: '••••••••',
        }),
        t,
      );
      if (smtpPass) settings.AIMEAT_SMTP_PASS = smtpPass;

      const fromDefault = env.AIMEAT_SMTP_FROM || 'AIMEAT <noreply@localhost>';
      const smtpFrom = checkCancel(
        await p.text({
          message: t('init.smtpFrom'),
          placeholder: t('init.smtpFromHint'),
          defaultValue: fromDefault,
        }),
        t,
      );
      settings.AIMEAT_SMTP_FROM = smtpFrom;

      const secureDefault = env.AIMEAT_SMTP_SECURE === 'true';
      const smtpSecure = checkCancel(
        await p.confirm({
          message: t('init.smtpSecure'),
          initialValue: secureDefault,
        }),
        t,
      );
      if (smtpSecure) settings.AIMEAT_SMTP_SECURE = 'true';
    }
  }

  // ── Metrics & Observability ──
  if (useCase === 'public' || useCase === 'custom') {
    const metricsDefault = env.AIMEAT_METRICS_ENABLED === 'true';
    const metricsEnabled = checkCancel(
      await p.confirm({
        message: t('init.metricsEnabled'),
        initialValue: metricsDefault,
      }),
      t,
    );

    if (metricsEnabled) {
      settings.AIMEAT_METRICS_ENABLED = 'true';

      const accessDefault = env.AIMEAT_METRICS_ACCESS || 'operator';
      const metricsAccess = checkCancel(
        await p.select({
          message: t('init.metricsAccess'),
          initialValue: accessDefault,
          options: [
            { value: 'public', label: t('init.metricsAccessPublic') },
            { value: 'authenticated', label: t('init.metricsAccessAuthenticated') },
            { value: 'operator', label: t('init.metricsAccessOperator') },
          ],
        }),
        t,
      );
      settings.AIMEAT_METRICS_ACCESS = metricsAccess as string;
    }
  }

  // Node Portal (Site) — ask for public and custom
  if (useCase === 'public' || useCase === 'custom') {
    const siteDefault = env.AIMEAT_SITE_ENABLED !== 'false';
    const siteEnabled = checkCancel(
      await p.confirm({
        message: t('init.siteEnabled'),
        initialValue: siteDefault,
      }),
      t,
    );
    if (!siteEnabled) {
      settings.AIMEAT_SITE_ENABLED = 'false';
    } else {
      const tmplSizeDefault = env.AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB || '512';
      const tmplSize = checkCancel(
        await p.text({
          message: t('init.siteMaxTemplateSizeKb'),
          defaultValue: tmplSizeDefault,
          validate: val => validatePositiveNum(val, t),
        }),
        t,
      );
      if (tmplSize !== '512') settings.AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB = tmplSize;

      const cacheTtlDefault = env.AIMEAT_SITE_CACHE_TTL_SECONDS || '60';
      const cacheTtl = checkCancel(
        await p.text({
          message: t('init.siteCacheTtlSeconds'),
          defaultValue: cacheTtlDefault,
          validate: val => validatePositiveNum(val, t),
        }),
        t,
      );
      if (cacheTtl !== '60') settings.AIMEAT_SITE_CACHE_TTL_SECONDS = cacheTtl;
    }
  }

  return settings;
}

/**
 * Operator info prompts. These values feed `{{placeholder}}` tokens in
 * aimeat/public/privacy.html (rendered at /v1/privacy). All AIMEAT nodes
 * that serve users need them set; without them the privacy page returns
 * HTTP 503. Skip for dev mode; ask-with-confirm for personal mode; ask
 * required for public/custom.
 */
async function askOperatorSettings(
  t: TFunction,
  useCase: UseCase,
  env: Record<string, string>,
): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};

  if (useCase === 'dev') return settings;

  if (useCase === 'personal') {
    const proceed = checkCancel(
      await p.confirm({
        message: t('init.operatorPersonalAsk'),
        initialValue: false,
      }),
      t,
    );
    if (!proceed) return settings;
  }

  p.note(t('init.operatorIntro'), t('init.operatorTitle'));

  const name = checkCancel(
    await p.text({
      message: t('init.operatorName'),
      placeholder: env.AIMEAT_OPERATOR_NAME || 'Your Name or Company Ltd',
      defaultValue: env.AIMEAT_OPERATOR_NAME ?? '',
      validate: val => !val?.trim() ? t('init.operatorNameRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_NAME = name;

  const type = checkCancel(
    await p.select({
      message: t('init.operatorType'),
      options: [
        { value: 'natural_person', label: t('init.operatorTypeNaturalPerson') },
        { value: 'company', label: t('init.operatorTypeCompany') },
        { value: 'organisation', label: t('init.operatorTypeOrganisation') },
        { value: 'association', label: t('init.operatorTypeAssociation') },
      ],
      initialValue: (env.AIMEAT_OPERATOR_TYPE || 'natural_person') as 'natural_person' | 'company' | 'organisation' | 'association',
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_TYPE = type as string;

  const address = checkCancel(
    await p.text({
      message: t('init.operatorAddress'),
      placeholder: env.AIMEAT_OPERATOR_ADDRESS || 'Street, Postcode City',
      defaultValue: env.AIMEAT_OPERATOR_ADDRESS ?? '',
      validate: val => !val?.trim() ? t('init.operatorAddressRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_ADDRESS = address;

  const country = checkCancel(
    await p.text({
      message: t('init.operatorCountry'),
      placeholder: env.AIMEAT_OPERATOR_COUNTRY || 'Finland',
      defaultValue: env.AIMEAT_OPERATOR_COUNTRY ?? '',
      validate: val => !val?.trim() ? t('init.operatorCountryRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_COUNTRY = country;

  const email = checkCancel(
    await p.text({
      message: t('init.operatorEmail'),
      placeholder: env.AIMEAT_OPERATOR_EMAIL || 'privacy@example.com',
      defaultValue: env.AIMEAT_OPERATOR_EMAIL ?? '',
      validate: val => {
        if (!val?.trim()) return t('init.operatorEmailRequired');
        if (!val.includes('@')) return t('init.operatorEmailInvalid');
        return undefined;
      },
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_EMAIL = email;

  const securityEmail = checkCancel(
    await p.text({
      message: t('init.operatorSecurityEmail'),
      placeholder: env.AIMEAT_OPERATOR_SECURITY_EMAIL || email,
      defaultValue: env.AIMEAT_OPERATOR_SECURITY_EMAIL ?? '',
    }),
    t,
  );
  if (securityEmail.trim()) settings.AIMEAT_OPERATOR_SECURITY_EMAIL = securityEmail;

  const hostingName = checkCancel(
    await p.text({
      message: t('init.operatorHostingName'),
      placeholder: env.AIMEAT_OPERATOR_HOSTING_NAME || 'Scaleway SAS',
      defaultValue: env.AIMEAT_OPERATOR_HOSTING_NAME ?? '',
      validate: val => !val?.trim() ? t('init.operatorHostingNameRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_HOSTING_NAME = hostingName;

  const hostingUrl = checkCancel(
    await p.text({
      message: t('init.operatorHostingUrl'),
      placeholder: env.AIMEAT_OPERATOR_HOSTING_URL || 'https://www.scaleway.com',
      defaultValue: env.AIMEAT_OPERATOR_HOSTING_URL ?? '',
    }),
    t,
  );
  if (hostingUrl.trim()) settings.AIMEAT_OPERATOR_HOSTING_URL = hostingUrl;

  const hostingLocation = checkCancel(
    await p.text({
      message: t('init.operatorHostingLocation'),
      placeholder: env.AIMEAT_OPERATOR_HOSTING_LOCATION || 'France (EU/EEA)',
      defaultValue: env.AIMEAT_OPERATOR_HOSTING_LOCATION ?? '',
      validate: val => !val?.trim() ? t('init.operatorHostingLocationRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_HOSTING_LOCATION = hostingLocation;

  const supervisoryName = checkCancel(
    await p.text({
      message: t('init.operatorSupervisoryName'),
      placeholder: env.AIMEAT_OPERATOR_SUPERVISORY_NAME || 'Office of the Data Protection Ombudsman',
      defaultValue: env.AIMEAT_OPERATOR_SUPERVISORY_NAME ?? '',
      validate: val => !val?.trim() ? t('init.operatorSupervisoryNameRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_SUPERVISORY_NAME = supervisoryName;

  const supervisoryUrl = checkCancel(
    await p.text({
      message: t('init.operatorSupervisoryUrl'),
      placeholder: env.AIMEAT_OPERATOR_SUPERVISORY_URL || 'https://tietosuoja.fi',
      defaultValue: env.AIMEAT_OPERATOR_SUPERVISORY_URL ?? '',
      validate: val => {
        if (!val?.trim()) return t('init.operatorSupervisoryUrlRequired');
        return validateUrl(val, t);
      },
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_SUPERVISORY_URL = supervisoryUrl;

  const today = new Date().toISOString().slice(0, 10);
  const effectiveDate = checkCancel(
    await p.text({
      message: t('init.operatorEffectiveDate'),
      placeholder: env.AIMEAT_OPERATOR_EFFECTIVE_DATE || today,
      defaultValue: env.AIMEAT_OPERATOR_EFFECTIVE_DATE || today,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_EFFECTIVE_DATE = effectiveDate;

  return settings;
}

async function askEconomySettings(
  t: TFunction,
  cfg: AimeatConfig,
): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};

  const bonus = checkCancel(
    await p.text({
      message: t('init.welcomeBonus'),
      defaultValue: String(cfg.welcomeBonus),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (bonus !== '100') settings.AIMEAT_WELCOME_BONUS = bonus;

  const daily = checkCancel(
    await p.text({
      message: t('init.dailyAllowance'),
      defaultValue: String(cfg.dailyAllowance),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (daily !== '50') settings.AIMEAT_DAILY_ALLOWANCE = daily;

  const cap = checkCancel(
    await p.text({
      message: t('init.dailyAllowanceCap'),
      defaultValue: String(cfg.dailyAllowanceCap),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (cap !== '500') settings.AIMEAT_DAILY_ALLOWANCE_CAP = cap;

  const burn = checkCancel(
    await p.text({
      message: t('init.burnRate'),
      defaultValue: String(cfg.burnRate),
      validate: val => validateBurnRate(val, t),
    }),
    t,
  );
  if (burn !== '0.10') settings.AIMEAT_BURN_RATE = burn;

  const mint = checkCancel(
    await p.text({
      message: t('init.maxMint'),
      defaultValue: String(cfg.maxOperatorMintPerDay),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (mint !== '10000') settings.AIMEAT_MAX_OPERATOR_MINT_PER_DAY = mint;

  const postCost = checkCancel(
    await p.text({
      message: t('init.boardPostCost'),
      defaultValue: String(cfg.boardPostBaseCost),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (postCost !== '5') settings.AIMEAT_BOARD_POST_BASE_COST = postCost;

  const postCostKb = checkCancel(
    await p.text({
      message: t('init.boardPostCostKb'),
      defaultValue: String(cfg.boardPostCostPerKb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (postCostKb !== '2') settings.AIMEAT_BOARD_POST_COST_PER_KB = postCostKb;

  return settings;
}

async function askAllAdvancedSettings(
  t: TFunction,
  cfg: AimeatConfig,
): Promise<Record<string, string>> {
  const settings = await askEconomySettings(t, cfg);

  const jwt = checkCancel(
    await p.text({
      message: t('init.jwtTtl'),
      defaultValue: String(cfg.jwtTtlSeconds),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (jwt !== '3600') settings.AIMEAT_JWT_TTL = jwt;

  const memQuota = checkCancel(
    await p.text({
      message: t('init.memoryQuota'),
      defaultValue: String(cfg.memoryQuotaMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (memQuota !== '10') settings.AIMEAT_MEMORY_QUOTA_MB = memQuota;

  const memValueSize = checkCancel(
    await p.text({
      message: t('init.memoryMaxValueSizeKb'),
      defaultValue: String(cfg.memoryMaxValueSizeKb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (memValueSize !== '1024') settings.AIMEAT_MEMORY_MAX_VALUE_SIZE_KB = memValueSize;

  const memKeys = checkCancel(
    await p.text({
      message: t('init.memoryMaxKeys'),
      defaultValue: String(cfg.memoryMaxKeysPerAgent),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (memKeys !== '1000') settings.AIMEAT_MEMORY_MAX_KEYS = memKeys;

  const storQuota = checkCancel(
    await p.text({
      message: t('init.storageQuota'),
      defaultValue: String(cfg.storageQuotaMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (storQuota !== '100') settings.AIMEAT_STORAGE_QUOTA_MB = storQuota;

  const storFileSize = checkCancel(
    await p.text({
      message: t('init.storageMaxFileSize'),
      defaultValue: String(cfg.storageMaxFileSizeMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (storFileSize !== '10') settings.AIMEAT_STORAGE_MAX_FILE_SIZE_MB = storFileSize;

  const mmSets = checkCancel(
    await p.text({
      message: t('init.microMemoryMaxSets'),
      defaultValue: String(cfg.microMemoryMaxSetsPerAgent),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (mmSets !== '50') settings.AIMEAT_MICRO_MEMORY_MAX_SETS = mmSets;

  const mmKeys = checkCancel(
    await p.text({
      message: t('init.microMemoryMaxKeysPerSet'),
      defaultValue: String(cfg.microMemoryMaxKeysPerSet),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (mmKeys !== '100') settings.AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET = mmKeys;

  const mmValueSize = checkCancel(
    await p.text({
      message: t('init.microMemoryMaxValueSize'),
      defaultValue: String(cfg.microMemoryMaxValueSizeBytes),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (mmValueSize !== '16384') settings.AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE = mmValueSize;

  const maxActions = checkCancel(
    await p.text({
      message: t('init.maxActionsPerAgent'),
      defaultValue: String(cfg.maxActionsPerAgent),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (maxActions !== '20') settings.AIMEAT_MAX_ACTIONS_PER_AGENT = maxActions;

  const appSize = checkCancel(
    await p.text({
      message: t('init.appMaxSize'),
      defaultValue: String(cfg.appMaxSizeMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (appSize !== '5') settings.AIMEAT_APP_MAX_SIZE_MB = appSize;

  const portingFee = checkCancel(
    await p.text({
      message: t('init.agentPortingFee'),
      defaultValue: String(cfg.agentPortingFeeMorsels),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (portingFee !== '50') settings.AIMEAT_AGENT_PORTING_FEE = portingFee;

  const relayHops = checkCancel(
    await p.text({
      message: t('init.maxRelayHops'),
      defaultValue: String(cfg.maxRelayHops),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (relayHops !== '3') settings.AIMEAT_MAX_RELAY_HOPS = relayHops;

  // ── Cross-Federation (Genesis Peering) ──
  p.note(t('init.crossFedNote'));

  const crossFedEnabled = checkCancel(
    await p.confirm({
      message: t('init.crossFedEnabled'),
      initialValue: cfg.crossFederationEnabled,
    }),
    t,
  );
  if (!crossFedEnabled) settings.AIMEAT_CROSS_FEDERATION_ENABLED = 'false';

  if (crossFedEnabled) {
    const maxPeers = checkCancel(
      await p.text({
        message: t('init.crossFedMaxPeers'),
        defaultValue: String(cfg.maxGenesisPeers),
        validate: (val: string | undefined) => {
          const n = parseInt(val ?? '', 10);
          if (isNaN(n) || n < 1 || n > 100) return t('init.crossFedMaxPeersInvalid');
        },
      }),
      t,
    );
    if (maxPeers !== '10') settings.AIMEAT_MAX_GENESIS_PEERS = maxPeers;

    const syncInterval = checkCancel(
      await p.text({
        message: t('init.crossFedSyncInterval'),
        defaultValue: String(cfg.genesisSyncIntervalHours),
        validate: (val: string | undefined) => {
          const n = parseInt(val ?? '', 10);
          if (isNaN(n) || n < 1 || n > 168) return t('init.crossFedSyncIntervalInvalid');
        },
      }),
      t,
    );
    if (syncInterval !== '6') settings.AIMEAT_GENESIS_SYNC_INTERVAL_HOURS = syncInterval;
  }

  const rateLimitGlobal = checkCancel(
    await p.text({
      message: t('init.rateLimitGlobal'),
      defaultValue: String(cfg.rlGlobal),
      validate: (val: string | undefined) => {
        const n = parseInt(val ?? '', 10);
        if (isNaN(n) || n < 1) return t('init.numInvalid');
      },
    }),
    t,
  );
  if (rateLimitGlobal !== '300') settings.AIMEAT_RL_GLOBAL = rateLimitGlobal;

  // ── Consent Layer ──
  const consentEnabled = checkCancel(
    await p.confirm({
      message: t('init.consentEnabled'),
      initialValue: cfg.consentEnabled,
    }),
    t,
  );
  if (!consentEnabled) settings.AIMEAT_CONSENT_ENABLED = 'false';

  if (consentEnabled) {
    const consentMaxPerUser = checkCancel(
      await p.text({
        message: t('init.consentMaxPerUser'),
        defaultValue: String(cfg.consentMaxPerUser),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (consentMaxPerUser !== '100') settings.AIMEAT_CONSENT_MAX_PER_USER = consentMaxPerUser;

    const consentAuditDays = checkCancel(
      await p.text({
        message: t('init.consentAuditDays'),
        defaultValue: String(cfg.consentAuditRetentionDays),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (consentAuditDays !== '365') settings.AIMEAT_CONSENT_AUDIT_RETENTION_DAYS = consentAuditDays;
  }

  // ── CORS ──
  const corsOrigins = checkCancel(
    await p.text({
      message: t('init.corsOrigins'),
      defaultValue: cfg.corsAllowedOrigins.join(', '),
      placeholder: '* or https://example.com, https://app.example.com',
    }),
    t,
  );
  if (corsOrigins !== '*') settings.AIMEAT_CORS_ALLOWED_ORIGINS = corsOrigins;

  // ── TOTP / 2FA ──
  const totpEnabled = checkCancel(
    await p.confirm({
      message: t('init.totpEnabled'),
      initialValue: cfg.totpEnabled,
    }),
    t,
  );
  if (!totpEnabled) settings.AIMEAT_TOTP_ENABLED = 'false';

  if (totpEnabled) {
    const totpIssuer = checkCancel(
      await p.text({
        message: t('init.totpIssuer'),
        defaultValue: cfg.totpIssuer,
      }),
      t,
    );
    if (totpIssuer !== 'AIMEAT') settings.AIMEAT_TOTP_ISSUER = totpIssuer;

    const totpMaxFailed = checkCancel(
      await p.text({
        message: t('init.totpMaxFailed'),
        defaultValue: String(cfg.totpMaxFailedAttempts),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (totpMaxFailed !== '5') settings.AIMEAT_TOTP_MAX_FAILED = totpMaxFailed;

    const totpLockout = checkCancel(
      await p.text({
        message: t('init.totpLockoutSeconds'),
        defaultValue: String(cfg.totpLockoutSeconds),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (totpLockout !== '300') settings.AIMEAT_TOTP_LOCKOUT_SECONDS = totpLockout;
  }

  // ── AI Matching ──
  const matchingEnabled = checkCancel(
    await p.confirm({
      message: t('init.matchingEnabled'),
      initialValue: cfg.matchingEnabled,
    }),
    t,
  );
  if (!matchingEnabled) settings.AIMEAT_MATCHING_ENABLED = 'false';

  if (matchingEnabled) {
    const matchInterval = checkCancel(
      await p.text({
        message: t('init.matchIntervalHours'),
        defaultValue: String(cfg.matchIntervalHours),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (matchInterval !== '24') settings.AIMEAT_MATCH_INTERVAL_HOURS = matchInterval;

    const matchThreshold = checkCancel(
      await p.text({
        message: t('init.matchThreshold'),
        defaultValue: String(cfg.matchThreshold),
        validate: val => validateBurnRate(val, t),
      }),
      t,
    );
    if (matchThreshold !== '0.5') settings.AIMEAT_MATCH_THRESHOLD = matchThreshold;

    const matchMaxSuggestions = checkCancel(
      await p.text({
        message: t('init.matchMaxSuggestions'),
        defaultValue: String(cfg.matchMaxSuggestions),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (matchMaxSuggestions !== '5') settings.AIMEAT_MATCH_MAX_SUGGESTIONS = matchMaxSuggestions;

    const matchMaxDistance = checkCancel(
      await p.text({
        message: t('init.matchMaxDistanceKm'),
        defaultValue: String(cfg.matchMaxDistanceKm),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (matchMaxDistance !== '100') settings.AIMEAT_MATCH_MAX_DISTANCE_KM = matchMaxDistance;
  }

  // ── Marketplace ──
  const marketplaceEnabled = checkCancel(
    await p.confirm({
      message: t('init.marketplaceEnabled'),
      initialValue: cfg.marketplaceEnabled,
    }),
    t,
  );
  if (!marketplaceEnabled) settings.AIMEAT_MARKETPLACE_ENABLED = 'false';

  if (marketplaceEnabled) {
    const listingFee = checkCancel(
      await p.text({
        message: t('init.marketplaceListingFee'),
        defaultValue: String(cfg.marketplaceListingFeeMorsels),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (listingFee !== '2') settings.AIMEAT_MARKETPLACE_LISTING_FEE = listingFee;

    const txFee = checkCancel(
      await p.text({
        message: t('init.marketplaceTxFeePercent'),
        defaultValue: String(cfg.marketplaceTransactionFeePercent),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (txFee !== '5') settings.AIMEAT_MARKETPLACE_TX_FEE_PERCENT = txFee;

    const escrow = checkCancel(
      await p.confirm({
        message: t('init.marketplaceEscrow'),
        initialValue: cfg.marketplaceEscrowEnabled,
      }),
      t,
    );
    if (!escrow) settings.AIMEAT_MARKETPLACE_ESCROW = 'false';
  }

  // ── Realtime P2P ──
  const realtimeEnabled = checkCancel(
    await p.confirm({
      message: t('init.realtimeEnabled'),
      initialValue: cfg.realtimeEnabled,
    }),
    t,
  );
  if (!realtimeEnabled) settings.AIMEAT_REALTIME_ENABLED = 'false';

  if (realtimeEnabled) {
    const maxRooms = checkCancel(
      await p.text({
        message: t('init.realtimeMaxRooms'),
        defaultValue: String(cfg.realtimeMaxRooms),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (maxRooms !== '100') settings.AIMEAT_REALTIME_MAX_ROOMS = maxRooms;

    const maxPeersRoom = checkCancel(
      await p.text({
        message: t('init.realtimeMaxPeersPerRoom'),
        defaultValue: String(cfg.realtimeMaxPeersPerRoom),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (maxPeersRoom !== '20') settings.AIMEAT_REALTIME_MAX_PEERS_PER_ROOM = maxPeersRoom;
  }

  // ── Extensions ──
  const extensionsEnabled = checkCancel(
    await p.confirm({
      message: t('init.extensionsEnabled'),
      initialValue: cfg.extensionsEnabled,
    }),
    t,
  );
  if (extensionsEnabled) {
    settings.AIMEAT_EXTENSIONS_ENABLED = 'true';

    const extMemory = checkCancel(
      await p.text({
        message: t('init.extensionMaxMemoryMb'),
        defaultValue: String(cfg.extensionMaxMemoryMb),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (extMemory !== '64') settings.AIMEAT_EXT_MAX_MEMORY_MB = extMemory;

    const extTimeout = checkCancel(
      await p.text({
        message: t('init.extensionTimeoutMs'),
        defaultValue: String(cfg.extensionTimeoutMs),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (extTimeout !== '5000') settings.AIMEAT_EXT_TIMEOUT_MS = extTimeout;
  }

  return settings;
}

// ── Main wizard ─────────────────────────────────────────────────────

/** Find .env: CWD first, then package root. */
function findEnvFile(): string | null {
  if (existsSync('.env')) return '.env';
  const pkgEnv = join(__pkgRoot, '.env');
  if (existsSync(pkgEnv)) return pkgEnv;
  return null;
}

export async function runInitWizard(config: AimeatConfig): Promise<void> {
  // Read existing .env for current values
  const envFilePath = findEnvFile();
  const env = envFilePath ? parseEnvFile(envFilePath) : {};

  // Step 1: Language selection (always bilingual)
  p.intro('AIMEAT Node Configuration Wizard');

  const lang = checkCancel(
    await p.select({
      message: 'Select language / Valitse kieli',
      options: [
        { value: 'en', label: 'English' },
        { value: 'fi', label: 'Suomi' },
      ],
    }),
    createT('en'),
  );

  const locale = lang as Locale;
  const t = createT(locale);

  // Step 2: Use case selection
  const useCase = checkCancel(
    await p.select({
      message: t('init.useCase'),
      options: [
        { value: 'public', label: t('init.useCasePublic'), hint: t('init.useCasePublicDesc') },
        { value: 'personal', label: t('init.useCasePersonal'), hint: t('init.useCasePersonalDesc') },
        { value: 'dev', label: t('init.useCaseDev'), hint: t('init.useCaseDevDesc') },
        { value: 'custom', label: t('init.useCaseCustom'), hint: t('init.useCaseCustomDesc') },
      ],
    }),
    t,
  ) as UseCase;

  // Build presets from loaded config (which already has env var values)
  const presets = buildPresets(config);
  const preset = useCase === 'custom' ? presets.personal : presets[useCase];

  // Step 3: Gather core settings — pass env so prompts show existing values
  const settings = await askCoreSettings(t, preset, useCase, env);

  // Step 3.5: Operator info (privacy policy fields rendered into /v1/privacy).
  // Skip for dev; ask-with-confirm for personal; ask required for public/custom.
  Object.assign(settings, await askOperatorSettings(t, useCase, env));

  // Step 4: Advanced settings (skip for dev)
  if (useCase !== 'dev') {
    const advanced = checkCancel(
      await p.select({
        message: t('init.advancedPrompt'),
        options: [
          { value: 'none', label: t('init.advancedNo') },
          { value: 'economy', label: t('init.advancedEconomy'), hint: t('init.advancedEconomyDesc') },
          { value: 'all', label: t('init.advancedAll'), hint: t('init.advancedAllDesc') },
        ],
      }),
      t,
    );

    if (advanced === 'economy') {
      Object.assign(settings, await askEconomySettings(t, config));
    } else if (advanced === 'all') {
      Object.assign(settings, await askAllAdvancedSettings(t, config));
    }
  }

  // Step 5: Summary
  const changedEntries = Object.entries(settings).filter(
    ([key, val]) => CONFIG_DEFAULTS[key] !== val,
  );

  if (changedEntries.length > 0) {
    const summaryLines = changedEntries
      .map(([key, val]) => {
        const display = key === 'AIMEAT_ADMIN_PASSWORD'
          ? val.slice(0, 2) + '*'.repeat(Math.max(0, val.length - 4)) + val.slice(-2)
          : val;
        return `  ${key} = ${display}`;
      })
      .join('\n');

    p.note(
      `${t('init.summaryChanged')}\n\n${summaryLines}\n\n${t('init.summaryDefault')}`,
      t('init.summaryTitle'),
    );
  }

  // Step 6: Output format
  const outputFormat = checkCancel(
    await p.select({
      message: t('init.outputPrompt'),
      options: [
        { value: 'env', label: t('init.outputEnv') },
        { value: 'ini', label: t('init.outputIni') },
        { value: 'json', label: t('init.outputJson') },
        { value: 'cancel', label: t('init.outputCancel') },
      ],
    }),
    t,
  );

  if (outputFormat === 'cancel') bail(t);

  let fileName: string;
  if (outputFormat === 'env') {
    fileName = '.env';
  } else if (outputFormat === 'ini') {
    fileName = 'aimeat.ini';
  } else {
    // Build smart name suggestions from node ID
    const nodeId = settings.AIMEAT_NODE_ID || 'aimeat';
    const nameOptions = [
      { value: `${nodeId}.production.json`, label: `${nodeId}.production.json` },
      { value: `${nodeId}.staging.json`, label: `${nodeId}.staging.json` },
      { value: `${nodeId}.development.json`, label: `${nodeId}.development.json` },
      { value: 'custom', label: t('init.jsonNameCustom') },
    ];
    const jsonName = checkCancel(
      await p.select({
        message: t('init.jsonNamePrompt'),
        options: nameOptions,
      }),
      t,
    );

    if (jsonName === 'custom') {
      fileName = checkCancel(
        await p.text({
          message: t('init.jsonNamePrompt'),
          placeholder: 'aimeat.config.json',
          defaultValue: 'aimeat.config.json',
          validate: val => {
            if (!val) return;
            if (!val.endsWith('.json')) return 'Must end with .json';
          },
        }),
        t,
      );
    } else {
      fileName = jsonName as string;
    }
  }

  const content = outputFormat === 'env'
    ? generateEnvContent(settings)
    : outputFormat === 'ini'
      ? generateIniContent(settings)
      : generateJsonContent(settings);

  // Handle existing file
  if (existsSync(fileName)) {
    const action = checkCancel(
      await p.select({
        message: t('init.existingFile', { file: fileName }),
        options: [
          { value: 'merge', label: t('init.existingMerge') },
          { value: 'overwrite', label: t('init.existingOverwrite') },
          { value: 'cancel', label: t('init.existingCancel') },
        ],
      }),
      t,
    );

    if (action === 'cancel') bail(t);

    // Backup existing file before any modification
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${fileName}.backup.${timestamp}`;
    writeFileSync(backupName, readFileSync(fileName, 'utf-8'));
    p.log.info(t('init.backupCreated', { file: backupName }));

    if (action === 'merge' && outputFormat === 'env') {
      const existing = readFileSync(fileName, 'utf-8');
      const existingKeys = new Set(
        existing
          .split('\n')
          .filter(line => line.match(/^[A-Z_]+=/))
          .map(line => line.split('=')[0]),
      );

      const newLines: string[] = [];
      for (const line of content.split('\n')) {
        const keyMatch = line.match(/^([A-Z_]+)=/);
        if (keyMatch && existingKeys.has(keyMatch[1])) continue;
        newLines.push(line);
      }

      const merged = existing.trimEnd() + '\n\n' + newLines.join('\n');
      writeFileSync(fileName, merged);
    } else if (action === 'merge' && outputFormat === 'ini') {
      const existing = ini.parse(readFileSync(fileName, 'utf-8'));
      const newCfg = ini.parse(content);
      // Deep merge sections
      for (const [section, values] of Object.entries(newCfg)) {
        if (typeof values === 'object' && values !== null) {
          existing[section] = { ...(existing[section] as Record<string, string> || {}), ...values };
        } else {
          existing[section] = values;
        }
      }
      writeFileSync(fileName, '; AIMEAT Node Configuration (INI format)\n; Merged by aimeat init\n\n' + ini.stringify(existing));
    } else if (action === 'merge' && outputFormat === 'json') {
      const existing = JSON.parse(readFileSync(fileName, 'utf-8'));
      const newCfg = JSON.parse(content);
      const merged = { ...existing, ...newCfg };
      writeFileSync(fileName, JSON.stringify(merged, null, 2) + '\n');
    } else {
      writeFileSync(fileName, content);
    }
  } else {
    writeFileSync(fileName, content);
  }

  p.log.success(t('init.written', { file: fileName }));

  // ── Scaffold runtime files ──
  const shouldScaffold = checkCancel(await p.confirm({
    message: t('init.scaffoldPrompt'),
    initialValue: true,
  }), t);

  if (shouldScaffold) {
    const { scaffoldFiles: doScaffold, findPackageRoot } = await import('./scaffold.js');
    const pkgRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
    if (pkgRoot) {
      const pkgJsonPath = join(pkgRoot, 'package.json');
      const pkgVersion = existsSync(pkgJsonPath)
        ? (JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { version: string }).version
        : '0.0.0';
      const spinner = p.spinner();
      spinner.start(t('init.scaffoldCopying'));
      const scaffoldResult = doScaffold(pkgRoot, process.cwd(), pkgVersion);
      spinner.stop(t('init.scaffoldDone', {
        copied: String(scaffoldResult.copied),
        updated: String(scaffoldResult.updated),
        skipped: String(scaffoldResult.skippedModified),
      }));
      for (const file of scaffoldResult.modifiedFiles) {
        p.log.warn(t('init.scaffoldSkippedFile', { file }));
      }
    } else {
      p.log.warn(t('init.scaffoldNoSource'));
    }
  }

  // Offer to join federation if role is not standalone and genesis URL is set
  const fedRole = settings.AIMEAT_FEDERATION_ROLE;
  const genesisUrl = settings.AIMEAT_GENESIS_URL;
  if (fedRole && fedRole !== 'standalone' && genesisUrl) {
    const shouldJoin = checkCancel(await p.confirm({
      message: t('init.joinNow'),
    }), t);

    if (shouldJoin) {
      try {
        // Build a config reflecting the user's NEW settings (not the startup defaults)
        const port = settings.AIMEAT_PORT || String(config.port);
        const joinConfig: AimeatConfig = {
          ...config,
          nodeId: settings.AIMEAT_NODE_ID || config.nodeId,
          baseUrl: settings.AIMEAT_BASE_URL || `http://localhost:${port}`,
          nodeType: (settings.AIMEAT_NODE_TYPE as AimeatConfig['nodeType']) || config.nodeType,
          federationRole: (fedRole as AimeatConfig['federationRole']) || config.federationRole,
          genesisUrl: genesisUrl || config.genesisUrl,
        };
        const { runFederationJoin } = await import('./federation-join.js');
        await runFederationJoin(joinConfig, genesisUrl, locale);
      } catch (e) {
        p.log.warn(t('init.joinFailed', {
          error: e instanceof Error ? e.message : String(e),
        }));
        p.log.info(t('init.joinRetryHint'));
      }
    }
  }

  const nextSteps = [
    t('init.nextStep1', { file: fileName }),
  ];
  if (outputFormat === 'env') {
    nextSteps.push(t('init.nextStep2'));
    nextSteps.push(t('init.nextStep3'));
  } else if (outputFormat === 'ini') {
    nextSteps.push(t('init.nextStepIni', { file: fileName }));
  } else {
    nextSteps.push(t('init.nextStepJson', { file: fileName }));
  }
  p.note(nextSteps.join('\n'), t('init.nextSteps'));

  p.outro(t('init.done'));
}
