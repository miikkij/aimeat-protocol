#!/usr/bin/env node
/**
 * AIMEAT Database Initialization Script
 *
 * Initializes the MongoDB database for AIMEAT:
 * 1. (Optional) Drops all AIMEAT collections (--reset)
 * 2. Pushes the Prisma schema (indexes & collections)
 * 3. Verifies the connection
 *
 * SAFETY: Only operates on the database specified in DATABASE_URL.
 *         Extracts and displays the DB name before any destructive ops.
 *         The --reset flag requires confirmation.
 *
 * Usage:
 *   pnpm db:init             # push schema, verify connection
 *   pnpm db:init --reset     # drop all AIMEAT collections first, then push schema
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// All AIMEAT Prisma model collection names (must match prisma/schema.prisma)
const aimeat_COLLECTIONS = [
  'Owner', 'Agent', 'Memory', 'Action', 'Work',
  'Transaction', 'Board', 'BoardPost', 'Otk',
  'Dispute', 'DisputeAudit', 'MicroMemory', 'StorageFile',
  'PeeringRequest', 'NodeKey', 'SystemSetting',
];

// ─── Parse args ─────────────────────────────────────────────

const args = process.argv.slice(2);
const flagReset = args.includes('--reset');
const flagForce = args.includes('--force') || args.includes('-f');

// ─── Resolve DATABASE_URL ───────────────────────────────────

let dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf8');
    const match = envContent.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (match) dbUrl = match[1];
  }
}

if (!dbUrl) {
  console.error('  x No DATABASE_URL found. Set it in .env');
  process.exit(1);
}

// Extract the database name from the URL for safety display
function extractDbName(url: string): string {
  try {
    const u = new URL(url);
    // MongoDB URL path is /<dbname>, possibly with ?params
    const name = u.pathname.replace(/^\//, '').split('?')[0];
    return name || '(unknown)';
  } catch {
    return '(unknown)';
  }
}

const dbName = extractDbName(dbUrl);
const dbDisplay = dbUrl.replace(/\/\/[^@]+@/, '//*****@');

console.log('');
console.log('  AIMEAT Database Initialization');
console.log('  ══════════════════════════════════════');
console.log(`   Database:  ${dbName}`);
console.log(`   URL:       ${dbDisplay}`);
console.log(`   Models:    ${aimeat_COLLECTIONS.length} collections`);
console.log('');

// ─── Step 1: Reset database (optional) ──────────────────────

if (flagReset) {
  console.log(`  ! WARNING: This will drop ALL ${aimeat_COLLECTIONS.length} AIMEAT collections in "${dbName}"`);
  console.log(`    Collections: ${aimeat_COLLECTIONS.join(', ')}`);
  console.log(`    Other databases on this server will NOT be affected.`);
  console.log('');

  if (!flagForce) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve =>
      rl.question(`   Type "${dbName}" to confirm reset: `, resolve)
    );
    rl.close();

    if (answer.trim() !== dbName) {
      console.log('   Aborted.\n');
      process.exit(1);
    }
  }

  console.log('');
  console.log('  Step 1: Dropping AIMEAT collections...');
  try {
    const prismaModule = await import('@prisma/client');
    const PrismaClient = prismaModule.PrismaClient ?? (prismaModule as any).default.PrismaClient;
    const prisma = new PrismaClient({ datasourceUrl: dbUrl });
    await prisma.$connect();

    let dropped = 0;
    for (const name of aimeat_COLLECTIONS) {
      try {
        await prisma.$runCommandRaw({ drop: name });
        console.log(`   - Dropped: ${name}`);
        dropped++;
      } catch {
        // Collection might not exist yet — that's fine
      }
    }

    await prisma.$disconnect();
    console.log(`   Dropped ${dropped}/${aimeat_COLLECTIONS.length} collections\n`);
  } catch (err: any) {
    console.error(`   x Reset failed: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log('  Step 1: Skipped (no --reset flag)\n');
}

// ─── Step 2: Prisma generate + push ─────────────────────────

console.log('  Step 2: Generating Prisma client...');
try {
  execSync('npx prisma generate', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } });
  console.log('   Prisma client generated\n');
} catch (err: any) {
  const stderr = err.stderr?.toString() ?? '';
  if (stderr.includes('EPERM') || stderr.includes('operation not permitted')) {
    console.log('   ! Prisma engine locked (server running?) — skipping generate\n');
  } else {
    console.error('   x prisma generate failed:', stderr || err.message);
    process.exit(1);
  }
}

console.log('  Step 3: Pushing schema to MongoDB (indexes & collections)...');
try {
  execSync('npx prisma db push', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } });
  console.log('   Schema pushed successfully\n');
} catch (err: any) {
  console.error('   x prisma db push failed:', err.stderr?.toString() ?? err.message);
  process.exit(1);
}

// ─── Step 3: Verify connection ──────────────────────────────

console.log('  Step 4: Verifying connection...');
try {
  const prismaModule2 = await import('@prisma/client');
  const PrismaClient2 = prismaModule2.PrismaClient ?? (prismaModule2 as any).default.PrismaClient;
  const prisma = new PrismaClient2({ datasourceUrl: dbUrl });
  await prisma.$connect();

  const ownerCount = await prisma.owner.count();
  const agentCount = await prisma.agent.count();
  const memoryCount = await prisma.memory.count();
  const actionCount = await prisma.action.count();
  const workCount = await prisma.work.count();
  const boardCount = await prisma.board.count();
  const disputeCount = await prisma.dispute.count();

  console.log(`   Connected to "${dbName}" successfully`);
  console.log(`   Data: ${ownerCount} owners, ${agentCount} agents, ${memoryCount} memories, ${actionCount} actions, ${workCount} work, ${boardCount} boards, ${disputeCount} disputes\n`);

  await prisma.$disconnect();
} catch (err: any) {
  console.error(`   x Connection verification failed: ${err.message}`);
  process.exit(1);
}

// ─── Done ───────────────────────────────────────────────────

console.log('  ══════════════════════════════════════');
console.log('  Database initialization complete!');
console.log('');
console.log('   Start the server:  pnpm dev');
console.log(`   Dashboard:         http://localhost:40050/v1/admin/setup`);
console.log('');
