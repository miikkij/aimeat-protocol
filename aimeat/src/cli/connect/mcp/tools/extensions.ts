/**
 * @file extensions.ts
 * @description MCP tool registrations for extension lifecycle management --
 *   listing, installing, invoking actions, activating, deactivating, and deleting.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: extension_invoke name->extension_name +instance_id
 *     (instance-scoped route); extension_install now takes manifest (YAML string) + scripts map to match
 *     REST ExtensionInstallSchema (connector was sending name + manifest object the route rejects).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerExtensionsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_extension_list', descriptionFor('aimeat_extension_list'), {}, annotationsFor('aimeat_extension_list'), async () => {
    const resp = await client.get('/v1/extensions');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_invoke', descriptionFor('aimeat_extension_invoke'), {
    extension_name: z.string().describe('Name of the extension to invoke'),
    action_id: z.string().describe('Action identifier'),
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters'),
    instance_id: z.string().optional().describe('Instance ID for instance-scoped action execution'),
  }, annotationsFor('aimeat_extension_invoke'), async ({ extension_name, action_id, input, instance_id }) => {
    const enc = encodeURIComponent(extension_name);
    const url = instance_id
      ? `/v1/ext/${enc}/${encodeURIComponent(instance_id)}/${encodeURIComponent(action_id)}`
      : `/v1/ext/${enc}/${encodeURIComponent(action_id)}`;
    const resp = await client.post(url, input ?? {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_install', descriptionFor('aimeat_extension_install'), {
    manifest: z.string().describe('Extension manifest in YAML format'),
    scripts: z.record(z.string(), z.string()).optional().describe('Map of script filename to JavaScript source code'),
  }, annotationsFor('aimeat_extension_install'), async ({ manifest, scripts }) => {
    const body: Record<string, unknown> = { manifest };
    if (scripts) body.scripts = scripts;
    const resp = await client.post('/v1/extensions', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_activate', descriptionFor('aimeat_extension_activate'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_activate'), async ({ name }) => {
    const resp = await client.post(`/v1/extensions/${encodeURIComponent(name)}/activate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_deactivate', descriptionFor('aimeat_extension_deactivate'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_deactivate'), async ({ name }) => {
    const resp = await client.post(`/v1/extensions/${encodeURIComponent(name)}/deactivate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_delete', descriptionFor('aimeat_extension_delete'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_delete'), async ({ name }) => {
    const resp = await client.delete(`/v1/extensions/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_get', descriptionFor('aimeat_extension_get'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_get'), async ({ name }) => {
    const resp = await client.get(`/v1/extensions/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
