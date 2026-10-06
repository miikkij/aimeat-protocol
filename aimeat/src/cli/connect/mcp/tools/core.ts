/**
 * @file core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Core MCP tool registrations for memory, catalogue, work, wallet,
 *   boards, storage, and admin endpoints. These cover the most commonly used
 *   AIMEAT API surface.
 * @structure
 *   - registerCoreTools() -- Registers core REST-backed connector MCP tools
 * @version-history
 *   2026-10-06 — The board post, storage, data package and admin tools run their dispatch definition
 *     (secaudit 2026-10 follow-up, Part B); only the memory tools keep a handler here.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.20.0 -- 2026-10-01 -- aimeat_admin_federation_peer_remove (DELETE /v1/federation/peers/:nodeId,
 *     ?emergency=true).
 *   v1.19.0 -- 2026-09-30 -- aimeat_admin_node_update, thin over GET /v1/admin/node-update.
 *   v1.18.0 -- 2026-09-29 -- aimeat_storage_upload forwards workspace_refs for a 'workspace' file.
 *   v1.17.2 -- 2026-09-26 -- The `resolution` description of aimeat_admin_incident_resolve names the app
 *     grants and access tokens too.
 *   v1.17.1 -- 2026-09-26 -- The `resolution` description of aimeat_admin_incident_resolve names the
 *     cortexes and ecosystem apps a decision covers.
 *   v1.17.0 -- 2026-09-26 -- aimeat_admin_incident_resolve forwards `name` and `resolution`, to decide
 *     one name of the incident the move to the full identity opened.
 *   v1.16.2 -- 2026-09-26 -- aimeat_action_execute's provider_gaii says what the catalogue entry says:
 *     an agent's GAII, or a person's GHII when a person published the action.
 *   v1.16.1 -- 2026-09-26 -- aimeat_admin_hook_set's `actions` says each reference names an action
 *     already published on the node: publish it, then bind it (security audit A8-3).
 *   v1.16.0 -- 2026-09-25 -- aimeat_admin_federation_relay_claim_set (PUT /v1/federation/peers/:nodeId/
 *     relay-claim), node_id and relay_claim both forwarded.
 *   v1.15.1 -- 2026-09-24 -- aimeat_memory_restore sends owner_scope. It declared the flag and dropped
 *     it, so an owner-scoped restore reached only the caller's own bin, where the node's tool and the
 *     CLI reached the owner's other principals too.
 *   v1.15.0 -- 2026-09-12 -- aimeat_admin_statistics, thin over GET /v1/stats, with from and to
 *     forwarded as a pair because the route reads them only as a pair.
 *   v1.14.0 -- 2026-09-12 -- aimeat_admin_hooks and aimeat_admin_hook_set, thin over
 *     GET /v1/admin/hooks and the PUT the Hooks page uses to bind a moment.
 *   v1.13.0 -- 2026-09-08 -- aimeat_admin_cors_overview and aimeat_admin_cors_set, thin over
 *     GET /v1/admin/cors/overview and the two PUT cors routes the CORS page uses.
 *   v1.12.0 -- 2026-09-05 -- aimeat_admin_security_overview and aimeat_admin_incident_resolve, thin
 *     over GET /v1/admin/security/overview and the incident resolve route the Security page uses.
 *   v1.11.0 -- 2026-08-24 -- BR-04: the nine SSO-administration and account-lifecycle tools, thin
 *     over the same /v1/admin/sso and /v1/admin/owners routes the node MCP's service calls serve.
 *   v1.10.0 -- 2026-08-16 -- owner_scope on memory_read and memory_write, limit on memory_search.
 *     All three existed on the server MCP tool and on the REST route and were undeclared here, so
 *     zod dropped them. Measured cost: a crew's public mirror read only its own namespace for weeks
 *     while its job was to copy six agents' writes, and every connector write landed under the agent
 *     however the caller meant it. A dropped permission flag comes back as NOT_FOUND, which is the
 *     one shape nobody debugs by looking for a missing scope.
 *   v1.9.0 -- 2026-08-15 -- aimeat_storage_delete, so the connector surface does not lag the node.
 *   v1.0.0 -- 2026-05-28 -- Initial connector MCP core tools
 *   v1.1.0 -- 2026-05-28 -- Add memory tags and owner-scope listing support
 *   v1.2.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.3.0 -- 2026-05-29 -- Per-call agent routing via pickAgent (was: always primary
 *     agent's client at module scope). Fixes AUTH_REQUIRED for multi-agent installs
 *     where the LLM passes agent_name="company-crew" but core tools silently routed
 *     through whoever the connector picked as primary at startup.
 *   v1.4.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.5.0 -- 2026-05-30 -- MCP audit Phase 1 (F5): read tools (memory_read/list, catalogue_search,
 *     work_inbox, board_read) accept response_format and shape REST payloads via shared shapeResponse().
 *   v1.6.0 -- 2026-05-30 -- F10 drift reconciliation: align connector core tool inputs with server MCP +
 *     REST (catalogue_search search/category; memory_write group_id+ttl_hours; memory_search visibility;
 *     board read/post/create/subscribe filters; work_deliver output; message_send content; storage_upload).
 *   v1.8.0 -- 2026-08-01 -- TARGET-058 Phase 11b: aimeat_memory_read folds meta.provenance, so a
 *     crew reading its own content back gets the record and not just an id it cannot resolve.
 *   v1.7.0 -- 2026-08-01 -- TARGET-058 Phase 11: memory_write and board_post carry `ai_provenance` /
 *     `ai_provenance_id`. The catalog had advertised both since Phase 4 while these shapes stripped
 *     them as unknown keys, so a crew's declaration vanished behind an ok:true.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor, jsonContent } from '../../../../tool-catalog/shape.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { carrierAttach, provenanceEchoedResult } from '../../../../tool-dispatch/ai-provenance-carry.js';
import { agentNameSchema, pickAgent, envelopeResult, flagged } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerCoreTools(mcp: McpServer, registry: AgentRegistry): void {
  // ── Memory ──────────────────────────────────────────────────────────

  // The bin, on the connector's door. Both are thin proxies onto the same route the CLI dispatch
  // and the node MCP reach, so who may remove what is decided in one place.
  mcp.tool('aimeat_memory_delete', descriptionFor('aimeat_memory_delete'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_memory_delete') }, annotationsFor('aimeat_memory_delete'), async ({ agent_name, key, owner_scope }) => {
    const { client } = pickAgent(registry, agent_name);
    const q = owner_scope ? '?owner_scope=true' : '';
    const resp = await client.delete(`/v1/memory/${encodeURIComponent(key)}${q}`);
    return flagged(jsonContent(resp), resp);
  });

  mcp.tool('aimeat_memory_restore', descriptionFor('aimeat_memory_restore'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_memory_restore') }, annotationsFor('aimeat_memory_restore'), async ({ agent_name, key, owner_scope }) => {
    const { client } = pickAgent(registry, agent_name);
    // As the delete above and the node's own tool: the owner's reach, only when asked for.
    const q = owner_scope ? '?owner_scope=true' : '';
    const resp = await client.post(`/v1/memory/${encodeURIComponent(key)}/restore${q}`, {});
    return flagged(jsonContent(resp), resp);
  });

  mcp.tool('aimeat_memory_write', descriptionFor('aimeat_memory_write'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Memory entry key'),
    value: z.unknown().describe('Value to store'),
    visibility: z.string().optional().describe('Visibility level (default: private)'),
    group_id: z.string().optional().describe('ID of sharing group (required for group visibility)'),
    tags: z.array(z.string()).optional().describe('Optional tags for filtering/shared areas'),
    ttl_hours: z.number().optional().describe('Time-to-live in hours'),
    // The write half of the same hole. Without this every write through the connector landed in the
    // AGENT's namespace, whatever the caller meant, and the owner's own tools then could not see it.
    // Requires the memory:write-as-owner scope, which the owner grants per agent and the ROUTE
    // enforces — resolveWriteTarget() refuses without it, so sending the flag can only ask.
    owner_scope: z.boolean().optional().describe("Write under the OWNER instead of yourself, so the owner's own tools read it as theirs. Needs the memory:write-as-owner scope. Without this the write lands in your own namespace, as before. Separate from `visibility`: where a record lives and who may read it are different questions."),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_memory_write'), async ({ agent_name, key, value, visibility, group_id, tags, ttl_hours, owner_scope, ai_provenance, ai_provenance_id }) => {
    const { client } = pickAgent(registry, agent_name);
    const body: Record<string, unknown> = { key, value };
    if (visibility) body.visibility = visibility;
    if (group_id) body.group_id = group_id;
    if (tags) body.tags = tags;
    if (ttl_hours !== undefined) body.ttl_hours = ttl_hours;
    if (owner_scope) body.owner_scope = true;
    // An id the node already minted travels in the write body itself — POST /v1/memory takes
    // `ai_provenance_id` and checks it belongs to this owner. An inline DECLARATION cannot: the
    // route has no field for it, so it is recorded after the write, against this key, by
    // carryDeclaration(). See ai-provenance-carry.ts for why that order and not the other one.
    if (ai_provenance_id) body.ai_provenance_id = ai_provenance_id;
    const resp = await client.post('/v1/memory', body);
    if (!resp.ok) return envelopeResult(resp);
    return provenanceEchoedResult(client, {
      tool: 'aimeat_memory_write',
      declared: ai_provenance,
      declaredId: ai_provenance_id,
      attach: carrierAttach('aimeat_memory_write', { key, value }),
    }, resp);
  });

  mcp.tool('aimeat_memory_search', descriptionFor('aimeat_memory_search'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_memory_search') }, annotationsFor('aimeat_memory_search'), async ({ agent_name, query, type, visibility, limit, include_versions }) => {
    const { client } = pickAgent(registry, agent_name);
    // SNIPPETS, like the node MCP tool of the same name. This asked for the plain search, which
    // answers with the FULL value of every hit, so a broad query pulled whole records across the
    // wire and through a model's context to answer "which keys mention this". Review item 6.4.
    const params = new URLSearchParams({ include: 'meta', include_versions: include_versions ? 'true' : 'false' });
    // The route makes `q` optional when a single type is given, so pass what the caller sent and let
    // one implementation decide. Sending an empty `q` instead would be this door answering the
    // question differently from the other two.
    if (query) params.set('q', query);
    if (type) params.set('type', type);
    if (visibility) params.set('visibility', visibility);
    if (limit !== undefined) params.set('limit', String(limit));
    const resp = await client.get(`/v1/memory/search?${params.toString()}`);
    return envelopeResult(resp);
  });
}
