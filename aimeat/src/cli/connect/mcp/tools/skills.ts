/**
 * @file skills.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP tool registrations for the skills registry (dedicated system,
 *   distinct from knowledge packages): publish, list (library/linked/mine), get (resolve),
 *   link, unlink. Thin proxies over the node's /v1/skills + /v1/agents/:name/skills REST
 *   surface; multi-agent routing via agent_name (pickAgent). On this surface publish is
 *   inline-only — the local runtime has the files at hand, so presigned ZIP upload is not
 *   needed (that mode lives on the server MCP surface).
 * @version-history
 *   v1.0.0 -- 2026-07-05 -- Initial: Phase 2a registry tools (node + user scopes).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { agentNameSchema, pickAgent } from './_registry.js';

export function registerSkillsTools(mcp: McpServer, registry: AgentRegistry): void {
  const json = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

  mcp.tool('aimeat_skill_publish', descriptionFor('aimeat_skill_publish'), {
    skill_md: z.string().optional().describe('The SKILL.md content (frontmatter + body). Required on this surface (no presigned upload mode here).'),
    files: z.record(z.string(), z.string()).optional().describe('Additional files as relative-path -> content (scripts/, references/, assets/).'),
    scope: z.enum(['user', 'node', 'workspace']).optional().describe('Registry scope (default user). node is operator-only; workspace requires organism_id + workspace_id.'),
    visibility: z.enum(['owner', 'members', 'public']).optional().describe('Registry visibility (node/user; workspace skills are always workspace-visible).'),
    organism_id: z.string().optional().describe('Workspace scope: the organism id.'),
    workspace_id: z.string().optional().describe('Workspace scope: the workspace id.'),
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_skill_publish'), async ({ skill_md, files, scope, visibility, organism_id, workspace_id, agent_name }) => {
    if (!skill_md) {
      return { content: [{ type: 'text' as const, text: 'skill_md is required on this surface — pass the SKILL.md content inline.' }], isError: true };
    }
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.post('/v1/skills', { skill_md, files, scope, visibility, organism: organism_id, ws: workspace_id });
    return json(resp.data ?? resp);
  });

  mcp.tool('aimeat_skill_list', descriptionFor('aimeat_skill_list'), {
    view: z.enum(['library', 'linked', 'mine']).optional().describe('Which listing (default library).'),
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_skill_list'), async ({ view, agent_name }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    if (view === 'linked') {
      const resp = await client.get(`/v1/agents/${encodeURIComponent(agent)}/skills/links`);
      return json(resp.data ?? resp);
    }
    const scope = view === 'mine' ? 'user' : 'library';
    const resp = await client.get(`/v1/skills?scope=${scope}`);
    return json(resp.data ?? resp);
  });

  mcp.tool('aimeat_skill_get', descriptionFor('aimeat_skill_get'), {
    ref: z.string().optional().describe('Full skill ref: node:{name} or user:{owner}/{name}.'),
    name: z.string().optional().describe('Bare skill name (own registry first, then node library).'),
    manifest_only: z.boolean().optional().describe('Return only the manifest, no file bodies.'),
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_skill_get'), async ({ ref, name, manifest_only, agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    let path: string;
    if (ref) {
      // Decompose the ref into the name + scope query the REST route expects.
      const node = ref.match(/^node:([a-z0-9-]+)$/);
      const user = ref.match(/^user:([a-z0-9_-]+)\/([a-z0-9-]+)$/);
      const ws = ref.match(/^ws:([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\/([a-z0-9-]+)$/);
      if (node) path = `/v1/skills/${encodeURIComponent(node[1])}?scope=node`;
      else if (user) path = `/v1/skills/${encodeURIComponent(user[2])}?scope=user&owner=${encodeURIComponent(user[1])}`;
      else if (ws) path = `/v1/skills/${encodeURIComponent(ws[3])}?scope=workspace&organism=${encodeURIComponent(ws[1])}&ws=${encodeURIComponent(ws[2])}`;
      else {
        return { content: [{ type: 'text' as const, text: `Not a valid skill ref: ${ref}` }], isError: true };
      }
    } else if (name) {
      path = `/v1/skills/${encodeURIComponent(name)}`;
    } else {
      return { content: [{ type: 'text' as const, text: 'Provide ref or name' }], isError: true };
    }
    if (manifest_only) path += `${path.includes('?') ? '&' : '?'}manifest_only=true`;
    const resp = await client.get(path);
    return json(resp.data ?? resp);
  });

  mcp.tool('aimeat_skill_link', descriptionFor('aimeat_skill_link'), {
    ref: z.string().describe('Skill ref to attach: node:{name} or user:{owner}/{name}.'),
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_skill_link'), async ({ ref, agent_name }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const resp = await client.post(`/v1/agents/${encodeURIComponent(agent)}/skills`, { ref });
    return json(resp.data ?? resp);
  });

  mcp.tool('aimeat_skill_unlink', descriptionFor('aimeat_skill_unlink'), {
    ref: z.string().describe('Skill ref to detach.'),
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_skill_unlink'), async ({ ref, agent_name }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const resp = await client.delete(`/v1/agents/${encodeURIComponent(agent)}/skills?ref=${encodeURIComponent(ref)}`);
    return json(resp.data ?? resp);
  });
}
