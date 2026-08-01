/**
 * @file agent-messages.ts
 * @description MCP tools for agent message inbox and sending responses
 * @structure
 *   - registerAgentMessageTools() -- registers aimeat_message_inbox and aimeat_message_send
 * @usage
 *   import { registerAgentMessageTools } from './agent-messages.js';
 * @version-history
 *   Limits raised -- 2026-07-30 -- content to 200 000, tool descriptions to 10 000.
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-05-30 -- Add aimeat_message_history (full thread context, oldest-first) so agents can
 *     read prior messages and correlate option-prompt answers (metadata.promptAnswer) to their questions.
 *   v1.4.0 -- 2026-06-06 -- Task-based threads: threadId now defaults to linked_task_id when no
 *     thread_id is given, so a task's whole conversation stays in one thread instead of a new random
 *     thread per message. Updated param descriptions to steer agents toward passing linked_task_id.
 *   v1.5.0 -- 2026-08-01 -- TARGET-058 Phase 8b. aimeat_message_send accepts an `ai_provenance`
 *     declaration and stamps the content through provenanceForWrite(). This is the agent→human
 *     channel: every message on it is text a named person reads, which is what decides whether a
 *     label is owed — not whether the world can read it.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho, readProvenanceMany } from './ai-provenance-result.js';
import { provenanceForWrite } from '../services/ai-provenance.js';

export function registerAgentMessageTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 1: aimeat_message_inbox ──
    mcp.tool(
        'aimeat_message_inbox',
        descriptionFor('aimeat_message_inbox'),
        {},
        annotationsFor('aimeat_message_inbox'),
        async () => {
            const messages = await storage.listPendingMessages(agentGaii);
            const provFor = await readProvenanceMany(storage, config, messages.map(m => m.aiProvenanceId));
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
                            ...provFor(m.aiProvenanceId),
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
        descriptionFor('aimeat_message_send'),
        {
            content: z.string().min(1).max(200_000).describe('Message content (markdown supported)'),
            thread_id: z.string().uuid().optional().describe('Thread ID to reply in (omit to start a new conversation; if you pass linked_task_id, the message auto-joins that task\'s thread)'),
            linked_task_id: z.string().uuid().optional().describe('Link this message to a task ID. Strongly recommended for task-related messages: all messages sharing a linked_task_id are grouped into one conversation thread (the task\'s thread), instead of each message starting a new thread.'),
            metadata: z.object({
                tokens_used: z.number().optional().describe('Tokens consumed for this response'),
                processing_ms: z.number().optional().describe('Processing time in ms'),
                proposed_task: z.object({
                    title: z.string().min(1).max(256),
                    description: z.string().max(10_000),
                }).optional().describe('Propose a task for user approval'),
            }).optional().describe('Optional message metadata'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_message_send'),
        async ({ content, thread_id, linked_task_id, metadata, ai_provenance, ai_provenance_id }) => {
            const now = new Date().toISOString();
            // Thread = task: group a message under its linked task so the whole
            // task conversation stays in one thread (omit thread_id and just pass
            // linked_task_id). Random thread only for ad-hoc, task-less chat.
            const threadId = thread_id ?? linked_task_id ?? randomUUID();

            // TARGET-058. The message is delivered to a named person — the owner — so it is stamped
            // like every other write that ends in front of a reader. The record describes the message
            // CONTENT; `metadata` is machine plumbing (token counts, a proposed task) and not prose
            // anyone reads as authored text.
            //
            // Phase 9 gave the message a column for the id, so the owner's own client renders the
            // label from the message rather than the record standing alone, joined only by hash.
            const provenanceId = await provenanceForWrite(storage, {
                principal: agentGaii,
                content,
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.message_send',
                surface: { visibility: 'private', humanAudience: true },
                labelPolicy: config.aiLabelPublic,
                nodeId: config.nodeId,
                baseUrl: config.baseUrl,
                enabled: config.aiProvenance,
            });

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
                aiProvenanceId: provenanceId,
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
                        ...(await writeProvenanceEcho(storage, config, provenanceId)),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_message_history ──
    mcp.tool(
        'aimeat_message_history',
        descriptionFor('aimeat_message_history'),
        {
            thread_id: z.string().optional().describe('Conversation thread to read (omit for recent messages across all threads)'),
            page: z.number().int().positive().optional().describe('Page number (default 1)'),
            per_page: z.number().int().positive().max(100).optional().describe('Messages per page (default 20, max 100)'),
        },
        annotationsFor('aimeat_message_history'),
        async ({ thread_id, page, per_page }) => {
            const result = await storage.listMessages(agentGaii, {
                threadId: thread_id,
                page: page ?? 1,
                perPage: per_page ?? 20,
            });
            // Return oldest-first so the agent reads the conversation in order.
            const ordered = [...result.messages].sort(
                (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
            );
            // TARGET-058: a thread an agent re-reads carries how each turn was made, so an agent
            // summarising the conversation for a person can say which turns a model wrote.
            const provFor = await readProvenanceMany(storage, config, ordered.map(m => m.aiProvenanceId));
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        messages: ordered.map(m => ({
                            id: m.id,
                            thread_id: m.threadId,
                            direction: m.direction,
                            from: m.senderGaii,
                            content: m.content,
                            metadata: m.metadata,
                            created_at: m.createdAt,
                            ...provFor(m.aiProvenanceId),
                        })),
                        total: result.total,
                    }, null, 2),
                }],
            };
        },
    );
}
