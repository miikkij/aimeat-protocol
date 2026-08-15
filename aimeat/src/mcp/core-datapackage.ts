/**
 * @file src/mcp/core-datapackage.ts
 * @description The agent-facing half of the data-package contract: publish one, and get a resource
 *   in the shape a target program expects.
 *
 *   TWO TOOLS, NOT THREE. Reading a package back needs no new tool — `aimeat_storage_download` with
 *   `owner=` and `inline: true` already answers with the descriptor JSON, and the descriptor carries
 *   the Table Schema, which is how an agent learns the columns without being told them. Adding a
 *   third tool that does the same thing through a different door would be the second implementation
 *   this whole design exists to avoid.
 *
 *   PUBLISH CARRIES ROWS, AND SO IT IS CAPPED. Rows arrive as JSON in the tool arguments, which means
 *   they arrive through the model's context and are billed by the token. The cap is stated in the
 *   description rather than discovered at the failure, and the alternative — produce it from an
 *   extension or a workflow step, where the rows never touch a model — is named beside it, because
 *   an agent that reads that sentence will usually take the cheaper road.
 *
 *   IT WRITES THROUGH services/datapackage/, not through storage. An MCP tool that reached the store
 *   itself would be a second implementation of the quality gate, the hash and the address, and
 *   `aimeat/no-storage-in-mcp` exists because that has already happened here.
 * @structure registerCoreDataPackageTools() — aimeat_datapackage_publish, aimeat_datapackage_export
 * @usage
 *   import { registerCoreDataPackageTools } from './core-datapackage.js';
 *   registerCoreDataPackageTools(mcp, storage, config, getAgentGaii);
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, B3).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { emitChange } from '../services/event-bus.js';
import { descriptionFor } from './catalog/shape.js';
import { publishPackage, openPackage, readRows } from '../services/datapackage/store.js';
import { toCsv } from '../services/datapackage/table.js';
import type { TableSchema } from '../services/datapackage/contract.js';

/** What one tool call may carry as rows. Same number as the sandbox bridge, for one reason a person
 *  can remember: "8 MB is what crosses in one call, wherever you are standing". */
const MAX_ROWS_BYTES = 8 * 1024 * 1024;

/**
 * The Table Schema as a pandas `dtype` map. Only the columns pandas would get WRONG on its own are
 * named — a string field whose values look numeric — because a dtype map that restates what the
 * sniffer already gets right is noise in a recipe somebody has to read.
 *
 * `str` for every string field is deliberate and blunt: pandas cannot tell '001000' from 1000 after
 * the fact, so the safe answer is to stop it guessing on that column at all. Dates stay out — pandas
 * wants them in `parse_dates`, not `dtype`, and a wrong hint there is worse than none.
 */
function pandasDtypes(schema: TableSchema): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of schema.fields) if (f.type === 'string') out[f.name] = 'str';
    return out;
}

const jsonContent = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});
const errContent = (value: unknown) => ({ ...jsonContent(value), isError: true as const });

export function registerCoreDataPackageTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const agentGaii = getAgentGaii();
    const store = { storage, config };

    // ── aimeat_datapackage_publish ──
    mcp.tool(
        'aimeat_datapackage_publish',
        descriptionFor('aimeat_datapackage_publish'),
        {
            name: z.string().describe('Package name: lowercase letters, digits and dashes. It becomes part of the permanent URL.'),
            changes: z.string().describe('REQUIRED. What changed against the previous version and why. A version nobody explained is one a consumer cannot decide about.'),
            resources: z.array(z.object({
                name: z.string().describe('Becomes data/{name}.csv inside the package.'),
                rows: z.array(z.record(z.string(), z.unknown())).describe('The table, as an array of objects.'),
                schema: z.unknown().optional().describe('A Frictionless Table Schema to DECLARE the types. Omit to have them inferred — the descriptor then records schemaSource "inferred", so a consumer can see nobody confirmed them.'),
                title: z.string().optional(),
                description: z.string().optional(),
            })).min(1),
            title: z.string().optional(),
            description: z.string().optional(),
            license: z.string().optional().describe('e.g. CC-BY-4.0. You are publishing under your owner\'s name; say the terms.'),
            sources: z.array(z.object({
                url: z.string().optional(), title: z.string().optional(), retrievedAt: z.string().optional(),
            })).optional().describe('Where the data came from. Part of the product for anything derived from a register.'),
            legal_basis: z.string().optional(),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_datapackage_publish'),
        async ({ name, changes, resources, title, description, license, sources, legal_basis, ai_provenance, ai_provenance_id }) => {
            const bytes = Buffer.byteLength(JSON.stringify(resources ?? []), 'utf8');
            if (bytes > MAX_ROWS_BYTES) {
                return errContent({
                    code: 'PAYLOAD_TOO_LARGE',
                    message: `The rows are ${Math.round(bytes / 1024)} kB, over the ${MAX_ROWS_BYTES / 1024 / 1024} MB one-call limit.`,
                    what_to_do: 'Publish the table in periods (one version per window), or move the production to an '
                        + 'extension action or a workflow step — there the rows never pass through a model context and '
                        + 'are neither token-billed nor size-capped by this door.',
                });
            }

            const out = await publishPackage(store, ownerGhiiOf(agentGaii), {
                name, changes,
                resources: (resources ?? []).map(r => ({
                    name: r.name,
                    rows: r.rows ?? [],
                    schema: (r.schema as TableSchema | undefined) ?? 'infer',
                    ...(r.title ? { title: r.title } : {}),
                    ...(r.description ? { description: r.description } : {}),
                })),
                ...(title ? { title } : {}),
                ...(description ? { description } : {}),
                provenance: {
                    ...(license ? { license } : {}),
                    ...(sources?.length ? { sources } : {}),
                    ...(legal_basis ? { legalBasis: legal_basis } : {}),
                },
                declaredProvenance: toDeclaredProvenance(ai_provenance),
                ...(ai_provenance_id ? { declaredProvenanceId: ai_provenance_id } : {}),
            }, { gaii: agentGaii, kind: 'agent' });

            if (!out.ok) {
                // The coordinates, not a verdict. An agent that gets "row 412, column dispensed_at,
                // expected date, got n/a" can fix the row; one that gets "invalid" re-sends the same
                // table with a different prompt.
                return errContent({
                    code: out.code,
                    message: out.message,
                    issues: out.issues.slice(0, 50),
                    issues_total: out.issues.length,
                    published: false,
                    note: 'Nothing was written. The package still stands on its previous version.',
                });
            }
            // The open page hears about it, the same domain POST /v1/datapackages emits.
            emitChange('files');
            return jsonContent({
                ...(await writeProvenanceEcho(storage, config, out.descriptor.aimeat.aiProvenanceId)),
                package_id: out.descriptor.aimeat.packageId,
                content_hash: out.contentHash,
                descriptor_url: out.descriptorUrl,
                unchanged: out.unchanged,
                schema_source: out.descriptor.aimeat.schemaSource,
                resources: out.resources,
                note: out.unchanged
                    ? 'Identical content was already published — this is NOT a new version. Say "no change", not "updated".'
                    : 'Published. descriptor_url is permanent, needs no authentication and answers byte ranges: give it to '
                        + 'DuckDB, pandas, frictionless-py, Excel or a person. Do not re-download the rows to hand them on.',
            });
        },
    );

    // ── aimeat_datapackage_export ──
    mcp.tool(
        'aimeat_datapackage_export',
        descriptionFor('aimeat_datapackage_export'),
        {
            ref: z.string().describe('pkg:owner/name for the newest version, or pkg:owner/name@sha256:… to pin one.'),
            resource: z.string().describe('Which resource of the package.'),
            format: z.enum(['url', 'csv', 'json']).default('url')
                .describe('url = the permanent CSV address (default, and what you want in almost every case). csv/json = the bytes inline, for a small table you must reason over.'),
            limit: z.number().int().positive().max(5000).optional().describe('Rows, for csv/json. Default 500.'),
            offset: z.number().int().nonnegative().optional(),
            select: z.array(z.string()).optional().describe('Only these columns.'),
        },
        annotationsFor('aimeat_datapackage_export'),
        async ({ ref, resource, format, limit, offset, select }) => {
            const opened = await openPackage(store, ref, config.nodeId);
            if (!opened) return errContent({ code: 'NOT_FOUND', message: `No such data package: ${ref}` });
            const res = opened.descriptor.resources.find(r => r.name === resource);
            if (!res) {
                return errContent({
                    code: 'NOT_FOUND',
                    message: `Package ${ref} has no resource "${resource}"`,
                    available: opened.descriptor.resources.map(r => r.name),
                });
            }
            const csvUrl = opened.descriptorUrl.replace(/datapackage\.json$/, '') + res.path.split('/').map(encodeURIComponent).join('/');

            if (format === 'url') {
                return jsonContent({
                    format: 'url',
                    url: csvUrl,
                    descriptor_url: opened.descriptorUrl,
                    content_hash: opened.descriptor.aimeat.contentHash,
                    rows: res.rowCount,
                    bytes: res.bytes,
                    // The Table Schema IS the answer to "what columns does this have". An agent
                    // delivering this into another program reads it here rather than sampling rows.
                    schema: res.schema,
                    recipes: {
                        duckdb: `SELECT * FROM read_csv('${csvUrl}');`,
                        // MEASURED, not assumed: a bare pandas.read_csv() re-sniffs the types and
                        // read the article number '001000' back as the integer 1000, losing the
                        // padding and the join key, while DuckDB kept the same bytes as VARCHAR.
                        // The Table Schema is the authority — pass it, and the readers agree.
                        pandas: `pandas.read_csv('${csvUrl}', dtype=${JSON.stringify(pandasDtypes(res.schema))})`,
                        pandas_note: 'Pass dtype. Without it pandas re-sniffs and turns a zero-padded identifier into a number.',
                        sheets: `=IMPORTDATA("${csvUrl}")`,
                        frictionless: `frictionless.Package('${opened.descriptorUrl}')`,
                    },
                    note: 'Permanent, no authentication, answers byte ranges. Hand this address on rather than the rows.',
                });
            }

            const page = await readRows(store, ref, config.nodeId, resource, {
                offset: offset ?? 0, limit: limit ?? 500, ...(select?.length ? { select } : {}),
            });
            if (!page) return errContent({ code: 'NOT_FOUND', message: `Could not read ${resource} of ${ref}` });
            const truncated = page.total > page.rows.length + (offset ?? 0);
            const body = format === 'csv'
                ? { format: 'csv', csv: toCsv(page.rows, page.schema).toString('utf8') }
                : { format: 'json', rows: page.rows };
            return jsonContent({
                ...body,
                schema: page.schema,
                total: page.total,
                returned: page.rows.length,
                truncated,
                url: csvUrl,
                ...(truncated ? {
                    note: 'This is a WINDOW, not the table. For the whole thing use format "url" and let the target '
                        + 'program read the address — pulling every row through a model context is slow and billed.',
                } : {}),
            });
        },
    );
}
