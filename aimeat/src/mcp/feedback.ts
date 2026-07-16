/**
 * @file feedback.ts
 * @description MCP Node Feedback Channel tool registration. Two tools: aimeat_feedback_send
 *   (open a platform-feedback thread to the node operator, or reply into an existing one via
 *   thread_id) and aimeat_feedback_inbox (the agent's own threads + operator replies). Core
 *   logic is shared with the REST routes via src/services/feedback.ts, so both surfaces
 *   validate and behave identically (including the blocker → operator notification).
 * @structure
 *   - registerFeedbackTools() — registers both tools on an McpServer instance
 * @usage
 *   import { registerFeedbackTools } from './feedback.js';
 *   registerFeedbackTools(mcp, storage, config, getAgentGaii);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: Node Feedback Channel v1.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { createFeedbackThread, replyToFeedback } from '../services/feedback.js';

export function registerFeedbackTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 1: aimeat_feedback_send ──
    mcp.tool(
        'aimeat_feedback_send',
        descriptionFor('aimeat_feedback_send'),
        {
            category: z.enum(['bug', 'blocker', 'idea', 'ux', 'question', 'other']).optional()
                .describe('Feedback category (required when opening a new thread)'),
            title: z.string().optional().describe('Short summary, max 200 chars (required when opening a new thread)'),
            body: z.string().describe('The feedback text, max 8000 chars'),
            context: z.record(z.string(), z.string()).optional().describe('Optional pointers: { app, endpoint, version, url }'),
            thread_id: z.string().optional().describe('Existing thread id to reply into (omit to open a new thread)'),
        },
        annotationsFor('aimeat_feedback_send'),
        async ({ category, title, body, context, thread_id }) => {
            const result = thread_id
                ? await replyToFeedback(storage, { id: thread_id, actor: agentGaii, isOperator: false, body })
                : await createFeedbackThread(storage, config, { sender: agentGaii, category: category ?? '', title: title ?? '', body, context });
            if (!result.ok) {
                return { content: [{ type: 'text' as const, text: `${result.code}: ${result.message}` }], isError: true };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        thread_id: result.record.id,
                        status: result.record.status,
                        category: result.record.category,
                        submitted: true,
                        check_replies_with: 'aimeat_feedback_inbox',
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_feedback_inbox ──
    mcp.tool(
        'aimeat_feedback_inbox',
        descriptionFor('aimeat_feedback_inbox'),
        {},
        annotationsFor('aimeat_feedback_inbox'),
        async () => {
            const threads = await storage.listFeedbackBySender(agentGaii);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ total: threads.length, threads }, null, 2),
                }],
            };
        },
    );
}
