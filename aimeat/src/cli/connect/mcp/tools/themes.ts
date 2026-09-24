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
 *   v2.0.0 — 2026-09-24 — The two-level model of 07; one request mapping shared with the CLI door.
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import type { ApiResponse } from '../../api-client.js';
import { themeRequests } from '../../tool-call-defs-themes.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerThemeTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: ApiResponse) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });
  const call = (tool: string) => async (input: Record<string, unknown>) => out(await themeRequests(client, tool, input));
  const tokenMap = z.record(z.string(), z.string());

  mcp.tool('aimeat_theme_list', descriptionFor('aimeat_theme_list'), {}, annotationsFor('aimeat_theme_list'), call('aimeat_theme_list'));

  mcp.tool('aimeat_theme_get', descriptionFor('aimeat_theme_get'), {
    id: z.string().min(1).max(40).describe("The theme's id, from aimeat_theme_list (for example 'aimeat')."),
  }, annotationsFor('aimeat_theme_get'), call('aimeat_theme_get'));

  mcp.tool('aimeat_theme_save', descriptionFor('aimeat_theme_save'), {
    id: z.string().max(40).optional().describe('The theme to change. Leave it out to make a new one.'),
    name: z.string().max(60).optional().describe('What people see in the pill. 1 to 60 characters.'),
    basedOn: z.string().max(40).optional().describe("For a new theme: the theme it copies (default 'aimeat')."),
    css: z.string().max(64000).optional().describe('Theme CSS for the whole theme; empty removes it.'),
    defaultStyle: z.string().max(40).optional().describe('The style a person sees first in this theme.'),
    offeredStyles: z.array(z.string().max(40)).max(40).optional().describe('The style ids of this theme the pill offers.'),
    retired: z.boolean().optional().describe('true takes the theme out of the pill; false brings it back.'),
    restoreVersion: z.number().int().min(1).optional().describe('Put back this saved version (from aimeat_theme_get).'),
    dryRun: z.boolean().optional().describe('Check everything and save nothing.'),
  }, annotationsFor('aimeat_theme_save'), call('aimeat_theme_save'));

  mcp.tool('aimeat_theme_style_save', descriptionFor('aimeat_theme_style_save'), {
    theme: z.string().min(1).max(40).describe('The theme the style belongs to.'),
    style: z.string().max(40).optional().describe('The style to change. Leave it out to make a new one.'),
    name: z.string().max(60).optional().describe('What people see in the pill. 1 to 60 characters.'),
    basedOn: z.string().max(40).optional().describe('For a new style: the style of this theme it copies.'),
    light: tokenMap.optional().describe('Token → colour for light mode, only the ones you change.'),
    dark: tokenMap.optional().describe('Token → colour for dark mode, only the ones you change.'),
    faces: z.object({ headline: z.string().optional(), body: z.string().optional(), mono: z.string().optional() }).optional()
      .describe('{ headline, body, mono }, each a face this server serves.'),
    onlyMode: z.string().optional().describe("'light' or 'dark' for a style with one mode; empty for both."),
    retired: z.boolean().optional().describe('true takes the style out of the pill; false brings it back.'),
    dryRun: z.boolean().optional().describe('Check everything and save nothing.'),
  }, annotationsFor('aimeat_theme_style_save'), call('aimeat_theme_style_save'));

  mcp.tool('aimeat_theme_component_css_set', descriptionFor('aimeat_theme_component_css_set'), {
    theme: z.string().min(1).max(40).describe('The theme the CSS belongs to.'),
    component: z.string().min(1).max(60).describe("The component's id, from aimeat_ui_component_list (for example 'slab')."),
    css: z.string().max(64000).optional().describe('The CSS; empty removes it.'),
    dryRun: z.boolean().optional().describe('Check and save nothing.'),
  }, annotationsFor('aimeat_theme_component_css_set'), call('aimeat_theme_component_css_set'));
}
