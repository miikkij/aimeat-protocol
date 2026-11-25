/**
 * @file src/tool-catalog/definitions/knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for the knowledge package tools: list, get, create, contribute and
 *   links. A knowledge package is refined knowledge kept as memory records under packages/<id>/ (a
 *   manifest and one record per entry); the component packages (aimeat_package_*) and the data
 *   packages (aimeat_datapackage_*) are other things, and each description says so (package-kinds.ts).
 * @structure knowledgeTools
 * @usage spread into capabilitiesGroupsSkillsTools (./capabilities-groups-skills.ts) where the four
 *   tools stood, so CLI_FALLBACK_TOOL_DEFINITIONS keeps its order.
 * @version-history
 *   v1.0.0 — 2026-11-25 — The four knowledge tools moved unchanged from ./capabilities-groups-skills.ts
 *     (max-file-lines), and aimeat_knowledge_create joins them: POST /v1/knowledge/import over MCP,
 *     which an agent could not reach (wish-knowledge-package-luonti-mcp-hen-ja-sana-package-yksiselitte).
 *     Each description names the kind of package with KNOWLEDGE_PACKAGE_KIND.
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import { KNOWLEDGE_CONTENT_TYPES } from '../../schemas/knowledge-package.js';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';
import { KNOWLEDGE_PACKAGE_KIND } from './package-kinds.js';

/** One entry of a package being created: the manifest line, with its content inline as `value`. */
const CREATE_ENTRY = z.object({
    key: z.string().min(1).max(INPUT_LIMITS.key),
    title: z.string().max(INPUT_LIMITS.title).optional(),
    value: z.unknown().optional(),
    visibility: z.string().max(INPUT_LIMITS.name).optional(),
}).passthrough();

export const knowledgeTools = [
    {
        name: 'aimeat_knowledge_list',
        description: 'List knowledge packages owned across your scope (your GHII and same-owner agents) — curated memory collections under "packages/", each with name, content type, tags, and entry count. Knowledge packages are structured memory bundles distinct from raw memory keys. Create one with aimeat_knowledge_create, read one with aimeat_knowledge_get, add to one with aimeat_knowledge_contribute.' + KNOWLEDGE_PACKAGE_KIND,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Knowledge Packages', readOnlyHint: true },
        // Package manifests and entries are memory records: read with the word aimeat_memory_read asks
        // (secaudit 2026-10, v56). The resource aimeat://knowledge/{id} takes aimeat_knowledge_get's.
        scope: 'memory:read',
        surfaces: ['agent', 'service'],
        input: {},
    },
    {
        name: 'aimeat_knowledge_get',
        description: 'Get a knowledge package by id: its manifest plus every entry with the entry values inlined. Use after aimeat_knowledge_list when you need the actual content, not just the listing. To see relationships to other packages use aimeat_knowledge_links.' + KNOWLEDGE_PACKAGE_KIND,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Knowledge Package', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent', 'service'],
        input: { package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' } },
    },
    {
        // POST /v1/knowledge/import, through the service it calls (services/knowledge/package-import.ts).
        name: 'aimeat_knowledge_create',
        description: 'Create a new knowledge package: research, notes, a guide or a dataset kept as one named, versioned collection in the owner\'s memory, which you can add to later with aimeat_knowledge_contribute. '
            + 'Pass package { name, content_type, entries: [{ key, title?, value }] } with at least one entry; tags, language, maturity, synthesis, references and links are optional. '
            + 'It is your owner\'s own (audience owner) unless sharing.audience says members, organism:<id> or public; public lists it in the catalogue, and without publish:public that waits for your owner\'s approval (the answer carries publish_request). '
            + 'Answers package_id and entries_created. A manifest the schema refuses is SCHEMA_VALIDATION with the part named.'
            + KNOWLEDGE_PACKAGE_KIND + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Create Knowledge Package', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // The words POST /v1/knowledge/import asks.
        scope: 'memory:write',
        surfaces: ['agent', 'service'],
        input: {
            // The declaration only: POST /v1/knowledge/import records `ai_provenance` and reads no
            // `ai_provenance_id` (each entry gets its own record, so one id could not stand for all).
            ai_provenance: aiProvenanceCatalogInput.ai_provenance,
            package: {
                type: 'object', required: true,
                description: 'The package: { name, content_type, entries: [{ key, title?, value, visibility? }], tags?, language?, maturity?, sharing?, synthesis?, references?, links? }. content_type is one of ' + KNOWLEDGE_CONTENT_TYPES.join(', ') + '. An entry\'s key is a short name ("summary"); its value is any JSON. An entry\'s visibility is private (default), owner, members, organism:<id> or public.',
                zod: z.object({
                    name: z.string().min(1).max(INPUT_LIMITS.name),
                    content_type: z.enum(KNOWLEDGE_CONTENT_TYPES),
                    entries: z.array(CREATE_ENTRY).max(500),
                    tags: z.array(z.string().max(INPUT_LIMITS.name)).max(30).optional(),
                    language: z.string().max(5).optional(),
                }).passthrough(),
            },
            overrides: {
                type: 'object',
                description: 'Optional: { catalog_listed?, organism_share?: "<organism id>", entries?: { "<entry key>": { visibility } } }.',
                zod: z.object({
                    catalog_listed: z.boolean().optional(),
                    organism_share: z.string().max(INPUT_LIMITS.id).optional(),
                    entries: z.record(z.string().max(INPUT_LIMITS.key), z.object({ visibility: z.string().max(INPUT_LIMITS.name).optional() })).optional(),
                }),
            },
            entry_data: {
                type: 'object',
                description: 'Optional: each entry\'s content by its key, { "<entry key>": <value> }, for entries listed without an inline value.',
                zod: z.record(z.string().max(INPUT_LIMITS.key), z.unknown()),
            },
        },
    },
    {
        name: 'aimeat_knowledge_contribute',
        description: 'Add or update an entry in an existing knowledge package: pass the package id, a short entry key, and content (JSON is parsed if valid, otherwise stored as text). Bumps the entry version and registers it in the package manifest if new. The package must already exist: create it with aimeat_knowledge_create. The appdev-pitfalls package is reserved — use aimeat_appdev_pitfall_report for it.' + KNOWLEDGE_PACKAGE_KIND + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Contribute to Knowledge Package', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // These write memory records underneath, whatever the tool is called: a workspace
        // document, a skill manifest, a schedule report, a knowledge contribution.
        scope: 'memory:write',
        surfaces: ['agent', 'service'],
        input: {
            ...aiProvenanceCatalogInput,
            package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' },
            entry_key: { type: 'string', required: true, description: 'Entry key.' },
            content: { type: 'string', required: true, description: 'Entry content.' },
            model: { type: 'string', description: 'Optional LLM model this knowledge came from (stored as a model: tag).', zod: z.string().max(64) },
        },
    },
    {
        name: 'aimeat_knowledge_links',
        description: 'List the relationship links of a knowledge package (incoming, outgoing, or both) — each a source/target/relation describing how packages connect. Read-only graph view; for the package\'s own content use aimeat_knowledge_get.' + KNOWLEDGE_PACKAGE_KIND,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Knowledge Links', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent', 'service'],
        input: {
            package_id: { type: 'string', required: true, description: 'Knowledge package identifier.' },
            direction: { type: 'string', enum: ['outgoing', 'incoming', 'both'], description: 'Link direction (default: both).' },
            // As GET /v1/knowledge/:id/links reads it (unit 3b).
            relation: { type: 'string', description: 'List only the links of this relation: related-to, extends, derived-from, contradicts, supersedes or references.', zod: z.string().max(INPUT_LIMITS.name) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
