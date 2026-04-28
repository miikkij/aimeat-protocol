#!/usr/bin/env node
/**
 * AIMEAT Database Reset Script
 *
 * Detects the configured storage provider and wipes all data:
 *   - sqlite:  deletes the .db file
 *   - mongodb: drops all AIMEAT collections
 *   - memory:  nothing to do (ephemeral)
 *
 * Usage:
 *   pnpm db:reset            # interactive confirmation
 *   pnpm db:reset --force    # skip confirmation (CI / scripts)
 */

import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Parse .env ──────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const envPath = resolve(ROOT, '.env');
  const vars: Record<string, string> = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"\n]*)"?/);
      if (m) vars[m[1]] = m[2];
    }
  }
  return vars;
}

const env = { ...loadEnv(), ...process.env };
const provider = env.AIMEAT_STORAGE ?? 'memory';
const force = process.argv.includes('--force') || process.argv.includes('-f');

// ─── Confirmation prompt ─────────────────────────────────────

async function confirm(message: string): Promise<boolean> {
  if (force) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(r => rl.question(message, r));
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

// ─── SQLite reset ────────────────────────────────────────────

async function resetSqlite() {
  const dbPath = resolve(ROOT, env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db');
  console.log(`  Storage:  sqlite`);
  console.log(`  Path:     ${dbPath}`);
  console.log('');

  if (!existsSync(dbPath)) {
    console.log('  Nothing to reset — database file does not exist.');
    return;
  }

  if (!await confirm('  Delete the database file? [y/N] ')) {
    console.log('  Aborted.');
    return;
  }

  unlinkSync(dbPath);
  // Also remove WAL/SHM files if present
  for (const suffix of ['-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
  console.log('  Database file deleted.');
}

// ─── MongoDB reset ───────────────────────────────────────────

// All Prisma model names — each becomes a MongoDB collection.
// Keep in sync with prisma/schema.prisma when adding new models.
const AIMEAT_COLLECTIONS = [
  // Core identity & auth
  'Owner', 'Agent', 'Ghii', 'Session', 'RevokedToken', 'Otk',
  'DeviceAuth', 'OAuthClient', 'OAuthRefreshToken', 'OAuthApproval',
  // Data storage
  'Memory', 'MicroMemory', 'StorageFile', 'SchemaLock',
  // Economy
  'Transaction', 'EscrowHold',
  // Work & actions
  'Action', 'Work', 'Dispute', 'DisputeAudit',
  // Social
  'Board', 'BoardPost', 'BoardSubscription',
  'Organism', 'OrganismMembership', 'OrganismReputation', 'JoinRequest',
  // Consent & moderation
  'Consent', 'ConsentAudit', 'Flag', 'Appeal',
  // Federation & nodes
  'PeeringRequest', 'NodeKey', 'GenesisPeer',
  'PersonalNode', 'MailboxItem', 'PersonalPushSubscription',
  // Services & marketplace
  'Csm', 'Msm', 'Listing', 'Purchase', 'Match',
  'App', 'AppDownload', 'AppPurchase',
  // Extensions & cortex
  'Extension', 'ExtensionInstance', 'CortexExtension', 'CortexLibFile',
  // Knowledge & packages
  'KnowledgeLink', 'KnowledgeReview',
  'Package', 'PackageInstance', 'TemplateListing', 'TemplateReview', 'TemplateDiscussion',
  // Notifications & push
  'PushSubscription', 'NotificationTemplate', 'NotificationPreference',
  // Chat & realtime
  'ChatInstance', 'RealtimeRoom',
  // System
  'SystemSetting', 'SystemPrompt', 'SystemPromptVersion',
  'SiteChangeLog', 'EmailVerification', 'TrustedIssuer',
  'ScheduledJob', 'ExecutionLog',
];

async function resetMongodb() {
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    console.error('  x No DATABASE_URL found. Set it in .env');
    process.exit(1);
  }

  const dbName = (() => {
    try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0] || '(unknown)'; }
    catch { return '(unknown)'; }
  })();

  console.log(`  Storage:      mongodb`);
  console.log(`  Database:     ${dbName}`);
  console.log(`  Collections:  ${AIMEAT_COLLECTIONS.length}`);
  console.log('');

  if (!await confirm(`  Drop all ${AIMEAT_COLLECTIONS.length} collections in "${dbName}"? [y/N] `)) {
    console.log('  Aborted.');
    return;
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });
  await prisma.$connect();

  let dropped = 0;
  for (const name of AIMEAT_COLLECTIONS) {
    try {
      await prisma.$runCommandRaw({ drop: name });
      console.log(`  - Dropped: ${name}`);
      dropped++;
    } catch {
      // Collection might not exist — that's fine
    }
  }

  await prisma.$disconnect();
  console.log(`\n  Dropped ${dropped}/${AIMEAT_COLLECTIONS.length} collections.`);
}

// ─── Main ────────────────────────────────────────────────────

console.log('');
console.log('  AIMEAT Database Reset');
console.log('  ══════════════════════════════════════');

switch (provider) {
  case 'sqlite':
    await resetSqlite();
    break;
  case 'mongodb':
    await resetMongodb();
    break;
  default:
    console.log(`  Storage: memory (in-memory)`);
    console.log('  Nothing to reset — data is cleared on server restart.');
    break;
}

console.log('');
