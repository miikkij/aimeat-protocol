/**
 * @file src/services/incident-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's decision on one case of a Security page incident, whatever kind of case
 *   it is: a held account name (held-account-names.ts resolveHeldName, "holder" or "previous") or an
 *   offered default audience cap (classification/default-caps.ts decideDefaultCap, "apply" or
 *   "keep"). The route POST /v1/admin/security/incidents/:id/resolve and the MCP tool
 *   aimeat_admin_incident_resolve both call decideIncidentCase(), so the two surfaces decide alike.
 * @structure IncidentCaseResult · decideIncidentCase()
 * @usage const r = await decideIncidentCase(config, storage, { incidentId, name, resolution, by });
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial: the dispatch moved out of the route and the MCP tool when the
 *     offered default caps became a second kind of case (plan doc-mvdipuyqraas, L5.1).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { findSecurityIncident } from './security-incident.js';
import { resolveHeldName } from './held-account-names.js';
import { DEFAULT_CAPS_INCIDENT_TYPE, decideDefaultCap } from './classification/default-caps.js';

export type IncidentCaseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_INPUT' | 'CONFLICT'; message: string };

/** Decide one case (`name`) of incident `incidentId`, by the kind of the incident. */
export async function decideIncidentCase(
  config: AimeatConfig, storage: Storage,
  input: { incidentId: string; name: string; resolution: string; by: { principal: string; kind: 'human' | 'ai' } },
): Promise<IncidentCaseResult> {
  const rec = await findSecurityIncident(storage, config, input.incidentId);
  if ((rec?.value as { type?: unknown } | undefined)?.type === DEFAULT_CAPS_INCIDENT_TYPE) {
    const r = await decideDefaultCap(config, storage, input);
    if (!r.ok) return r;
    return {
      ok: true,
      data: { name: r.name, resolution: r.resolution, label_name: r.label_name, max_audience: r.max_audience, outcome: r.outcome, incident_status: r.incident_status },
    };
  }
  const r = await resolveHeldName(config, storage, { incidentId: input.incidentId, name: input.name, resolution: input.resolution });
  if (!r.ok) return r;
  return {
    ok: true,
    data: { name: r.name, resolution: r.resolution, done: r.done, bindings_moved: r.bindings_moved, incident_status: r.incident_status },
  };
}
