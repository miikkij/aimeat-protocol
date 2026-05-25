/**
 * CLI config display — shows all settings with current values, defaults, and descriptions.
 * Usage: aimeat config
 */

import { existsSync } from 'node:fs';
import type { AimeatConfig } from '../config.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import { ENV_TO_DOT_PATH } from '../services/config-schema.js';

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

export function formatConfig(config: AimeatConfig, provenance?: ConfigProvenance): string {
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
      title: 'Storage',
      entries: [
        {
          envVar: 'AIMEAT_STORAGE',
          description: 'Storage backend (memory | sqlite | mongodb)',
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
          description: 'MongoDB connection URL (when mongodb)',
          value: config.storageProvider === 'mongodb'
            ? (config.dbUrl ? maskUrl(config.dbUrl) : '(not set — required for mongodb)')
            : '(n/a — not using mongodb)',
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
        {
          envVar: 'AIMEAT_CROSS_FEDERATION_ENABLED',
          description: 'Enable cross-federation genesis peering (connects independent nodes/clusters)',
          value: String(config.crossFederationEnabled),
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_MAX_GENESIS_PEERS',
          description: 'Maximum number of genesis peer connections',
          value: String(config.maxGenesisPeers),
          defaultVal: '10',
        },
        {
          envVar: 'AIMEAT_GENESIS_SYNC_INTERVAL_HOURS',
          description: 'Hours between catalogue sync with genesis peers',
          value: String(config.genesisSyncIntervalHours),
          defaultVal: '6',
        },
        {
          envVar: 'AIMEAT_SYNC_MODE',
          description: 'Sync mode: bulk (scheduled), instant (event-driven), or hybrid',
          value: config.syncMode,
          defaultVal: 'hybrid',
        },
        {
          envVar: 'AIMEAT_SYNC_INTERVAL_HOURS',
          description: 'Hours between scheduled federation sync rounds',
          value: String(config.syncIntervalHours),
          defaultVal: '6',
        },
        {
          envVar: 'AIMEAT_SYNC_BATCH_DELAY_MS',
          description: 'Event batching window in ms (instant/hybrid mode)',
          value: String(config.syncBatchDelayMs),
          defaultVal: '5000',
        },
        {
          envVar: 'AIMEAT_REPLICATION_QUEUE_MAX',
          description: 'Maximum replication queue entries',
          value: String(config.replicationQueueMax),
          defaultVal: '10000',
        },
        {
          envVar: 'AIMEAT_REPLICATION_QUEUE_TTL_HOURS',
          description: 'Max age of replication queue entries (hours)',
          value: String(config.replicationQueueTtlHours),
          defaultVal: '72',
        },
        {
          envVar: 'AIMEAT_MAX_CONCURRENT_SYNCS',
          description: 'Max parallel outbound sync operations',
          value: String(config.maxConcurrentSyncs),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_FEDERATION_TIMEOUT_MS',
          description: 'Timeout for outbound federation requests (ms)',
          value: String(config.federationTimeoutMs),
          defaultVal: '10000',
        },
        {
          envVar: 'AIMEAT_GENESIS_MEMORY_CACHE',
          description: 'Cache routed genesis memory results locally',
          value: String(config.genesisMemoryCache),
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_GENESIS_MEMORY_CACHE_TTL_HOURS',
          description: 'Genesis memory cache TTL (hours)',
          value: String(config.genesisMemoryCacheTtlHours),
          defaultVal: '4',
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
        {
          envVar: 'AIMEAT_RL_OWNERS',
          description: 'Owner endpoint rate limit (default: global)',
          value: String(config.rateLimits.owners.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_GHII',
          description: 'Identity (GHII) rate limit (default: global)',
          value: String(config.rateLimits.ghii.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_FLAGS',
          description: 'Content flagging rate limit (default: global)',
          value: String(config.rateLimits.flags.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_APPEALS',
          description: 'Flag appeals rate limit (default: global)',
          value: String(config.rateLimits.appeals.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_ADMIN_SETUP',
          description: 'Admin setup rate limit (default: global)',
          value: String(config.rateLimits.adminSetup.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_FEDERATION',
          description: 'Federation peering rate limit (default: global)',
          value: String(config.rateLimits.federation.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_CATALOGUE',
          description: 'Catalogue search rate limit (default: global)',
          value: String(config.rateLimits.catalogue.max),
          defaultVal: String(config.rateLimits.global.max),
        },
        {
          envVar: 'AIMEAT_RL_AUTH_CHALLENGE',
          description: 'Auth challenge rate limit (default: global)',
          value: String(config.rateLimits.authChallenge.max),
          defaultVal: String(config.rateLimits.global.max),
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
      title: 'Consent Layer',
      entries: [
        {
          envVar: 'AIMEAT_CONSENT_ENABLED',
          description: 'Enable consent-based data sharing permissions',
          value: String(config.consentEnabled),
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_CONSENT_MAX_PER_USER',
          description: 'Maximum consent rules per user',
          value: String(config.consentMaxPerUser),
          defaultVal: '100',
        },
        {
          envVar: 'AIMEAT_CONSENT_AUDIT_RETENTION_DAYS',
          description: 'How long to keep audit logs (days)',
          value: String(config.consentAuditRetentionDays),
          defaultVal: '365',
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
    {
      title: 'Push Notifications',
      entries: [
        {
          envVar: 'AIMEAT_PUSH_ENABLED',
          description: 'Push notifications enabled',
          value: config.pushEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_VAPID_PUBLIC_KEY',
          description: 'VAPID public key',
          value: config.vapidPublicKey ? mask(config.vapidPublicKey) : '(not set)',
          defaultVal: '(none)',
          secret: true,
        },
        {
          envVar: 'AIMEAT_VAPID_PRIVATE_KEY',
          description: 'VAPID private key',
          value: config.vapidPrivateKey ? mask(config.vapidPrivateKey) : '(not set)',
          defaultVal: '(none)',
          secret: true,
        },
        {
          envVar: 'AIMEAT_VAPID_SUBJECT',
          description: 'VAPID subject (contact URI)',
          value: config.vapidSubject,
          defaultVal: 'mailto:admin@aimeat.example.com',
        },
        {
          envVar: 'AIMEAT_PUSH_NOTIFY_TYPES',
          description: 'Message types triggering push',
          value: config.pushNotifyTypes.join(', '),
          defaultVal: 'work_assignment, action_request',
        },
        {
          envVar: 'AIMEAT_PUSH_COOLDOWN_MIN',
          description: 'Min minutes between notifications per node',
          value: String(config.pushCooldownMin),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE',
          description: 'Max subscriptions per node',
          value: String(config.pushMaxSubscriptionsPerNode),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_PUSH_MAX_FAILURES',
          description: 'Auto-remove after N failures',
          value: String(config.pushMaxFailures),
          defaultVal: '3',
        },
        {
          envVar: 'AIMEAT_EMAIL_RATE_LIMIT_MIN',
          description: 'Min minutes between email notifications',
          value: String(config.emailRateLimitMin),
          defaultVal: '30',
        },
      ],
    },
    {
      title: 'Email / SMTP',
      entries: [
        {
          envVar: 'AIMEAT_SMTP_HOST',
          description: 'SMTP server host',
          value: config.smtpHost ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_SMTP_PORT',
          description: 'SMTP port',
          value: String(config.smtpPort),
          defaultVal: '587',
        },
        {
          envVar: 'AIMEAT_SMTP_USER',
          description: 'SMTP username',
          value: config.smtpUser ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_SMTP_PASS',
          description: 'SMTP password',
          value: config.smtpPass ? '****' : '(not set)',
          defaultVal: '(none)',
          secret: true,
        },
        {
          envVar: 'AIMEAT_SMTP_FROM',
          description: 'From address',
          value: config.smtpFrom,
          defaultVal: 'AIMEAT <noreply@localhost>',
        },
        {
          envVar: 'AIMEAT_SMTP_SECURE',
          description: 'Use TLS (port 465)',
          value: config.smtpSecure ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_SMTP_REJECT_UNAUTHORIZED',
          description: 'Reject unauthorized TLS certificates',
          value: config.smtpRejectUnauthorized ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_EMAIL_CONFIRMATION_REQUIRED',
          description: 'Require email confirmation for registration',
          value: config.emailConfirmationRequired ? 'true' : 'false',
          defaultVal: 'false',
        },
      ],
    },
    {
      title: 'TOTP / 2FA',
      entries: [
        {
          envVar: 'AIMEAT_TOTP_ENABLED',
          description: 'Enable TOTP two-factor authentication',
          value: config.totpEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_TOTP_ISSUER',
          description: 'TOTP issuer name shown in authenticator apps',
          value: config.totpIssuer,
          defaultVal: 'AIMEAT',
        },
        {
          envVar: 'AIMEAT_TOTP_PERIOD',
          description: 'TOTP code rotation period (seconds)',
          value: String(config.totpPeriod),
          defaultVal: '30',
        },
        {
          envVar: 'AIMEAT_TOTP_WINDOW',
          description: 'Number of periods to accept before/after current',
          value: String(config.totpWindow),
          defaultVal: '1',
        },
        {
          envVar: 'AIMEAT_TOTP_BACKUP_CODE_COUNT',
          description: 'Number of backup codes generated',
          value: String(config.totpBackupCodeCount),
          defaultVal: '10',
        },
        {
          envVar: 'AIMEAT_TOTP_ENCRYPTION_KEY',
          description: 'Encryption key for TOTP secrets at rest',
          value: config.totpSecretEncryptionKey ? mask(config.totpSecretEncryptionKey) : '(not set)',
          defaultVal: '(none)',
          secret: true,
        },
        {
          envVar: 'AIMEAT_TOTP_MAX_FAILED',
          description: 'Max failed TOTP attempts before lockout',
          value: String(config.totpMaxFailedAttempts),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_TOTP_LOCKOUT_SECONDS',
          description: 'Lockout duration after max failed attempts (seconds)',
          value: String(config.totpLockoutSeconds),
          defaultVal: '300',
        },
      ],
    },
    {
      title: 'AI Matching',
      entries: [
        {
          envVar: 'AIMEAT_MATCHING_ENABLED',
          description: 'Enable AI-powered interest matching',
          value: config.matchingEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_MATCH_INTERVAL_HOURS',
          description: 'Hours between matching runs',
          value: String(config.matchIntervalHours),
          defaultVal: '24',
        },
        {
          envVar: 'AIMEAT_MATCH_THRESHOLD',
          description: 'Minimum similarity score for a match (0-1)',
          value: String(config.matchThreshold),
          defaultVal: '0.5',
        },
        {
          envVar: 'AIMEAT_MATCH_MAX_SUGGESTIONS',
          description: 'Maximum match suggestions per user',
          value: String(config.matchMaxSuggestions),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_MATCH_MAX_DISTANCE_KM',
          description: 'Maximum distance for location-based matching (km)',
          value: String(config.matchMaxDistanceKm),
          defaultVal: '100',
        },
        {
          envVar: 'AIMEAT_MATCH_COOLDOWN_DAYS',
          description: 'Days before re-suggesting a dismissed match',
          value: String(config.matchCooldownDays),
          defaultVal: '7',
        },
        {
          envVar: 'AIMEAT_MATCH_NOTIFICATION_ENABLED',
          description: 'Send notifications for new matches',
          value: config.matchNotificationEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_MATCH_NOTIFICATION_INTERVAL_HOURS',
          description: 'Hours between match notification digests',
          value: String(config.matchNotificationIntervalHours),
          defaultVal: '24',
        },
      ],
    },
    {
      title: 'Marketplace',
      entries: [
        {
          envVar: 'AIMEAT_MARKETPLACE_ENABLED',
          description: 'Enable marketplace features',
          value: config.marketplaceEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_MARKETPLACE_LISTING_FEE',
          description: 'Morsels charged to list an item',
          value: String(config.marketplaceListingFeeMorsels),
          defaultVal: '2',
        },
        {
          envVar: 'AIMEAT_MARKETPLACE_TX_FEE_PERCENT',
          description: 'Transaction fee percentage',
          value: String(config.marketplaceTransactionFeePercent),
          defaultVal: '5',
        },
        {
          envVar: 'AIMEAT_MARKETPLACE_ESCROW',
          description: 'Enable escrow for marketplace transactions',
          value: config.marketplaceEscrowEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
      ],
    },
    {
      title: 'EUDIW / Identity Verification',
      entries: [
        {
          envVar: 'AIMEAT_EUDIW_ENABLED',
          description: 'Enable EU Digital Identity Wallet verification',
          value: config.eudiwEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_EUDIW_CLIENT_ID',
          description: 'EUDIW verifier client ID',
          value: config.eudiwClientId,
          defaultVal: 'aimeat-verifier-001',
        },
        {
          envVar: 'AIMEAT_EUDIW_REDIRECT_URI',
          description: 'EUDIW OAuth redirect URI',
          value: config.eudiwRedirectUri || '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_FTN_ENABLED',
          description: 'Enable Finnish Trust Network authentication',
          value: config.ftnEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_FTN_PROVIDER_URL',
          description: 'FTN provider URL',
          value: config.ftnProviderUrl,
          defaultVal: 'https://tunnistautuminen.suomi.fi',
        },
        {
          envVar: 'AIMEAT_VC_ISSUER_DID',
          description: 'Verifiable Credential issuer DID',
          value: config.vcIssuerDid || '(not set)',
          defaultVal: '(none)',
        },
      ],
    },
    {
      title: 'Realtime P2P',
      entries: [
        {
          envVar: 'AIMEAT_REALTIME_ENABLED',
          description: 'Enable realtime P2P signaling (WebRTC)',
          value: config.realtimeEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_REALTIME_MAX_ROOMS',
          description: 'Maximum concurrent rooms',
          value: String(config.realtimeMaxRooms),
          defaultVal: '100',
        },
        {
          envVar: 'AIMEAT_REALTIME_MAX_PEERS_PER_ROOM',
          description: 'Maximum peers per room',
          value: String(config.realtimeMaxPeersPerRoom),
          defaultVal: '20',
        },
        {
          envVar: 'AIMEAT_REALTIME_ROOM_IDLE_TIMEOUT_MS',
          description: 'Room idle timeout (ms)',
          value: String(config.realtimeRoomIdleTimeoutMs),
          defaultVal: '3600000',
        },
        {
          envVar: 'AIMEAT_REALTIME_MAX_MESSAGE_SIZE',
          description: 'Maximum signaling message size (bytes)',
          value: String(config.realtimeMaxMessageSizeBytes),
          defaultVal: '16384',
        },
        {
          envVar: 'AIMEAT_REALTIME_RATE_LIMIT',
          description: 'Signaling messages per second per peer',
          value: String(config.realtimeRateLimitPerSecond),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_STUN_SERVERS',
          description: 'STUN server URLs (comma-separated)',
          value: config.stunServers.join(', '),
          defaultVal: 'stun:stun.l.google.com:19302',
        },
        {
          envVar: 'AIMEAT_TURN_SERVER',
          description: 'TURN relay server URL',
          value: config.turnServer ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_TURN_USERNAME',
          description: 'TURN server username',
          value: config.turnUsername ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_TURN_CREDENTIAL',
          description: 'TURN server credential',
          value: config.turnCredential ? '****' : '(not set)',
          defaultVal: '(none)',
          secret: true,
        },
      ],
    },
    {
      title: 'Site Load Balancer',
      entries: [
        {
          envVar: 'AIMEAT_SITE_LB_ENABLED',
          description: 'Enable site template load balancing from origin',
          value: config.siteLbEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_SITE_LB_ORIGIN_URL',
          description: 'Origin node URL to sync templates from',
          value: config.siteLbOriginUrl ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_SITE_LB_SYNC_INTERVAL_MIN',
          description: 'Sync interval (minutes)',
          value: String(config.siteLbSyncIntervalMin),
          defaultVal: '30',
        },
        {
          envVar: 'AIMEAT_SITE_LB_SYNC_ON_STARTUP',
          description: 'Sync template on node startup',
          value: config.siteLbSyncOnStartup ? 'true' : 'false',
          defaultVal: 'true',
        },
      ],
    },
    {
      title: 'Node Extensions (Sandboxed)',
      entries: [
        {
          envVar: 'AIMEAT_EXTENSIONS_ENABLED',
          description: 'Enable sandboxed extension system',
          value: config.extensionsEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_EXT_MAX_MEMORY_MB',
          description: 'Max memory per extension isolate (MB)',
          value: String(config.extensionMaxMemoryMb),
          defaultVal: '64',
        },
        {
          envVar: 'AIMEAT_EXT_TIMEOUT_MS',
          description: 'Extension execution timeout (ms)',
          value: String(config.extensionTimeoutMs),
          defaultVal: '5000',
        },
        {
          envVar: 'AIMEAT_EXT_MAX_API_CALLS',
          description: 'Max API calls per extension invocation',
          value: String(config.extensionMaxApiCalls),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_EXT_MAX_CODE_SIZE_KB',
          description: 'Max extension code size (KB)',
          value: String(config.extensionMaxCodeSizeKb),
          defaultVal: '256',
        },
        {
          envVar: 'AIMEAT_EXT_MAX_INSTALLED',
          description: 'Max installed extensions per node',
          value: String(config.extensionMaxInstalled),
          defaultVal: '20',
        },
        {
          envVar: 'AIMEAT_EXT_INSTALL_ROLE',
          description: 'Role required to install extensions (operator | owner)',
          value: config.extInstallRole,
          defaultVal: 'operator',
        },
        {
          envVar: 'AIMEAT_MAX_EXTENSIONS_PER_OWNER',
          description: 'Max extensions per owner when owner-role installs enabled',
          value: String(config.maxExtensionsPerOwner),
          defaultVal: '10',
        },
      ],
    },
    {
      title: 'Service Generator',
      entries: [
        {
          envVar: 'AIMEAT_GENERATOR_ENABLED',
          description: 'Show Generator tab in profile view',
          value: String(config.generatorEnabled),
          defaultVal: 'true',
        },
      ],
    },
    {
      title: 'Cortex Extensions (Manifest-based)',
      entries: [
        {
          envVar: 'AIMEAT_CORTEX_ENABLED',
          description: 'Enable Cortex extension system',
          value: config.cortexEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_CORTEX_MAX_INSTALLED',
          description: 'Max installed Cortex extensions',
          value: String(config.cortexMaxInstalled),
          defaultVal: '50',
        },
        {
          envVar: 'AIMEAT_CORTEX_MAX_LIB_SIZE_KB',
          description: 'Max Cortex library size (KB)',
          value: String(config.cortexMaxLibSizeKb),
          defaultVal: '512',
        },
      ],
    },
    {
      title: 'Portfolio',
      entries: [
        {
          envVar: 'AIMEAT_PORTFOLIO',
          description: 'Enable portfolio feature',
          value: config.portfolioEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_PORTFOLIO_MAX_SIZE_KB',
          description: 'Max portfolio size (KB)',
          value: String(config.portfolioMaxSizeKb),
          defaultVal: '512',
        },
        {
          envVar: 'AIMEAT_PORTFOLIO_MAX_IMAGES',
          description: 'Max portfolio images',
          value: String(config.portfolioMaxImages),
          defaultVal: '20',
        },
      ],
    },
    {
      title: 'Scoped Agent Capabilities',
      entries: [
        {
          envVar: 'AIMEAT_DEFAULT_AGENT_SCOPES',
          description: 'Default scopes granted to new agents',
          value: config.defaultAgentScopes.join(', '),
          defaultVal: 'memory:read, memory:write, memory:delete, catalogue:read',
        },
        {
          envVar: 'AIMEAT_MAX_AGENT_SCOPES',
          description: 'Maximum allowed scopes (* = unlimited)',
          value: config.maxAgentScopes.join(', '),
          defaultVal: '*',
        },
      ],
    },
    {
      title: 'Content Moderation',
      entries: [
        {
          envVar: 'AIMEAT_AUTO_HIDE_THRESHOLD',
          description: 'Flag count threshold to auto-hide content',
          value: String(config.autoHideThreshold),
          defaultVal: '5',
        },
      ],
    },
    {
      title: 'Setup Wizard',
      entries: [
        {
          envVar: 'AIMEAT_SETUP_ALLOWED_IPS',
          description: 'IPs allowed to access the setup wizard (comma-separated)',
          value: config.setupAllowedIps.length ? config.setupAllowedIps.join(', ') : '(all)',
          defaultVal: '(all)',
        },
      ],
    },
    {
      title: 'Consul (Fleet Management)',
      entries: [
        {
          envVar: 'AIMEAT_CONSUL_ENABLED',
          description: 'Enable Consul config provider',
          value: config.consulEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_CONSUL_URL',
          description: 'Consul agent URL',
          value: config.consulUrl,
          defaultVal: 'http://localhost:8500',
        },
        {
          envVar: 'AIMEAT_CONSUL_PREFIX',
          description: 'Consul KV prefix for config',
          value: config.consulPrefix,
          defaultVal: 'aimeat/config',
        },
        {
          envVar: 'AIMEAT_CONSUL_TOKEN',
          description: 'Consul ACL token',
          value: config.consulToken ? mask(config.consulToken) : '(not set)',
          defaultVal: '(none)',
          secret: true,
        },
        {
          envVar: 'AIMEAT_CONSUL_WATCH_INTERVAL',
          description: 'Config watch polling interval (seconds)',
          value: String(config.consulWatchIntervalSeconds),
          defaultVal: '30',
        },
        {
          envVar: 'AIMEAT_CONSUL_DATACENTER',
          description: 'Consul datacenter',
          value: config.consulDatacenter || '(default)',
          defaultVal: '(default)',
        },
      ],
    },
    {
      title: 'Metrics & Observability',
      entries: [
        {
          envVar: 'AIMEAT_STATS_ENABLED',
          description: 'Enable stats endpoint (GET /v1/stats)',
          value: config.statsEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_STATS_ACCESS',
          description: 'Stats access level (public | authenticated | operator)',
          value: config.statsAccess,
          defaultVal: 'public',
        },
        {
          envVar: 'AIMEAT_METRICS_ENABLED',
          description: 'Enable Prometheus metrics endpoint (GET /v1/metrics)',
          value: config.metricsEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_METRICS_ACCESS',
          description: 'Metrics access level (public | authenticated | operator)',
          value: config.metricsAccess,
          defaultVal: 'operator',
        },
      ],
    },
  ];

  const lines: string[] = [];
  lines.push('');
  lines.push('  AIMEAT Node Configuration');
  lines.push('  ══════════════════════════════════════════════════════');

  const envFile = existsSync('.env');
  const iniFile = existsSync('aimeat.ini');
  const jsonFile = existsSync('aimeat.json');
  const sources: string[] = [];
  if (envFile) sources.push('.env');
  if (iniFile) sources.push('aimeat.ini');
  if (jsonFile) sources.push('aimeat.json');
  if (provenance) sources.push('database');
  if (sources.length > 0) {
    lines.push(`  Sources: ${sources.join(', ')}`);
  } else {
    lines.push('  Sources: environment variables only (no .env or config file found)');
  }
  lines.push(`  Precedence: database > consul > file > .env > defaults`);
  lines.push('');

  for (const section of sections) {
    lines.push(`  ${section.title}`);
    lines.push('  ' + '─'.repeat(52));

    for (const entry of section.entries) {
      // Determine source tag
      let tag: string;
      if (provenance) {
        const dotPath = ENV_TO_DOT_PATH[entry.envVar];
        const src = dotPath ? provenance.getSource(dotPath) : 'default';
        tag = entry.secret ? '' : ` [${src}]`;
      } else {
        const isDefault = !entry.secret && entry.value === entry.defaultVal;
        const isExplicit = !isDefault && env[entry.envVar] !== undefined;
        tag = entry.secret ? '' : isExplicit ? ' (set)' : ' (default)';
      }

      lines.push(`    ${entry.envVar}${tag}`);
      lines.push(`      ${entry.description}`);
      lines.push(`      Value: ${entry.value}`);
      lines.push('');
    }
  }

  lines.push('  ══════════════════════════════════════════════════════');
  lines.push('  To change a setting, use one of these methods:');
  lines.push('    1. Admin dashboard (persisted to database)');
  lines.push('    2. Edit aimeat.ini or aimeat.json in your node directory');
  lines.push('    3. Edit the .env file');
  lines.push('  Run "aimeat validate" to check for problems.');
  lines.push('');

  return lines.join('\n');
}

