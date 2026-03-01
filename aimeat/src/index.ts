#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
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
  1. Edit the .env file in this directory to configure your node
  2. Run "aimeat config" to see all settings
  3. Run "aimeat validate" to check for problems
  4. Run "aimeat start" to launch the node
`;

if (values.help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (values.version) {
  console.log('aimeat v1.2.0');
  process.exit(0);
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
  const outFile = positionals[1] ?? 'aimeat.config.json';
  if (existsSync(outFile)) {
    console.log(`Config file already exists: ${outFile}`);
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string, def: string): Promise<string> =>
    new Promise(resolve => rl.question(`${q} [${def}]: `, ans => resolve(ans.trim() || def)));

  (async () => {
    console.log('\n❤️ AIMEAT Node Configuration Wizard\n');
    const nodeId = await ask('Node ID', config.nodeId);
    const port = await ask('Port', String(config.port));
    const welcomeBonus = await ask('Welcome bonus (morsels)', String(config.welcomeBonus));
    const dailyAllowance = await ask('Daily allowance (morsels)', String(config.dailyAllowance));
    const dailyAllowanceCap = await ask('Daily allowance cap', String(config.dailyAllowanceCap));
    const burnRate = await ask('Burn rate (0-1)', String(config.burnRate));
    const jwtTtlSeconds = await ask('JWT TTL (seconds)', String(config.jwtTtlSeconds));
    const db = await ask('MongoDB URL (blank for in-memory)', config.dbUrl ?? '');
    rl.close();

    const cfg: Record<string, unknown> = {
      nodeId,
      port: parseInt(port, 10),
      welcomeBonus: parseInt(welcomeBonus, 10),
      dailyAllowance: parseInt(dailyAllowance, 10),
      dailyAllowanceCap: parseInt(dailyAllowanceCap, 10),
      burnRate: parseFloat(burnRate),
      jwtTtlSeconds: parseInt(jwtTtlSeconds, 10),
    };
    if (db) cfg.db = db;

    writeFileSync(outFile, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`\nConfig written to ${outFile}\n`);
    console.log(`Next steps:`);
    console.log(`  1. Review the config:   cat ${outFile}`);
    console.log(`  2. Validate settings:   aimeat validate`);
    console.log(`  3. Start the node:      aimeat start --config ${outFile}`);
    console.log('');
    process.exit(0);
  })();
} else if (subcommand === 'validate' || subcommand === 'check') {
  const { validateEnv, formatValidationResults } = await import('./utils/env-validator.js');
  const results = validateEnv();
  console.log(formatValidationResults(results));
  const hasErrors = results.some(r => r.level === 'error');
  process.exit(hasErrors ? 1 : 0);
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
  const { app, tunnelManager, storage } = await createServer(config);
  const server = app.listen(config.port, () => {
    logger.info(`❤️ AIMEAT node started`, {
      nodeId: config.nodeId,
      port: config.port,
      storage: config.dbUrl ? 'mongodb' : 'in-memory',
    });
    logger.info(`   GET ${config.baseUrl}/`);
    logger.info(`   Protocol: AIMEAT v1.3 | License: MIT`);
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
    logger.info(``);
    logger.info(`   Admin Setup: ${config.baseUrl}/v1/admin/setup?pw=${config.adminPassword}`);
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
      logger.info(`   Admin Secret: ${config.adminPassword}`);
    }
    logger.info(`──────────────────────────────────────────────────────────`);
  });

  // WebSocket upgrade handling for personal node tunnels
  if (tunnelManager) {
    const { WebSocketServer } = await import('ws');
    const { verifyJWT } = await import('./auth/jwt.js');
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', async (request, socket, head) => {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`);
      if (url.pathname !== '/v1/personal/tunnel') {
        socket.destroy();
        return;
      }

      // Authenticate: JWT from Authorization header or ?token= query param
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

        // Extract owner name and look up their personal node
        const ownerName = (payload.owner as string) ?? '';
        const personalNode = await storage.getPersonalNodeByOwner(ownerName);
        if (!personalNode) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          tunnelManager.handleConnection(ws, personalNode.nodeId, ownerName, personalNode.agentGaiis);
        });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });

    logger.info('WebSocket upgrade handler registered for /v1/personal/tunnel');
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
