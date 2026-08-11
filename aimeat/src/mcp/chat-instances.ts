/**
 * @file chat-instances.ts
 * @description MCP chat instance tools and resource registrations. Provides 3 tools for
 *   chat instance management (list, create, status) and 1 resource template for reading
 *   instance details via the MCP resource protocol.
 * @structure
 *   - registerChatInstancesTools() — registers all chat instance tools and resources on an McpServer instance
 * @usage
 *   import { registerChatInstancesTools } from './chat-instances.js';
 *   registerChatInstancesTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: 3 tools + 1 resource for chat instance management via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose, buildChatInstanceId } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { emitChange } from '../services/event-bus.js';

export function registerChatInstancesTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    /** Resolve owner name from agent GAII */
    function ownerName(): string {
        return parseGaiiLoose(agentGaii).owner;
    }

    // ── Resource: chat instance ──
    mcp.registerResource(
        'chat-instance',
        new ResourceTemplate('aimeat://instances/{id}', {
            list: async () => {
                const instances = await storage.listChatInstances({ ownerName: ownerName() });
                return {
                    resources: instances.map(inst => ({
                        uri: `aimeat://instances/${encodeURIComponent(inst.id)}`,
                        name: inst.appName,
                        mimeType: 'application/json',
                        description: `Instance: ${inst.platform} (${inst.id})`,
                    })),
                };
            },
        }),
        { mimeType: 'application/json', description: 'Chat instance details' },
        async (uri, variables) => {
            const id = decodeURIComponent(variables.id as string);
            const inst = await storage.getChatInstance(id);
            if (!inst) return { contents: [{ uri: uri.toString(), text: 'Instance not found' }] };

            if (inst.ownerName !== ownerName()) {
                return { contents: [{ uri: uri.toString(), text: 'Access denied' }] };
            }

            return {
                contents: [{
                    uri: uri.toString(),
                    text: JSON.stringify({
                        id: inst.id,
                        platform: inst.platform,
                        app_name: inst.appName,
                        ghii: inst.ghii,
                        is_anonymous: inst.isAnonymous,
                        created_at: inst.createdAt,
                        last_seen: inst.lastSeen,
                        agent_gaii: inst.agentGaii ?? null,
                    }, null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    // ── Tool 1: aimeat_instance_list ──
    mcp.tool(
        'aimeat_instance_list',
        descriptionFor('aimeat_instance_list'),
        {},
        annotationsFor('aimeat_instance_list'),
        async () => {
            const instances = await storage.listChatInstances({ ownerName: ownerName() });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(instances.map(inst => ({
                        id: inst.id,
                        platform: inst.platform,
                        app_name: inst.appName,
                        ghii: inst.ghii,
                        is_anonymous: inst.isAnonymous,
                        created_at: inst.createdAt,
                        last_seen: inst.lastSeen,
                        agent_gaii: inst.agentGaii ?? null,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_instance_create ──
    mcp.tool(
        'aimeat_instance_create',
        descriptionFor('aimeat_instance_create'),
        {
            name: z.string().describe('Application name for this instance'),
            model: z.string().optional().describe('AI model identifier (e.g. gpt-4o, claude-3-5-sonnet)'),
        },
        annotationsFor('aimeat_instance_create'),
        async ({ name, model }) => {
            const owner = ownerName();
            const platform = model ? model.split('-')[0] ?? 'unknown' : 'unknown';
            const id = buildChatInstanceId(platform, name, owner, config.nodeId);
            const ghii = `${owner}@${config.nodeId}`;
            const now = new Date().toISOString();

            // Upsert: if already exists just return it
            const existing = await storage.getChatInstance(id);
            if (existing) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            id: existing.id,
                            name: existing.appName,
                            platform: existing.platform,
                            status: 'existing',
                            created_at: existing.createdAt,
                        }, null, 2),
                    }],
                };
            }

            const inst = await storage.createChatInstance({
                id,
                platform,
                appName: name,
                ownerName: owner,
                ghii,
                nodeId: config.nodeId,
                isAnonymous: false,
                agentGaii: agentGaii,
                createdAt: now,
                lastSeen: now,
            });

            // POST /v1/chat-instances emits this; the chat list in the browser listens on it.
            emitChange('chat');
            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: inst.id,
                        name: inst.appName,
                        platform: inst.platform,
                        status: 'created',
                        created_at: inst.createdAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_instance_status ──
    mcp.tool(
        'aimeat_instance_status',
        descriptionFor('aimeat_instance_status'),
        {
            instance_id: z.string().describe('Chat instance ID'),
        },
        annotationsFor('aimeat_instance_status'),
        async ({ instance_id }) => {
            const inst = await storage.getChatInstance(instance_id);
            if (!inst) {
                return { content: [{ type: 'text' as const, text: 'Instance not found' }], isError: true };
            }

            if (inst.ownerName !== ownerName()) {
                return { content: [{ type: 'text' as const, text: 'Access denied' }], isError: true };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: inst.id,
                        platform: inst.platform,
                        app_name: inst.appName,
                        ghii: inst.ghii,
                        is_anonymous: inst.isAnonymous,
                        created_at: inst.createdAt,
                        last_seen: inst.lastSeen,
                        agent_gaii: inst.agentGaii ?? null,
                        node_id: inst.nodeId,
                    }, null, 2),
                }],
            };
        },
    );
}
