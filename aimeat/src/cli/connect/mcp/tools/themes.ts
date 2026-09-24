/**
 * @file cli/connect/mcp/tools/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector MCP half of Themes & Styles: aimeat_theme_list, aimeat_theme_get and
 *   aimeat_theme_save, each a thin call to the /v1/themes routes, so the node's own gate (the
 *   operator, site:theme-write) decides a write here exactly as it does in the admin view.
 * @structure registerThemeTools(mcp, registry)
 * @usage registerThemeTools(mcp, registry);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerThemeTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });
  const tokenMap = z.record(z.string(), z.string());

  mcp.tool('aimeat_theme_list', descriptionFor('aimeat_theme_list'), {}, annotationsFor('aimeat_theme_list'), async () => {
    return out(await client.get('/v1/themes/all?summary=1'));
  });

  mcp.tool('aimeat_theme_get', descriptionFor('aimeat_theme_get'), {
    id: z.string().min(1).max(40).describe("The theme's id, from aimeat_theme_list (for example 'aimeat' or 'paper')."),
  }, annotationsFor('aimeat_theme_get'), async ({ id }) => {
    return out(await client.get(`/v1/themes/${encodeURIComponent(id)}`));
  });

  mcp.tool('aimeat_theme_save', descriptionFor('aimeat_theme_save'), {
    id: z.string().max(40).optional().describe('The theme to edit. Leave it out to make a new one.'),
    name: z.string().max(60).optional().describe('What people see in the pill. 1 to 60 characters.'),
    basedOn: z.string().max(40).optional().describe("For a new theme: the theme it starts from (default 'aimeat')."),
    light: tokenMap.optional().describe('Token → colour for light mode, only the ones you change.'),
    dark: tokenMap.optional().describe('Token → colour for dark mode, only the ones you change.'),
    faces: z.object({ headline: z.string().optional(), body: z.string().optional(), mono: z.string().optional() }).optional()
      .describe('{ headline, body, mono }, each a face this node serves.'),
    css: z.string().max(8000).optional().describe('Rules that set component hooks only; empty removes it.'),
    onlyMode: z.string().optional().describe("'light' or 'dark' when the theme has one mode only; empty for both."),
    retired: z.boolean().optional().describe('true takes it out of the pill; false brings it back.'),
    dryRun: z.boolean().optional().describe('Check everything and save nothing.'),
  }, annotationsFor('aimeat_theme_save'), async ({ id, dryRun, css, onlyMode, ...rest }) => {
    const body = {
      ...rest,
      ...(css !== undefined ? { css: css || null } : {}),
      ...(onlyMode !== undefined ? { onlyMode: onlyMode || null } : {}),
    };
    if (dryRun) return out(await client.post('/v1/themes/check', { ...body, ...(id ? { id } : {}) }));
    return out(id ? await client.put(`/v1/themes/${encodeURIComponent(id)}`, body) : await client.post('/v1/themes', body));
  });
}
