/**
 * @file ai-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for aimeat_ai_capabilities, aimeat_ai_models,
 *   aimeat_ai_transcribe and aimeat_ai_embed: parity with the server MCP (src/mcp/ai-capabilities.ts),
 *   as thin wrappers over GET /v1/ai/capabilities, GET /v1/ai/models, POST /v1/ai/transcribe and
 *   POST /v1/ai/embed. The node does the work; `check:mcp-schemas` compares this with its surface.
 * @structure registerAiCapabilityTools(mcp, registry)
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.1.0 — 2026-09-28 — aimeat_ai_transcribe and aimeat_ai_embed take `role`, the AI role the call runs as.
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V5).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAiCapabilityTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });
  const query = (q: Record<string, string | boolean | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) s.set(k, String(v));
    return s.size ? `?${s}` : '';
  };

  mcp.tool('aimeat_ai_capabilities', descriptionFor('aimeat_ai_capabilities'), zodShapeFor('aimeat_ai_capabilities'), annotationsFor('aimeat_ai_capabilities'), async (a) => out(await client.get(`/v1/ai/capabilities${query({ app_id: a.app_id })}`)));

  mcp.tool('aimeat_ai_models', descriptionFor('aimeat_ai_models'), zodShapeFor('aimeat_ai_models'), annotationsFor('aimeat_ai_models'), async (a) => out(await client.get(`/v1/ai/models${query({
    capability: a.capability, type: a.type, status: a.status, allowed: a.allowed,
  })}`)));

  mcp.tool('aimeat_ai_transcribe', descriptionFor('aimeat_ai_transcribe'), zodShapeFor('aimeat_ai_transcribe'), annotationsFor('aimeat_ai_transcribe'), async (a) => out(await client.post('/v1/ai/transcribe', {
    storage_key: a.storage_key, ...(a.filename !== undefined ? { filename: a.filename } : {}),
    ...(a.language !== undefined ? { language: a.language } : {}), ...(a.model !== undefined ? { model: a.model } : {}),
    ...(a.provider !== undefined ? { provider: a.provider } : {}), ...(a.app_id !== undefined ? { app_id: a.app_id } : {}),
    ...(a.role !== undefined ? { role: a.role } : {}),
  })));

  mcp.tool('aimeat_ai_embed', descriptionFor('aimeat_ai_embed'), zodShapeFor('aimeat_ai_embed'), annotationsFor('aimeat_ai_embed'), async (a) => out(await client.post('/v1/ai/embed', {
    input: a.input,
    ...(a.model !== undefined ? { model: a.model } : {}), ...(a.provider !== undefined ? { provider: a.provider } : {}),
    ...(a.app_id !== undefined ? { app_id: a.app_id } : {}), ...(a.role !== undefined ? { role: a.role } : {}),
  })));
}
