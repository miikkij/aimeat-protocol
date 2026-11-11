/**
 * @file scripts/lib/e2e-databases.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which PostgreSQL databases the E2E runs of this repository made, and which of them
 *   nobody needs any more.
 *
 *   WHY. Every worktree gets a database of its own (`aimeat_kysely_e2e_<worktree>`, made by
 *   scripts/test-env-init.ts), every parallel lane of a run one beside it (`<base>_w<n>`,
 *   test/run-e2e-server.ts laneTarget), and every suite that starts its own node one more
 *   (`<run db>_o_<tag>`, test/helpers/own-node-db.ts). Nothing dropped any of them. On 2026-11-11 the
 *   developer's PostgreSQL held 2158 databases, 2143 of them these, and a crash took minutes to
 *   recover because the server walked 2.5 million files.
 *
 *   TWO RULES, both only on names that start with `aimeat_kysely_e2e`:
 *   - A RUN drops the lane and own-node databases it made (runDatabasesOf), keeping its base, which
 *     the next run of the same worktree opens.
 *   - A PRUNE drops every database that belongs to no live worktree of this repository
 *     (orphanDatabases): not a live base, and not a lane, own-node or test database of one. The live
 *     set comes from `git worktree list`, and the database each worktree's env file names; when git
 *     cannot answer, nothing is pruned, because an unknown live set would read every database as an
 *     orphan.
 * @structure E2E_DB_PREFIX · worktreeSlug · baseForWorktree · liveBases · belongsTo · runDatabasesOf ·
 *   orphanDatabases · listE2eDatabases · dropDatabases · adminUrlOf
 * @usage
 *   const bases = liveBases(aimeatDir); if (bases) await dropDatabases(admin, orphanDatabases(await listE2eDatabases(admin), bases));
 * @version-history
 *   v1.0.0 — 2026-11-11 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Every E2E database name starts with this; nothing else is ever touched. */
export const E2E_DB_PREFIX = 'aimeat_kysely_e2e';

/** A directory name as the slug test-env-init writes into the database name. */
export function worktreeSlug(dirName: string): string {
  const slug = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug.slice(0, 40) || 'default';
}

export function baseForWorktree(dirName: string): string {
  return `${E2E_DB_PREFIX}_${worktreeSlug(dirName)}`;
}

/** The database a worktree's .env.test.postgres-kysely names, or null. */
function envDatabaseOf(worktreePath: string): string | null {
  const f = join(worktreePath, 'aimeat', '.env.test.postgres-kysely');
  if (!existsSync(f)) return null;
  const url = /^DATABASE_URL="?([^"\n]+)"?$/m.exec(readFileSync(f, 'utf-8'))?.[1];
  if (!url) return null;
  try { return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch { return null; }
}

/**
 * The base database of every live worktree of the repository `cwd` is in, the shared default
 * (`aimeat_kysely_e2e`, which CI and a copied example name) included. Null when git cannot list the
 * worktrees: the caller then prunes nothing.
 */
export function liveBases(cwd: string): Set<string> | null {
  let listing: string;
  try {
    listing = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const paths = listing.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice('worktree '.length).trim());
  if (paths.length === 0) return null;
  const bases = new Set<string>([E2E_DB_PREFIX]);
  for (const p of paths) {
    bases.add(baseForWorktree(basename(p)));
    const named = envDatabaseOf(p);
    if (named) bases.add(named);
  }
  return bases;
}

/** The suffixes a run or a suite adds to its base: a lane, an own node, a test's own database. */
const DERIVED = /^(_w\d+)?(_o_[a-z0-9_]+|_bootlock|_bkp_src|_bkp_restored|_upg_[a-z]+)?$/;

/** True when `name` is `base` itself or a database made beside it under the full base name. */
function madeBeside(name: string, base: string): boolean {
  if (name === base) return true;
  if (!name.startsWith(base)) return false;
  return DERIVED.test(name.slice(base.length));
}

/**
 * True when `name` may belong to `base`: made beside it, or an own-node database whose name had to
 * shorten the base to stay inside PostgreSQL's 63 characters (own-node-db.ts siblingUrl keeps
 * `<start of the run db>_o_<tag>_<6 hex>`). The shortened form is read generously, so a prune keeps
 * a database any live worktree could own.
 */
export function belongsTo(name: string, base: string): boolean {
  if (madeBeside(name, base)) return true;
  const head = /^(.+)_o_[a-z0-9_]+_[0-9a-f]{6}$/.exec(name)?.[1];
  return !!head && head.length > E2E_DB_PREFIX.length && base.startsWith(head);
}

/**
 * The lane and own-node databases a run on `base` made under its full name, never the base. A
 * shortened own-node name is left to the prune: its start could be another worktree's too. `live`
 * protects every other live worktree whose base starts with this one (worktree `x` and `x-w1` give
 * bases `…_x` and `…_x_w1`, and the second reads like a lane of the first).
 */
export function runDatabasesOf(base: string, names: readonly string[], live: ReadonlySet<string> = new Set()): string[] {
  const longer = [...live].filter(b => b !== base && b.startsWith(base));
  return names.filter(n => n !== base && madeBeside(n, base) && !longer.some(o => madeBeside(n, o)));
}

/** The E2E databases that belong to no live worktree. */
export function orphanDatabases(names: readonly string[], bases: ReadonlySet<string>): string[] {
  return names.filter(n => n.startsWith(E2E_DB_PREFIX) && ![...bases].some(b => belongsTo(n, b)));
}

/** The admin connection for a DATABASE_URL: the same server and account, database `postgres`. */
export function adminUrlOf(dbUrl: string): string {
  const u = new URL(dbUrl);
  u.pathname = '/postgres';
  u.searchParams.delete('schema');
  return u.toString();
}

/** Every database on the server whose name starts with the E2E prefix. */
export async function listE2eDatabases(adminUrl: string): Promise<string[]> {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname', [`${E2E_DB_PREFIX}%`]);
    return rows.map(r => r.datname);
  } finally {
    await client.end();
  }
}

/**
 * Drop each named database, closing its connections first. A database that cannot be dropped is
 * reported in `failed` with its reason, and the rest still go.
 */
export async function dropDatabases(
  adminUrl: string, names: readonly string[],
): Promise<{ dropped: string[]; failed: Array<{ name: string; reason: string }> }> {
  const out = { dropped: [] as string[], failed: [] as Array<{ name: string; reason: string }> };
  if (names.length === 0) return out;
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const name of names) {
      if (!name.startsWith(E2E_DB_PREFIX)) continue;
      try {
        // An identifier cannot be a bound parameter; the name came from pg_database and is quoted.
        await client.query(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}" WITH (FORCE)`);
        out.dropped.push(name);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        out.failed.push({ name, reason: e.code ? `${e.code} ${e.message ?? ''}`.trim() : String(e.message ?? err) });
      }
    }
  } finally {
    await client.end();
  }
  return out;
}
