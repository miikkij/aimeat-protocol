/**
 * @file scripts/check-unbounded-lists.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A storage list method that returns everything it matches, with nothing to bound it,
 *   and the code that reads a whole table through one, may only become fewer.
 *
 *   WHY. "Test at the size production has" (CLAUDE.md) is a rule about what grows with the data, and
 *   until this gate nothing counted where the node reads without a bound. The QA audit of 2026-10-16
 *   (P7-10) found `listOwners()` on every registration and on every sign-in, and `listAgents()` read
 *   whole to pick one owner's agents; those two were fixed, and nothing stopped the next one. A list
 *   that is fine at 70 agents is a timeout at 70 000, and no test at fixture size can see it.
 *
 *   WHAT IT READS (scripts/inventory/storage-methods.ts gives the methods):
 *   - UNBOUNDED METHODS: every `list*` or `getAll*` method of the `Storage` composite none of whose
 *     parameters bounds the result. A parameter bounds it when its name says so (limit, cursor,
 *     options, query, filter, page, max, since, before, after, range, window, params, args,
 *     criteria, select); an owner or an id scopes a list to one account and does not bound it,
 *     because one account's data grows too. A new one fails the gate; a listed one that has gained a
 *     bound, or is gone, fails until its entry is deleted, so the list only shrinks.
 *   - WHOLE-TABLE CALLS: every call outside src/storage/ of a list method with no parameters at all
 *     (`storage.listOwners()`), counted per file. A file whose count rises fails, and a file whose
 *     count falls fails until the baseline is lowered to match.
 *   - TAKE-FIRST READS WITHOUT A LIMIT: every Kysely chain in the Postgres provider that orders its
 *     rows and ends in `executeTakeFirst()` with no `.limit(...)` in the chain. Kysely adds no LIMIT
 *     for a take-first, so Postgres sends every matching row and the driver holds them all before the
 *     first is kept. The allowance is zero, so this part has no baseline.
 *     WHY: on 2026-10-23 at 06:56, `getApp` read all 503 versions of one app, 1 041 MB with their
 *     content, on each open of that app; aimeat.io went from 1.2 GB to 6.1 GB in five minutes and
 *     stopped answering.
 *   The baseline is security/unbounded-lists-baseline.json. Its entries are seeded `DEBT`: a known
 *   unbounded read nobody has judged yet. Answering one means bounding it, or replacing DEBT with the
 *   reason it cannot grow (a node-wide table of fixed size, for instance).
 * @structure unboundedMethods(repos) · wholeTableCalls(file, source, names) · takeFirstWithoutLimit(file, source) · compare(...) · main()
 * @usage
 *   cd aimeat && pnpm check:unbounded-lists          # the gate
 *   cd aimeat && pnpm check:unbounded-lists --seed   # rewrite the baseline from today's code (ask first)
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (QA audit P7-10): 64 unbounded list methods, 10 of them whole-table,
 *     and 122 whole-table calls in 91 files.
 *   v1.1.0 — 2026-10-23 — Take-first reads without a limit in the Postgres provider, zero allowed
 *     (the aimeat.io outage of 2026-10-23: ten such reads, four of them on the App table).
 */
import ts from 'typescript';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storageRepositories, type StorageRepository } from './inventory/storage-methods.js';

const BASELINE = 'security/unbounded-lists-baseline.json';

/** A parameter name that bounds what a list returns. */
export const BOUND = /limit|cursor|opts|options|query|filter|page|max|since|before|after|range|window|params|args|criteria|select/i;

export interface UnboundedMethod { name: string; repository: string; params: string[]; wholeTable: boolean }

export interface Baseline {
    note: string;
    /** method name → DEBT or the reason it cannot grow */
    methods: Record<string, string>;
    /** file → method → count of whole-table calls */
    wholeTableCalls: Record<string, Record<string, number>>;
}

/** Every list method of the composite that nothing bounds. */
export function unboundedMethods(repos: StorageRepository[]): UnboundedMethod[] {
    return repos.flatMap(r => r.methods
        .filter(m => /^(list|getAll)/.test(m.name) && !m.params.some(p => BOUND.test(p)))
        .map(m => ({ name: m.name, repository: r.name, params: m.params, wholeTable: m.params.length === 0 })))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Calls with no arguments of the named methods in one source file: method → count. */
export function wholeTableCalls(file: string, source: string, names: ReadonlySet<string>): Record<string, number> {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out: Record<string, number> = {};
    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.arguments.length === 0) {
            const name = n.expression.name.text;
            if (names.has(name)) out[name] = (out[name] ?? 0) + 1;
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

/** The 1-based line of every ordered `executeTakeFirst()` chain with no `.limit(...)` in one source file. */
export function takeFirstWithoutLimit(file: string, source: string): number[] {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out: number[] = [];
    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
            && /^executeTakeFirst(OrThrow)?$/.test(n.expression.name.text)) {
            const chain = new Set<string>();
            let e: ts.Expression = n.expression.expression;
            while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
                chain.add(e.expression.name.text);
                e = e.expression.expression;
            }
            if (chain.has('orderBy') && !chain.has('limit')) out.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

export interface Verdict {
    newMethods: UnboundedMethod[];
    staleMethods: string[];
    emptyReasons: string[];
    risen: Array<{ file: string; method: string; was: number; now: number }>;
    fallen: Array<{ file: string; method: string; was: number; now: number }>;
}

/** Today's code against the baseline. */
export function compare(methods: UnboundedMethod[], calls: Record<string, Record<string, number>>, base: Baseline): Verdict {
    const names = new Set(methods.map(m => m.name));
    const v: Verdict = {
        newMethods: methods.filter(m => !(m.name in base.methods)),
        staleMethods: Object.keys(base.methods).filter(n => !names.has(n)),
        emptyReasons: Object.entries(base.methods).filter(([, r]) => !r.trim()).map(([n]) => n),
        risen: [], fallen: [],
    };
    const files = new Set([...Object.keys(calls), ...Object.keys(base.wholeTableCalls)]);
    for (const file of files) {
        const now = calls[file] ?? {};
        const was = base.wholeTableCalls[file] ?? {};
        for (const method of new Set([...Object.keys(now), ...Object.keys(was)])) {
            const a = was[method] ?? 0;
            const b = now[method] ?? 0;
            if (b > a) v.risen.push({ file, method, was: a, now: b });
            else if (b < a) v.fallen.push({ file, method, was: a, now: b });
        }
    }
    return v;
}

function sourceFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            const rel = path.relative(root, full).replace(/\\/g, '/');
            if (statSync(full).isDirectory()) {
                if (['src/storage', 'src/static', 'src/generated'].includes(rel) || name === '__tests__' || name === 'node_modules') continue;
                walk(full);
            } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(rel);
        }
    };
    walk(path.join(root, 'src'));
    return out.sort();
}

const POSTGRES_PROVIDER = 'src/storage/providers/postgres-kysely';

function postgresProviderFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(path.relative(root, full).replace(/\\/g, '/'));
        }
    };
    walk(path.join(root, POSTGRES_PROVIDER));
    return out.sort();
}

function main(): void {
    const root = process.cwd();
    const methods = unboundedMethods(storageRepositories(root));
    const whole = new Set(methods.filter(m => m.wholeTable).map(m => m.name));
    const calls: Record<string, Record<string, number>> = {};
    for (const f of sourceFiles(root)) {
        const c = wholeTableCalls(f, readFileSync(path.join(root, f), 'utf-8'), whole);
        if (Object.keys(c).length) calls[f] = c;
    }
    const totalCalls = Object.values(calls).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);

    if (process.argv.includes('--seed')) {
        const prev: Partial<Baseline> = (() => { try { return JSON.parse(readFileSync(path.join(root, BASELINE), 'utf-8')); } catch { return {}; } })();
        const base: Baseline = {
            note: prev.note ?? '',
            methods: Object.fromEntries(methods.map(m => [m.name, prev.methods?.[m.name]
                ?? `DEBT: ${m.repository}.${m.name}(${m.params.join(', ')}) ${m.wholeTable ? 'reads the whole table' : 'returns every match for its scope'}, with no limit or cursor`])),
            wholeTableCalls: calls,
        };
        writeFileSync(path.join(root, BASELINE), JSON.stringify(base, null, 2) + '\n');
        console.log(`seeded ${BASELINE}: ${methods.length} methods, ${totalCalls} whole-table calls in ${Object.keys(calls).length} files`);
        return;
    }

    const base = JSON.parse(readFileSync(path.join(root, BASELINE), 'utf-8')) as Baseline;
    const v = compare(methods, calls, base);
    const takeFirst = postgresProviderFiles(root).flatMap(f =>
        takeFirstWithoutLimit(f, readFileSync(path.join(root, f), 'utf-8')).map(line => `${f}:${line}`));
    const debt = Object.values(base.methods).filter(r => r.startsWith('DEBT')).length;
    console.log(`\n  Unbounded storage lists`);
    console.log(`  ───────────────────────`);
    console.log(`  list methods with nothing to bound them  ${String(methods.length).padStart(4)}   of which read the whole table ${whole.size}`);
    console.log(`  whole-table calls outside src/storage    ${String(totalCalls).padStart(4)}   in ${Object.keys(calls).length} files`);
    console.log(`  baseline entries still DEBT              ${String(debt).padStart(4)}`);
    console.log(`  Postgres take-first reads with no limit  ${String(takeFirst.length).padStart(4)}   allowed 0`);
    const bad = v.newMethods.length + v.staleMethods.length + v.emptyReasons.length + v.risen.length + v.fallen.length + takeFirst.length;
    if (!bad) { console.log('\n  ✓ no new unbounded list, no new whole-table read and no take-first read without a limit; the list only shrinks\n'); return; }

    if (takeFirst.length) {
        console.error('\n  ✖ Ordered take-first reads with no limit (Kysely adds none, so Postgres sends every matching row):');
        for (const at of takeFirst) console.error(`    ${at}`);
        console.error('    Put .limit(1) in the chain before .executeTakeFirst().');
    }

    if (v.newMethods.length) {
        console.error('\n  ✖ New list methods with nothing to bound them:');
        for (const m of v.newMethods) console.error(`    ${m.repository}.${m.name}(${m.params.join(', ')})`);
        console.error('    Give it a limit and a cursor (or an options object that carries them). A list that');
        console.error('    cannot grow goes into the baseline with the reason, never DEBT.');
    }
    if (v.risen.length) {
        console.error('\n  ✖ More whole-table reads than the baseline allows:');
        for (const r of v.risen) console.error(`    ${r.file}  ${r.method}()  ${r.was} → ${r.now}`);
        console.error('    Read the rows you need through a scoped or paged method instead of the whole table.');
    }
    if (v.staleMethods.length || v.fallen.length || v.emptyReasons.length) {
        console.error(`\n  ✖ ${BASELINE} no longer describes the code; lower it so the number cannot rise again:`);
        for (const n of v.staleMethods) console.error(`    method ${n}: bounded or gone, delete its entry`);
        for (const f of v.fallen) console.error(`    ${f.file}  ${f.method}()  ${f.was} → ${f.now}: lower the count`);
        for (const n of v.emptyReasons) console.error(`    method ${n}: an entry without a reason`);
    }
    console.error('');
    process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
