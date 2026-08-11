/**
 * @file capabilities.ts
 * @description MCP tools for capability discovery, detail, invocation, and CRUD management.
 * @structure
 *   - read tools: list, get
 *   - invoke: the private-capability check, then the shared invoke and its recorded outcome
 *   - write tools: create, update, delete, vouch, each rendering what capability-record.ts decided
 * @usage Registered by mcp/index.ts per agent session; the shared write lives in
 *   services/capability-record.ts, which the REST routes call as well.
 * @version-history
 *   v1.1.0 - 2026-05-02 - Add create, update, delete, vouch tools
 *   v1.0.0 - 2026-05-02 - Initial: list, get, invoke
 *   v1.2.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.3.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.4.0 -- 2026-07-25 -- aimeat_capabilities_invoke forwards the caller's CURRENT session token; it
 *     passed a hardcoded empty string, so invoking any extension-backed capability over MCP always
 *     failed with the route's AUTH_REQUIRED.
 *   v1.5.0 -- 2026-08-11 -- August 2026 audit step 8: create, update, delete, vouch and the
 *     post-invoke record go through services/capability-record.ts. Three things this door was
 *     missing arrive with it: the operator's exemption from the publishing policy, the operator's
 *     reach over another owner's capability, and a call-log entry for every invocation, which only
 *     the HTTP door had been writing.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
    createCapability, updateCapability, deleteCapability, vouchCapability, recordCapabilityInvocation,
} from '../services/capability-record.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGaiiLoose } from '../utils/gaii.js';

export function registerCapabilitiesTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** The session's CURRENT bearer token. An extension-backed capability runs behind the node's own
     *  authenticated HTTP surface, so the caller's token has to travel with the invocation. */
    getToken: () => string | undefined = () => undefined,
): void {

    /**
     * Who this session is, in the shape the shared write expects.
     *
     * The identity stays the agent's own GAII: it is what this door has always stored in `ownerGhii`
     * and what its ownership checks have always compared against. The HTTP door stores the owner's
     * GHII there instead, so one person's capability lands under two different ids depending on
     * which door made it. That is an ownership decision rather than a copied line, so it is reported
     * in the August 2026 audit and left exactly as it stands.
     *
     * Operator-ness comes from the OWNER record, because a tool session carries an agent while the
     * role lives on the human. mcp/boards.ts answers the same question the same way.
     */
    async function caller(): Promise<{ gaii: string; isOperator: boolean }> {
        const gaii = getAgentGaii();
        const owner = await storage.getOwner(parseGaiiLoose(gaii).owner);
        return { gaii, isOperator: !!owner?.roles.includes('operator') };
    }

    mcp.tool(
        'aimeat_capabilities_list',
        descriptionFor('aimeat_capabilities_list'),
        {
            search: z.string().optional().describe('Full-text search on name and summary'),
            tags: z.array(z.string()).optional().describe('Filter by tags'),
            callable: z.boolean().optional().describe('Filter callable capabilities only'),
            authRequired: z.string().optional().describe('Filter by auth level: none, anonymous, registered'),
            source_type: z.string().optional().describe('Filter by source type: extension, action, cortex, manual'),
        },
        annotationsFor('aimeat_capabilities_list'),
        async (args) => {
            const result = await storage.listCapabilities({
                ...args,
                sourceType: args.source_type,
                visibility: 'public',
                status: 'active',
            });
            const summary = result.capabilities.map(c => ({
                id: c.id, name: c.name, summary: c.summary,
                callable: c.callable, authRequired: c.authRequired,
                cost: c.cost, tags: c.tags, source: c.source.type,
            }));
            return { content: [{ type: 'text' as const, text: JSON.stringify({ capabilities: summary, total: result.total }, null, 2) }] };
        },
    );

    mcp.tool(
        'aimeat_capabilities_get',
        descriptionFor('aimeat_capabilities_get'),
        {
            id: z.string().describe('Capability ID'),
        },
        annotationsFor('aimeat_capabilities_get'),
        async ({ id }) => {
            const cap = await storage.getCapability(id);
            if (!cap) return { content: [{ type: 'text' as const, text: `Capability not found: ${id}` }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify(cap, null, 2) }] };
        },
    );

    mcp.tool(
        'aimeat_capabilities_invoke',
        descriptionFor('aimeat_capabilities_invoke'),
        {
            id: z.string().describe('Capability ID to invoke'),
            input: z.record(z.string(), z.unknown()).optional().describe('Input data for the capability'),
            mode: z.enum(['normal', 'raw']).optional().describe('normal = normalized result, raw = original response'),
        },
        annotationsFor('aimeat_capabilities_invoke'),
        async (args) => {
            const cap = await storage.getCapability(args.id);
            if (!cap) return { content: [{ type: 'text' as const, text: `Capability not found: ${args.id}` }], isError: true };

            const callerGhii = getAgentGaii();

            // A PRIVATE capability may only be invoked by its owner. The read path hides private
            // capabilities from everyone else, so invoke has to as well, and it answers "not found"
            // rather than "forbidden" so the id is not confirmed. routes/capabilities.ts:244 has said
            // this since it was written; this tool invoked anything by id, including another owner's
            // private manual webhook capability.
            if (cap.visibility === 'private' && cap.ownerGhii !== callerGhii) {
                return { content: [{ type: 'text' as const, text: `Capability not found: ${args.id}` }], isError: true };
            }

            if (cap.source.type === 'cortex') {
                return { content: [{ type: 'text' as const, text: `This capability is browser-only. Use it in an AIMEAT app: ${cap.usage}` }], isError: true };
            }

            if (!cap.callable) {
                return { content: [{ type: 'text' as const, text: `This capability is not directly callable. ${cap.usage}` }], isError: true };
            }

            const input = args.input || {};

            try {
                const { invokeCapability } = await import('../services/capability-invoke.js');
                const result = await invokeCapability(config, storage, cap, input, callerGhii, getToken() ?? '', args.mode || 'normal');

                // Stats AND a line in the capability's call log. This door wrote the counters only,
                // so the log an owner reads to see who has been calling them was missing every
                // invocation an agent made.
                await recordCapabilityInvocation({ storage }, cap, callerGhii, input, { ok: true, durationMs: result.duration_ms });

                return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await recordCapabilityInvocation({ storage }, cap, callerGhii, input, { ok: false, message });
                return { content: [{ type: 'text' as const, text: `Invoke failed: ${message}` }], isError: true };
            }
        },
    );

    // ── CRUD Tools ──

    mcp.tool(
        'aimeat_capabilities_create',
        descriptionFor('aimeat_capabilities_create'),
        {
            id: z.string().optional().describe('Custom capability ID (auto-generated UUID if omitted)'),
            name: z.string().describe('Human-readable capability name'),
            summary: z.string().describe('Brief description of what this capability does'),
            callable: z.boolean().optional().describe('Whether this capability can be invoked directly'),
            status: z.enum(['draft', 'active']).optional().describe(
                'draft = created but listed to nobody; active = listed. Default draft, the same as POST /v1/capabilities — '
                + 'so nothing reaches the catalogue that the owner did not mean to put there. Publish it later with '
                + 'aimeat_capabilities_update({ id, status: "active" }). On a moderated node a PUBLIC capability goes to '
                + 'pending_review whichever you ask for; that gate is not this field.'),
            visibility: z.enum(['private', 'public']).optional().describe('Visibility: private (default) or public'),
            tags: z.array(z.string()).optional().describe('Tags for discovery and filtering'),
            inputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for input validation'),
            outputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for output format'),
            usage: z.string().optional().describe('Usage instructions for consumers'),
            whenToUse: z.string().optional().describe('Guidance on when this capability is appropriate'),
        },
        annotationsFor('aimeat_capabilities_create'),
        async (args) => {
            try {
                // The node's publishing policy, the moderation rule and the record shape all live in
                // the shared write. The caller says draft or active; a PUBLIC capability on a
                // moderated node still waits for review whichever was asked for.
                const created = await createCapability({ storage, config }, await caller(), {
                    id: args.id, name: args.name, summary: args.summary, visibility: args.visibility,
                    callable: args.callable, inputSchema: args.inputSchema, outputSchema: args.outputSchema,
                    usage: args.usage, whenToUse: args.whenToUse, tags: args.tags,
                    status: args.status,
                });
                if (!created.ok) {
                    return { content: [{ type: 'text' as const, text: `${created.code}: ${created.message}` }], isError: true };
                }
                return { content: [{ type: 'text' as const, text: JSON.stringify(created.value, null, 2) }] };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { content: [{ type: 'text' as const, text: `Create failed: ${message}` }], isError: true };
            }
        },
    );

    mcp.tool(
        'aimeat_capabilities_update',
        descriptionFor('aimeat_capabilities_update'),
        {
            id: z.string().describe('Capability ID to update'),
            name: z.string().optional().describe('Updated capability name'),
            summary: z.string().optional().describe('Updated summary'),
            tags: z.array(z.string()).optional().describe('Updated tags'),
            visibility: z.enum(['private', 'public']).optional().describe('Updated visibility'),
            status: z.enum(['draft', 'active', 'deprecated', 'disabled']).optional().describe(
                'Publish a draft with "active", take it out of the catalogue with "draft", or retire it with '
                + '"deprecated" / "disabled". Without this an agent could create a capability and never publish it.'),
            usage: z.string().optional().describe('Updated usage instructions'),
            whenToUse: z.string().optional().describe('Updated guidance on when to use'),
            whenNotToUse: z.string().optional().describe('Updated guidance on when NOT to use'),
        },
        annotationsFor('aimeat_capabilities_update'),
        async (args) => {
            // Which fields this door accepts is its own declaration, above. What happens to them —
            // ownership, the moderation rule on a status change, the updatedAt stamp — is shared.
            const updates: Record<string, unknown> = {};
            if (args.name !== undefined) updates.name = args.name;
            if (args.summary !== undefined) updates.summary = args.summary;
            if (args.tags !== undefined) updates.tags = args.tags;
            if (args.visibility !== undefined) updates.visibility = args.visibility;
            if (args.status !== undefined) updates.status = args.status;
            if (args.usage !== undefined) updates.usage = args.usage;
            if (args.whenToUse !== undefined) updates.whenToUse = args.whenToUse;
            if (args.whenNotToUse !== undefined) updates.whenNotToUse = args.whenNotToUse;

            const updated = await updateCapability({ storage, config }, await caller(), args.id, updates);
            if (!updated.ok) {
                return { content: [{ type: 'text' as const, text: `${updated.code}: ${updated.message}` }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(updated.value, null, 2) }] };
        },
    );

    mcp.tool(
        'aimeat_capabilities_delete',
        descriptionFor('aimeat_capabilities_delete'),
        {
            id: z.string().describe('Capability ID to delete'),
        },
        annotationsFor('aimeat_capabilities_delete'),
        async ({ id }) => {
            const removed = await deleteCapability({ storage, config }, await caller(), id);
            if (!removed.ok) {
                return { content: [{ type: 'text' as const, text: `${removed.code}: ${removed.message}` }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, id }, null, 2) }] };
        },
    );

    mcp.tool(
        'aimeat_capabilities_vouch',
        descriptionFor('aimeat_capabilities_vouch'),
        {
            id: z.string().describe('Capability ID to vouch for'),
            comment: z.string().optional().describe('Optional comment explaining why you vouch for this capability'),
        },
        annotationsFor('aimeat_capabilities_vouch'),
        // `comment` is accepted and goes nowhere: a vouch is a counter on both doors and nothing
        // stores the text. Reported in the August 2026 audit; removing the parameter or giving it
        // somewhere to land is a change to what this tool offers, not part of moving the write.
        async ({ id, comment: _comment }) => {
            const vouched = await vouchCapability({ storage, config }, await caller(), id);
            if (!vouched.ok) {
                return { content: [{ type: 'text' as const, text: `${vouched.code}: ${vouched.message}` }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(vouched.value, null, 2) }] };
        },
    );
}
