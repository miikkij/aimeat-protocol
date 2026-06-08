/**
 * @file organisms.ts
 * @description MCP tool registrations for organism (collective) management --
 *   listing, viewing, joining, leaving, and member listing.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- MCP drift reconciliation: id -> organism_id across get/join/leave/members;
 *     add message (join) and role/status filters (members) to match server MCP + REST.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerOrganismsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_organism_list', descriptionFor('aimeat_organism_list'), {}, annotationsFor('aimeat_organism_list'), async () => {
    const resp = await client.get('/v1/organisms');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_get', descriptionFor('aimeat_organism_get'), {
    organism_id: z.string().describe('ID of the organism to retrieve'),
  }, annotationsFor('aimeat_organism_get'), async ({ organism_id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_join', descriptionFor('aimeat_organism_join'), {
    organism_id: z.string().describe('ID of the organism to join'),
    message: z.string().optional().describe('Optional message for join requests (used when approval is required)'),
  }, annotationsFor('aimeat_organism_join'), async ({ organism_id, message }) => {
    const body: Record<string, unknown> = {};
    if (message != null) body.message = message;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/join`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_leave', descriptionFor('aimeat_organism_leave'), {
    organism_id: z.string().describe('ID of the organism to leave'),
  }, annotationsFor('aimeat_organism_leave'), async ({ organism_id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/leave`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_members', descriptionFor('aimeat_organism_members'), {
    organism_id: z.string().describe('The organism ID'),
    role: z.string().optional().describe('Filter by role: creator, admin, member'),
    status: z.string().optional().describe('Filter by status: active, pending, banned (default: active)'),
  }, annotationsFor('aimeat_organism_members'), async ({ organism_id, role, status }) => {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const qs = params.toString();
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/members${qs ? `?${qs}` : ''}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_create', descriptionFor('aimeat_organism_create'), {
    name: z.string().describe('Organism name (min 2 chars)'),
    description: z.string().optional().describe('What this organism is for'),
    type: z.string().optional().describe('community | team | club | cooperative | project'),
    join_policy: z.string().optional().describe('open | approval_required | invite_only'),
    visibility: z.string().optional().describe('public | listed | private'),
  }, annotationsFor('aimeat_organism_create'), async ({ name, description, type, join_policy, visibility }) => {
    const body: Record<string, unknown> = { name };
    if (description != null) body.description = description;
    if (type != null) body.type = type;
    if (join_policy != null) body.join_policy = join_policy;
    if (visibility != null) body.visibility = visibility;
    const resp = await client.post('/v1/organisms', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
