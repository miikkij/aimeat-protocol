/**
 * @file dm-messages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP tools for the FEDERATED direct-message inbox ("Postilaatikko") — send a DM
 *   from the connected agent to anyone on the network, and read replies addressed to it. Thin proxies to
 *   the node REST API (POST /v1/messages, GET /v1/messages/agent-inbox|agent-thread). Distinct from the
 *   agent↔owner dashboard tools in agent-messages.ts. Mirrors the server MCP surface (src/mcp/dm-messages.ts).
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.6.0 -- 2026-09-13 -- aimeat_dm_archive_as_owner / aimeat_dm_organize_as_owner: organising the
 *     owner's Messages list on messages:organize-as-owner, parity with the node MCP.
 *   v1.5.0 -- 2026-09-12 -- aimeat_dm_inbox_as_owner / aimeat_dm_thread_as_owner: the owner's own
 *     mailbox on messages:read-as-owner, parity with the node MCP.
 *   v1.4.0 -- 2026-09-06 -- aimeat_dm_broadcast: send-to-many in one call. Without it the only
 *     fan-out an agent had was a loop over aimeat_dm_send, which tags nothing and fills a list.
 *   v1.3.0 -- 2026-08-01 -- TARGET-058 Phase 11: dm_send / dm_ask / dm_send_as_owner carry
 *     `ai_provenance` / `ai_provenance_id` and echo what was recorded.
 *   v1.0.0 -- 2026-06-22 -- Initial: aimeat_dm_send / aimeat_dm_inbox / aimeat_dm_thread.
 *   v1.1.0 -- 2026-06-23 -- Add aimeat_dm_ask (structured federated AskUserQuestion) — connector parity.
 *   v1.2.0 -- 2026-07-19 -- Add aimeat_dm_send_as_owner — the shell path sends via POST /v1/messages as the
 *     connected principal (there is no send-as-owner REST route; the server MCP tool remains the way to
 *     speak strictly as the owner from an agent).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent, envelopeResult } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { provenanceEchoedResult } from '../../../../tool-dispatch/ai-provenance-carry.js';
import { organizePatchBody } from '../../../../tool-dispatch/tool-call-helpers-organize.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerDmMessagesTools(mcp: McpServer, registry: AgentRegistry): void {

  // The agent tells its own owner something: POST /v1/notifications as the connected principal,
  // parameter for parameter with the server tool (src/mcp/notify.ts).
  mcp.tool('aimeat_notify', descriptionFor('aimeat_notify'), zodShapeFor('aimeat_notify'), annotationsFor('aimeat_notify'), async ({ title, body, link, type }) => {
    const { client } = registry.resolve();
    const resp = await client.post('/v1/notifications', { title, body, link, type });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_dm_send', descriptionFor('aimeat_dm_send'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_send') }, annotationsFor('aimeat_dm_send'), async ({ agent_name, to, body, reply_to, subject, conversation_id, attachments, ai_provenance, ai_provenance_id }) => {
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

  mcp.tool('aimeat_dm_broadcast', descriptionFor('aimeat_dm_broadcast'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_broadcast') }, annotationsFor('aimeat_dm_broadcast'), async ({ agent_name, to, group_id, audience, mode, subject, body, attachments, interactive, ai_provenance, ai_provenance_id }) => {
    const { client } = pickAgent(registry, agent_name);
    const payload: Record<string, unknown> = {};
    if (to) payload.to = to;
    if (group_id) payload.group_id = group_id;
    if (audience) payload.audience = audience;
    if (mode) payload.mode = mode;
    if (subject) payload.subject = subject;
    if (body) payload.body = body;
    if (attachments) payload.attachments = attachments;
    if (interactive) payload.interactive = interactive;
    const resp = await client.post('/v1/messages/broadcast', payload);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_dm_broadcast', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_dm_ask', descriptionFor('aimeat_dm_ask'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_ask') }, annotationsFor('aimeat_dm_ask'), async ({ agent_name, to, questions, body, subject, conversation_id, submit_label, ai_provenance, ai_provenance_id }) => {
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

  mcp.tool('aimeat_dm_send_as_owner', descriptionFor('aimeat_dm_send_as_owner'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_send_as_owner') }, annotationsFor('aimeat_dm_send_as_owner'), async ({ agent_name, to, body, reply_to, subject, conversation_id, attachments, ai_provenance, ai_provenance_id }) => {
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

  mcp.tool('aimeat_dm_inbox', descriptionFor('aimeat_dm_inbox'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_inbox') }, annotationsFor('aimeat_dm_inbox'), async ({ agent_name, page, per_page }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (per_page) params.set('per_page', String(per_page));
    const qs = params.toString();
    const resp = await client.get(`/v1/messages/agent-inbox${qs ? '?' + qs : ''}`);
    return envelopeResult(resp);
  });

  // The owner's mailbox, on one explicit word. Thin over DELETE /v1/messages/:id, which is where the
  // scope is enforced and where the mailbox is resolved — this surface adds no rule of its own.
  mcp.tool('aimeat_dm_delete_as_owner', descriptionFor('aimeat_dm_delete_as_owner'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_delete_as_owner') }, annotationsFor('aimeat_dm_delete_as_owner'), async ({ agent_name, message_id }) => {
    const { client } = pickAgent(registry, agent_name);
    return envelopeResult(await client.delete(`/v1/messages/${encodeURIComponent(message_id)}`));
  });

  // Reading the owner's mailbox, on messages:read-as-owner. Thin over GET /v1/messages/overview and
  // /conversations/:id, which is where the word is enforced and the mailbox resolved.
  mcp.tool('aimeat_dm_inbox_as_owner', descriptionFor('aimeat_dm_inbox_as_owner'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_inbox_as_owner') }, annotationsFor('aimeat_dm_inbox_as_owner'), async ({ agent_name, limit, unread_only }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams({ limit: String(limit ?? 30) });
    if (unread_only) params.set('unread', 'true');
    return envelopeResult(await client.get(`/v1/messages/overview?${params}`));
  });

  mcp.tool('aimeat_dm_thread_as_owner', descriptionFor('aimeat_dm_thread_as_owner'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_thread_as_owner') }, annotationsFor('aimeat_dm_thread_as_owner'), async ({ agent_name, conversation_id, page, per_page }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (per_page) params.set('per_page', String(per_page));
    const qs = params.toString();
    return envelopeResult(await client.get(`/v1/messages/conversations/${encodeURIComponent(conversation_id)}${qs ? '?' + qs : ''}`));
  });

  // Organising the owner's Messages list, on messages:organize-as-owner. Thin over
  // POST /v1/messages/organize/archive and GET/PUT /v1/messages/organize, where the word is enforced
  // and the mailbox resolved.
  mcp.tool('aimeat_dm_archive_as_owner', descriptionFor('aimeat_dm_archive_as_owner'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_archive_as_owner') }, annotationsFor('aimeat_dm_archive_as_owner'), async ({ agent_name, conversation_ids, restore }) => {
    const { client } = pickAgent(registry, agent_name);
    return envelopeResult(await client.post('/v1/messages/organize/archive', { conversation_ids, ...(restore !== undefined ? { restore } : {}) }));
  });

  mcp.tool('aimeat_dm_organize_as_owner', descriptionFor('aimeat_dm_organize_as_owner'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_organize_as_owner') }, annotationsFor('aimeat_dm_organize_as_owner'), async ({ agent_name, auto_archive_enabled, auto_archive_days, fold_same_subject, add_rule, remove_rule, rules }) => {
    const { client } = pickAgent(registry, agent_name);
    const body = organizePatchBody({ auto_archive_enabled, auto_archive_days, fold_same_subject, add_rule, remove_rule, rules });
    return envelopeResult(Object.keys(body).length ? await client.put('/v1/messages/organize', body) : await client.get('/v1/messages/organize'));
  });

  mcp.tool('aimeat_dm_thread', descriptionFor('aimeat_dm_thread'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_dm_thread') }, annotationsFor('aimeat_dm_thread'), async ({ agent_name, conversation_id, page, per_page }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (per_page) params.set('per_page', String(per_page));
    const qs = params.toString();
    const resp = await client.get(`/v1/messages/agent-thread/${encodeURIComponent(conversation_id)}${qs ? '?' + qs : ''}`);
    return envelopeResult(resp);
  });
}
