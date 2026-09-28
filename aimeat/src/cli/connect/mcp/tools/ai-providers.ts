/**
 * @file ai-providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for aimeat_ai_providers, aimeat_ai_provider_test and
 *   aimeat_ai_routing_set: parity with the server MCP (src/mcp/ai-providers.ts), as thin wrappers over
 *   GET /v1/ai/providers, POST /v1/ai/providers/:id/test and GET / PUT /v1/ai/routing. The node does
 *   the work; this code path carries the fields across, and `check:mcp-schemas` compares it with
 *   the node's surface.
 * @structure registerAiProviderTools(mcp, registry)
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V3).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAiProviderTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_ai_providers', descriptionFor('aimeat_ai_providers'), {}, annotationsFor('aimeat_ai_providers'),
    async () => out(await client.get('/v1/ai/providers')));

  mcp.tool('aimeat_ai_provider_test', descriptionFor('aimeat_ai_provider_test'), {
    provider: z.string().describe('The provider id, from aimeat_ai_providers.'),
    capability: z.string().optional().describe('text | vision | files | transcription | speech | embed | image. Default text.'),
    accept_cost: z.boolean().optional().describe('Required true for an image test, which the provider charges for.'),
  }, annotationsFor('aimeat_ai_provider_test'), async (a) => out(await client.post(`/v1/ai/providers/${encodeURIComponent(a.provider)}/test`, {
    ...(a.capability !== undefined ? { capability: a.capability } : {}),
    ...(a.accept_cost !== undefined ? { accept_cost: a.accept_cost } : {}),
  })));

  mcp.tool('aimeat_ai_routing_set', descriptionFor('aimeat_ai_routing_set'), {
    routing: z.record(z.string(), z.unknown()).optional().describe('{ defaults?: {capability: [provider ids]}, rules?: {...}, agent?: name }. Omit to read.'),
    confirm_token: z.string().optional().describe('Token from the propose step; omit to propose.'),
  }, annotationsFor('aimeat_ai_routing_set'), async (a) => {
    if (!a.routing && a.confirm_token === undefined) return out(await client.get('/v1/ai/routing'));
    return out(await client.put('/v1/ai/routing', {
      ...(a.routing ? { routing: a.routing as never } : {}),
      ...(a.confirm_token !== undefined ? { confirm_token: a.confirm_token } : {}),
    }));
  });
}
