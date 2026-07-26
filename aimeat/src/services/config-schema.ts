/**
 * @file src/services/config-schema.ts
 * @description Single source of truth for AIMEAT's tunable config fields — each entry maps an
 *   AimeatConfig key to its admin dot-path, AIMEAT_* env var, type, validator, mutability, and admin
 *   display mode. Consumed by the admin config API, startup overrides, live Consul updates, the config
 *   loader, and CLI export/import.
 *
 * @structure
 *   - ConfigFieldDef: the field-definition interface (key, dotPath, envVar, type, validate, immutable, adminDisplay)
 *   - CONFIG_FIELDS: the exhaustive field list grouped by domain (node, morsel policy, auth, features, work, quotas, federation, ...)
 *
 * @version-history
 *   v1.1.0 — 2026-07-14 — mcpCardCommerceTools row (TARGET-034 phase D)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
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
  { key: 'storageProvider', dotPath: 'storage.type', envVar: 'AIMEAT_STORAGE', type: 'string', validate: v => ['sqlite', 'memory', 'postgres', 'postgresql', 'postgres-kysely'].includes(v as string), immutable: true, description: 'Storage backend type' },
  { key: 'dbUrl', dotPath: 'database_url', envVar: 'DATABASE_URL', type: 'string', validate: () => true, immutable: true, description: 'Database connection URL', adminDisplay: 'hidden' },
  { key: 'sqlitePath', dotPath: 'sqlite_path', envVar: 'AIMEAT_SQLITE_PATH', type: 'string', validate: () => true, immutable: true, description: 'SQLite database file path', adminDisplay: 'hidden' },
  { key: 'adminPassword', dotPath: 'admin_password', envVar: 'AIMEAT_ADMIN_PASSWORD', type: 'string', validate: () => true, immutable: true, description: 'Operator admin password', adminDisplay: 'hidden' },

  // ── Morsel Policy (mutable) ──
  { key: 'welcomeBonus', dotPath: 'morsel_policy.welcome_bonus', envVar: 'AIMEAT_WELCOME_BONUS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Morsels granted to new agents', range: '0-10000' },
  { key: 'dailyAllowance', dotPath: 'morsel_policy.daily_allowance', envVar: 'AIMEAT_DAILY_ALLOWANCE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Daily morsel allowance per agent', range: '0-10000' },
  // The pacing floor sits with the morsel policy because that is what it is: how fast the daily
  // allowance lets anyone consume a capability, whatever they pay for it in.
  { key: 'pacingTollDefault', dotPath: 'morsel_policy.pacing_toll_default', envVar: 'AIMEAT_PACING_TOLL_DEFAULT', type: 'number',
    validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100, immutable: false,
    description: 'Morsels burned per metered call when a capability declares no toll of its own. Bounds the call RATE for every capability, including money-priced ones. 0 = off; at 1 a consumer can make about 500 calls a day.',
    range: '0-100' },
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

  // ── Commerce core + fee policy (TARGET-033, mutable) ──
  { key: 'marketplaceFeeMode', dotPath: 'commerce.fee_mode', envVar: 'AIMEAT_MARKETPLACE_FEE_MODE', type: 'string', validate: v => v === 'operator' || v === 'burn', immutable: false, description: 'Marketplace fee destination: operator (credited to node operator) or burn', range: 'operator|burn' },
  { key: 'operatorFeeAccount', dotPath: 'commerce.operator_fee_account', envVar: 'AIMEAT_OPERATOR_FEE_ACCOUNT', type: 'string', validate: v => v === null || (typeof v === 'string' && (v as string).length <= 100), immutable: false, description: 'Owner name whose GHII receives operator-mode fees (empty = first operator-role owner)' },
  { key: 'commerceFeePercent', dotPath: 'commerce.fee_percent', envVar: 'AIMEAT_COMMERCE_FEE_PERCENT', type: 'number', validate: v => v === null || (typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 50), immutable: false, description: 'Checkout fee percentage (empty inherits marketplace tx fee percent)', range: '0-50' },
  { key: 'commerceEnabled', dotPath: 'commerce.enabled', envVar: 'AIMEAT_COMMERCE_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Checkout sessions (/v1/commerce) enabled' },
  { key: 'commerceSessionTtlMinutes', dotPath: 'commerce.session_ttl_minutes', envVar: 'AIMEAT_COMMERCE_SESSION_TTL_MINUTES', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 10080, immutable: false, description: 'Open checkout-session lifetime in minutes', range: '5-10080' },
  { key: 'mcpCardCommerceTools', dotPath: 'commerce.mcp_card_tools', envVar: 'AIMEAT_MCP_CARD_COMMERCE_TOOLS', type: 'string', validate: v => v === 'inline' || v === 'pointer', immutable: false, description: 'MCP Server Card commerce_tools mode: inline (embed priced app-tool catalog) or pointer (link /v1/commerce/tools)' },
  { key: 'contentSignal', dotPath: 'site.content_signal', envVar: 'AIMEAT_CONTENT_SIGNAL', type: 'string', validate: v => typeof v === 'string' && /^(off|(search|ai-input|ai-train)=(yes|no)(\s*,\s*(search|ai-input|ai-train)=(yes|no)){0,2})$/i.test((v as string).trim()), immutable: false, description: 'robots.txt Content Signals Policy directive (contentsignals.org), e.g. "search=yes, ai-input=yes, ai-train=no"; "off" removes it' },
  { key: 'webBotAuthSign', dotPath: 'federation.web_bot_auth_sign', envVar: 'AIMEAT_WEB_BOT_AUTH_SIGN', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Sign outbound HTTP with the node Ed25519 key (RFC 9421 Web Bot Auth); the key directory is always served' },

  // ── Extensions (Phase 2.7, mutable) ──
  { key: 'extensionsEnabled', dotPath: 'extensions.enabled', envVar: 'AIMEAT_EXTENSIONS_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Sandboxed extension system enabled' },
  { key: 'extensionMaxMemoryMb', dotPath: 'extensions.max_memory_mb', envVar: 'AIMEAT_EXT_MAX_MEMORY_MB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 8 && (v as number) <= 512, immutable: false, description: 'Max memory per extension sandbox (MB)', range: '8-512' },
  { key: 'extensionTimeoutMs', dotPath: 'extensions.timeout_ms', envVar: 'AIMEAT_EXT_TIMEOUT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 100 && (v as number) <= 60000, immutable: false, description: 'Extension execution timeout (ms)', range: '100-60000' },
  { key: 'extensionMaxApiCalls', dotPath: 'extensions.max_api_calls', envVar: 'AIMEAT_EXT_MAX_API_CALLS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 500, immutable: false, description: 'Max API calls per extension execution', range: '1-500' },
  { key: 'extensionMaxCodeSizeKb', dotPath: 'extensions.max_code_size_kb', envVar: 'AIMEAT_EXT_MAX_CODE_SIZE_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 16 && (v as number) <= 2048, immutable: false, description: 'Max code size per extension (KB)', range: '16-2048' },
  { key: 'extensionMaxInstalled', dotPath: 'extensions.max_installed', envVar: 'AIMEAT_EXT_MAX_INSTALLED', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100, immutable: false, description: 'Max installed extensions', range: '1-100' },
  { key: 'extInstallRole', dotPath: 'extensions.install_role', envVar: 'AIMEAT_EXT_INSTALL_ROLE', type: 'string', validate: v => ['operator', 'owner'].includes(v as string), immutable: false, description: 'Role required to install extensions: operator or owner' },
  { key: 'maxExtensionsPerOwner', dotPath: 'extensions.max_per_owner', envVar: 'AIMEAT_MAX_EXTENSIONS_PER_OWNER', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100, immutable: false, description: 'Max extensions per owner', range: '1-100' },


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

  // ── Encrypted Chat (mutable) ──
  { key: 'echatAnonymous', dotPath: 'echat.anonymous', envVar: 'AIMEAT_ECHAT_ANONYMOUS', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Allow anonymous encrypted chat WebSocket connections' },

  // ── Node (immutable, additional) ──
  { key: 'baseUrl', dotPath: 'node.base_url', envVar: 'AIMEAT_BASE_URL', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: true, description: 'Public base URL of this node' },
  { key: 'devMode', dotPath: 'node.dev_mode', envVar: 'AIMEAT_DEV_MODE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: true, description: 'Development mode (localhost webhooks, credential reset preserves data)', adminDisplay: 'visible' },
  { key: 'testMode', dotPath: 'node.test_mode', envVar: 'AIMEAT_TEST_MODE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: true, description: 'Test mode (re-registration wipes account for E2E test isolation)', adminDisplay: 'visible' },
  { key: 'anonymousMode', dotPath: 'node.anonymous_mode', envVar: 'AIMEAT_ANONYMOUS', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Allow anonymous access without authentication' },

  // ── Federation (mutable, additional) ──
  { key: 'depeeringGracePeriodHours', dotPath: 'federation.depeering_grace_hours', envVar: 'AIMEAT_DEPEERING_GRACE_HOURS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Grace period before depeering in hours', range: '1-720' },
  { key: 'keyCacheRefreshMinutes', dotPath: 'federation.key_cache_refresh_minutes', envVar: 'AIMEAT_KEY_CACHE_REFRESH_MINUTES', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Minutes between key cache refreshes', range: '1-60' },
  { key: 'federationRole', dotPath: 'federation.role', envVar: 'AIMEAT_FEDERATION_ROLE', type: 'string', validate: v => ['operator', 'contributor', 'standalone'].includes(v as string), immutable: false, description: 'Federation role: operator, contributor, or standalone' },
  { key: 'genesisUrl', dotPath: 'federation.genesis_url', envVar: 'AIMEAT_GENESIS_URL', type: 'string', validate: () => true, immutable: false, description: 'Genesis node URL for federation' },
  { key: 'federationAuthPolicy', dotPath: 'federation.auth_policy', envVar: 'AIMEAT_FEDERATION_AUTH_POLICY', type: 'string', validate: v => ['disabled', 'all_peers', 'specific_peers'].includes(v as string), immutable: false, description: 'Federation auth policy: disabled, all_peers, or specific_peers' },
  { key: 'federationDefaultScopes', dotPath: 'federation.default_scopes', envVar: 'AIMEAT_FEDERATION_DEFAULT_SCOPES', type: 'string', validate: () => true, immutable: false, description: 'Default scopes for federated users (comma-separated)' },
  { key: 'federationOpenJoin', dotPath: 'federation.open_join', envVar: 'AIMEAT_FEDERATION_OPEN_JOIN', type: 'boolean', validate: () => true, immutable: false, description: 'Open join: a signed introduce self-admits as a low-trust visiting peer (no manual approval)' },
  { key: 'federationBookListed', dotPath: 'federation.book_listed', envVar: 'AIMEAT_FEDERATION_BOOK_LISTED', type: 'boolean', validate: () => true, immutable: false, description: 'List this node (operators + resources) in the federation book; off = privacy opt-out' },

  // ── Security limits (mutable) ──
  { key: 'loginRateLimitMax', dotPath: 'security.login_rate_limit_max', envVar: 'AIMEAT_LOGIN_RATE_LIMIT_MAX', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1, immutable: false, description: 'Max login attempts per minute per IP', range: '1-1000' },
  { key: 'loginRateLimitWindowMs', dotPath: 'security.login_rate_limit_window_ms', envVar: 'AIMEAT_LOGIN_RATE_LIMIT_WINDOW_MS', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1000, immutable: false, description: 'Login rate limit window in ms', range: '1000-3600000' },
  { key: 'registrationRateLimitMax', dotPath: 'security.registration_rate_limit_max', envVar: 'AIMEAT_REGISTRATION_RATE_LIMIT_MAX', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1, immutable: false, description: 'Max registration attempts per minute per IP', range: '1-100' },
  { key: 'registrationRateLimitWindowMs', dotPath: 'security.registration_rate_limit_window_ms', envVar: 'AIMEAT_REGISTRATION_RATE_LIMIT_WINDOW_MS', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1000, immutable: false, description: 'Registration rate limit window in ms', range: '1000-3600000' },
  { key: 'adminAuthRateLimitMax', dotPath: 'security.admin_auth_rate_limit_max', envVar: 'AIMEAT_ADMIN_AUTH_RATE_LIMIT_MAX', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1, immutable: false, description: 'Max admin auth attempts per minute per IP', range: '1-100' },
  { key: 'adminAuthRateLimitWindowMs', dotPath: 'security.admin_auth_rate_limit_window_ms', envVar: 'AIMEAT_ADMIN_AUTH_RATE_LIMIT_WINDOW_MS', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1000, immutable: false, description: 'Admin auth rate limit window in ms', range: '1000-3600000' },
  { key: 'passwordLockoutAttempts', dotPath: 'security.password_lockout_attempts', envVar: 'AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1, immutable: false, description: 'Failed password attempts before lockout', range: '1-100' },
  { key: 'passwordLockoutMinutes', dotPath: 'security.password_lockout_minutes', envVar: 'AIMEAT_PASSWORD_LOCKOUT_MINUTES', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1, immutable: false, description: 'Password lockout duration in minutes', range: '1-1440' },
  { key: 'jsonBodyLimitMb', dotPath: 'security.json_body_limit_mb', envVar: 'AIMEAT_JSON_BODY_LIMIT_MB', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1, immutable: false, description: 'Default JSON body size limit in MB', range: '1-100' },
  { key: 'jsonBodyLimitLargeMb', dotPath: 'security.json_body_limit_large_mb', envVar: 'AIMEAT_JSON_BODY_LIMIT_LARGE_MB', type: 'number', validate: v => typeof v === 'number' && (v as number) >= 1, immutable: false, description: 'Large JSON body size limit in MB (apps, extensions)', range: '1-100' },

  // ── Quotas (mutable, additional) ──
  { key: 'memoryMaxValueSizeKb', dotPath: 'quota.memory_max_value_size_kb', envVar: 'AIMEAT_MEMORY_MAX_VALUE_SIZE_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max memory value size in KB', range: '1-10240' },
  { key: 'memoryMaxKeysPerAgent', dotPath: 'quota.memory_max_keys_per_agent', envVar: 'AIMEAT_MEMORY_MAX_KEYS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max memory keys per agent', range: '1-100000' },
  { key: 'storageMaxFileSizeMb', dotPath: 'quota.storage_max_file_size_mb', envVar: 'AIMEAT_STORAGE_MAX_FILE_SIZE_MB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max file size for storage in MB', range: '1-1024' },
  { key: 'storageMaxChunkedFileSizeGb', dotPath: 'quota.storage_max_chunked_file_size_gb', envVar: 'AIMEAT_STORAGE_MAX_CHUNKED_FILE_SIZE_GB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max chunked file size in GB', range: '1-100' },
  { key: 'microMemoryMaxSetsPerAgent', dotPath: 'quota.micro_memory_max_sets', envVar: 'AIMEAT_MICRO_MEMORY_MAX_SETS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max micro-memory sets per agent', range: '1-1000' },
  { key: 'microMemoryMaxKeysPerSet', dotPath: 'quota.micro_memory_max_keys_per_set', envVar: 'AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max keys per micro-memory set', range: '1-10000' },
  { key: 'microMemoryMaxValueSizeBytes', dotPath: 'quota.micro_memory_max_value_size_bytes', envVar: 'AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max micro-memory value size in bytes', range: '1-65536' },
  { key: 'maxActionsPerAgent', dotPath: 'quota.max_actions_per_agent', envVar: 'AIMEAT_MAX_ACTIONS_PER_AGENT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max actions per agent', range: '1-1000' },
  { key: 'minTrustForPaidActions', dotPath: 'quota.min_trust_paid_actions', envVar: 'AIMEAT_MIN_TRUST_PAID_ACTIONS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Min trust score for paid actions', range: '0-100' },
  { key: 'appMaxSizeMb', dotPath: 'quota.app_max_size_mb', envVar: 'AIMEAT_APP_MAX_SIZE_MB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max app package size in MB', range: '1-100' },
  { key: 'maxAppsPerAgent', dotPath: 'quota.max_apps_per_agent', envVar: 'AIMEAT_MAX_APPS_PER_AGENT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max apps per agent', range: '1-1000' },

  // ── Morsel Policy (mutable, additional) ──
  { key: 'agentPortingFeeMorsels', dotPath: 'morsel_policy.agent_porting_fee', envVar: 'AIMEAT_AGENT_PORTING_FEE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Morsel fee for agent porting', range: '0-10000' },
  { key: 'memoryOverageMorselsPerMbMonth', dotPath: 'morsel_policy.memory_overage_morsels', envVar: 'AIMEAT_MEMORY_OVERAGE_MORSELS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Morsel cost per MB/month overage', range: '0-1000' },
  { key: 'storageOverageMorselsPerGbMonth', dotPath: 'morsel_policy.storage_overage_morsels', envVar: 'AIMEAT_STORAGE_OVERAGE_MORSELS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Morsel cost per GB/month overage', range: '0-10000' },

  // ── Work (mutable, additional) ──
  { key: 'appAnnouncementBoardId', dotPath: 'work.app_announcement_board_id', envVar: 'AIMEAT_APP_ANNOUNCEMENT_BOARD_ID', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'Board ID for app announcements' },
  { key: 'otkTtlMs', dotPath: 'work.otk_ttl_ms', envVar: 'AIMEAT_OTK_TTL_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1000, immutable: false, description: 'One-time-key TTL in milliseconds', range: '1000-3600000' },
  { key: 'otkGraceMs', dotPath: 'work.otk_grace_ms', envVar: 'AIMEAT_OTK_GRACE_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'One-time-key grace period in milliseconds', range: '0-600000' },
  { key: 'maxUrlLength', dotPath: 'work.max_url_length', envVar: 'AIMEAT_MAX_URL_LENGTH', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 256, immutable: false, description: 'Max URL length allowed', range: '256-65536' },

  // ── Indexing (immutable) ──
  { key: 'indexNowKey', dotPath: 'indexing.indexnow_key', envVar: 'AIMEAT_INDEXNOW_KEY', type: 'string', validate: () => true, immutable: true, description: 'IndexNow API key for SEO', adminDisplay: 'configured' },

  // ── TOTP (immutable, additional) ──
  { key: 'totpIssuer', dotPath: 'totp.issuer', envVar: 'AIMEAT_TOTP_ISSUER', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: true, description: 'TOTP issuer name shown in authenticator apps' },
  { key: 'totpBackupCodeCount', dotPath: 'totp.backup_code_count', envVar: 'AIMEAT_TOTP_BACKUP_CODE_COUNT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 20, immutable: true, description: 'Number of TOTP backup codes to generate', range: '1-20' },

  // ── MSM (mutable) ──
  { key: 'msmInstallRole', dotPath: 'msm.install_role', envVar: 'AIMEAT_MSM_INSTALL_ROLE', type: 'string', validate: v => ['operator', 'owner'].includes(v as string), immutable: false, description: 'Role required to install MSM modules: operator or owner' },

  // ── Personal Nodes (mutable, additional) ──
  { key: 'personalNodeMailboxQuotaMb', dotPath: 'personal_nodes.mailbox_quota_mb', envVar: 'AIMEAT_PERSONAL_MAILBOX_QUOTA_MB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Personal node mailbox quota in MB', range: '1-1000' },
  { key: 'personalNodeMailboxRetentionDays', dotPath: 'personal_nodes.mailbox_retention_days', envVar: 'AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Personal node mailbox retention in days', range: '1-365' },
  { key: 'personalNodeHeartbeatIntervalMs', dotPath: 'personal_nodes.heartbeat_interval_ms', envVar: 'AIMEAT_PERSONAL_HEARTBEAT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1000, immutable: false, description: 'Personal node heartbeat interval in ms', range: '1000-300000' },
  { key: 'personalNodeOfflineThresholdMs', dotPath: 'personal_nodes.offline_threshold_ms', envVar: 'AIMEAT_PERSONAL_OFFLINE_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 10000, immutable: false, description: 'Personal node offline threshold in ms', range: '10000-3600000' },
  { key: 'personalNodeRequestTimeoutMs', dotPath: 'personal_nodes.request_timeout_ms', envVar: 'AIMEAT_PERSONAL_REQUEST_TIMEOUT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1000, immutable: false, description: 'Personal node request timeout in ms', range: '1000-300000' },

  // ── Connector Forward Tunnel (mutable) ──
  { key: 'connectTunnelEnabled', dotPath: 'connect_tunnel.enabled', envVar: 'AIMEAT_CONNECT_TUNNEL_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Connector forward tunnel (agent ⇄ server WS) enabled' },
  { key: 'connectTunnelHeartbeatIntervalMs', dotPath: 'connect_tunnel.heartbeat_interval_ms', envVar: 'AIMEAT_CONNECT_TUNNEL_HEARTBEAT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1000, immutable: false, description: 'Connector tunnel heartbeat interval in ms', range: '1000-300000' },
  { key: 'connectTunnelOfflineThresholdMs', dotPath: 'connect_tunnel.offline_threshold_ms', envVar: 'AIMEAT_CONNECT_TUNNEL_OFFLINE_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 10000, immutable: false, description: 'Connector tunnel offline threshold in ms', range: '10000-3600000' },
  { key: 'connectTunnelRequestTimeoutMs', dotPath: 'connect_tunnel.request_timeout_ms', envVar: 'AIMEAT_CONNECT_TUNNEL_REQUEST_TIMEOUT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1000, immutable: false, description: 'Connector tunnel forward-request timeout in ms', range: '1000-300000' },

  // ── Push Notifications (mutable, additional) ──
  { key: 'vapidSubject', dotPath: 'push.vapid_subject', envVar: 'AIMEAT_VAPID_SUBJECT', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: true, description: 'VAPID subject (mailto: or https: URI)' },
  { key: 'pushNotifyTypes', dotPath: 'push.notify_types', envVar: 'AIMEAT_PUSH_NOTIFY_TYPES', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'Comma-separated notification types to push' },
  { key: 'pushCooldownMin', dotPath: 'push.cooldown_min', envVar: 'AIMEAT_PUSH_COOLDOWN_MIN', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1440, immutable: false, description: 'Push notification cooldown in minutes', range: '1-1440' },
  { key: 'pushMaxSubscriptionsPerNode', dotPath: 'push.max_subscriptions_per_node', envVar: 'AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100, immutable: false, description: 'Max push subscriptions per node', range: '1-100' },
  { key: 'pushMaxFailures', dotPath: 'push.max_failures', envVar: 'AIMEAT_PUSH_MAX_FAILURES', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 50, immutable: false, description: 'Max push failures before disabling', range: '1-50' },

  // ── Email (mutable, additional) ──
  { key: 'emailRateLimitMin', dotPath: 'email.rate_limit_min', envVar: 'AIMEAT_EMAIL_RATE_LIMIT_MIN', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1440, immutable: false, description: 'Email rate limit cooldown in minutes', range: '1-1440' },

  // ── EUDIW / Identity (mutable, additional) ──
  { key: 'eudiwClientId', dotPath: 'eudiw.client_id', envVar: 'AIMEAT_EUDIW_CLIENT_ID', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'EUDIW verifier client ID' },
  { key: 'eudiwRedirectUri', dotPath: 'eudiw.redirect_uri', envVar: 'AIMEAT_EUDIW_REDIRECT_URI', type: 'string', validate: () => true, immutable: false, description: 'EUDIW redirect URI' },
  { key: 'ftnProviderUrl', dotPath: 'eudiw.ftn_provider_url', envVar: 'AIMEAT_FTN_PROVIDER_URL', type: 'string', validate: () => true, immutable: false, description: 'Finnish Trust Network provider URL' },
  { key: 'vcIssuerDid', dotPath: 'eudiw.vc_issuer_did', envVar: 'AIMEAT_VC_ISSUER_DID', type: 'string', validate: () => true, immutable: false, description: 'Verifiable credential issuer DID' },
  { key: 'ftnClientId', dotPath: 'eudiw.ftn_client_id', envVar: 'AIMEAT_FTN_CLIENT_ID', type: 'string', validate: () => true, immutable: false, description: 'FTN broker OIDC client ID' },
  { key: 'ftnClientSecret', dotPath: 'eudiw.ftn_client_secret', envVar: 'AIMEAT_FTN_CLIENT_SECRET', type: 'string', validate: () => true, immutable: true, description: 'FTN broker OIDC client secret (secret)', adminDisplay: 'hidden' },
  { key: 'nonceTtlSeconds', dotPath: 'eudiw.nonce_ttl_seconds', envVar: 'AIMEAT_NONCE_TTL_SECONDS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 60 && (v as number) <= 3600, immutable: false, description: 'Verification nonce TTL in seconds', range: '60-3600' },
  { key: 'nationalEidPidClaim', dotPath: 'eudiw.national_eid_pid_claim', envVar: 'AIMEAT_NATIONAL_EID_PID_CLAIM', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'National eID PID claim name (e.g., personal_identity_code)' },

  // ── Setup (immutable) ──
  { key: 'setupAllowedIps', dotPath: 'setup.allowed_ips', envVar: 'AIMEAT_SETUP_ALLOWED_IPS', type: 'string', validate: () => true, immutable: true, description: 'Comma-separated IPs allowed for setup', adminDisplay: 'configured' },

  // ── Moderation (mutable) ──
  { key: 'autoHideThreshold', dotPath: 'moderation.auto_hide_threshold', envVar: 'AIMEAT_AUTO_HIDE_THRESHOLD', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Flag count to auto-hide content', range: '1-100' },

  // ── Stats & Metrics (mutable) ──
  { key: 'statsEnabled', dotPath: 'stats.enabled', envVar: 'AIMEAT_STATS_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable stats API' },
  { key: 'statsAccess', dotPath: 'stats.access', envVar: 'AIMEAT_STATS_ACCESS', type: 'string', validate: v => ['public', 'authenticated', 'operator'].includes(v as string), immutable: false, description: 'Stats API visibility: public, authenticated, or operator' },
  { key: 'metricsEnabled', dotPath: 'metrics.enabled', envVar: 'AIMEAT_METRICS_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable Prometheus metrics endpoint' },
  { key: 'metricsAccess', dotPath: 'metrics.access', envVar: 'AIMEAT_METRICS_ACCESS', type: 'string', validate: v => ['public', 'authenticated', 'operator'].includes(v as string), immutable: false, description: 'Metrics endpoint visibility: public, authenticated, or operator' },

  // ── Scoped Agent Capabilities (mutable) ──
  { key: 'defaultAgentScopes', dotPath: 'scopes.default_agent_scopes', envVar: 'AIMEAT_DEFAULT_AGENT_SCOPES', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'Default agent capability scopes (comma-separated)' },
  { key: 'maxAgentScopes', dotPath: 'scopes.max_agent_scopes', envVar: 'AIMEAT_MAX_AGENT_SCOPES', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'Max available agent scopes (comma-separated, * = all)' },

  // ── Cortex Extensions (mutable) ──
  { key: 'cortexEnabled', dotPath: 'cortex.enabled', envVar: 'AIMEAT_CORTEX_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable manifest-based cortex extensions' },
  { key: 'cortexMaxInstalled', dotPath: 'cortex.max_installed', envVar: 'AIMEAT_CORTEX_MAX_INSTALLED', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1000, immutable: false, description: 'Max installed cortex modules', range: '1-1000' },
  { key: 'cortexMaxLibSizeKb', dotPath: 'cortex.max_lib_size_kb', envVar: 'AIMEAT_CORTEX_MAX_LIB_SIZE_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 16, immutable: false, description: 'Max cortex library size in KB', range: '16-4096' },

  // ── Portfolio (mutable) ──
  { key: 'portfolioEnabled', dotPath: 'portfolio.enabled', envVar: 'AIMEAT_PORTFOLIO', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable portfolio feature' },
  { key: 'portfolioMaxSizeKb', dotPath: 'portfolio.max_size_kb', envVar: 'AIMEAT_PORTFOLIO_MAX_SIZE_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max portfolio size in KB', range: '1-10240' },
  { key: 'portfolioMaxImages', dotPath: 'portfolio.max_images', envVar: 'AIMEAT_PORTFOLIO_MAX_IMAGES', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max images per portfolio', range: '1-100' },

  // ── Cookie Consent (mutable) ──
  { key: 'cookieConsentEnabled', dotPath: 'cookies.consent_enabled', envVar: 'AIMEAT_COOKIE_CONSENT_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable cookie consent banner' },
  { key: 'cookieConsentCategories', dotPath: 'cookies.consent_categories', envVar: 'AIMEAT_COOKIE_CONSENT_CATEGORIES', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'Cookie consent categories (comma-separated)' },
  { key: 'cookieConsentPolicyUrl', dotPath: 'cookies.consent_policy_url', envVar: 'AIMEAT_COOKIE_CONSENT_POLICY_URL', type: 'string', validate: () => true, immutable: false, description: 'Cookie consent privacy policy URL' },

  // ── CORS (mutable) ──
  { key: 'corsAllowedOrigins', dotPath: 'cors.allowed_origins', envVar: 'AIMEAT_CORS_ALLOWED_ORIGINS', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'CORS allowed origins (comma-separated, * = all)' },

  // ── Realtime P2P (mutable) ──
  { key: 'realtimeEnabled', dotPath: 'realtime.enabled', envVar: 'AIMEAT_REALTIME_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable realtime P2P signaling' },
  { key: 'realtimeMaxRooms', dotPath: 'realtime.max_rooms', envVar: 'AIMEAT_REALTIME_MAX_ROOMS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max P2P rooms', range: '1-10000' },
  { key: 'realtimeMaxPeersPerRoom', dotPath: 'realtime.max_peers_per_room', envVar: 'AIMEAT_REALTIME_MAX_PEERS_PER_ROOM', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max peers per P2P room', range: '1-100' },
  { key: 'realtimeRoomIdleTimeoutMs', dotPath: 'realtime.room_idle_timeout_ms', envVar: 'AIMEAT_REALTIME_ROOM_IDLE_TIMEOUT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1000, immutable: false, description: 'P2P room idle timeout in ms', range: '1000-86400000' },
  { key: 'realtimeMaxMessageSizeBytes', dotPath: 'realtime.max_message_size_bytes', envVar: 'AIMEAT_REALTIME_MAX_MESSAGE_SIZE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 256, immutable: false, description: 'Max P2P message size in bytes', range: '256-1048576' },
  { key: 'realtimeRateLimitPerSecond', dotPath: 'realtime.rate_limit_per_second', envVar: 'AIMEAT_REALTIME_RATE_LIMIT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'P2P messages per second rate limit', range: '1-1000' },
  { key: 'stunServers', dotPath: 'realtime.stun_servers', envVar: 'AIMEAT_STUN_SERVERS', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'STUN servers for P2P (comma-separated)' },
  { key: 'turnServer', dotPath: 'realtime.turn_server', envVar: 'AIMEAT_TURN_SERVER', type: 'string', validate: () => true, immutable: false, description: 'TURN server URL for P2P relay' },
  { key: 'turnUsername', dotPath: 'realtime.turn_username', envVar: 'AIMEAT_TURN_USERNAME', type: 'string', validate: () => true, immutable: false, description: 'TURN server username', adminDisplay: 'configured' },
  { key: 'turnCredential', dotPath: 'realtime.turn_credential', envVar: 'AIMEAT_TURN_CREDENTIAL', type: 'string', validate: () => true, immutable: false, description: 'TURN server credential', adminDisplay: 'configured' },

  // ── Site / Portal (mutable) ──
  { key: 'siteEnabled', dotPath: 'site.enabled', envVar: 'AIMEAT_SITE_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable site portal' },
  { key: 'siteMaxTemplateSizeKb', dotPath: 'site.max_template_size_kb', envVar: 'AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Max site template size in KB', range: '1-4096' },
  { key: 'siteCacheTtlSeconds', dotPath: 'site.cache_ttl_seconds', envVar: 'AIMEAT_SITE_CACHE_TTL_SECONDS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0, immutable: false, description: 'Site template cache TTL in seconds (0 = no cache)', range: '0-86400' },
  { key: 'siteLbEnabled', dotPath: 'site.lb_enabled', envVar: 'AIMEAT_SITE_LB_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable site load balancing' },
  { key: 'siteLbOriginUrl', dotPath: 'site.lb_origin_url', envVar: 'AIMEAT_SITE_LB_ORIGIN_URL', type: 'string', validate: () => true, immutable: false, description: 'Load balancer origin URL' },
  { key: 'siteLbSyncIntervalMin', dotPath: 'site.lb_sync_interval_min', envVar: 'AIMEAT_SITE_LB_SYNC_INTERVAL_MIN', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'LB template sync interval in minutes', range: '1-1440' },
  { key: 'siteLbSyncOnStartup', dotPath: 'site.lb_sync_on_startup', envVar: 'AIMEAT_SITE_LB_SYNC_ON_STARTUP', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Sync templates from origin on startup' },

  // ── Consul (immutable — set before startup) ──
  { key: 'consulEnabled', dotPath: 'consul.enabled', envVar: 'AIMEAT_CONSUL_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: true, description: 'Enable Consul integration' },
  { key: 'consulUrl', dotPath: 'consul.url', envVar: 'AIMEAT_CONSUL_URL', type: 'string', validate: () => true, immutable: true, description: 'Consul HTTP URL' },
  { key: 'consulPrefix', dotPath: 'consul.prefix', envVar: 'AIMEAT_CONSUL_PREFIX', type: 'string', validate: () => true, immutable: true, description: 'Consul KV prefix' },
  { key: 'consulToken', dotPath: 'consul.token', envVar: 'AIMEAT_CONSUL_TOKEN', type: 'string', validate: () => true, immutable: true, description: 'Consul ACL token', adminDisplay: 'configured' },
  { key: 'consulWatchIntervalSeconds', dotPath: 'consul.watch_interval_seconds', envVar: 'AIMEAT_CONSUL_WATCH_INTERVAL', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 3600, immutable: true, description: 'Consul watch poll interval in seconds', range: '5-3600' },
  { key: 'consulDatacenter', dotPath: 'consul.datacenter', envVar: 'AIMEAT_CONSUL_DATACENTER', type: 'string', validate: () => true, immutable: true, description: 'Consul datacenter name' },

  // ── Agent Directives (Phase 1, mutable) ──
  { key: 'agentSystemPrinciples', dotPath: 'agent.system_principles', envVar: 'AIMEAT_AGENT_SYSTEM_PRINCIPLES', type: 'object', validate: (v: unknown) => Array.isArray(v) && v.every(item => typeof item === 'string'), immutable: false, description: 'System-level principles injected into all agent directives' },
  { key: 'agentMaxTokensPerTask', dotPath: 'agent.max_tokens_per_task', envVar: 'AIMEAT_AGENT_MAX_TOKENS_PER_TASK', type: 'number', validate: (v: unknown) => typeof v === 'number' && (v as number) >= 1000 && (v as number) <= 10000000, immutable: false, description: 'Maximum token budget per agent task', range: '1000-10000000' },
  { key: 'agentMandatoryLogging', dotPath: 'agent.mandatory_logging', envVar: 'AIMEAT_AGENT_MANDATORY_LOGGING', type: 'boolean', validate: (v: unknown) => typeof v === 'boolean', immutable: false, description: 'Require agents to log all significant actions' },
  { key: 'agentAimeatFirstEnabled', dotPath: 'agent.aimeat_first', envVar: 'AIMEAT_AGENT_AIMEAT_FIRST', type: 'boolean', validate: (v: unknown) => typeof v === 'boolean', immutable: false, description: 'Enable AIMEAT-first principle in agent directives' },

  // ── Agent Tasks triage (Phase 1, mutable) ──
  { key: 'taskAutoArchive', dotPath: 'tasks.auto_archive', envVar: 'AIMEAT_TASK_AUTO_ARCHIVE', type: 'boolean', validate: (v: unknown) => typeof v === 'boolean', immutable: false, description: 'Auto-archive completed tasks older than the archive window (Tasks tab)' },
  { key: 'taskArchiveAfterHours', dotPath: 'tasks.archive_after_hours', envVar: 'AIMEAT_TASK_ARCHIVE_AFTER_HOURS', type: 'number', validate: (v: unknown) => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 8760, immutable: false, description: 'Hours a completed task stays in Recent before auto-archiving', range: '1-8760' },
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
      // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
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
