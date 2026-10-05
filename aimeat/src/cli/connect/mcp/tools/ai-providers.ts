/**
 * @file ai-providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for aimeat_ai_providers, aimeat_ai_provider_test and
 *   aimeat_ai_routing_set: parity with the server MCP (src/mcp/ai-providers.ts), as thin wrappers over
 *   GET /v1/ai/providers, POST /v1/ai/providers/:id/test and GET / PUT /v1/ai/routing. The node does
 *   the work; this code path carries the fields across, and `check:mcp-schemas` compares it with
 *   the node's surface. aimeat_ai_roles and aimeat_ai_role_set wrap GET and PUT /v1/ai/roles the same way.
 * @structure registerAiProviderTools(mcp, registry)
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.1.0 — 2026-09-28 — aimeat_ai_roles and aimeat_ai_role_set (AI roles).
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V3).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAiProviderTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_ai_providers', descriptionFor('aimeat_ai_providers'), zodShapeFor('aimeat_ai_providers'), annotationsFor('aimeat_ai_providers'),
    async () => out(await client.get('/v1/ai/providers')));

  mcp.tool('aimeat_ai_provider_test', descriptionFor('aimeat_ai_provider_test'), zodShapeFor('aimeat_ai_provider_test'), annotationsFor('aimeat_ai_provider_test'), async (a) => out(await client.post(`/v1/ai/providers/${encodeURIComponent(a.provider)}/test`, {
    ...(a.capability !== undefined ? { capability: a.capability } : {}),
    ...(a.accept_cost !== undefined ? { accept_cost: a.accept_cost } : {}),
  })));

  mcp.tool('aimeat_ai_routing_set', descriptionFor('aimeat_ai_routing_set'), zodShapeFor('aimeat_ai_routing_set'), annotationsFor('aimeat_ai_routing_set'), async (a) => {
    if (!a.routing && a.confirm_token === undefined) return out(await client.get('/v1/ai/routing'));
    return out(await client.put('/v1/ai/routing', {
      ...(a.routing ? { routing: a.routing as never } : {}),
      ...(a.confirm_token !== undefined ? { confirm_token: a.confirm_token } : {}),
    }));
  });

  mcp.tool('aimeat_ai_roles', descriptionFor('aimeat_ai_roles'), zodShapeFor('aimeat_ai_roles'), annotationsFor('aimeat_ai_roles'),
    async () => out(await client.get('/v1/ai/roles')));

  mcp.tool('aimeat_ai_role_set', descriptionFor('aimeat_ai_role_set'), zodShapeFor('aimeat_ai_role_set'), annotationsFor('aimeat_ai_role_set'), async (a) => out(await client.put('/v1/ai/roles', {
    ...(a.roles !== undefined ? { roles: a.roles as never } : {}),
    ...(a.bindings !== undefined ? { bindings: a.bindings as never } : {}),
    ...(a.confirm_token !== undefined ? { confirm_token: a.confirm_token } : {}),
  })));
}
