/**
 * @file scripts/check-config-coverage.ts
 * @description The gate that keeps the admin Config tab honest: every AIMEAT_* environment variable
 *   the node READS must have a row in CONFIG_FIELDS, or an exemption that says why it cannot.
 *
 *   WHY. The Config tab is built from CONFIG_FIELDS, so a setting that never got a row is invisible
 *   there — not read-only, not greyed out, absent. An operator looking for it concludes the node
 *   cannot do the thing, and the only way to discover otherwise is to read src/config.ts. That is
 *   how fourteen AI settings ended up .env-and-restart only: the key that decides what the node
 *   SPENDS could not be seen, let alone changed, from the surface built for exactly that.
 *
 *   THE SEEDED BACKLOG, AND WHY IT CAN ONLY SHRINK. There were 145 uncovered variables the day this
 *   was written. Failing on all of them would have made the gate unmergeable and it would have been
 *   turned off, so the existing set is seeded as exemptions and the gate refuses anything NEW. Every
 *   entry is a debt with an owner-less reason, and the honest move when you touch a variable's area
 *   is to give it a row and delete its line here.
 *
 *   IT ALSO CATCHES THE REVERSE, which is the failure the first version of this idea would have had:
 *   an exemption for a variable that no longer exists (dead weight that makes the backlog look worse
 *   than it is), and an exemption for a variable that HAS since been covered (a line that would
 *   otherwise sit there forever hiding the win).
 * @structure
 *   - envVarsRead(): AIMEAT_* names read via process.env in src/config*.ts
 *   - schemaEnvVars(): envVar values declared in CONFIG_FIELDS
 *   - main(): compare against security/config-coverage-exemptions.json; --strict exits 1
 * @usage
 *   cd aimeat && pnpm check:config-coverage            # report
 *   cd aimeat && pnpm check:config-coverage --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:config-coverage --seed     # rewrite the exemption file from today
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial, with the AI group as the first fourteen it would have caught.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CONFIG_DIR = join(ROOT, 'src');
const SCHEMA = join(ROOT, 'src', 'services', 'config-schema.ts');
const EXEMPTIONS = join(ROOT, 'security', 'config-coverage-exemptions.json');

const STRICT = process.argv.includes('--strict');
const SEED = process.argv.includes('--seed');

const SEED_REASON = 'Seeded backlog 2026-08-16: read by the node, not exposed in the admin Config tab. Give it a CONFIG_FIELDS row when you next work in its area, and delete this line.';

interface ExemptionFile {
  /** What this file is, for whoever opens it first. */
  _doc: string;
  /** env var name → why it has no CONFIG_FIELDS row. */
  exempt: Record<string, string>;
}

/** Every AIMEAT_* variable the config layer reads. The config files are the only place that counts:
 *  a variable read somewhere else is not node configuration, it is that module's own switch. */
function envVarsRead(): Set<string> {
  const files = readdirSync(CONFIG_DIR)
    .filter(f => f === 'config.ts' || (f.startsWith('config-') && f.endsWith('.ts')))
    .map(f => join(CONFIG_DIR, f));
  const found = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/process\.env\.(AIMEAT_[A-Z0-9_]+)/g)) found.add(m[1] as string);
    // The bracket form reads a name built at runtime; it cannot be resolved statically and is not
    // node configuration in the sense this gate is about.
  }
  return found;
}

function schemaEnvVars(): Set<string> {
  const src = readFileSync(SCHEMA, 'utf-8');
  const found = new Set<string>();
  for (const m of src.matchAll(/envVar:\s*'([A-Z0-9_]+)'/g)) found.add(m[1] as string);
  return found;
}

function readExemptions(): ExemptionFile {
  if (!existsSync(EXEMPTIONS)) return { _doc: '', exempt: {} };
  return JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile;
}

function main(): void {
  const read = envVarsRead();
  const covered = schemaEnvVars();

  if (read.size === 0 || covered.size === 0) {
    console.error('[check:config-coverage] parsed 0 entries — the shape of src/config.ts or config-schema.ts changed, so this gate is checking nothing. Fix the patterns.');
    process.exit(1);
  }

  const uncovered = [...read].filter(v => !covered.has(v)).sort();

  if (SEED) {
    const file: ExemptionFile = {
      _doc: 'Environment variables the node reads that have no row in CONFIG_FIELDS, so they cannot be seen or changed in the admin Config tab. This list may only shrink: `pnpm check:config-coverage --strict` fails on any NEW uncovered variable, on an entry for a variable that no longer exists, and on an entry that has since been covered.',
      exempt: Object.fromEntries(uncovered.map(v => [v, SEED_REASON])),
    };
    writeFileSync(EXEMPTIONS, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    console.log(`Seeded ${uncovered.length} exemption(s) into security/config-coverage-exemptions.json`);
    return;
  }

  const { exempt } = readExemptions();
  const exemptNames = Object.keys(exempt);

  const fresh = uncovered.filter(v => !(v in exempt));
  const nowCovered = exemptNames.filter(v => covered.has(v)).sort();
  const gone = exemptNames.filter(v => !read.has(v)).sort();

  console.log('\n  Every setting the node reads, reachable in the admin Config tab');
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log(`  variables read                   ${String(read.size).padStart(4)}`);
  console.log(`  with a Config-tab row            ${String([...read].filter(v => covered.has(v)).length).padStart(4)}`);
  console.log(`  exempt (seeded backlog)          ${String(uncovered.length - fresh.length).padStart(4)}`);
  console.log(`  NEW, not exempt                  ${String(fresh.length).padStart(4)}`);
  console.log(`  exemptions now covered           ${String(nowCovered.length).padStart(4)}`);
  console.log(`  exemptions for dead variables    ${String(gone.length).padStart(4)}`);

  if (fresh.length > 0) {
    console.error('\n  Read by the node, invisible in the admin Config tab:\n');
    for (const v of fresh) console.error(`    ${v}`);
    console.error('\n  Add a CONFIG_FIELDS row in src/services/config-schema.ts (adminDisplay: \'configured\'');
    console.error('  for a secret, \'hidden\' for a bootstrap value), or an entry in');
    console.error('  security/config-coverage-exemptions.json WITH the reason it cannot have one.\n');
  }
  if (nowCovered.length > 0) {
    console.log('\n  Now covered, so these entries can go from the exemption file:\n');
    for (const v of nowCovered) console.log(`    ${v}`);
    console.log('');
  }
  if (gone.length > 0) {
    console.error('\n  Exemptions for variables the node no longer reads (delete them):\n');
    for (const v of gone) console.error(`    ${v}`);
    console.error('');
  }

  const bad = fresh.length + nowCovered.length + gone.length;
  if (bad === 0) {
    console.log('\n  ✓ no setting is unreachable that was not already known\n');
    return;
  }
  if (STRICT) process.exit(1);
}

main();
