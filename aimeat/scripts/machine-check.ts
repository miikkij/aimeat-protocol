#!/usr/bin/env tsx
/**
 * @file scripts/machine-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Says what this machine lacks for the repository's tests and gates, and what to run
 *   for each. A report, never a gate: it changes nothing and exits 1 only when a REQUIRED item is
 *   missing (Node, pnpm, this checkout's test env files, the pinned CodeQL).
 *
 *   WHY IT EXISTS. On 2026-10-13 a machine that had never run the test process took four detours
 *   that each needed knowledge from the code: pnpm was not installed and no document said how to get
 *   it, the test env files carried the CI service's PostgreSQL account, `pnpm codeql:install` needed
 *   a signed-in GitHub CLI, and nothing said a port was already another worktree's. The guide is
 *   docs/coding-guidelines/getting-started.md ("A new machine"); this script is its checklist.
 * @structure check(): Line[] per item · main()
 * @usage cd aimeat && pnpm machine:check
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-09, D8-12, P9).
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODEQL_BUNDLE, CODEQL_POINTER } from './inventory/field-reach-facts.js';
import { envPortOf, portConflicts } from './lib/worktree-ports.js';
import { MIN_POSTGRES_MAJOR, TESTED_POSTGRES_MAJORS, postgresMajorOf } from '../src/storage/providers/postgres-kysely/server-version.js';

type Level = 'ok' | 'missing' | 'warn' | 'info';
interface Line { level: Level; what: string; fix?: string }

const AIMEAT = process.cwd();
const ROOT = join(AIMEAT, '..');
const lines: Line[] = [];
const say = (level: Level, what: string, fix?: string): void => { lines.push({ level, what, fix }); };

/** stdout of a command, or null when it does not run. Windows needs the shell to find pnpm.cmd. */
function run(cmd: string, args: string[]): string | null {
  try {
    const opts = { encoding: 'utf-8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] };
    // The arguments are this script's own constants, never input, so one command line is safe.
    return (process.platform === 'win32' ? execSync([cmd, ...args].join(' '), opts) : execFileSync(cmd, args, opts)).trim();
  } catch {
    return null;
  }
}

function checkNode(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 24) say('ok', `Node ${process.versions.node}`);
  else say('missing', `Node ${process.versions.node}; the repository needs 24 or later`, 'Install Node 24 (https://nodejs.org) or `nvm use` (the root .nvmrc names it).');
}

function checkPnpm(): void {
  const pin = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { packageManager?: string }).packageManager ?? '';
  const want = /^pnpm@([\d.]+)/.exec(pin)?.[1];
  const got = run('pnpm', ['--version']);
  if (!got) {
    const corepack = run('corepack', ['--version']);
    say('missing', 'pnpm is not on PATH (the hooks and package scripts call bare `pnpm`)',
      corepack
        ? `\`corepack enable\` puts a pnpm on PATH that runs the pinned ${want} (on Windows it may need an administrator shell). Without that, a two-line shim named pnpm that runs \`corepack pnpm "$@"\` (and pnpm.cmd for Windows child processes) works.`
        : `Install corepack (\`npm install -g corepack\`), then \`corepack enable\`. The pinned version is ${want}.`);
    return;
  }
  if (want && got !== want) say('warn', `pnpm ${got} on PATH; package.json pins ${want}`, '`corepack enable` makes `pnpm` follow the pin.');
  else say('ok', `pnpm ${got}`);
}

function checkGit(): void {
  const name = run('git', ['config', 'user.name']);
  const email = run('git', ['config', 'user.email']);
  if (name && email) say('ok', `git identity ${name} <${email}>`);
  else say('warn', 'git has no user.name or user.email', 'Set them (`git config --global user.name ...`), or pass GIT_AUTHOR_* and GIT_COMMITTER_* per commit.');
  const hooks = run('git', ['config', 'core.hooksPath']);
  if (hooks === '.githooks') say('ok', 'git hooks are on (.githooks)');
  else say('warn', 'the repository hooks are not on', 'Run `pnpm install` at the repository root once: it sets core.hooksPath to .githooks.');
}

async function checkTestEnv(): Promise<void> {
  const sqlite = join(AIMEAT, '.env.test.sqlite');
  const pg = join(AIMEAT, '.env.test.postgres-kysely');
  if (!existsSync(sqlite) || !existsSync(pg)) {
    say('missing', 'this checkout has no .env.test.sqlite / .env.test.postgres-kysely', '`pnpm test:env:init` writes both with a port and a database of this checkout\'s own.');
    return;
  }
  const port = envPortOf(AIMEAT);
  if (port) {
    const { sharedWith, held } = await portConflicts(AIMEAT, port);
    if (sharedWith.length) say('warn', `E2E port ${port} is also named by ${sharedWith.join(', ')}`, 'Claim a free port on the board, then `AIMEAT_E2E_PORT=<port> pnpm test:env:init --force`.');
    else say('ok', `E2E port ${port} is this checkout's alone`);
    if (held) say('info', `port ${port} is held by a running process now (a test server still up?)`);
  }
  await checkPostgres(readFileSync(pg, 'utf8'));
}

async function checkPostgres(envText: string): Promise<void> {
  const url = /^DATABASE_URL="([^"]+)"$/m.exec(envText)?.[1];
  if (!url) { say('warn', 'no DATABASE_URL in .env.test.postgres-kysely', '`pnpm test:env:init --force` writes it.'); return; }
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const v = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    const major = postgresMajorOf(Number(v.rows[0].server_version_num));
    if (major < MIN_POSTGRES_MAJOR) say('warn', `PostgreSQL ${major}; the node supports ${MIN_POSTGRES_MAJOR} and later (tested on ${TESTED_POSTGRES_MAJORS.join(', ')})`, 'Upgrade the server; CI runs postgres:16.');
    else say('ok', `PostgreSQL ${major}${TESTED_POSTGRES_MAJORS.includes(major) ? '' : ` (tested on ${TESTED_POSTGRES_MAJORS.join(', ')})`}`);
    const db = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (db.rows.length) say('ok', `test database ${database} exists`);
    else say('warn', `test database ${database} is missing`, '`pnpm test:env:init` creates the database the env file names.');
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const refused = e.code === '28P01' || e.code === '28000';
    say('warn', `PostgreSQL did not accept the test connection (${e.code ?? e.message ?? String(err)}); only the SQLite suites can run`,
      refused
        ? 'The env file carries the CI service\'s account (appuser:devpassword123). `AIMEAT_TEST_DATABASE_URL=postgresql://<user>:<password>@localhost:5432/x pnpm test:env:init --force` writes yours.'
        : 'Start PostgreSQL 16 or 17 (docker-compose.yml has one), then run this again.');
  } finally {
    await client.end().catch(() => undefined);
  }
}

function checkCodeql(): void {
  try {
    const { cli, version } = JSON.parse(readFileSync(CODEQL_POINTER, 'utf8')) as { cli?: string; version?: string };
    if (cli && existsSync(cli) && version === CODEQL_BUNDLE.version) { say('ok', `CodeQL ${version} (${cli})`); return; }
    say('missing', `CodeQL is registered at ${version ?? '?'}, not the pinned ${CODEQL_BUNDLE.version}; \`pnpm check:fast\` refuses without it`, '`pnpm codeql:install` downloads the pinned bundle over HTTPS (about 660 MB, no GitHub CLI needed), or `--from <codeql executable>` registers one already on disk.');
  } catch {
    say('missing', `CodeQL ${CODEQL_BUNDLE.version} is not installed; \`pnpm check:fast\` refuses without it`, '`pnpm codeql:install` downloads the pinned bundle over HTTPS (about 660 MB, no GitHub CLI needed), or `--from <codeql executable>` registers one already on disk.');
  }
}

function checkOptional(): void {
  const pwDir = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright')
    : join(homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache', 'ms-playwright');
  if (existsSync(pwDir)) say('ok', 'Playwright browsers are installed');
  else say('info', 'no Playwright browsers (only the browser verification needs them)', '`pnpm exec playwright install chromium` when you need one.');
  if (run('gh', ['--version'])) say('ok', 'GitHub CLI is installed');
  else say('info', 'no GitHub CLI: `pnpm ci:stats` cannot read CI runs (nothing else needs it)');
}

async function main(): Promise<void> {
  checkNode();
  checkPnpm();
  checkGit();
  await checkTestEnv();
  checkCodeql();
  checkOptional();
  const mark: Record<Level, string> = { ok: '✓', missing: '✗', warn: '!', info: '·' };
  console.log('\nThis machine, for the AIMEAT tests and gates:\n');
  for (const l of lines) {
    console.log(`  ${mark[l.level]} ${l.what}`);
    if (l.fix && l.level !== 'ok') console.log(`      → ${l.fix}`);
  }
  const missing = lines.filter(l => l.level === 'missing').length;
  console.log(missing ? `\n${missing} required item(s) missing. docs/coding-guidelines/getting-started.md, "A new machine", has the whole path.\n` : '\nNothing required is missing.\n');
  process.exitCode = missing ? 1 : 0;
}

void main();
