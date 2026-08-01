/**
 * @file dm-messages.ts
 * @description Connector MCP tools for the FEDERATED direct-message inbox ("Postilaatikko") — send a DM
 *   from the connected agent to anyone on the network, and read replies addressed to it. Thin proxies to
 *   the node REST API (POST /v1/messages, GET /v1/messages/agent-inbox|agent-thread). Distinct from the
 *   agent↔owner dashboard tools in agent-messages.ts. Mirrors the server MCP surface (src/mcp/dm-messages.ts).
 * @version-history
 *   v1.3.0 -- 2026-08-01 -- TARGET-058 Phase 11: dm_send / dm_ask / dm_send_as_owner carry
 *     `ai_provenance` / `ai_provenance_id` and echo what was recorded.
 *   v1.0.0 -- 2026-06-22 -- Initial: aimeat_dm_send / aimeat_dm_inbox / aimeat_dm_thread.
 *   v1.1.0 -- 2026-06-23 -- Add aimeat_dm_ask (structured federated AskUserQuestion) — connector parity.
 *   v1.2.0 -- 2026-07-19 -- Add aimeat_dm_send_as_owner — the shell path sends via POST /v1/messages as the
 *     connected principal (there is no send-as-owner REST route; the server MCP tool remains the way to
 *     speak strictly as the owner from an agent).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { provenanceEchoedResult } from '../../ai-provenance-carry.js';

export function registerDmMessagesTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_dm_send', descriptionFor('aimeat_dm_send'), {
    agent_name: agentNameSchema,
    to: z.string().describe('Recipient: owner@node, agent#owner@node, or eco:app#owner@node.'),
    body: z.string().optional().describe('Message body (GFM markdown). Optional if you attach a file.'),
    reply_to: z.string().optional().describe('Id of a message you are replying to (keeps the thread).'),
    subject: z.string().optional().describe('Open a NEW topic thread with this title.'),
    conversation_id: z.string().optional().describe('Continue a specific existing thread by id.'),
    attachments: z.array(z.record(z.string(), z.unknown())).optional().describe('Up to 20 { storage_key, mime, kind, size, name } descriptors (upload files first via aimeat_storage_upload).'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_dm_send'), async ({ agent_name, to, body, reply_to, subject, conversation_id, attachments, ai_provenance, ai_provenance_id }) => {
    const { client } = pickAgent(registry, agent_name);
    const payload: Record<string, unknown> = { to };
    if (body) payload.body = body;
    if (reply_to) payload.reply_to = reply_to;
    if (subject) payload.subject = subject;
    if (conversation_id) payload.conversation_id = conversation_id;
    if (attachments) payload.attachments = attachments;
    const resp = await client.post('/v1/messages', payload);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_dm_send', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_dm_ask', descriptionFor('aimeat_dm_ask'), {
    agent_name: agentNameSchema,
    to: z.string().describe('Recipient: owner@node, agent#owner@node, or eco:app#owner@node.'),
    questions: z.array(z.record(z.string(), z.unknown())).describe('1–20 questions, each { id, header, prompt, options:[{id,label}], multiSelect?, allowOther?, required? }.'),
    body: z.string().optional().describe('Optional intro text shown above the questions (GFM markdown).'),
    subject: z.string().optional().describe('Open a NEW topic thread with this title.'),
    conversation_id: z.string().optional().describe('Continue a specific existing thread by id.'),
    submit_label: z.string().optional().describe('Optional submit-button label.'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_dm_ask'), async ({ agent_name, to, questions, body, subject, conversation_id, submit_label, ai_provenance, ai_provenance_id }) => {
    const { client } = pickAgent(registry, agent_name);
    const payload: Record<string, unknown> = {
      to,
      interactive: { role: 'questions', v: 1, questions, ...(submit_label ? { submitLabel: submit_label } : {}) },
    };
    if (body) payload.body = body;
    if (subject) payload.subject = subject;
    if (conversation_id) payload.conversation_id = conversation_id;
    const resp = await client.post('/v1/messages', payload);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_dm_ask', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_dm_send_as_owner', descriptionFor('aimeat_dm_send_as_owner'), {
    agent_name: agentNameSchema,
    to: z.string().describe('Recipient: owner@node, agent#owner@node, or eco:app#owner@node.'),
    body: z.string().optional().describe('Message body (GFM markdown). Optional if you attach a file.'),
    reply_to: z.string().optional().describe('Id of a message you are replying to (keeps the thread).'),
    subject: z.string().optional().describe('Open a NEW topic thread with this title.'),
    conversation_id: z.string().optional().describe('Continue a specific existing thread by id.'),
    attachments: z.array(z.record(z.string(), z.unknown())).optional().describe('Up to 20 { storage_key, mime, kind, size, name } descriptors.'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_dm_send_as_owner'), async ({ agent_name, to, body, reply_to, subject, conversation_id, attachments, ai_provenance, ai_provenance_id }) => {
    const { client } = pickAgent(registry, agent_name);
    const payload: Record<string, unknown> = { to };
    if (body) payload.body = body;
    if (reply_to) payload.reply_to = reply_to;
    if (subject) payload.subject = subject;
    if (conversation_id) payload.conversation_id = conversation_id;
    if (attachments) payload.attachments = attachments;
    const resp = await client.post('/v1/messages', payload);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_dm_send_as_owner', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_dm_inbox', descriptionFor('aimeat_dm_inbox'), {
    agent_name: agentNameSchema,
    page: z.number().int().positive().optional().describe('Page number (default 1)'),
    per_page: z.number().int().positive().max(100).optional().describe('Messages per page (default 20, max 100)'),
  }, annotationsFor('aimeat_dm_inbox'), async ({ agent_name, page, per_page }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (per_page) params.set('per_page', String(per_page));
    const qs = params.toString();
    const resp = await client.get(`/v1/messages/agent-inbox${qs ? '?' + qs : ''}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_dm_thread', descriptionFor('aimeat_dm_thread'), {
    agent_name: agentNameSchema,
    conversation_id: z.string().describe('Conversation id (from aimeat_dm_inbox or aimeat_dm_send).'),
    page: z.number().int().positive().optional().describe('Page number (default 1)'),
    per_page: z.number().int().positive().max(200).optional().describe('Messages per page (default 50, max 200)'),
  }, annotationsFor('aimeat_dm_thread'), async ({ agent_name, conversation_id, page, per_page }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (per_page) params.set('per_page', String(per_page));
    const qs = params.toString();
    const resp = await client.get(`/v1/messages/agent-thread/${encodeURIComponent(conversation_id)}${qs ? '?' + qs : ''}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
