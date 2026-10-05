/**
 * @file scripts/check-storage-file-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A storage method lives in the methods file of the same name in both providers.
 *
 *   WHY. Both providers build their Storage class the same way: each file under methods/ exports
 *   object literals of methods, and the provider's index.ts merges them onto the prototype. Nothing
 *   tied a file in one provider to a file in the other. By October 2026 the SQLite provider had 42
 *   methods files and the Postgres provider about 60, with few names in common, so
 *   `claimScheduledFire` lived in postgres-kysely/methods/schedules.ts and in
 *   sqlite/methods/federation-oauth.ts. A reader who fixed a method in one provider could not find its
 *   twin, and the September audit found defects that had been fixed on one side only. The SQLite files
 *   were renamed and regrouped to mirror the Postgres files (secaudit 2026-10, M8); this check keeps it
 *   that way.
 *
 *   WHAT IT ASSERTS. For each methods file name, the set of methods the SQLite file defines equals the
 *   set the Postgres file defines. A SQLite file may be split as `<name>.ts` plus `<name>-2.ts` (and
 *   `-3`, …) when the Postgres file holds more than 800 lines' worth of SQLite code; the parts count as
 *   one file. A method is a property of an object literal exported with `export const` from a file in
 *   methods/, which is exactly what each index.ts passes to Object.assign. Names compare exactly.
 *
 *   PROVIDER-SPECIFIC MEMBERS. A member that exists in one provider only is declared in that
 *   provider's internals interface (PROVIDER_SPECIFIC below), and that interface is the list: those
 *   members are left out of the comparison and may live in any file. The check fails when a declared
 *   member is no longer defined (the exception is gone), when it is defined twice, or when the other
 *   provider defines it too (it is no longer provider-specific).
 *
 *   IT FAILS ON: a method in a different file than its twin; a method one provider has and the other
 *   does not; a methods file with no twin file; a method defined in two files of one provider; a
 *   spread or computed member, which hides from a reader which file defines what; and a gone, double
 *   or two-sided provider-specific member.
 * @structure PROVIDER_SPECIFIC · readMethodFiles() · readInterface() · main()
 * @usage pnpm check:storage-file-parity
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, M8).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PROVIDERS = {
    sqlite: 'src/storage/providers/sqlite',
    'postgres-kysely': 'src/storage/providers/postgres-kysely',
} as const;
type Provider = keyof typeof PROVIDERS;
const OTHER: Record<Provider, Provider> = { sqlite: 'postgres-kysely', 'postgres-kysely': 'sqlite' };

/**
 * The members one provider has and the other does not. Each provider declares them in an interface
 * its Storage class extends besides Storage, and the members named there are the exceptions.
 */
const PROVIDER_SPECIFIC: { provider: Provider; file: string; iface: string; reason: string }[] = [
    {
        provider: 'sqlite', file: 'src/storage/providers/sqlite/methods/internal.ts', iface: 'SqliteInternals',
        reason: 'Row mappers (deserialize*, map*Row), resolveGhii and the per-identity cascade, bound to the '
            + 'prototype so the method files share them through `this`. Postgres keeps its mappers as module '
            + 'functions inside each methods file, and its cascade in owner-cascade.ts and identity-erasure.ts.',
    },
    {
        provider: 'postgres-kysely', file: 'src/storage/providers/postgres-kysely/index.ts', iface: 'PgKyselyInternals',
        reason: '_rawMemory reads a memory row without the TTL and archive filters for the memory methods; '
            + 'SQLite reads the row inline in each method.',
    },
];

interface Defined { file: string; name: string }

/** The base name a methods file counts under: `memory-2` counts as `memory` when it is a split part. */
function baseName(provider: Provider, file: string, all: Set<string>): string {
    const m = /^(.+)-(\d+)$/.exec(file);
    if (provider === 'sqlite' && m && Number(m[2]) >= 2 && all.has(m[1])) return m[1];
    return file;
}

/** Every member of every `export const X = { … }` in the provider's methods/ directory. */
function readMethodFiles(root: string, provider: Provider, problems: string[]): { files: string[]; defined: Defined[] } {
    const dir = join(root, PROVIDERS[provider], 'methods');
    const files = readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => f.slice(0, -3)).sort();
    const defined: Defined[] = [];
    for (const file of files) {
        const path = join(dir, `${file}.ts`);
        const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        for (const st of sf.statements) {
            if (!ts.isVariableStatement(st)) continue;
            if (!st.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
            for (const decl of st.declarationList.declarations) {
                let init = decl.initializer;
                while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) {
                    init = init.expression;
                }
                if (!init || !ts.isObjectLiteralExpression(init)) continue;
                for (const prop of init.properties) {
                    const where = `${PROVIDERS[provider]}/methods/${file}.ts:${sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1}`;
                    if (ts.isSpreadAssignment(prop)) {
                        problems.push(`${where}: a spread in ${decl.name.getText(sf)} hides which file defines its methods; name them here or bind the group in index.ts`);
                        continue;
                    }
                    const name = prop.name;
                    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) {
                        problems.push(`${where}: a computed member name cannot be compared`);
                        continue;
                    }
                    defined.push({ file, name: name.text });
                }
            }
        }
    }
    return { files, defined };
}

/** The member names an interface declares, read from its file. */
function readInterface(root: string, file: string, iface: string): string[] | null {
    const path = join(root, file);
    const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const st of sf.statements) {
        if (ts.isInterfaceDeclaration(st) && st.name.text === iface) {
            return st.members.map(m => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : '')).filter(Boolean);
        }
    }
    return null;
}

export interface FileParity {
    problems: string[];
    /** Storage methods the SQLite files define, provider-specific members left out. */
    methods: number;
    /** File names present in both providers. */
    pairs: number;
    sqliteOnly: number;
    postgresOnly: number;
}

/** The whole comparison over the tree under `root` (the aimeat/ directory). Pure apart from reading files. */
export function fileParity(root: string): FileParity {
    const problems: string[] = [];
    const read = {
        sqlite: readMethodFiles(root, 'sqlite', problems),
        'postgres-kysely': readMethodFiles(root, 'postgres-kysely', problems),
    };

    // Provider-specific members: declared once, defined once, on one side only.
    const specific: Record<Provider, Set<string>> = { sqlite: new Set(), 'postgres-kysely': new Set() };
    for (const p of PROVIDER_SPECIFIC) {
        const names = readInterface(root, p.file, p.iface);
        if (!names) { problems.push(`${p.file}: interface ${p.iface} not found (listed in PROVIDER_SPECIFIC)`); continue; }
        for (const n of names) {
            specific[p.provider].add(n);
            const here = read[p.provider].defined.filter(d => d.name === n);
            if (here.length === 0) problems.push(`${p.iface}.${n} is listed as ${p.provider}-specific but no ${p.provider} methods file defines it: drop it from ${p.file}`);
            const there = read[OTHER[p.provider]].defined.filter(d => d.name === n);
            if (there.length) problems.push(`${p.iface}.${n} is listed as ${p.provider}-specific but ${OTHER[p.provider]}/methods/${there[0].file}.ts defines it too`);
        }
    }

    // Where each method lives, per provider, by base file name.
    const at: Record<Provider, Map<string, string>> = { sqlite: new Map(), 'postgres-kysely': new Map() };
    const sets: Record<Provider, Map<string, Set<string>>> = { sqlite: new Map(), 'postgres-kysely': new Map() };
    for (const provider of Object.keys(PROVIDERS) as Provider[]) {
        const all = new Set(read[provider].files);
        for (const f of read[provider].files) sets[provider].set(baseName(provider, f, all), sets[provider].get(baseName(provider, f, all)) ?? new Set());
        for (const d of read[provider].defined) {
            const prev = at[provider].get(d.name);
            if (prev !== undefined) {
                problems.push(`${d.name} is defined twice in ${PROVIDERS[provider]}/methods: ${prev}.ts and ${d.file}.ts`);
                continue;
            }
            at[provider].set(d.name, d.file);
            if (specific[provider].has(d.name)) continue;
            sets[provider].get(baseName(provider, d.file, all))!.add(d.name);
        }
    }

    let compared = 0;
    const names = new Set([...sets.sqlite.keys(), ...sets['postgres-kysely'].keys()]);
    for (const name of [...names].sort()) {
        const s = sets.sqlite.get(name);
        const p = sets['postgres-kysely'].get(name);
        if (s && p) compared++;
        for (const provider of Object.keys(PROVIDERS) as Provider[]) {
            const mine = sets[provider].get(name);
            const theirs = sets[OTHER[provider]].get(name);
            if (!mine || mine.size === 0) continue;
            if (!theirs) {
                problems.push(`${PROVIDERS[provider]}/methods/${name}.ts has no twin file ${PROVIDERS[OTHER[provider]]}/methods/${name}.ts`);
                continue;
            }
            for (const m of [...mine].sort()) {
                if (theirs.has(m)) continue;
                const elsewhere = at[OTHER[provider]].get(m);
                problems.push(elsewhere !== undefined
                    ? `${m} is in ${PROVIDERS[provider]}/methods/${name}.ts but in ${PROVIDERS[OTHER[provider]]}/methods/${elsewhere}.ts: move one so both carry the same file name`
                    : `${m} is in ${PROVIDERS[provider]}/methods/${name}.ts and in no ${OTHER[provider]} methods file`);
            }
        }
    }
    // A method reported from both sides as "in the wrong file" is one finding.
    const unique = [...new Set(problems)].filter((line, i, list) => {
        const m = /^(\S+) is in (\S+) but in (\S+):/.exec(line);
        return !m || !list.slice(0, i).some(prev => prev.startsWith(`${m[1]} is in ${m[3]} but in ${m[2]}:`));
    });
    return {
        problems: unique,
        methods: [...sets.sqlite.values()].reduce((n, s) => n + s.size, 0),
        pairs: compared,
        sqliteOnly: specific.sqlite.size,
        postgresOnly: specific['postgres-kysely'].size,
    };
}

function main(): void {
    const result = fileParity(process.cwd());
    if (result.problems.length) {
        console.error(`check:storage-file-parity: ${result.problems.length} problem(s)\n`);
        for (const line of result.problems) console.error(`  ✗ ${line}`);
        console.error('\nA SQLite method lives in the file named like its Postgres twin. Move the whole function; change nothing in it.');
        process.exit(1);
    }
    console.log(`check:storage-file-parity: ${result.methods} methods in ${result.pairs} file pairs agree; `
        + `${result.sqliteOnly} SQLite-only and ${result.postgresOnly} Postgres-only members declared.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
