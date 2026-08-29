/**
 * @file src/services/workspace-rows/row-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one implementation behind every door into a workspace row space: REST, MCP and
 *   the CLI dispatch all call these functions, so the access check, the quota gate and the retention
 *   sweep happen where they were written once.
 *
 *   THE ORDER OF THE GATES IS THE DESIGN, and it is the invariant "refuse before you write":
 *     1. the space is resolved from the manifest, and is really a row space
 *     2. the caller may touch this organism namespace at all (membership, role, consent) — the SAME
 *        rule the memory door runs, reached with the space's own address
 *     3. the space's writeRole
 *     4. every row is well-formed and inside the per-row size ceiling
 *     5. the workspace's row count and the organism's byte quota, measured against what this call
 *        would ADD
 *     6. only then the insert, and only then the retention sweep
 *   Nothing is written before every one of those has answered. Three defects in this repo's history
 *   were one shape: bytes written before the name was claimed, a paywall standing down before
 *   comparing the coordinate, a response sent before the work it announced.
 *
 *   THE QUOTA IS THE WORKSPACE'S AND THE ORGANISM'S, NEVER THE WRITER'S. That asymmetry is the
 *   reason this backing exists: an `organism.*` memory key counts against the member who wrote it,
 *   so a shared workspace's rows eat one person's personal budget. Here the row belongs to the
 *   group, `createdBy` records who wrote it, and nobody is charged for their colleagues' work.
 * @structure
 *   - RowCaller / RowServiceDeps
 *   - appendRows / readRows / readRow / deleteRow / sweepRows / spaceStats / workspaceRowIndex
 * @usage const res = await appendRows(deps, caller, { organismId, wsId, space, rows });
 * @version-history
 *   v1.1.0 — 2026-08-29 — authorizeApp + gate(): a role-'app' caller reaches one row space by the
 *     two-hand rule (the space names the app, the person holds organism:rows and an active
 *     membership); every entry point goes through gate().
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type {
  Storage, WorkspaceRowRecord, WorkspaceRowStats,
} from '../../storage/interface.js';
import { checkOrganismNamespaceAccess } from '../organism-namespace-access.js';
import { readWorkspaceManifest, isRowBackedSpace } from '../workspace-meta.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import {
  WorkspaceRowError, resolveRowSpace, columnsForBody, columnsForWhere, retentionOf,
  type RowSpace, type RowObjectType,
} from './row-space.js';

export { WorkspaceRowError } from './row-space.js';

/** How many rows one call may append. Past this the caller batches, the way every bulk door here does. */
export const MAX_APPEND_BATCH = 500;

/**
 * The session asking.
 *
 * TWO PRINCIPAL FIELDS, AND THEY ARE NOT INTERCHANGEABLE. `principal` is the raw session subject,
 * because that is exactly what the memory door hands the shared access rule, and a gate fed a
 * different value than the gate it is supposed to match is a gate that has quietly diverged.
 * `identity` is the resolved one (`resolveIdentity`), because that is what gets STORED: an owner
 * session's `sub` is a bare name, and a bare name in `createdBy` is a row nobody can attribute
 * later.
 */
export interface RowCaller {
  principal: string;
  identity: string;
  owner: string;
  roles: string[];
  /** For a role-'app' session: the app's own id, `owner/filename`, from the grant's `app` claim. */
  app?: string;
}

export interface RowServiceDeps {
  storage: Storage;
  config: AimeatConfig;
}

export interface AppendRowsResult {
  written: number;
  rowIds: string[];
  /** What the retention sweep removed on the way out. Zero is the ordinary answer. */
  pruned: number;
}

export interface ReadRowsResult {
  space: string;
  namespace: string;
  rows: Array<Omit<WorkspaceRowRecord, 'id' | 'k1' | 'k2' | 'k3' | 'organismId' | 'wsId'>>;
  cursor: string | null;
  /** The fields this space can be filtered by, so a caller learns it from the answer. */
  indexed: string[];
}

/**
 * The address the access rule decides on.
 *
 * A row is not a memory key, but WHO MAY TOUCH IT is exactly the same question, and answering it
 * twice is how one door ends up more permissive than the other. So the space's own address is
 * assembled in the memory key's shape and handed to the same rule. The trailing segment is there
 * because that rule's workspace regex requires one.
 */
function gateKey(organismId: string, wsId: string, namespace: string): string {
  return `organism.${organismId}.w.${wsId}.${namespace}.rows`;
}

/** Membership, role and consent, decided by the shared rule rather than by a second copy of it. */
async function authorize(
  deps: RowServiceDeps, caller: RowCaller,
  organismId: string, wsId: string, namespace: string, mode: 'read' | 'write',
): Promise<void> {
  const refusal = await checkOrganismNamespaceAccess(
    deps,
    { principal: caller.principal, owner: caller.owner, roles: caller.roles },
    gateKey(organismId, wsId, namespace), mode,
  );
  if (refusal) throw new WorkspaceRowError(refusal.code, refusal.status, refusal.message);
}

/**
 * The APP path: two hands, or neither.
 *
 * An app running in a person's browser holds an app grant (role 'app'), not a membership, and the
 * organism's data is not the person's to open with a click. So a role-'app' caller reaches a row
 * space only when (1) the ORGANISM named the app in the space's `apps` list, (2) the PERSON the app
 * acts for is an active member, and (3) the grant carries `organism:rows`, which the route checked
 * before the call arrived. Nothing else on this path: not the consent machinery written for
 * agents, not the writeRole ladder — the organism's naming IS the consent, and it names one app
 * for one space. The app appends and reads THAT space; every other space, and every other write
 * surface of the workspace, is closed to it as before. Decided 2026-08-29 so an app can keep an
 * append-only audit trail on the organism it belongs to (the legal-pages demo).
 */
async function authorizeApp(
  deps: RowServiceDeps, caller: RowCaller, organismId: string, space: RowSpace,
): Promise<void> {
  const app = (caller.app ?? '').trim().toLowerCase();
  if (!app || !space.apps.includes(app)) {
    throw new WorkspaceRowError('ACCESS_DENIED', 403,
      `This space is not open to ${app ? `the app ${app}` : 'apps'}. An organism admin names the apps a row space accepts in the manifest (objectTypes[].apps).`);
  }
  const membership = await deps.storage.getMembership(organismId, caller.owner);
  if (!membership || membership.status !== 'active') {
    throw new WorkspaceRowError('ACCESS_DENIED', 403, 'The person this app acts for is not an active member of this organism.');
  }
}

/** Every entry point goes through here: the app path when the caller is one, else the member path. */
async function gate(
  deps: RowServiceDeps, caller: RowCaller, organismId: string, wsId: string, space: RowSpace, mode: 'read' | 'write',
): Promise<void> {
  if (caller.roles.includes('app')) {
    await authorizeApp(deps, caller, organismId, space);
    return;
  }
  await authorize(deps, caller, organismId, wsId, space.namespace, mode);
  if (mode === 'write') await requireWriteRole(deps, caller, organismId, space);
}

/** The space's own writeRole, on top of membership. Read is every member's. */
async function requireWriteRole(
  deps: RowServiceDeps, caller: RowCaller, organismId: string, space: RowSpace,
): Promise<void> {
  if (space.writeRole === 'member') return;
  const membership = await deps.storage.getMembership(organismId, caller.owner);
  const role = membership?.status === 'active' ? membership.role : null;
  const ok = space.writeRole === 'admin'
    ? role === 'admin' || role === 'creator'
    : role === 'creator';
  if (!ok) {
    throw new WorkspaceRowError('ACCESS_DENIED', 403,
      `Writing to "${space.name}" is limited to ${space.writeRole === 'admin' ? 'an admin or the creator' : 'the creator'} of this organism.`);
  }
}

/** Resolve the space, or say why not, from the manifest every surface reads the same way. */
async function loadSpace(
  deps: RowServiceDeps, organismId: string, wsId: string, space: string,
): Promise<RowSpace> {
  const manifest = await readWorkspaceManifest(deps.storage, organismId, wsId);
  if (!manifest) {
    throw new WorkspaceRowError('WS_NOT_FOUND', 404,
      `No manifest for workspace ${wsId} — an empty workspace, the wrong id, or no access to it.`);
  }
  return resolveRowSpace(manifest.objectTypes as RowObjectType[] | undefined, space);
}

/** What leaves the service. The surrogate id and the column positions are ours, not the caller's. */
function publicRow(r: WorkspaceRowRecord): ReadRowsResult['rows'][number] {
  return {
    namespace: r.namespace,
    rowId: r.rowId,
    occurredAt: r.occurredAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    body: r.body,
    bytes: r.bytes,
  };
}

/** ISO 8601, or a refusal naming the field. A silently-corrected date is a wrong answer later. */
function isoOr(value: unknown, field: string, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new WorkspaceRowError('INVALID_ROW', 400, `${field} must be an ISO 8601 timestamp string.`);
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) {
    throw new WorkspaceRowError('INVALID_ROW', 400, `${field} is not a date this node can read: "${value}". Use ISO 8601, e.g. 2026-08-26T09:15:00Z.`);
  }
  return new Date(t).toISOString();
}

export interface AppendRowsInput {
  organismId: string;
  wsId: string;
  space: string;
  rows: Array<{ rowId?: unknown; occurredAt?: unknown; body?: unknown }>;
}

/** Append rows, then apply the space's retention. Every gate above runs first, in order. */
export async function appendRows(
  deps: RowServiceDeps, caller: RowCaller, input: AppendRowsInput,
): Promise<AppendRowsResult> {
  const { storage, config } = deps;
  const { organismId, wsId } = input;

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new WorkspaceRowError('NO_ROWS', 400, 'Pass at least one row to append.');
  }
  if (input.rows.length > MAX_APPEND_BATCH) {
    throw new WorkspaceRowError('BATCH_TOO_LARGE', 400,
      `${input.rows.length} rows in one call; the cap is ${MAX_APPEND_BATCH}. Send them in batches of ${MAX_APPEND_BATCH}.`);
  }

  const space = await loadSpace(deps, organismId, wsId, input.space);
  await gate(deps, caller, organismId, wsId, space, 'write');

  const now = new Date().toISOString();
  const maxRowBytes = config.wsRowsMaxRowKb * 1024;

  const records: WorkspaceRowRecord[] = input.rows.map((raw, i) => {
    const body = raw.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new WorkspaceRowError('INVALID_ROW', 400, `rows[${i}] needs a \`body\` object.`);
    }
    const bodyObj = body as Record<string, unknown>;
    const bytes = Buffer.byteLength(JSON.stringify(bodyObj), 'utf8');
    if (bytes > maxRowBytes) {
      throw new WorkspaceRowError('ROW_TOO_LARGE', 413,
        `rows[${i}] is ${bytes} bytes and the limit for one row is ${maxRowBytes}. A row is a row: something this size is a document, and it belongs in a memory record or the file store with the row pointing at it.`);
    }
    const rowId = typeof raw.rowId === 'string' && raw.rowId.trim()
      ? raw.rowId.trim()
      : randomUUID();
    if (rowId.length > 200) {
      throw new WorkspaceRowError('INVALID_ROW', 400, `rows[${i}].rowId is longer than 200 characters.`);
    }
    const occurredAt = isoOr(raw.occurredAt, `rows[${i}].occurredAt`, now);
    return {
      id: randomUUID(),
      organismId, wsId, namespace: space.namespace, rowId,
      ...columnsForBody(space, bodyObj),
      occurredAt, createdAt: now, updatedAt: now,
      createdBy: caller.identity,
      body: bodyObj,
      bytes,
    };
  });

  // A repeated rowId inside ONE call would make the added-count a guess, and on Postgres a single
  // statement cannot update the same row twice. Last one wins, which matches what the store does
  // across calls.
  const deduped = [...new Map(records.map(r => [r.rowId, r])).values()];

  await enforceQuota(deps, organismId, wsId, deduped);

  await storage.appendWorkspaceRows(deduped);

  const pruned = await sweepRows(deps, organismId, wsId, space);

  emitChange('organisms', undefined);
  return { written: deduped.length, rowIds: deduped.map(r => r.rowId), pruned };
}

/**
 * The row count for this workspace and the byte quota for this organism, measured against what this
 * call would add.
 *
 * Both are counted BEFORE the insert. Counting after and rolling back would be the same number and a
 * worse failure: a caller whose write is undone learns nothing about which row was the one too many.
 */
async function enforceQuota(
  deps: RowServiceDeps, organismId: string, wsId: string, rows: WorkspaceRowRecord[],
): Promise<void> {
  const { storage, config } = deps;
  const adding = rows.reduce((n, r) => n + r.bytes, 0);

  const wsUsage = await storage.workspaceRowUsage({ organismId, wsId });
  if (wsUsage.rows + rows.length > config.wsRowsMaxPerWorkspace) {
    throw new WorkspaceRowError('QUOTA_EXCEEDED', 413,
      `This workspace holds ${wsUsage.rows} rows and the limit is ${config.wsRowsMaxPerWorkspace}. Give the space a retention window (maxRows or maxDays in the manifest) so it prunes itself, or ask the operator to raise quota.ws_rows_max_per_workspace.`);
  }

  const orgUsage = await storage.workspaceRowUsage({ organismId });
  const quotaBytes = config.wsRowsQuotaMb * 1024 * 1024;
  if (orgUsage.bytes + adding > quotaBytes) {
    throw new WorkspaceRowError('QUOTA_EXCEEDED', 413,
      `This organism's row spaces hold ${orgUsage.bytes} bytes and the quota is ${quotaBytes}. Give the growing space a retention window, or ask the operator to raise quota.ws_rows_quota_mb.`);
  }
}

/**
 * Apply a space's declared retention. Never throws: a sweep that fails must not undo an append that
 * succeeded, the same contract the workspace version prune already keeps.
 */
export async function sweepRows(
  deps: RowServiceDeps, organismId: string, wsId: string, space: RowSpace,
): Promise<number> {
  const { maxRows, maxDays } = space.retention;
  if (!maxRows && !maxDays) return 0;
  let pruned = 0;
  try {
    if (maxDays) {
      // createdAt, not occurredAt: the promise is about how long WE keep a row, so a five-year-old
      // message ingested today survives its first night.
      const before = new Date(Date.now() - maxDays * 86_400_000).toISOString();
      pruned += await deps.storage.deleteWorkspaceRowsBefore(organismId, wsId, space.namespace, before);
    }
    if (maxRows) {
      pruned += await deps.storage.trimWorkspaceRows(organismId, wsId, space.namespace, maxRows);
    }
  } catch (err) {
    logger.warn('workspace-rows: retention sweep failed, rows kept', {
      organismId, wsId, namespace: space.namespace, error: String(err),
    });
  }
  return pruned;
}

export interface ReadRowsInput {
  organismId: string;
  wsId: string;
  space: string;
  where?: Record<string, unknown>;
  since?: string;
  until?: string;
  changedSince?: string;
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}

export async function readRows(
  deps: RowServiceDeps, caller: RowCaller, input: ReadRowsInput,
): Promise<ReadRowsResult> {
  const space = await loadSpace(deps, input.organismId, input.wsId, input.space);
  await gate(deps, caller, input.organismId, input.wsId, space, 'read');

  const cols = columnsForWhere(space, input.where);
  const page = await deps.storage.listWorkspaceRows({
    organismId: input.organismId,
    wsId: input.wsId,
    namespace: space.namespace,
    ...cols,
    ...(input.since ? { since: isoOr(input.since, 'since', input.since) } : {}),
    ...(input.until ? { until: isoOr(input.until, 'until', input.until) } : {}),
    ...(input.changedSince ? { changedSince: isoOr(input.changedSince, 'changed_since', input.changedSince) } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.order ? { order: input.order } : {}),
  });

  return {
    space: space.name,
    namespace: space.namespace,
    rows: page.rows.map(publicRow),
    cursor: page.cursor,
    indexed: space.indexOn,
  };
}

export async function readRow(
  deps: RowServiceDeps, caller: RowCaller,
  organismId: string, wsId: string, spaceName: string, rowId: string,
): Promise<ReadRowsResult['rows'][number]> {
  const space = await loadSpace(deps, organismId, wsId, spaceName);
  await gate(deps, caller, organismId, wsId, space, 'read');
  const row = await deps.storage.getWorkspaceRow(organismId, wsId, space.namespace, rowId);
  if (!row) {
    throw new WorkspaceRowError('NOT_FOUND', 404, `No row "${rowId}" in ${space.name}.`);
  }
  return publicRow(row);
}

export async function deleteRow(
  deps: RowServiceDeps, caller: RowCaller,
  organismId: string, wsId: string, spaceName: string, rowId: string,
): Promise<void> {
  const space = await loadSpace(deps, organismId, wsId, spaceName);
  await gate(deps, caller, organismId, wsId, space, 'write');
  const removed = await deps.storage.deleteWorkspaceRow(organismId, wsId, space.namespace, rowId);
  if (!removed) {
    throw new WorkspaceRowError('NOT_FOUND', 404, `No row "${rowId}" in ${space.name}.`);
  }
  emitChange('organisms', undefined);
}

export async function deleteRowsBefore(
  deps: RowServiceDeps, caller: RowCaller,
  organismId: string, wsId: string, spaceName: string, before: string,
): Promise<number> {
  const space = await loadSpace(deps, organismId, wsId, spaceName);
  await gate(deps, caller, organismId, wsId, space, 'write');
  const cutoff = isoOr(before, 'before', '');
  if (!cutoff) {
    throw new WorkspaceRowError('INVALID_ROW', 400, 'Name the cutoff as an ISO 8601 timestamp in `before`.');
  }
  const removed = await deps.storage.deleteWorkspaceRowsBefore(organismId, wsId, space.namespace, cutoff);
  if (removed) emitChange('organisms', undefined);
  return removed;
}

export async function spaceStats(
  deps: RowServiceDeps, caller: RowCaller,
  organismId: string, wsId: string, spaceName: string,
): Promise<WorkspaceRowStats> {
  const space = await loadSpace(deps, organismId, wsId, spaceName);
  await gate(deps, caller, organismId, wsId, space, 'read');
  const [stats] = await deps.storage.workspaceRowStats(organismId, wsId, space.namespace);
  return stats ?? {
    namespace: space.namespace, rows: 0, bytes: 0, oldest: null, newest: null, lastWriteAt: null,
  };
}

/**
 * What a workspace INDEX shows for its row spaces: a count and a last-write, never the rows.
 *
 * This is the property the whole backing exists for. The memory-backed index materialises every
 * value to derive a title and truncates at 5000 with no signal; a row space answers the same
 * question with one aggregate, and stays honest at any size.
 */
export async function workspaceRowIndex(
  deps: RowServiceDeps, organismId: string, wsId: string,
  objectTypes: RowObjectType[] | undefined,
): Promise<Record<string, WorkspaceRowStats>> {
  const spaces = (objectTypes ?? []).filter(isRowBackedSpace);
  if (!spaces.length) return {};
  const stats = await deps.storage.workspaceRowStats(organismId, wsId);
  const byNamespace = new Map(stats.map(s => [s.namespace, s]));
  const out: Record<string, WorkspaceRowStats> = {};
  for (const ot of spaces) {
    const ns = (ot.namespace ?? ot.name) as string | undefined;
    if (!ns) continue;
    const name = (ot.name ?? ns) as string;
    out[name] = byNamespace.get(ns) ?? {
      namespace: ns, rows: 0, bytes: 0, oldest: null, newest: null, lastWriteAt: null,
    };
  }
  return out;
}

/** Re-exported so a caller can normalise a manifest's retention without importing two modules. */
export { retentionOf };
