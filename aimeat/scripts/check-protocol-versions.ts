/**
 * @file check-protocol-versions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The protocol register's gate. Every external protocol this node speaks, the version
 *   we declare, the version that is current, and the day somebody last looked.
 *
 *   WHY A GATE AND NOT A DOCUMENT. On 2026-09-04 a capability audit of this node's MCP and A2A
 *   surfaces was wrong three times in one afternoon: it reported that the MCP v2 SDK did not exist
 *   (it does — a package SPLIT rather than a version bump, so looking at the old package name found
 *   nothing), that four A2A task states were unreachable (all eight were produced), and that task
 *   results carried no artifacts (they did). Each was a guess in a place a checked date would have
 *   been an answer. The same afternoon an outside scanner, not us, found that we were declaring an
 *   MCP revision two versions behind. A document would have recorded that once and gone quiet.
 *
 *   THREE THINGS IT ASKS, and only the first two can fail a commit:
 *
 *     1. DOES THE LEDGER STILL DESCRIBE THE CODE. `weDeclare` is checked against every place the
 *        version is actually written. MCP's revision string appears in TWO files, and this repo has
 *        spent the week paying for facts written down twice, so both are checked and both must
 *        agree. Bumping a version without the ledger, or the other way round, fails here.
 *
 *     2. HAS ANYBODY LOOKED LATELY. A triaged entry goes stale after `maxAgeDays`. This is the
 *        whole point: the failure arrives on a schedule rather than when an outsider notices.
 *
 *     3. HOW MUCH IS UNTRIAGED. Counted and listed, never failed on. An untriaged entry is a
 *        question nobody has answered, and failing every commit until somebody reads fourteen specs
 *        would get the file re-seeded rather than read. It leaves that state one at a time.
 *
 *   RE-SEEDING IS NOT MAINTENANCE. Setting every `verifiedOn` to today forgives the whole list, and
 *   the list is the only thing standing between us and the next wrong answer. Re-verify one entry,
 *   write what you found in its note, and move its date.
 * @structure loadLedger() → readDeclared() → three checks → main() prints all findings, exits 1 on
 *   a drift or a stale entry.
 * @usage pnpm check:protocol-versions   (pre-commit hook and CI)
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial: two verified entries, fourteen untriaged, a 90-day clock.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LEDGER = join(ROOT, 'security', 'protocol-versions.json');

interface DeclarationSite { file: string; template: string }
interface ProtocolEntry {
  id: string;
  name: string;
  spec: string;
  weDeclare: string | null;
  declaredIn: DeclarationSite[];
  current: string | null;
  verifiedOn: string | null;
  verdict: string;
  note: string;
}
interface Ledger {
  note: string;
  maxAgeDays: number;
  verdicts: Record<string, string>;
  protocols: ProtocolEntry[];
}

const problems: string[] = [];
const untriaged: string[] = [];
const stale: string[] = [];

function daysSince(iso: string): number {
  const then = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/** Does the file still say what the ledger claims it says? */
function checkDeclaration(entry: ProtocolEntry, site: DeclarationSite): void {
  if (entry.weDeclare === null) {
    problems.push(`${entry.id}: declaredIn names ${site.file} but weDeclare is null — say which version, or drop the site`);
    return;
  }
  const path = join(ROOT, site.file);
  let body: string;
  try {
    body = readFileSync(path, 'utf-8');
  } catch {
    problems.push(`${entry.id}: ${site.file} does not exist — the declaration moved, and the ledger did not follow`);
    return;
  }
  // The template carries `{version}` so the version is written ONCE, in `weDeclare`. A literal
  // string here would be a second copy of the very thing this gate exists to keep in step.
  const wanted = site.template.replace('{version}', entry.weDeclare);
  if (!body.includes(wanted)) {
    problems.push(
      `${entry.id}: ${site.file} no longer contains \`${wanted}\`.\n`
      + `      Either the code moved to a new version and security/protocol-versions.json did not,\n`
      + `      or the declaration was rewritten and this site needs updating.`,
    );
  }
}

function main(): void {
  const ledger: Ledger = JSON.parse(readFileSync(LEDGER, 'utf-8'));

  for (const entry of ledger.protocols) {
    if (!ledger.verdicts[entry.verdict]) {
      problems.push(`${entry.id}: verdict "${entry.verdict}" is not one of ${Object.keys(ledger.verdicts).join(', ')}`);
    }
    if (!entry.note || entry.note.length < 40) {
      problems.push(`${entry.id}: an entry needs a note saying what is true and what is open`);
    }
    for (const site of entry.declaredIn) checkDeclaration(entry, site);

    if (entry.verdict === 'untriaged') {
      untriaged.push(`${entry.id.padEnd(14)} ${entry.name}`);
      continue;
    }
    if (!entry.verifiedOn) {
      problems.push(`${entry.id}: verdict is "${entry.verdict}" but nobody recorded a verifiedOn date`);
      continue;
    }
    const age = daysSince(entry.verifiedOn);
    if (age > ledger.maxAgeDays) {
      stale.push(`${entry.id.padEnd(14)} last checked ${entry.verifiedOn} (${age} days ago), declares ${entry.weDeclare ?? '—'}, ${entry.spec}`);
    }
  }

  if (untriaged.length) {
    console.log(`[protocol-versions] ${untriaged.length} untriaged — a question nobody has answered, not a clearance:`);
    for (const line of untriaged) console.log(`    ${line}`);
  }

  if (stale.length) {
    console.error(`\n✖ ${stale.length} protocol(s) not checked in over ${ledger.maxAgeDays} days:`);
    for (const line of stale) console.error(`    ${line}`);
    console.error('\n  Read what that spec says today, write what you found in the entry\'s note, and move');
    console.error('  its verifiedOn. Do NOT move every date at once: that forgives the whole list, and');
    console.error('  the list is the only thing standing between this node and the next wrong answer.');
  }

  if (problems.length) {
    console.error(`\n✖ ${problems.length} problem(s) in security/protocol-versions.json:`);
    for (const p of problems) console.error(`    ${p}`);
  }

  if (stale.length || problems.length) process.exit(1);
  const triaged = ledger.protocols.length - untriaged.length;
  console.log(`[protocol-versions] ✓ ${triaged} triaged and fresh, ${untriaged.length} untriaged`);
}

main();
