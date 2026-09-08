/**
 * @file src/mcp/admin-cors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's CORS page over MCP: one read that says which browser origins this
 *   instance answers and who keeps a list of their own, and one write that sets or clears a
 *   person's or an agent's list. Both tools check the operator role at call time and call the ONE
 *   implementation in services/cors-overview.ts; neither reads storage here.
 * @structure registerAdminCorsTools(mcp, storage, config, getAgentGaii) — two operator tools.
 * @usage registerAdminCorsTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial: aimeat_admin_cors_overview, aimeat_admin_cors_set.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveOperatorName } from '../services/owner-lifecycle.js';
import { buildCorsOverview, setCorsList } from '../services/cors-overview.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminCorsTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();
  const operatorName = () => resolveOperatorName(storage, agentGaii);

  mcp.tool('aimeat_admin_cors_overview', descriptionFor('aimeat_admin_cors_overview'),
    {}, annotationsFor('aimeat_admin_cors_overview'),
    async () => {
      if (!(await operatorName())) return refuse('Operator role required');
      return text(await buildCorsOverview(config, storage));
    });

  mcp.tool('aimeat_admin_cors_set', descriptionFor('aimeat_admin_cors_set'),
    {
      who: z.string().describe('A person\'s address (owner@node), a bare owner name, or an agent\'s address (name#owner@node).'),
      origins: z.array(z.string()).nullable().describe('The origins to allow: each an http(s) URL or "*"; null clears the list so the default applies again.'),
    },
    annotationsFor('aimeat_admin_cors_set'),
    async ({ who, origins }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const r = await setCorsList(storage, config, who, origins);
      return r.ok ? text(r) : refuse(`${r.code}: ${r.message}`);
    });
}
