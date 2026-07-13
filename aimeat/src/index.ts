#!/usr/bin/env node
/**
 * @file index.ts
 * @description Main AIMEAT CLI entry point, including node management commands and agent connector dispatch.
 * @structure Parses top-level CLI flags, routes subcommands, starts the server, and delegates connector commands.
 * @usage Executed through the published `aimeat` binary.
 * @version-history v1.9.4 — 2026-05-28 — Allow agent connector flags and drain async auth handles before exit.
 * @version-history v1.9.5 — 2026-05-28 — Drain async handles before exiting one-shot connector commands on Windows.
 * @version-history v1.9.6 — 2026-05-28 — Print extracted skill bundle guidance after refresh.
 * @version-history v1.9.7 — 2026-05-28 — Add connector-specific help and prevent `aimeat connect help` from starting auth.
 * @version-history v1.9.8 — 2026-05-28 — Add connector CLI tools/schema/call fallback commands.
 * @version-history v1.9.9 — 2026-05-28 — Allow connector fallback flags through top-level parsing.
 * @version-history v1.9.10 — 2026-05-28 — Narrow permissive parseArgs values before applying node CLI string flags.
 * @version-history v1.25.1 — 2026-06-18 — Self-heal scaffolded assets on start after a package upgrade; read update version from package.json.
 * @version-history v1.26.0 — 2026-07-10 — Emit securityPostureWarnings() at startup so a public-profile node flags risky settings.
 * @version-history v1.27.0 — 2026-07-13 — Extract help text, `connect` dispatch, and `start`/`serve` runtime into index-help/index-connect/index-start (max-file-lines).
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';
import { HELP_TEXT, CONNECT_HELP_TEXT } from './index-help.js';
import { runConnectCli } from './index-connect.js';
import { runStart } from './index-start.js';

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

const { values, positionals } = parseArgs({
  allowPositionals: true,
  // Connector subcommands parse their own flags so tool input flags can evolve without touching the node CLI parser.
  strict: false,
  options: {
    port: { type: 'string', short: 'p' },
    db: { type: 'string' },
    'db-url': { type: 'string' },
    'db-path': { type: 'string' },
    'node-id': { type: 'string' },
    'admin-password': { type: 'string' },
    config: { type: 'string', short: 'c' },
    consul: { type: 'string' },
    'consul-prefix': { type: 'string' },
    'consul-token': { type: 'string' },
    format: { type: 'string' },
    file: { type: 'string' },
    from: { type: 'string' },
    url: { type: 'string' },
    owner: { type: 'string' },
    agent: { type: 'string' },
    to: { type: 'string' },
    body: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}


if (values.help) {
  console.log(positionals[0] === 'connect' ? CONNECT_HELP_TEXT : HELP_TEXT);
  process.exit(0);
}

// Package root: from dist/src/index.js -> go up 2 levels to aimeat/
const __pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

if (values.version) {
  try {
    const pkg = JSON.parse(readFileSync(join(__pkgRoot, 'package.json'), 'utf-8'));
    console.log(`aimeat v${pkg.version}`);
  } catch {
    console.log('aimeat (version unknown)');
  }
  process.exit(0);
}

// Load .env into process.env if not already loaded by bin/aimeat.ts.
// Search: CWD first, then package root (aimeat/ directory).
const envPath = existsSync('.env') ? '.env'
  : existsSync(join(__pkgRoot, '.env')) ? join(__pkgRoot, '.env')
    : null;

if (envPath) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
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
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// Build CLI overrides from flags (dot-path keyed for unified config)
const cliOverrides: Record<string, string> = {};
const portFlag = stringFlag(values.port);
const dbFlag = stringFlag(values.db);
const dbUrlFlag = stringFlag(values['db-url']);
const dbPathFlag = stringFlag(values['db-path']);
const nodeIdFlag = stringFlag(values['node-id']);
const adminPasswordFlag = stringFlag(values['admin-password']);
const consulFlag = stringFlag(values.consul);
const consulPrefixFlag = stringFlag(values['consul-prefix']);
const consulTokenFlag = stringFlag(values['consul-token']);

if (portFlag) cliOverrides['node.port'] = portFlag;
if (dbFlag) cliOverrides['storage.type'] = dbFlag;
if (dbUrlFlag) cliOverrides['database_url'] = dbUrlFlag;
if (dbPathFlag) cliOverrides['sqlite_path'] = dbPathFlag;
if (nodeIdFlag) cliOverrides['node.id'] = nodeIdFlag;
if (adminPasswordFlag) cliOverrides['admin_password'] = adminPasswordFlag;
if (consulFlag) {
  cliOverrides['consul.enabled'] = 'true';
  cliOverrides['consul.url'] = consulFlag;
}
if (consulPrefixFlag) cliOverrides['consul.prefix'] = consulPrefixFlag;
if (consulTokenFlag) cliOverrides['consul.token'] = consulTokenFlag;

const { config, envKeys, fileKeys, cliKeys, fileName } = loadConfig({
  configPath: stringFlag(values.config),
  cliOverrides: Object.keys(cliOverrides).length > 0 ? cliOverrides : undefined,
});
const subcommand = positionals[0];

// Handle subcommands
if (subcommand === 'config') {
  const configAction = positionals[1]; // export | import | undefined (show)

  if (configAction === 'export') {
    const format = (values.format as string) || 'env';
    if (!['env', 'ini', 'json', 'consul'].includes(format)) {
      console.error(`Unknown export format: ${format}. Use: env, ini, json, consul`);
      process.exit(1);
    }
    const { runConfigExport } = await import('./cli/config-export.js');
    await runConfigExport(config, format as 'env' | 'ini' | 'json' | 'consul');
    process.exit(0);
  }

  if (configAction === 'import') {
    const { runConfigImport } = await import('./cli/config-import.js');
    await runConfigImport(config, {
      file: values.file as string | undefined,
      from: values.from as string | undefined,
    });
    process.exit(0);
  }

  // Default: show config
  const { formatConfig } = await import('./utils/env-config.js');
  const { ConfigProvenance } = await import('./services/config-provenance.js');
  const { ALL_CONFIG_MAP } = await import('./services/config-schema.js');
  const prov = new ConfigProvenance();
  prov.initDefaults(Object.keys(ALL_CONFIG_MAP));
  if (envKeys.length > 0) prov.markEnv(envKeys);
  if (fileKeys.length > 0) prov.markFile(fileKeys);
  if (cliKeys.length > 0) prov.markEnv(cliKeys); // CLI overrides show as 'env' in display
  console.log(formatConfig(config, prov));
  process.exit(0);
} else if (subcommand === 'init') {
  const { runInitWizard } = await import('./cli/init-wizard.js');
  await runInitWizard(config);
  process.exit(0);
} else if (subcommand === 'update') {
  const { scaffoldFiles: doScaffold, findPackageRoot } = await import('./cli/scaffold.js');
  const pkgRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  if (!pkgRoot) {
    console.error('Could not locate package assets. Is aimeat installed correctly?');
    process.exit(1);
  }
  // The version lives in the package's package.json (next to dist/), not inside the
  // assets root that findPackageRoot returns (which is dist/ for an npm install).
  let pkgVersion = '0.0.0';
  for (const p of [join(__pkgRoot, 'package.json'), join(pkgRoot, 'package.json')]) {
    if (existsSync(p)) { pkgVersion = JSON.parse(readFileSync(p, 'utf-8')).version as string; break; }
  }
  const result = doScaffold(pkgRoot, process.cwd(), pkgVersion);
  console.log(`Assets updated: ${result.copied} new, ${result.updated} updated, ${result.skippedModified} skipped (user-modified)`);
  for (const file of result.modifiedFiles) {
    console.log(`  Skipped (modified): ${file}`);
  }
  if (result.skippedUnchanged > 0) {
    console.log(`  ${result.skippedUnchanged} files unchanged`);
  }
  process.exit(0);
} else if (subcommand === 'validate' || subcommand === 'check') {
  const { validateEnv, formatValidationResults } = await import('./utils/env-validator.js');
  const results = validateEnv();
  console.log(formatValidationResults(results));
  const hasErrors = results.some(r => r.level === 'error');
  process.exit(hasErrors ? 1 : 0);
} else if (subcommand === 'screenshot-worker') {
  // Operator tool: backfill missing app screenshots by rendering each app headless via the
  // machine's own Edge/Chrome (no browser download). One-shot, or --watch N to run as a daemon.
  const { runScreenshotWorker } = await import('./cli/screenshot-worker.js');
  await runScreenshotWorker();
  process.exit(0);
} else if (subcommand === 'join') {
  const { runFederationJoin } = await import('./cli/federation-join.js');
  await runFederationJoin(config, positionals[1] ?? config.genesisUrl ?? undefined);
  process.exit(0);
} else if (subcommand === 'maintenance') {
  const action = positionals[1]; // on | off | undefined (show status)
  const { createStorage } = await import('./storage/storage-factory.js');
  const storage = await createStorage({
    provider: config.storageProvider,
    sqlitePath: config.sqlitePath,
    dbUrl: config.dbUrl ?? undefined,
  });

  if (action === 'on') {
    const message = positionals.slice(2).join(' ') || 'Maintenance';
    await storage.setMaintenanceMode({
      enabled: true,
      message,
      enabledAt: new Date().toISOString(),
      enabledBy: 'cli',
    });
    console.log(`Maintenance mode ON: "${message}"`);
  } else if (action === 'off') {
    await storage.setMaintenanceMode({
      enabled: false,
      message: '',
      enabledAt: null,
      enabledBy: null,
    });
    console.log('Maintenance mode OFF');
  } else {
    const state = await storage.getMaintenanceMode();
    if (state?.enabled) {
      console.log('Maintenance mode: ON');
      console.log(`  Message:    ${state.message || '(none)'}`);
      console.log(`  Enabled at: ${state.enabledAt ?? 'unknown'}`);
      console.log(`  Enabled by: ${state.enabledBy ?? 'unknown'}`);
    } else {
      console.log('Maintenance mode: OFF');
    }
  }
  process.exit(0);
} else if (subcommand === 'backup') {
  const outArg = positionals[1] ?? 'aimeat-backup.json';
  const { app } = await createServer(config);
  // Start server temporarily to access storage
  const server = app.listen(0, async () => {
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const resp = await fetch(`http://localhost:${port}/v1/admin/backup`, {
        headers: config.adminPassword
          ? { Authorization: `Bearer operator:${config.adminPassword}` }
          : {},
      });
      const data = await resp.json();
      writeFileSync(outArg, JSON.stringify(data, null, 2));
      logger.info(`Backup written to ${outArg}`);
    } catch (err) {
      logger.error('Backup failed', { error: err });
    } finally {
      server.close();
    }
  });
} else if (subcommand === 'restore') {
  const fromArg = positionals[1];
  if (!fromArg) {
    console.error('Usage: aimeat restore <file.json>');
    process.exit(1);
  }
  const { app } = await createServer(config);
  const server = app.listen(0, async () => {
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const body = readFileSync(fromArg, 'utf-8');
      const parsed = JSON.parse(body);
      const payload = parsed.data ?? parsed; // handle envelope or raw
      const resp = await fetch(`http://localhost:${port}/v1/admin/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.adminPassword
            ? { Authorization: `Bearer operator:${config.adminPassword}` }
            : {}),
        },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      logger.info('Restore complete', result);
    } catch (err) {
      logger.error('Restore failed', { error: err });
    } finally {
      server.close();
    }
  });
} else if (subcommand === 'connect') {
  await runConnectCli(positionals);
} else if (subcommand === 'skill') {
  // `aimeat skill install <ref>` — fetch a registry skill and materialize it as a local
  // Anthropic agent skill (~/.claude/skills by default; --project / --dir override).
  const skillAction = positionals[1];
  const skillFlags: Record<string, string> = {};
  const skillRawArgs = process.argv.slice(2);
  for (let i = 0; i < skillRawArgs.length; i++) {
    if (skillRawArgs[i].startsWith('--')) {
      if (skillRawArgs[i + 1] && !skillRawArgs[i + 1].startsWith('--')) {
        skillFlags[skillRawArgs[i].slice(2)] = skillRawArgs[++i];
      } else {
        skillFlags[skillRawArgs[i].slice(2)] = 'true';
      }
    }
  }
  if (skillAction === 'install') {
    const { runSkillInstall } = await import('./cli/skill-install.js');
    await runSkillInstall(positionals[2], skillFlags);
  } else {
    console.log('Usage: aimeat skill install <ref> [--dir <path>] [--project] [--agent <name>] [--node <url> [--token <jwt>]]');
    console.log('  Installs a skills-registry skill as a local Claude agent skill (default: ~/.claude/skills).');
    if (skillAction && skillAction !== 'help') process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
} else if (subcommand === 'seed') {
  const baseUrl = `http://localhost:${config.port}`;
  const adminPw = config.adminPassword ?? '';
  console.log('\n=== AIMEAT Example Package Seeder ===\n');
  console.log(`  Server: ${baseUrl}`);
  try {
    const probe = await fetch(`${baseUrl}/v1/health`);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch {
    console.error(`\n  Server not reachable at ${baseUrl}`);
    console.error('  Start the server first: aimeat start\n');
    process.exit(1);
  }
  if (!adminPw) {
    console.error('\n  AIMEAT_ADMIN_PASSWORD not found in .env or environment.\n');
    process.exit(1);
  }
  console.log('  Seeding example packages via admin API...\n');
  const seedResp = await fetch(`${baseUrl}/v1/admin/seed-examples`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
  });
  const seedData = await seedResp.json() as { ok: boolean; data?: { seeded?: Array<{ name: string; templateId: string; packageGroupId: string }> }; error?: { message?: string } };
  if (!seedData.ok) {
    console.error(`  Failed: ${seedData.error?.message ?? JSON.stringify(seedData)}`);
    process.exit(1);
  }
  for (const pkg of seedData.data?.seeded ?? []) {
    const status = pkg.templateId === '(already exists)' ? 'already exists' : 'created';
    console.log(`  ${status === 'created' ? '+' : '='} ${pkg.name} (${status})`);
  }
  console.log('\n  Done!\n');
  process.exit(0);
} else if (subcommand === 'start' || subcommand === 'serve') {
  await runStart(config, { envKeys, fileKeys, cliKeys, fileName }, __pkgRoot);
} else if (subcommand) {
  console.error(`Unknown command: ${subcommand}\n`);
  console.log(HELP_TEXT);
  process.exit(1);
} else {
  // No subcommand — show help
  console.log(HELP_TEXT);
  process.exit(0);
}
