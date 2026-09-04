/**
 * @file check-scope-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for N3: a permission word means the same thing on every door, or it does
 *   not exist. Two directions, both of which have been live in this codebase.
 *
 *   DIRECTION ONE — a word the owner is OFFERED that nothing asks for. The consent screen lists it,
 *   the owner ticks or unticks it, and the tick changes nothing: granting does nothing and denying
 *   protects nothing. `allowRouting` was that, and its refusal text had never been shown to anybody.
 *   `memory:delete` was that, and an owner who withheld it was protecting a door no tool knocked on.
 *
 *   DIRECTION TWO — a word a DOOR demands that the owner cannot grant. It is not on the screen, so
 *   no agent can ever hold it, so the door is shut to every principal that has to be given
 *   permission. From outside that is indistinguishable from "closed by design", which is why it can
 *   sit for months. Two were live when this was written: `app:read` and `events:emit`.
 *
 *   WHY THE INVENTORY DID NOT ALREADY DO THIS. It did — it PRINTS both lists in
 *   `secaudit/inventory.md`. A printed list is read once by whoever ran the command; this fails the
 *   build for the next person who adds a word to one side and not the other. The wish that started
 *   the inventory says the same thing about itself: "auditointi löytää tämän päivän tapaukset,
 *   portti löytää huomisen".
 *
 *   THREE WAYS A WORD IS DEMANDED, and a detector that knows one of them is wrong. `requireScope()`
 *   on a route, `TOOL_SCOPES` for an MCP tool, and the literal inside another gate's own body —
 *   `account:security` is enforced inside `requireOwnerPrincipal()` and `memory:write-as-owner`
 *   inside a handler. Both are real gates and neither is a `requireScope` call. Direction one asks
 *   all three (through scope-mentions.ts, which also follows a constant one level), because a false
 *   finding there costs somebody an afternoon proving the code was fine.
 *
 *   DIRECTION TWO reads only `requireScope('literal')` and `TOOL_SCOPES`, and that is deliberate
 *   rather than lazy: it looks for words that are NOT in the vocabulary, so it must not invent one
 *   out of a string that happens to contain a colon. A demand it cannot see is a miss; a demand it
 *   imagines is a false accusation, and the two do not cost the same.
 *
 *   WHAT IT DOES NOT CLAIM. Nothing here says a check is CORRECT — only that the word is asked for
 *   somewhere and offered somewhere. Whether the right door asks it is a reading job, and
 *   check:route-scopes counts the doors that ask nothing at all.
 * @structure
 *   - sources(): the TypeScript sources under src/
 *   - findings(): the two directions
 *   - main(): compare against security/scope-parity-exemptions.json, report, gate under --strict
 * @usage
 *   cd aimeat && pnpm check:scope-parity           # report
 *   cd aimeat && pnpm check:scope-parity --strict  # gate (pre-commit + CI)
 *   cd aimeat && pnpm check:scope-parity --seed    # rewrite the exemption file from today's state
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (wish-invarianttiauditointi N3: the same word on every door).
 */
import ts from 'typescript';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scopeMentions } from './inventory/scope-mentions.js';
import { readVocabulary, demandedScopes } from './inventory/scope-vocabulary.js';
import { TOOL_SCOPES } from '../src/mcp/catalog/scopes.js';

const AIMEAT = process.cwd();
const SRC = join(AIMEAT, 'src');
const EXEMPTIONS = join(AIMEAT, 'security', 'scope-parity-exemptions.json');

/**
 * The files that DEFINE the vocabulary rather than demand it.
 *
 * A definition is not a demand: the owner-facing model lists what can be granted and scope-coverage
 * binds the names. Counting those would make every word look asked-for, and the whole gate would
 * answer nothing. Same exclusion list the inventory uses, for the same reason.
 */
const DEFINITION_FILES = ['mcp/catalog/scopes.ts', 'utils/scope-coverage.ts'];

interface ExemptionFile { note: string; exempt: Record<string, string> }

function sources(): ts.SourceFile[] {
    const files: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) { if (name !== 'generated') walk(p); continue; }
            if (p.endsWith('.ts') && !p.endsWith('.d.ts')) files.push(p);
        }
    };
    walk(SRC);
    return files.map(f => ts.createSourceFile(f, readFileSync(f, 'utf-8'), ts.ScriptTarget.ESNext, true));
}

interface Finding {
    /** The stable key an exemption is written against. */
    key: string;
    word: string;
    kind: 'offered-never-asked' | 'demanded-never-offered';
    detail: string;
}

function findings(): Finding[] {
    const vocabulary = readVocabulary(AIMEAT);
    const files = sources();
    const mentions = scopeMentions(files, vocabulary, AIMEAT, DEFINITION_FILES);
    const mcpWords = new Set(Object.values(TOOL_SCOPES));
    const demanded = demandedScopes(files);

    const out: Finding[] = [];

    // ── Direction one: offered, never asked ──
    for (const word of [...vocabulary].sort()) {
        if (mcpWords.has(word)) continue;
        if ((mentions.get(word)?.length ?? 0) > 0) continue;
        out.push({
            key: `offered:${word}`,
            word,
            kind: 'offered-never-asked',
            detail: 'the consent screen offers it; no route, no MCP tool and no other gate mentions it. '
                + 'Granting it does nothing and denying it protects nothing.',
        });
    }

    // ── Direction two: demanded, never offered ──
    const seen = new Map<string, string[]>();
    for (const d of demanded) {
        if (vocabulary.has(d.word)) continue;
        const where = `${relative(AIMEAT, d.file).split('\\').join('/')}:${d.line}`;
        seen.set(d.word, [...(seen.get(d.word) ?? []), where]);
    }
    for (const word of mcpWords) {
        if (vocabulary.has(word)) continue;
        const tools = Object.entries(TOOL_SCOPES).filter(([, w]) => w === word).map(([t]) => t);
        seen.set(word, [...(seen.get(word) ?? []), ...tools.map(t => `TOOL_SCOPES[${t}]`)]);
    }
    for (const [word, where] of [...seen.entries()].sort()) {
        out.push({
            key: `demanded:${word}`,
            word,
            kind: 'demanded-never-offered',
            detail: `a door requires it and the owner's screen never offers it, so no agent can hold `
                + `it: ${where.slice(0, 4).join(', ')}${where.length > 4 ? ` and ${where.length - 4} more` : ''}`,
        });
    }

    return out;
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');
    const all = findings();

    if (seed) {
        const exempt: Record<string, string> = {};
        for (const f of all) exempt[f.key] = `Seeded 2026-09-04. ${f.detail} NOT YET REVIEWED: either `
            + `make the two sides agree, or record here why this word is meant to exist on one side only.`;
        writeFileSync(EXEMPTIONS, JSON.stringify({
            note: 'Permission words that exist on one side only: offered to the owner and asked for by '
                + 'nothing, or demanded by a door and offered to nobody. Seeded from the state on '
                + '2026-09-04 so the gate can only ratchet down. A word in this file is a question '
                + 'nobody has answered, not a clearance.',
            exempt,
        } as ExemptionFile, null, 2) + '\n');
        console.log(`Seeded ${all.length} exemptions into ${relative(AIMEAT, EXEMPTIONS)}`);
        return;
    }

    const exempt = existsSync(EXEMPTIONS)
        ? (JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile).exempt
        : {};
    const fresh = all.filter(f => !exempt[f.key]);
    const stale = Object.keys(exempt).filter(k => !all.some(f => f.key === k));

    const offered = all.filter(f => f.kind === 'offered-never-asked');
    const demandedOnly = all.filter(f => f.kind === 'demanded-never-offered');

    console.log('');
    console.log('  One permission word, every door — or it does not exist');
    console.log('  ' + '─'.repeat(62));
    console.log(`  offered to the owner, asked by nothing  ${String(offered.length).padStart(4)}`);
    console.log(`  demanded by a door, offered to nobody   ${String(demandedOnly.length).padStart(4)}`);
    console.log(`  of those, exempt                        ${String(all.length - fresh.length).padStart(4)}   (seeded backlog, may only shrink)`);
    console.log(`  NEW, not exempt                         ${String(fresh.length).padStart(4)}`);
    if (stale.length) console.log(`  exemptions now fixed                    ${String(stale.length).padStart(4)}   (remove them from the file)`);
    console.log('');

    if (fresh.length) {
        for (const f of fresh) console.log(`    ${f.word.padEnd(30)} ${f.detail}`);
        console.log('');
        console.log('  A word on one side only cannot be enforced and cannot be granted. Put it on both');
        console.log('  sides, take it off the one it is on, or add an entry to');
        console.log(`  ${relative(AIMEAT, EXEMPTIONS)} saying why it lives on one side.`);
        console.log('');
    }
    if (stale.length) {
        console.log('  Now agreed, so these entries can go:');
        for (const k of stale) console.log(`    ${k}`);
        console.log('');
    }

    if (strict && fresh.length) {
        console.error(`✖ ${fresh.length} permission word(s) newly on one side only.`);
        process.exit(1);
    }
    console.log(fresh.length
        ? '  (report only — pass --strict to gate)'
        : '  ✓ no permission word is newly on one side only');
}

main();
