/**
 * @file scripts/check-owner-principal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for invariant 11: the owner name is not a principal.
 *
 *   `auth.owner` carries the human's name identically on an owner session, an agent JWT, an ecosystem
 *   app's token, a personal access token and an app grant. So a refusal decided by comparing it turns
 *   away a different PERSON and admits everything acting in this person's name. For reading a person's
 *   own data that is usually the intent. For changing the ACCOUNT it is not, and no comparison of
 *   names can ask the question that door needs — `requireOwnerPrincipal()` asks it, and
 *   `requireRole('owner')` does not, because an agent minted for that owner carries the owner role.
 *
 *   The August 2026 audit found this by hand, wrote it down as invariant 11, and left it as the last
 *   of that set with nothing reading the places it applies to. Two other gates from the same audit
 *   watch what a door DECLARES; this one watches what a handler DECIDES.
 *
 *   RATCHET. Seeded with the doors that decide this way today. A seeded entry is not a clearance: it
 *   says nobody has yet decided whether this door is protecting DATA (where a name is the right
 *   question) or the ACCOUNT (where it is not). What the gate refuses is a new one appearing unseen.
 *
 *   WHAT IT CANNOT SEE, said plainly so the count is not read as completeness: a comparison stored in
 *   a variable first (`const mine = a.owner === b.owner; if (!mine) …`), one folded into a ternary,
 *   and any decision made inside a helper called with the two names as arguments. The count is a
 *   floor.
 *
 *   AND IT IS BLIND TO OVER-REFUSAL BY CONSTRUCTION, which is the half a reader will not think of.
 *   Every gate here looks for a door that refuses too LITTLE. A fence that refuses too much — the
 *   naive `installedBy === caller` that hides every bundled cortex, seeded as `system@<nodeId>` and
 *   private, from everyone on the node — passes a one-fixture test and passes every scanner we own,
 *   because it errs in the direction none of them measure. Eight of fourteen cortex packs on the dev
 *   database are exactly that shape (2026-09-05). A green gate says nobody was let in who should not
 *   have been; it never says anybody who should be got in. Only a test with a second fixture does,
 *   and writing that test is the part no gate will remind you of.
 * @structure
 *   - main(): report; --strict exits 1 on an unlisted door; --seed rewrites the exemption file
 * @usage
 *   cd aimeat && pnpm check:owner-principal            # report
 *   cd aimeat && pnpm check:owner-principal --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:owner-principal --seed     # rewrite the exemption file
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, the fourth of the four written rules that had no gate.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerDecisions, PRINCIPAL_GUARDS, type OwnerDecision } from './inventory/owner-decisions.js';
import { srcProgram } from './inventory/program.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..');
const EXEMPTIONS = join(AIMEAT, 'security', 'owner-principal-exemptions.json');

interface ExemptionFile {
    note: string;
    /** `file:unit` → one line. No line number: it would go stale on the next edit above it. */
    exempt: Record<string, string>;
}

const SEED_REASON = 'SEEDED 2026-09-04, NOT TRIAGED — refuses by comparing the owner NAME, and nothing '
    + 'on this door names the principal. Whether that is right depends on what is behind it: a name is '
    + 'the right question for a person\'s own DATA and the wrong one for their ACCOUNT. Not yet decided.';

const key = (r: OwnerDecision): string => `${r.file}:${r.unit}`;

export function main(): boolean {
    const seed = process.argv.includes('--seed');

    // src/mcp JOINED THE SCAN on 2026-09-06, for the reason written out in
    // check-identity-resolution.ts: the worst owner-as-principal defect in the tree
    // (mcp/oauth.ts, a credential-granting door gated on `agent.owner !== payload.owner`) sat on a
    // surface this gate had never read, while the gate reported green.
    const { program, files } = srcProgram(/[/\\]src[/\\](routes|services|mcp)[/\\]/);
    const all = ownerDecisions(program, files, AIMEAT);
    // A door that names the principal is asking the right question already; the name comparison beside
    // it is a second, narrower one. Those are not the gate's business.
    const bare = all.filter(r => !r.namesPrincipal);
    const units = bare
        .filter((r, i) => bare.findIndex(q => key(q) === key(r)) === i)
        .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    if (seed) {
        const file: ExemptionFile = {
            note: 'Doors that decide a refusal by comparing the owner NAME on the verified token, with '
                + 'nothing on the door naming the principal. Seeded 2026-09-04 and NOT TRIAGED: an entry '
                + 'is a question, not a clearance. `auth.owner` reads the same on an owner session, an '
                + 'agent JWT, an ecosystem token, a PAT and an app grant, so this comparison refuses a '
                + 'different PERSON and admits anything acting in this person\'s name. Right for a '
                + 'person\'s own DATA; wrong for their ACCOUNT, which needs requireOwnerPrincipal(). '
                + 'Triaging one means moving the door behind a principal guard or replacing this '
                + 'sentence with what makes the comparison the correct question here. Invariant 11, '
                + 'docs/coding-guidelines/security-development-dna.md.',
            exempt: Object.fromEntries(units.map(u => [key(u), SEED_REASON])),
        };
        writeFileSync(EXEMPTIONS, JSON.stringify(file, null, 2) + '\n', 'utf-8');
        console.log(`  seeded ${units.length} doors → ${EXEMPTIONS}`);
        return true;
    }

    const exempt = JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile;
    const listed = Object.keys(exempt.exempt);
    const fresh = units.filter(u => exempt.exempt[key(u)] === undefined);
    const stale = listed.filter(k => !units.some(u => key(u) === k));
    const triaged = listed.filter(k => !exempt.exempt[k].startsWith('SEEDED'));

    console.log('');
    console.log('  Invariant 11: is the refusal a principal, or a name?');
    console.log('  ' + '─'.repeat(62));
    console.log(`  refusals on \`owner\`  ${String(all.length).padStart(3)}   in src/routes, src/services and src/mcp`);
    console.log(`  doors, name only     ${String(units.length).padStart(3)}   nothing on the door names the principal`);
    console.log(`  doors that name it   ${String(all.filter(r => r.namesPrincipal).length).padStart(3)}   not reported (${PRINCIPAL_GUARDS.join(', ')})`);
    console.log(`  listed               ${String(listed.length).padStart(3)}   of which triaged: ${triaged.length}`);
    console.log(`  NEW, not listed      ${String(fresh.length).padStart(3)}`);
    console.log('');

    if (fresh.length > 0) {
        console.log('  NEW — refuses on the owner name, with no principal named:');
        for (const u of fresh) {
            console.log(`    ${u.file}:${u.line}  ${u.unit}`);
            console.log(`      ${u.text}`);
        }
        console.log('');
        console.error('✖ The owner name reads the same on an owner session, an agent JWT, an ecosystem');
        console.error('  token, a PAT and an app grant, so this refuses a different PERSON and admits');
        console.error('  everything acting in this one\'s name. If the door protects the ACCOUNT, put it');
        console.error('  behind requireOwnerPrincipal(); if it protects DATA, add it to');
        console.error('  security/owner-principal-exemptions.json with the sentence that says so.');
        return false;
    }

    if (stale.length > 0) {
        console.log(`  ✓ ${stale.length} listed door${stale.length === 1 ? '' : 's'} gone. Remove to lock the gain in:`);
        for (const k of stale) console.log(`    ${k}`);
        return true;
    }

    console.log(`  ✓ no door refuses on the owner name alone, beyond the ${listed.length} listed`);
    return true;
}

// Runs only when invoked as the script: check-invariants imports main() and runs the five
// program-reading gates in one process against one compiler program.
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly && !main() && process.argv.includes('--strict')) process.exit(1);
