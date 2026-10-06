/**
 * @file src/services/workspace-batch-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two batch operations on workspace records, publish many and delete many, as plain
 *   functions that take a CALLER and return a verdict, so the REST routes and the extension sandbox
 *   run the same code.
 *
 *   WHY THIS FILE EXISTS. POST /v1/organisms/:id/workspace/records/publish and .../records/delete
 *   held their whole body in the route: membership, the meta.* role, the archive flag, the publish
 *   review gate, the append-only guard, the decision-log entry. An extension that brings 500 contacts
 *   into a CRM through its app tool could not reach either, and `ctx.workspace.write` + `publish`
 *   cost two host calls per record against a ceiling of 500 calls and 5 seconds, so the import could
 *   not fit. The bodies moved here unchanged in what they check, and both routes and
 *   `ctx.workspace.publishRecords` / `deleteRecords` (services/extension-workspace.ts) call them.
 *
 *   The verdict has the shape services/workspace-tool-ops.ts uses: `{ ok: true, data }` or
 *   `{ ok: false, status, code, message }`. A refusal here refuses the WHOLE batch; a record that
 *   fails on its own (schema, create-only, version, repeated id) fails alone and is named in
 *   `results`, and the others are published.
 * @structure
 *   - publishRecordsBatchOp() — publish up to 1000 records in one namespace (drafts or direct values)
 *   - deleteRecordsBatchOp() — remove up to 2000 record families the caller owns in one namespace
 *   - BATCH_PUBLISH_MAX / BATCH_DELETE_MAX — the per-call ceilings both routes and the sandbox share
 * @usage
 *   const caller = workspaceCallerOf({ principal, ownerName, roles }, config);
 *   const r = await publishRecordsBatchOp({ storage, config }, caller, { organismId, ws, namespace, records, dryRun: true });
 *   if (!r.ok) return res.status(r.status).json(error(nodeId, r.code, r.message, r.status, r.details));
 * @version-history
 *   v1.0.0 — 2026-10-06 — Moved from routes/organisms/gates.ts (batch publish) and
 *     routes/organisms/workspace-ops.ts (batch delete) for ctx.workspace.publishRecords and
 *     deleteRecords. New on the way: `dryRun`, `createOnly`, an expected version held in every space,
 *     a repeated id refused, a record without an id or with an unknown visibility named in `results`
 *     where the route skipped it, a node provenance stamp for each record when the caller is an
 *     extension, and direct values checked by checkOrganismNamespaceAccess as a draft write is (the
 *     route had skipped the contributor grant). Wish bulk-records-for-ai, 2026-10-06.
 */
import type { AiProvenanceRecordRow, MemoryRecord } from '../storage/interface.js';
import { createOrganismHelpers, canWriteNamespaceRule, readOrganismConfig, type BatchPublishItemResult } from '../routes/organisms/shared.js';
import { denyReason, memberRoleOf, type WorkspaceOpsDeps, type WorkspaceOpsCaller, type WorkspaceOpResult, type WorkspaceOpRefusal } from './workspace-tool-ops.js';
import { archivedRefusal } from './workspace-write-guards.js';
import { checkDeleteGuard } from './write-guards.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';
import { stampAutonomousOutput } from './ai-provenance.js';
import type { AiProvenanceLevel, AiProvenanceMethod } from '../models/ai-provenance-schemas.js';
import { memoryContentBytes } from '../routes/memory/shared.js';
import { isSameOwner } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';
import { updateOrganismStructure } from './structure-snapshot.js';
import { logger } from '../utils/logger.js';

/** At most this many records per publish call. */
export const BATCH_PUBLISH_MAX = 1000;
/** At most this many ids per delete call. */
export const BATCH_DELETE_MAX = 2000;

const VISIBILITIES = new Set(['private', 'owner', 'group', 'members', 'public', 'workspace']);

const refuse = (status: number, code: string, message: string, details?: Record<string, unknown>): WorkspaceOpRefusal =>
    ({ ok: false, status, code, message, ...(details ? { details } : {}) });

const rootOf = (organismId: string, ws: string | undefined) => ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`;

export interface PublishRecordsBatchArgs {
    organismId: string;
    /** The workspace; absent means the organism's own records (the route has always allowed that). */
    ws?: string;
    namespace: string;
    /** Direct values: publish these, no draft is read or consumed. */
    records?: unknown[];
    /** Draft ids: publish each record's existing draft. Ignored when `records` is given. */
    instances?: unknown[];
    /** id → the version the caller read. 0 means the record must not exist yet; null names nothing. */
    expectedVersions?: Record<string, number | null>;
    /** Refuse an id that already has a published version. */
    createOnly?: boolean;
    /** Decide every record and write nothing. */
    dryRun?: boolean;
    /**
     * The node's own statement for each direct value, made when a SCRIPT produced the bytes (the
     * extension sandbox). Absent on the REST route, which writes what the caller sent as before.
     */
    nodeStamp?: { pipeline: string; level?: AiProvenanceLevel; method?: AiProvenanceMethod };
}

export interface PublishRecordsBatchData {
    published: number;
    skipped: number;
    failed: number;
    results: BatchPublishItemResult[];
    dry_run?: true;
}

/**
 * Publish many records of one namespace as one operation: the batch route's body, behind the same
 * checks in the same order (input, membership, the meta.* role, archive, the publish review gate),
 * then publishDraftsBatch's one bulk write and one decision-log entry.
 */
export async function publishRecordsBatchOp(
    deps: WorkspaceOpsDeps, caller: WorkspaceOpsCaller, args: PublishRecordsBatchArgs,
): Promise<WorkspaceOpResult<PublishRecordsBatchData>> {
    const { storage, config } = deps;
    const { organismId, ws, namespace } = args;
    const useRecords = Array.isArray(args.records) && args.records.length > 0;
    const list: unknown[] = useRecords ? args.records! : (Array.isArray(args.instances) ? args.instances : []);
    if (typeof namespace !== 'string' || !namespace || list.length === 0) {
        return refuse(400, 'INVALID_INPUT', 'namespace (string) and instances[] or records[] (non-empty) are required');
    }
    if (list.length > BATCH_PUBLISH_MAX) {
        return refuse(400, 'INVALID_INPUT', `At most ${BATCH_PUBLISH_MAX} records per request; this one has ${list.length}. Send the rest in a second call.`);
    }
    const deny = await denyReason(storage, caller, organismId); if (deny) return deny;
    const role = await memberRoleOf(storage, caller, organismId);
    if (!role || !canWriteNamespaceRule(role, namespace)) {
        return refuse(403, 'ACCESS_DENIED', 'Only an admin or whoever created this space can publish here. Ask one of them, or publish somewhere you own.');
    }
    const archived = await archivedRefusal(storage, `${rootOf(organismId, ws)}.`);
    if (archived) return refuse(409, 'ARCHIVED', archived);
    // Direct values are a WRITE of new bytes, so they get the rule every draft write gets: an agent or
    // app token of a member who did not create the workspace needs the creator's contributor grant.
    // The route skipped this until 2026-10-06, so a token without the grant could publish a batch
    // where it could not write one draft. A draft publish (instances) publishes what was already
    // written under that rule, as the single publish does.
    // The rule depends on the workspace and the namespace, never on the instance, so one record's key
    // decides it for the whole batch.
    const firstId = useRecords ? (list.find(r => typeof (r as { id?: unknown } | null)?.id === 'string') as { id: string } | undefined)?.id : undefined;
    if (firstId) {
        const access = await checkOrganismNamespaceAccess({ storage, config },
            { principal: caller.principal, owner: caller.ownerName, roles: caller.roles },
            `${rootOf(organismId, ws)}.${namespace}.${firstId}`, 'write');
        if (access) return refuse(access.status, access.code, access.message);
    }
    // The publish review gate is one approval per record (POST /v1/organisms/:id/publish files it on
    // the record's draft). A batch of direct values has no drafts to approve, so it is refused whole,
    // and the refusal says what does work.
    const cfg = await readOrganismConfig(storage, organismId);
    if ((cfg as { gates?: { publish?: { enabled?: boolean } } } | null)?.gates?.publish?.enabled === true) {
        return refuse(409, 'GATE_ENABLED',
            'This organism reviews every publish (the publish gate is on), and a batch cannot wait for review. '
            + 'Write the records as drafts (POST /v1/organisms/:id/workspace/drafts with items[], or ctx.workspace.write) '
            + 'so a reviewer publishes them, or ask an organism admin to turn the publish gate off for the import.');
    }

    const H = createOrganismHelpers(config, storage);
    const publisher = caller.principal;
    const early: BatchPublishItemResult[] = [];
    let ids: string[];
    let directValues: Record<string, { value: unknown; visibility?: MemoryRecord['visibility']; aiProvenanceId?: string }> | undefined;
    // Held per id: a record's provenance is stored only if that record is written.
    const heldById = new Map<string, AiProvenanceRecordRow[]>();
    if (useRecords) {
        directValues = {};
        ids = [];
        for (let i = 0; i < list.length; i++) {
            const r = list[i] as { id?: unknown; value?: unknown; visibility?: unknown } | null;
            if (!r || typeof r.id !== 'string' || !r.id) {
                early.push({ instance: `#${i}`, ok: false, code: 'INVALID', violations: [{ message: `records[${i}] has no id (a non-empty string)`, path: `/records/${i}/id` }] });
                continue;
            }
            if (r.visibility !== undefined && (typeof r.visibility !== 'string' || !VISIBILITIES.has(r.visibility))) {
                early.push({ instance: r.id, ok: false, code: 'INVALID', violations: [{ message: `visibility must be one of ${[...VISIBILITIES].join(', ')}`, path: `/records/${i}/visibility` }] });
                continue;
            }
            const visibility = r.visibility as MemoryRecord['visibility'] | undefined;
            ids.push(r.id);
            // A later duplicate keeps the first value; publishDraftsBatch refuses the repeat.
            if (directValues[r.id]) continue;
            let aiProvenanceId: string | undefined;
            if (args.nodeStamp && !args.dryRun) {
                const held: AiProvenanceRecordRow[] = [];
                aiProvenanceId = await stampAutonomousOutput(storage, {
                    principal: publisher, content: memoryContentBytes(r.value),
                    level: args.nodeStamp.level, method: args.nodeStamp.method, pipeline: args.nodeStamp.pipeline,
                    surface: { visibility: visibility ?? 'owner', humanAudience: true },
                    labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl,
                    enabled: config.aiProvenance, held,
                });
                heldById.set(r.id, held);
            }
            directValues[r.id] = { value: r.value, visibility, ...(aiProvenanceId ? { aiProvenanceId } : {}) };
        }
    } else {
        ids = list.filter((x): x is string => typeof x === 'string' && !!x);
    }

    const expMap = args.expectedVersions && typeof args.expectedVersions === 'object' ? args.expectedVersions : undefined;
    const { results: decided, refusal } = ids.length
        ? await H.publishDraftsBatch(organismId, ws, namespace, ids, publisher, expMap, directValues, { createOnly: args.createOnly === true, dryRun: args.dryRun === true })
        : { results: [] as BatchPublishItemResult[], refusal: undefined };
    // The whole batch is one namespace, so a space the manifest does not declare refuses all of it.
    if (refusal) return refusal;
    const results = [...early, ...decided];
    const published = decided.filter(r => r.ok && !r.skipped);
    const data: PublishRecordsBatchData = {
        published: published.length,
        skipped: results.filter(r => r.ok && r.skipped).length,
        failed: results.filter(r => !r.ok).length,
        results,
    };
    if (args.dryRun) return { ok: true, data: { ...data, dry_run: true } };

    for (const r of published) {
        const held = heldById.get(r.instance);
        if (held) for (const row of held.splice(0)) await storage.createAiProvenance(row);
    }
    if (published.length > 0) {
        await H.writeDecision(organismId, publisher, `published ${published.length} record(s) in ${namespace}`, published.map(r => `${namespace}.${r.instance}`));
        emitChange('organisms');
        void updateOrganismStructure(storage, config, organismId, { event: 'content published (batch)', actor: publisher })
            .catch(err => { logger.warn('publishRecordsBatchOp: timeline best-effort', { error: String(err) }); });
    }
    return { ok: true, data };
}

export interface DeleteRecordsBatchArgs { organismId: string; ws?: string; namespace: string; ids: unknown[] }

export interface DeleteRecordsBatchData {
    deleted: Array<{ id: string; keys: number }>;
    failed: Array<{ id: string; reason: string }>;
    rows_removed: number;
}

/**
 * Remove many records of one namespace as one operation: each record's family (bare, .draft,
 * .latest, .version.N) that the CALLER's own identity family owns, in one batched delete. A member
 * never removes another member's rows. An append-only (create_only) namespace refuses the whole batch.
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
        if (storage.bulkDeleteMemory) removed = await storage.bulkDeleteMemory(refs);
        else for (const r of refs) { if (await storage.deleteMemory(r.ownerGaii, r.key)) removed++; }
    }
    if (removed > 0) {
        emitChange('organisms');
        void updateOrganismStructure(storage, config, organismId, { event: `deleted ${deleted.length} record(s) in ${namespace}`, actor: callerId })
            .catch(err => { logger.warn('deleteRecordsBatchOp: timeline best-effort', { error: String(err) }); });
    }
    return { ok: true, data: { deleted, failed, rows_removed: removed } };
}
