/**
 * @file scripts/check-mcp-test-calls.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ratchet on MCP tools that no E2E suite calls. Every tool in the tool catalog
 *   (src/tool-catalog/definitions.ts) is either named by an E2E file under test/ or listed in
 *   security/mcp-uncalled-tools.json with a reason, and that list only shrinks.
 *
 *   WHY. MCP is the preferred way in for an agent, and a tool handler often makes its own access
 *   decision (an operator check, an organism admin check, a scope word asked at call time) that the
 *   REST suites do not reach. The QA audit of 2026-10 counted 92 of 430 catalog tools that no test of
 *   any kind named, and 130 that no E2E suite named; a handler check in one of them could be removed
 *   and every suite would stay green. A unit test that calls a tool on a stand-in MCP object proves
 *   the code it stands in for and not the handler, so only E2E files count here.
 *
 *   WHAT COUNTS AS A CALL. The tool name as a quoted string literal in an E2E file (test/*.ts and
 *   test/helpers/), except where it is the argument of `.includes(`, `.has(` or `.indexOf(`: that is
 *   a tools/list or prompt-text assertion, which names the tool without calling it. The rule is a
 *   text match, so a name in a list of tools that are asserted NOT to be offered still counts; the
 *   count is a floor on what is uncalled, never a ceiling.
 *
 *   WHAT FAILS (--strict, the gate):
 *     - a catalog tool no E2E file names and the file does not list (a new tool ships with a call);
 *     - a listed tool that an E2E file now names (delete the entry: the list only shrinks);
 *     - a listed tool the catalog no longer has;
 *     - an entry with no reason;
 *     - more entries than CEILING, or fewer (lower CEILING to the new count in the same change, so
 *       the number in this file is the number that is true).
 *
 *   The seeded entries carry the placeholder UNCALLED, which is a QUESTION: nobody has written the
 *   call yet. An ANSWER says why the tool cannot be called from an E2E suite on the test node (an
 *   outside system with no test double, for example). Re-seeding forgives the whole list, so it is
 *   a decision for the developer and never maintenance.
 * @structure
 *   - CEILING: the number of entries the file may hold
 *   - e2eFiles(): the files that count
 *   - namedTools(): which catalog tools those files name
 *   - main(): compare with security/mcp-uncalled-tools.json; --strict exits 1; --seed rewrites it
 * @usage
 *   cd aimeat && pnpm check:mcp-test-calls            # the gate (strict)
 *   cd aimeat && pnpm check:mcp-test-calls:report     # report only
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27). 138 of 431 catalog tools had no E2E call that day;
 *     the same change wrote a call and a refusal for each, so the list starts empty and CEILING is 0.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../src/tool-catalog/definitions.js';

/**
 * How many entries security/mcp-uncalled-tools.json may hold. Lower it in the change that deletes
 * entries; raising it is the developer's decision.
 */
export const CEILING = 0;

const ROOT = process.cwd();
const TEST_DIR = join(ROOT, 'test');
const LIST_FILE = join(ROOT, 'security', 'mcp-uncalled-tools.json');
const PLACEHOLDER = 'UNCALLED';

interface ListFile { note: string; exempt: Record<string, string> }

/** test/*.ts|mjs|js and test/helpers/**; never test/unit, test/playwright or fixtures. */
export function e2eFiles(dir: string = TEST_DIR): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === 'helpers') out.push(...e2eFiles(full).filter(f => f.includes(`${join('test', 'helpers')}`)));
            continue;
        }
        if (/\.(ts|mjs|js)$/.test(name)) out.push(full);
    }
    return out;
}

/** Is the literal at `index` the argument of a membership test (`.includes(` / `.has(` / `.indexOf(`)? */
function isMembershipArgument(text: string, index: number): boolean {
    return /\.(?:includes|has|indexOf)\(\s*$/.test(text.slice(Math.max(0, index - 20), index));
}

/** The subset of `tools` that some file in `texts` names as a call (see the header). */
export function namedTools(tools: string[], texts: string[]): Set<string> {
    const named = new Set<string>();
    for (const tool of tools) {
        const re = new RegExp(`['"\`]${tool}['"\`]`, 'g');
        for (const text of texts) {
            let hit = false;
            for (const m of text.matchAll(re)) {
                if (!isMembershipArgument(text, m.index)) { hit = true; break; }
            }
            if (hit) { named.add(tool); break; }
        }
    }
    return named;
}

function load(): ListFile {
    if (!existsSync(LIST_FILE)) return { note: '', exempt: {} };
    return JSON.parse(readFileSync(LIST_FILE, 'utf-8')) as ListFile;
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');

    const tools = CLI_FALLBACK_TOOL_DEFINITIONS.map(t => t.name).sort();
    const texts = e2eFiles().map(f => readFileSync(f, 'utf-8'));
    const named = namedTools(tools, texts);
    const uncalled = tools.filter(t => !named.has(t));

    if (seed) {
        const exempt: Record<string, string> = {};
        for (const t of uncalled) {
            exempt[t] = `${PLACEHOLDER}: no E2E suite named this tool on 2026-10-16. Write a call and a refusal for it, or replace this line with why an E2E suite on the test node cannot call it.`;
        }
        const out: ListFile = {
            note: 'Catalog MCP tools that no E2E suite calls (scripts/check-mcp-test-calls.ts, pnpm check:mcp-test-calls). Seeded 2026-10-16 from the QA audit (W27). An entry is a QUESTION while it starts with UNCALLED: nobody has written the call yet. An ANSWER says why an E2E suite on the test node cannot call the tool. The list only shrinks: an entry whose tool an E2E file now names fails the gate until it is deleted, and CEILING in the script is lowered in the same change. A new entry or a higher ceiling is the developer\'s decision.',
            exempt,
        };
        writeFileSync(LIST_FILE, JSON.stringify(out, null, 2) + '\n');
        console.log(`Seeded ${uncalled.length} entries into ${relative(ROOT, LIST_FILE)}. Set CEILING = ${uncalled.length}.`);
        return;
    }

    const { exempt } = load();
    const listed = Object.keys(exempt);
    const fresh = uncalled.filter(t => !(t in exempt));
    const nowCalled = listed.filter(t => named.has(t));
    const gone = listed.filter(t => !tools.includes(t));
    const noReason = listed.filter(t => !String(exempt[t] ?? '').trim());
    const questions = listed.filter(t => String(exempt[t]).startsWith(PLACEHOLDER)).length;

    console.log('');
    console.log('  MCP tools called by an E2E suite');
    console.log('  ' + '─'.repeat(62));
    console.log(`  catalog tools          ${String(tools.length).padStart(5)}`);
    console.log(`  named by an E2E file   ${String(named.size).padStart(5)}`);
    console.log(`  uncalled               ${String(uncalled.length).padStart(5)}   (listed ${listed.length}, ceiling ${CEILING}, of them still ${PLACEHOLDER} ${questions})`);
    console.log('');

    const problems: string[] = [];
    if (fresh.length) {
        problems.push(`${fresh.length} tool(s) no E2E suite calls and the list does not name`);
        console.log('  A tool an agent can call and no E2E suite calls: a handler check in it can be removed and');
        console.log('  every suite stays green. Write a call and a refusal for it in an E2E suite.');
        for (const t of fresh) console.log(`    NEW        ${t}`);
        console.log('');
    }
    if (nowCalled.length) {
        problems.push(`${nowCalled.length} listed tool(s) are now called`);
        console.log(`  Now called by an E2E file, so delete these entries from ${relative(ROOT, LIST_FILE)}:`);
        for (const t of nowCalled) console.log(`    CALLED     ${t}`);
        console.log('');
    }
    if (gone.length) {
        problems.push(`${gone.length} listed tool(s) are not in the catalog`);
        for (const t of gone) console.log(`    NOT IN CATALOG ${t}`);
        console.log('');
    }
    if (noReason.length) {
        problems.push(`${noReason.length} entr(y/ies) without a reason`);
        for (const t of noReason) console.log(`    NO REASON  ${t}`);
        console.log('');
    }
    if (listed.length > CEILING) problems.push(`the list holds ${listed.length} entries and the ceiling is ${CEILING}`);
    if (listed.length < CEILING) {
        problems.push(`the list holds ${listed.length} entries: lower CEILING in scripts/check-mcp-test-calls.ts from ${CEILING} to ${listed.length}`);
    }

    if (problems.length) {
        for (const p of problems) console.log(`  ✖ ${p}`);
        if (strict) process.exit(1);
        console.log('  (report only — pass --strict to gate)');
        return;
    }
    console.log('  ✓ every catalog tool is called by an E2E suite or listed with a reason, and the list did not grow');
}

// Run when executed as a script; a unit test imports the detectors without running the gate.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/check-mcp-test-calls.ts')) main();
