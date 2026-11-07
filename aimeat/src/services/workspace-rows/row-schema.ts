/**
 * @file src/services/workspace-rows/row-schema.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The JSON Schema of a workspace ROW space, and the check of row bodies against it.
 *
 *   THE SCHEMA BELONGS TO THE SPACE AND BINDS EVERY WRITER (developer ruling 2026-11-07: "muoto
 *   kuuluu rivitilalle ja koskee kaikkia kirjoittajia"). The owner, an agent over MCP or REST, an app
 *   with organism:rows, an extension and a receiver all reach appendRows (row-service.ts), and
 *   appendRows asks this module before anything is written.
 *
 *   NO SECOND MECHANISM. A row space's schema is a schema lock in the same store, under the same key
 *   pattern and set by the same code paths as a records space's: `organism.{id}.w.{ws}.{namespace}`,
 *   applyTo 'prefix', written by aimeat_workspace_update / PUT /v1/organisms/:id/workspace
 *   (`schemas`, creator or organism admin), by a workspace create and by add_spaces, and read back
 *   in the `schemas` map of the workspace read (services/workspace-meta.ts readWorkspaceSchemas).
 *   The lock is compiled with effectiveSchemaOf (services/schema-validator.ts), so a 'strict' lock
 *   refuses an undeclared field on a row as it does on a record.
 *
 *   A CHANGED SCHEMA APPLIES TO WRITES FROM THEN ON. Nothing here reads, rewrites or deletes a row
 *   already stored; a row that the new schema would refuse stays as it is until somebody writes it
 *   again.
 * @structure
 *   - rowSchemaKeyPattern -- the lock's key pattern for one space
 *   - lockedRowSchema     -- the compiled schema of one space, or null
 *   - checkRowBodies      -- every body of a batch against it, one refusal naming each failing field
 * @usage
 *   const schema = await lockedRowSchema(storage, organismId, wsId, space.namespace);
 *   if (schema) checkRowBodies(schema, space.name, bodies);
 * @version-history
 *   2026-11-07 — Initial (developer ruling 2026-11-07).
 */
import type { Storage } from '../../storage/interface.js';
import { effectiveSchemaOf, validateValueAgainstSchema, type SchemaViolation } from '../schema-validator.js';
import { WorkspaceRowError } from './row-space.js';

/** The code a schema refusal answers with: the one the records path answers with, at 422. */
export const ROW_SCHEMA_REFUSAL = 'SCHEMA_VALIDATION_FAILED';

/** How many failing rows the refusal sentence names. The details carry up to ROWS_IN_DETAILS. */
const ROWS_IN_MESSAGE = 5;
const ROWS_IN_DETAILS = 50;

/** The key pattern every workspace code path locks a space's schema under. */
export function rowSchemaKeyPattern(organismId: string, wsId: string, namespace: string): string {
  return `organism.${organismId}.w.${wsId}.${namespace}`;
}

/**
 * The compiled JSON Schema of one row space, or null when none is locked on it.
 *
 * The lock on the space's own pattern, exact before prefix (storage.getSchema), not the most
 * specific lock any key would meet (findApplicableSchema): a row is not a memory key, and the
 * schema that binds it is the one somebody set on this space.
 */
export async function lockedRowSchema(
  storage: Storage, organismId: string, wsId: string, namespace: string,
): Promise<Record<string, unknown> | null> {
  const lock = await storage.getSchema(rowSchemaKeyPattern(organismId, wsId, namespace));
  return lock ? effectiveSchemaOf(lock) : null;
}

/** A violation as a field path inside the row body: `/amount`, `/account` for a missing one. */
function fieldOf(v: SchemaViolation): string {
  const base = v.path === '/' ? '' : v.path;
  const p = v.params ?? {};
  if (typeof p.missingProperty === 'string') return `${base}/${p.missingProperty}`;
  if (typeof p.additionalProperty === 'string') return `${base}/${p.additionalProperty}`;
  return base || '/';
}

/**
 * Check every body of a batch against the space's schema, and refuse the whole batch when one fails.
 *
 * All rows are checked before the refusal, so a caller fixing a batch learns every bad row from
 * one answer. The refusal names the row index and each failing field path; `details.rows` carries
 * the same with the rule and the message per field.
 */
export function checkRowBodies(
  schema: Record<string, unknown>, spaceName: string, bodies: ReadonlyArray<Record<string, unknown>>,
): void {
  const failing: Array<{ row: number; violations: Array<{ field: string; message: string; rule?: string }> }> = [];
  for (const [i, body] of bodies.entries()) {
    const res = validateValueAgainstSchema(body, schema);
    if (res.ok) continue;
    if (!res.violations?.length) {
      // The schema itself does not compile, or the value is nested past the bound. The first is the
      // space's problem, not the caller's, and every row would meet it, so it is said once.
      const why = (res.errors ?? []).join('; ');
      if (/^invalid schema/.test(why)) {
        throw new WorkspaceRowError(ROW_SCHEMA_REFUSAL, 422,
          `The schema set on "${spaceName}" is not a valid JSON Schema (${why}), so no row can be checked against it. The workspace creator or an organism admin replaces it with aimeat_workspace_update { schemas }.`,
          { space: spaceName });
      }
      failing.push({ row: i, violations: [{ field: '/', message: why }] });
      continue;
    }
    failing.push({
      row: i,
      violations: res.violations.map(v => ({ field: fieldOf(v), message: v.message, rule: v.schema_rule })),
    });
  }
  if (!failing.length) return;

  const named = failing.slice(0, ROWS_IN_MESSAGE).map(f =>
    `rows[${f.row}]: ${f.violations.map(v => `${v.field} ${v.message}`).join('; ')}`);
  const more = failing.length > ROWS_IN_MESSAGE ? ` (and ${failing.length - ROWS_IN_MESSAGE} more rows)` : '';
  throw new WorkspaceRowError(ROW_SCHEMA_REFUSAL, 422,
    `${failing.length} of ${bodies.length} rows do not match the schema of "${spaceName}", so none was written. ${named.join(' | ')}${more}. The fields are paths inside the row body. Read the schema in \`schemas\` of aimeat_workspace_read.`,
    { space: spaceName, rows: failing.slice(0, ROWS_IN_DETAILS) });
}
