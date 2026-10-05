/**
 * @file agent-management.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for agent classification attributes (tags, mode).
 *   These call the same REST endpoints the UI uses:
 *   - PATCH /tags is same-owner gated -- an agent may set tags on itself or a
 *     same-owner sibling (parity with agent-caps self-report). The crew scaffold
 *     self-tags on every start via this path.
 *   - PATCH /mode is same-owner gated too (since v1.3.0) -- an agent may set its own /
 *     a same-owner sibling's mode, so a device-authed crew self-sets task-runner at startup.
 *
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.7.0 -- 2026-10-02 -- aimeat_crew_llm_set's choice names the {kind:'node', role?} shape;
 *     aimeat_agent_runtime_report takes `llm` ('node' | 'machine').
 *   v1.6.0 -- 2026-08-31 -- aimeat_agent_basics_get, parity with the server MCP surface: a thin
 *     proxy onto GET /v1/agents/v2/basic-agents. Read-only; the creating press stays the owner's.
 *   v1.5.0 -- 2026-08-28 -- The five aimeat_crew_* tools, parity with the server MCP surface: thin
 *     proxies onto /v1/agents/:name/crew*, with try polling locally up to wait_seconds.
 *   v1.4.0 -- 2026-08-13 -- Add aimeat_agent_console_set, parity with the server MCP surface.
 *   v1.0.0 -- 2026-05-29 -- Initial creation: tags_set + mode_set
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-06-24 -- tags_set is now agent-callable on its own/same-owner record
 *     (REST PATCH /tags relaxed from owner-role to same-owner). mode_set stays owner-only.
 *   v1.3.0 -- 2026-07-02 -- mode_set relaxed from owner-role to same-owner too (parity with tags_set),
 *     so a device-authed crew can self-set task-runner mode at startup.
 *   v1.4.0 -- 2026-07-19 -- Register aimeat_agent_statistics on the connector MCP (thin proxy to
 *     GET /v1/agents/:name/statistics) so the shell-callable tool is also reachable via MCP.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent, envelopeResult } from './_registry.js';
import type { ApiResponse } from '../../api-client.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAgentManagementTools(mcp: McpServer, registry: AgentRegistry): void {

  // ── Crew definition tools: thin proxies onto /v1/agents/:name/crew*, the same routes the Crew
  // tab and the node MCP use. `agent_name` here picks the REGISTERED agent that makes the call
  // (the connector convention); the definition's agent is `target_agent_name`.
  const text = (resp: ApiResponse) => envelopeResult(resp);

  mcp.tool(
    'aimeat_crew_try',
    descriptionFor('aimeat_crew_try'),
    { agent_name: agentNameSchema, ...zodShapeFor('aimeat_crew_try') },
    async ({ agent_name, target_agent_name, doc, prompt, try_id, wait_seconds }) => {
      const { client } = pickAgent(registry, agent_name);
      const path = `/v1/agents/${encodeURIComponent(target_agent_name)}/crew/try`;
      let id = try_id;
      if (doc) {
        const started = await client.post(path, { doc, prompt });
        if (!started.ok) return text(started);
        id = (started.data as { try_id?: string })?.try_id;
      }
      if (!id) return { content: [{ type: 'text' as const, text: 'Pass doc and prompt to start a trial, or try_id to keep waiting on one.' }], isError: true };
      const deadline = Date.now() + Math.min(120, wait_seconds ?? 50) * 1000;
      for (;;) {
        const look = await client.get(`${path}/${encodeURIComponent(id)}`);
        const status = (look.data as { status?: string })?.status;
        if (!look.ok || status !== 'running' || Date.now() >= deadline) return text(look);
        await new Promise(r => setTimeout(r, 1000));
      }
    },
  );

  mcp.tool(
    'aimeat_crew_publish',
    descriptionFor('aimeat_crew_publish'),
    { agent_name: agentNameSchema, ...zodShapeFor('aimeat_crew_publish') },
    async ({ agent_name, target_agent_name, doc, revision }) => {
      const { client } = pickAgent(registry, agent_name);
      const base = `/v1/agents/${encodeURIComponent(target_agent_name)}/crew`;
      if (doc) return text(await client.post(`${base}/publish`, { doc }));
      if (revision !== undefined) return text(await client.post(`${base}/restore`, { revision }));
      return { content: [{ type: 'text' as const, text: 'Pass doc to publish a definition, or revision to restore a kept one.' }], isError: true };
    },
  );

}
