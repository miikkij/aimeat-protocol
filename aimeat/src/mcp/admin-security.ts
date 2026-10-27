/**
 * @file src/mcp/admin-security.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Security page over MCP: one read that says what is happening at the
 *   door, who was turned away, what was refused and kept, who holds the keys and what the doors are
 *   set to, plus the one action the page has that a chat could not do before (resolve an incident,
 *   or decide one case of it: a name the move to the full identity held, or a default audience cap
 *   the start offered). Both tools check the operator role at call time and call the ONE
 *   implementation in services/security-overview.ts, services/security-incident.ts and
 *   services/incident-decisions.ts; neither reads storage here.
 * @structure registerAdminSecurityTools(mcp, storage, config, getAgentGaii, scopes) — two operator tools.
 * @usage registerAdminSecurityTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   2026-10-27 -- The refusal of a malformed decision names "app_only", the action of an address of the
 *     subdomain incident (Jouni, 2026-10-27).
 *   2026-10-25 -- aimeat_admin_incident_resolve decides an entry of an incident that names records to
 *     act on ("clear" or "delete", or "keep") through the same services/incident-decisions.ts (secaudit2026oct22).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   v1.3.0 — 2026-10-18 — aimeat_admin_incident_resolve decides one case of either kind through
 *     services/incident-decisions.ts: a held name or an offered default audience cap ("apply" or
 *     "keep", plan doc-mvdipuyqraas, L5.1). A refused close says why in the words of the incident's kind.
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
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { buildSecurityOverview } from '../services/security-overview.js';
import { resolveSecurityIncident } from '../services/security-incident.js';
import { decideIncidentCase } from '../services/incident-decisions.js';
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

  mcp.registerTool('aimeat_admin_security_overview', { description: descriptionFor('aimeat_admin_security_overview'),
    inputSchema: zodShapeFor('aimeat_admin_security_overview'), annotations: annotationsFor('aimeat_admin_security_overview') },
    async () => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      return text(await buildSecurityOverview(config, storage));
    });

  mcp.registerTool('aimeat_admin_incident_resolve', { description: descriptionFor('aimeat_admin_incident_resolve'),
    inputSchema: zodShapeFor('aimeat_admin_incident_resolve'),
    annotations: annotationsFor('aimeat_admin_incident_resolve') },
    async ({ id, name, resolution }) => {
      if (!(await operatorName())) return refuse(OPERATOR_AGENT_REFUSAL);
      if (name !== undefined || resolution !== undefined) {
        if (!name || !resolution) return toolError('INVALID_INPUT', 'Deciding a case takes "name" and "resolution": "holder" or "previous" for a held name, "apply" or "keep" for an offered cap, the entry\'s action ("clear", "delete" or "app_only") or "keep" for an entry.');
        const decided = await decideIncidentCase(config, storage, { incidentId: id, name, resolution, by: { principal: agentGaii, kind: 'ai' } });
        if (!decided.ok) return toolError(decided.code, decided.message);
        return text({ id, ...decided.data });
      }
      const r = await resolveSecurityIncident(storage, config, id);
      if (r.ok) return text({ resolved: true, id, resolved_at: r.resolvedAt });
      if (r.code === 'CONFLICT') {
        return toolError('CONFLICT', r.message ?? 'This incident closes when every case in it is decided. Decide each one with "name" and "resolution".');
      }
      return refuse('NOT_FOUND: Incident not found');
    });
}
