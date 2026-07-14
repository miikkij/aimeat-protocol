/**
 * @file src/utils/env-config/sections-features.ts
 * @description Indexing, personal-node, site, consent, push, email, TOTP, matching, marketplace, EUDIW, social-login config sections. Extracted from src/utils/env-config.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-07-14 — AIMEAT_MCP_CARD_COMMERCE_TOOLS in the Commerce section (TARGET-034 phase D)
 *   v1.0.0 — 2026-07-13 — Extracted from env-config.ts (max-file-lines)
 */

import type { AimeatConfig } from '../../config.js';
import type { ConfigSection } from './shared.js';
import { mask } from './shared.js';

export function featureSections(config: AimeatConfig): ConfigSection[] {
  return [
    {
      title: 'Search Indexing',
      entries: [
        {
          envVar: 'AIMEAT_INDEXNOW_KEY',
          description: 'IndexNow key for Bing/Yandex search indexing. Run "pnpm indexnow" after setting.',
          value: config.indexNowKey ?? '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_CONTENT_SIGNAL',
          description: 'robots.txt Content Signals Policy directive (contentsignals.org); "off" removes it',
          value: config.contentSignal,
          defaultVal: 'search=yes, ai-input=yes, ai-train=no',
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
      title: 'Commerce (TARGET-033)',
      entries: [
        {
          envVar: 'AIMEAT_COMMERCE_ENABLED',
          description: 'Checkout sessions (/v1/commerce) + UCP checkout capability',
          value: config.commerceEnabled ? 'true' : 'false',
          defaultVal: 'true',
        },
        {
          envVar: 'AIMEAT_MCP_CARD_COMMERCE_TOOLS',
          description: 'MCP Server Card commerce_tools: inline (embed priced app-tool catalog) or pointer (link /v1/commerce/tools)',
          value: config.mcpCardCommerceTools,
          defaultVal: 'inline',
        },
        {
          envVar: 'AIMEAT_MARKETPLACE_FEE_MODE',
          description: 'Fee destination: operator (credited) or burn (removed from supply)',
          value: config.marketplaceFeeMode,
          defaultVal: 'operator',
        },
        {
          envVar: 'AIMEAT_OPERATOR_FEE_ACCOUNT',
          description: 'Owner receiving operator-mode fees (empty = first operator-role owner)',
          value: config.operatorFeeAccount ?? '',
          defaultVal: '',
        },
        {
          envVar: 'AIMEAT_COMMERCE_FEE_PERCENT',
          description: 'Checkout fee % (empty inherits marketplace tx fee percent)',
          value: config.commerceFeePercent != null ? String(config.commerceFeePercent) : '',
          defaultVal: '',
        },
        {
          envVar: 'AIMEAT_COMMERCE_SESSION_TTL_MINUTES',
          description: 'Open checkout-session lifetime in minutes',
          value: String(config.commerceSessionTtlMinutes),
          defaultVal: '60',
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
      title: 'Social Login (Google)',
      entries: [
        {
          envVar: 'AIMEAT_GOOGLE_OAUTH_ENABLED',
          description: 'Enable Google sign-in (OIDC)',
          value: config.googleOAuthEnabled ? 'true' : 'false',
          defaultVal: 'false',
        },
        {
          envVar: 'AIMEAT_GOOGLE_OAUTH_CLIENT_ID',
          description: 'Google OAuth 2.0 client ID',
          value: config.googleOAuthClientId ? '(set)' : '(not set)',
          defaultVal: '(none)',
        },
        {
          envVar: 'AIMEAT_GOOGLE_OAUTH_REDIRECT_URI',
          description: 'Google OAuth redirect URI (default: <baseUrl>/v1/ghii/login/google/callback)',
          value: config.googleOAuthRedirectUri || '(derived from baseUrl)',
          defaultVal: '(derived)',
        },
      ],
    },
  ];
}
