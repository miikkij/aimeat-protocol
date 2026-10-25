/**
 * @file scripts/check-config-coverage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate that keeps the admin Config tab honest: every AIMEAT_* environment variable
 *   the node's code READS, anywhere under src/, has a row in CONFIG_FIELDS, or an exemption that says
 *   why it is not a setting of this node. And a setting the operator can change on the Config tab is
 *   read from the config, never straight from process.env, because the value saved there lives in the
 *   database and process.env does not have it.
 *
 *   WHY. The Config tab is built from CONFIG_FIELDS, so a setting that never got a row is invisible
 *   there — not read-only, not greyed out, absent. An operator looking for it concludes the node
 *   cannot do the thing, and the only way to discover otherwise is to read the code. That is how
 *   fourteen AI settings ended up .env-and-restart only (2026-08-16), and how 145 more did.
 *
 *   WHY ALL OF src/. Until 2026-10-25 this read only src/config*.ts, on the theory that a variable
 *   read anywhere else was "that module's own switch". Nine node settings had grown there unseen (the
 *   usage meter's six, the tally buffer, the proxy trust, the log level), and the first-run setup
 *   wrote AIMEAT_LOCALE into .env when no code read it. Now every read counts, and a name that is
 *   not a setting of this node (a variable of the `aimeat connect` program on a person's own
 *   computer, a value a process hands its own child) says so in the exemption file.
 *
 *   THE EXEMPTION FILE HOLDS ANSWERS ONLY. The seeded backlog of 2026-08-16 is gone: every entry is a
 *   sentence saying why that name has no row, and an entry that still carries the seed's placeholder
 *   fails. A new entry is a decision for the developer (.claude/rules/gates-ratchets.md).
 *
 *   IT ALSO CATCHES THE REVERSE: an exemption for a variable that no longer exists, and one for a
 *   variable that has since been covered.
 * @structure
 *   - namesRead(): every AIMEAT_* name read under src/, with where
 *   - main(): rows, exemptions and direct reads of changeable settings; --strict exits 1
 * @usage
 *   cd aimeat && pnpm check:config-coverage            # report
 *   cd aimeat && pnpm check:config-coverage --strict   # the CI gate
 * @version-history
 *   v2.0.0 — 2026-10-25 — Reads all of src/, in the three forms a name is read (process.env.X,
 *     process.env['X'], a helper given 'X'); refuses a seeded placeholder; refuses a changeable
 *     setting read from process.env outside the config loader. --seed is gone: re-seeding forgave the
 *     whole backlog, and the backlog is empty.
 *   v1.1.0 — 2026-09-28 — Reads the row groups config-schema.ts spreads in (config-schema-*.ts) too.
 *   v1.0.0 — 2026-08-16 — Initial, with the AI group as the first fourteen it would have caught.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CONFIG_FIELDS } from '../src/services/config-schema.js';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const EXEMPTIONS = join(ROOT, 'security', 'config-coverage-exemptions.json');
const STRICT = process.argv.includes('--strict');
/** The placeholder the 2026-08-16 seeding wrote: a question, not an answer. */
const SEED_MARK = 'Seeded backlog';

interface ExemptionFile {
  /** What this file is, for whoever opens it first. */
  _doc: string;
  /** env var name → why it has no CONFIG_FIELDS row. */
  exempt: Record<string, string>;
}

/** The three forms a name is read in. The third is a helper handed the name: daysFromEnv('AIMEAT_X'). */
const DIRECT = [/process\.env\.(AIMEAT_[A-Z0-9_]+)/g, /process\.env\[\s*['"`](AIMEAT_[A-Z0-9_]+)['"`]\s*\]/g];
const BY_NAME = /\(\s*['"`](AIMEAT_[A-Z0-9_]+)['"`]/g;

/** The files that declare rows rather than read settings. */
const isSchemaFile = (rel: string): boolean => /^src\/services\/config-(schema|field-def)[^/]*\.ts$/.test(rel);
/** The config loader: reading process.env is its job, before the database layer is applied. */
const isLoader = (rel: string): boolean => /^src\/config[^/]*\.ts$/.test(rel);
/**
 * A changeable setting read from process.env before any config exists, with the reason. An answer,
 * not a backlog: each one is set from the config as soon as there is one.
 */
const BOOTSTRAP_READS: Record<string, string> = {
  'src/utils/logger.ts AIMEAT_LOG_LEVEL': 'the logger exists before the config; setLogLevel() applies node.log_level once the config is built and after every save',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

interface Site { rel: string; line: number; direct: boolean }

function namesRead(): Map<string, Site[]> {
  const found = new Map<string, Site[]>();
  const add = (name: string, site: Site): void => { const s = found.get(name) ?? []; s.push(site); found.set(name, s); };
  for (const file of sourceFiles(SRC)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (isSchemaFile(rel)) continue;
    readFileSync(file, 'utf-8').split('\n').forEach((text, i) => {
      for (const re of DIRECT) for (const m of text.matchAll(re)) add(m[1] as string, { rel, line: i + 1, direct: true });
      for (const m of text.matchAll(BY_NAME)) add(m[1] as string, { rel, line: i + 1, direct: false });
    });
  }
  return found;
}

function readExemptions(): ExemptionFile {
  if (!existsSync(EXEMPTIONS)) return { _doc: '', exempt: {} };
  return JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile;
}

function section(title: string, lines: string[], fix: string, problems: string[]): void {
  if (lines.length === 0) return;
  problems.push(`\n  ✖ ${title} (${lines.length})\n${lines.map(l => `      ${l}`).join('\n')}\n    → ${fix}`);
}

function main(): void {
  const read = namesRead();
  const rows = new Map(CONFIG_FIELDS.map(f => [f.envVar, f]));
  if (read.size === 0 || rows.size === 0) {
    console.error('[check:config-coverage] parsed 0 entries — the shape of src/ or CONFIG_FIELDS changed, so this gate is checking nothing. Fix the patterns.');
    process.exit(1);
  }
  const { exempt } = readExemptions();
  const names = [...read.keys()].sort();
  const uncovered = names.filter(v => !rows.has(v));
  const problems: string[] = [];

  section('Read by the node, invisible on the admin Config tab', uncovered.filter(v => !(v in exempt)).map(v => {
    const s = read.get(v)![0]!;
    return `${v}   (${s.rel}:${s.line})`;
  }), 'add a CONFIG_FIELDS row (adminDisplay \'configured\' for a secret; immutable or applies: \'restart\' for one the code reads at start), or, when it is not a setting of this node, an exemption that says why', problems);

  section('Exemptions that are still the seeding\'s question', Object.entries(exempt).filter(([, r]) => r.startsWith(SEED_MARK)).map(([v]) => v),
    'give the variable a CONFIG_FIELDS row and delete the entry, or replace the placeholder with the reason it has none', problems);
  section('Exemptions for variables that now have a row', Object.keys(exempt).filter(v => rows.has(v)).sort(), 'delete the entry', problems);
  section('Exemptions for variables nothing reads', Object.keys(exempt).filter(v => !read.has(v)).sort(), 'delete the entry', problems);
  section('BOOTSTRAP_READS entries that no longer match a read', Object.keys(BOOTSTRAP_READS).filter(k => {
    const [rel, v] = k.split(' ');
    return !(read.get(v as string) ?? []).some(s => s.direct && s.rel === rel);
  }), 'delete the entry in scripts/check-config-coverage.ts', problems);

  // A setting the Config tab changes is stored in the database. Code that reads its variable
  // straight from process.env runs with the environment's value whatever was saved.
  const direct: string[] = [];
  for (const [v, sites] of read) {
    const row = rows.get(v);
    if (!row || row.immutable) continue;
    for (const s of sites) {
      if (!s.direct || isLoader(s.rel) || `${s.rel} ${v}` in BOOTSTRAP_READS) continue;
      direct.push(`${s.rel}:${s.line}  ${v} (${row.dotPath})`);
    }
  }
  section('Changeable settings read straight from process.env, so a value saved on the Config tab is ignored there', direct,
    `read the config field (config.${'<key>'}) instead; the loader in src/config*.ts is the one place that reads the environment`, problems);

  const exemptRead = uncovered.filter(v => v in exempt).length;
  console.log('\n  Every setting the node reads, reachable on the admin Config tab');
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log(`  names read under src/            ${String(names.length).padStart(4)}`);
  console.log(`  with a Config-tab row            ${String(names.length - uncovered.length).padStart(4)}`);
  console.log(`  not a setting of this node       ${String(exemptRead).padStart(4)}   (security/config-coverage-exemptions.json, a reason each)`);
  console.log(`  stored in the database           ${String(CONFIG_FIELDS.filter(f => !f.immutable).length).padStart(4)}   of ${CONFIG_FIELDS.length} rows`);

  if (problems.length === 0) {
    console.log('\n  ✓ every setting the node reads has a row, and every changeable one is read from the config\n');
    return;
  }
  console.error(problems.join('\n') + '\n');
  if (STRICT) process.exit(1);
}

main();
