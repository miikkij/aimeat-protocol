/**
 * @file src/mcp/admin-security.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Security page over MCP: one read that says what is happening at the
 *   door, who was turned away, what was refused and kept, who holds the keys and what the doors are
 *   set to, plus the one action the page has that a chat could not do before (resolve an incident,
 *   or decide one name of the incident the move to the full identity opened). Both tools check the
 *   operator role at call time and call the ONE implementation in services/security-overview.ts,
 *   services/security-incident.ts and services/held-account-names.ts; neither reads storage here.
 * @structure registerAdminSecurityTools(mcp, storage, config, getAgentGaii, scopes) — two operator tools.
 * @usage registerAdminSecurityTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.2 — 2026-09-26 — The `resolution` description names the app grants and access tokens too.
 *   v1.2.1 — 2026-09-26 — The `resolution` description names the cortexes and ecosystem apps a
 *     decision covers.
 *   v1.2.0 — 2026-09-26 — aimeat_admin_incident_resolve takes `name` and `resolution` to decide one
 *     name of the incident the move to the full identity opened; closing such an incident while a
 *     name is undecided answers CONFLICT.
 *   v1.1.0 — 2026-09-24 — SECURITY (audit A8-1): the operator test asks the operator:admin word as
 *     well as the account (services/owner-lifecycle.ts resolveOperatorAgentName).
 *   v1.0.0 — 2026-09-05 — Initial: aimeat_admin_security_overview, aimeat_admin_incident_resolve.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { buildSecurityOverview } from '../services/security-overview.js';
import { resolveSecurityIncident } from '../services/security-incident.js';
import { resolveHeldName } from '../services/held-account-names.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminSecurityTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  /** This session's granted scopes: operator:admin is asked of them at call time. */
  scopes: readonly string[] = [],
): void {
  const agentGaii = getAgentGaii();
  const operatorName = () => resolveOperatorAgentName(storage, agentGaii, scopes);

  mcp.tool('aimeat_admin_security_overview', descriptionFor('aimeat_admin_security_overview'),
    zodShapeFor('aimeat_admin_security_overview'), annotationsFor('aimeat_admin_security_overview'),
    async () => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      return text(await buildSecurityOverview(config, storage));
    });

  mcp.tool('aimeat_admin_incident_resolve', descriptionFor('aimeat_admin_incident_resolve'),
    zodShapeFor('aimeat_admin_incident_resolve'),
    annotationsFor('aimeat_admin_incident_resolve'),
    async ({ id, name, resolution }) => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      if (name !== undefined || resolution !== undefined) {
        if (!name || !resolution) return toolError('INVALID_INPUT', 'Deciding a name takes "name" and "resolution": "holder" or "previous".');
        const decided = await resolveHeldName(config, storage, { incidentId: id, name, resolution });
        if (!decided.ok) return toolError(decided.code, decided.message);
        return text({
          id, name: decided.name, resolution: decided.resolution, done: decided.done,
          bindings_moved: decided.bindings_moved, incident_status: decided.incident_status,
        });
      }
      const r = await resolveSecurityIncident(storage, config, id);
      if (r.ok) return text({ resolved: true, id, resolved_at: r.resolvedAt });
      if (r.code === 'CONFLICT') {
        return toolError('CONFLICT', 'This incident closes when every name in it is decided. Decide each one with "name" and "resolution" ("holder" or "previous").');
      }
      return refuse('NOT_FOUND: Incident not found');
    });
}
