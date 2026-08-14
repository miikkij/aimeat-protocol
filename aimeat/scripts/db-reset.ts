#!/usr/bin/env node
/**
 * AIMEAT Database Reset Script
 *
 * Detects the configured storage provider and wipes all data:
 *   - sqlite:          deletes the .db file
 *   - postgres-kysely: drops and recreates the public schema (migrations re-run on next boot)
 *   - memory:          nothing to do (ephemeral)
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

// ─── PostgreSQL (Kysely) reset ───────────────────────────────

async function resetPostgresKysely() {
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    console.error('  x No DATABASE_URL found. Set it in .env');
    process.exit(1);
  }

  const dbName = (() => {
    try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0] || '(unknown)'; }
    catch { return '(unknown)'; }
  })();

  console.log(`  Storage:      postgres-kysely`);
  console.log(`  Database:     ${dbName}`);
  console.log('');

  if (!await confirm(`  Drop and recreate the public schema in "${dbName}"? [y/N] `)) {
    console.log('  Aborted.');
    return;
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('  Schema dropped and recreated — migrations re-run on next server boot.');
  } finally {
    await client.end();
  }
}

// ─── Main ────────────────────────────────────────────────────

console.log('');
console.log('  AIMEAT Database Reset');
console.log('  ══════════════════════════════════════');

switch (provider) {
  case 'sqlite':
    await resetSqlite();
    break;
  case 'postgres':
  case 'postgresql':
  case 'postgres-kysely':
    await resetPostgresKysely();
    break;
  default:
    console.log(`  Storage: memory (in-memory)`);
    console.log('  Nothing to reset — data is cleared on server restart.');
    break;
}

console.log('');
