/**
 * @file src/utils/env-config/sections-node.ts
 * @description Node identity, storage, security, modes, economy, features, quota config sections. Extracted from src/utils/env-config.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from env-config.ts (max-file-lines)
 */

import type { AimeatConfig } from '../../config.js';
import type { ConfigSection } from './shared.js';
import { mask, maskUrl } from './shared.js';

export function nodeSections(config: AimeatConfig): ConfigSection[] {
  return [
    {
      title: 'Node Identity',
      entries: [
        {
          envVar: 'AIMEAT_NODE_ID',
          description: 'Unique name for this node on the network',
          value: config.nodeId,
          defaultVal: 'aimeat-local-001-dev',
        },
        {
          envVar: 'AIMEAT_NODE_TYPE',
          description: 'Node role: full (all features), relay (forward only), mirror (read-only)',
          value: config.nodeType,
          defaultVal: 'full',
        },
        {
          envVar: 'AIMEAT_BASE_URL',
          description: 'Public URL where this node is reachable',
          value: config.baseUrl,
          defaultVal: 'http://localhost:<port>',
        },
        {
          envVar: 'AIMEAT_PORT',
          description: 'HTTP port the server listens on',
          value: String(config.port),
          defaultVal: '40050',
        },
      ],
    },
    {
      title: 'Storage',
      entries: [
        {
          envVar: 'AIMEAT_STORAGE',
          description: 'Storage backend (memory | sqlite | postgres-kysely)',
          value: config.storageProvider,
          defaultVal: 'memory',
        },
        {
          envVar: 'AIMEAT_SQLITE_PATH',
          description: 'SQLite database file path (when sqlite)',
          value: config.storageProvider === 'sqlite' ? config.sqlitePath : '(n/a — not using sqlite)',
          defaultVal: './data/aimeat.db',
        },
        {
          envVar: 'DATABASE_URL',
          description: 'PostgreSQL connection URL (when postgres-kysely)',
          value: config.storageProvider === 'postgres-kysely'
            ? (config.dbUrl ? maskUrl(config.dbUrl) : `(not set — required for ${config.storageProvider})`)
            : '(n/a — not using postgres-kysely)',
          defaultVal: '(none)',
          secret: true,
        },
      ],
    },
    {
      title: 'Security',
      entries: [
        {
          envVar: 'AIMEAT_ADMIN_PASSWORD',
          description: 'Password for the operator admin panel',
          value: config.adminPassword ? mask(config.adminPassword) : '(auto-generated on startup)',
          defaultVal: '(auto-generated)',
          secret: true,
        },
        {
          envVar: 'AIMEAT_JWT_TTL',
          description: 'Legacy / agent JWT lifetime (in seconds)',
          value: String(config.jwtTtlSeconds),
          defaultVal: '3600',
        },
        {
          envVar: 'AIMEAT_ACCESS_TTL',
          description: 'Owner access-token (JWT) lifetime (in seconds)',
          value: String(config.accessTtlSeconds),
          defaultVal: '900',
        },
        {
          envVar: 'AIMEAT_REFRESH_IDLE_DAYS',
          description: 'Owner refresh-cookie idle window (in days)',
          value: String(config.refreshIdleDays),
          defaultVal: '30',
        },
        {
          envVar: 'AIMEAT_REFRESH_ABSOLUTE_DAYS',
          description: 'Owner refresh-cookie hard cap (in days)',
          value: String(config.refreshAbsoluteDays),
          defaultVal: '90',
        },
        {
          envVar: 'AIMEAT_REFRESH_GRACE_MS',
          description: 'Refresh-rotation grace window (in milliseconds)',
          value: String(config.refreshGraceMs),
          defaultVal: '60000',
        },
        {
          envVar: 'AIMEAT_OTK_TTL_MS',
          description: 'One-time key expiry (in milliseconds)',
          value: String(config.otkTtlMs),
          defaultVal: '300000',
        },
        {
          envVar: 'AIMEAT_OTK_GRACE_MS',
          description: 'Grace period for expired one-time keys (in milliseconds)',
          value: String(config.otkGraceMs),
          defaultVal: '60000',
        },
      ],
    },
    {
      title: 'Modes',
      entries: [
        {
          envVar: 'AIMEAT_DEV_MODE',
          description: 'Developer mode — localhost webhooks, credential reset preserves data',
          value: config.devMode ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_TEST_MODE',
          description: 'Test mode — re-registration wipes account (E2E test isolation)',
          value: config.testMode ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_ANONYMOUS',
          description: 'Anonymous mode — anyone can use the node without registering',
          value: config.anonymousMode ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_SCREENSHOT_AUTO',
          description: 'Auto-generate app thumbnails for apps with none (needs a headless browser)',
          value: config.screenshotAutoCapture ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_SCREENSHOT_INTERVAL_MIN',
          description: 'Minutes between auto-screenshot scans',
          value: String(config.screenshotIntervalMin),
          defaultVal: '15',
        },
        {
          envVar: 'AIMEAT_SCREENSHOT_SETTLE_MS',
          description: 'Ms to wait after page load before capturing (lets late-rendering apps finish)',
          value: String(config.screenshotSettleMs),
          defaultVal: '6000',
        },
        {
          envVar: 'AIMEAT_CORS_ALLOWED_ORIGINS',
          description: 'Allowed CORS origins (comma-separated, or * for all)',
          value: config.corsAllowedOrigins.join(', '),
          defaultVal: '*',
        },
      ],
    },
    {
      title: 'Morsel Economy (virtual currency)',
      entries: [
        {
          envVar: 'AIMEAT_WELCOME_BONUS',
          description: 'Morsels given to new users when they register',
          value: String(config.welcomeBonus),
          defaultVal: '100',
        },
        {
          envVar: 'AIMEAT_DAILY_ALLOWANCE',
          description: 'Morsels given to each user every day',
          value: String(config.dailyAllowance),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_DAILY_ALLOWANCE_CAP',
          description: 'Maximum morsels a user can accumulate from daily allowances',
          value: String(config.dailyAllowanceCap),
          defaultVal: '500',
        },
        {
          envVar: 'AIMEAT_BURN_RATE',
          description: 'Fraction of morsels destroyed per transaction (0 to 1)',
          value: String(config.burnRate),
          defaultVal: '0.10',
        },
        {
          envVar: 'AIMEAT_MAX_OPERATOR_MINT_PER_DAY',
          description: 'Maximum morsels the operator can create per day',
          value: String(config.maxOperatorMintPerDay),
          defaultVal: '10000',
        },
        {
          envVar: 'AIMEAT_BOARD_POST_BASE_COST',
          description: 'Base cost in morsels to post on a board',
          value: String(config.boardPostBaseCost),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_BOARD_POST_COST_PER_KB',
          description: 'Additional morsels per KB of board post content',
          value: String(config.boardPostCostPerKb),
          defaultVal: '2',
        },
      ],
    },
    {
      title: 'Features',
      entries: [
        {
          envVar: 'AIMEAT_KEYED_BROWSE',
          description: 'Allow browsing with API keys (Tier 0.5)',
          value: config.keyedBrowseEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_EXTENDED_FEATURES',
          description: 'Enable boards, federation, storage, and validation features',
          value: config.extendedFeaturesEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_PERSONAL_NODES_ENABLED',
          description: 'Allow users to connect personal nodes via WebSocket tunnel',
          value: config.personalNodesEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_EXTENSIONS_ENABLED',
          description: 'Enable sandboxed extension system',
          value: config.extensionsEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
      ],
    },
    {
      title: 'Quotas & Limits',
      entries: [
        {
          envVar: 'AIMEAT_MEMORY_QUOTA_MB',
          description: 'Maximum memory storage per user (MB)',
          value: String(config.memoryQuotaMb),
          defaultVal: '10',
        },
        {
          envVar: 'AIMEAT_MEMORY_MAX_VALUE_SIZE_KB',
          description: 'Maximum single memory value size (KB)',
          value: String(config.memoryMaxValueSizeKb),
          defaultVal: '1024',
        },
        {
          envVar: 'AIMEAT_MEMORY_MAX_KEYS',
          description: 'Maximum memory keys per agent',
          value: String(config.memoryMaxKeysPerAgent),
          defaultVal: '1000',
        },
        {
          envVar: 'AIMEAT_STORAGE_QUOTA_MB',
          description: 'Maximum file storage per user (MB)',
          value: String(config.storageQuotaMb),
          defaultVal: '100',
        },
        {
          envVar: 'AIMEAT_STORAGE_MAX_FILE_SIZE_MB',
          description: 'Maximum single file upload size (MB)',
          value: String(config.storageMaxFileSizeMb),
          defaultVal: '10',
        },
        {
          envVar: 'AIMEAT_MICRO_MEMORY_QUOTA_KB',
          description: 'Maximum micro-memory storage per agent (KB)',
          value: String(config.microMemoryQuotaKb),
          defaultVal: '500',
        },
        {
          envVar: 'AIMEAT_MICRO_MEMORY_MAX_SETS',
          description: 'Maximum micro-memory sets per agent',
          value: String(config.microMemoryMaxSetsPerAgent),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET',
          description: 'Maximum keys per micro-memory set',
          value: String(config.microMemoryMaxKeysPerSet),
          defaultVal: '100',
        },
        {
          envVar: 'AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE',
          description: 'Maximum micro-memory value size (bytes)',
          value: String(config.microMemoryMaxValueSizeBytes),
          defaultVal: '16384',
        },
        {
          envVar: 'AIMEAT_MAX_ACTIONS_PER_AGENT',
          description: 'Maximum action definitions per agent',
          value: String(config.maxActionsPerAgent),
          defaultVal: '20',
        },
        {
          envVar: 'AIMEAT_APP_MAX_SIZE_MB',
          description: 'Maximum app file upload size (MB)',
          value: String(config.appMaxSizeMb),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_AGENT_PORTING_FEE',
          description: 'Morsels charged for agent porting',
          value: String(config.agentPortingFeeMorsels),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_MAX_URL_LENGTH',
          description: 'Maximum allowed URL length in requests',
          value: String(config.maxUrlLength),
          defaultVal: '8192',
        },
      ],
    },
  ];
}
