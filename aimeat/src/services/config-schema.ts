/**
 * Shared config field definitions — single source of truth.
 *
 * Used by:
 *  - admin.ts (GET + PUT /v1/admin/config)
 *  - config.ts (applyConfigOverrides on startup)
 *  - consul-config.ts (watch callback applying live changes)
 *  - config-loader.ts (env/file source mapping)
 *  - CLI tools (config export/import)
 */

import type { AimeatConfig } from '../config.js';

// ── Field Definition ──

export interface ConfigFieldDef {
  /** AimeatConfig property name (e.g. 'welcomeBonus') */
  key: keyof AimeatConfig;
  /** Dot-path notation for admin API (e.g. 'morsel_policy.welcome_bonus') */
  dotPath: string;
  /** AIMEAT_* environment variable name */
  envVar: string;
  /** Value type for raw-string parsing */
  type: 'number' | 'boolean' | 'string' | 'float' | 'object';
  /** Validation function */
  validate: (v: unknown) => boolean;
  /** true = cannot be changed after startup */
  immutable: boolean;
  /** Human-readable description */
  description: string;
  /** Valid range hint for numbers (e.g. '0-10000') */
  range?: string;
  /**
   * Admin API display mode:
   * - undefined / 'visible': shown with actual value
   * - 'configured': shown as dotPath_configured boolean (for secrets)
   * - 'hidden': omitted entirely (internal bootstrap fields)
   */
  adminDisplay?: 'visible' | 'configured' | 'hidden';
}

// ── All Known Config Fields ──

export const CONFIG_FIELDS: ConfigFieldDef[] = [

  // ── Node (immutable) ──
  { key: 'nodeId', dotPath: 'node.id', envVar: 'AIMEAT_NODE_ID', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: true, description: 'Unique node identifier' },
  { key: 'port', dotPath: 'node.port', envVar: 'AIMEAT_PORT', type: 'number', validate: v => typeof v === 'number' && v >= 1 && v <= 65535, immutable: true, description: 'HTTP listen port', range: '1-65535' },
  { key: 'nodeType', dotPath: 'node.type', envVar: 'AIMEAT_NODE_TYPE', type: 'string', validate: v => ['full', 'personal', 'relay'].includes(v as string), immutable: true, description: 'Node type: full, relay, or personal' },
  { key: 'storageProvider', dotPath: 'storage.type', envVar: 'AIMEAT_STORAGE', type: 'string', validate: v => ['mongodb', 'sqlite', 'memory'].includes(v as string), immutable: true, description: 'Storage backend type' },
  { key: 'dbUrl', dotPath: 'database_url', envVar: 'DATABASE_URL', type: 'string', validate: () => true, immutable: true, description: 'Database connection URL', adminDisplay: 'hidden' },
  { key: 'sqlitePath', dotPath: 'sqlite_path', envVar: 'AIMEAT_SQLITE_PATH', type: 'string', validate: () => true, immutable: true, description: 'SQLite database file path', adminDisplay: 'hidden' },
  { key: 'adminPassword', dotPath: 'admin_password', envVar: 'AIMEAT_ADMIN_PASSWORD', type: 'string', validate: () => true, immutable: true, description: 'Operator admin password', adminDisplay: 'hidden' },

  // ── Morsel Policy (mutable) ──
  { key: 'welcomeBonus', dotPath: 'morsel_policy.welcome_bonus', envVar: 'AIMEAT_WELCOME_BONUS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Morsels granted to new agents', range: '0-10000' },
  { key: 'dailyAllowance', dotPath: 'morsel_policy.daily_allowance', envVar: 'AIMEAT_DAILY_ALLOWANCE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Daily morsel allowance per agent', range: '0-10000' },
  { key: 'dailyAllowanceCap', dotPath: 'morsel_policy.daily_allowance_cap', envVar: 'AIMEAT_DAILY_ALLOWANCE_CAP', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Max balance for daily allowance eligibility', range: '0-100000' },
  { key: 'burnRate', dotPath: 'morsel_policy.burn_rate', envVar: 'AIMEAT_BURN_RATE', type: 'float', validate: v => typeof v === 'number' && (v as number) >= 0 && (v as number) <= 1, immutable: false, description: 'Fraction of network fees burned', range: '0.0-1.0' },
  { key: 'maxOperatorMintPerDay', dotPath: 'morsel_policy.max_operator_mint_per_day', envVar: 'AIMEAT_MAX_OPERATOR_MINT_PER_DAY', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Max morsels operator can mint per day', range: '0-1000000' },
  { key: 'boardPostBaseCost', dotPath: 'morsel_policy.board_post_base_cost', envVar: 'AIMEAT_BOARD_POST_BASE_COST', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Base morsel cost for public board posts', range: '0-1000' },
  { key: 'boardPostCostPerKb', dotPath: 'morsel_policy.board_post_cost_per_kb', envVar: 'AIMEAT_BOARD_POST_COST_PER_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Additional morsel cost per KB of post body', range: '0-100' },

  // ── Auth (mutable) ──
  { key: 'jwtTtlSeconds', dotPath: 'auth.jwt_ttl_seconds', envVar: 'AIMEAT_JWT_TTL', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 60, immutable: false, description: 'JWT token time-to-live in seconds', range: '60-86400' },

  // ── Features (mutable) ──
  { key: 'keyedBrowseEnabled', dotPath: 'features.keyed_browse_enabled', envVar: 'AIMEAT_KEYED_BROWSE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Allow browsing with API keys' },
  { key: 'extendedFeaturesEnabled', dotPath: 'features.extended_features_enabled', envVar: 'AIMEAT_EXTENDED_FEATURES', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable extended feature set' },

  // ── Work (mutable) ──
  { key: 'workQueueMaxPending', dotPath: 'work.queue_max_pending', envVar: 'AIMEAT_WORK_QUEUE_MAX_PENDING', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max pending work items per provider', range: '1-1000' },
  { key: 'webhookMaxRetries', dotPath: 'work.webhook_max_retries', envVar: 'AIMEAT_WEBHOOK_MAX_RETRIES', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Max webhook delivery retry attempts', range: '0-10' },

  // ── Quotas (mutable) ──
  { key: 'memoryQuotaMb', dotPath: 'quota.memory_mb', envVar: 'AIMEAT_MEMORY_QUOTA_MB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Memory quota per agent in MB', range: '1-10000' },
  { key: 'storageQuotaMb', dotPath: 'quota.storage_mb', envVar: 'AIMEAT_STORAGE_QUOTA_MB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Storage quota per agent in MB', range: '1-100000' },
  { key: 'microMemoryQuotaKb', dotPath: 'quota.micro_memory_kb', envVar: 'AIMEAT_MICRO_MEMORY_QUOTA_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Micro-memory quota per agent in KB', range: '1-10000' },

  // ── Federation (mutable) ──
  { key: 'maxRelayHops', dotPath: 'federation.max_relay_hops', envVar: 'AIMEAT_MAX_RELAY_HOPS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max relay hops for federated requests', range: '1-10' },

  // ── Rate Limits (mutable, per-endpoint with global fallback) ──
  { key: 'rlGlobal', dotPath: 'rate_limits.global', envVar: 'AIMEAT_RL_GLOBAL', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Global rate limit (requests/second)', range: '1-10000' },
  { key: 'rlAuth', dotPath: 'rate_limits.auth', envVar: 'AIMEAT_RL_AUTH', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Auth endpoint rate limit (req/s)', range: '1-10000' },
  { key: 'rlWork', dotPath: 'rate_limits.work', envVar: 'AIMEAT_RL_WORK', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Work queue rate limit (req/s)', range: '1-10000' },
  { key: 'rlMemory', dotPath: 'rate_limits.memory', envVar: 'AIMEAT_RL_MEMORY', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Memory read/write rate limit (req/s)', range: '1-10000' },
  { key: 'rlBoards', dotPath: 'rate_limits.boards', envVar: 'AIMEAT_RL_BOARDS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Board endpoint rate limit (req/s)', range: '1-10000' },
  { key: 'rlOwners', dotPath: 'rate_limits.owners', envVar: 'AIMEAT_RL_OWNERS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Owner endpoint rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlGhii', dotPath: 'rate_limits.ghii', envVar: 'AIMEAT_RL_GHII', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Identity (GHII) rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlFlags', dotPath: 'rate_limits.flags', envVar: 'AIMEAT_RL_FLAGS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Content flagging rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAppeals', dotPath: 'rate_limits.appeals', envVar: 'AIMEAT_RL_APPEALS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Flag appeals rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAdminSetup', dotPath: 'rate_limits.admin_setup', envVar: 'AIMEAT_RL_ADMIN_SETUP', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Admin setup rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlFederation', dotPath: 'rate_limits.federation', envVar: 'AIMEAT_RL_FEDERATION', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Federation peering rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlCatalogue', dotPath: 'rate_limits.catalogue', envVar: 'AIMEAT_RL_CATALOGUE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Catalogue search rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAuthChallenge', dotPath: 'rate_limits.auth_challenge', envVar: 'AIMEAT_RL_AUTH_CHALLENGE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Auth challenge rate limit (req/s, default: global)', range: '1-10000' },

  // ── Email (Phase 1.1, mutable) ──
  { key: 'emailEnabled', dotPath: 'email.enabled', envVar: 'AIMEAT_EMAIL_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Email service enabled (requires SMTP host)' },
  { key: 'emailConfirmationRequired', dotPath: 'email.confirmation_required', envVar: 'AIMEAT_EMAIL_CONFIRMATION_REQUIRED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Require email confirmation for registration' },
  { key: 'smtpHost', dotPath: 'email.smtp_host', envVar: 'AIMEAT_SMTP_HOST', type: 'string', validate: v => v === null || typeof v === 'string', immutable: false, description: 'SMTP server hostname' },
  { key: 'smtpPort', dotPath: 'email.smtp_port', envVar: 'AIMEAT_SMTP_PORT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535, immutable: false, description: 'SMTP server port', range: '1-65535' },
  { key: 'smtpFrom', dotPath: 'email.smtp_from', envVar: 'AIMEAT_SMTP_FROM', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'SMTP From address' },
  { key: 'smtpSecure', dotPath: 'email.smtp_secure', envVar: 'AIMEAT_SMTP_SECURE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Use implicit TLS (port 465). Set false for STARTTLS (port 587).' },
  { key: 'smtpRejectUnauthorized', dotPath: 'email.smtp_reject_unauthorized', envVar: 'AIMEAT_SMTP_REJECT_UNAUTHORIZED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Reject unauthorized TLS certificates. Set false for self-signed certs or STARTTLS.' },

  // ── Email secrets (immutable — read-only in admin) ──
  { key: 'smtpUser', dotPath: 'email.smtp_user', envVar: 'AIMEAT_SMTP_USER', type: 'string', validate: () => true, immutable: true, description: 'SMTP username (secret)', adminDisplay: 'configured' },
  { key: 'smtpPass', dotPath: 'email.smtp_pass', envVar: 'AIMEAT_SMTP_PASS', type: 'string', validate: () => true, immutable: true, description: 'SMTP password (secret)', adminDisplay: 'configured' },

  // ── Consent (Phase 0.3, mutable) ──
  { key: 'consentEnabled', dotPath: 'consent.enabled', envVar: 'AIMEAT_CONSENT_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Consent layer enabled' },
  { key: 'consentAuditRetentionDays', dotPath: 'consent.audit_retention_days', envVar: 'AIMEAT_CONSENT_AUDIT_RETENTION_DAYS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 3650, immutable: false, description: 'Consent audit log retention in days', range: '1-3650' },
  { key: 'consentMaxPerUser', dotPath: 'consent.max_per_user', envVar: 'AIMEAT_CONSENT_MAX_PER_USER', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10000, immutable: false, description: 'Max consent records per user', range: '1-10000' },

  // ── TOTP (Phase 0.5, mutable) ──
  { key: 'totpEnabled', dotPath: 'totp.enabled', envVar: 'AIMEAT_TOTP_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'TOTP two-factor authentication enabled' },
  { key: 'totpPeriod', dotPath: 'totp.period', envVar: 'AIMEAT_TOTP_PERIOD', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 15 && (v as number) <= 120, immutable: false, description: 'TOTP code rotation period in seconds', range: '15-120' },
  { key: 'totpWindow', dotPath: 'totp.window', envVar: 'AIMEAT_TOTP_WINDOW', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 5, immutable: false, description: 'TOTP validation window (codes before/after)', range: '0-5' },
  { key: 'totpMaxFailedAttempts', dotPath: 'totp.max_failed_attempts', envVar: 'AIMEAT_TOTP_MAX_FAILED', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 20, immutable: false, description: 'Max failed TOTP attempts before lockout', range: '1-20' },
  { key: 'totpLockoutSeconds', dotPath: 'totp.lockout_seconds', envVar: 'AIMEAT_TOTP_LOCKOUT_SECONDS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 30 && (v as number) <= 3600, immutable: false, description: 'TOTP lockout duration in seconds', range: '30-3600' },

  // ── TOTP secrets (immutable) ──
  { key: 'totpSecretEncryptionKey', dotPath: 'totp.encryption_key', envVar: 'AIMEAT_TOTP_ENCRYPTION_KEY', type: 'string', validate: () => true, immutable: true, description: 'TOTP encryption key (secret)', adminDisplay: 'configured' },

  // ── Matching (Phase 2.1, mutable) ──
  { key: 'matchingEnabled', dotPath: 'matching.enabled', envVar: 'AIMEAT_MATCHING_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'AI matching engine enabled' },
  { key: 'matchIntervalHours', dotPath: 'matching.interval_hours', envVar: 'AIMEAT_MATCH_INTERVAL_HOURS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 168, immutable: false, description: 'Hours between matching rounds', range: '1-168' },
  { key: 'matchThreshold', dotPath: 'matching.threshold', envVar: 'AIMEAT_MATCH_THRESHOLD', type: 'float', validate: v => typeof v === 'number' && (v as number) >= 0 && (v as number) <= 1, immutable: false, description: 'Minimum match score threshold', range: '0.0-1.0' },
  { key: 'matchMaxSuggestions', dotPath: 'matching.max_suggestions', envVar: 'AIMEAT_MATCH_MAX_SUGGESTIONS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 50, immutable: false, description: 'Max match suggestions per user', range: '1-50' },
  { key: 'matchMaxDistanceKm', dotPath: 'matching.max_distance_km', envVar: 'AIMEAT_MATCH_MAX_DISTANCE_KM', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 50000, immutable: false, description: 'Max geographic distance for matches in km', range: '1-50000' },
  { key: 'matchCooldownDays', dotPath: 'matching.cooldown_days', envVar: 'AIMEAT_MATCH_COOLDOWN_DAYS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 365, immutable: false, description: 'Days before re-matching same pair', range: '1-365' },

  // ── Marketplace (Phase 2.6, mutable) ──
  { key: 'marketplaceEnabled', dotPath: 'marketplace.enabled', envVar: 'AIMEAT_MARKETPLACE_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Marketplace feature enabled' },
  { key: 'marketplaceListingFeeMorsels', dotPath: 'marketplace.listing_fee', envVar: 'AIMEAT_MARKETPLACE_LISTING_FEE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10000, immutable: false, description: 'Morsel fee for creating a listing', range: '0-10000' },
  { key: 'marketplaceTransactionFeePercent', dotPath: 'marketplace.tx_fee_percent', envVar: 'AIMEAT_MARKETPLACE_TX_FEE_PERCENT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 50, immutable: false, description: 'Transaction fee percentage', range: '0-50' },
  { key: 'marketplaceEscrowEnabled', dotPath: 'marketplace.escrow_enabled', envVar: 'AIMEAT_MARKETPLACE_ESCROW', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Escrow for marketplace transactions' },

  // ── Extensions (Phase 2.7, mutable) ──
  { key: 'extensionsEnabled', dotPath: 'extensions.enabled', envVar: 'AIMEAT_EXTENSIONS_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'V8 isolate extension system enabled' },
  { key: 'extensionMaxMemoryMb', dotPath: 'extensions.max_memory_mb', envVar: 'AIMEAT_EXT_MAX_MEMORY_MB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 8 && (v as number) <= 512, immutable: false, description: 'Max memory per extension isolate (MB)', range: '8-512' },
  { key: 'extensionTimeoutMs', dotPath: 'extensions.timeout_ms', envVar: 'AIMEAT_EXT_TIMEOUT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 100 && (v as number) <= 60000, immutable: false, description: 'Extension execution timeout (ms)', range: '100-60000' },
  { key: 'extensionMaxApiCalls', dotPath: 'extensions.max_api_calls', envVar: 'AIMEAT_EXT_MAX_API_CALLS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 500, immutable: false, description: 'Max API calls per extension execution', range: '1-500' },
  { key: 'extensionMaxCodeSizeKb', dotPath: 'extensions.max_code_size_kb', envVar: 'AIMEAT_EXT_MAX_CODE_SIZE_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 16 && (v as number) <= 2048, immutable: false, description: 'Max code size per extension (KB)', range: '16-2048' },
  { key: 'extensionMaxInstalled', dotPath: 'extensions.max_installed', envVar: 'AIMEAT_EXT_MAX_INSTALLED', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100, immutable: false, description: 'Max installed extensions', range: '1-100' },

  // ── Push Notifications (Phase 3.1, mutable) ──
  { key: 'pushEnabled', dotPath: 'push.enabled', envVar: 'AIMEAT_PUSH_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Web push notifications enabled' },

  // ── Push secrets (immutable) ──
  { key: 'vapidPublicKey', dotPath: 'push.vapid_public_key', envVar: 'AIMEAT_VAPID_PUBLIC_KEY', type: 'string', validate: () => true, immutable: true, description: 'VAPID public key (secret)', adminDisplay: 'hidden' },
  { key: 'vapidPrivateKey', dotPath: 'push.vapid_private_key', envVar: 'AIMEAT_VAPID_PRIVATE_KEY', type: 'string', validate: () => true, immutable: true, description: 'VAPID private key (secret)', adminDisplay: 'hidden' },

  // ── EUDIW / Identity (Phase 3.3, mutable) ──
  { key: 'eudiwEnabled', dotPath: 'eudiw.enabled', envVar: 'AIMEAT_EUDIW_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'EUDIW identity verification enabled' },
  { key: 'ftnEnabled', dotPath: 'eudiw.ftn_enabled', envVar: 'AIMEAT_FTN_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Finnish Trust Network enabled' },

  // ── Cross-Federation (Phase 3.4, mutable) ──
  { key: 'crossFederationEnabled', dotPath: 'cross_federation.enabled', envVar: 'AIMEAT_CROSS_FEDERATION_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Cross-federation peering enabled' },
  { key: 'maxGenesisPeers', dotPath: 'cross_federation.max_genesis_peers', envVar: 'AIMEAT_MAX_GENESIS_PEERS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100, immutable: false, description: 'Max genesis peers for cross-federation', range: '1-100' },
  { key: 'genesisSyncIntervalHours', dotPath: 'cross_federation.sync_interval_hours', envVar: 'AIMEAT_GENESIS_SYNC_INTERVAL_HOURS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 168, immutable: false, description: 'Hours between genesis sync rounds', range: '1-168' },

  // ── Federation Data Sync (mutable) ──
  { key: 'syncMode', dotPath: 'federation_sync.mode', envVar: 'AIMEAT_SYNC_MODE', type: 'string', validate: v => ['bulk', 'instant', 'hybrid'].includes(v as string), immutable: false, description: 'Sync mode: bulk (scheduled), instant (event-driven), or hybrid (both)' },
  { key: 'syncIntervalHours', dotPath: 'federation_sync.interval_hours', envVar: 'AIMEAT_SYNC_INTERVAL_HOURS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 168, immutable: false, description: 'Hours between scheduled sync rounds', range: '1-168' },
  { key: 'syncBatchDelayMs', dotPath: 'federation_sync.batch_delay_ms', envVar: 'AIMEAT_SYNC_BATCH_DELAY_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 100 && (v as number) <= 60000, immutable: false, description: 'Event batching window in ms (instant/hybrid mode)', range: '100-60000' },
  { key: 'replicationQueueMax', dotPath: 'federation_sync.replication_queue_max', envVar: 'AIMEAT_REPLICATION_QUEUE_MAX', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 100 && (v as number) <= 100000, immutable: false, description: 'Max replication queue entries', range: '100-100000' },
  { key: 'replicationQueueTtlHours', dotPath: 'federation_sync.replication_queue_ttl_hours', envVar: 'AIMEAT_REPLICATION_QUEUE_TTL_HOURS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 720, immutable: false, description: 'Max age of replication queue entries in hours', range: '1-720' },
  { key: 'maxConcurrentSyncs', dotPath: 'federation_sync.max_concurrent_syncs', envVar: 'AIMEAT_MAX_CONCURRENT_SYNCS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 50, immutable: false, description: 'Max parallel outbound sync operations', range: '1-50' },
  { key: 'federationTimeoutMs', dotPath: 'federation_sync.timeout_ms', envVar: 'AIMEAT_FEDERATION_TIMEOUT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1000 && (v as number) <= 60000, immutable: false, description: 'Timeout for outbound federation requests in ms', range: '1000-60000' },
  { key: 'genesisMemoryCache', dotPath: 'federation_sync.genesis_memory_cache', envVar: 'AIMEAT_GENESIS_MEMORY_CACHE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Cache routed genesis memory results locally' },
  { key: 'genesisMemoryCacheTtlHours', dotPath: 'federation_sync.genesis_memory_cache_ttl_hours', envVar: 'AIMEAT_GENESIS_MEMORY_CACHE_TTL_HOURS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 168, immutable: false, description: 'Genesis memory cache TTL in hours', range: '1-168' },

  // ── Personal Nodes (mutable) ──
  { key: 'personalNodesEnabled', dotPath: 'personal_nodes.enabled', envVar: 'AIMEAT_PERSONAL_NODES_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Personal node hosting enabled' },
  { key: 'personalNodeMaxSlots', dotPath: 'personal_nodes.max_slots', envVar: 'AIMEAT_PERSONAL_NODE_MAX_SLOTS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10000, immutable: false, description: 'Max personal node slots', range: '1-10000' },

  // ── Match Notifications (Phase 1.6, mutable) ──
  { key: 'matchNotificationEnabled', dotPath: 'match_notifications.enabled', envVar: 'AIMEAT_MATCH_NOTIFICATION_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Match notification emails enabled' },
  { key: 'matchNotificationIntervalHours', dotPath: 'match_notifications.interval_hours', envVar: 'AIMEAT_MATCH_NOTIFICATION_INTERVAL_HOURS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 168, immutable: false, description: 'Hours between match notification batches', range: '1-168' },

  // ── Consul (immutable — set before startup) ──
  { key: 'consulEnabled', dotPath: 'consul.enabled', envVar: 'AIMEAT_CONSUL_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: true, description: 'Enable Consul integration' },
  { key: 'consulUrl', dotPath: 'consul.url', envVar: 'AIMEAT_CONSUL_URL', type: 'string', validate: () => true, immutable: true, description: 'Consul HTTP URL' },
  { key: 'consulPrefix', dotPath: 'consul.prefix', envVar: 'AIMEAT_CONSUL_PREFIX', type: 'string', validate: () => true, immutable: true, description: 'Consul KV prefix' },
  { key: 'consulToken', dotPath: 'consul.token', envVar: 'AIMEAT_CONSUL_TOKEN', type: 'string', validate: () => true, immutable: true, description: 'Consul ACL token', adminDisplay: 'configured' },
  { key: 'consulWatchIntervalSeconds', dotPath: 'consul.watch_interval_seconds', envVar: 'AIMEAT_CONSUL_WATCH_INTERVAL', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 3600, immutable: true, description: 'Consul watch poll interval in seconds', range: '5-3600' },
  { key: 'consulDatacenter', dotPath: 'consul.datacenter', envVar: 'AIMEAT_CONSUL_DATACENTER', type: 'string', validate: () => true, immutable: true, description: 'Consul datacenter name' },
];

// ── Derived Lookup Maps ──

/** dotPath -> ConfigFieldDef (mutable fields only) */
export const MUTABLE_CONFIG_MAP: Record<string, ConfigFieldDef> = {};

/** dotPath -> ConfigFieldDef (all fields) */
export const ALL_CONFIG_MAP: Record<string, ConfigFieldDef> = {};

/** AIMEAT_* env var name -> dotPath */
export const ENV_TO_DOT_PATH: Record<string, string> = {};

/** dotPath -> AIMEAT_* env var name */
export const DOT_PATH_TO_ENV: Record<string, string> = {};

for (const field of CONFIG_FIELDS) {
  ALL_CONFIG_MAP[field.dotPath] = field;
  if (!field.immutable) MUTABLE_CONFIG_MAP[field.dotPath] = field;
  ENV_TO_DOT_PATH[field.envVar] = field.dotPath;
  DOT_PATH_TO_ENV[field.dotPath] = field.envVar;
}

// ── Helper Functions ──

/** Check if a dot-path is immutable (unknown fields default to immutable for safety) */
export function isImmutable(dotPath: string): boolean {
  return ALL_CONFIG_MAP[dotPath]?.immutable ?? true;
}

/** Parse a raw string value using the field's type definition */
export function parseConfigValue(field: ConfigFieldDef, raw: string): unknown {
  switch (field.type) {
    case 'number': return parseInt(raw, 10);
    case 'float':  return parseFloat(raw);
    case 'boolean': return raw === 'true';
    case 'object': {
      try { return JSON.parse(raw); } catch { return null; }
    }
    case 'string':
    default:
      return raw;
  }
}

/** Serialize a typed value to raw string for storage */
export function serializeConfigValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}
