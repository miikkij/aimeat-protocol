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
 * @structure recordSecurityIncident(storage, config, input); SECURITY_INCIDENT_PREFIX / QUARANTINE_PREFIX
 * @usage import { recordSecurityIncident } from '../services/security-incident.js';
 * @version-history
 *   v1.0.0 -- 2026-06-09 -- Initial: incident log + ZIP quarantine.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';

export const SECURITY_INCIDENT_PREFIX = 'security.incident.';
export const SECURITY_QUARANTINE_PREFIX = 'security.quarantine.';
const QUARANTINE_MAX_BYTES = 10 * 1024 * 1024;   // never store a multi-GB bomb — cap the evidence

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
