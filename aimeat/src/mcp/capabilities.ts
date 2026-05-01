/**
 * @file capabilities.ts
 * @description MCP tools for capability discovery, detail, and invocation.
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial: list, get, invoke
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

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
}
