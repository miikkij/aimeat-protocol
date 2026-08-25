/**
 * @file src/cli/connect/mcp/tools/data-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector's door to the data map. Thin proxies over the node's own routes: the
 *   gate, the validation and the provenance all happen where they were written once, and nothing
 *   here decides anything.
 * @structure registerDataMapTools(mcp, registry)
 * @usage registered from cli/connect/mcp/tools/index.ts
 * @version-history
 *   v1.0.0 — 2026-08-25 — TARGET-073.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerDataMapTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_datamap_get', descriptionFor('aimeat_datamap_get'), {
    agent_name: agentNameSchema,
    app: z.string().describe('The app, as "owner/filename.html".'),
  }, annotationsFor('aimeat_datamap_get'), async ({ agent_name, app }) => {
    const { client } = pickAgent(registry, agent_name);
    const slash = app.indexOf('/');
    if (slash <= 0) return text({ error: 'Name the app as "owner/filename.html".' });
    const owner = encodeURIComponent(app.slice(0, slash));
    const filename = encodeURIComponent(app.slice(slash + 1));
    return text(await client.get(`/v1/datamap/apps/${owner}/${filename}`));
  });

  mcp.tool('aimeat_datamap_set', descriptionFor('aimeat_datamap_set'), {
    agent_name: agentNameSchema,
    app: z.string().describe('The app, as "owner/filename.html".'),
    data_map: z.record(z.string(), z.unknown())
      .describe('The whole map document, carrying spec "aimeat.datamap/1". Read the current one first — this replaces it.'),
  }, annotationsFor('aimeat_datamap_set'), async ({ agent_name, app, data_map }) => {
    const { client } = pickAgent(registry, agent_name);
    const slash = app.indexOf('/');
    if (slash <= 0) return text({ error: 'Name the app as "owner/filename.html".' });
    const owner = encodeURIComponent(app.slice(0, slash));
    const filename = encodeURIComponent(app.slice(slash + 1));
    return text(await client.put(`/v1/datamap/apps/${owner}/${filename}`, data_map));
  });

  mcp.tool('aimeat_memory_hands', descriptionFor('aimeat_memory_hands'), {
    agent_name: agentNameSchema,
    key: z.string().describe('The exact memory key to ask about.'),
  }, annotationsFor('aimeat_memory_hands'), async ({ agent_name, key }) => {
    const { client } = pickAgent(registry, agent_name);
    return text(await client.get(`/v1/memory/${encodeURIComponent(key)}/hands`));
  });
}
