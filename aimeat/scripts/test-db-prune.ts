#!/usr/bin/env tsx
/**
 * @file scripts/test-db-prune.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Drops the E2E databases on this machine's PostgreSQL that belong to no live worktree
 *   of this repository: a removed worktree's base, its lanes and its own-node databases. Only names
 *   that start with `aimeat_kysely_e2e` are ever touched, and when git cannot list the worktrees
 *   nothing is dropped (scripts/lib/e2e-databases.ts says why). scripts/test-env-init.ts runs the
 *   same prune every time a worktree is set up, so the number stays near the number of worktrees.
 *
 *   The server and account come from DATABASE_URL, else from this checkout's
 *   .env.test.postgres-kysely.
 * @usage cd aimeat && pnpm test:db:prune            (drops)
 *        cd aimeat && pnpm test:db:prune --dry      (lists what it would drop)
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial: 2143 leftover E2E databases had filled the developer's PostgreSQL.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminUrlOf, dropDatabases, listE2eDatabases, liveBases, orphanDatabases } from './lib/e2e-databases.js';

/** DATABASE_URL from the environment, else from this checkout's Postgres env file. */
export function databaseUrl(aimeatDir: string): string | null {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const f = resolve(aimeatDir, '.env.test.postgres-kysely');
  if (!existsSync(f)) return null;
  return /^DATABASE_URL="?([^"\n]+)"?$/m.exec(readFileSync(f, 'utf-8'))?.[1] ?? null;
}

/**
 * Drop the orphaned E2E databases. Returns what was dropped, or null when nothing could be decided
 * (no database URL, or git could not list the worktrees).
 */
export async function pruneE2eDatabases(
  aimeatDir: string, opts: { dry?: boolean; log?: (line: string) => void } = {},
): Promise<{ orphans: string[]; dropped: string[]; failed: Array<{ name: string; reason: string }> } | null> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const url = databaseUrl(aimeatDir);
  if (!url) { log('  no DATABASE_URL and no .env.test.postgres-kysely: nothing to prune'); return null; }
  const bases = liveBases(aimeatDir);
  if (!bases) { log('  git could not list the worktrees, so nothing is pruned'); return null; }
  const admin = adminUrlOf(url);
  const orphans = orphanDatabases(await listE2eDatabases(admin), bases);
  if (opts.dry) return { orphans, dropped: [], failed: [] };
  const { dropped, failed } = await dropDatabases(admin, orphans);
  return { orphans, dropped, failed };
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const out = await pruneE2eDatabases(process.cwd(), { dry });
  if (!out) { process.exitCode = 1; return; }
  if (dry) {
    for (const n of out.orphans) console.log(`  would drop ${n}`);
    console.log(`\n${out.orphans.length} E2E database(s) belong to no live worktree.`);
    return;
  }
  console.log(`Dropped ${out.dropped.length} E2E database(s) that belonged to no live worktree.`);
  for (const f of out.failed) console.error(`  could not drop ${f.name}: ${f.reason}`);
  if (out.failed.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('test-db-prune.ts')) {
  main().catch((err) => {
    const e = err as { code?: string; message?: string };
    console.error(`test:db:prune failed: ${e.code ? `${e.code} ` : ''}${e.message ?? String(err)}`);
    process.exitCode = 1;
  });
}
