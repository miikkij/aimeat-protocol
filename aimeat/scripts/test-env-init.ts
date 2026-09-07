#!/usr/bin/env tsx
/**
 * @file scripts/test-env-init.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes THIS worktree's `.env.test.sqlite` and `.env.test.postgres-kysely` from the
 *   committed examples, with a port and a Postgres database that belong to this worktree alone,
 *   and creates that database if it is not there.
 *
 *   WHY IT EXISTS. Every session is supposed to run its E2E on its own port, and the claims board
 *   has a field for it — but nothing carried the claim into the test environment. A worktree is set
 *   up by copying `.env.test.*.example`, and the examples shipped `AIMEAT_PORT=40251` and the one
 *   database name `aimeat_kysely_e2e`. Measured 2026-09-07 across four worktrees: three still had
 *   40251, and ALL FOUR had the same Postgres database. That is worse than a port clash, because
 *   the runner EMPTIES that database between suites — two sessions running Postgres E2E at the same
 *   time do not interleave, they wipe each other, and the loser reads it as a defect in their own
 *   diff. One session lost a comparison tree and twenty minutes to it; another spent a night
 *   attributing a neighbour's `pnpm gate` to their own parallel runs.
 *
 *   A rule nobody can follow by accident is not a rule. This makes the isolated case the default
 *   one, so a session gets it by running the setup rather than by remembering to hand-edit two
 *   files and knowing that two different variables name the same port.
 * @structure slugOf · portFor · render · ensureDatabase · main
 * @usage cd aimeat && pnpm test:env:init            (refuses to overwrite an existing file)
 *        cd aimeat && pnpm test:env:init --force    (rewrites them)
 *        AIMEAT_E2E_PORT=40282 pnpm test:env:init   (take the port your claim names)
 * @version-history
 *   v1.0.0 — 2026-09-07 — Written for the incident "Kaksi E2E-ajoa samaan aikaan turmelee toistensa
 *     tulokset molempiin suuntiin".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const FORCE = process.argv.includes('--force');
const AIMEAT_DIR = process.cwd();

/**
 * This worktree's name, as a slug a Postgres identifier accepts. The aimeat/ directory sits inside
 * the worktree, so the name is its parent's: `.worktrees/cc-jouni-dm` → `cc_jouni_dm`. The shared
 * checkout resolves to the repository's own name, which is correct — it is one worktree like any
 * other and wants its own database as much as the rest.
 */
function slugOf(): string {
  const worktree = basename(dirname(AIMEAT_DIR));
  const slug = worktree.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug.slice(0, 40) || 'default';
}

/**
 * A port this worktree can have to itself, derived from its name so it is the SAME on every run —
 * a port that moved between runs would be no better than a shared one for anybody reading a claim.
 * 40251 upward is what the claims board hands out; 40050 (the dev server) and 40500-40599 (the
 * runner's lanes) are outside it by construction.
 *
 * An explicit AIMEAT_E2E_PORT wins, and that is the one to use: the board is the authority on who
 * holds what, and a hash cannot read it. This is the sensible default for a session that has not
 * claimed one yet, not a substitute for claiming.
 */
function portFor(slug: string): number {
  const explicit = Number(process.env.AIMEAT_E2E_PORT);
  if (Number.isInteger(explicit) && explicit >= 40251 && explicit <= 40499) return explicit;
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 40251 + (h % 140); // 40251-40390, clear of the dev server and of the lane range
}

/** The example, with this worktree's port and database written into it. */
function render(example: string, port: number, database: string | null): string {
  let out = example.replace(/^AIMEAT_PORT=\d+$/m, `AIMEAT_PORT=${port}`);

  // BOTH VARIABLES, because two different things read them and they disagreed. The server binds
  // AIMEAT_PORT; scripts/kill-test-servers.ts (prepended to every test:e2e:* script) read only
  // AIMEAT_TEST_PORT and otherwise assumed 40251, so a session that set one of them killed a
  // neighbour's server on every `pnpm gate`. The script honours AIMEAT_PORT now, and writing both
  // means an older checkout of it behaves too.
  out = out.replace(/^AIMEAT_PORT=(\d+)$/m, `AIMEAT_PORT=$1\nAIMEAT_TEST_PORT=$1`);

  if (database) {
    out = out.replace(/\/aimeat_kysely_e2e\?/, `/${database}?`);
  }
  return `# Written by scripts/test-env-init.ts for this worktree. Re-run it with --force to refresh.\n`
    + `# The port and the database are this worktree's own — see the header of that script for why.\n`
    + out;
}

/** Create the database if it is not there. Connects to `postgres`, because you cannot create the one you are in. */
async function ensureDatabase(url: string, database: string): Promise<void> {
  const { Client } = await import('pg');
  const admin = new Client({ connectionString: url.replace(/\/[^/?]+(\?|$)/, '/postgres$1') });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rows.length > 0) {
      console.log(`  database ${database} is already there`);
      return;
    }
    // The name is derived from a directory name and passed through slugOf, so it carries only
    // [a-z0-9_] — but an identifier cannot be a bound parameter, so it is quoted rather than trusted.
    await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    console.log(`  created database ${database}`);
  } finally {
    await admin.end();
  }
}

async function main(): Promise<void> {
  const slug = slugOf();
  const port = portFor(slug);
  const database = `aimeat_kysely_e2e_${slug}`;

  console.log(`\nWorktree ${slug}\n  port     ${port}\n  database ${database}\n`);

  const files: Array<{ example: string; target: string; db: string | null }> = [
    { example: '.env.test.sqlite.example', target: '.env.test.sqlite', db: null },
    { example: '.env.test.postgres-kysely.example', target: '.env.test.postgres-kysely', db: database },
  ];

  let wrote = 0;
  for (const f of files) {
    const examplePath = resolve(AIMEAT_DIR, f.example);
    const targetPath = resolve(AIMEAT_DIR, f.target);
    if (!existsSync(examplePath)) {
      console.error(`  ${f.example} is missing — nothing to write ${f.target} from.`);
      process.exitCode = 1;
      return;
    }
    if (existsSync(targetPath) && !FORCE) {
      console.log(`  ${f.target} exists, left alone (--force to rewrite)`);
      continue;
    }
    writeFileSync(targetPath, render(readFileSync(examplePath, 'utf-8'), port, f.db), 'utf-8');
    console.log(`  wrote ${f.target}`);
    wrote++;
  }

  // The sqlite database is a relative path inside this worktree and needs nothing. The Postgres one
  // is a name on a shared server, so it has to exist before a suite asks for it.
  const written = readFileSync(resolve(AIMEAT_DIR, '.env.test.postgres-kysely'), 'utf-8');
  const url = /^DATABASE_URL="([^"]+)"$/m.exec(written)?.[1];
  if (!url) {
    console.error('  no DATABASE_URL in .env.test.postgres-kysely — cannot create the database');
    process.exitCode = 1;
    return;
  }
  try {
    await ensureDatabase(url, database);
  } catch (err) {
    // NAMED, not summarised. node-postgres carries the reason in `code` and leaves `message` EMPTY
    // for the connection failures — a first run of this printed "could not create X: " with nothing
    // after the colon, which is the same swallowed-exception shape this repo keeps finding. The
    // code is what says whether Postgres is down (ECONNREFUSED), the password is wrong (28P01) or
    // the role is missing (28000).
    const e = err as { code?: string; message?: string };
    const why = e.code ? `${e.code}${e.message ? ': ' + e.message : ''}` : String(e.message || err);
    console.error(`  could not create ${database} — ${why}`);
    if (e.code === 'ECONNREFUSED') {
      console.error('  Postgres is not answering on that address. The env files ARE written and the');
      console.error('  sqlite side works; start Postgres and run this again, or create it by hand:');
    } else {
      console.error('  The env files are written. Create the database yourself with:');
    }
    console.error(`    createdb ${database}`);
    process.exitCode = 1;
    return;
  }

  console.log(wrote > 0
    ? '\nDone. Claim this port on the board before you run anything.\n'
    : '\nNothing rewritten. --force if you meant to.\n');
}

void main();
