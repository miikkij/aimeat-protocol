/**
 * @file src/tool-catalog/zod-shape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The input schema of a tool, built from its catalog entry, for both MCP surfaces
 *   (secaudit 2026-10, M3). The node surface (`src/mcp/`) registers `zodShapeFor(name)`; the
 *   connector (`src/cli/connect/mcp/tools/`) registers the same plus its own `agent_name`. Before
 *   this each surface wrote its own zod shape by hand: 2,450 `.describe()` calls, 82 tools whose two
 *   schemas disagreed, and the catalog's input metadata was a third copy of the same fields.
 *
 *   A field is its `zod` schema when the catalog gives one, else the schema its coarse `type` and
 *   `enum` state. It is optional unless `required`, or unless the schema already takes undefined
 *   (a default, `z.unknown()`), and it carries the catalog's description. A tool that
 *   `supportsResponseFormat` gets `response_format`.
 *
 *   `pnpm check:mcp-schemas` compares the whole schema each surface registers with this one, so a
 *   surface that writes its own again is found.
 * @structure zodShapeFor(name) · fieldSchema(field)
 * @usage mcp.tool('aimeat_board_post', descriptionFor('aimeat_board_post'), zodShapeFor('aimeat_board_post'), annotationsFor('aimeat_board_post'), handler)
 * @version-history
 *   v1.0.1 — 2026-10-05 — A field that is not required gets `.optional()` unless its schema is
 *     optional on input already (a default). `z.unknown()` takes undefined, and the earlier test on
 *     that let a JSON Schema reader see the field as required.
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, M3).
 */
import { z } from 'zod';
import { getAimeatToolDefinition, type CatalogTool } from './definitions.js';
import type { ToolInputField } from './definitions/types.js';
import { responseFormatSchema, type ResponseFormat } from './shape.js';

// ── Types: a handler's arguments, read from the catalog entry ──
// A group file declared `as const satisfies readonly AimeatToolDefinition[]` keeps each entry's
// literal type, so the handler of `mcp.tool(name, …, zodShapeFor(name), …)` gets each field's type.
// An entry of a group not declared that way types every argument as unknown.

type FieldValue<F> =
    F extends { zod: infer S extends z.ZodType } ? z.output<S>
    : F extends { enum: readonly (infer E)[] } ? E
    : F extends { type: 'string' } ? string
    : F extends { type: 'number' } ? number
    : F extends { type: 'boolean' } ? boolean
    : F extends { type: 'array' } ? unknown[]
    : F extends { type: 'object' } ? Record<string, unknown>
    : unknown;

/** Present in what the handler gets: required, or a schema that fills a default in. */
type AlwaysThere<F> =
    F extends { required: true } ? true
    : F extends { zod: infer S extends z.ZodType } ? (undefined extends z.output<S> ? false : undefined extends z.input<S> ? true : false)
    : false;

type FieldSchema<F> = z.ZodType<AlwaysThere<F> extends true ? FieldValue<F> : FieldValue<F> | undefined>;

type DefinitionOf<N extends string> = Extract<CatalogTool, { name: N }>;

export type ToolShape<N extends string> = [DefinitionOf<N>] extends [never]
    ? Record<string, z.ZodType>
    : { -readonly [K in keyof DefinitionOf<N>['input']]: FieldSchema<DefinitionOf<N>['input'][K]> }
        & (DefinitionOf<N> extends { supportsResponseFormat: true } ? { response_format: z.ZodType<ResponseFormat | undefined> } : unknown);

function coarseSchema(field: ToolInputField): z.ZodType {
    if (field.enum?.length) return z.enum(field.enum as [string, ...string[]]);
    switch (field.type) {
        case 'string': return z.string();
        case 'number': return z.number();
        case 'boolean': return z.boolean();
        case 'array': return z.array(z.unknown());
        case 'object': return z.record(z.string(), z.unknown());
        default: return z.unknown();
    }
}

/** One field's schema: its exact or coarse type, optional unless required, with its description. */
export function fieldSchema(field: ToolInputField): z.ZodType {
    let schema = field.zod ?? coarseSchema(field);
    // Optional unless required, or unless the schema is optional already on input (a default):
    // `z.unknown()` takes undefined too, but a JSON Schema reader lists it as required without this.
    if (!field.required && (schema as { _zod?: { optin?: string } })._zod?.optin !== 'optional') schema = schema.optional();
    return field.description ? schema.describe(field.description) : schema;
}

/** The input shape of a catalog tool, for `mcp.tool(name, description, shape, …)`. Throws when the catalog lacks it. */
export function zodShapeFor<N extends string>(name: N): ToolShape<N> {
    const def = getAimeatToolDefinition(name);
    if (!def) throw new Error(`Missing tool definition for "${name}" in src/tool-catalog/definitions/: the catalog is the input schema of both MCP surfaces.`);
    const shape: Record<string, z.ZodType> = {};
    for (const [key, field] of Object.entries(def.input)) shape[key] = fieldSchema(field);
    if (def.supportsResponseFormat) shape.response_format = responseFormatSchema;
    return shape as ToolShape<N>;
}
