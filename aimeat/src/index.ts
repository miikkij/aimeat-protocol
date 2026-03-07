#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
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
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

const HELP_TEXT = `
aimeat — AI Memory Exchange and Action Transfer protocol node

USAGE
  aimeat start [options]         Start the node
  aimeat serve [options]         Alias for start
  aimeat config                  Show all settings and their current values
  aimeat config export [opts]    Export config (--format env|ini|json|consul)
  aimeat config import [opts]    Import config to database (--file <path> | --from consul)
  aimeat validate                Validate configuration (env, files, database)
  aimeat check                   Alias for validate
  aimeat init                    Interactive config wizard (generates .env, .ini, or .json)
  aimeat join [URL]              Join a federation network
  aimeat maintenance on [MSG]    Enable maintenance mode (optional message)
  aimeat maintenance off         Disable maintenance mode
  aimeat maintenance             Show maintenance status
  aimeat backup  [FILE]          Export all data to JSON
  aimeat restore <FILE>          Import data from JSON backup

START OPTIONS
  --db <type>              Storage type: mongodb, sqlite, memory
  --db-url <url>           Database connection URL (MongoDB)
  --db-path <path>         SQLite database file path
  -p, --port <port>        HTTP port (default: 40050)
  --node-id <id>           Node identity string
  --admin-password <pw>    Operator admin secret
  -c, --config <path>      Config file path (JSON)
  --consul <url>           Enable Consul and set URL (e.g., http://consul:8500)
  --consul-prefix <prefix> Consul KV prefix (default: aimeat/config)
  --consul-token <token>   Consul ACL token
  -h, --help               Show this help
  -v, --version            Show version

CONFIG EXPORT OPTIONS
  --format <fmt>           Output format: env, ini, json, consul

CONFIG IMPORT OPTIONS
  --file <path>            Import from file (.env, .ini, or .json)
  --from consul            Import from Consul KV into database

QUICK START
  1. Run "aimeat init" to create a config (interactive wizard)
  2. Run "aimeat validate" to check for problems
  3. Run "aimeat start" to launch the node

MIGRATION: .env to database
  1. aimeat start --db mongodb --db-url mongodb://localhost:27017/aimeat
  2. aimeat config import --file .env
  3. Manage config via admin dashboard (changes persist to database)

CONFIG SOURCES (highest priority first)
  1. CLI args (--port, --db, etc.)
  2. Database (admin dashboard changes, persistent)
  3. Consul KV (fleet management, live reload)
  4. aimeat.ini / aimeat.json (in working directory)
  5. .env file / environment variables
  6. Built-in defaults

MULTIPLE ENVIRONMENTS
  aimeat init creates .env (default) or named config files.
  Use config files to manage multiple environments on one machine:
    aimeat start --config production.json
    aimeat start --config staging.json
`;

if (values.help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (values.version) {
  console.log('aimeat v1.2.0');
  process.exit(0);
}

// Load .env into process.env if not already loaded by bin/aimeat.ts.
// Search: CWD first, then package root (aimeat/ directory).
// Package root: from dist/src/index.js -> go up 2 levels to aimeat/
const __pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
if (values.port) cliOverrides['node.port'] = values.port;
if (values.db) cliOverrides['storage.type'] = values.db;
if (values['db-url']) cliOverrides['database_url'] = values['db-url'];
if (values['db-path']) cliOverrides['sqlite_path'] = values['db-path'];
if (values['node-id']) cliOverrides['node.id'] = values['node-id'];
if (values['admin-password']) cliOverrides['admin_password'] = values['admin-password'];
if (values.consul) {
  cliOverrides['consul.enabled'] = 'true';
  cliOverrides['consul.url'] = values.consul;
}
if (values['consul-prefix']) cliOverrides['consul.prefix'] = values['consul-prefix'];
if (values['consul-token']) cliOverrides['consul.token'] = values['consul-token'];

const { config, envKeys, fileKeys, cliKeys, fileName } = loadConfig({
  configPath: values.config,
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
} else if (subcommand === 'validate' || subcommand === 'check') {
  const { validateEnv, formatValidationResults } = await import('./utils/env-validator.js');
  const results = validateEnv();
  console.log(formatValidationResults(results));
  const hasErrors = results.some(r => r.level === 'error');
  process.exit(hasErrors ? 1 : 0);
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
} else if (subcommand === 'start' || subcommand === 'serve') {
  // Start the server
  // Auto-generate admin password if not set
  if (!config.adminPassword) {
    config.adminPassword = randomBytes(16).toString('base64url');
  }
  const { app, tunnelManager, realtimeManager, storage } = await createServer(config, { envKeys, fileKeys, cliKeys, fileName });
  const server = app.listen(config.port, () => {
    // ── Node type banner ──
    const bannerLabel =
      config.federationRole === 'operator' ? 'GENESIS-OPERATOR NODE' :
        config.federationRole === 'contributor' ? 'FEDERATION NODE' :
          config.nodeType === 'personal' ? 'PRIVATE NODE' :
            config.devMode ? 'DEV NODE' :
              'STANDALONE NODE';
    const pad = 4;
    const inner = bannerLabel.length + pad * 2;
    const line = '─'.repeat(inner + 2);
    logger.info('');
    logger.info(`   ┌${line}┐`);
    logger.info(`   │${' '.repeat(pad)}${bannerLabel}${' '.repeat(pad)}│`);
    logger.info(`   └${line}┘`);
    logger.info('');

    logger.info(`   ❤️  AIMEAT node started`);
    logger.info(`   Node ID:   ${config.nodeId}`);
    logger.info(`   Port:      ${config.port}`);
    logger.info(`   Storage:   ${config.storageProvider}${config.storageProvider === 'sqlite' ? ` (${config.sqlitePath})` : ''}`);
    logger.info(`   URL:       ${config.baseUrl}/`);
    logger.info(`   Protocol:  AIMEAT v1.3 | License: MIT`);
    if (config.devMode) {
      logger.info(`   ⚠ DEV MODE: OTK validation bypassed on micro-memory`);
    }
    if (config.anonymousMode) {
      logger.info(`   ⚠ ANONYMOUS MODE: No auth required — all agents share one memory space`);
      logger.info(`   Anonymous prompt: ${config.baseUrl}/v1/prompts/anonymous`);
      logger.info(`   Share with others: ${config.baseUrl}/v1/prompts/anonymous/share?format=text`);
    }
    if (tunnelManager) {
      logger.info(`   🔌 Personal Node tunnel: ws://localhost:${config.port}/v1/personal/tunnel`);
    }
    if (realtimeManager) {
      logger.info(`   📡 Realtime P2P rooms: ws://localhost:${config.port}/v1/realtime/ws`);
    }
    logger.info(``);
    logger.info(`   Admin Setup: ${config.baseUrl}/v1/admin/setup?pw=${config.adminPassword}`);
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
      logger.info(`   Admin Secret: ${config.adminPassword}`);
    }
    logger.info(`──────────────────────────────────────────────────────────`);

    // Log active service extensions and their instances
    storage.listExtensions().then(async (extensions) => {
      const active = extensions.filter(e => e.status === 'active');
      if (active.length === 0) return;

      logger.info('');
      for (const ext of active) {
        const instances = ext.instances?.supported
          ? await storage.listExtensionInstances(ext.name).catch(() => [])
          : [];
        const activeInstances = instances.filter(i => i.status === 'active');
        const actionIds = ext.actions.map(a => a.id).join(', ');

        logger.info(`   ────────────────────────────────────────────────────`);
        logger.info(`   Extension: ${ext.name} v${ext.version} [active]`);
        logger.info(`   Actions:   ${actionIds}`);
        if (ext.instances?.supported) {
          logger.info(`   Instances:  ${activeInstances.length} active / ${instances.length} total`);
          for (const inst of activeInstances) {
            const vis = (inst.config as Record<string, unknown>)?.visibility || 'public';
            logger.info(`     - ${inst.id} (${vis})`);
          }
        }
      }
      logger.info(`   ────────────────────────────────────────────────────`);
      logger.info('');
    }).catch(() => { /* ignore */ });

    // Check and display maintenance mode warning
    storage.getMaintenanceMode().then(state => {
      if (state?.enabled) {
        logger.info('');
        logger.info(`   ┌──────────────────────────────────────────────────────┐`);
        logger.info(`   │  🚧 MAINTENANCE MODE IS ON                          │`);
        logger.info(`   │  Message: ${(state.message || '(none)').padEnd(41)}│`);
        logger.info(`   │  Since:   ${(state.enabledAt ?? 'unknown').padEnd(41)}│`);
        logger.info(`   │                                                      │`);
        logger.info(`   │  Run "aimeat maintenance off" to disable             │`);
        logger.info(`   └──────────────────────────────────────────────────────┘`);
        logger.info('');
      }
    }).catch(() => { /* ignore */ });
  });

  // WebSocket upgrade handling for personal node tunnels + realtime P2P
  if (tunnelManager || realtimeManager) {
    const { WebSocketServer } = await import('ws');
    const { verifyJWT } = await import('./auth/jwt.js');
    const { isAnonymousMode } = await import('./auth/middleware.js');
    const tunnelWss = tunnelManager ? new WebSocketServer({ noServer: true }) : null;
    const realtimeWss = realtimeManager ? new WebSocketServer({ noServer: true }) : null;

    server.on('upgrade', async (request, socket, head) => {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`);

      // ── Personal tunnel upgrade ──
      if (url.pathname === '/v1/personal/tunnel' && tunnelManager && tunnelWss) {
        const authHeader = request.headers.authorization;
        const tokenParam = url.searchParams.get('token');
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : tokenParam;

        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const payload = await verifyJWT(token);
          if (!payload || !payload.sub) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          const ownerName = (payload.owner as string) ?? '';
          const personalNode = await storage.getPersonalNodeByOwner(ownerName);
          if (!personalNode) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }

          tunnelWss.handleUpgrade(request, socket, head, (ws) => {
            tunnelManager.handleConnection(ws, personalNode.nodeId, ownerName, personalNode.agentGaiis);
          });
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
        return;
      }

      // ── Realtime P2P upgrade ──
      if (url.pathname === '/v1/realtime/ws' && realtimeManager && realtimeWss) {
        const roomId = url.searchParams.get('room');
        const nick = url.searchParams.get('nick') ?? 'anonymous';

        if (!roomId) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        // Authenticate: JWT from ?token= or Authorization header
        const authHeader = request.headers.authorization;
        const tokenParam = url.searchParams.get('token');
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : tokenParam;

        if (!token) {
          // Allow anonymous mode without token for realtime WS
          if (isAnonymousMode()) {
            const room = realtimeManager.getRoom(roomId);
            if (!room) {
              socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
              socket.destroy();
              return;
            }
            realtimeWss.handleUpgrade(request, socket, head, (ws) => {
              realtimeManager.handleUpgrade(ws, roomId, nick);
            });
            return;
          }
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const payload = await verifyJWT(token);
          if (!payload || !payload.sub) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          // Verify room exists
          const room = realtimeManager.getRoom(roomId);
          if (!room) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
          }

          realtimeWss.handleUpgrade(request, socket, head, (ws) => {
            realtimeManager.handleUpgrade(ws, roomId, nick);
          });
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
        return;
      }

      // Unknown WebSocket path
      socket.destroy();
    });

    if (tunnelManager) logger.info('WebSocket upgrade handler registered for /v1/personal/tunnel');
    if (realtimeManager) logger.info('WebSocket upgrade handler registered for /v1/realtime/ws');
  }
} else if (subcommand) {
  console.error(`Unknown command: ${subcommand}\n`);
  console.log(HELP_TEXT);
  process.exit(1);
} else {
  // No subcommand — show help
  console.log(HELP_TEXT);
  process.exit(0);
}
