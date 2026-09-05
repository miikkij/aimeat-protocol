/**
 * @file src/mcp/admin-security.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Security page over MCP: one read that says what is happening at the
 *   door, who was turned away, what was refused and kept, who holds the keys and what the doors are
 *   set to, plus the one action the page has that a chat could not do before (resolve an incident).
 *   Both tools check the operator role at call time and call the ONE implementation in
 *   services/security-overview.ts and services/security-incident.ts; neither reads storage here.
 * @structure registerAdminSecurityTools(mcp, storage, config, getAgentGaii) — two operator tools.
 * @usage registerAdminSecurityTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial: aimeat_admin_security_overview, aimeat_admin_incident_resolve.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveOperatorName } from '../services/owner-lifecycle.js';
import { buildSecurityOverview } from '../services/security-overview.js';
import { resolveSecurityIncident } from '../services/security-incident.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminSecurityTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();
  const operatorName = () => resolveOperatorName(storage, agentGaii);

  mcp.tool('aimeat_admin_security_overview', descriptionFor('aimeat_admin_security_overview'),
    {}, annotationsFor('aimeat_admin_security_overview'),
    async () => {
      if (!(await operatorName())) return refuse('Operator role required');
      return text(await buildSecurityOverview(config, storage));
    });

  mcp.tool('aimeat_admin_incident_resolve', descriptionFor('aimeat_admin_incident_resolve'),
    { id: z.string().describe('The incident id, from the overview\'s incidents list.') },
    annotationsFor('aimeat_admin_incident_resolve'),
    async ({ id }) => {
      if (!(await operatorName())) return refuse('Operator role required');
      const r = await resolveSecurityIncident(storage, config, id);
      return r.ok ? text({ resolved: true, id, resolved_at: r.resolvedAt }) : refuse('NOT_FOUND: Incident not found');
    });
}
