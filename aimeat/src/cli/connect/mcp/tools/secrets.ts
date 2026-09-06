/**
 * @file src/cli/connect/mcp/tools/secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector-side aimeat_secret_list / _set / _delete: the owner's secrets vault
 *   through the node's own /v1/secrets routes, so a Claude Desktop, Codex or Cursor session can
 *   store the key an integration needs without the person pasting it into the chat.
 *
 *   No agent_name: the vault belongs to the OWNER, whom every agent of theirs shares. Passing an
 *   agent would suggest a per-agent vault, and there is not one.
 * @structure registerSecretTools(mcp, registry)
 * @usage Called by `aimeat connect serve` via the MCP tool registry (tools/index.ts).
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial, mirroring mcp/secrets.ts.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerSecretTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_secret_list', descriptionFor('aimeat_secret_list'), {}, annotationsFor('aimeat_secret_list'), async () => {
    const resp = await client.get('/v1/secrets');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_secret_set', descriptionFor('aimeat_secret_set'), {
    name: z.string().describe('What to call it: letters, digits, underscore and hyphen, 1 to 64 characters. This is the name written into a header as {{secret:NAME}}, so it is case-exact.'),
    value: z.string().describe('The key or password itself, up to 4 kB. Encrypted at rest, and returned by nothing.'),
  }, annotationsFor('aimeat_secret_set'), async ({ name, value }) => {
    const resp = await client.put(`/v1/secrets/${encodeURIComponent(name)}`, { value });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_secret_delete', descriptionFor('aimeat_secret_delete'), {
    name: z.string().describe('The secret to remove, exactly as it was stored.'),
  }, annotationsFor('aimeat_secret_delete'), async ({ name }) => {
    const resp = await client.delete(`/v1/secrets/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
