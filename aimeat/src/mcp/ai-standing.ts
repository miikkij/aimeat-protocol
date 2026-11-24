/**
 * @file src/mcp/ai-standing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_ai_standing_get on the node MCP: the owner's "Allow always" setting, from
 *   services/ai-standing/view.ts readStandingView, the function GET /v1/ai-standing answers with, with
 *   the session's caller. agent:read is its word in TOOL_SCOPES, the one the route asks.
 * @structure registerAiStandingTools(mcp, storage, config, caller)
 * @usage registerAiStandingTools(mcp, storage, config, caller);  // register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { readStandingView } from '../services/ai-standing/view.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

export function registerAiStandingTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  mcp.registerTool('aimeat_ai_standing_get', { description: descriptionFor('aimeat_ai_standing_get'), inputSchema: zodShapeFor('aimeat_ai_standing_get'), annotations: annotationsFor('aimeat_ai_standing_get') }, async ({ lang }) => {
    const out = await readStandingView({ storage, config }, caller(), lang);
    if (!out.ok) return toolError(out.code, out.message);
    return text(out.view);
  });
}
