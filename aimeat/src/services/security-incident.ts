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
 *
 *   AN INCIDENT WITH NAMES TO DECIDE. The move to the full identity and the start step for the
 *   cortexes and ecosystem apps of deleted accounts open one incident for what they could not place
 *   (services/held-account-names.ts): each held name with its counts and the hook bindings that name
 *   its actions. Such an incident closes when every name is decided, so it cannot be resolved or
 *   deleted while a name is still open (CONFLICT).
 * @structure recordSecurityIncident(storage, config, input) · listSecurityIncidents · findSecurityIncident ·
 *   resolveSecurityIncident · deleteSecurityIncident · saveSecurityIncident · undecidedNames ·
 *   SECURITY_INCIDENT_PREFIX / QUARANTINE_PREFIX
 * @usage import { recordSecurityIncident } from '../services/security-incident.js';
 * @version-history
 *   v1.3.0 -- 2026-09-26 -- An incident names the runs of the records it was made from (`sources`), so
 *     the start step's record joins it once.
 *   v1.2.0 -- 2026-09-26 -- An incident can carry names to decide, the hook bindings that name nothing
 *     and the ledger values nothing ties to a person (the move to the full identity). Resolving or
 *     deleting it is refused with CONFLICT while a name is undecided. recordSecurityIncident says
 *     whether it recorded; saveSecurityIncident writes a changed incident back.
 *   v1.1.0 -- 2026-09-05 -- The operator's reads and actions (list, find, resolve, delete) move in
 *     from routes/admin-security.ts so the aimeat_admin_incident_resolve tool calls the same code;
 *     resolve and delete announce the change.
 *   v1.0.0 -- 2026-06-09 -- Initial: incident log + ZIP quarantine.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { HeldAccountName, HeldNameOutcome, HeldNameResolution, UntiedLedgerValue } from '../storage/types/held-names.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';

export const SECURITY_INCIDENT_PREFIX = 'security.incident.';
export const SECURITY_QUARANTINE_PREFIX = 'security.quarantine.';
const QUARANTINE_MAX_BYTES = 10 * 1024 * 1024;   // never store a multi-GB bomb — cap the evidence
/** How many incidents one listing returns; the count says how many there are in all. */
const LIST_CAP = 200;

export const securityOwner = (nodeId: string) => `security-system@${nodeId}`;

/** A hook binding an incident names. `gate`: the moment decides whether the thing happens. */
export interface IncidentBinding {
  hook: string;
  ref: string;
  gate: boolean;
}

/** One name of an incident the move to the full identity opened, with the decision once made. */
export interface IncidentHeldName extends HeldAccountName {
  /** The hook bindings that name one of this name's actions by the bare name. */
  bindings: IncidentBinding[];
  status: 'open' | HeldNameResolution;
  resolvedAt?: string;
  /** What the decision did. */
  done?: HeldNameOutcome;
}

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
  /** Names to decide, bindings that name nothing, values left as they are (the move to the full identity). */
  names?: IncidentHeldName[];
  bindingsLeft?: IncidentBinding[];
  untied?: UntiedLedgerValue[];
  /** When the move that opened it ran, so a start never opens it twice. */
  moveAt?: string;
  /** The runs of the records it was made from (`<key>@<at>`), so a start never takes one twice. */
  sources?: string[];
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
  /** Names the operator decides one by one; the incident closes with the last. */
  names?: IncidentHeldName[];
  /** Hook bindings that name nothing now. A gate among them lets everything pass until it is bound again. */
  bindings_left?: IncidentBinding[];
  /** Values in other people's ledgers that no account holds and nothing ties to a person, left as they are. */
  untied?: UntiedLedgerValue[];
  /** When the move to the full identity that opened this incident ran. */
  move_at?: string;
  /** The runs of the records this incident was made from (`<key>@<at>`): the move's and the start step's. */
  sources?: string[];
}

type IncidentRecord = Awaited<ReturnType<Storage['listAllMemory']>>['items'][number];

export async function recordSecurityIncident(
  storage: Storage,
  config: AimeatConfig,
  input: SecurityIncidentInput,
): Promise<{ id: string; quarantined: boolean; recorded: boolean }> {
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

  let recorded = false;
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
        ...(input.names ? { names: input.names } : {}),
        ...(input.bindingsLeft ? { bindings_left: input.bindingsLeft } : {}),
        ...(input.untied ? { untied: input.untied } : {}),
        ...(input.moveAt ? { move_at: input.moveAt } : {}),
        ...(input.sources ? { sources: input.sources } : {}),
      },
      visibility: 'private', tags: ['security'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    recorded = true;
  } catch (err) { logger.warn('recordSecurityIncident: incident logging is best-effort — must not fail the request', { error: String(err) }); }

  return { id, quarantined: quarantineKey !== null, recorded };
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

/** The names of an incident that are not decided yet. */
export function undecidedNames(value: SecurityIncidentValue): string[] {
  return (value.names ?? []).filter(n => n.status === 'open').map(n => n.name);
}

/** Write a changed incident back under its own key, and tell the open pages. */
export async function saveSecurityIncident(storage: Storage, rec: IncidentRecord, value: SecurityIncidentValue): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: rec.key, ownerGaii: rec.ownerGaii, value,
    visibility: rec.visibility, tags: rec.tags, ttlHours: rec.ttlHours, version: rec.version + 1, createdAt: rec.createdAt, updatedAt: now,
  });
  emitChange('security');
}

/**
 * Mark an incident resolved. The quarantined bytes stay until the incident is deleted. An incident
 * with names to decide closes when the last one is decided, so it is refused while one is open.
 */
export async function resolveSecurityIncident(storage: Storage, config: AimeatConfig, id: string): Promise<{ ok: true; resolvedAt: string } | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' }> {
  const rec = await findSecurityIncident(storage, config, id);
  if (!rec) return { ok: false, code: 'NOT_FOUND' };
  const value = rec.value as SecurityIncidentValue;
  if (undecidedNames(value).length > 0) return { ok: false, code: 'CONFLICT' };
  const now = new Date().toISOString();
  await saveSecurityIncident(storage, rec, { ...value, status: 'resolved', resolvedAt: now });
  return { ok: true, resolvedAt: now };
}

/**
 * Remove an incident together with its quarantined blob (the blob's removal is best-effort). An
 * incident with names to decide is kept while one is open, so its record of them is not lost.
 */
export async function deleteSecurityIncident(storage: Storage, config: AimeatConfig, id: string): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' }> {
  const rec = await findSecurityIncident(storage, config, id);
  if (!rec) return { ok: false, code: 'NOT_FOUND' };
  if (undecidedNames(rec.value as SecurityIncidentValue).length > 0) return { ok: false, code: 'CONFLICT' };
  const qk = (rec.value as SecurityIncidentValue).quarantine_key;
  if (qk) { try { await storage.deleteStorageFile(rec.ownerGaii, qk); } catch (err) { logger.warn('deleteSecurityIncident: dropping the quarantined blob is best-effort', { error: String(err) }); } }
  await storage.deleteMemory(rec.ownerGaii, rec.key);
  emitChange('security');
  return { ok: true };
}
