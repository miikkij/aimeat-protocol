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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.1 — 2026-09-20 — The `data_map` parameter says spec /2 and shows a whole object
 *     (DATA_MAP_PARAM in the catalog), in parity with the server MCP. It said /1.
 *   v1.0.0 — 2026-08-25 — TARGET-073.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, payloadResult, pickAgent } from './_registry.js';
import type { ApiResponse } from '../../api-client.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

const text = (resp: ApiResponse) => payloadResult(resp, resp);
/** A refusal this tool makes itself, before any call. It did not happen either. */
const refuse = (message: string) => payloadResult({ error: message }, { ok: false });

export function registerDataMapTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_datamap_get', descriptionFor('aimeat_datamap_get'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_datamap_get') }, annotationsFor('aimeat_datamap_get'), async ({ agent_name, app }) => {
    const { client } = pickAgent(registry, agent_name);
    const slash = app.indexOf('/');
    if (slash <= 0) return refuse('Name the app as "owner/filename.html".');
    const owner = encodeURIComponent(app.slice(0, slash));
    const filename = encodeURIComponent(app.slice(slash + 1));
    return text(await client.get(`/v1/datamap/apps/${owner}/${filename}`));
  });

  mcp.tool('aimeat_datamap_set', descriptionFor('aimeat_datamap_set'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_datamap_set') }, annotationsFor('aimeat_datamap_set'), async ({ agent_name, app, data_map }) => {
    const { client } = pickAgent(registry, agent_name);
    const slash = app.indexOf('/');
    if (slash <= 0) return refuse('Name the app as "owner/filename.html".');
    const owner = encodeURIComponent(app.slice(0, slash));
    const filename = encodeURIComponent(app.slice(slash + 1));
    return text(await client.put(`/v1/datamap/apps/${owner}/${filename}`, data_map));
  });

  mcp.tool('aimeat_memory_hands', descriptionFor('aimeat_memory_hands'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_memory_hands') }, annotationsFor('aimeat_memory_hands'), async ({ agent_name, key }) => {
    const { client } = pickAgent(registry, agent_name);
    return text(await client.get(`/v1/memory/${encodeURIComponent(key)}/hands`));
  });
}
