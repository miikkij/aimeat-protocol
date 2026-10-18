/**
 * @file src/services/workspace-records-delete-op.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Remove many records of one namespace as one operation: the batch delete route's body
 *   and ctx.workspace.deleteRecords (services/extension-workspace.ts). Moved unchanged out of
 *   services/workspace-tool-ops.ts when that file reached the line ceiling; it re-exports every name,
 *   so no importer changes.
 * @structure BATCH_DELETE_MAX · DeleteRecordsBatchArgs · DeleteRecordsBatchData · deleteRecordsBatchOp()
 * @usage
 *   const r = await deleteRecordsBatchOp(deps, caller, { organismId, ws, namespace, ids });
 * @version-history
 *   v1.1.0 — 2026-10-18 — A delete tells the workspace's live domain (services/event-bus.ts
 *     emitWorkspaceChange), so an open page of that workspace re-reads.
 *   v1.0.0 — 2026-10-16 — Moved from services/workspace-tool-ops.ts (max-file-lines), no behaviour change.
 */
import { checkDeleteGuard } from './write-guards.js';
import { isSameOwner } from '../utils/gaii.js';
import { emitChange, emitWorkspaceChange } from './event-bus.js';
import { updateOrganismStructure } from './structure-snapshot.js';
import { logger } from '../utils/logger.js';
import {
    refuse, denyReason, fencedOpRefusal,
    type WorkspaceOpsDeps, type WorkspaceOpsCaller, type WorkspaceOpResult,
} from './workspace-ops-caller.js';

/** At most this many ids per delete call. */
export const BATCH_DELETE_MAX = 2000;

const rootOf = (organismId: string, ws: string | undefined) => ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;

export interface DeleteRecordsBatchArgs { organismId: string; ws?: string; namespace: string; ids: unknown[] }

export interface DeleteRecordsBatchData {
    deleted: Array<{ id: string; keys: number }>;
    failed: Array<{ id: string; reason: string }>;
    rows_removed: number;
}

/**
 * Remove many records of one namespace as one operation: each record's family (bare, .draft,
 * .latest, .version.N) that the CALLER's own identity family owns goes into the deleted-memory bin in
 * one batch, restorable with aimeat_memory_restore for the node's grace period, as the single delete
 * aimeat_workspace_object_delete does. A member never removes another member's rows. An append-only
 * (create_only) namespace refuses the whole batch.
 */
export async function deleteRecordsBatchOp(
    deps: WorkspaceOpsDeps, caller: WorkspaceOpsCaller, args: DeleteRecordsBatchArgs,
): Promise<WorkspaceOpResult<DeleteRecordsBatchData>> {
    const { storage, config } = deps;
    const { organismId, ws, namespace } = args;
    if (typeof namespace !== 'string' || !namespace || !Array.isArray(args.ids) || args.ids.length === 0) {
        return refuse(400, 'INVALID_INPUT', 'namespace (string) and ids (non-empty array) are required');
    }
    if (args.ids.length > BATCH_DELETE_MAX) {
        return refuse(400, 'INVALID_INPUT', `At most ${BATCH_DELETE_MAX} ids per request`);
    }
    const deny = await denyReason(storage, caller, organismId); if (deny) return deny;

    const root = rootOf(organismId, ws);
    const callerId = caller.principal;
    const ids = args.ids.filter((x: unknown): x is string => typeof x === 'string' && !!x);
    if (ids.length === 0) return refuse(400, 'INVALID_INPUT', 'ids must hold at least one non-empty string');

    // A record space that names extensions takes a delete from a caller that is not a person only
    // through one of them (services/fenced-space.ts). The family a caller owns includes the rows
    // under its owner's name (isSameOwner below), so an agent removed the published copy of a
    // record the app's tool had written.
    if (ws) {
        const fenced = await fencedOpRefusal(deps, caller, organismId, ws, { keys: ids.map(x => `${root}.${namespace}.${x}`) });
        if (fenced) return fenced;
    }

    // Append-only guard ONCE (per-namespace policy): a create_only namespace refuses record deletion
    // on every path, so existing events can never be erased. If it is append-only, refuse the batch.
    const guard = await checkDeleteGuard(`${root}.${namespace}.${ids[0]}.latest`, storage);
    if (!guard.valid) {
        return refuse(409, 'WRITE_CONFLICT', guard.errors?.[0]?.message ?? 'namespace is append-only', { violations: guard.errors });
    }

    // A key's role suffix must be the RECORD itself (bare), its .draft/.latest, or a .version.N, never
    // a sibling instance (`${base}0`) or an unrelated child. Mirrors object_delete's per-row guard.
    const roleOk = (base: string, key: string): boolean => {
        const role = key === base ? '' : key.slice(base.length + 1);
        return role === '' || role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role);
    };

    const refs: { ownerGaii: string; key: string }[] = [];
    const deleted: { id: string; keys: number }[] = [];
    const failed: { id: string; reason: string }[] = [];
    // ONE value-free (ownerGaii, key) scan of the namespace: the delete needs only addresses. Falls
    // back to a value scan only on a backend without the key-only primitive.
    const nsPrefix = `${root}.${namespace}.`;
    const nsKeys = storage.listMemoryKeysByPrefix
        ? await storage.listMemoryKeysByPrefix(nsPrefix)
        : (await storage.listAllMemory({ prefix: nsPrefix, limit: 100000 })).items.map(r => ({ ownerGaii: r.ownerGaii, key: r.key }));
    const done = new Set<string>();
    for (const rid of ids) {
        if (done.has(rid)) continue;
        done.add(rid);
        const base = `${root}.${namespace}.${rid}`;
        const family = nsKeys.filter(r =>
            (r.key === base || r.key.startsWith(`${base}.`)) && roleOk(base, r.key)
            && (r.ownerGaii === callerId || isSameOwner(r.ownerGaii, callerId)));
        if (family.length === 0) { failed.push({ id: rid, reason: 'nothing to delete (or not owned by you)' }); continue; }
        for (const r of family) refs.push({ ownerGaii: r.ownerGaii, key: r.key });
        deleted.push({ id: rid, keys: family.length });
    }

    let removed = 0;
    if (refs.length) {
        if (storage.bulkBinMemory) removed = await storage.bulkBinMemory(refs, callerId);
        else for (const r of refs) { if (await storage.deleteMemory(r.ownerGaii, r.key, callerId)) removed++; }
    }
    if (removed > 0) {
        emitChange('organisms');
        if (ws) emitWorkspaceChange(organismId, ws);
        void updateOrganismStructure(storage, config, organismId, { event: `deleted ${deleted.length} record(s) in ${namespace}`, actor: callerId })
            .catch(err => { logger.warn('deleteRecordsBatchOp: timeline best-effort', { error: String(err) }); });
    }
    return { ok: true, data: { deleted, failed, rows_removed: removed } };
}
