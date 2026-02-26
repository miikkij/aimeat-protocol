#!/usr/bin/env node
/**
 * AIMEAT Database Initialization Script
 *
 * Sets up MongoDB for use with AIMEAT:
 * 1. Connects to MongoDB
 * 2. Initializes replica set (required by Prisma)
 * 3. Creates the AIMEAT database and collections
 * 4. Pushes the Prisma schema (indexes, etc.)
 *
 * Usage:
 *   pnpm db:init                    # uses DATABASE_URL from .env
 *   pnpm db:init --url mongodb://...  # explicit connection string
 *   pnpm db:init --docker           # start MongoDB via docker compose first
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Parse args ─────────────────────────────────────────────

const args = process.argv.slice(2);
const flagDocker = args.includes('--docker');
const flagReset = args.includes('--reset');
const urlIdx = args.indexOf('--url');
const explicitUrl = urlIdx !== -1 ? args[urlIdx + 1] : undefined;

// ─── Resolve DATABASE_URL ───────────────────────────────────

let dbUrl = explicitUrl ?? process.env.DATABASE_URL;

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
  console.error('❌ No DATABASE_URL found. Set it in .env or pass --url <connection-string>');
  process.exit(1);
}

// Extract connection parts
const url = new URL(dbUrl);
const host = url.hostname;
const port = url.port || '27017';
const username = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const dbName = url.pathname.replace('/', '') || 'AIMEAT';
const replicaSet = url.searchParams.get('replicaSet') || 'myReplicaSet';

console.log('');
console.log('🥩 AIMEAT Database Initialization');
console.log('──────────────────────────────────────');
console.log(`   Host:        ${host}:${port}`);
console.log(`   Database:    ${dbName}`);
console.log(`   Replica Set: ${replicaSet}`);
console.log(`   User:        ${username}`);
console.log('');

// ─── Step 0: Docker (optional) ──────────────────────────────

if (flagDocker) {
  console.log('📦 Step 0: Starting MongoDB via docker compose...');
  try {
    execSync('docker compose up -d mongo', { cwd: ROOT, stdio: 'inherit' });
    // Wait for health check
    console.log('   Waiting for MongoDB to be healthy...');
    for (let i = 0; i < 30; i++) {
      try {
        execSync('docker compose exec mongo mongosh --eval "db.adminCommand(\'ping\')" --quiet', {
          cwd: ROOT, stdio: 'pipe'
        });
        break;
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    console.log('   ✅ MongoDB is running\n');
  } catch (err) {
    console.error('   ❌ Failed to start MongoDB via docker compose');
    process.exit(1);
  }
}

// ─── Step 1: Initialize Replica Set ─────────────────────────

console.log('🔧 Step 1: Initializing replica set...');

const authStr = username && password
  ? `-u "${username}" -p "${password}" --authenticationDatabase admin`
  : '';

// Build mongosh command to init replica set
const rsInitScript = `
try {
  const status = rs.status();
  print('Replica set already initialized: ' + status.set);
} catch (e) {
  print('Initializing replica set: ${replicaSet}');
  rs.initiate({ _id: '${replicaSet}', members: [{ _id: 0, host: '${host}:${port}' }] });
  // Wait for primary
  let attempts = 0;
  while (attempts < 30) {
    const s = rs.status();
    if (s.members && s.members[0] && s.members[0].stateStr === 'PRIMARY') {
      print('Replica set initialized successfully');
      break;
    }
    sleep(1000);
    attempts++;
  }
}
`.trim();

try {
  // Try docker exec first (if mongo is in docker)
  try {
    execSync(
      `docker compose exec -T mongo mongosh ${authStr} --eval "${rsInitScript.replace(/"/g, '\\"')}" --quiet`,
      { cwd: ROOT, stdio: 'pipe' }
    );
    console.log('   ✅ Replica set ready (via docker)\n');
  } catch {
    // Fall back to local mongosh
    execSync(
      `mongosh "mongodb://${username}:${password}@${host}:${port}/?authSource=admin" --eval "${rsInitScript.replace(/"/g, '\\"')}" --quiet`,
      { stdio: 'pipe' }
    );
    console.log('   ✅ Replica set ready (via local mongosh)\n');
  }
} catch (err: any) {
  console.log('   ⚠️  Could not initialize replica set automatically.');
  console.log('   If MongoDB is already configured with a replica set, this is fine.');
  console.log(`   Error: ${err.message?.split('\n')[0] ?? err}\n`);
}

// ─── Step 2: Reset database (optional) ─────────────────────

if (flagReset) {
  console.log('🗑️  Step 2: Dropping existing database...');
  const dropScript = `use ${dbName}; db.dropDatabase(); print('Database dropped');`;
  try {
    try {
      execSync(
        `docker compose exec -T mongo mongosh ${authStr} --eval "${dropScript}" --quiet`,
        { cwd: ROOT, stdio: 'pipe' }
      );
    } catch {
      execSync(
        `mongosh "mongodb://${username}:${password}@${host}:${port}/${dbName}?authSource=admin&replicaSet=${replicaSet}" --eval "${dropScript}" --quiet`,
        { stdio: 'pipe' }
      );
    }
    console.log('   ✅ Database dropped\n');
  } catch (err: any) {
    console.log(`   ⚠️  Could not drop database: ${err.message?.split('\n')[0] ?? err}\n`);
  }
}

// ─── Step 3: Prisma generate + push ─────────────────────────

console.log('📐 Step 3: Generating Prisma client...');
try {
  execSync('npx prisma generate', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } });
  console.log('   ✅ Prisma client generated\n');
} catch (err: any) {
  console.error('   ❌ prisma generate failed:', err.stderr?.toString() ?? err.message);
  process.exit(1);
}

console.log('📊 Step 4: Pushing schema to MongoDB (indexes & collections)...');
try {
  execSync('npx prisma db push', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, DATABASE_URL: dbUrl } });
  console.log('   ✅ Schema pushed successfully\n');
} catch (err: any) {
  console.error('   ❌ prisma db push failed:', err.stderr?.toString() ?? err.message);
  process.exit(1);
}

// ─── Step 5: Verify connection ──────────────────────────────

console.log('🔍 Step 5: Verifying connection...');
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
