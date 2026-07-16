/**
 * @file feedback.ts
 * @description Connector MCP tools for the Node Feedback Channel — report platform bugs/blockers/
 *   ideas to the node operator (aimeat_feedback_send, with thread_id for follow-ups) and read the
 *   agent's own threads + operator replies (aimeat_feedback_inbox). Thin proxies to the node REST
 *   API (POST /v1/feedback[, /:id/reply], GET /v1/feedback/mine). Mirrors the server MCP surface
 *   (src/mcp/feedback.ts).
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: Node Feedback Channel v1.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerFeedbackTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_feedback_send', descriptionFor('aimeat_feedback_send'), {
    agent_name: agentNameSchema,
    category: z.enum(['bug', 'blocker', 'idea', 'ux', 'question', 'other']).optional()
      .describe('Feedback category (required when opening a new thread)'),
    title: z.string().optional().describe('Short summary, max 200 chars (required when opening a new thread)'),
    body: z.string().describe('The feedback text, max 8000 chars'),
    context: z.record(z.string(), z.string()).optional().describe('Optional pointers: { app, endpoint, version, url }'),
    thread_id: z.string().optional().describe('Existing thread id to reply into (omit to open a new thread)'),
  }, annotationsFor('aimeat_feedback_send'), async ({ agent_name, category, title, body, context, thread_id }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = thread_id
      ? await client.post(`/v1/feedback/${encodeURIComponent(thread_id)}/reply`, { body })
      : await client.post('/v1/feedback', { category, title, body, ...(context ? { context } : {}) });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_feedback_inbox', descriptionFor('aimeat_feedback_inbox'), {
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_feedback_inbox'), async ({ agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/feedback/mine');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
