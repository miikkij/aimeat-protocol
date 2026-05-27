/**
 * @file organisms.ts
 * @description MCP tool registrations for organism (collective) management --
 *   listing, viewing, joining, leaving, and member listing.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../lib/api-client.js';

export function registerOrganismsTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_organism_list', 'List organisms', {}, async () => {
    const resp = await client.get('/v1/organisms');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_get', 'Get organism detail', {
    id: z.string().describe('Organism identifier'),
  }, async ({ id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_join', 'Join an organism', {
    id: z.string().describe('Organism identifier'),
  }, async ({ id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(id)}/join`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_leave', 'Leave an organism', {
    id: z.string().describe('Organism identifier'),
  }, async ({ id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(id)}/leave`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_members', 'List organism members', {
    id: z.string().describe('Organism identifier'),
  }, async ({ id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(id)}/members`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
