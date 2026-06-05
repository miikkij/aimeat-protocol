/**
 * @file postgres/index.ts
 * @description PostgreSQL-backed Storage implementation. A thin subclass of
 *   {@link PrismaStorage} (defined in ../mongodb/index.ts) that reuses the entire
 *   Prisma query layer and only overrides which schema + generated client it loads:
 *   `schema.postgres.prisma` and the custom-output client at
 *   `src/generated/prisma-postgres`. This lets a single build run on MongoDB or
 *   PostgreSQL by selecting the backend at startup.
 * @structure PostgresStorage extends PrismaStorage — overrides schemaFileName()
 *   and prismaClientSpecifier(); all CRUD logic is inherited.
 * @usage new PostgresStorage(databaseUrl) — databaseUrl is a postgresql:// URL.
 *   Generate the client first: `pnpm db:generate:postgres`.
 * @version-history
 *   v1.0.0 — 2026-06-05 — Initial PostgreSQL storage backend (reuses PrismaStorage).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaStorage } from '../mongodb/index.js';

export class PostgresStorage extends PrismaStorage {
    protected schemaFileName(): string { return 'schema.postgres.prisma'; }

    protected prismaClientSpecifier(): string {
        // Resolve the custom-output Postgres client by absolute path so it works
        // both in tsx-dev (under src/) and after build (under dist/src/).
        //   dev:  src/storage/providers/postgres        -> src/generated/prisma-postgres
        //   prod: dist/src/storage/providers/postgres   -> dist/src/generated/prisma-postgres
        // Return a file:// URL — `import()` of a bare absolute path fails on Windows
        // (a drive letter like "e:" is parsed as an unsupported URL scheme).
        const here = dirname(fileURLToPath(import.meta.url));
        const clientEntry = resolve(here, '../../../generated/prisma-postgres/index.js');
        return pathToFileURL(clientEntry).href;
    }
}
