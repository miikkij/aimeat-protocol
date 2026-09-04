/**
 * @file scripts/check-identity-resolution.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for the identity rule in CLAUDE.md: a route or service that stores or
 *   retrieves by identity goes through `resolveIdentity(req.auth!, config.nodeId)`, never raw
 *   `req.auth!.sub`.
 *
 *   WHY THIS ONE WAS WORTH BUILDING FIRST. The rule has been written down for months and nothing
 *   read the places it applies to, which makes it worse than a rule that was never written: it is
 *   read as if something enforced it. On an agent or an ecosystem token `sub` and the resolved
 *   identity are the same string, so the mistake is invisible in every test that uses an agent. On an
 *   OWNER session they differ — `sub` is the bare account name — and data filed under `alice` instead
 *   of `alice@node-id` is not found again by list, search or update.
 *
 *   WHAT IT CAN AND CANNOT SEE. Reading `sub` is often right: comparing against a bare owner name in
 *   a path, a log line, anything that means the ACCOUNT rather than the identity data is filed under.
 *   Telling those from the mistake means knowing what the parameter on the other side of a call
 *   means, which no scanner here does. So the question asked is the answerable one: does this unit
 *   read `sub` while never asking `resolveIdentity` who the caller is? A unit that does both is not
 *   reported — the permissive direction, chosen deliberately, because a gate that cries at correct
 *   code is turned off within a week.
 *
 *   RATCHET, NOT A WALL. The exemption file is seeded with today's units and the seeded entries are
 *   NOT triaged: each one is a question nobody has answered yet, kept so the gate can refuse a NEW
 *   one. The count may only go down.
 * @structure
 *   - sourceFiles(): routes and services, through the compiler's own file list
 *   - main(): read the exemption file, report, and on --strict exit 1 on an unlisted unit
 * @usage
 *   cd aimeat && pnpm check:identity-resolution            # report
 *   cd aimeat && pnpm check:identity-resolution --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:identity-resolution --seed     # rewrite the exemption file
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial. Measured before it existed: the identity rule was one of four
 *     written rules with no gate at all, and the only one whose failure hides itself from agent tests.
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identityReads, type IdentityRead } from './inventory/identity-reads.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..');
const EXEMPTIONS = join(AIMEAT, 'security', 'identity-resolution-exemptions.json');

interface ExemptionFile {
    note: string;
    /** `file:unit` → one line. No line number: an entry keyed by line stops covering the code it was
     *  written for as soon as anything above it moves. */
    exempt: Record<string, string>;
}

const SEED_REASON = 'SEEDED 2026-09-04, NOT TRIAGED — reads `sub` and never calls resolveIdentity. '
    + 'Whether that is the account name it wants or the identity it should have resolved is a question '
    + 'nobody has answered. Kept so the gate can refuse a NEW one; the decision is still owed.';

function sourceFiles(): { program: ts.Program; files: ts.SourceFile[] } {
    const config = ts.readConfigFile(join(AIMEAT, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, AIMEAT);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    // Forces the binder, which is what sets node.parent. Without it enclosingUnit() walks nothing
    // and every read is reported as <module>.
    program.getTypeChecker();
    const files = program.getSourceFiles().filter(f =>
        !f.isDeclarationFile
        && /[/\\]src[/\\](routes|services)[/\\]/.test(f.fileName)
        && !f.fileName.includes('node_modules'));
    return { program, files };
}

const key = (r: IdentityRead): string => `${r.file}:${r.unit}`;

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');

    const { program, files } = sourceFiles();
    const all = identityReads(program, files, AIMEAT);
    const bare = all.filter(r => !r.resolvesToo);
    // The unit is what is decided about, so several reads inside one handler are one entry. The one
    // kept is a read that HANDS the value on where there is one, because that is the read a person
    // triaging the unit needs to see rather than the log line three rows above it.
    const units = bare
        .filter((r, i) => bare.findIndex(q => key(q) === key(r)) === i)
        .map(r => bare.filter(q => key(q) === key(r)).find(q => q.asArgument) ?? r)
        // Handing an identity to a call comes first: that is where a wrong value gets filed.
        .sort((a, b) => Number(b.asArgument) - Number(a.asArgument) || a.file.localeCompare(b.file));

    if (seed) {
        const file: ExemptionFile = {
            note: 'Routes and services that read `sub` off the verified token and never call '
                + 'resolveIdentity(). Seeded 2026-09-04 from the state of that day and NOT TRIAGED: an '
                + 'entry here is a question, not a clearance. Reading `sub` is correct when the unit '
                + 'means the bare ACCOUNT name (a path segment to compare against, a log line) and '
                + 'wrong when it means the identity a record is filed under, and only a person reading '
                + 'the unit can say which. Triaging one means deleting the entry or replacing this '
                + 'sentence with what makes it right.',
            exempt: Object.fromEntries(units.map(u => [key(u), SEED_REASON])),
        };
        writeFileSync(EXEMPTIONS, JSON.stringify(file, null, 2) + '\n', 'utf-8');
        console.log(`  seeded ${units.length} units → ${EXEMPTIONS}`);
        return;
    }

    // Triage needs the whole population, not only what is new: the report below names the unlisted
    // ones because those are what a commit must answer for, and a person working through the backlog
    // needs every unit with the line that made it a candidate.
    if (process.argv.includes('--list')) {
        for (const u of units) console.log(`${u.asArgument ? 'ARG ' : '    '}${u.file}:${u.line}\t${u.unit}\t${u.text}`);
        console.log(`\n  ${units.length} units, ${units.filter(u => u.asArgument).length} of them handing the value to a call`);
        return;
    }

    const exempt: ExemptionFile = JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile;
    const listed = Object.keys(exempt.exempt);
    const fresh = units.filter(u => exempt.exempt[key(u)] === undefined);
    const stale = listed.filter(k => !units.some(u => key(u) === k));
    const triaged = listed.filter(k => !exempt.exempt[k].startsWith('SEEDED'));

    console.log('');
    console.log('  Identity: does the unit resolve the caller, or read `sub` raw?');
    console.log('  ' + '─'.repeat(62));
    console.log(`  reads of \`sub\`      ${String(all.length).padStart(3)}   in src/routes and src/services`);
    console.log(`  units, sub only     ${String(units.length).padStart(3)}   never call resolveIdentity`);
    console.log(`  of those, hand it on${String(units.filter(u => u.asArgument).length).padStart(3)}   pass \`sub\` to a call — triage these first`);
    console.log(`  units, both         ${String(all.filter(r => r.resolvesToo).length).padStart(3)}   not reported: the unit does resolve`);
    console.log(`  listed              ${String(listed.length).padStart(3)}   of which triaged: ${triaged.length}`);
    console.log(`  NEW, not listed     ${String(fresh.length).padStart(3)}`);
    console.log('');

    if (fresh.length > 0) {
        console.log('  NEW — reads `sub` and never resolves the caller:');
        for (const u of fresh) {
            console.log(`    ${u.file}:${u.line}  ${u.unit}`);
            console.log(`      ${u.text}`);
        }
        console.log('');
        console.error('✖ On an owner session `sub` is the bare account name and the resolved identity is');
        console.error('  `owner@nodeId`. Data filed under the first is not found again by list, search or');
        console.error('  update, and every test that uses an AGENT passes either way. Use');
        console.error('  resolveIdentity(req.auth!, config.nodeId), or add the unit to');
        console.error('  security/identity-resolution-exemptions.json with the sentence that makes it right.');
        if (strict) process.exit(1);
        return;
    }

    if (stale.length > 0) {
        console.log(`  ✓ ${stale.length} listed unit${stale.length === 1 ? '' : 's'} gone. Remove to lock the gain in:`);
        for (const k of stale) console.log(`    ${k}`);
        return;
    }

    console.log(`  ✓ no unit reads \`sub\` without resolving, beyond the ${listed.length} listed`);
}

main();
