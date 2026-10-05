/**
 * @file flags.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registration for content flagging/reporting.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: add description param; map snake_case params to the
 *     camelCase targetType/targetId the REST FlagCreateSchema actually reads (connector body was ignored).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { envelopeResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerFlagsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_flag_report', descriptionFor('aimeat_flag_report'), zodShapeFor('aimeat_flag_report'), annotationsFor('aimeat_flag_report'), async ({ target_type, target_id, reason, description }) => {
    // REST FlagCreateSchema reads camelCase targetType/targetId.
    const body: Record<string, unknown> = { targetType: target_type, targetId: target_id, reason };
    if (description) body.description = description;
    const resp = await client.post('/v1/flags', body);
    return envelopeResult(resp);
  });
}
