/**
 * @file src/services/incident-entries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's decision on one entry of a Security page incident that names records to
 *   act on (`entries`, services/security-incident.ts IncidentEntry): the entry's offered action
 *   ('clear' or 'delete') or 'keep'. The kind of incident supplies what the action does (an
 *   EntryActor); this file finds the entry, refuses a decision twice, runs the action, records who
 *   decided what and when, and resolves the incident with its last entry.
 *
 *   The route POST /v1/admin/security/incidents/:id/resolve with { name, resolution }, the MCP tool
 *   aimeat_admin_incident_resolve and its CLI twin reach it through services/incident-decisions.ts,
 *   so the three surfaces and the control on the Security page decide alike.
 *
 *   WHO. Operator only: the route asks requireOperator and the MCP tool the operator:admin word before
 *   either calls in. Nothing here is reachable by another principal.
 * @structure EntryActor · decideIncidentEntry(config, storage, input, actor)
 * @usage const r = await decideIncidentEntry(config, storage, { incidentId, name, resolution, by }, clearAnonymousRecord);
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22: the shared anonymous agent's records, and the
 *     schedules older erasures left behind).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { findSecurityIncident, saveSecurityIncident, type IncidentEntry, type SecurityIncidentValue } from './security-incident.js';

/** What an entry's offered action does. Returns one line that says what it did. */
export type EntryActor = (storage: Storage, config: AimeatConfig, entry: IncidentEntry) => Promise<string>;

export type EntryDecision =
  | { ok: true; data: { name: string; resolution: string; entry_done: string; incident_status: string } }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_INPUT' | 'CONFLICT'; message: string };

/** Decide entry `name` of incident `incidentId`: its offered action, or 'keep'. */
export async function decideIncidentEntry(
  config: AimeatConfig, storage: Storage,
  input: { incidentId: string; name: string; resolution: string; by: { principal: string } },
  actor: EntryActor,
): Promise<EntryDecision> {
  const rec = await findSecurityIncident(storage, config, input.incidentId);
  if (!rec) return { ok: false, code: 'NOT_FOUND', message: 'Incident not found' };
  const value = rec.value as SecurityIncidentValue;
  const entries = value.entries ?? [];
  const entry = entries.find(e => e.id === input.name);
  if (!entry) {
    return { ok: false, code: 'NOT_FOUND', message: `This incident has no entry "${input.name}". Its entries are: ${entries.map(e => e.id).join(', ') || 'none'}.` };
  }
  if (input.resolution !== entry.action && input.resolution !== 'keep') {
    return { ok: false, code: 'INVALID_INPUT', message: `Entry "${entry.id}" takes "${entry.action}" or "keep".` };
  }
  if (entry.status !== 'open') {
    return { ok: false, code: 'CONFLICT', message: `Entry "${entry.id}" was decided already (${entry.status}${entry.decidedAt ? ` on ${entry.decidedAt.slice(0, 10)}` : ''}).` };
  }
  const done = input.resolution === 'keep' ? 'kept as it is' : await actor(storage, config, entry);
  const now = new Date().toISOString();
  const next = entries.map(e => (e.id === entry.id
    ? { ...e, status: input.resolution === 'keep' ? 'kept' as const : 'done' as const, decidedAt: now, decidedBy: input.by.principal, done }
    : e));
  const last = next.every(e => e.status !== 'open');
  const status = last && value.status === 'open' ? 'resolved' : value.status;
  await saveSecurityIncident(storage, rec, {
    ...value, entries: next, status, ...(status === 'resolved' && value.status === 'open' ? { resolvedAt: now } : {}),
  });
  return { ok: true, data: { name: entry.id, resolution: input.resolution, entry_done: done, incident_status: status } };
}
