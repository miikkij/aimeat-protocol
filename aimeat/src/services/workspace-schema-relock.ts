/**
 * @file src/services/workspace-schema-relock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The start step that re-opens workspace spaces the strict lock had closed to every
 *   property (docs/pitfalls.md §102).
 *
 *   AIMEAT.organism.createWorkspace filled `{ type: 'object', additionalProperties: true }` for a
 *   records space the caller gave no schema, meaning "any field". A workspace locks every schema
 *   strict, and strict closes an object to every property it does not list, so such a space refused
 *   every record and every intake form. The library fills `patternProperties` since aimeat-organism
 *   1.4.1; the locks written before stay closed. Production held 8 of them on 2026-10-01, all
 *   strict, all exactly that object, and no lock that admitted nothing in another shape.
 *
 *   WHAT IT CHANGES, AND ON WHAT EVIDENCE. A strict lock under a workspace (`organism.<id>.w.<ws>.`)
 *   whose schema is EXACTLY the old filled object is re-locked with OPEN_RECORDS_SCHEMA, keeping its
 *   mode, its locker and its applyTo. That object has one meaning, and the new schema is the meaning
 *   it was written for. A strict workspace lock that says `additionalProperties: true`, lists no
 *   properties and no patterns, and carries anything else (a `required`, a title) admits nothing
 *   too, but what its author meant is not certain: it stays as it is and is reported once as an
 *   incident on the Security page, where the operator re-locks it with PUT /v1/organisms/:id/workspace.
 *   Nothing here throws: a store that cannot be read is logged and the next start tries again.
 * @structure OLD_FILLED_SCHEMA · OPEN_RECORDS_SCHEMA · RELOCK_INCIDENT_TYPE/CODE/SOURCE ·
 *   isWorkspaceLock · isOldFill · saysOpenAdmitsNothing · settleWorkspaceSchemasAtStart(config, storage)
 * @usage await settleWorkspaceSchemasAtStart(config, storage);   // server-bootstrap/config-init.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, SchemaRecord } from '../storage/interface.js';
import { listSecurityIncidents, recordSecurityIncident, securityOwner } from './security-incident.js';
import { logger } from '../utils/logger.js';

/** What createWorkspace filled before aimeat-organism 1.4.1. */
export const OLD_FILLED_SCHEMA = Object.freeze({ type: 'object', additionalProperties: true });

/** What it fills now, and what the old lock is re-locked with: every property name is admitted. */
export const OPEN_RECORDS_SCHEMA = Object.freeze({ type: 'object', patternProperties: Object.freeze({ '^.*$': Object.freeze({}) }) });

/** The incident's type, code and source, which the Security page words in the reader's language. */
export const RELOCK_INCIDENT_TYPE = 'workspace_schema_closed';
export const RELOCK_INCIDENT_CODE = 'SCHEMA_ADMITS_NOTHING';
export const RELOCK_SOURCE = 'workspace_schema_relock';

/** A lock on one space of a workspace: `organism.<org>.w.<ws>.<namespace>`. */
export function isWorkspaceLock(keyPattern: string): boolean {
  return /^organism\.[^.]+\.w\.[^.]+\.[^.]/.test(keyPattern);
}

/** Exactly the old filled object: two keys, these two values. */
export function isOldFill(schema: Record<string, unknown> | null | undefined): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const keys = Object.keys(schema).sort();
  return keys.length === 2 && keys[0] === 'additionalProperties' && keys[1] === 'type'
    && schema.type === 'object' && schema.additionalProperties === true;
}

/** Says `additionalProperties: true` and names no property, so a strict lock admits nothing. */
export function saysOpenAdmitsNothing(schema: Record<string, unknown> | null | undefined): boolean {
  if (!schema || typeof schema !== 'object' || schema.type !== 'object' || schema.additionalProperties !== true) return false;
  const named = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v as object).length > 0;
  return !named(schema.properties) && !named(schema.patternProperties);
}

/**
 * Re-lock the old filled schemas, report the ambiguous ones once. Answers what it did.
 */
export async function settleWorkspaceSchemasAtStart(
  config: AimeatConfig,
  storage: Storage,
): Promise<{ relocked: string[]; reported: string[] }> {
  const relocked: string[] = [];
  const reported: string[] = [];
  let locks: SchemaRecord[];
  try {
    locks = await storage.listSchemas('organism.');
  } catch (err) {
    logger.error('workspace-schema-relock: the schema locks were not read at start. The next start tries again.', { error: String(err) });
    return { relocked, reported };
  }

  const ambiguous: string[] = [];
  for (const l of locks) {
    if (l.schemaMode !== 'strict' || !isWorkspaceLock(l.keyPattern)) continue;
    if (isOldFill(l.schemaJson)) {
      try {
        await storage.setSchema({ ...l, schemaJson: structuredClone(OPEN_RECORDS_SCHEMA) as Record<string, unknown>, updatedAt: new Date().toISOString() });
        relocked.push(l.keyPattern);
      } catch (err) {
        logger.error('workspace-schema-relock: one lock was not re-locked. The next start tries again.', { key: l.keyPattern, error: String(err) });
      }
    } else if (saysOpenAdmitsNothing(l.schemaJson)) {
      ambiguous.push(l.keyPattern);
    }
  }
  if (relocked.length) {
    logger.info('workspace-schema-relock: re-opened workspace spaces the strict lock had closed to every field', { count: relocked.length, keys: relocked });
  }
  if (!ambiguous.length) return { relocked, reported };

  // A lock is reported once: the incident names its keys in `sources`, and a later start skips them.
  try {
    const seen = new Set<string>();
    for (const i of (await listSecurityIncidents(storage, config)).items) {
      if (i.type === RELOCK_INCIDENT_TYPE) for (const s of i.sources ?? []) seen.add(s);
    }
    const fresh = ambiguous.filter(k => !seen.has(k));
    if (!fresh.length) return { relocked, reported };
    const r = await recordSecurityIncident(storage, config, {
      type: RELOCK_INCIDENT_TYPE,
      code: RELOCK_INCIDENT_CODE,
      actorGhii: securityOwner(config.nodeId),
      source: RELOCK_SOURCE,
      detail: `These workspace spaces are locked strict with a schema that says every field is allowed and lists none, so every record written to them is refused: ${fresh.join(', ')}. `
        + 'They were left as they are because the schema carries more than the old default. Re-lock each one with PUT /v1/organisms/:id/workspace and a schema that lists its fields, or names them with patternProperties.',
      sources: fresh,
    });
    if (r.recorded) reported.push(...fresh);
  } catch (err) {
    logger.error('workspace-schema-relock: the incident for the ambiguous locks was not recorded. The next start tries again.', { error: String(err) });
  }
  return { relocked, reported };
}
