/**
 * CLI config display — shows all settings with current values, defaults, and descriptions.
 * Usage: aimeat config
 */

import { existsSync } from 'node:fs';
import type { AimeatConfig } from '../config.js';

interface ConfigEntry {
  envVar: string;
  description: string;
  value: string;
  defaultVal: string;
  secret?: boolean;
}

interface ConfigSection {
  title: string;
  entries: ConfigEntry[];
}

function mask(val: string): string {
  if (val.length <= 4) return '****';
  return val.slice(0, 2) + '*'.repeat(val.length - 4) + val.slice(-2);
}

function maskUrl(url: string): string {
  return url.replace(/\/\/([^@]+)@/, '//*****@');
}

export function formatConfig(config: AimeatConfig): string {
  const env = process.env;

  const sections: ConfigSection[] = [
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
      title: 'Database',
      entries: [
        {
          envVar: 'DATABASE_URL',
          description: 'MongoDB connection URL. Leave empty for in-memory storage (data lost on restart)',
          value: config.dbUrl ? maskUrl(config.dbUrl) : '(not set — using in-memory storage)',
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
          description: 'How long login tokens last (in seconds)',
          value: String(config.jwtTtlSeconds),
          defaultVal: '3600',
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
          description: 'Developer mode — bypasses some security checks for testing',
          value: config.devMode ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_ANONYMOUS',
          description: 'Anonymous mode — anyone can use the node without registering',
          value: config.anonymousMode ? 'true' : 'false',
          defaultVal: 'false',
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
          defaultVal: '64',
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
          defaultVal: '1024',
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
    {
      title: 'Federation',
      entries: [
        {
          envVar: 'AIMEAT_FEDERATION_ROLE',
          description: 'Network role: operator (genesis directory), contributor (join genesis), standalone',
          value: config.federationRole,
          defaultVal: 'standalone',
        },
        {
          envVar: 'AIMEAT_GENESIS_URL',
          description: 'Genesis node URL to register with (for contributor role)',
          value: config.genesisUrl ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_MAX_RELAY_HOPS',
          description: 'Maximum number of hops when relaying between nodes',
          value: String(config.maxRelayHops),
          defaultVal: '3',
        },
        {
          envVar: 'AIMEAT_DEPEERING_GRACE_HOURS',
          description: 'Hours to wait before removing a disconnected peer',
          value: String(config.depeeringGracePeriodHours),
          defaultVal: '72',
        },
        {
          envVar: 'AIMEAT_KEY_CACHE_REFRESH_MINUTES',
          description: 'How often to refresh peer key cache (minutes)',
          value: String(config.keyCacheRefreshMinutes),
          defaultVal: '5',
        },
      ],
    },
    {
      title: 'Work Queue',
      entries: [
        {
          envVar: 'AIMEAT_WEBHOOK_MAX_RETRIES',
          description: 'Maximum retry attempts for webhook deliveries',
          value: String(config.webhookMaxRetries),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_WORK_QUEUE_MAX_PENDING',
          description: 'Maximum pending work items per agent',
          value: String(config.workQueueMaxPending),
          defaultVal: '10',
        },
      ],
    },
    {
      title: 'Rate Limits (requests per second)',
      entries: [
        {
          envVar: 'AIMEAT_RL_GLOBAL',
          description: 'Global rate limit for all requests',
          value: String(config.rateLimits.global.max),
          defaultVal: '300',
        },
        {
          envVar: 'AIMEAT_RL_AUTH',
          description: 'Rate limit for authentication requests',
          value: String(config.rateLimits.auth.max),
          defaultVal: '20',
        },
        {
          envVar: 'AIMEAT_RL_WORK',
          description: 'Rate limit for work queue requests',
          value: String(config.rateLimits.work.max),
          defaultVal: '60',
        },
        {
          envVar: 'AIMEAT_RL_MEMORY',
          description: 'Rate limit for memory read/write requests',
          value: String(config.rateLimits.memory.max),
          defaultVal: '120',
        },
        {
          envVar: 'AIMEAT_RL_BOARDS',
          description: 'Rate limit for board requests',
          value: String(config.rateLimits.boards.max),
          defaultVal: '60',
        },
      ],
    },
    {
      title: 'Search Indexing',
      entries: [
        {
          envVar: 'AIMEAT_INDEXNOW_KEY',
          description: 'IndexNow key for Bing/Yandex search indexing. Run "pnpm indexnow" after setting.',
          value: config.indexNowKey ?? '(not set)',
          defaultVal: '(none)',
        },
      ],
    },
    {
      title: 'Personal Nodes',
      entries: [
        {
          envVar: 'AIMEAT_PERSONAL_NODE_MAX_SLOTS',
          description: 'Maximum number of personal nodes that can connect',
          value: String(config.personalNodeMaxSlots),
          defaultVal: '100',
        },
        {
          envVar: 'AIMEAT_PERSONAL_MAILBOX_QUOTA_MB',
          description: 'Mailbox storage quota per personal node (MB)',
          value: String(config.personalNodeMailboxQuotaMb),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS',
          description: 'How many days to keep messages in personal node mailbox',
          value: String(config.personalNodeMailboxRetentionDays),
          defaultVal: '7',
        },
        {
          envVar: 'AIMEAT_PERSONAL_REQUEST_TIMEOUT_MS',
          description: 'Tunnel request timeout for forwarded messages (ms)',
          value: String(config.personalNodeRequestTimeoutMs),
          defaultVal: '60000',
        },
      ],
    },
    {
      title: 'Node Portal (Site)',
      entries: [
        {
          envVar: 'AIMEAT_SITE_ENABLED',
          description: 'Enable custom HTML template portal at GET /',
          value: String(config.siteEnabled),
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB',
          description: 'Maximum template HTML size (KB)',
          value: String(config.siteMaxTemplateSizeKb),
          defaultVal: '512',
        },
        {
          envVar: 'AIMEAT_SITE_CACHE_TTL_SECONDS',
          description: 'Resolved template cache TTL (seconds, 0 = no cache)',
          value: String(config.siteCacheTtlSeconds),
          defaultVal: '60',
        },
      ],
    },
    {
      title: 'Cookie Consent',
      entries: [
        {
          envVar: 'AIMEAT_COOKIE_CONSENT_ENABLED',
          description: 'Enable cookie consent banner for portal pages',
          value: String(config.cookieConsentEnabled),
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_COOKIE_CONSENT_CATEGORIES',
          description: 'Consent categories (comma-separated)',
          value: config.cookieConsentCategories.join(','),
          defaultVal: 'necessary',
        },
        {
          envVar: 'AIMEAT_COOKIE_CONSENT_POLICY_URL',
          description: 'Privacy policy URL',
          value: config.cookieConsentPolicyUrl ?? '(not set)',
          defaultVal: '(not set)',
        },
      ],
    },
  ];

  const lines: string[] = [];
  lines.push('');
  lines.push('  AIMEAT Node Configuration');
  lines.push('  ══════════════════════════════════════════════════════');

  const envFile = existsSync('.env');
  if (envFile) {
    lines.push('  Source: .env file in current directory');
  } else {
    lines.push('  Source: environment variables only (no .env file found)');
  }
  lines.push('');

  for (const section of sections) {
    lines.push(`  ${section.title}`);
    lines.push('  ' + '─'.repeat(52));

    for (const entry of section.entries) {
      const isDefault = !entry.secret && entry.value === entry.defaultVal;
      const isExplicit = !isDefault && env[entry.envVar] !== undefined;

      const tag = entry.secret
        ? ''
        : isExplicit
          ? ' (set)'
          : ' (default)';

      lines.push(`    ${entry.envVar}${tag}`);
      lines.push(`      ${entry.description}`);
      lines.push(`      Value: ${entry.value}`);
      lines.push('');
    }
  }

  lines.push('  ══════════════════════════════════════════════════════');
  lines.push('  To change a setting, edit the .env file in your node directory.');
  lines.push('  Run "aimeat validate" to check for problems.');
  lines.push('');

  return lines.join('\n');
}

