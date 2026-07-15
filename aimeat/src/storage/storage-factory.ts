/**
 * @file src/storage/storage-factory.ts
 * @description Storage backend factory — lazily imports and instantiates the requested Storage
 *   provider (SQLite / MongoDB / PostgreSQL, default in-memory SQLite), awaiting readiness for the
 *   Prisma backends and printing actionable guidance if the SQLite native bindings fail to load.
 *
 * @structure
 *   - createStorage(opts): resolves a Storage instance for the chosen provider
 *   - sqliteLoadFailed(err): prints fix guidance and exits when better-sqlite3 bindings fail
 *   - StorageProvider / StorageOptions: provider union and factory input types
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Storage } from './interface.js';

export type StorageProvider = 'memory' | 'sqlite' | 'mongodb' | 'postgresql' | 'postgres-kysely';

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
  console.error('  2. Use MongoDB instead:     aimeat start --db mongodb --db-url mongodb://localhost:27017/aimeat');
  console.error('  3. Reinstall from scratch:   npm install -g aimeat\n');
  process.exit(1);
}

export async function createStorage(opts: StorageOptions): Promise<Storage> {
  switch (opts.provider) {
    case 'sqlite': {
      try {
        const { SqliteStorage } = await import('./providers/sqlite/index.js');
        return new SqliteStorage(opts.sqlitePath ?? './data/aimeat.db');
      } catch (err) { sqliteLoadFailed(err); break; }
    }
    case 'mongodb': {
      const { MongoStorage } = await import('./providers/mongodb/index.js');
      const mongo = new MongoStorage(opts.dbUrl!);
      await mongo.ready;
      return mongo;
    }
    case 'postgresql': {
      const { PostgresStorage } = await import('./providers/postgres/index.js');
      const pg = new PostgresStorage(opts.dbUrl!);
      await pg.ready;
      return pg;
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
