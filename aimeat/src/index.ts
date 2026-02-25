#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
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
  aimeat backup  --out FILE   Export all data to JSON
  aimeat restore --from FILE  Import data from JSON backup

OPTIONS
  -p, --port <port>          HTTP port (default: 3117)
  --db <url>                 MongoDB connection URL
  --node-id <id>             Node identity string
  --admin-password <pw>      Operator admin password
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

// Load config file if specified
let fileConfig: Record<string, string> = {};
const configPath = values.config;
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
if (subcommand === 'backup') {
  const outArg = positionals[1] ?? 'aimeat-backup.json';
  const app = createServer(config);
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
  const app = createServer(config);
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
  const app = createServer(config);
  app.listen(config.port, () => {
    logger.info(`🥩 AIMEAT node started`, {
      nodeId: config.nodeId,
      port: config.port,
      storage: config.dbUrl ? 'mongodb' : 'in-memory',
    });
    logger.info(`   GET http://localhost:${config.port}/`);
    logger.info(`   Protocol: AIMEAT v1.2 | License: MIT`);
  });
}
