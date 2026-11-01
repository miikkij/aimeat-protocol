/**
 * @file scripts/inventory/doors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every door in the source, with the classes of caller that reach it — the one place
 *   that assembles them, for the report and for the gates alike.
 *
 *   WHY IT IS SHARED. The door collection was private to `build-inventory.ts`, which meant a gate
 *   asking a question about doors could either copy it or not exist. `check:open-writes` chose not to
 *   exist, and the triage that would have fed it (docs/internal/n2-triage-avoimet-kirjoitusovet.md)
 *   says so in as many words: copying would have failed `check:copied-logic`, and extracting was a
 *   second edit to a file another session was working in.
 *
 *   The report and the gate must agree by construction. Two lists of "which doors are reachable
 *   without a credential" that drift apart is the same defect both of them exist to count.
 *
 *   THE GUARD ARRAYS ARE RESOLVED ACROSS THE WHOLE TREE FIRST, and that is not an optimisation: a
 *   chain declared in one module and spread in another reads as ungated when files are resolved one
 *   at a time, and wrong-in-the-permissive-direction is the one kind of wrong an inventory must not
 *   be. Across the tree does not mean one namespace: a route file sees its own declarations first,
 *   then its named imports, and the tree only for a name one file alone declares (guardArraysFor).
 * @structure
 *   - Row: an EntryPoint plus who reaches it
 *   - guardArraysFor(): the guard arrays one route file can see
 *   - collectDoors(): every door, from the compiler's file list
 *   - toRows(): the principal classes for each
 * @version-history
 *   v1.1.0 — 2026-11-01 — Guard arrays resolve per route file (own, imported, then a tree-wide name only
 *     when one file declares it) instead of one map keyed by the bare name, where the file read last
 *     won. Option (a) of Platform Development Notes doc-mvwzwmlgno91: refusing a duplicated name, (b),
 *     would have failed on `operator`, which several route files declare on purpose.
 *   v1.0.0 — 2026-09-04 — Extracted from build-inventory.ts so a gate can ask the same question.
 */
import ts from 'typescript';
import { posix } from 'node:path';
import { collectRestRoutes, collectMcpTools, collectCliDispatch, guardArraysIn, type EntryPoint } from './entries.js';
import { principalsFor, isPublic, type Principal } from './principals.js';
import { AIMEAT } from './program.js';

export interface Row extends EntryPoint {
    principals: Principal[];
    unknownGuards: string[];
    scopes: string[];
    /** Reachable by a caller carrying no credential at all. */
    public: boolean;
}

type GuardArrays = ReturnType<typeof guardArraysIn>;

const slashes = (p: string): string => p.split('\\').join('/');

/** The file a relative import specifier names, as the compiler lists it (`./x.js` → `<dir>/x.ts`). */
function importTarget(from: string, spec: string): string[] {
    const base = posix.normalize(posix.join(posix.dirname(slashes(from)), spec));
    const stem = base.replace(/\.(m?js|ts)$/, '');
    return [`${stem}.ts`, `${stem}/index.ts`];
}

/**
 * The guard arrays a route file can see, in the order the language resolves the name: the file's own
 * declarations, then what it imports by name from a relative module, then the rest of the tree.
 *
 * The last step is the cross-file case in the header, and it is taken only for a name exactly one
 * file declares. A name declared in two files that the route neither declares nor imports is left
 * unresolved, so the row reads as unknown and the gate reports it, rather than taking whichever file
 * was read last. Until 2026-11-01 one tree-wide map keyed by the bare name did that: declaring
 * `operator` in build-with-you.ts changed the resolved chains of four other route files that use their
 * own `operator` (46a96ad53).
 */
export function guardArraysFor(files: ts.SourceFile[]): (source: ts.SourceFile) => GuardArrays {
    const byFile = new Map<string, GuardArrays>();
    const declaredIn = new Map<string, number>();
    for (const source of files) {
        const found = guardArraysIn(source);
        byFile.set(slashes(source.fileName), found);
        for (const name of found.keys()) declaredIn.set(name, (declaredIn.get(name) ?? 0) + 1);
    }
    const unique: GuardArrays = new Map();
    for (const found of byFile.values()) for (const [name, guards] of found) if (declaredIn.get(name) === 1) unique.set(name, guards);

    return (source) => {
        const seen = new Map(unique);
        for (const statement of source.statements) {
            if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
            const spec = statement.moduleSpecifier.text;
            const named = statement.importClause?.namedBindings;
            if (!spec.startsWith('.') || !named || !ts.isNamedImports(named)) continue;
            const target = importTarget(source.fileName, spec).map(p => byFile.get(p)).find(Boolean);
            if (!target) continue;
            for (const el of named.elements) {
                const guards = target.get((el.propertyName ?? el.name).text);
                if (guards) seen.set(el.name.text, guards);
            }
        }
        for (const [name, guards] of byFile.get(slashes(source.fileName)) ?? []) seen.set(name, guards);
        return seen;
    };
}

export function collectDoors(files: ts.SourceFile[]): EntryPoint[] {
    const out: EntryPoint[] = [];

    // Guard arrays first, from every file. See the header: per-file resolution is wrong in the
    // permissive direction, so a route file sees its own, its imports' and the tree's (guardArraysFor).
    const arraysFor = guardArraysFor(files);

    for (const source of files) {
        const path = source.fileName;
        if (path.includes('/src/routes/')) out.push(...collectRestRoutes(source, AIMEAT, arraysFor(source)));
        if (path.includes('/src/mcp/')) out.push(...collectMcpTools(source, AIMEAT, 'mcp.node'));
        if (path.includes('/src/cli/connect/mcp/')) out.push(...collectMcpTools(source, AIMEAT, 'mcp.connector'));
        if (/tool-call-defs-.*\.ts$/.test(path)) out.push(...collectCliDispatch(source, AIMEAT));
    }
    return out;
}

export function toRows(entries: EntryPoint[]): Row[] {
    return entries.map(e => {
        const { principals, unknown, scopes } = principalsFor(e.guards);
        // Only a REST door has a middleware chain; the other kinds are gated elsewhere, so their
        // principal set is left empty rather than reported as "everyone".
        const applies = e.kind === 'rest';
        return {
            ...e,
            principals: applies ? principals : [],
            unknownGuards: applies ? unknown : [],
            scopes: applies ? scopes : [],
            public: applies ? isPublic(principals) : false,
        };
    });
}

/**
 * The REST doors that WRITE and admit a caller with no credential.
 *
 * Federation is excluded and stays with `check:federation-signatures`, on the neighbouring session's
 * call and for the reason it gave: two gates over one population means two lists that drift, which is
 * the defect both of them are counting.
 */
export function openWriteDoors(rows: Row[]): Row[] {
    return rows.filter(r =>
        r.kind === 'rest'
        && r.public
        && !r.id.startsWith('GET ')
        && !r.id.includes('/v1/federation/')
        && !r.file.includes('/federation'));
}
