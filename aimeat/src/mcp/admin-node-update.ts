/**
 * @file src/mcp/admin-node-update.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_admin_node_update: is a newer AIMEAT on npm than this node runs, when was it
 *   released, what is new in it, and the prompt that updates the node. The header notice an operator
 *   sees in the browser, over MCP, so "is my node up to date?" can be asked in chat.
 *
 *   It calls services/node-update-check.ts, the one implementation GET /v1/admin/node-update calls,
 *   and honours the same switch: with node.update_check off it asks npm nothing and says so.
 *   The update prompt tells the AI that runs it to call this tool afterwards to confirm the version.
 * @structure registerAdminNodeUpdateTools(mcp, storage, config, getAgentGaii, scopes)
 * @usage registerAdminNodeUpdateTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { getNodeUpdateStatus } from '../services/node-update-check.js';
import { toolError } from './tool-error.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

export function registerAdminNodeUpdateTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  /** This session's granted scopes: operator:admin is asked of them at call time. */
  scopes: readonly string[] = [],
): void {
  const agentGaii = getAgentGaii();

  mcp.tool('aimeat_admin_node_update', descriptionFor('aimeat_admin_node_update'),
    zodShapeFor('aimeat_admin_node_update'),
    annotationsFor('aimeat_admin_node_update'),
    async ({ refresh }) => {
      if (!(await resolveOperatorAgentName(storage, agentGaii, scopes))) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
      return text(await getNodeUpdateStatus(config, { refresh: refresh === true }));
    });
}
