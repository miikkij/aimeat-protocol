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

if (values.help) {
  console.log(`
aimeat — AI Memory Exchange and Action Transfer protocol node

USAGE
  aimeat [options]            Start the node
  aimeat init                 Interactive config wizard
  aimeat backup  --out FILE   Export all data to JSON
  aimeat restore --from FILE  Import data from JSON backup

OPTIONS
  -p, --port <port>          HTTP port (default: 40050)
  --db <url>                 MongoDB connection URL
  --node-id <id>             Node identity string
  --admin-password <pw>      Operator admin secret
  -c, --config <path>        Config file path (JSON)
  -h, --help                 Show this help
  -v, --version              Show version

ENVIRONMENT VARIABLES
  MEAT_PORT, MEAT_NODE_ID, DATABASE_URL, MEAT_ADMIN_PASSWORD
  MEAT_JWT_TTL, MEAT_WELCOME_BONUS, MEAT_DAILY_ALLOWANCE
  MEAT_DAILY_ALLOWANCE_CAP, MEAT_BURN_RATE, MEAT_KEYED_BROWSE
`);
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
if (values.port) process.env.MEAT_PORT = values.port;
else if (fileConfig.port) process.env.MEAT_PORT = String(fileConfig.port);

if (values.db) process.env.DATABASE_URL = values.db;
else if (fileConfig.db) process.env.DATABASE_URL = fileConfig.db;

if (values['node-id']) process.env.MEAT_NODE_ID = values['node-id'];
else if (fileConfig.nodeId) process.env.MEAT_NODE_ID = fileConfig.nodeId;

if (values['admin-password']) process.env.MEAT_ADMIN_PASSWORD = values['admin-password'];
else if (fileConfig.adminPassword) process.env.MEAT_ADMIN_PASSWORD = fileConfig.adminPassword;

if (fileConfig.jwtTtlSeconds) process.env.MEAT_JWT_TTL = String(fileConfig.jwtTtlSeconds);
if (fileConfig.welcomeBonus) process.env.MEAT_WELCOME_BONUS = String(fileConfig.welcomeBonus);
if (fileConfig.dailyAllowance) process.env.MEAT_DAILY_ALLOWANCE = String(fileConfig.dailyAllowance);
if (fileConfig.dailyAllowanceCap) process.env.MEAT_DAILY_ALLOWANCE_CAP = String(fileConfig.dailyAllowanceCap);
if (fileConfig.burnRate) process.env.MEAT_BURN_RATE = String(fileConfig.burnRate);

const config = loadConfig();
const subcommand = positionals[0];

// Handle subcommands
if (subcommand === 'init') {
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
    const nodeId = await ask('Node ID', 'meat-local-001');
    const port = await ask('Port', '40050');
    const welcomeBonus = await ask('Welcome bonus (morsels)', '100');
    const dailyAllowance = await ask('Daily allowance (morsels)', '50');
    const dailyAllowanceCap = await ask('Daily allowance cap', '500');
    const burnRate = await ask('Burn rate (0-1)', '0.10');
    const jwtTtlSeconds = await ask('JWT TTL (seconds)', '3600');
    const db = await ask('MongoDB URL (blank for in-memory)', '');
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
    console.log(`\nConfig written to ${outFile}`);
    console.log(`Start the node: aimeat --config ${outFile}`);
  })();
} else if (subcommand === 'backup') {
  const outArg = positionals[1] ?? 'aimeat-backup.json';
  const app = await createServer(config);
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
  const app = await createServer(config);
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
} else {
  // Default: start the server
  // Auto-generate admin password if not set
  if (!config.adminPassword) {
    config.adminPassword = randomBytes(16).toString('base64url');
  }
  const app = await createServer(config);
  app.listen(config.port, () => {
    logger.info(`❤️ AIMEAT node started`, {
      nodeId: config.nodeId,
      port: config.port,
      storage: config.dbUrl ? 'mongodb' : 'in-memory',
    });
    logger.info(`   GET ${config.baseUrl}/`);
    logger.info(`   Protocol: AIMEAT v1.2 | License: MIT`);
    if (config.devMode) {
      logger.info(`   ⚠ DEV MODE: OTK validation bypassed on micro-memory`);
    }
    if (config.anonymousMode) {
      logger.info(`   ⚠ ANONYMOUS MODE: No auth required — all agents share one memory space`);
      logger.info(`   Anonymous prompt: ${config.baseUrl}/v1/prompts/anonymous`);
      logger.info(`   Share with others: ${config.baseUrl}/v1/prompts/anonymous/share?format=text`);
    }
    logger.info(``);
    logger.info(`   Admin Setup: ${config.baseUrl}/v1/admin/setup?pw=${config.adminPassword}`);
    if (!process.env.MEAT_ADMIN_PASSWORD) {
      logger.info(`   Admin Secret: ${config.adminPassword}`);
    }
  });
}
