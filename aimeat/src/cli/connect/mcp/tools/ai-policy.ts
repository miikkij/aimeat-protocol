/**
 * @file ai-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for aimeat_ai_policy_set: parity with the server MCP
 *   (src/mcp/ai-policy.ts), as a thin wrapper over GET and PUT /v1/ai/policy. The node validates,
 *   mints and checks the confirm token and writes the record; this door only carries the fields
 *   across, and `check:mcp-schemas` compares it with the node's surface.
 * @structure registerAiPolicyTools(mcp, registry)
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V2).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAiPolicyTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_ai_policy_set', descriptionFor('aimeat_ai_policy_set'), zodShapeFor('aimeat_ai_policy_set'), annotationsFor('aimeat_ai_policy_set'), async (a) => {
    if (!a.policy && a.confirm_token === undefined) return out(await client.get('/v1/ai/policy'));
    return out(await client.put('/v1/ai/policy', {
      ...(a.policy ? { policy: a.policy as never } : {}),
      ...(a.confirm_token !== undefined ? { confirm_token: a.confirm_token } : {}),
    }));
  });
}
