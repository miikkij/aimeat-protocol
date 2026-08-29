/**
 * @file src/services/workspace-rows/row-space.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Resolving a ROW space from a workspace manifest, and the mapping between the field
 *   names a caller uses and the three columns the table actually indexes.
 *
 *   THE MAPPING IS THE WHOLE INTERFACE. A caller says `where: { contactRef: 'c-1' }` and never
 *   learns that `contactRef` landed in `k1`. The manifest's `indexOn` order decides the positions,
 *   which means a space can add a third column later without any caller changing, and cannot
 *   REORDER the first two without orphaning what is already stored — so the order is a contract and
 *   the resolver says so where somebody will read it.
 *
 *   FILTERING ON AN UNDECLARED FIELD IS A REFUSAL, NOT AN EMPTY RESULT AND NOT A FULL ONE. Both
 *   silent answers are wrong in a way that survives testing: returning everything looks like the
 *   filter ran and matched broadly, returning nothing looks like the data is missing. The refusal
 *   names the three fields that ARE indexed, which is the only sentence that helps.
 * @structure
 *   - RowSpace / resolveRowSpace  -- the manifest lookup and its refusals
 *   - columnsForBody              -- write side: field values into k1/k2/k3
 *   - columnsForWhere             -- read side: a caller's filter into k1/k2/k3, or a refusal
 *   - retentionOf                 -- the declared window, normalised
 * @usage const space = resolveRowSpace(manifest, 'mailmessage');
 * @version-history
 *   v1.1.0 — 2026-08-29 — `apps`: the apps the organism opened the space to, normalised to
 *     lowercase owner/filename.
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { isRowBackedSpace, isMemoryBackedSpace, MAX_INDEX_ON } from '../workspace-meta.js';

/** Raised by every function here; the route and the MCP tool both map it to their own envelope. */
export class WorkspaceRowError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceRowError';
  }
}

/** An objectType as this module needs it. Everything else in the manifest is somebody else's. */
export interface RowObjectType {
  name?: string;
  namespace?: string;
  backing?: string;
  writeRole?: string;
  indexOn?: unknown;
  retention?: unknown;
  /**
   * Apps this space is open to, as `owner/filename`. An app running in a person's browser holds an
   * app grant, never a membership, and the organism's data is not the person's to open with a
   * click — so the ORGANISM names the apps here, and the person approves the `organism:rows`
   * scope at sign-in. Both hands, or neither. Read the design in row-service.ts (authorizeApp).
   */
  apps?: unknown;
}

/** A resolved row space: what to store into, what is indexed, and how long rows stay. */
export interface RowSpace {
  name: string;
  namespace: string;
  /** The declared field names, in the order that fixes their column positions. */
  indexOn: string[];
  writeRole: string;
  retention: { maxRows: number | null; maxDays: number | null };
  /** The apps the organism opened this space to (`owner/filename`, lowercase). Empty = none. */
  apps: string[];
}

/** The three columns, as the storage layer takes them. */
export interface RowColumns {
  k1: string;
  k2: string;
  k3: string;
}

const COLUMN_NAMES = ['k1', 'k2', 'k3'] as const;

/** Whatever a row carried in a declared field, flattened to the one string a column can hold. */
function asColumnValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // An object or an array in a declared field is a modelling mistake rather than a value to index,
  // and stringifying it would produce a column nobody can ever match against. Empty says "not
  // indexed" honestly, and the row itself still carries the value.
  return '';
}

/**
 * Find the space by objectType NAME or by namespace, the same pair every other workspace surface
 * accepts, and refuse anything that is not a row space with a sentence naming what it is instead.
 */
export function resolveRowSpace(
  objectTypes: RowObjectType[] | undefined,
  space: string,
): RowSpace {
  const wanted = space.trim();
  if (!wanted) {
    throw new WorkspaceRowError('SPACE_REQUIRED', 400, 'Name the space to read or write.');
  }
  const types = objectTypes ?? [];
  const ot = types.find(t => t.name === wanted) ?? types.find(t => t.namespace === wanted);
  if (!ot) {
    const known = types.filter(isRowBackedSpace).map(t => t.name ?? t.namespace).filter(Boolean);
    throw new WorkspaceRowError('SPACE_NOT_FOUND', 404,
      known.length
        ? `This workspace has no space "${wanted}". Its row spaces are: ${known.join(', ')}.`
        : `This workspace has no space "${wanted}", and no row spaces at all. A row space is declared in the manifest with backing:'rows'.`);
  }
  if (!isRowBackedSpace(ot)) {
    const what = isMemoryBackedSpace(ot) ? 'a memory space (records or documents)' : `backing:'${String(ot.backing)}'`;
    throw new WorkspaceRowError('NOT_A_ROW_SPACE', 400,
      `"${wanted}" is ${what}, so it is read and written through the workspace record tools, not through rows.`);
  }

  const indexOn = Array.isArray(ot.indexOn)
    ? ot.indexOn.filter((c): c is string => typeof c === 'string' && !!c.trim()).map(c => c.trim()).slice(0, MAX_INDEX_ON)
    : [];

  return {
    name: ot.name ?? ot.namespace ?? wanted,
    namespace: ot.namespace ?? ot.name ?? wanted,
    indexOn,
    writeRole: typeof ot.writeRole === 'string' ? ot.writeRole : 'member',
    retention: retentionOf(ot.retention),
    // `owner/filename`, lowercased, so the comparison with the grant's `app` claim is exact.
    apps: Array.isArray(ot.apps)
      ? ot.apps.filter((a): a is string => typeof a === 'string' && a.includes('/')).map((a) => a.trim().toLowerCase())
      : [],
  };
}

/** The declared window, with anything unusable read as "no window" rather than as zero. */
export function retentionOf(raw: unknown): { maxRows: number | null; maxDays: number | null } {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const num = (v: unknown): number | null => {
    const n = Number(v);
    // A retention of 0 would mean "delete everything on arrival", which nobody means and which a
    // typo produces easily. Only a positive finite number is a window.
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };
  return { maxRows: num(r.maxRows), maxDays: num(r.maxDays) };
}

/** Write side: pick the declared fields out of a row body and place them in their columns. */
export function columnsForBody(space: RowSpace, body: Record<string, unknown>): RowColumns {
  const out: RowColumns = { k1: '', k2: '', k3: '' };
  space.indexOn.forEach((field, i) => {
    if (i < COLUMN_NAMES.length) out[COLUMN_NAMES[i]] = asColumnValue(body[field]);
  });
  return out;
}

/**
 * Read side: a caller's `{ field: value }` filter into the columns that hold them.
 *
 * An undeclared field is refused here rather than ignored. Ignoring it is the "the gate is
 * decorative" failure: the caller gets a plausible page back and believes it was filtered.
 */
export function columnsForWhere(
  space: RowSpace,
  where: Record<string, unknown> | undefined,
): Partial<RowColumns> {
  if (!where) return {};
  const out: Partial<RowColumns> = {};
  for (const [field, value] of Object.entries(where)) {
    if (value === undefined || value === null || value === '') continue;
    const at = space.indexOn.indexOf(field);
    if (at < 0) {
      throw new WorkspaceRowError('FIELD_NOT_INDEXED', 400,
        space.indexOn.length
          ? `"${space.name}" cannot be filtered by "${field}". The fields it indexes are: ${space.indexOn.join(', ')}. Everything else is inside the row and readable, but not searchable.`
          : `"${space.name}" indexes no fields, so it cannot be filtered. Add up to ${MAX_INDEX_ON} field names to the space's indexOn in the manifest.`);
    }
    out[COLUMN_NAMES[at]] = asColumnValue(value);
  }
  return out;
}
