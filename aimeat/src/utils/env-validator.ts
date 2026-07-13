/**
 * @file env-validator.ts
 * @description CLI config validator — checks environment, file configs, and DB for
 *   errors, warnings, and info. Usage: aimeat validate (or aimeat check).
 *   Exit 0 = pass (warnings/info only), Exit 1 = errors found.
 * @version-history v1.0.1 — 2026-06-20 — Validate App Origin Isolation (H-2):
 *   AIMEAT_APP_ORIGIN_ENABLED must be true/false; if true, AIMEAT_APP_HOST required.
 */

import { ALL_CONFIG_MAP, parseConfigValue } from '../services/config-schema.js';
import { loadFileSource } from '../services/config-loader.js';

interface ValidationResult {
  level: 'error' | 'warning' | 'info';
  variable: string;
  message: string;
}

const WEAK_PASSWORDS = [
  'password', 'admin', 'testadminpw123', '123456', 'letmein', 'qwerty',
  'abc123', 'TestAdminPw123!', 'secret', 'test', 'demo',
];

export function validateEnv(): ValidationResult[] {
  const results: ValidationResult[] = [];
  const env = process.env;

  // ── Dev Mode ──
  if (env.AIMEAT_DEV_MODE === 'true') {
    results.push({ level: 'warning', variable: 'AIMEAT_DEV_MODE', message: 'Dev mode is enabled. This relaxes security checks and should never be used in production.' });
  }

  // ── Port ──
  const portRaw = env.AIMEAT_PORT;
  if (portRaw !== undefined) {
    const port = parseInt(portRaw, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      results.push({ level: 'error', variable: 'AIMEAT_PORT', message: `Invalid port "${portRaw}". Must be 1-65535.` });
    } else if (port < 1024) {
      results.push({ level: 'warning', variable: 'AIMEAT_PORT', message: `Privileged port ${port} requires root/admin privileges.` });
    }
  } else {
    results.push({ level: 'info', variable: 'AIMEAT_PORT', message: 'Not set. Default: 40050' });
  }

  // ── Node ID ──
  const nodeId = env.AIMEAT_NODE_ID;
  if (nodeId) {
    if (nodeId === 'aimeat-local-001-dev') {
      results.push({ level: 'warning', variable: 'AIMEAT_NODE_ID', message: 'Using default node ID. Set a unique ID for production.' });
    }
  } else {
    results.push({ level: 'info', variable: 'AIMEAT_NODE_ID', message: 'Not set. Default: aimeat-local-001-dev' });
  }

  // ── Node Type ──
  const nodeType = env.AIMEAT_NODE_TYPE;
  if (nodeType !== undefined && !['full', 'relay', 'mirror'].includes(nodeType)) {
    results.push({ level: 'error', variable: 'AIMEAT_NODE_TYPE', message: `Invalid node type "${nodeType}". Must be "full", "relay", or "mirror".` });
  } else if (!nodeType) {
    results.push({ level: 'info', variable: 'AIMEAT_NODE_TYPE', message: 'Not set. Default: full' });
  }

  // ── Base URL ──
  const baseUrl = env.AIMEAT_BASE_URL;
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
        results.push({ level: 'warning', variable: 'AIMEAT_BASE_URL', message: 'HTTP on a public address. Use HTTPS in production.' });
      }
    } catch {
      results.push({ level: 'error', variable: 'AIMEAT_BASE_URL', message: `Invalid URL format: "${baseUrl}"` });
    }
  } else {
    results.push({ level: 'info', variable: 'AIMEAT_BASE_URL', message: 'Not set. Default: http://localhost:<port>' });
  }

  // ── Storage Provider ── ('postgres' is accepted as an alias for 'postgresql')
  const storageProvider = env.AIMEAT_STORAGE === 'postgres' ? 'postgresql' : env.AIMEAT_STORAGE;
  if (storageProvider && !['memory', 'sqlite', 'mongodb', 'postgresql'].includes(storageProvider)) {
    results.push({ level: 'error', variable: 'AIMEAT_STORAGE', message: `Invalid value "${env.AIMEAT_STORAGE}". Must be one of: memory, sqlite, mongodb, postgresql` });
  } else if (storageProvider === 'memory') {
    results.push({ level: 'warning', variable: 'AIMEAT_STORAGE', message: 'Using in-memory storage — all data will be lost on restart. Use sqlite or mongodb for production.' });
  } else if (!storageProvider) {
    results.push({ level: 'warning', variable: 'AIMEAT_STORAGE', message: 'Not set. Defaults to memory — all data will be lost on restart. Set AIMEAT_STORAGE=sqlite for persistence.' });
  }

  if (storageProvider === 'sqlite') {
    const sqlitePath = env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db';
    results.push({ level: 'info', variable: 'AIMEAT_SQLITE_PATH', message: `Database file: ${sqlitePath}` });
  }

  // ── Database URL ──
  const dbUrl = env.DATABASE_URL;
  if ((storageProvider === 'mongodb' || storageProvider === 'postgresql') && !dbUrl) {
    results.push({ level: 'error', variable: 'DATABASE_URL', message: `Required when AIMEAT_STORAGE=${storageProvider}` });
  } else if (!storageProvider && !dbUrl) {
    results.push({ level: 'warning', variable: 'DATABASE_URL', message: 'Not set. Using in-memory storage — data will not persist across restarts.' });
  } else if (dbUrl) {
    try {
      new URL(dbUrl);
    } catch {
      results.push({ level: 'error', variable: 'DATABASE_URL', message: `Invalid URL format: "${dbUrl.replace(/\/\/.*@/, '//<credentials>@')}"` });
    }
  }

  // ── Admin Password ──
  const adminPw = env.AIMEAT_ADMIN_PASSWORD;
  if (adminPw) {
    if (adminPw.length < 8) {
      results.push({ level: 'warning', variable: 'AIMEAT_ADMIN_PASSWORD', message: `Short password (${adminPw.length} chars). Minimum 8 recommended.` });
    }
    if (WEAK_PASSWORDS.includes(adminPw.toLowerCase())) {
      results.push({ level: 'warning', variable: 'AIMEAT_ADMIN_PASSWORD', message: 'Insecure password detected. Use a strong, unique password.' });
    }
  } else {
    results.push({ level: 'info', variable: 'AIMEAT_ADMIN_PASSWORD', message: 'Not set. A random password will be generated at startup.' });
  }

  // ── CORS ──
  const corsOrigins = env.AIMEAT_CORS_ALLOWED_ORIGINS;
  if (corsOrigins && corsOrigins !== '*') {
    const origins = corsOrigins.split(',').map(s => s.trim()).filter(Boolean);
    for (const origin of origins) {
      if (origin !== '*' && !origin.startsWith('https://') && !origin.startsWith('http://')) {
        results.push({ level: 'warning', variable: 'AIMEAT_CORS_ALLOWED_ORIGINS', message: `Origin "${origin}" doesn't look like a URL. Expected format: https://example.com` });
      }
    }
    if (origins.length === 0) {
      results.push({ level: 'warning', variable: 'AIMEAT_CORS_ALLOWED_ORIGINS', message: 'Empty value. This will block all cross-origin browser requests. Use * to allow all.' });
    }
  }

  // ── Numeric fields ──
  const numericFields: Array<{ key: string; name: string; defaultVal: string; min?: number; max?: number }> = [
    { key: 'AIMEAT_JWT_TTL', name: 'JWT TTL', defaultVal: '3600', min: 60 },
    { key: 'AIMEAT_ACCESS_TTL', name: 'Owner access token TTL', defaultVal: '900', min: 60 },
    { key: 'AIMEAT_REFRESH_IDLE_DAYS', name: 'Refresh idle window (days)', defaultVal: '30', min: 1 },
    { key: 'AIMEAT_REFRESH_ABSOLUTE_DAYS', name: 'Refresh absolute cap (days)', defaultVal: '90', min: 1 },
    { key: 'AIMEAT_REFRESH_GRACE_MS', name: 'Refresh rotation grace (ms)', defaultVal: '60000', min: 0 },
    { key: 'AIMEAT_WELCOME_BONUS', name: 'Welcome Bonus', defaultVal: '100', min: 0 },
    { key: 'AIMEAT_DAILY_ALLOWANCE', name: 'Daily Allowance', defaultVal: '50', min: 0 },
    { key: 'AIMEAT_DAILY_ALLOWANCE_CAP', name: 'Daily Allowance Cap', defaultVal: '500', min: 0 },
    { key: 'AIMEAT_MAX_RELAY_HOPS', name: 'Max Relay Hops', defaultVal: '3', min: 1, max: 10 },
    { key: 'AIMEAT_MEMORY_QUOTA_MB', name: 'Memory Quota MB', defaultVal: '10', min: 1 },
    { key: 'AIMEAT_STORAGE_QUOTA_MB', name: 'Storage Quota MB', defaultVal: '100', min: 1 },
    { key: 'AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB', name: 'Site Max Template Size KB', defaultVal: '512', min: 1 },
    { key: 'AIMEAT_SITE_CACHE_TTL_SECONDS', name: 'Site Cache TTL Seconds', defaultVal: '60', min: 0 },
    { key: 'AIMEAT_PUSH_COOLDOWN_MIN', name: 'Push Cooldown', defaultVal: '5', min: 1, max: 1440 },
    { key: 'AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE', name: 'Push Max Subscriptions', defaultVal: '5', min: 1, max: 100 },
    { key: 'AIMEAT_PUSH_MAX_FAILURES', name: 'Push Max Failures', defaultVal: '3', min: 1, max: 50 },
    { key: 'AIMEAT_EMAIL_RATE_LIMIT_MIN', name: 'Email Rate Limit', defaultVal: '30', min: 1, max: 1440 },
    { key: 'AIMEAT_MAX_EXTENSIONS_PER_OWNER', name: 'Max Extensions Per Owner', defaultVal: '10', min: 1, max: 100 },
  ];

  for (const field of numericFields) {
    const raw = env[field.key];
    if (raw !== undefined) {
      const val = parseInt(raw, 10);
      if (isNaN(val)) {
        results.push({ level: 'error', variable: field.key, message: `Non-numeric value "${raw}" for ${field.name}.` });
      } else {
        if (field.min !== undefined && val < field.min) {
          results.push({ level: 'error', variable: field.key, message: `${field.name} value ${val} is below minimum ${field.min}.` });
        }
        if (field.max !== undefined && val > field.max) {
          results.push({ level: 'error', variable: field.key, message: `${field.name} value ${val} exceeds maximum ${field.max}.` });
        }
      }
    } else {
      results.push({ level: 'info', variable: field.key, message: `Not set. Default: ${field.defaultVal}` });
    }
  }

  // ── Burn Rate ──
  const burnRateRaw = env.AIMEAT_BURN_RATE;
  if (burnRateRaw !== undefined) {
    const br = parseFloat(burnRateRaw);
    if (isNaN(br)) {
      results.push({ level: 'error', variable: 'AIMEAT_BURN_RATE', message: `Non-numeric value "${burnRateRaw}".` });
    } else if (br < 0 || br > 1) {
      results.push({ level: 'error', variable: 'AIMEAT_BURN_RATE', message: `Burn rate ${br} is outside valid range 0-1.` });
    }
  } else {
    results.push({ level: 'info', variable: 'AIMEAT_BURN_RATE', message: 'Not set. Default: 0.10' });
  }

  // ── Marketplace fee policy (TARGET-033) ──
  const feeMode = env.AIMEAT_MARKETPLACE_FEE_MODE;
  if (feeMode !== undefined && feeMode !== 'operator' && feeMode !== 'burn') {
    results.push({ level: 'error', variable: 'AIMEAT_MARKETPLACE_FEE_MODE', message: `Invalid value "${feeMode}". Use "operator" or "burn".` });
  }
  const commerceFee = env.AIMEAT_COMMERCE_FEE_PERCENT;
  if (commerceFee !== undefined && commerceFee !== '') {
    const cf = parseInt(commerceFee, 10);
    if (isNaN(cf)) {
      results.push({ level: 'error', variable: 'AIMEAT_COMMERCE_FEE_PERCENT', message: `Non-numeric value "${commerceFee}".` });
    } else if (cf < 0 || cf > 50) {
      results.push({ level: 'error', variable: 'AIMEAT_COMMERCE_FEE_PERCENT', message: `Fee percent ${cf} is outside valid range 0-50.` });
    }
  }
  const commerceTtl = env.AIMEAT_COMMERCE_SESSION_TTL_MINUTES;
  if (commerceTtl !== undefined) {
    const ttl = parseInt(commerceTtl, 10);
    if (isNaN(ttl) || ttl < 5 || ttl > 10080) {
      results.push({ level: 'error', variable: 'AIMEAT_COMMERCE_SESSION_TTL_MINUTES', message: `Invalid value "${commerceTtl}". Use minutes in range 5-10080.` });
    }
  }

  // ── Cookie Consent ──
  const ccEnabled = env.AIMEAT_COOKIE_CONSENT_ENABLED;
  if (ccEnabled === 'true') {
    const ccCategories = env.AIMEAT_COOKIE_CONSENT_CATEGORIES;
    if (ccCategories) {
      const cats = ccCategories.split(',').map(s => s.trim());
      if (!cats.includes('necessary')) {
        results.push({ level: 'warning', variable: 'AIMEAT_COOKIE_CONSENT_CATEGORIES', message: '"necessary" category is recommended. It will be added automatically.' });
      }
    }
    if (!env.AIMEAT_COOKIE_CONSENT_POLICY_URL) {
      results.push({ level: 'warning', variable: 'AIMEAT_COOKIE_CONSENT_POLICY_URL', message: 'Cookie consent enabled but no privacy policy URL set. Recommended for GDPR compliance.' });
    }
  }

  // ── Push Notifications ──────────────────────────────────────
  const pushEnabled = env.AIMEAT_PUSH_ENABLED;
  if (pushEnabled === 'true') {
    const vapidPub = env.AIMEAT_VAPID_PUBLIC_KEY;
    if (!vapidPub) {
      results.push({ level: 'error', variable: 'AIMEAT_VAPID_PUBLIC_KEY', message: 'Required when AIMEAT_PUSH_ENABLED=true. Generate with: npx web-push generate-vapid-keys' });
    } else if (vapidPub.length < 80 || vapidPub.length > 100) {
      results.push({ level: 'warning', variable: 'AIMEAT_VAPID_PUBLIC_KEY', message: `Key length ${vapidPub.length} looks unusual (expected ~87 chars). Verify with: npx web-push generate-vapid-keys` });
    }

    const vapidPriv = env.AIMEAT_VAPID_PRIVATE_KEY;
    if (!vapidPriv) {
      results.push({ level: 'error', variable: 'AIMEAT_VAPID_PRIVATE_KEY', message: 'Required when AIMEAT_PUSH_ENABLED=true. Generate with: npx web-push generate-vapid-keys' });
    } else if (vapidPriv.length < 35 || vapidPriv.length > 55) {
      results.push({ level: 'warning', variable: 'AIMEAT_VAPID_PRIVATE_KEY', message: `Key length ${vapidPriv.length} looks unusual (expected ~43 chars). Verify with: npx web-push generate-vapid-keys` });
    }

    const vapidSubject = env.AIMEAT_VAPID_SUBJECT;
    if (!vapidSubject) {
      results.push({ level: 'warning', variable: 'AIMEAT_VAPID_SUBJECT', message: 'Not set. Should be a mailto: or https:// URI for push service contact.' });
    } else if (!vapidSubject.startsWith('mailto:') && !vapidSubject.startsWith('https://')) {
      results.push({ level: 'warning', variable: 'AIMEAT_VAPID_SUBJECT', message: `Value "${vapidSubject}" must start with mailto: or https://` });
    }
  } else if (pushEnabled === 'false' || !pushEnabled) {
    if (env.AIMEAT_VAPID_PUBLIC_KEY || env.AIMEAT_VAPID_PRIVATE_KEY) {
      results.push({ level: 'info', variable: 'AIMEAT_PUSH_ENABLED', message: 'VAPID keys are configured but push is disabled. Set AIMEAT_PUSH_ENABLED=true to enable.' });
    }
  }

  // ── Email / SMTP ────────────────────────────────────────────
  const smtpHost = env.AIMEAT_SMTP_HOST;
  if (smtpHost) {
    if (!env.AIMEAT_SMTP_USER) {
      results.push({ level: 'warning', variable: 'AIMEAT_SMTP_USER', message: 'SMTP host is set but no username configured. Most SMTP servers require authentication.' });
    }
    if (!env.AIMEAT_SMTP_PASS) {
      results.push({ level: 'warning', variable: 'AIMEAT_SMTP_PASS', message: 'SMTP host is set but no password configured. Most SMTP servers require authentication.' });
    }

    const smtpPort = env.AIMEAT_SMTP_PORT;
    if (smtpPort) {
      const port = parseInt(smtpPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        results.push({ level: 'error', variable: 'AIMEAT_SMTP_PORT', message: `Invalid port "${smtpPort}". Must be 1-65535.` });
      } else {
        const secure = env.AIMEAT_SMTP_SECURE === 'true';
        if (secure && port !== 465) {
          results.push({ level: 'warning', variable: 'AIMEAT_SMTP_SECURE', message: `TLS enabled but port is ${port}. Port 465 is standard for direct TLS. Port ${port} typically uses STARTTLS (secure=false).` });
        }
        if (!secure && port === 465) {
          results.push({ level: 'warning', variable: 'AIMEAT_SMTP_SECURE', message: 'Port 465 requires TLS. Set AIMEAT_SMTP_SECURE=true or change port to 587.' });
        }
      }
    }
  }

  // ── TOTP / 2FA ──────────────────────────────────────────────────
  const totpEnabled = env.AIMEAT_TOTP_ENABLED;
  if (totpEnabled !== 'false') {
    // TOTP is enabled by default — encryption key should be set
    const totpKey = env.AIMEAT_TOTP_ENCRYPTION_KEY;
    if (!totpKey) {
      results.push({ level: 'error', variable: 'AIMEAT_TOTP_ENCRYPTION_KEY', message: 'Required when TOTP is enabled. TOTP secrets are stored unencrypted without this key. Set a 32-byte hex key or disable TOTP with AIMEAT_TOTP_ENABLED=false.' });
    } else if (totpKey.length < 64) {
      results.push({ level: 'warning', variable: 'AIMEAT_TOTP_ENCRYPTION_KEY', message: `Key length ${totpKey.length} hex chars is short. Expected 64 hex chars (32 bytes) for AES-256-GCM.` });
    }
  }

  // ── Metrics & Observability ─────────────────────────────────────
  const metricsAccess = env.AIMEAT_METRICS_ACCESS;
  if (metricsAccess && !['public', 'authenticated', 'operator'].includes(metricsAccess)) {
    results.push({ level: 'error', variable: 'AIMEAT_METRICS_ACCESS', message: `Invalid value "${metricsAccess}". Must be: public, authenticated, or operator.` });
  }

  const statsAccess = env.AIMEAT_STATS_ACCESS;
  if (statsAccess && !['public', 'authenticated', 'operator'].includes(statsAccess)) {
    results.push({ level: 'error', variable: 'AIMEAT_STATS_ACCESS', message: `Invalid value "${statsAccess}". Must be: public, authenticated, or operator.` });
  }

  // ── Extension Install Role ──
  const extRole = env.AIMEAT_EXT_INSTALL_ROLE;
  if (extRole !== undefined && !['operator', 'owner'].includes(extRole)) {
    results.push({ level: 'error', variable: 'AIMEAT_EXT_INSTALL_ROLE', message: `Invalid value "${extRole}". Must be "operator" or "owner"` });
  }

  // ── App Origin Isolation (H-2) ──
  const appOriginEnabled = env.AIMEAT_APP_ORIGIN_ENABLED;
  if (appOriginEnabled !== undefined && appOriginEnabled !== 'true' && appOriginEnabled !== 'false') {
    results.push({ level: 'error', variable: 'AIMEAT_APP_ORIGIN_ENABLED', message: `Invalid value "${appOriginEnabled}". Must be "true" or "false".` });
  }
  if (appOriginEnabled === 'true' && !env.AIMEAT_APP_HOST?.trim()) {
    results.push({ level: 'error', variable: 'AIMEAT_APP_HOST', message: 'App origin isolation is enabled (AIMEAT_APP_ORIGIN_ENABLED=true) but AIMEAT_APP_HOST is empty. Set the app origin host (e.g. apps.example.com); it requires DNS + a wildcard TLS cert.' });
  }

  // ── Portfolio Origin ──
  const portfolioOriginEnabled = env.AIMEAT_PORTFOLIO_ORIGIN_ENABLED;
  if (portfolioOriginEnabled !== undefined && portfolioOriginEnabled !== 'true' && portfolioOriginEnabled !== 'false') {
    results.push({ level: 'error', variable: 'AIMEAT_PORTFOLIO_ORIGIN_ENABLED', message: `Invalid value "${portfolioOriginEnabled}". Must be "true" or "false".` });
  }
  if (portfolioOriginEnabled === 'true' && !env.AIMEAT_PORTFOLIO_HOST?.trim()) {
    results.push({ level: 'error', variable: 'AIMEAT_PORTFOLIO_HOST', message: 'The portfolio origin is enabled (AIMEAT_PORTFOLIO_ORIGIN_ENABLED=true) but AIMEAT_PORTFOLIO_HOST is empty. Set the portfolio origin host (e.g. portfolio.example.com); it requires DNS + a wildcard TLS cert.' });
  }

  // ── Config File Validation (aimeat.ini / aimeat.json) ─────────
  const fileSource = loadFileSource();
  if (fileSource) {
    results.push({ level: 'info', variable: 'CONFIG_FILE', message: `Config file found: ${fileSource.name}` });

    for (const [dotPath, rawValue] of Object.entries(fileSource.values)) {
      const field = ALL_CONFIG_MAP[dotPath];
      if (!field) {
        results.push({ level: 'warning', variable: `file:${dotPath}`, message: `Unknown config key "${dotPath}" in ${fileSource.name}. Will be ignored.` });
        continue;
      }

      // Validate type
      try {
        const parsed = parseConfigValue(field, rawValue);
        if (!field.validate(parsed)) {
          results.push({ level: 'error', variable: `file:${dotPath}`, message: `Invalid value "${rawValue}" for ${dotPath} in ${fileSource.name}. Validation failed.` });
        }
      } catch {
        results.push({ level: 'error', variable: `file:${dotPath}`, message: `Cannot parse "${rawValue}" as ${field.type} for ${dotPath} in ${fileSource.name}.` });
      }
    }
  }

  return results;
}

export function formatValidationResults(results: ValidationResult[]): string {
  const errors = results.filter(r => r.level === 'error');
  const warnings = results.filter(r => r.level === 'warning');
  const infos = results.filter(r => r.level === 'info');

  const lines: string[] = [];
  lines.push('');
  lines.push('  AIMEAT Environment Validation');
  lines.push('  ═══════════════════════════════════════');
  lines.push('');

  if (errors.length > 0) {
    lines.push(`  ERRORS (${errors.length})`);
    for (const r of errors) {
      lines.push(`    x ${r.variable}: ${r.message}`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(`  WARNINGS (${warnings.length})`);
    for (const r of warnings) {
      lines.push(`    ! ${r.variable}: ${r.message}`);
    }
    lines.push('');
  }

  if (infos.length > 0) {
    lines.push(`  INFO (${infos.length})`);
    for (const r of infos) {
      lines.push(`    - ${r.variable}: ${r.message}`);
    }
    lines.push('');
  }

  lines.push('  ───────────────────────────────────────');
  if (errors.length > 0) {
    lines.push(`  Result: FAIL (${errors.length} error${errors.length > 1 ? 's' : ''}, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''})`);
  } else if (warnings.length > 0) {
    lines.push(`  Result: PASS with ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`);
  } else {
    lines.push('  Result: PASS');
  }
  lines.push('');

  return lines.join('\n');
}
