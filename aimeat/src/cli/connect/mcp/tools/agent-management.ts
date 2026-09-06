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
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent, envelopeResult } from './_registry.js';
import type { ApiResponse } from '../../api-client.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAgentManagementTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_agent_statistics', descriptionFor('aimeat_agent_statistics'), {
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_agent_statistics'), async ({ agent_name }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const resp = await client.get(`/v1/agents/${encodeURIComponent(agent)}/statistics`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  // Read-only: what the one-press basic agents would give this account, and whether the owner's
  // connector is up. Creating them is the owner's own press, so there is no write half here.
  mcp.tool('aimeat_agent_basics_get', descriptionFor('aimeat_agent_basics_get'), {
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_agent_basics_get'), async ({ agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/agents/v2/basic-agents');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_agent_basics_request', descriptionFor('aimeat_agent_basics_request'), {
    agent_name: agentNameSchema,
    note: z.string().max(300).optional().describe('One short phrase on why you are asking, shown to the person with the request.'),
  }, annotationsFor('aimeat_agent_basics_request'), async ({ agent_name, note }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.post('/v1/agents/v2/basic-agents/request', { note });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool(
    'aimeat_agent_tags_set',
    descriptionFor('aimeat_agent_tags_set'),
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe('Agent whose tags to update (same owner as the calling agent; pass the caller\'s own name to self-tag).'),
      tags: z.array(z.string()).describe('Replacement tag list. Empty array clears all tags.'),
    },
    async ({ agent_name, target_agent_name, tags }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/tags`, { tags });
      return envelopeResult(resp);
    },
  );

  mcp.tool(
    'aimeat_agent_mode_set',
    descriptionFor('aimeat_agent_mode_set'),
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe('Agent whose mode to update (same owner as the calling agent; pass the caller\'s own name to self-set).'),
      mode: z.enum(['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation']).describe('New mode.'),
    },
    async ({ agent_name, target_agent_name, mode }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/mode`, { mode });
      return envelopeResult(resp);
    },
  );

  mcp.tool(
    'aimeat_agent_description_set',
    descriptionFor('aimeat_agent_description_set'),
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe('Agent whose description to set (same owner; pass your own name to describe yourself).'),
      description: z.string().describe('What this agent is, in a sentence or two. Empty clears it.'),
    },
    async ({ agent_name, target_agent_name, description }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/description`, { description });
      return envelopeResult(resp);
    },
  );

  mcp.tool(
    'aimeat_agent_run_mode_set',
    descriptionFor('aimeat_agent_run_mode_set'),
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe("Agent whose run mode to set (same owner; pass the caller's own name to self-set)."),
      run_mode: z.enum(['spawn', 'resident']).nullable().describe("'spawn' = started per job; 'resident' = kept running; null = nobody has said, and a spawner leaves it alone."),
    },
    async ({ agent_name, target_agent_name, run_mode }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/run-mode`, { run_mode });
      return envelopeResult(resp);
    },
  );

  mcp.tool(
    'aimeat_agent_runtime_report',
    descriptionFor('aimeat_agent_runtime_report'),
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe("Agent this is about (same owner; pass the caller's own name to report your own)."),
      kind: z.string().describe("What kind of thing runs, e.g. 'python' or 'crew-def'."),
      file: z.string().optional().describe('Path to the file that runs, relative to your own root.'),
      sha256: z.string().optional().describe("Hash of that file's contents."),
      commit: z.string().optional().describe('Commit the file came from.'),
      runtime: z.string().optional().describe("Which runtime read it, e.g. 'crewaimeat 0.7.0'."),
      definition_revision: z.number().optional().describe('For a JSON crew: which definition revision was live.'),
    },
    async ({ agent_name, target_agent_name, ...src }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/runtime-source`, { runtime_source: src });
      return envelopeResult(resp);
    },
  );

  mcp.tool(
    'aimeat_agent_console_set',
    descriptionFor('aimeat_agent_console_set'),
    {
      agent_name: agentNameSchema,
      target_agent_name: z.string().describe('Agent whose console address to set (same owner as the calling agent; pass the caller\'s own name to record your own).'),
      console_url: z.string().describe('Absolute http(s) URL of that agent\'s page in its host, or \'\' to clear it.'),
    },
    async ({ agent_name, target_agent_name, console_url }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/console-url`, { console_url });
      return envelopeResult(resp);
    },
  );

  // ── Crew definition tools: thin proxies onto /v1/agents/:name/crew*, the same routes the Crew
  // tab and the node MCP use. `agent_name` here picks the REGISTERED agent that makes the call
  // (the connector convention); the definition's agent is `target_agent_name`.
  const crewAgentSchema = z.string().describe("The agent whose definition this is (bare name of one of the owner's agents, or its full GAII). The calling agent may name itself or a same-owner sibling.");
  const docSchema = z.record(z.string(), z.unknown());
  const text = (resp: ApiResponse) => envelopeResult(resp);

  mcp.tool(
    'aimeat_crew_get',
    descriptionFor('aimeat_crew_get'),
    { agent_name: agentNameSchema, target_agent_name: crewAgentSchema },
    async ({ agent_name, target_agent_name }) => {
      const { client } = pickAgent(registry, agent_name);
      return text(await client.get(`/v1/agents/${encodeURIComponent(target_agent_name)}/crew`));
    },
  );

  mcp.tool(
    'aimeat_crew_validate',
    descriptionFor('aimeat_crew_validate'),
    { agent_name: agentNameSchema, target_agent_name: crewAgentSchema, doc: docSchema.describe('The whole crew definition to check.') },
    async ({ agent_name, target_agent_name, doc }) => {
      const { client } = pickAgent(registry, agent_name);
      return text(await client.post(`/v1/agents/${encodeURIComponent(target_agent_name)}/crew/validate`, { doc }));
    },
  );

  mcp.tool(
    'aimeat_crew_try',
    descriptionFor('aimeat_crew_try'),
    {
      agent_name: agentNameSchema,
      target_agent_name: crewAgentSchema,
      doc: docSchema.optional().describe('Start a trial: the definition to run once. Omit when continuing to wait on a try_id.'),
      prompt: z.string().optional().describe('Start a trial: what the crew should do in this run. Required with doc.'),
      try_id: z.string().optional().describe('Continue waiting on a trial already started.'),
      wait_seconds: z.number().int().min(0).max(120).optional().describe('How long this call waits before handing back the try_id (default 50, max 120).'),
    },
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
    'aimeat_crew_draft',
    descriptionFor('aimeat_crew_draft'),
    { agent_name: agentNameSchema, target_agent_name: crewAgentSchema, doc: docSchema.optional().describe('The edits to keep. Omit it to discard the saved draft.') },
    async ({ agent_name, target_agent_name, doc }) => {
      const { client } = pickAgent(registry, agent_name);
      const path = `/v1/agents/${encodeURIComponent(target_agent_name)}/crew/draft`;
      return text(doc ? await client.put(path, { doc }) : await client.delete(path));
    },
  );

  mcp.tool(
    'aimeat_crew_publish',
    descriptionFor('aimeat_crew_publish'),
    {
      agent_name: agentNameSchema,
      target_agent_name: crewAgentSchema,
      doc: docSchema.optional().describe('The definition to make live.'),
      revision: z.number().int().positive().optional().describe('Instead of doc: republish this kept revision.'),
    },
    async ({ agent_name, target_agent_name, doc, revision }) => {
      const { client } = pickAgent(registry, agent_name);
      const base = `/v1/agents/${encodeURIComponent(target_agent_name)}/crew`;
      if (doc) return text(await client.post(`${base}/publish`, { doc }));
      if (revision !== undefined) return text(await client.post(`${base}/restore`, { revision }));
      return { content: [{ type: 'text' as const, text: 'Pass doc to publish a definition, or revision to restore a kept one.' }], isError: true };
    },
  );

  mcp.tool(
    'aimeat_crew_seed',
    descriptionFor('aimeat_crew_seed'),
    {
      agent_name: agentNameSchema,
      target_agent_name: crewAgentSchema,
      doc: docSchema.describe('The FIRST definition for this agent. Refused if it already has one.'),
      validate_with: z.string().optional().describe('Which connected same-owner agent should check it. Omit and any connected one is used.'),
    },
    async ({ agent_name, target_agent_name, doc, validate_with }) => {
      const { client } = pickAgent(registry, agent_name);
      return text(await client.post(`/v1/agents/${encodeURIComponent(target_agent_name)}/crew/seed`, { doc, validate_with }));
    },
  );
}
