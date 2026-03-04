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
    'node-id': { type: 'string' },
    'admin-password': { type: 'string' },
    config: { type: 'string', short: 'c' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

const HELP_TEXT = `
aimeat — AI Memory Exchange and Action Transfer protocol node

USAGE
  aimeat start [options]      Start the node
  aimeat serve [options]      Alias for start
  aimeat config               Show all settings and their current values
  aimeat validate             Validate .env configuration
  aimeat check                Alias for validate
  aimeat init                 Interactive config wizard
  aimeat join [URL]            Join a federation network
  aimeat maintenance on [MSG]  Enable maintenance mode (optional message)
  aimeat maintenance off       Disable maintenance mode
  aimeat maintenance           Show maintenance status
  aimeat backup  [FILE]       Export all data to JSON
  aimeat restore <FILE>       Import data from JSON backup

OPTIONS
  -p, --port <port>          HTTP port (default: 40050)
  --db <url>                 MongoDB connection URL
  --node-id <id>             Node identity string
  --admin-password <pw>      Operator admin secret
  -c, --config <path>        Config file path (JSON)
  -h, --help                 Show this help
  -v, --version              Show version

QUICK START
  1. Run "aimeat init" to create a config (interactive wizard)
  2. Run "aimeat validate" to check for problems
  3. Run "aimeat start" to launch the node

MULTIPLE ENVIRONMENTS
  aimeat init creates .env (default) or named JSON config files.
  Use JSON configs to manage multiple environments on one machine:
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

// Load config file: explicit --config flag, or auto-detect aimeat.config.json in CWD
let fileConfig: Record<string, string> = {};
const configPath = values.config ?? (existsSync('aimeat.config.json') ? 'aimeat.config.json' : null);
if (configPath) {
  try {
    fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(`Error reading config file: ${configPath}`);
    process.exit(1);
  }
}

// CLI flags override config file override env vars
if (values.port) process.env.AIMEAT_PORT = values.port;
else if (fileConfig.port) process.env.AIMEAT_PORT = String(fileConfig.port);

if (values.db) process.env.DATABASE_URL = values.db;
else if (fileConfig.db) process.env.DATABASE_URL = fileConfig.db;

if (values['node-id']) process.env.AIMEAT_NODE_ID = values['node-id'];
else if (fileConfig.nodeId) process.env.AIMEAT_NODE_ID = fileConfig.nodeId;

if (values['admin-password']) process.env.AIMEAT_ADMIN_PASSWORD = values['admin-password'];
else if (fileConfig.adminPassword) process.env.AIMEAT_ADMIN_PASSWORD = fileConfig.adminPassword;

if (fileConfig.jwtTtlSeconds) process.env.AIMEAT_JWT_TTL = String(fileConfig.jwtTtlSeconds);
if (fileConfig.welcomeBonus) process.env.AIMEAT_WELCOME_BONUS = String(fileConfig.welcomeBonus);
if (fileConfig.dailyAllowance) process.env.AIMEAT_DAILY_ALLOWANCE = String(fileConfig.dailyAllowance);
if (fileConfig.dailyAllowanceCap) process.env.AIMEAT_DAILY_ALLOWANCE_CAP = String(fileConfig.dailyAllowanceCap);
if (fileConfig.burnRate) process.env.AIMEAT_BURN_RATE = String(fileConfig.burnRate);

const config = loadConfig();
const subcommand = positionals[0];

// Handle subcommands
if (subcommand === 'config') {
  const { formatConfig } = await import('./utils/env-config.js');
  console.log(formatConfig(config));
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
  let storage;
  if (config.dbUrl) {
    const { MongoStorage } = await import('./storage/providers/mongodb/index.js');
    const mongo = new MongoStorage(config.dbUrl);
    await mongo.ready;
    storage = mongo;
  } else {
    const { InMemoryStorage } = await import('./storage/providers/memory/index.js');
    storage = new InMemoryStorage();
  }

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
  const { app, tunnelManager, realtimeManager, storage } = await createServer(config);
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
    logger.info(`   Storage:   ${config.dbUrl ? 'mongodb' : 'in-memory'}`);
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
