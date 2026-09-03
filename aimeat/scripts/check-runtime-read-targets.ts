/**
 * @file scripts/check-runtime-read-targets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A database read whose TABLE is decided while the program runs, rather than written
 *   down, must be listed here with a reason.
 *
 *   WHY. On 2026-09-03 a deleted memory record was hidden on fifteen read paths and returned by the
 *   sixteenth. That one was the full-text search, written as `FROM ${ftsTable} JOIN memory m …` with
 *   the table passed in as an argument. Nothing in the file says `memory_fts`, so nothing in the
 *   file looks like it needs the filter its fifteen siblings have — and the same property that hid
 *   it from review hid it from the first version of the audit that went looking.
 *
 *   That is the whole of what this gate watches. It is not a rule about filters, because a query
 *   whose target cannot be known by reading cannot be checked by reading either. It is a rule about
 *   NUMBER: there is one of these in the storage layer, one is enough, and a second must be a
 *   decision somebody wrote down rather than a line that slipped in.
 *
 *   A new entry is not forbidden. It is listed, with a sentence saying what makes this query safe.
 * @structure ALLOWED — the ones that exist, each with its reason. main(): report, and fail on a new one.
 * @usage
 *   cd aimeat && pnpm check:runtime-read-targets            # report
 *   cd aimeat && pnpm check:runtime-read-targets --strict   # the CI gate
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, after the read-path audit found this class has exactly one member.
 */
import ts from 'typescript';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPaths, PARAMETERISED } from './inventory/read-paths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..');

/**
 * The run-time-chosen read targets that exist, and why each is safe.
 *
 * Keyed by `file:function`, not by line, so ordinary edits above them do not churn this list.
 */
const ALLOWED: Record<string, string> = {
    'src/storage/providers/sqlite/repos/memory.ts:sql':
        'The full-text search picks between memory_fts (live rows) and memory_archive_fts (archived '
        + 'ones), which is why the table is an argument. It names `m.deletedAt IS NULL` itself — the '
        + 'clause it was missing when a deleted record came back from a text search on 2026-09-03.',
};

function sourceFiles(): ts.SourceFile[] {
    const config = ts.readConfigFile(join(AIMEAT, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, AIMEAT);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    program.getTypeChecker();
    return program.getSourceFiles().filter(f => !f.isDeclarationFile && f.fileName.includes('/src/'));
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const found = readPaths(sourceFiles(), AIMEAT)
        .filter(p => p.target === PARAMETERISED)
        // One query can be matched more than once inside the same function; the function is the unit.
        .filter((p, i, all) => all.findIndex(q => q.file === p.file && q.fn === p.fn) === i);

    console.log('');
    console.log('  Reads whose table is chosen while the program runs');
    console.log('  ' + '─'.repeat(62));
    console.log(`  found   ${String(found.length).padStart(3)}`);
    console.log(`  listed  ${String(Object.keys(ALLOWED).length).padStart(3)}`);
    console.log('');

    const unlisted = found.filter(p => ALLOWED[`${p.file}:${p.fn}`] === undefined);
    const stale = Object.keys(ALLOWED).filter(k => !found.some(p => `${p.file}:${p.fn}` === k));

    if (unlisted.length > 0) {
        console.log('  NOT LISTED — a query nobody can check by reading it:');
        for (const p of unlisted) console.log(`    ${p.file}:${p.line}  in ${p.fn}()`);
        console.log('');
        console.error('✖ A read that picks its table at run time never passes through the filter its');
        console.error('  siblings share, and no reader or scanner can see which table it means. If this');
        console.error('  one is right, add it to ALLOWED in this script with a sentence saying why.');
        if (strict) process.exit(1);
        return;
    }

    if (stale.length > 0) {
        console.log(`  ✓ ${stale.length} listed entr${stale.length === 1 ? 'y is' : 'ies are'} gone. Remove from ALLOWED to lock the gain in:`);
        for (const k of stale) console.log(`    ${k}`);
        return;
    }

    console.log('  ✓ every run-time-chosen read target is listed with a reason');
}

main();
