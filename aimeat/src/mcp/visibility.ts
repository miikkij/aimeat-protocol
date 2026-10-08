/**
 * @file src/mcp/visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI visibility tools on the node's MCP endpoint: the owner's report and the
 *   owner's switch. Neither does the work itself: the report is readVisibilityReport() and the
 *   switch is setVisibilitySettings(), the same functions GET /v1/visibility/report and PUT
 *   /v1/visibility/settings call (routes/visibility.ts), so the panel and the owner's AI read one
 *   answer. The scope words are applied where every tool is registered (TOOL_SCOPES).
 * @structure registerVisibilityTools(mcp, storage, config, caller)
 * @usage import { registerVisibilityTools } from './visibility.js';
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { readVisibilityReport } from '../services/visibility/visibility-report.js';
import { setVisibilitySettings, nodeCountsVisibility } from '../services/visibility/visibility-counter.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerVisibilityTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  /** The account whose place this is. A visitor from another node has none here. */
  const ownerOf = (): string | null => {
    const c = caller();
    return c.visitor ? null : c.ownerGhii;
  };
  const NO_PLACE = 'A session from another node has no visibility report here.';

  mcp.tool(
    'aimeat_visibility_report',
    descriptionFor('aimeat_visibility_report'),
    zodShapeFor('aimeat_visibility_report'),
    annotationsFor('aimeat_visibility_report'),
    async ({ days }) => {
      const owner = ownerOf();
      if (!owner) return toolError('FORBIDDEN', NO_PLACE);
      return text(await readVisibilityReport(storage, config, owner, { days }));
    },
  );

  mcp.tool(
    'aimeat_visibility_settings_set',
    descriptionFor('aimeat_visibility_settings_set'),
    zodShapeFor('aimeat_visibility_settings_set'),
    annotationsFor('aimeat_visibility_settings_set'),
    async ({ enabled }) => {
      const owner = ownerOf();
      if (!owner) return toolError('FORBIDDEN', NO_PLACE);
      const settings = await setVisibilitySettings(storage, owner, { enabled });
      return text({ ...settings, node_enabled: nodeCountsVisibility(config) });
    },
  );
}
