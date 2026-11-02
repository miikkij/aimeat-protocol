/**
 * @file dataproduct.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for aimeat_dataproduct: define, read, preview, run and delete a data
 *   product, the definition that builds a data package version from material the owner holds (plan
 *   doc-mvwxcas3dom3, D9). One name with an `action`, as the goal and compliance tools do, because the
 *   six actions share one shape and every name has to stay in step on three surfaces.
 * @structure dataProductTools · DATAPRODUCT_ACTIONS
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.3.0 — 2026-11-01 — `attribution` and `i18n`; the description may be Markdown (WP10e).
 *   v1.2.0 — 2026-11-01 — `schedule: { on: "change" }`; action "describe" with `lang` (WP9c).
 *   v1.1.0 — 2026-11-01 — `retention`; "list" says what each row carries (WP9a).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';
import {
    DataProductSourceSchema, DataProductCombineSchema, DataProductColumnsSchema, DataProductFilterSchema,
    DataProductScheduleSchema, DataProductRetentionSchema, DataProductVisibilitySchema, DataProductI18nSchema,
} from '../../models/dataproduct-schemas.js';

export const DATAPRODUCT_ACTIONS = ['define', 'get', 'list', 'preview', 'run', 'delete', 'describe'] as const;

export const dataProductTools = [
    {
        name: 'aimeat_dataproduct',
        description: 'Make a data product: a definition that builds a data package (a table at a permanent address, with versions, provenance and an ODPS sheet) from material the person already has, and rebuilds it on a schedule. '
            + 'When the person asks for one ("make a data product of the municipal budget signals, update it on Mondays"), find the material first (aimeat_discover, aimeat_workspace_read), then call action "define" with the sources and the schedule, then action "preview" and tell the person what the rows look like and who will read them. Run it when they agree. '
            + 'action "define" { name, sources, combine?, columns?, filter?, schedule?, visibility?, title?, description?, keywords?, license?, attribution?, i18n? } stores the definition (REPLACES one of the same name, so send every field again: "get" first, change what you need, define, then "run" to publish the change) after reading every source as you; '
            + 'the description may be Markdown (paragraphs, headings, lists, links), which the public dataset page renders; i18n carries the title, description and attribution per language; '
            + '"preview" { name } builds it without publishing: the first 20 rows of each resource, the row counts, the Table Schema, the validation result and the ODPS sheet the version would get (pass the definition fields too to preview a draft without storing it); '
            + '"run" { name } builds and publishes one version (the same rows give no new version: unchanged true); "get"; "list" (each product with its freshness: fresh, late, stale or unscheduled; its audience, live named shares and reads in the last seven days, which answers "what data do I offer", "is any of it stale" and "who reads my data"); "delete" (removes the definition and its schedule; the package stays); "describe" { name, lang?, and the definition fields for a draft } asks the person\'s own AI for a two- or three-sentence description from the name, the sources and the columns (no row is sent; needs ai:use): a draft for the person to change, AI-written, with its provenance record. '
            + 'SOURCES, each { id (A, B...), kind, ... }: records { organism_id, ws, space } (each published record of a workspace records space is a row); app { app, key_prefix, rows_at? } (an app\'s data, only the families its data map marks publishable); memory { key, rows_at?, owner? } (the array at rows_at of one record); extension { ext, action, input?, rows_at? } (an extension action the node runs); file { key, sheet? } (a stored CSV or XLSX); datapackage { name, owner?, resource? } (another data package; it goes into the lineage). '
            + 'A source may name `columns`: a list to keep, or { column: "dotted.path" } to flatten nested values. '
            + 'COMBINE: "tables" (each source its own resource; the default with one source), "union" (rows appended; the columns must match), "join" with key { left: "A.kunta", right: "B.kunta" } (a left join of the first source; unmatched rows kept with nulls; a right key on several rows is refused). '
            + 'columns [{ source, from, name?, type?, description?, include? }] maps the output; filter { column, op eq|ne|gt|gte|lt|lte|contains|in, value } keeps rows; schedule { cron, timezone? } rebuilds on a clock ("0 6 * * 1" is Mondays at 06:00), { on: "change" } rebuilds when a source changes (a records space, an app\'s data, a memory key, a file or another package; at most once every five minutes; refused with NO_CHANGE_SIGNAL for a product with an extension source), null builds on demand only. '
            + 'WHO READS IT: visibility private (the default), members, organism:<id> or public; it may not be wider than its narrowest source (a private record or an organism workspace refuses public with AUDIENCE_WIDER_THAN_SOURCE). A column the data map marks personal is left out unless columns names it with include true, and then public is refused with PERSONAL_DATA_PUBLIC until the person confirms (confirm_personal_public true). '
            + 'Reading needs storage:read; define, run and delete need storage:write and memory:write; each source needs the permission its own read needs (organism:read, memory:read, ext:invoke, storage:read).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Data products: define, preview, run', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        // The read word: every action needs at least it. define, run and delete ask storage:write and
        // memory:write in the service, as PUT, POST .../run and DELETE /v1/dataproducts/{name} ask.
        scope: 'storage:read',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            action: { type: 'string', required: true, enum: [...DATAPRODUCT_ACTIONS], description: 'What to do. Start with "define", then "preview".' },
            name: { type: 'string', description: 'The product, which is also the package name: lowercase letters, digits and dashes. Every action but list.', zod: z.string().max(64) },
            title: { type: 'string', description: 'For define: a human title for the package.', zod: z.string().max(INPUT_LIMITS.title) },
            description: { type: 'string', description: 'For define: what the package contains, for a person deciding whether to use it.', zod: z.string().max(INPUT_LIMITS.description) },
            keywords: { type: 'array', description: 'For define: keywords, which the catalogue and DCAT list.', zod: z.array(z.string().max(INPUT_LIMITS.name)).max(20) },
            license: { type: 'string', description: 'For define: the licence id: CC-BY-4.0, CC0-1.0 or proprietary (the node resolves these to the licence deed and name), or another SPDX id or licence URL.', zod: z.string().max(INPUT_LIMITS.name) },
            attribution: { type: 'string', description: 'For define: who to credit and how, in your words (CC BY asks for it), e.g. "Source: Finnish Medicines Agency Fimea, CC BY 4.0".', zod: z.string().max(INPUT_LIMITS.line) },
            i18n: { type: 'object', description: 'For define: the title, description and attribution per language, { fi: { title, description, attribution }, en: {...}, es: {...} }. Every field optional; a reader whose language is missing gets the base title and description. The description may be Markdown (headings, lists, links).', zod: DataProductI18nSchema },
            sources: { type: 'array', description: 'For define: one to ten sources, as the description lists.', zod: z.array(DataProductSourceSchema).min(1).max(10) },
            combine: { type: 'object', description: 'For define: { mode: tables | union | join, key?: { left: "A.col", right: "B.col" or a list } }.', zod: DataProductCombineSchema },
            columns: { type: 'array', description: 'For define: the output columns [{ source, from, name?, type?, description?, include? }]. Omit to keep every column of every source.', zod: DataProductColumnsSchema },
            filter: { type: 'object', description: 'For define: { column, op, value } keeps the rows that pass; null removes the filter.', zod: DataProductFilterSchema },
            schedule: { type: 'object', description: 'For define: { cron, timezone? } rebuilds the product on a clock; { on: "change" } rebuilds it when a source changes; null builds on demand only.', zod: DataProductScheduleSchema },
            retention: { type: 'object', description: 'For define: { keep, unit? } keeps that many earlier versions (unit "versions", the default) or that many months of them; null or absent keeps every version. A version a share pins stays regardless.', zod: DataProductRetentionSchema },
            visibility: { type: 'string', description: 'For define: private (the default), members, organism:<id> or public.', zod: DataProductVisibilitySchema },
            lang: { type: 'string', enum: ['en', 'fi', 'es'], description: 'For describe: the language of the draft (default en).' },
            confirm_personal_public: { type: 'boolean', description: 'For define: the person agreed that a public product carries the columns the data map marks personal.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
