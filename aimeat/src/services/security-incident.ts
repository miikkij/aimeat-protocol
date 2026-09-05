/**
 * @file security-incident.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Security incident log + quarantine. When an untrusted upload (e.g. a ZIP) fails a
 *   safety check, the handler records an incident (what, who attempted it, when, machine code +
 *   detail) and — if small enough — quarantines the rejected bytes for an operator to inspect,
 *   instead of processing or silently dropping them. Incidents + quarantined blobs are stored as
 *   memory/storage records under a synthetic system owner; operators read + action them on the admin
 *   Security tab. Best-effort: logging must never throw into the request path.
 *
 *   ONE IMPLEMENTATION FOR THE OPERATOR'S READS AND ACTIONS. Listing, finding, resolving and deleting
 *   an incident live here and are called by the HTTP route and by the MCP tool alike, so a chat and
 *   a screen cannot drift apart on what "resolved" means.
 * @structure recordSecurityIncident(storage, config, input) · listSecurityIncidents · findSecurityIncident ·
 *   resolveSecurityIncident · deleteSecurityIncident · SECURITY_INCIDENT_PREFIX / QUARANTINE_PREFIX
 * @usage import { recordSecurityIncident } from '../services/security-incident.js';
 * @version-history
 *   v1.1.0 -- 2026-09-05 -- The operator's reads and actions (list, find, resolve, delete) move in
 *     from routes/admin-security.ts so the aimeat_admin_incident_resolve tool calls the same code;
 *     resolve and delete announce the change.
 *   v1.0.0 -- 2026-06-09 -- Initial: incident log + ZIP quarantine.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';

export const SECURITY_INCIDENT_PREFIX = 'security.incident.';
export const SECURITY_QUARANTINE_PREFIX = 'security.quarantine.';
const QUARANTINE_MAX_BYTES = 10 * 1024 * 1024;   // never store a multi-GB bomb — cap the evidence
/** How many incidents one listing returns; the count says how many there are in all. */
const LIST_CAP = 200;

export const securityOwner = (nodeId: string) => `security-system@${nodeId}`;

export interface SecurityIncidentInput {
  /** Category, e.g. 'zip_import'. */
  type: string;
  /** Machine code, e.g. the ZipSecurityError code. */
  code: string;
  /** Identity that attempted the action. */
  actorGhii: string;
  actorName?: string;
  /** Human-readable detail. */
  detail: string;
  /** Where it happened, e.g. 'workspace_import' | 'organism_import'. */
  source?: string;
  /** The rejected payload to quarantine (optional, capped). */
  blob?: Buffer;
}

/** One incident as stored and as served to the operator. */
export interface SecurityIncidentValue {
  id: string;
  type: string;
  code: string;
  actor: string;
  actor_name: string;
  detail: string;
  source: string;
  quarantine_key: string | null;
  size_bytes: number;
  status: string;
  createdAt: string;
  resolvedAt?: string;
}

type IncidentRecord = Awaited<ReturnType<Storage['listAllMemory']>>['items'][number];

export async function recordSecurityIncident(
  storage: Storage,
  config: AimeatConfig,
  input: SecurityIncidentInput,
): Promise<{ id: string; quarantined: boolean }> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const owner = securityOwner(config.nodeId);

  let quarantineKey: string | null = null;
  if (input.blob && input.blob.length > 0 && input.blob.length <= QUARANTINE_MAX_BYTES) {
    const key = `${SECURITY_QUARANTINE_PREFIX}${id}`;
    try {
      await storage.createStorageFile({ key, ownerGaii: owner, visibility: 'private', mimeType: 'application/zip', size: input.blob.length, data: input.blob, createdAt: now });
      quarantineKey = key;
    } catch (err) { logger.warn('recordSecurityIncident: quarantine is best-effort', { error: String(err) }); }
  }

  try {
    await storage.setMemory({
      key: `${SECURITY_INCIDENT_PREFIX}${now}.${id.slice(0, 8)}`,
      ownerGaii: owner,
      value: {
        id, type: input.type, code: input.code,
        actor: input.actorGhii, actor_name: input.actorName ?? '',
        detail: input.detail, source: input.source ?? '',
        quarantine_key: quarantineKey, size_bytes: input.blob?.length ?? 0,
        status: 'open', createdAt: now,
      },
      visibility: 'private', tags: ['security'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
  } catch (err) { logger.warn('recordSecurityIncident: incident logging is best-effort — must not fail the request', { error: String(err) }); }

  return { id, quarantined: quarantineKey !== null };
}

/** Every incident record under the system owner, newest first. */
async function incidentRecords(storage: Storage, config: AimeatConfig): Promise<IncidentRecord[]> {
  const owner = securityOwner(config.nodeId);
  const { items } = await storage.listAllMemory({ prefix: SECURITY_INCIDENT_PREFIX, limit: 1000 });
  return items
    .filter(r => r.ownerGaii === owner && (r.value as SecurityIncidentValue | undefined)?.id)
    .sort((a, b) => ((b.value as SecurityIncidentValue).createdAt || '').localeCompare((a.value as SecurityIncidentValue).createdAt || ''));
}

/** The operator's list: the newest LIST_CAP incidents, how many are open, how many exist in all. */
export async function listSecurityIncidents(storage: Storage, config: AimeatConfig): Promise<{ items: SecurityIncidentValue[]; open: number; total: number }> {
  const all = (await incidentRecords(storage, config)).map(r => r.value as SecurityIncidentValue);
  return { items: all.slice(0, LIST_CAP), open: all.filter(i => i.status === 'open').length, total: all.length };
}

export async function findSecurityIncident(storage: Storage, config: AimeatConfig, id: string): Promise<IncidentRecord | null> {
  return (await incidentRecords(storage, config)).find(r => (r.value as SecurityIncidentValue).id === id) ?? null;
}

/** Mark an incident resolved. The quarantined bytes stay until the incident is deleted. */
export async function resolveSecurityIncident(storage: Storage, config: AimeatConfig, id: string): Promise<{ ok: true; resolvedAt: string } | { ok: false; code: 'NOT_FOUND' }> {
  const rec = await findSecurityIncident(storage, config, id);
  if (!rec) return { ok: false, code: 'NOT_FOUND' };
  const now = new Date().toISOString();
  await storage.setMemory({
    key: rec.key, ownerGaii: rec.ownerGaii,
    value: { ...(rec.value as SecurityIncidentValue), status: 'resolved', resolvedAt: now },
    visibility: rec.visibility, tags: rec.tags, ttlHours: rec.ttlHours, version: rec.version + 1, createdAt: rec.createdAt, updatedAt: now,
  });
  emitChange('security');
  return { ok: true, resolvedAt: now };
}

/** Remove an incident together with its quarantined blob (the blob's removal is best-effort). */
export async function deleteSecurityIncident(storage: Storage, config: AimeatConfig, id: string): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' }> {
  const rec = await findSecurityIncident(storage, config, id);
  if (!rec) return { ok: false, code: 'NOT_FOUND' };
  const qk = (rec.value as SecurityIncidentValue).quarantine_key;
  if (qk) { try { await storage.deleteStorageFile(rec.ownerGaii, qk); } catch (err) { logger.warn('deleteSecurityIncident: dropping the quarantined blob is best-effort', { error: String(err) }); } }
  await storage.deleteMemory(rec.ownerGaii, rec.key);
  emitChange('security');
  return { ok: true };
}
