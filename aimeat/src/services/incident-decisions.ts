/**
 * @file src/services/incident-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's decision on one case of a Security page incident, whatever kind of case
 *   it is: a held account name (held-account-names.ts resolveHeldName, "holder" or "previous") or an
 *   offered default audience cap (classification/default-caps.ts decideDefaultCap, "apply" or
 *   "keep"), or a record an incident names to act on (incident-entries.ts: "clear", "delete" or "app_only" as
 *   the entry offers, or "keep"; the shared anonymous agent's records, the schedules older account
 *   erasures left, and the subdomain addresses the start step could not classify). The route POST /v1/admin/security/incidents/:id/resolve, the MCP tool
 *   aimeat_admin_incident_resolve and its CLI twin all call decideIncidentCase(), so they decide alike.
 * @structure IncidentCaseResult · decideIncidentCase()
 * @usage const r = await decideIncidentCase(config, storage, { incidentId, name, resolution, by });
 * @version-history
 *   v1.6.0 -- 2026-10-29 -- And of the platform-fee incident: 'uncount' leaves a record out of the
 *     dashboard's money fees (commerce/platform-fee-writers.ts; secaudit2026oct26 round 8c).
 *   v1.5.0 -- 2026-10-27 -- And of the subdomain incident: 'app_only' serves the address only at its app
 *     address (services/subdomain-site-origin-keep.ts; Jouni, 2026-10-27).
 *   v1.4.0 -- 2026-10-27 -- The capability incident is gone: the step sets an unknown word to private and
 *     tells the owner (services/capability-visibility-words.ts; developer decision 2026-10-27).
 *   v1.3.0 -- 2026-10-26 -- And of the incident that names the capabilities with an unknown visibility
 *     word: 'clear' sets the word to private (services/capability-visibility-words.ts; secaudit2026oct22).
 *   v1.2.0 -- 2026-10-25 -- And of the incident that names the schedules older erasures left
 *     (services/erasure-leftover-schedules.ts; secaudit2026oct22).
 *   v1.1.0 -- 2026-10-25 -- The entries of the anonymous-records incident are decided here too
 *     (services/incident-entries.ts; secaudit2026oct22).
 *   v1.0.0 — 2026-10-18 — Initial: the dispatch moved out of the route and the MCP tool when the
 *     offered default caps became a second kind of case (plan doc-mvdipuyqraas, L5.1).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { findSecurityIncident } from './security-incident.js';
import { resolveHeldName } from './held-account-names.js';
import { DEFAULT_CAPS_INCIDENT_TYPE, decideDefaultCap } from './classification/default-caps.js';
import { decideIncidentEntry } from './incident-entries.js';
import { ANONYMOUS_RECORDS_INCIDENT_TYPE, clearAnonymousRecord } from './anonymous-principal-records.js';
import { ERASURE_LEFTOVER_INCIDENT_TYPE, deleteLeftoverSchedule } from './erasure-leftover-schedules.js';
import { SUBDOMAIN_SITE_ORIGIN_INCIDENT_TYPE, serveAtAppAddressOnly } from './subdomain-site-origin-keep.js';
import { PLATFORM_FEE_INCIDENT_TYPE, uncountPlatformFeeRecord } from '../commerce/platform-fee-writers.js';

export type IncidentCaseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_INPUT' | 'CONFLICT'; message: string };

/** Decide one case (`name`) of incident `incidentId`, by the kind of the incident. */
export async function decideIncidentCase(
  config: AimeatConfig, storage: Storage,
  input: { incidentId: string; name: string; resolution: string; by: { principal: string; kind: 'human' | 'ai' } },
): Promise<IncidentCaseResult> {
  const rec = await findSecurityIncident(storage, config, input.incidentId);
  const type = (rec?.value as { type?: unknown } | undefined)?.type;
  // An incident that names records to act on: the kind supplies what its action does.
  const actor = type === ANONYMOUS_RECORDS_INCIDENT_TYPE ? clearAnonymousRecord
    : type === ERASURE_LEFTOVER_INCIDENT_TYPE ? deleteLeftoverSchedule
    : type === SUBDOMAIN_SITE_ORIGIN_INCIDENT_TYPE ? serveAtAppAddressOnly
    : type === PLATFORM_FEE_INCIDENT_TYPE ? uncountPlatformFeeRecord : null;
  if (actor) return decideIncidentEntry(config, storage, input, actor);
  if (type === DEFAULT_CAPS_INCIDENT_TYPE) {
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
