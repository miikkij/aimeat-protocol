/**
 * @file capabilities.ts
 * @description MCP tool registrations for capability CRUD, invocation, and vouching.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerCapabilitiesTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_capabilities_list', descriptionFor('aimeat_capabilities_list'), {
    query: z.string().optional().describe('Search query'),
  }, annotationsFor('aimeat_capabilities_list'), async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/capabilities${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_get', descriptionFor('aimeat_capabilities_get'), {
    id: z.string().describe('Capability identifier'),
  }, annotationsFor('aimeat_capabilities_get'), async ({ id }) => {
    const resp = await client.get(`/v1/capabilities/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_invoke', descriptionFor('aimeat_capabilities_invoke'), {
    id: z.string().describe('Capability identifier'),
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters'),
  }, annotationsFor('aimeat_capabilities_invoke'), async ({ id, input }) => {
    const resp = await client.post(`/v1/capabilities/${encodeURIComponent(id)}/invoke`, input ?? {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_create', descriptionFor('aimeat_capabilities_create'), {
    name: z.string().describe('Capability name'),
    description: z.string().describe('Capability description'),
    type: z.string().describe('Capability type'),
  }, annotationsFor('aimeat_capabilities_create'), async ({ name, description, type }) => {
    const resp = await client.post('/v1/capabilities', { name, description, type });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_update', descriptionFor('aimeat_capabilities_update'), {
    id: z.string().describe('Capability identifier'),
    name: z.string().optional().describe('Updated name'),
    description: z.string().optional().describe('Updated description'),
  }, annotationsFor('aimeat_capabilities_update'), async ({ id, name, description }) => {
    const body: Record<string, unknown> = {};
    if (name) body.name = name;
    if (description) body.description = description;
    const resp = await client.put(`/v1/capabilities/${encodeURIComponent(id)}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_delete', descriptionFor('aimeat_capabilities_delete'), {
    id: z.string().describe('Capability identifier'),
  }, annotationsFor('aimeat_capabilities_delete'), async ({ id }) => {
    const resp = await client.delete(`/v1/capabilities/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_vouch', descriptionFor('aimeat_capabilities_vouch'), {
    id: z.string().describe('Capability identifier'),
  }, annotationsFor('aimeat_capabilities_vouch'), async ({ id }) => {
    const resp = await client.post(`/v1/capabilities/${encodeURIComponent(id)}/vouch`, {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
