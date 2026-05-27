/**
 * @file capabilities.ts
 * @description MCP tool registrations for capability CRUD, invocation, and vouching.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerCapabilitiesTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_capabilities_list', 'List registered capabilities', {
    query: z.string().optional().describe('Search query'),
  }, async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/capabilities${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_get', 'Get capability detail', {
    id: z.string().describe('Capability identifier'),
  }, async ({ id }) => {
    const resp = await client.get(`/v1/capabilities/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_invoke', 'Invoke a capability', {
    id: z.string().describe('Capability identifier'),
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters'),
  }, async ({ id, input }) => {
    const resp = await client.post(`/v1/capabilities/${encodeURIComponent(id)}/invoke`, input ?? {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_create', 'Create a new capability', {
    name: z.string().describe('Capability name'),
    description: z.string().describe('Capability description'),
    type: z.string().describe('Capability type'),
  }, async ({ name, description, type }) => {
    const resp = await client.post('/v1/capabilities', { name, description, type });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_update', 'Update a capability', {
    id: z.string().describe('Capability identifier'),
    name: z.string().optional().describe('Updated name'),
    description: z.string().optional().describe('Updated description'),
  }, async ({ id, name, description }) => {
    const body: Record<string, unknown> = {};
    if (name) body.name = name;
    if (description) body.description = description;
    const resp = await client.put(`/v1/capabilities/${encodeURIComponent(id)}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_delete', 'Delete a capability', {
    id: z.string().describe('Capability identifier'),
  }, async ({ id }) => {
    const resp = await client.delete(`/v1/capabilities/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_vouch', 'Vouch for a capability', {
    id: z.string().describe('Capability identifier'),
  }, async ({ id }) => {
    const resp = await client.post(`/v1/capabilities/${encodeURIComponent(id)}/vouch`, {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
