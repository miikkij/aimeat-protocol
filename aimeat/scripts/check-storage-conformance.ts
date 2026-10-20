/**
 * @file scripts/check-storage-conformance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The repositories of the `Storage` composite that no two-provider unit file calls, as a
 *   list that may only shrink, and the number of methods those files call, as a floor that may only
 *   rise.
 *
 *   WHY. SQLite and PostgreSQL implement every storage method twice by hand. TypeScript proves the
 *   signatures match and nothing proves the behaviour does: a listing order, a null against a missing
 *   field, a uniqueness rule or a pagination edge that differs is found only if an E2E assertion
 *   happens to look at it. The unit files that run one case against both providers are the proof,
 *   and the QA audit of 2026-10-16 (P4-09) measured them at 98 of about 759 methods, with whole
 *   repositories (direct messages, organisms, finance, connections) never called. Nothing counted
 *   it, so the share could only drift down as repositories were added.
 *
 *   WHAT IT READS. The repositories and their methods from scripts/inventory/storage-methods.ts. The
 *   two-provider unit files are the ones scripts/lib/postgres-unit-files.ts names (a unit file that
 *   reads DATABASE_URL, which is how such a file opens its PostgreSQL half). A method is called when
 *   one of those files has a call `.<method>(` on any receiver. A repository is covered when at
 *   least one of its methods is called.
 *
 *   THE BASELINE, security/storage-conformance-baseline.json: `uncovered` names each repository no
 *   file calls, seeded `DEBT`; a new repository that nothing calls fails, and a listed one that a file
 *   now calls fails until its entry is deleted. `methodsCalledFloor` is the method count when it was
 *   last raised; a count below it fails (a case was removed), and a count above it asks for the floor
 *   to be raised, so coverage cannot fall back unnoticed.
 * @structure calledMethods(source, names) · coverage(repos, calls) · compare(...) · main()
 * @usage
 *   cd aimeat && pnpm check:storage-conformance          # the gate
 *   cd aimeat && pnpm check:storage-conformance --seed   # rewrite the baseline from today's code (ask first)
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (QA audit P4-09): 25 two-provider unit files call 163 of 770
 *     methods, and 33 of 73 repositories have no call.
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storageRepositories, type StorageRepository } from './inventory/storage-methods.js';
import { postgresUnitFiles } from './lib/postgres-unit-files.js';

const BASELINE = 'security/storage-conformance-baseline.json';

export interface Baseline {
    note: string;
    methodsCalledFloor: number;
    /** repository name → DEBT, or the reason no two-provider case is needed */
    uncovered: Record<string, string>;
}

/** The storage method names a source file calls, on any receiver. */
export function calledMethods(file: string, source: string, names: ReadonlySet<string>): Set<string> {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out = new Set<string>();
    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && names.has(n.expression.name.text)) {
            out.add(n.expression.name.text);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

export interface Coverage { repository: string; methods: number; called: number }

/** Per repository: how many methods it has and how many a two-provider file calls. */
export function coverage(repos: StorageRepository[], called: ReadonlySet<string>): Coverage[] {
    return repos.map(r => ({ repository: r.name, methods: r.methods.length, called: r.methods.filter(m => called.has(m.name)).length }));
}

export interface Verdict { newlyUncovered: string[]; nowCovered: string[]; gone: string[]; emptyReasons: string[]; belowFloor: boolean; aboveFloor: boolean }

export function compare(cov: Coverage[], methodsCalled: number, base: Baseline): Verdict {
    const names = new Set(cov.map(c => c.repository));
    const uncovered = cov.filter(c => c.called === 0).map(c => c.repository);
    return {
        newlyUncovered: uncovered.filter(r => !(r in base.uncovered)),
        nowCovered: Object.keys(base.uncovered).filter(r => names.has(r) && !uncovered.includes(r)),
        gone: Object.keys(base.uncovered).filter(r => !names.has(r)),
        emptyReasons: Object.entries(base.uncovered).filter(([, v]) => !v.trim()).map(([k]) => k),
        belowFloor: methodsCalled < base.methodsCalledFloor,
        aboveFloor: methodsCalled > base.methodsCalledFloor,
    };
}

function main(): void {
    const root = process.cwd();
    const repos = storageRepositories(root);
    const names = new Set(repos.flatMap(r => r.methods.map(m => m.name)));
    const files = postgresUnitFiles(root);
    const called = new Set<string>();
    for (const f of files) for (const m of calledMethods(f, readFileSync(path.join(root, f), 'utf-8'), names)) called.add(m);
    const cov = coverage(repos, called);
    const total = cov.reduce((s, c) => s + c.methods, 0);
    const uncovered = cov.filter(c => c.called === 0);

    if (process.argv.includes('--seed')) {
        const prev: Partial<Baseline> = (() => { try { return JSON.parse(readFileSync(path.join(root, BASELINE), 'utf-8')); } catch { return {}; } })();
        const base: Baseline = {
            note: prev.note ?? '',
            methodsCalledFloor: called.size,
            uncovered: Object.fromEntries(uncovered.map(c => [c.repository, prev.uncovered?.[c.repository]
                ?? `DEBT: none of its ${c.methods} methods is called by a two-provider unit file`])),
        };
        writeFileSync(path.join(root, BASELINE), JSON.stringify(base, null, 2) + '\n');
        console.log(`seeded ${BASELINE}: ${called.size} of ${total} methods called, ${uncovered.length} of ${repos.length} repositories uncovered`);
        return;
    }

    const base = JSON.parse(readFileSync(path.join(root, BASELINE), 'utf-8')) as Baseline;
    const v = compare(cov, called.size, base);
    console.log('\n  Storage conformance: what the two-provider unit files call');
    console.log('  ─────────────────────────────────────────────────────────');
    console.log(`  two-provider unit files      ${String(files.length).padStart(4)}`);
    console.log(`  methods called               ${String(called.size).padStart(4)}   of ${total} (${Math.round(100 * called.size / total)} %), floor ${base.methodsCalledFloor}`);
    console.log(`  repositories with no call    ${String(uncovered.length).padStart(4)}   of ${repos.length}`);
    const bad = v.newlyUncovered.length + v.nowCovered.length + v.gone.length + v.emptyReasons.length + (v.belowFloor ? 1 : 0) + (v.aboveFloor ? 1 : 0);
    if (!bad) { console.log('\n  ✓ no new repository without a two-provider case, and coverage has not fallen\n'); return; }

    if (v.newlyUncovered.length) {
        console.error('\n  ✖ Repositories no two-provider unit file calls:');
        for (const r of v.newlyUncovered) console.error(`    ${r}`);
        console.error('    Add a case to test/unit/storage-conformance*.test.ts that writes through it and reads it');
        console.error('    back on both providers, comparing order and null handling.');
    }
    if (v.belowFloor) {
        console.error(`\n  ✖ The two-provider files call ${called.size} methods, below the floor of ${base.methodsCalledFloor}: a case was removed.`);
    }
    if (v.nowCovered.length || v.gone.length || v.emptyReasons.length || v.aboveFloor) {
        console.error(`\n  ✖ ${BASELINE} no longer describes the code; update it so coverage cannot fall back:`);
        for (const r of v.nowCovered) console.error(`    ${r}: now called, delete its entry`);
        for (const r of v.gone) console.error(`    ${r}: no longer in Storage, delete its entry`);
        for (const r of v.emptyReasons) console.error(`    ${r}: an entry without a reason`);
        if (v.aboveFloor) console.error(`    methodsCalledFloor: raise it from ${base.methodsCalledFloor} to ${called.size}`);
    }
    console.error('');
    process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
