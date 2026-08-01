/**
 * @file output-schemas.ts
 * @description Shared MCP outputSchema shapes (F4). Tools registered via mcp.registerTool() declare
 *   one of these so the result carries machine-readable `structuredContent` (validated by the SDK)
 *   alongside the human-readable text content. Fields are optional so the same schema validates both
 *   the full ('detailed') payload and the trimmed ('concise', response_format) projection.
 * @structure ZodRawShape objects passed as registerTool({ outputSchema }).
 * @usage
 *   import { memoryEntryOutput } from '../catalog/output-schemas.js';
 *   mcp.registerTool('aimeat_memory_read', { description, inputSchema, outputSchema: memoryEntryOutput, annotations }, handler)
 * @version-history
 *   v1.1.0 -- 2026-08-01 -- TARGET-058 Phase 4: aiProvenanceOutput, declared here because an
 *     outputSchema STRIPS what it does not name — a read tool attaching provenance without declaring
 *     it would drop it silently, which is the exact loss this phase exists to prevent.
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 4 (F4): output schemas for core read tools
 */
import { z } from 'zod';

/** A list-item record; loose by design so concise projections and varied fields still validate. */
const looseRecord = z.record(z.string(), z.unknown());

/**
 * TARGET-058: how a returned item was made. Declared here rather than inline because an outputSchema
 * STRIPS what it does not name — a tool that attaches provenance to a result and forgets to declare
 * it here would return nothing, silently, which is the loss this whole phase exists to prevent.
 *
 * `record` is loose on purpose: it is the `aimeat.provenance/v1` document, and a reader must branch
 * on its `spec` rather than on a shape pinned here. Re-declaring the record's fields in an MCP
 * output schema would be a second definition of the document, free to drift from the first.
 */
export const aiProvenanceOutput = z.object({
    id: z.string(),
    record: looseRecord,
    record_url: z.string(),
}).optional();

/** aimeat_wallet_balance */
export const walletBalanceOutput = {
    balance: z.number(),
    in_escrow: z.number().optional(),
    available: z.number().optional(),
};

/** aimeat_memory_read (single entry) */
export const memoryEntryOutput = {
    key: z.string(),
    value: z.unknown().optional(),
    visibility: z.string().optional(),
    tags: z.array(z.string()).optional(),
    version: z.number().optional(),
    updated_at: z.string().optional(),
    ai_provenance: aiProvenanceOutput,
};

/** aimeat_memory_list — { items, count } plus the Phase 2 truncation markers and the
 *  owner-scope disclosure (values_omitted + note), all optional. */
export const memoryListOutput = {
    items: z.array(looseRecord).optional(),
    count: z.number().optional(),
    truncated: z.boolean().optional(),
    shown: z.number().optional(),
    hint: z.string().optional(),
    /** True when the listing carries no values (always the case) and the caller spans identities. */
    values_omitted: z.boolean().optional(),
    /** How to actually read a value that belongs to another same-owner identity. */
    note: z.string().optional(),
};

/** Generic { items, count } list output (work inbox, etc.). */
export const genericListOutput = {
    items: z.array(looseRecord).optional(),
    count: z.number().optional(),
};

/** aimeat_agents_list — wraps the owner's agents array. */
export const agentsListOutput = {
    agents: z.array(looseRecord).optional(),
};

/** aimeat_agent_profile (single agent public profile) */
export const agentProfileOutput = {
    gaii: z.string(),
    display_name: z.string().optional(),
    description: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    trust_score: z.number().optional(),
    created_at: z.string().optional(),
    /** Linked skill refs from the skills registry (same-owner agents only; empty otherwise). */
    skills: z.array(z.object({ ref: z.string(), name: z.string(), description: z.string() })).optional(),
};
