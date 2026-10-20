/**
 * @file src/mcp/core-datapackage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   registerCoreDataPackageTools(mcp, storage, config, getAgentGaii, caller);
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-18 — On a node that shows its content to signed-in accounts only, a publish that would make
 *     the package public lands at 'members' and the answer carries `warnings` PUBLIC_IS_SIGNED_IN_HERE (plan V1.6).
 *   2026-10-18 — aimeat_datapackage_publish asks the publish gate as POST /v1/datapackages does: a
 *     public publish (the default) by an agent without publish:public lands at the audience the
 *     package had (a first version private) and answers with `publish_request` (plan doc-mvcn6c7e4e5q, V4).
 *   2026-10-17 — aimeat_datapackage_publish takes `visibility` (public by default, members,
 *     organism:<id>, private), and aimeat_datapackage_export reads as this session, so a package's
 *     audience decides (plan doc-mvcn6c7e4e5q, V3.8).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, B3).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf, localAccountName } from '../utils/gaii.js';
import type { CallerContext } from '../services/caller-context.js';
import { datapackagePublishGate, fileDatapackageAsk } from '../services/datapackage/publish-ask.js';
import { closedNodeWarnings } from '../services/closed-node-level.js';
import { annotationsFor } from './annotations.js';
import { toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { emitChange } from '../services/event-bus.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { publishPackage, openPackage, readRows } from '../services/datapackage/store.js';
import { toCsv } from '../services/datapackage/table.js';
import type { TableSchema } from '../services/datapackage/contract.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

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
    /** The session's caller (services/caller-context.ts), for the publish gate. */
    caller: () => CallerContext,
): void {
    const agentGaii = getAgentGaii();
    const store = { storage, config };
    /** This session as a reader: an agent of this node, so a package's audience decides (plan V3.8). */
    const reader = { sub: agentGaii, owner: localAccountName(agentGaii) };

    // ── aimeat_datapackage_publish ──
    mcp.registerTool(
        'aimeat_datapackage_publish',
        {
            description: descriptionFor('aimeat_datapackage_publish'),
            inputSchema: zodShapeFor('aimeat_datapackage_publish'),
            annotations: annotationsFor('aimeat_datapackage_publish'),
        },
        async ({ name, changes, resources, title, description, license, sources, legal_basis, ai_provenance, ai_provenance_id, visibility }) => {
            const bytes = Buffer.byteLength(JSON.stringify(resources ?? []), 'utf8');
            if (bytes > MAX_ROWS_BYTES) {
                return errContent({
                    code: 'PAYLOAD_TOO_LARGE',
                    message: `The rows are ${Math.round(bytes / 1024)} kB, over the ${MAX_ROWS_BYTES / 1024 / 1024} MB one-call limit.`,
                    what_to_do: 'Publish the table in periods (one version per window), or move the production to an '
                        + 'extension action or a workflow step — there the rows never pass through a model context and '
                        + 'are neither token-billed nor size-capped by this tool.',
                });
            }

            // Publishing it public (the default) asks the publish gate, as POST /v1/datapackages does.
            const ownerGhii = ownerGhiiOf(agentGaii);
            const gate = await datapackagePublishGate(store, caller(), undefined, ownerGhii, name, visibility);
            if (gate.kind === 'refused') return errContent({ code: gate.code, message: gate.message, published: false });
            const out = await publishPackage(store, ownerGhii, {
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
                ...(gate.visibility !== undefined ? { visibility: gate.visibility } : {}),
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
            const asked = gate.requester
                ? await fileDatapackageAsk(store, caller().owner, gate.requester, ownerGhii, name, out.contentHash, gate.from)
                : closedNodeWarnings(gate.warning);
            return jsonContent({
                ...(await writeProvenanceEcho(storage, config, out.descriptor.aimeat.aiProvenanceId)),
                // Published, not public yet: the owner approves (its next_step says what to tell them).
                ...asked,
                package_id: out.descriptor.aimeat.packageId,
                content_hash: out.contentHash,
                descriptor_url: out.descriptorUrl,
                unchanged: out.unchanged,
                schema_source: out.descriptor.aimeat.schemaSource,
                resources: out.resources,
                ...(out.pruned.length ? {
                    pruned_versions: out.pruned,
                    pruned_note: 'The retention policy removed these older versions. Anyone pinned to one now gets a 404.',
                } : {}),
                note: out.unchanged
                    ? 'Identical content was already published — this is NOT a new version. Say "no change", not "updated".'
                    : 'Published. descriptor_url is permanent, needs no authentication and answers byte ranges: give it to '
                        + 'DuckDB, pandas, frictionless-py, Excel or a person. Do not re-download the rows to hand them on.',
            });
        },
    );

    // ── aimeat_datapackage_export ──
    mcp.registerTool(
        'aimeat_datapackage_export',
        {
            description: descriptionFor('aimeat_datapackage_export'),
            inputSchema: zodShapeFor('aimeat_datapackage_export'),
            annotations: annotationsFor('aimeat_datapackage_export'),
        },
        async ({ ref, resource, format, limit, offset, select }) => {
            const opened = await openPackage(store, ref, config.nodeId, reader);
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
            }, reader);
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
