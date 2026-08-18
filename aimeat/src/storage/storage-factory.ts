/**
 * @file src/storage/storage-factory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage backend factory — lazily imports and instantiates the requested Storage
 *   provider (PostgreSQL+Kysely or SQLite; default in-memory SQLite), and printing actionable
 *   guidance if the SQLite native bindings fail to load. The removed Prisma backends (mongodb,
 *   legacy postgresql) fail fast with migration guidance instead of silently falling through.
 *
 * @structure
 *   - createStorage(opts): resolves a Storage instance for the chosen provider
 *   - openSqlite(path): imports the provider, then constructs it, reporting the two failures apart
 *   - sqliteLoadFailed(err): prints fix guidance and exits when better-sqlite3 bindings fail
 *   - sqliteOpenFailed(err): prints the full stack and exits when the DATABASE or schema fails
 *   - StorageProvider / StorageOptions: provider union and factory input types
 *
 * @version-history
 *   v2.1.0 — 2026-08-13 — A schema failure no longer reports itself as broken native bindings. One
 *     try wrapped the import AND the constructor and printed only the first line of the message, so
 *     a node that could not boot was told to rebuild better-sqlite3. The constructor path now prints
 *     the whole stack, which names the failing statement.
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

/** The `import()` itself failed: wrong ABI, missing toolchain, half-finished install. */
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

/**
 * The module loaded and the constructor threw — a database or schema failure, which the bindings
 * guidance above sends the reader to fix with a rebuild that cannot fix it. Print the whole stack:
 * the failing statement and the schema function that ran it are in it, and the first line alone
 * ("no such column: principal") names neither.
 */
function sqliteOpenFailed(err: unknown): never {
  console.error('\n\x1b[31m[AIMEAT] SQLite storage failed to open:\x1b[0m');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  console.error('\n\x1b[33mThe native bindings loaded, so this is the database file or its schema.\x1b[0m');
  console.error('  The stack above names the failing statement. Schema-upgrade traps are catalogued');
  console.error('  in docs/pitfalls.md.\n');
  process.exit(1);
}

/**
 * Open SQLite, keeping the two failure modes apart. One `try` around both was how a schema crash on
 * an upgraded node reported itself as broken native bindings for the better part of a diagnosis.
 */
async function openSqlite(path: string): Promise<Storage> {
  let mod: typeof import('./providers/sqlite/index.js');
  try {
    mod = await import('./providers/sqlite/index.js');
  } catch (err) { sqliteLoadFailed(err); }
  try {
    return new mod.SqliteStorage(path);
  } catch (err) { sqliteOpenFailed(err); }
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
    case 'sqlite':
      return openSqlite(opts.sqlitePath ?? './data/aimeat.db');
    case 'postgres-kysely': {
      // The Prisma-free Postgres backend (Phase 5). Cast through unknown: the provider fills the Storage
      // surface domain-by-domain via the prototype merge, so during the migration it satisfies Storage
      // structurally only for the domains already landed (an unimplemented method throws when called).
      const { PostgresKyselyStorage } = await import('./providers/postgres-kysely/index.js');
      const pgk = new PostgresKyselyStorage(opts.dbUrl!);
      await pgk.ready;
      return pgk as unknown as Storage;
    }
    default:
      return openSqlite(':memory:');
  }
}
