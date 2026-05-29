/**
 * @file capabilities.ts
 * @description MCP tools for capability discovery, detail, invocation, and CRUD management.
 * @version-history
 *   v1.1.0 - 2026-05-02 - Add create, update, delete, vouch tools
 *   v1.0.0 - 2026-05-02 - Initial: list, get, invoke
 *   v1.2.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';

export function registerCapabilitiesTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {

    mcp.tool(
        'aimeat_capabilities_list',
        'List and search capabilities on this AIMEAT node. Returns id, name, summary, callable, authRequired, cost, tags for each.',
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
        'Get full detail of a capability including input/output schemas, examples, usage instructions, dependencies, and trust signals.',
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
        'Invoke a callable capability. Extensions and manual webhooks return results immediately. Cortex capabilities are browser-only and will return an error with usage instructions.',
        {
            id: z.string().describe('Capability ID to invoke'),
            input: z.record(z.string(), z.unknown()).optional().describe('Input data for the capability'),
            mode: z.enum(['normal', 'raw']).optional().describe('normal = normalized result, raw = original response'),
        },
        annotationsFor('aimeat_capabilities_invoke'),
        async (args) => {
            const cap = await storage.getCapability(args.id);
            if (!cap) return { content: [{ type: 'text' as const, text: `Capability not found: ${args.id}` }], isError: true };

            if (cap.source.type === 'cortex') {
                return { content: [{ type: 'text' as const, text: `This capability is browser-only. Use it in an AIMEAT app: ${cap.usage}` }], isError: true };
            }

            if (!cap.callable) {
                return { content: [{ type: 'text' as const, text: `This capability is not directly callable. ${cap.usage}` }], isError: true };
            }

            try {
                const { invokeCapability } = await import('../services/capability-invoke.js');
                const result = await invokeCapability(config, storage, cap, args.input || {}, getAgentGaii(), '', args.mode || 'normal');

                storage.incrementCapabilityStats(cap.id, { success: 1, error: 0, totalMs: result.duration_ms }).catch(() => {});

                return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
            } catch (err: any) {
                storage.incrementCapabilityStats(cap.id, { success: 0, error: 1, totalMs: 0, lastError: err.message }).catch(() => {});
                return { content: [{ type: 'text' as const, text: `Invoke failed: ${err.message}` }], isError: true };
            }
        },
    );

    // ── CRUD Tools ──

    mcp.tool(
        'aimeat_capabilities_create',
        'Create a new manual capability on this AIMEAT node. Returns the created capability record.',
        {
            id: z.string().optional().describe('Custom capability ID (auto-generated UUID if omitted)'),
            name: z.string().describe('Human-readable capability name'),
            summary: z.string().describe('Brief description of what this capability does'),
            callable: z.boolean().optional().describe('Whether this capability can be invoked directly'),
            visibility: z.enum(['private', 'public']).optional().describe('Visibility: private (default) or public'),
            tags: z.array(z.string()).optional().describe('Tags for discovery and filtering'),
            inputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for input validation'),
            outputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for output format'),
            usage: z.string().optional().describe('Usage instructions for consumers'),
            whenToUse: z.string().optional().describe('Guidance on when this capability is appropriate'),
        },
        annotationsFor('aimeat_capabilities_create'),
        async (args) => {
            const now = new Date().toISOString();
            const ownerGhii = getAgentGaii();

            const schemaHash = createHash('sha256')
                .update(JSON.stringify(args.inputSchema ?? {}) + JSON.stringify(args.outputSchema ?? {}))
                .digest('hex').slice(0, 16);

            const record: CapabilityRecord = {
                id: args.id || randomUUID(),
                name: args.name,
                summary: args.summary,
                ownerGhii,
                visibility: args.visibility || 'private',
                scope: 'local',
                status: 'active',
                rejectionReason: null,
                deprecationMessage: null,
                replacedBy: null,
                source: { type: 'manual', ref: 'manual', version: '1.0.0' },
                authRequired: 'registered',
                callable: args.callable ?? false,
                inputSchema: args.inputSchema ?? null,
                outputSchema: args.outputSchema ?? null,
                exports: null,
                usage: args.usage || '',
                whenToUse: args.whenToUse || '',
                whenNotToUse: '',
                examples: [],
                dependencies: [],
                schemaHash,
                webhookUrl: null,
                cost: null,
                trustRequired: null,
                trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
                redactedFields: [],
                operatorOverride: null,
                stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
                tags: args.tags || [],
                createdAt: now,
                updatedAt: now,
            };

            try {
                const created = await storage.createCapability(record);
                return { content: [{ type: 'text' as const, text: JSON.stringify(created, null, 2) }] };
            } catch (err: any) {
                if (err.message?.includes('UNIQUE') || err.message?.includes('duplicate')) {
                    return { content: [{ type: 'text' as const, text: `Capability '${record.id}' already exists` }], isError: true };
                }
                return { content: [{ type: 'text' as const, text: `Create failed: ${err.message}` }], isError: true };
            }
        },
    );

    mcp.tool(
        'aimeat_capabilities_update',
        'Update an existing capability that you own. Only provided fields are updated.',
        {
            id: z.string().describe('Capability ID to update'),
            name: z.string().optional().describe('Updated capability name'),
            summary: z.string().optional().describe('Updated summary'),
            tags: z.array(z.string()).optional().describe('Updated tags'),
            visibility: z.enum(['private', 'public']).optional().describe('Updated visibility'),
            usage: z.string().optional().describe('Updated usage instructions'),
            whenToUse: z.string().optional().describe('Updated guidance on when to use'),
            whenNotToUse: z.string().optional().describe('Updated guidance on when NOT to use'),
        },
        annotationsFor('aimeat_capabilities_update'),
        async (args) => {
            const cap = await storage.getCapability(args.id);
            if (!cap) return { content: [{ type: 'text' as const, text: `Capability not found: ${args.id}` }], isError: true };

            const callerGhii = getAgentGaii();
            if (cap.ownerGhii !== callerGhii) {
                return { content: [{ type: 'text' as const, text: 'Forbidden: not the owner of this capability' }], isError: true };
            }

            const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
            if (args.name !== undefined) updates.name = args.name;
            if (args.summary !== undefined) updates.summary = args.summary;
            if (args.tags !== undefined) updates.tags = args.tags;
            if (args.visibility !== undefined) updates.visibility = args.visibility;
            if (args.usage !== undefined) updates.usage = args.usage;
            if (args.whenToUse !== undefined) updates.whenToUse = args.whenToUse;
            if (args.whenNotToUse !== undefined) updates.whenNotToUse = args.whenNotToUse;

            const updated = await storage.updateCapability(args.id, updates);
            return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
        },
    );

    mcp.tool(
        'aimeat_capabilities_delete',
        'Delete a manual capability that you own. Only manual capabilities can be deleted; auto-aggregated capabilities are removed when their source is removed.',
        {
            id: z.string().describe('Capability ID to delete'),
        },
        annotationsFor('aimeat_capabilities_delete'),
        async ({ id }) => {
            const cap = await storage.getCapability(id);
            if (!cap) return { content: [{ type: 'text' as const, text: `Capability not found: ${id}` }], isError: true };

            const callerGhii = getAgentGaii();
            if (cap.ownerGhii !== callerGhii) {
                return { content: [{ type: 'text' as const, text: 'Forbidden: not the owner of this capability' }], isError: true };
            }

            if (cap.source.type !== 'manual') {
                return { content: [{ type: 'text' as const, text: 'Only manual capabilities can be deleted. Auto-aggregated capabilities are removed when their source is removed.' }], isError: true };
            }

            await storage.deleteCapability(id);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, id }, null, 2) }] };
        },
    );

    mcp.tool(
        'aimeat_capabilities_vouch',
        'Vouch for a capability to increase its trust signal. You cannot vouch for your own capabilities.',
        {
            id: z.string().describe('Capability ID to vouch for'),
            comment: z.string().optional().describe('Optional comment explaining why you vouch for this capability'),
        },
        annotationsFor('aimeat_capabilities_vouch'),
        async ({ id, comment: _comment }) => {
            const cap = await storage.getCapability(id);
            if (!cap) return { content: [{ type: 'text' as const, text: `Capability not found: ${id}` }], isError: true };

            const callerGhii = getAgentGaii();
            if (cap.ownerGhii === callerGhii) {
                return { content: [{ type: 'text' as const, text: 'Cannot vouch for your own capability' }], isError: true };
            }

            await storage.incrementVouchCount(id);
            const updated = await storage.getCapability(id);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ vouchCount: updated?.trust.vouchCount ?? 0 }, null, 2) }] };
        },
    );
}
