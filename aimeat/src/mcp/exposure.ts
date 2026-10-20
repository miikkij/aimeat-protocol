/**
 * @file src/mcp/exposure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_exposure_report on the node's MCP endpoint (plan doc-mvcn6c7e4e5q, V6.3): what of
 *   the person's own content strangers, any signed-in account or the members of one organisation can
 *   read, with how to close each. It does not do the work: buildExposureReport
 *   (services/exposure/exposure-report.ts) is the function GET /v1/exposure/mine calls, so the chat and
 *   the page read one answer. The scope word (memory:read) is applied where every tool is registered
 *   (TOOL_SCOPES, from the catalog entry).
 * @structure registerExposureTools(mcp, storage, config, caller)
 * @usage import { registerExposureTools } from './exposure.js';
 * @version-history
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   v1.0.1 — 2026-10-18 — A report no source could be read for is an error (STORAGE_UNAVAILABLE), as on REST.
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.3).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { createExposureContext } from '../services/exposure/exposure-types.js';
import { buildExposureReport, exposureUnreadable, EXPOSURE_UNREADABLE_MESSAGE } from '../services/exposure/exposure-report.js';
import { readerForAgent } from '../services/classification/reader.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerExposureTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  mcp.registerTool(
    'aimeat_exposure_report',
    {
        description: descriptionFor('aimeat_exposure_report'),
        inputSchema: zodShapeFor('aimeat_exposure_report'),
        annotations: annotationsFor('aimeat_exposure_report'),
    },
    async () => {
      const c = caller();
      // Same refusals as the route: a visitor from another node has no account here.
      if (c.visitor) return toolError('FORBIDDEN', 'A session from another node has no account here, so it has no exposure report.');
      // The session's classification reader: a record hidden from this agent is counted, not listed.
      const reader = readerForAgent({ storage, config }, c.principal, c.scopes);
      const report = await buildExposureReport(createExposureContext(storage, config), c.owner, reader);
      if (exposureUnreadable(report)) return toolError('STORAGE_UNAVAILABLE', EXPOSURE_UNREADABLE_MESSAGE);
      return text(report);
    },
  );
}
