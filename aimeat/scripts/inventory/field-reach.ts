/**
 * @file scripts/inventory/field-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Question C of wish-invarianttiauditointi, in the shape the finding actually had:
 *   which SURFACES can set a field, and which fields only one of them can.
 *
 *   THE FINDING THIS IS SHAPED BY. `run_mode` had a door in HTTP and not one an agent could reach.
 *   `mode`, the field beside it on the same record, was on three surfaces. Nothing was wrong with
 *   either door; what was wrong is that a field gained one and not the others, and no instrument
 *   asked. Name parity (check:mcp-tools) proves the TOOLS match. Parameter parity
 *   (check:mcp-schemas) proves the tools' own inputs match each other. Neither compares a field to
 *   the REST route that also writes it, which is the axis run_mode fell through.
 *
 *   HOW IT IS MEASURED. The record types are the vocabulary — a field is what a record holds — and
 *   for each field the question is which surface files mention it: the REST routes, the node MCP,
 *   the connector MCP, the CLI dispatch. A field mentioned by REST and by nothing else is a
 *   candidate: it can be set by a person with a browser and by nothing acting on their behalf.
 *
 *   WHY MENTIONS AND NOT WRITES. Proving a surface WRITES a field means following the value into
 *   storage, which is the call graph this phase does not build yet. Mentions overreport — a field
 *   named in a response is counted like one named in a request — and that is the safe direction
 *   here: overreporting costs a read, underreporting hides the next run_mode. The report says so
 *   rather than implying precision it does not have.
 * @structure recordFields(files) · fieldReach(files, fields)
 * @usage const reach = fieldReach(sourceFiles, recordFields(sourceFiles));
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, question C).
 */
import ts from 'typescript';

/** Surfaces a field can be reached from, in the order a person would ask about them. */
export type Surface = 'rest' | 'mcp.node' | 'mcp.connector' | 'cli.dispatch';

export interface FieldReach {
    field: string;
    /** The record interfaces that declare it. */
    records: string[];
    /** Which surfaces mention it at all. */
    surfaces: Surface[];
    /** One example file per surface, so a row can be opened. */
    examples: Partial<Record<Surface, string>>;
}

/** Which surface a file belongs to, or null when it is neither. */
function surfaceOf(fileName: string): Surface | null {
    if (fileName.includes('/src/cli/connect/mcp/')) return 'mcp.connector';
    if (/tool-call-defs-.*\.ts$/.test(fileName)) return 'cli.dispatch';
    if (fileName.includes('/src/mcp/')) return 'mcp.node';
    if (fileName.includes('/src/routes/')) return 'rest';
    return null;
}

/**
 * Every field name declared by a record interface under storage/types.
 *
 * Short and very common names are dropped: `id`, `name`, `key` and their like appear in every file
 * on every surface and answer nothing. The list is about fields specific enough that "only one
 * surface names this" means something.
 */
export function recordFields(files: readonly ts.SourceFile[]): Map<string, string[]> {
    const COMMON = new Set(['id', 'name', 'key', 'type', 'value', 'data', 'url', 'owner', 'status',
        'title', 'description', 'content', 'version', 'createdAt', 'updatedAt', 'gaii', 'scopes', 'tags']);
    const out = new Map<string, string[]>();

    for (const source of files) {
        if (!source.fileName.includes('/src/storage/types/')) continue;
        const visit = (node: ts.Node): void => {
            if (ts.isInterfaceDeclaration(node) && /Record$/.test(node.name.text)) {
                for (const member of node.members) {
                    if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
                        const field = member.name.text;
                        if (field.length < 5 || COMMON.has(field)) continue;
                        out.set(field, [...(out.get(field) ?? []), node.name.text]);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return out;
}

/**
 * Which surfaces mention each field.
 *
 * Both spellings are searched: a record field is camelCase and the wire name for the same thing is
 * usually snake_case (`runMode` on the record, `run_mode` on the tool). Searching only one of them
 * would have reported every field as REST-only, which is the failure this file's own subject is
 * about.
 */
export function fieldReach(files: readonly ts.SourceFile[], fields: Map<string, string[]>): FieldReach[] {
    const snake = (s: string): string => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    const seen = new Map<string, { surfaces: Set<Surface>; examples: Partial<Record<Surface, string>> }>();
    for (const f of fields.keys()) seen.set(f, { surfaces: new Set(), examples: {} });

    for (const source of files) {
        const surface = surfaceOf(source.fileName);
        if (surface === null) continue;
        const text = source.getText();
        for (const [field, entry] of seen) {
            if (entry.surfaces.has(surface)) continue;
            const a = new RegExp(`\\b${field}\\b`);
            const b = new RegExp(`\\b${snake(field)}\\b`);
            if (a.test(text) || b.test(text)) {
                entry.surfaces.add(surface);
                entry.examples[surface] = source.fileName.split('/aimeat/').pop() ?? source.fileName;
            }
        }
    }

    return [...seen.entries()].map(([field, entry]) => ({
        field,
        records: fields.get(field) ?? [],
        surfaces: [...entry.surfaces],
        examples: entry.examples,
    }));
}
