/**
 * @file src/services/dataproduct/source-common.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What every data product source resolves to, and the helpers the six source readers
 *   share: the flat table, the audience a stored visibility allows, and the refusals that name the
 *   source (plan doc-mvwxcas3dom3, D9.1).
 *
 *   THE AUDIENCE OF A SOURCE is the widest audience a product built from it may have. A private memory
 *   key, a private file and an organism workspace each cap it, so a public product from them is refused
 *   (./build.ts). It is read from what the source itself says: a record's or a file's visibility, a
 *   package's audience, the organism of a workspace.
 * @structure ResolvedSource · SourceDeps · tableOf · audienceOfStored · sourceError · needWord · AUDIENCE_RANK
 * @usage const t = tableOf(spec.id, rows, types);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9.1).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import type { FieldType } from '../datapackage/contract.js';
import { mapColumns } from '../workflow/engine-step-rows.js';
import { DataProductError, type SourceColumns, type SourceKind, type SourceSpec } from './definition.js';
import { flatRow, type SourceTable } from './combine.js';

export interface SourceDeps { storage: Storage; config: AimeatConfig }

/** One source, read: its table, how wide an audience it allows, and what the package says about it. */
export interface ResolvedSource extends SourceTable {
    audience: string;
    provenance: { kind: SourceKind; address: string; title?: string; license?: string };
    /** The `pkg:owner/name@sha256:...` of a datapackage source, for the new version's lineage. */
    lineage?: string;
    fetchedAt: string;
}

/** What a source reader takes. */
export interface SourceCall {
    deps: SourceDeps;
    caller: CallerContext;
    spec: SourceSpec;
    /** The product's package name, for the extension source's personal-data check. */
    productName: string;
}

/** A refusal that names the source it came from. */
export function sourceError(spec: SourceSpec, code: string, message: string, status = 400): DataProductError {
    return new DataProductError(code, `Source ${spec.id} (${spec.kind}): ${message}`, status, spec.id);
}

/** A principal other than the owner in person needs the word the direct read of this source asks. */
export function needWord(call: SourceCall, word: string): void {
    if (!call.caller.has(word)) {
        throw sourceError(call.spec, 'SCOPE_DENIED', `reading this source needs the "${word}" permission, as reading it directly does. Ask the owner to grant it.`, 403);
    }
}

/** Rows through the source's own `columns` (a list to keep, or column → dotted path), then flat. */
export function shapeRows(rows: unknown[], columns: SourceColumns | undefined): Array<Record<string, unknown>> {
    const objects = rows.map(r => (r && typeof r === 'object' && !Array.isArray(r) ? r as Record<string, unknown> : { value: r }));
    if (!columns) return objects.map(flatRow);
    if (Array.isArray(columns)) return objects.map(r => flatRow(Object.fromEntries(columns.map(c => [c, r[c] ?? null]))));
    return objects.map(r => flatRow(mapColumns(r, columns)));
}

/** The flat table of one source: columns in first-seen order, every row carrying every column. */
export function tableOf(
    id: string, rows: Array<Record<string, unknown>>, types: Record<string, FieldType | undefined> = {},
    personal: ReadonlySet<string> = new Set(), order: string[] = [],
): SourceTable {
    const columns = [...order];
    const seen = new Set(columns);
    for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push(k); }
    const full = rows.map(r => Object.fromEntries(columns.map(c => [c, r[c] ?? null])));
    return { id, rows: full, columns, types, personal };
}

/** The audience a stored memory record or file allows a product built from it. */
export function audienceOfStored(visibility: string | undefined): string {
    if (visibility === 'public' || visibility === 'members') return visibility;
    if (typeof visibility === 'string' && visibility.startsWith('organism:')) return visibility;
    return 'private';
}

/** How wide an audience is: private < organism < members < public. */
export function audienceRank(a: string): number {
    return a === 'public' ? 3 : a === 'members' ? 2 : a.startsWith('organism:') ? 1 : 0;
}

/** The narrowest of several audiences; two different organisms narrow to private. */
export function narrowest(audiences: string[]): string {
    let out = 'public';
    for (const a of audiences) {
        if (audienceRank(a) < audienceRank(out)) out = a;
        else if (a.startsWith('organism:') && out.startsWith('organism:') && a !== out) out = 'private';
    }
    return out;
}

/** May a product at `wanted` be built from a source that allows `cap`? */
export function audienceFits(wanted: string, cap: string): boolean {
    if (wanted === 'private') return true;
    if (audienceRank(wanted) > audienceRank(cap)) return false;
    if (wanted.startsWith('organism:') && cap.startsWith('organism:')) return wanted === cap;
    return true;
}
