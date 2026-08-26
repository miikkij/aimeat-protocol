/**
 * @file src/storage/types/workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Record types for a workspace ROW space: many rows a group accumulates, held as a
 *   table rather than as memory keys.
 *
 *   WHY A TABLE AND NOT MEMORY, in the four numbers that decided it. Memory is the person's own
 *   refined knowledge; these are rows a group accumulates, and four measurements say memory is the
 *   wrong shape for them:
 *     1. `organism.*` memory keys count against the MEMBER GHII who wrote them, so ten colleagues
 *        writing into one workspace draw on ten separate 1000-key budgets and their unrelated
 *        `user:` memories share the same ceiling. The group's data eats the individual's account.
 *     2. A versioned workspace record keeps 20 full copies, so 1000 rows is 20 000 keys.
 *     3. Memory has no partial read and no partial write: appending one item to an array is a whole
 *        1 MB read plus a whole 1 MB write, plus a full search reindex on both backends.
 *     4. The workspace index read materialises every value to derive titles and TRUNCATES AT 5000
 *        ROWS WITH NO SIGNAL.
 *   This is the case migration 0042 describes: the repo's default is to prefer a memory record over
 *   a new table, and here that default is wrong.
 *
 *   AND THE ANSWER TO 0036's OBJECTION ("a metric inside JSONB cannot be summed or ordered by in
 *   SQL") is `indexOn`: a space declares up to three fields in its manifest, they are denormalised
 *   into real columns, and filtering and ordering happen on those. A field that was not declared is
 *   readable but not searchable, and that is said out loud rather than discovered.
 *
 *   THREE TIMES, NOT ONE, because they are genuinely different questions and one column would force
 *   a choice whose wrongness only shows up months later:
 *     - `occurredAt` is when the thing happened in the world. A mail's own date, not our ingest.
 *       It is the search axis and the default order.
 *     - `createdAt` is when the row was written here. Retention keys on it, because a retention
 *       promise is about how long WE keep a row, not how old the event was.
 *     - `updatedAt` answers "what changed since I last looked", which is the only way an
 *        incremental sync is possible at all.
 * @structure
 *   - WorkspaceRowRecord   -- one row as stored
 *   - WorkspaceRowInput    -- what a caller appends
 *   - WorkspaceRowFilter   -- the paged, keyset-cursored read
 *   - WorkspaceRowPage     -- rows plus the cursor to continue with
 *   - WorkspaceRowStats    -- count, bytes and the time span, without reading a row
 *   - WorkspaceRowUsage    -- what a quota check needs
 * @usage import type { WorkspaceRowRecord } from '../storage/interface.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial: workspace row spaces (`backing: 'rows'`).
 */

/** How many declared index columns a row space may have. Three is the whole budget. */
export const WORKSPACE_ROW_INDEX_COLUMNS = 3;

/** One row as stored. */
export interface WorkspaceRowRecord {
  /** Surrogate key, unique across the table. Never shown to a caller. */
  id: string;
  organismId: string;
  wsId: string;
  /** The space's namespace, e.g. `crm.mail`. */
  namespace: string;
  /** Caller-visible id, unique within (organism, workspace, namespace). */
  rowId: string;
  /**
   * The declared index columns, in the order the manifest's `indexOn` names them. '' when the space
   * declared fewer than three, or when the row carried no value for that field — an absent value is
   * an empty string rather than null so a filter never has to reason about three-valued logic.
   */
  k1: string;
  k2: string;
  k3: string;
  /** When it happened in the world. Defaults to `createdAt` when the caller does not say. */
  occurredAt: string;
  /** When it was written here. */
  createdAt: string;
  /** When it was last changed here. Equals `createdAt` for a row never touched again. */
  updatedAt: string;
  /** The exact principal that wrote it (GHII / GAII / GEAI). */
  createdBy: string;
  /** The row itself. */
  body: Record<string, unknown>;
  /** Serialised size of `body`, so a quota check never has to re-measure. */
  bytes: number;
}

/** What a caller appends. Everything else the service settles. */
export interface WorkspaceRowInput {
  /** Omit and one is generated. Supplying it makes the append idempotent (last write wins). */
  rowId?: string;
  /** ISO 8601. Omit and it is the write time. */
  occurredAt?: string;
  body: Record<string, unknown>;
}

/**
 * Reading a row space.
 *
 * `k1`/`k2`/`k3` filter on the declared columns; the service translates the caller's FIELD NAMES
 * into positions, so a caller never has to know which slot a field landed in.
 */
export interface WorkspaceRowFilter {
  organismId: string;
  wsId: string;
  namespace: string;
  k1?: string;
  k2?: string;
  k3?: string;
  /** Inclusive bounds on `occurredAt`. */
  since?: string;
  until?: string;
  /** Exclusive lower bound on `updatedAt` — "what changed since I last looked". */
  changedSince?: string;
  limit?: number;
  /** Opaque keyset cursor from a previous page. */
  cursor?: string;
  /** Default 'desc': newest first, which is what every caller has wanted so far. */
  order?: 'asc' | 'desc';
}

/** One page of rows, and how to ask for the next. */
export interface WorkspaceRowPage {
  rows: WorkspaceRowRecord[];
  /** Null when this was the last page. */
  cursor: string | null;
}

/** What a space holds, answerable without reading a row. */
export interface WorkspaceRowStats {
  namespace: string;
  rows: number;
  bytes: number;
  /** Oldest and newest `occurredAt`. Null on an empty space. */
  oldest: string | null;
  newest: string | null;
  /** Newest `createdAt` — when anything last landed here. */
  lastWriteAt: string | null;
}

/** The two numbers a quota check needs, for whatever scope it asked about. */
export interface WorkspaceRowUsage {
  rows: number;
  bytes: number;
}

/** Which scope a usage question is about. `wsId` absent means the whole organism. */
export interface WorkspaceRowScope {
  organismId: string;
  wsId?: string;
}
