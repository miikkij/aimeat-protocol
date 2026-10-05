/**
 * @file agent-messages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for agent message inbox and sending responses
 * @structure
 *   - registerAgentMessageTools() -- registers aimeat_message_inbox and aimeat_message_send
 * @usage
 *   import { registerAgentMessageTools } from './agent-messages.js';
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.6.0 -- 2026-08-11 -- aimeat_message_send calls services/agent-message-send.ts, the same
 *     function POST /v1/agents/:name/messages calls, instead of building the record itself. Four
 *     things this copy did differently are gone with it: the create-time `processedAt` the REST twin
 *     never set, the unscoped live-update emit that woke every owner on the node, the resource
 *     notification for `aimeat://messages/{thread}` (no resource template serves that URI; the twin
 *     uses `aimeat://agents/{name}/messages`), and a metadata mapping that had never grown the
 *     option-prompt fields. The tool still owns what the protocol makes it own: its parameters and
 *     its text answer.
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
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho, readProvenanceMany } from './ai-provenance-result.js';
import { sendAgentMessage } from '../services/agent-message-send.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

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
        zodShapeFor('aimeat_message_inbox'),
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
        zodShapeFor('aimeat_message_send'),
        annotationsFor('aimeat_message_send'),
        async ({ content, thread_id, linked_task_id, metadata, ai_provenance, ai_provenance_id }) => {
            // The record, the provenance stamp and the live-update emit are the REST route's, called
            // rather than copied (services/agent-message-send.ts). Direction is fixed: this tool is
            // the agent writing to its owner. The tool's job is the two ends — declaring these
            // parameters, and rendering the answer as text.
            const result = await sendAgentMessage(
                { storage, config, emitResourceUpdated },
                {
                    agentGaii,
                    senderGaii: agentGaii,
                    body: {
                        content,
                        direction: 'outbound',
                        thread_id,
                        linked_task_id,
                        metadata: metadata ? {
                            tokens_used: metadata.tokens_used,
                            processing_ms: metadata.processing_ms,
                            proposed_task: metadata.proposed_task,
                        } : undefined,
                    },
                    pipeline: 'mcp.message_send',
                    declaredProvenanceId: ai_provenance_id,
                    declaredProvenance: toDeclaredProvenance(ai_provenance),
                },
            );
            if (!result.ok) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: result.code, message: result.message }, null, 2),
                    }],
                    isError: true,
                };
            }
            const record = result.message;

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        message_id: record.id,
                        thread_id: record.threadId,
                        status: record.status,
                        created_at: record.createdAt,
                        ...(await writeProvenanceEcho(storage, config, record.aiProvenanceId)),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_message_history ──
    mcp.tool(
        'aimeat_message_history',
        descriptionFor('aimeat_message_history'),
        zodShapeFor('aimeat_message_history'),
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
