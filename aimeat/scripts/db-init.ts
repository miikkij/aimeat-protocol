#!/usr/bin/env node
/**
 * AIMEAT Database Initialization Script
 *
 * Initializes the MongoDB database for AIMEAT:
 * 1. (Optional) Drops all collections (--reset)
 * 2. Pushes the Prisma schema (indexes & collections)
 * 3. Verifies the connection
 *
 * Usage:
 *   pnpm db:init             # push schema, verify connection
 *   pnpm db:init --reset     # drop all data first, then push schema
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Parse args ─────────────────────────────────────────────

const args = process.argv.slice(2);
const flagReset = args.includes('--reset');

// ─── Resolve DATABASE_URL ───────────────────────────────────

let dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  // Try loading from .env manually
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf8');
    const match = envContent.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (match) dbUrl = match[1];
  }
}

if (!dbUrl) {
  console.error('❌ No DATABASE_URL found. Set it in .env');
  process.exit(1);
}

const dbDisplay = dbUrl.replace(/\/\/[^@]+@/, '//*****@'); // hide credentials
console.log('');
console.log('❤️ AIMEAT Database Initialization');
console.log('──────────────────────────────────────');
console.log(`   Database: ${dbDisplay}`);
console.log('');

// ─── Step 1: Reset database (optional) ──────────────────────

if (flagReset) {
  console.log('🗑️  Step 1: Dropping all collections...');
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasourceUrl: dbUrl });
    await prisma.$connect();

    const collections = ['Owner', 'Agent', 'Memory', 'Action', 'Work'];
    for (const name of collections) {
      try {
        await prisma.$runCommandRaw({ drop: name });
        console.log(`   Dropped: ${name}`);
      } catch {
        // Collection might not exist yet
      }
    }

    await prisma.$disconnect();
    console.log('   ✅ Reset complete\n');
  } catch (err: any) {
    console.error(`   ❌ Reset failed: ${err.message}`);
    process.exit(1);
  }
}

// ─── Step 2: Prisma generate + push ─────────────────────────

console.log('📐 Step 2: Generating Prisma client...');
try {
  execSync('npx prisma generate', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } });
  console.log('   ✅ Prisma client generated\n');
} catch (err: any) {
  // EPERM = DLL locked by running server — client already generated, that's OK
  const stderr = err.stderr?.toString() ?? '';
  if (stderr.includes('EPERM') || stderr.includes('operation not permitted')) {
    console.log('   ⚠️  Prisma engine locked (server running?) — skipping generate (already up to date)\n');
  } else {
    console.error('   ❌ prisma generate failed:', stderr || err.message);
    process.exit(1);
  }
}

console.log('📊 Step 3: Pushing schema to MongoDB (indexes & collections)...');
try {
  execSync('npx prisma db push', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } });
  console.log('   ✅ Schema pushed successfully\n');
} catch (err: any) {
  console.error('   ❌ prisma db push failed:', err.stderr?.toString() ?? err.message);
  process.exit(1);
}

// ─── Step 4: Verify connection ──────────────────────────────

console.log('🔍 Step 4: Verifying connection...');
try {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });
  await prisma.$connect();

  const ownerCount = await prisma.owner.count();
  const agentCount = await prisma.agent.count();
  const memoryCount = await prisma.memory.count();

  console.log(`   ✅ Connected successfully`);
  console.log(`   📈 Current data: ${ownerCount} owners, ${agentCount} agents, ${memoryCount} memory entries\n`);

  await prisma.$disconnect();
} catch (err: any) {
  console.error(`   ❌ Connection verification failed: ${err.message}`);
  process.exit(1);
}

// ─── Done ───────────────────────────────────────────────────

console.log('──────────────────────────────────────');
console.log('✅ Database initialization complete!');
console.log('');
console.log('   Start the server:  pnpm dev');
console.log(`   Dashboard:         http://localhost:40050/v1/admin/setup`);
console.log('');
