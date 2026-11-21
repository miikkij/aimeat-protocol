/**
 * @file src/services/app-tools/one-tool.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One tool's entry out of an app's tool manifest, for aimeat_app_tools_get `tool` on the
 *   node MCP (mcp/commerce.ts) and the CLI dispatch (tool-dispatch/tool-call-defs-commerce.ts).
 *
 *   WHY. A caller needs one tool's inputSchema before one call, and the manifest holds every tool of
 *   the app: Lifecycle Central's was 57 kB for 23 tools on 2026-11-21, about 2 kB a tool. An agent
 *   that is told to read the schema first and gets the whole manifest back skips the read and guesses,
 *   which is how the guessed fields that aimeat_app_tool_invoke refused came about.
 * @structure pickManifestTool(manifest, name) → { ok, tool } | { ok: false, names }
 * @usage
 *   const picked = pickManifestTool(rec.value, 'claim_heartbeat');
 *   if (!picked.ok) return fail(`TOOL_NOT_FOUND: … Its tools: ${picked.names.join(', ')}`);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-app-ty-kalujen-skeemavirheet-ly-korjaa-kutsun-yhdell-yrityks).
 */

export type PickedTool =
  | { ok: true; tool: Record<string, unknown> }
  | { ok: false; names: string[] };

/** The entry named `name` in a manifest value (`{ tools: [...] }`), or every tool name it has. */
export function pickManifestTool(manifest: unknown, name: string): PickedTool {
  const tools = manifest && typeof manifest === 'object' && Array.isArray((manifest as { tools?: unknown }).tools)
    ? ((manifest as { tools: unknown[] }).tools.filter(t => t && typeof t === 'object') as Record<string, unknown>[])
    : [];
  const tool = tools.find(t => t.name === name);
  if (tool) return { ok: true, tool };
  return { ok: false, names: tools.map(t => String(t.name ?? '')).filter(Boolean) };
}
