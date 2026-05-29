/**
 * @file organisms.ts
 * @description MCP tool registrations for organism (collective) management --
 *   listing, viewing, joining, leaving, and member listing.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';

export function registerOrganismsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_organism_list', 'List organisms', {}, annotationsFor('aimeat_organism_list'), async () => {
    const resp = await client.get('/v1/organisms');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_get', 'Get organism detail', {
    id: z.string().describe('Organism identifier'),
  }, annotationsFor('aimeat_organism_get'), async ({ id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_join', 'Join an organism', {
    id: z.string().describe('Organism identifier'),
  }, annotationsFor('aimeat_organism_join'), async ({ id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(id)}/join`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_leave', 'Leave an organism', {
    id: z.string().describe('Organism identifier'),
  }, annotationsFor('aimeat_organism_leave'), async ({ id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(id)}/leave`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_members', 'List organism members', {
    id: z.string().describe('Organism identifier'),
  }, annotationsFor('aimeat_organism_members'), async ({ id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(id)}/members`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
