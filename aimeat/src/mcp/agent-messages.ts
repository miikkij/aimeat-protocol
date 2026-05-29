/**
 * @file agent-messages.ts
 * @description MCP tools for agent message inbox and sending responses
 * @structure
 *   - registerAgentMessageTools() -- registers aimeat_message_inbox and aimeat_message_send
 * @usage
 *   import { registerAgentMessageTools } from './agent-messages.js';
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';

export function registerAgentMessageTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 1: aimeat_message_inbox ──
    mcp.tool(
        'aimeat_message_inbox',
        'Get pending inbound messages for this agent',
        {},
        annotationsFor('aimeat_message_inbox'),
        async () => {
            const messages = await storage.listPendingMessages(agentGaii);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        pending_messages: messages.map(m => ({
                            id: m.id,
                            thread_id: m.threadId,
                            from: m.senderGaii,
                            content: m.content,
                            created_at: m.createdAt,
                        })),
                        count: messages.length,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_message_send ──
    mcp.tool(
        'aimeat_message_send',
        'Send a response message from this agent',
        {
            content: z.string().min(1).max(10000).describe('Message content (markdown supported)'),
            thread_id: z.string().uuid().optional().describe('Thread ID to reply in (omit to start new conversation)'),
            linked_task_id: z.string().uuid().optional().describe('Link this message to a task ID'),
            metadata: z.object({
                tokens_used: z.number().optional().describe('Tokens consumed for this response'),
                processing_ms: z.number().optional().describe('Processing time in ms'),
                proposed_task: z.object({
                    title: z.string().min(1).max(256),
                    description: z.string().max(5000),
                }).optional().describe('Propose a task for user approval'),
            }).optional().describe('Optional message metadata'),
        },
        annotationsFor('aimeat_message_send'),
        async ({ content, thread_id, linked_task_id, metadata }) => {
            const now = new Date().toISOString();
            const threadId = thread_id ?? randomUUID();

            const record = await storage.createMessage({
                id: randomUUID(),
                agentGaii,
                threadId,
                direction: 'outbound',
                senderGaii: agentGaii,
                content,
                status: 'delivered',
                linkedTaskId: linked_task_id,
                metadata: metadata ? {
                    tokensUsed: metadata.tokens_used,
                    processingMs: metadata.processing_ms,
                    proposedTask: metadata.proposed_task,
                } : undefined,
                createdAt: now,
                processedAt: now,
            });

            emitResourceUpdated(agentGaii, `aimeat://messages/${record.threadId}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        message_id: record.id,
                        thread_id: record.threadId,
                        status: record.status,
                        created_at: record.createdAt,
                    }, null, 2),
                }],
            };
        },
    );
}
