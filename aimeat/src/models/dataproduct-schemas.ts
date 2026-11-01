/**
 * @file src/models/dataproduct-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The zod shape of a data product definition body: PUT /v1/dataproducts/{name} and a
 *   draft preview validate it (validateBody), and the catalog entry of aimeat_dataproduct takes its
 *   field schemas from here, so the REST body and the MCP arguments are bounded alike. The meaning of
 *   each field is checked once more by services/dataproduct/definition.ts normaliseDefinition.
 * @structure DataProductSourceSchema · DataProductCombineSchema · DataProductColumnsSchema ·
 *   DataProductFilterSchema · DataProductScheduleSchema · DataProductVisibilitySchema ·
 *   DataProductBodySchema · DataProductRunBodySchema
 * @usage router.put('/v1/dataproducts/:name', ..., validateBody(DataProductBodySchema, config.nodeId), handler)
 * @version-history
 *   v1.1.0 — 2026-11-01 — `retention` { keep, unit } (WP9a).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from './input-limits.js';

const id = z.string().max(INPUT_LIMITS.id);
const name = z.string().max(INPUT_LIMITS.name);
const key = z.string().max(INPUT_LIMITS.key);

export const DataProductSourceSchema = z.object({
    id: z.string().max(16).optional(),
    kind: z.enum(['records', 'app', 'memory', 'extension', 'file', 'datapackage']),
    organism_id: id.optional(), ws: id.optional(), space: name.optional(),
    app: name.optional(), key_prefix: key.optional(),
    key: key.optional(), owner: id.optional(), rows_at: key.optional(),
    ext: name.optional(), action: name.optional(), input: z.record(z.string(), z.unknown()).optional(), instance_id: id.optional(),
    sheet: name.optional(), name: name.optional(), resource: name.optional(), resource_name: name.optional(),
    columns: z.union([z.array(name), z.record(z.string(), key)]).optional(),
});

export const DataProductCombineSchema = z.object({
    mode: z.enum(['tables', 'union', 'join']),
    key: z.object({ left: name, right: z.union([name, z.array(name).max(10)]) }).optional(),
});

export const DataProductColumnsSchema = z.array(z.object({
    source: z.string().max(16), from: name, name: name.optional(),
    type: z.enum(['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'any']).optional(),
    description: z.string().max(INPUT_LIMITS.line).optional(), include: z.boolean().optional(),
})).max(500);

export const DataProductFilterSchema = z.object({
    column: name, op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']), value: z.unknown(),
}).nullable();

export const DataProductScheduleSchema = z.object({ cron: name, timezone: name.optional() }).nullable();

export const DataProductRetentionSchema = z.object({ keep: z.number().int().min(1).max(1000), unit: z.enum(['versions', 'months']).optional() }).nullable();

export const DataProductVisibilitySchema = z.string().regex(/^(private|members|public|organism:[A-Za-z0-9][A-Za-z0-9_-]{0,127})$/).max(INPUT_LIMITS.id);

export const DataProductBodySchema = z.object({
    title: z.string().max(INPUT_LIMITS.title).optional(),
    description: z.string().max(INPUT_LIMITS.description).optional(),
    keywords: z.array(name).max(20).optional(),
    license: name.optional(),
    sources: z.array(DataProductSourceSchema).min(1).max(10).optional(),
    combine: DataProductCombineSchema.optional(),
    columns: DataProductColumnsSchema.optional(),
    filter: DataProductFilterSchema.optional(),
    schedule: DataProductScheduleSchema.optional(),
    retention: DataProductRetentionSchema.optional(),
    visibility: DataProductVisibilitySchema.optional(),
    confirm_personal_public: z.boolean().optional(),
}).strict();

/** POST /v1/dataproducts/{name}/run takes no fields. */
export const DataProductRunBodySchema = z.object({}).strict().optional();
