/**
 * @file src/storage/storage-factory.ts
 * @description Storage backend factory — lazily imports and instantiates the requested Storage
 *   provider (PostgreSQL+Kysely or SQLite; default in-memory SQLite), and printing actionable
 *   guidance if the SQLite native bindings fail to load. The removed Prisma backends (mongodb,
 *   legacy postgresql) fail fast with migration guidance instead of silently falling through.
 *
 * @structure
 *   - createStorage(opts): resolves a Storage instance for the chosen provider
 *   - sqliteLoadFailed(err): prints fix guidance and exits when better-sqlite3 bindings fail
 *   - StorageProvider / StorageOptions: provider union and factory input types
 *
 * @version-history
 *   v2.0.0 — 2026-07-16 — Remove the deprecated Prisma backends (mongodb + legacy postgresql);
 *     `postgres`/`postgresql` now alias postgres-kysely, mongodb fails fast with guidance
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Storage } from './interface.js';

export type StorageProvider = 'memory' | 'sqlite' | 'postgres-kysely';

export interface StorageOptions {
  provider: StorageProvider;
  sqlitePath?: string;
  dbUrl?: string;
}

function sqliteLoadFailed(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('\n\x1b[31m[AIMEAT] SQLite native bindings failed to load:\x1b[0m');
  console.error(`  ${msg.split('\n')[0]}\n`);
  console.error('\x1b[33mFix options:\x1b[0m');
  console.error('  1. Rebuild native modules:  npm rebuild better-sqlite3');
  console.error('     (macOS: install Xcode CLI tools first: xcode-select --install)');
  console.error('  2. Use PostgreSQL instead:  aimeat start --db postgres-kysely --db-url postgresql://localhost:5432/aimeat');
  console.error('  3. Reinstall from scratch:   npm install -g aimeat\n');
  process.exit(1);
}

export async function createStorage(opts: StorageOptions): Promise<Storage> {
  // The Prisma-era MongoDB backend was removed (AIMEAT v2.0 prep). Fail fast with guidance
  // rather than letting an unknown value fall through to the in-memory default — a production
  // node silently booting empty would be far worse than refusing to start.
  if ((opts.provider as string) === 'mongodb') {
    console.error('\n\x1b[31m[AIMEAT] The MongoDB storage backend has been removed.\x1b[0m');
    console.error('  Supported backends: postgres-kysely (production) and sqlite.');
    console.error('  To migrate MongoDB data, run the last release that still ships');
    console.error('  `pnpm migrate:to-postgres-kysely`, then upgrade.\n');
    process.exit(1);
  }

  switch (opts.provider) {
    case 'sqlite': {
      try {
        const { SqliteStorage } = await import('./providers/sqlite/index.js');
        return new SqliteStorage(opts.sqlitePath ?? './data/aimeat.db');
      } catch (err) { sqliteLoadFailed(err); break; }
    }
    case 'postgres-kysely': {
      // The Prisma-free Postgres backend (Phase 5). Cast through unknown: the provider fills the Storage
      // surface domain-by-domain via the prototype merge, so during the migration it satisfies Storage
      // structurally only for the domains already landed (an unimplemented method throws when called).
      const { PostgresKyselyStorage } = await import('./providers/postgres-kysely/index.js');
      const pgk = new PostgresKyselyStorage(opts.dbUrl!);
      await pgk.ready;
      return pgk as unknown as Storage;
    }
    default: {
      try {
        const { SqliteStorage } = await import('./providers/sqlite/index.js');
        return new SqliteStorage(':memory:');
      } catch (err) { sqliteLoadFailed(err); }
    }
  }
}
