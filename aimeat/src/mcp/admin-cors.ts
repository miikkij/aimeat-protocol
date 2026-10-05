/**
 * @file src/mcp/admin-cors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's CORS page over MCP: one read that says which browser origins this
 *   instance answers and who keeps a list of their own, and one write that sets or clears a
 *   person's or an agent's list. Both tools check the operator role at call time and call the ONE
 *   implementation in services/cors-overview.ts; neither reads storage here.
 * @structure registerAdminCorsTools(mcp, storage, config, getAgentGaii, scopes) — two operator tools.
 * @usage registerAdminCorsTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.1.0 — 2026-09-24 — SECURITY (audit A8-1): the operator test asks the operator:admin word as
 *     well as the account (services/owner-lifecycle.ts resolveOperatorAgentName).
 *   v1.0.0 — 2026-09-08 — Initial: aimeat_admin_cors_overview, aimeat_admin_cors_set.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { buildCorsOverview, setCorsList } from '../services/cors-overview.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminCorsTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  /** This session's granted scopes: operator:admin is asked of them at call time. */
  scopes: readonly string[] = [],
): void {
  const agentGaii = getAgentGaii();
  const operatorName = () => resolveOperatorAgentName(storage, agentGaii, scopes);

  mcp.tool('aimeat_admin_cors_overview', descriptionFor('aimeat_admin_cors_overview'),
    zodShapeFor('aimeat_admin_cors_overview'), annotationsFor('aimeat_admin_cors_overview'),
    async () => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      return text(await buildCorsOverview(config, storage));
    });

  mcp.tool('aimeat_admin_cors_set', descriptionFor('aimeat_admin_cors_set'),
    zodShapeFor('aimeat_admin_cors_set'),
    annotationsFor('aimeat_admin_cors_set'),
    async ({ who, origins }) => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      const r = await setCorsList(storage, config, who, origins);
      return r.ok ? text(r) : refuse(`${r.code}: ${r.message}`);
    });
}
