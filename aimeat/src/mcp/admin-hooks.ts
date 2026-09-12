/**
 * @file src/mcp/admin-hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Hooks page over MCP: one read that says which moments in this node's
 *   life call out to somebody's own code, which of them can refuse the thing outright, and what the
 *   bound addresses have been answering; and one write that binds or clears a moment.
 *
 *   The doors exist because hooks were reachable by clicking and no other way, and a capability
 *   reachable only by clicking is not finished. Setting a node up through an agent had no path to
 *   them at all. Both tools check the operator role at call time and call the ONE implementation in
 *   services/hooks-overview.ts; neither reads storage here.
 * @structure registerAdminHooksTools(mcp, storage, config, getAgentGaii) — two operator tools.
 * @usage registerAdminHooksTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial: aimeat_admin_hooks, aimeat_admin_hook_set.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveOperatorName } from '../services/owner-lifecycle.js';
import { buildHooksOverview, setHookActions } from '../services/hooks-overview.js';
import { emitChange } from '../services/event-bus.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminHooksTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();
  const operatorName = () => resolveOperatorName(storage, agentGaii);

  mcp.tool('aimeat_admin_hooks', descriptionFor('aimeat_admin_hooks'),
    {}, annotationsFor('aimeat_admin_hooks'),
    async () => {
      if (!(await operatorName())) return refuse('Operator role required');
      return text(await buildHooksOverview(config, storage));
    });

  mcp.tool('aimeat_admin_hook_set', descriptionFor('aimeat_admin_hook_set'),
    {
      hook: z.string().describe('The moment to bind, e.g. "pre_owner_registration". Read aimeat_admin_hooks for the eleven.'),
      actions: z.array(z.string()).describe('The action references to call, in order. An empty list clears the moment so it stops calling out.'),
    },
    annotationsFor('aimeat_admin_hook_set'),
    async ({ hook, actions }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const out = await setHookActions(config, storage, hook, actions);
      if (!out.ok) return refuse(`${out.code}: ${out.message}`);
      emitChange('config');
      return text(out);
    });
}
