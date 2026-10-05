/**
 * @file cli/connect/mcp/tools/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector MCP half of Themes & Styles: aimeat_theme_list, aimeat_theme_get,
 *   aimeat_theme_save, aimeat_theme_style_save and aimeat_theme_component_css_set. Each is the
 *   schema the protocol needs plus one call to `themeRequests` (tool-call-defs-themes.ts), the same
 *   mapping the CLI dispatch uses, so the node's own gate (the operator, site:theme-write) decides a
 *   write here exactly as it does in the admin view.
 * @structure registerThemeTools(mcp, registry)
 * @usage registerThemeTools(mcp, registry);
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v2.2.0 — 2026-10-03 — aimeat_theme_font_save (the font manager).
 *   v2.1.0 — 2026-09-24 — aimeat_theme_policy_set.
 *   v2.0.0 — 2026-09-24 — The two-level model of 07; one request mapping shared with the CLI door.
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import type { ApiResponse } from '../../api-client.js';
import { themeRequests } from '../../../../tool-dispatch/tool-call-defs-themes.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerThemeTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: ApiResponse) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });
  const call = (tool: string) => async (input: Record<string, unknown>) => out(await themeRequests(client, tool, input));

  mcp.tool('aimeat_theme_list', descriptionFor('aimeat_theme_list'), zodShapeFor('aimeat_theme_list'), annotationsFor('aimeat_theme_list'), call('aimeat_theme_list'));

  mcp.tool('aimeat_theme_get', descriptionFor('aimeat_theme_get'), zodShapeFor('aimeat_theme_get'), annotationsFor('aimeat_theme_get'), call('aimeat_theme_get'));

  mcp.tool('aimeat_theme_save', descriptionFor('aimeat_theme_save'), zodShapeFor('aimeat_theme_save'), annotationsFor('aimeat_theme_save'), call('aimeat_theme_save'));

  mcp.tool('aimeat_theme_style_save', descriptionFor('aimeat_theme_style_save'), zodShapeFor('aimeat_theme_style_save'), annotationsFor('aimeat_theme_style_save'), call('aimeat_theme_style_save'));

  mcp.tool('aimeat_theme_policy_set', descriptionFor('aimeat_theme_policy_set'), zodShapeFor('aimeat_theme_policy_set'), annotationsFor('aimeat_theme_policy_set'), call('aimeat_theme_policy_set'));

  mcp.tool('aimeat_theme_font_save', descriptionFor('aimeat_theme_font_save'), zodShapeFor('aimeat_theme_font_save'), annotationsFor('aimeat_theme_font_save'), call('aimeat_theme_font_save'));

  mcp.tool('aimeat_theme_component_css_set', descriptionFor('aimeat_theme_component_css_set'), zodShapeFor('aimeat_theme_component_css_set'), annotationsFor('aimeat_theme_component_css_set'), call('aimeat_theme_component_css_set'));
}
