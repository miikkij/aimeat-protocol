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
 *   be.
 * @structure
 *   - Row: an EntryPoint plus who reaches it
 *   - collectDoors(): every door, from the compiler's file list
 *   - toRows(): the principal classes for each
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted from build-inventory.ts so a gate can ask the same question.
 */
import ts from 'typescript';
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

export function collectDoors(files: ts.SourceFile[]): EntryPoint[] {
    const out: EntryPoint[] = [];

    // Guard arrays first, from every file. See the header: per-file resolution is wrong in the
    // permissive direction.
    const arrays = new Map<string, ReturnType<typeof guardArraysIn> extends Map<string, infer V> ? V : never>();
    for (const source of files) for (const [name, guards] of guardArraysIn(source)) arrays.set(name, guards);

    for (const source of files) {
        const path = source.fileName;
        if (path.includes('/src/routes/')) out.push(...collectRestRoutes(source, AIMEAT, arrays));
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
