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
 *     2b. on a READ, the caller may read this workspace — decideWorkspaceRead, the SAME decision the
 *        records loader makes, because membership alone is discovery-only
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
 *   - sweepRevisions / listRowRevisions / restoreRowRevision
 * @usage const res = await appendRows(deps, caller, { organismId, wsId, space, rows });
 * @version-history
 *   2026-10-25 — An extension's marker comes from extensionMarker, so a name that carries its installer
 *     (`<owner>/<name>`) is compared as it is (owner namespaces wish, secaudit2026oct22).
 *   2026-10-22 — A replacement across writer families keeps the old content as a revision and the
 *     row's first author in createdBy, and names the new writer in updatedBy (row-revisions.ts);
 *     appendRows answers which rows it kept. listRowRevisions and restoreRowRevision give the delete
 *     authority the way back; deleteRow takes a row's revisions with it. No new refusal: an agent
 *     without memory:purge re-appended under another member's rowId and removed that content for
 *     good (secaudit 2026-10, v80; developer ruling 2026-10-22).
 *   2026-10-20 — A read on the member path and the app path meets decideWorkspaceRead, the decision
 *     the records loader makes (services/workspace-access.ts). A plain member with no workspace
 *     grant read every row of a workspace whose records path gave them nothing, because
 *     checkOrganismNamespaceAccess in read mode is membership alone for a person signed in as
 *     themselves (secaudit 2026-10, row-read-skips-decideWorkspaceRead). Writes keep the namespace
 *     rule they had.
 *   2026-10-15 — enforceQuota is exported: a workspace import checks the quotas for the rows it
 *     restores before it writes anything (services/workspace-transfer-rows.ts; feature-list audit #68).
 *   v1.7.0 — 2026-10-13 — RowCaller carries the session's scopes and the member path hands them to
 *     the organism namespace rule, where the fenced-space rule reads them (a session that covers
 *     organism:direct writes under a record space that names extensions; ruled 2026-10-13).
 *   v1.6.0 — 2026-10-13 — appendRows emits one `rowsAppended` event per call (event-bus.ts), which
 *     a workflow's `workspace.rows` trigger starts from.
 *   v1.5.0 — 2026-10-08 — authorizeExtension + gate(): an extension caller (ctx.workspace.appendRows,
 *     readRows) reaches one row space by the two-hand rule (the space names the extension, the
 *     manifest declares workspace.rows, the installer holds an active membership), also when it
 *     runs on a schedule or a workflow step.
 *   v1.4.0 — 2026-09-29 — readRows and readRow take a classification reader, which every row read
 *     passes (TARGET-082).
 *   v1.3.0 — 2026-09-24 — A write on the app path meets the space's writeRole too, with the person's
 *     membership (secaudit 2026-09, A6-8). gate() returned after authorizeApp, so a plain member's
 *     app wrote a space kept to admins; the comment on authorizeApp that said the naming replaced the
 *     writeRole ladder now says the naming opens the space and the person's role still decides.
 *   v1.2.0 — 2026-09-24 — loadSpace reads the workspace creator's copy of the manifest, whatever the
 *     store's order (readWorkspaceManifest takes the node id; secaudit 2026-09, A6-9).
 *   v1.1.0 — 2026-08-29 — authorizeApp + gate(): a role-'app' caller reaches one row space by the
 *     two-hand rule (the space names the app, the person holds organism:rows and an active
 *     membership); every entry point goes through gate().
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type {
  Storage, WorkspaceRowRecord, WorkspaceRowStats, WorkspaceRowRevision,
} from '../../storage/interface.js';
import { checkOrganismNamespaceAccess } from '../organism-namespace-access.js';
import { decideWorkspaceRead } from '../workspace-access.js';
import { readWorkspaceManifest, isRowBackedSpace } from '../workspace-meta.js';
import { emitChange, emitRowsAppended } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { rowTarget } from '../classification/labels.js';
import { extensionMarker } from '../fenced-space.js';
import type { ContentReader } from '../classification/reader.js';
import {
  WorkspaceRowError, resolveRowSpace, columnsForBody, columnsForWhere, retentionOf,
  type RowSpace, type RowObjectType,
} from './row-space.js';
import {
  settleReplacements, lastWriterOf, revisionOf, revisionKeepDays, REVISIONS_PER_ROW,
} from './row-revisions.js';

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
  /**
   * For an extension writing through `ctx.workspace.appendRows`: its installed name. Set only by
   * services/extension-workspace.ts, never from a request, and `owner` is then the installer.
   */
  extension?: string;
  /**
   * The session's scope words, for the member path's access rule: the fenced-space rule
   * (services/fenced-space.ts) reads them when a row space lies under the namespace of a record
   * space that names extensions. Absent for an extension's row call, which holds no session.
   */
  scopes?: readonly string[];
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
  /**
   * The rowIds whose earlier content this call replaced across writer families, and which the node
   * kept as a revision (row-revisions.ts). Empty is the ordinary answer.
   */
  revisionsKept: string[];
}

/** A row's kept earlier content, as a caller sees it. */
export interface RowRevisionView {
  revisionId: string;
  rowId: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  body: Record<string, unknown>;
  bytes: number;
  replacedAt: string;
  replacedBy: string;
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
    { principal: caller.principal, owner: caller.owner, roles: caller.roles, scopes: caller.scopes },
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
 * before the call arrived. Not the consent machinery written for agents: the organism's naming is
 * what opens the space to the app, and it names one app for one space. The app appends and reads
 * THAT space; every other space, and every other write surface of the workspace, is closed to it as
 * before. Decided 2026-08-29 so an app can keep an append-only audit trail on the organism it
 * belongs to (the legal-pages demo).
 *
 * THE NAMING OPENS THE SPACE, IT RAISES NOBODY'S ROLE. An app acts for its person, so a write still
 * meets the space's writeRole with that person's membership (gate() below): a plain member's app is
 * refused a space kept to admins, exactly as the member is. This path used to stop here, and the
 * writeRole an organism set was no ceiling for an app (secaudit 2026-09, A6-8).
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

/**
 * The EXTENSION path: the same two hands as the app path, for a script that may run with nobody
 * present.
 *
 * A schedule or a workflow step runs an extension with no session, and the attended road's rule
 * (the extension acts as its caller) has no caller to act as. Lending it the installer's own
 * membership would put the owner's whole authority on a clock, which the scope guard on the
 * attended road exists to refuse. So an extension reaches a row space only when (1) the ORGANISM
 * named the extension in the space's `extensions` list as `installer/name`, (2) its manifest declared `workspace.rows`,
 * which services/extension-workspace.ts checked before the call arrived and the install approval
 * showed, and (3) its INSTALLER is an active member. It appends to and reads that space; every other
 * space, and every record and document surface, stays closed to it. Decided 2026-10-08 so an alert
 * ingest on a schedule can fill a SOC queue (aimeat-soc).
 */
async function authorizeExtension(
  deps: RowServiceDeps, caller: RowCaller, organismId: string, space: RowSpace,
): Promise<void> {
  // The installer is half of the name: an extension name is free again after an uninstall, and the
  // next member to take it must not inherit a space the organism opened to somebody else's code.
  const ext = (caller.extension ?? '').trim().toLowerCase();
  // extensionMarker: a name that already carries its installer (`<owner>/<name>`) is its own marker.
  const named = extensionMarker(caller.owner, ext);
  if (!ext || !space.extensions.includes(named)) {
    throw new WorkspaceRowError('ACCESS_DENIED', 403,
      `This space is not open to the extension ${ext ? named : '(unnamed)'}. An organism admin names the extensions a row space accepts in the manifest, as installer/name (objectTypes[].extensions).`);
  }
  const membership = await deps.storage.getMembership(organismId, caller.owner);
  if (!membership || membership.status !== 'active') {
    throw new WorkspaceRowError('ACCESS_DENIED', 403, 'The person who installed this extension is not an active member of this organism.');
  }
}

/**
 * A READ meets the workspace read decision, the same one the records loader makes.
 *
 * Membership opens the organism, not the workspace: the records path (services/workspace-access.ts
 * decideWorkspaceRead) asks on top of it whether the caller may read THIS workspace's manifest, as
 * its creator, as the same owner, as an organism manager, or on a viewer or contributor grant. Rows
 * asked only the namespace rule, which for a person signed in as themselves is active membership
 * alone, so a plain member read every row of a workspace whose records answered them with nothing
 * (secaudit 2026-10). One read, one decision, taken here.
 */
async function requireWorkspaceRead(
  deps: RowServiceDeps, caller: RowCaller, organismId: string, wsId: string,
): Promise<void> {
  const organism = await deps.storage.getOrganism(organismId);
  if (!organism) {
    throw new WorkspaceRowError('NOT_FOUND', 404, `No organism "${organismId}".`);
  }
  const decision = await decideWorkspaceRead(
    deps.storage, deps.config, organism, caller.principal, caller.owner, caller.identity, wsId,
  );
  if (!decision.canRead) {
    throw new WorkspaceRowError('ACCESS_DENIED', 403,
      'You may not read this workspace. Its creator, or an admin of this organism, gives you a viewer or contributor grant.');
  }
}

/**
 * Every entry point goes through here: the app path or the extension path when the caller is one,
 * else the member path. A read then meets the workspace read decision, and a write meets the space's
 * writeRole, with the membership of the person the caller is or acts for: an app or an extension is
 * never more than its person.
 *
 * The extension path and the app path do not meet the read decision, and that is deliberate. Each
 * reaches ONE space the organism's manifest names it in, which is a grant an organism admin wrote
 * on purpose, and an extension holds no session at all. The October 2026 audit reproduced the read
 * past the workspace gate on the MEMBER path only (a person signed in as themselves), so only that
 * path is closed here. Whether a named app should additionally need its person's workspace grant is
 * a question about the app model, open for the developer; closing it would stop an app a manifest
 * names from serving a member who holds no grant (test/e2e-app-rows.ts, case A6-8).
 */
async function gate(
  deps: RowServiceDeps, caller: RowCaller, organismId: string, wsId: string, space: RowSpace, mode: 'read' | 'write',
): Promise<void> {
  if (caller.extension !== undefined) {
    await authorizeExtension(deps, caller, organismId, space);
  } else if (caller.roles.includes('app')) {
    await authorizeApp(deps, caller, organismId, space);
  } else {
    await authorize(deps, caller, organismId, wsId, space.namespace, mode);
    if (mode === 'read') await requireWorkspaceRead(deps, caller, organismId, wsId);
  }
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
  const manifest = await readWorkspaceManifest(deps.storage, organismId, wsId, deps.config.nodeId);
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
    updatedBy: lastWriterOf(r),
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

  // Every gate has answered. A row this call replaces keeps its content as a revision when its last
  // writer is of another family, and keeps its first author (row-revisions.ts, ruled 2026-10-22).
  const revisionsKept = await settleReplacements(storage, caller.identity, deduped, now);

  await storage.appendWorkspaceRows(deduped);

  const pruned = await sweepRows(deps, organismId, wsId, space);
  await sweepRevisions(deps, organismId, wsId, space);

  emitChange('organisms', undefined);
  // One event for the whole call, after the insert: a workflow that starts on new rows starts once
  // for a batch of five hundred, and never for rows a gate above refused.
  emitRowsAppended({
    nodeId: config.nodeId, organismId, wsId, space: space.name, namespace: space.namespace,
    rowIds: deduped.map(r => r.rowId), createdBy: caller.identity,
  });
  return { written: deduped.length, rowIds: deduped.map(r => r.rowId), pruned, revisionsKept };
}

/**
 * The row count for this workspace and the byte quota for this organism, measured against what this
 * call would add.
 *
 * Both are counted BEFORE the insert. Counting after and rolling back would be the same number and a
 * worse failure: a caller whose write is undone learns nothing about which row was the one too many.
 */
export async function enforceQuota(
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

/**
 * Age a space's row revisions: older than the space's retention window or 30 days, belonging to a
 * row that is gone, or past the newest 20 of a row. Never throws, for the reason sweepRows does not.
 */
export async function sweepRevisions(
  deps: RowServiceDeps, organismId: string, wsId: string, space: RowSpace,
): Promise<void> {
  try {
    const before = new Date(Date.now() - revisionKeepDays(space.retention.maxDays) * 86_400_000).toISOString();
    await deps.storage.pruneWorkspaceRowRevisions(organismId, wsId, space.namespace, before, REVISIONS_PER_ROW);
  } catch (err) {
    logger.warn('workspace-rows: revision sweep failed, revisions kept', {
      organismId, wsId, namespace: space.namespace, error: String(err),
    });
  }
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
  /** The classification reader (TARGET-082): the loader takes one, so no read skips the check. */
  reader: ContentReader;
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

  // A row this reader may not see is not on the page. The cursor still names where the page ended.
  const shown = await input.reader.show(page.rows, r => rowTarget(input.organismId, input.wsId, space.name, r.id));
  return {
    space: space.name,
    namespace: space.namespace,
    rows: shown.map(publicRow),
    cursor: page.cursor,
    indexed: space.indexOn,
  };
}

export async function readRow(
  deps: RowServiceDeps, caller: RowCaller,
  organismId: string, wsId: string, spaceName: string, rowId: string, reader: ContentReader,
): Promise<ReadRowsResult['rows'][number]> {
  const space = await loadSpace(deps, organismId, wsId, spaceName);
  await gate(deps, caller, organismId, wsId, space, 'read');
  const stored = await deps.storage.getWorkspaceRow(organismId, wsId, space.namespace, rowId);
  // A row this reader may not see answers as an absent one.
  const [row] = stored ? await reader.show([stored], () => rowTarget(organismId, wsId, space.name, rowId)) : [];
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
  // The row's kept revisions go with it: the delete authority removed the row, and a removed row has
  // no history to come back from.
  await deps.storage.deleteWorkspaceRowRevisions(organismId, wsId, space.namespace, rowId);
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
  // The revisions of the rows removed here go with them (sweepRevisions drops a gone row's).
  if (removed) await sweepRevisions(deps, organismId, wsId, space);
  if (removed) emitChange('organisms', undefined);
  return removed;
}

/** What leaves the service for a revision. The surrogate id and the space address are ours. */
function publicRevision(v: WorkspaceRowRevision): RowRevisionView {
  return {
    revisionId: v.revisionId, rowId: v.rowId, occurredAt: v.occurredAt, createdAt: v.createdAt,
    updatedAt: v.updatedAt, createdBy: v.createdBy, updatedBy: v.updatedBy, body: v.body, bytes: v.bytes,
    replacedAt: v.replacedAt, replacedBy: v.replacedBy,
  };
}

/**
 * One row's kept earlier contents, newest replacement first (row-revisions.ts).
 *
 * WHO MAY LIST AND RESTORE is the delete authority: this service asks the write gate of the space,
 * and the REST routes and the MCP tools add memory:purge beside organism:write, the words the row
 * delete asks. The owner in person passes both. A revision passes the caller's classification reader
 * at the row's own address, as a row read does.
 */
export async function listRowRevisions(
  deps: RowServiceDeps, caller: RowCaller,
  organismId: string, wsId: string, spaceName: string, rowId: string, reader: ContentReader,
): Promise<{ space: string; rowId: string; revisions: RowRevisionView[] }> {
  const space = await loadSpace(deps, organismId, wsId, spaceName);
  await gate(deps, caller, organismId, wsId, space, 'write');
  const kept = await deps.storage.listWorkspaceRowRevisions(organismId, wsId, space.namespace, rowId);
  const shown = await reader.show(kept, v => rowTarget(organismId, wsId, space.name, v.id));
  return { space: space.name, rowId, revisions: shown.map(publicRevision) };
}

/**
 * Put a kept revision back as the row's content. The content the restore replaces is kept as a
 * revision in turn, whoever wrote it, so a restore can itself be undone. The row keeps its first
 * author in createdBy and names the restorer in updatedBy.
 */
export async function restoreRowRevision(
  deps: RowServiceDeps, caller: RowCaller,
  organismId: string, wsId: string, spaceName: string, rowId: string, revisionId: string, reader: ContentReader,
): Promise<{ rowId: string; restored: string; revisionKept: boolean }> {
  const { storage, config } = deps;
  const space = await loadSpace(deps, organismId, wsId, spaceName);
  await gate(deps, caller, organismId, wsId, space, 'write');
  const stored = await storage.getWorkspaceRowRevision(organismId, wsId, space.namespace, revisionId);
  const [rev] = stored && stored.rowId === rowId
    ? await reader.show([stored], v => rowTarget(organismId, wsId, space.name, v.id)) : [];
  if (!rev) {
    throw new WorkspaceRowError('NOT_FOUND', 404, `No kept revision "${revisionId}" of row "${rowId}" in ${space.name}.`);
  }
  const [current] = await storage.getWorkspaceRowsByIds(organismId, wsId, space.namespace, [rowId]);
  const now = new Date().toISOString();
  const record: WorkspaceRowRecord = {
    id: current?.id ?? rev.id, organismId, wsId, namespace: space.namespace, rowId,
    ...columnsForBody(space, rev.body),
    occurredAt: rev.occurredAt, createdAt: current?.createdAt ?? now, updatedAt: now,
    createdBy: current?.createdBy ?? rev.createdBy, updatedBy: caller.identity,
    body: rev.body, bytes: rev.bytes,
  };
  await enforceQuota(deps, organismId, wsId, [record]);
  if (current) await storage.appendWorkspaceRowRevisions([revisionOf(current, caller.identity, now)]);
  await storage.appendWorkspaceRows([record]);
  await sweepRevisions(deps, organismId, wsId, space);
  emitChange('organisms', undefined);
  emitRowsAppended({
    nodeId: config.nodeId, organismId, wsId, space: space.name, namespace: space.namespace,
    rowIds: [rowId], createdBy: caller.identity,
  });
  return { rowId, restored: revisionId, revisionKept: !!current };
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
