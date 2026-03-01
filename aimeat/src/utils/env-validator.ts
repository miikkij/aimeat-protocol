/**
 * CLI .env validator — checks environment configuration for errors, warnings, and info.
 * Usage: aimeat validate (or aimeat check)
 * Exit 0 = pass (warnings/info only), Exit 1 = errors found
 */

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

  // ── Port ──
  const portRaw = env.MEAT_PORT;
  if (portRaw !== undefined) {
    const port = parseInt(portRaw, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      results.push({ level: 'error', variable: 'MEAT_PORT', message: `Invalid port "${portRaw}". Must be 1-65535.` });
    } else if (port < 1024) {
      results.push({ level: 'warning', variable: 'MEAT_PORT', message: `Privileged port ${port} requires root/admin privileges.` });
    }
  } else {
    results.push({ level: 'info', variable: 'MEAT_PORT', message: 'Not set. Default: 40050' });
  }

  // ── Node ID ──
  const nodeId = env.MEAT_NODE_ID;
  if (nodeId) {
    if (nodeId === 'meat-local-001-dev') {
      results.push({ level: 'warning', variable: 'MEAT_NODE_ID', message: 'Using default node ID. Set a unique ID for production.' });
    }
  } else {
    results.push({ level: 'info', variable: 'MEAT_NODE_ID', message: 'Not set. Default: meat-local-001-dev' });
  }

  // ── Node Type ──
  const nodeType = env.MEAT_NODE_TYPE;
  if (nodeType !== undefined && !['full', 'relay', 'mirror'].includes(nodeType)) {
    results.push({ level: 'error', variable: 'MEAT_NODE_TYPE', message: `Invalid node type "${nodeType}". Must be "full", "relay", or "mirror".` });
  } else if (!nodeType) {
    results.push({ level: 'info', variable: 'MEAT_NODE_TYPE', message: 'Not set. Default: full' });
  }

  // ── Base URL ──
  const baseUrl = env.MEAT_BASE_URL;
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
        results.push({ level: 'warning', variable: 'MEAT_BASE_URL', message: 'HTTP on a public address. Use HTTPS in production.' });
      }
    } catch {
      results.push({ level: 'error', variable: 'MEAT_BASE_URL', message: `Invalid URL format: "${baseUrl}"` });
    }
  } else {
    results.push({ level: 'info', variable: 'MEAT_BASE_URL', message: 'Not set. Default: http://localhost:<port>' });
  }

  // ── Database URL ──
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    results.push({ level: 'warning', variable: 'DATABASE_URL', message: 'Not set. Using in-memory storage — data will not persist across restarts.' });
  } else {
    try {
      new URL(dbUrl);
    } catch {
      results.push({ level: 'error', variable: 'DATABASE_URL', message: `Invalid URL format: "${dbUrl.replace(/\/\/.*@/, '//<credentials>@')}"` });
    }
  }

  // ── Admin Password ──
  const adminPw = env.MEAT_ADMIN_PASSWORD;
  if (adminPw) {
    if (adminPw.length < 8) {
      results.push({ level: 'warning', variable: 'MEAT_ADMIN_PASSWORD', message: `Short password (${adminPw.length} chars). Minimum 8 recommended.` });
    }
    if (WEAK_PASSWORDS.includes(adminPw.toLowerCase())) {
      results.push({ level: 'warning', variable: 'MEAT_ADMIN_PASSWORD', message: 'Insecure password detected. Use a strong, unique password.' });
    }
  } else {
    results.push({ level: 'info', variable: 'MEAT_ADMIN_PASSWORD', message: 'Not set. A random password will be generated at startup.' });
  }

  // ── Numeric fields ──
  const numericFields: Array<{ key: string; name: string; defaultVal: string; min?: number; max?: number }> = [
    { key: 'MEAT_JWT_TTL', name: 'JWT TTL', defaultVal: '3600', min: 60 },
    { key: 'MEAT_WELCOME_BONUS', name: 'Welcome Bonus', defaultVal: '100', min: 0 },
    { key: 'MEAT_DAILY_ALLOWANCE', name: 'Daily Allowance', defaultVal: '50', min: 0 },
    { key: 'MEAT_DAILY_ALLOWANCE_CAP', name: 'Daily Allowance Cap', defaultVal: '500', min: 0 },
    { key: 'MEAT_MAX_RELAY_HOPS', name: 'Max Relay Hops', defaultVal: '3', min: 1, max: 10 },
    { key: 'MEAT_MEMORY_QUOTA_MB', name: 'Memory Quota MB', defaultVal: '10', min: 1 },
    { key: 'MEAT_STORAGE_QUOTA_MB', name: 'Storage Quota MB', defaultVal: '100', min: 1 },
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
  const burnRateRaw = env.MEAT_BURN_RATE;
  if (burnRateRaw !== undefined) {
    const br = parseFloat(burnRateRaw);
    if (isNaN(br)) {
      results.push({ level: 'error', variable: 'MEAT_BURN_RATE', message: `Non-numeric value "${burnRateRaw}".` });
    } else if (br < 0 || br > 1) {
      results.push({ level: 'error', variable: 'MEAT_BURN_RATE', message: `Burn rate ${br} is outside valid range 0-1.` });
    }
  } else {
    results.push({ level: 'info', variable: 'MEAT_BURN_RATE', message: 'Not set. Default: 0.10' });
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
