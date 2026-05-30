/**
 * @file capabilities.ts
 * @description MCP tool registrations for capability CRUD, invocation, and vouching.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: adopt the rich server/REST capability schema --
 *     list (search/tags/callable/authRequired/source_type), invoke (+mode), create (id/summary/callable/
 *     visibility/tags/inputSchema/outputSchema/usage/whenToUse), update (summary/tags/visibility/usage/
 *     whenToUse/whenNotToUse), vouch (+comment). Connector was sending an outdated description/type schema.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerCapabilitiesTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_capabilities_list', descriptionFor('aimeat_capabilities_list'), {
    search: z.string().optional().describe('Full-text search on name and summary'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    callable: z.boolean().optional().describe('Filter callable capabilities only'),
    authRequired: z.string().optional().describe('Filter by auth level: none, anonymous, registered'),
    source_type: z.string().optional().describe('Filter by source type: extension, action, cortex, manual'),
  }, annotationsFor('aimeat_capabilities_list'), async ({ search, tags, callable, authRequired, source_type }) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (tags?.length) params.set('tags', tags.join(','));
    if (callable !== undefined) params.set('callable', String(callable));
    if (authRequired) params.set('authRequired', authRequired);
    if (source_type) params.set('source_type', source_type);
    const qs = params.toString() ? `?${params.toString()}` : '';
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
    mode: z.enum(['normal', 'raw']).optional().describe('normal = normalized result, raw = original response'),
  }, annotationsFor('aimeat_capabilities_invoke'), async ({ id, input, mode }) => {
    const qs = mode ? `?mode=${encodeURIComponent(mode)}` : '';
    const resp = await client.post(`/v1/capabilities/${encodeURIComponent(id)}/invoke${qs}`, { input: input ?? {} });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_create', descriptionFor('aimeat_capabilities_create'), {
    id: z.string().optional().describe('Custom capability ID (auto-generated UUID if omitted)'),
    name: z.string().describe('Human-readable capability name'),
    summary: z.string().describe('Brief description of what this capability does'),
    callable: z.boolean().optional().describe('Whether this capability can be invoked directly'),
    visibility: z.enum(['private', 'public']).optional().describe('Visibility: private (default) or public'),
    tags: z.array(z.string()).optional().describe('Tags for discovery and filtering'),
    inputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for input validation'),
    outputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for output format'),
    usage: z.string().optional().describe('Usage instructions for consumers'),
    whenToUse: z.string().optional().describe('Guidance on when this capability is appropriate'),
  }, annotationsFor('aimeat_capabilities_create'), async (args) => {
    const body: Record<string, unknown> = { name: args.name, summary: args.summary };
    if (args.id) body.id = args.id;
    if (args.callable !== undefined) body.callable = args.callable;
    if (args.visibility) body.visibility = args.visibility;
    if (args.tags) body.tags = args.tags;
    if (args.inputSchema) body.inputSchema = args.inputSchema;
    if (args.outputSchema) body.outputSchema = args.outputSchema;
    if (args.usage) body.usage = args.usage;
    if (args.whenToUse) body.whenToUse = args.whenToUse;
    const resp = await client.post('/v1/capabilities', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_update', descriptionFor('aimeat_capabilities_update'), {
    id: z.string().describe('Capability identifier'),
    name: z.string().optional().describe('Updated name'),
    summary: z.string().optional().describe('Updated summary'),
    tags: z.array(z.string()).optional().describe('Updated tags'),
    visibility: z.enum(['private', 'public']).optional().describe('Updated visibility'),
    usage: z.string().optional().describe('Updated usage instructions'),
    whenToUse: z.string().optional().describe('Updated guidance on when to use'),
    whenNotToUse: z.string().optional().describe('Updated guidance on when NOT to use'),
  }, annotationsFor('aimeat_capabilities_update'), async (args) => {
    const body: Record<string, unknown> = {};
    if (args.name !== undefined) body.name = args.name;
    if (args.summary !== undefined) body.summary = args.summary;
    if (args.tags !== undefined) body.tags = args.tags;
    if (args.visibility !== undefined) body.visibility = args.visibility;
    if (args.usage !== undefined) body.usage = args.usage;
    if (args.whenToUse !== undefined) body.whenToUse = args.whenToUse;
    if (args.whenNotToUse !== undefined) body.whenNotToUse = args.whenNotToUse;
    const resp = await client.put(`/v1/capabilities/${encodeURIComponent(args.id)}`, body);
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
    comment: z.string().optional().describe('Optional comment explaining why you vouch for this capability'),
  }, annotationsFor('aimeat_capabilities_vouch'), async ({ id, comment }) => {
    const body: Record<string, unknown> = {};
    if (comment) body.comment = comment;
    const resp = await client.post(`/v1/capabilities/${encodeURIComponent(id)}/vouch`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
