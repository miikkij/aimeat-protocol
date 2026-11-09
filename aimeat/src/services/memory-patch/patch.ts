/**
 * @file src/services/memory-patch/patch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Apply a JSON Merge Patch (RFC 7386) to one memory record: the one implementation behind
 *   PATCH /v1/memory/:key and aimeat_memory_write with `patch` on both MCP surfaces. Moved unchanged
 *   from routes/memory/patch.ts on 2026-11-09, so a partial update from an AI passes every gate the
 *   REST door passes (the backend rule "one capability, one implementation").
 *
 *   HOW IT IS SAFE. Read, merge, then compare-and-swap; on a losing swap, read again and re-merge.
 *   `setMemoryIfVersion` covers every write after the first and `createMemoryIfAbsent` the first,
 *   so a writer that loses the race applies its subtree on top of the winner's rather than over it.
 *
 *   WHAT IT DELIBERATELY IS NOT. Not a lock, and not element-wise for arrays: an array in the patch
 *   replaces the array in the record, per RFC 7386. A `null` in the patch REMOVES that field.
 *
 *   A RECORD THAT IS NOT AN OBJECT IS NOT MERGED INTO (2026-11-09). RFC 7386 replaces a non-object
 *   target with an object, so a patch on a record holding a string, a number or a list threw that
 *   value away and stored the patch alone. That is never what a partial update means, and an AI that
 *   guessed a record's shape wrong lost its content. Refused with 409 NOT_AN_OBJECT; a whole new
 *   value is written with POST /v1/memory or aimeat_memory_write's `value`.
 * @structure MAX_MERGE_ATTEMPTS · MERGE_BACKOFF_MS · MemoryPatchInput · MemoryPatchResult · patchMemoryRecord()
 * @usage
 *   const out = await patchMemoryRecord({ storage, config, stats, peers }, { auth: req.auth!, caller, reader, organismChecked: true }, input);
 * @version-history
 *   v1.0.0 — 2026-11-09 — Moved from routes/memory/patch.ts (its history there); a record whose value
 *     is not an object is refused with 409 NOT_AN_OBJECT; a writer that lost the swap waits a random,
 *     growing moment (MERGE_BACKOFF_MS) before it reads again.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord, AiProvenanceRecordRow } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import type { ContentReader } from '../classification/reader.js';
import type { StatsCollector } from '../stats.js';
import type { PeerInfo } from '../federation.js';
import { resolveIdentity, isForeignPrincipal, ownerGhiiOf } from '../../utils/gaii.js';
import { organismVisibilityRefusal } from '../organism-visibility.js';
import { memoryGroupRefusal } from '../../storage/memory-sharing.js';
import { isRaiseToPublic } from '../publish-gate.js';
import { memoryVisibilityDefault } from '../content-defaults.js';
import { closedNodeLevel, type ClosedNodeWarning } from '../closed-node-level.js';
import { signedInOnly } from '../../config-visibility.js';
import { publishAskOf, fileAsk, publishRequestedBody } from '../publish-requests/ask.js';
import { memoryCapRefusal } from '../memory-publish-gate.js';
import { memoryTarget } from '../classification/label-rows.js';
import { recordMemoryTouch } from '../data-map/write-tally-buffer.js';
import { tallyWriterOf } from '../data-map/tally-writer.js';
import { checkMemoryQuota, chargeOverage } from '../quota.js';
import { checkMemoryQuotaAlarm } from '../quota-alarm.js';
import { validateMemoryWrite } from '../schema-validator.js';
import { emitResourceUpdated, emitResourceListChanged } from '../resource-events.js';
import { enqueueMemoryReplication } from '../memory-replication.js';
import { logger } from '../../utils/logger.js';
import { emitChange, emitMemoryWritten, emitRecordChange } from '../event-bus.js';
import { reconcileAfterSourceWrite } from '../exchange-projection.js';
import { nodeContext } from '../node-context.js';
import { emitEcosystemMemoryWrite } from '../ecosystem-events.js';
import { runAutomationRecipesForWrite } from '../ecosystem-automation.js';
import { ecoMayWriteKey } from '../ecosystem-access.js';
import { appMayWriteKey, isServerWrittenKey, serverWrittenKeyRefusal } from '../../utils/reserved-keys.js';
import { crewSitesWriteRefusal } from '../crew-def-store.js';
import { agentKeyRefusal } from '../../utils/agent-key-address.js';
import { isSecretRecordKey, secretRecordWriteRefusal } from '../secret-records.js';
import { presentMemory } from '../classification/present-memory.js';
import { classifyAfterWrite } from '../classify-on-write.js';
import { resolveWriteTarget, type WriteTargetAuth } from '../write-target.js';
import { readsAsOwner, visibleToSameOwnerReader, hiddenRecordRelabel, READ_AS_OWNER_SCOPE, READ_AS_OWNER_NOTE } from '../owner-scope-read.js';
import { memoryWriteAsks, fileMemoryWriteAsks, type MemoryWriteAsk } from '../memory-write-asks.js';
import { isKeyArchived } from '../archive.js';
import { undeclaredSpaceForKey } from '../workspace-write-items.js';
import { odpsWriteRefusal } from '../exchange-odps-write.js';
import { legacyPacingWriteRefusal } from '../legacy-pacing-write.js';
import { stampAgentWrite, storeHeldProvenance } from '../ai/provenance.js';
import { applyMergePatch } from '../../utils/json-merge-patch.js';
import { mediaKindOfValue } from '../../models/ai-provenance-schemas.js';
import { keepsHistory, HISTORY_KEEP } from '../context/history-keys.js';
import { checkOrganismNamespaceAccess } from '../organism-namespace-access.js';
import { visibilityToZone, isAnonymousGaii } from '../../utils/visibility-words.js';
import { memoryContentBytes } from '../../utils/memory-content.js';

/**
 * How many times a losing writer re-reads and re-merges before giving up with a 409. Six is chosen
 * against the real contention this was built for: a pipeline with six writers on one record.
 */
export const MAX_MERGE_ATTEMPTS = 6;

/** The longest wait before the first retry, in ms; retry n waits up to n times this, at random. */
export const MERGE_BACKOFF_MS = 25;

export interface MemoryPatchDeps {
    storage: Storage;
    config: AimeatConfig;
    stats?: StatsCollector;
    peers?: Map<string, PeerInfo>;
}

export interface MemoryPatchWho {
    /** The credential's fields (a verified token, or an MCP session caller's auth). */
    auth: WriteTargetAuth & { app?: string };
    caller: CallerContext;
    /** The caller's classification reader, for the value echoed back. */
    reader: ContentReader;
    /** True when the organism namespace rule already ran (the REST route's workspace middleware). */
    organismChecked: boolean;
}

export interface MemoryPatchInput {
    key: string;
    patch: unknown;
    ifVersion?: unknown;
    visibility?: unknown;
    tags?: unknown;
    ttlHours?: unknown;
    ownerScope: boolean;
}

export type MemoryPatchResult =
    | { ok: false; status: number; code: string; message: string; details?: unknown; scopeNeeded?: string[] }
    | { ok: true; status: 200 | 201 | 202; data: Record<string, unknown> };

const fail = (status: number, code: string, message: string, details?: unknown): MemoryPatchResult =>
    ({ ok: false, status, code, message, ...(details !== undefined ? { details } : {}) });

const typeName = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v);

/** Merge `input.patch` into the record at `input.key`. */
export async function patchMemoryRecord(deps: MemoryPatchDeps, who: MemoryPatchWho, input: MemoryPatchInput): Promise<MemoryPatchResult> {
    const { storage, config, stats, peers } = deps;
    const { auth, caller: capCaller } = who;
    const { key, patch, ifVersion: if_version, tags } = input;
    const visibility = input.visibility as string | undefined;
    const ttl_hours = input.ttlHours as number | null | undefined;

    // A merge patch must be an object. RFC 7386 says a scalar patch REPLACES the whole document,
    // which is a legal merge patch and a terrible thing to receive by accident on a shared record.
    if (patch === undefined || patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        return fail(400, 'INVALID_INPUT', 'patch must be a JSON object. A scalar or array patch would replace the whole record — use PUT or POST to do that deliberately.');
    }
    if (if_version !== undefined && (typeof if_version !== 'number' || !Number.isInteger(if_version) || if_version < 0)) {
        return fail(400, 'INVALID_INPUT', 'if_version must be a non-negative integer');
    }

    // ── The same gate set POST /v1/memory runs, in the same order. ──
    if (auth.roles.includes('ecosystem') && !(await ecoMayWriteKey(storage, auth.sub, key))) {
        return fail(403, 'DATA_AREA_DENIED', `Write to "${key}" is not permitted by this app's data-area allowlist`);
    }
    const target = resolveWriteTarget({ auth }, config, input.ownerScope);
    if ('deny' in target) return fail(403, target.deny.code, target.deny.message);
    const gaii = target.gaii;

    // The organism namespace rule: the REST route ran it as middleware; the MCP door runs it here.
    if (!who.organismChecked && key.startsWith('organism.')) {
        const refusal = await checkOrganismNamespaceAccess({ storage, config }, {
            principal: auth.sub, owner: auth.owner, roles: auth.roles, scopes: auth.scopes,
        }, key, 'write');
        if (refusal) return fail(refusal.status, refusal.code, refusal.message, refusal.details);
    }

    if (isServerWrittenKey(key)) {
        const refusal = serverWrittenKeyRefusal(key);
        return fail(403, refusal.code, refusal.message);
    }
    const misaddressed = agentKeyRefusal(key);
    if (misaddressed) return fail(400, misaddressed.code, misaddressed.message);
    if (!appMayWriteKey(auth.roles, key, target.delegatedOwnerWrite, target.reservedAllowed)) {
        return fail(403, 'RESERVED_KEY', `The key "${key}" is managed by the account owner and cannot be written by an app.`);
    }
    if (isSecretRecordKey(key)) return fail(403, 'SECRET_RECORD', secretRecordWriteRefusal(key).message);
    if (isAnonymousGaii(gaii) && !key.startsWith('anonymous.')) {
        return fail(403, 'FORBIDDEN', 'Anonymous agents can only write to keys prefixed with "anonymous."');
    }
    const audience = await organismVisibilityRefusal(storage, visibility, {
        identity: resolveIdentity(auth, config.nodeId), federated: isForeignPrincipal(auth),
    });
    if (audience) return fail(audience.status, audience.code, audience.message);

    const before = await storage.getMemory(gaii, key);
    // With owner_scope the record is the owner's. One this caller reads as absent is still its to merge
    // into, but who may read it is not, and the answer carries no value of it.
    const writer = resolveIdentity(auth, config.nodeId);
    const readsAll = gaii === writer || readsAsOwner(capCaller);
    const relabel = hiddenRecordRelabel(before, writer, readsAll, visibility);
    if (relabel) return { ok: false, status: 403, code: 'SCOPE_DENIED', message: relabel, scopeNeeded: [READ_AS_OWNER_SCOPE] };
    const capped = await memoryCapRefusal({ storage, config }, capCaller, [memoryTarget(gaii, key)],
        visibility ?? before?.visibility ?? memoryVisibilityDefault(config), before?.visibility, 'PATCH /v1/memory');
    if (capped) return fail(capped.status, capped.code, capped.message);
    const publishAsk = visibility === 'public' && !signedInOnly(config)
        ? publishAskOf({ storage, config }, capCaller, auth.app)
        : { kind: 'allowed' as const };
    if (publishAsk.kind === 'refused') return fail(publishAsk.status, publishAsk.code, publishAsk.message);
    let askedToPublish = false;
    let closedWarning: ClosedNodeWarning | null = null;

    if (key.startsWith('organism.')) {
        const guard = await isKeyArchived(storage, key);
        if (guard.archived) return fail(409, 'ARCHIVED', `This ${guard.level} is archived (read-only). Unarchive it before writing.`);
        const undeclared = await undeclaredSpaceForKey(storage, key, { audience: auth.roles.includes('ecosystem') ? 'writer' : 'member' });
        if (undeclared) return fail(undeclared.status, undeclared.code, undeclared.message, undeclared.details);
    }

    const MAX_VALUE_SIZE = config.memoryMaxValueSizeKb * 1024;
    const now = new Date().toISOString();

    let record: MemoryRecord | null = null;
    let created = false;
    let lastConflictVersion: number | undefined;
    let overageMorsels = 0;
    let mergedSize = 0;
    let keyCountForAlarm: number | undefined;
    let bytesForAlarm = 0;
    // The provenance record of the attempt in hand, held until its swap lands (secaudit 2026-09, N2).
    let held: AiProvenanceRecordRow[] = [];
    let priorVisibility: string | undefined;
    let hiddenFromWriter = false;
    let writeAsks: MemoryWriteAsk[] = [];

    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS && !record; attempt++) {
        // A writer that lost the swap waits a random, growing moment before it reads again, so writers
        // that collided once do not collide again in lockstep (PostgreSQL, measured 2026-11-09: twelve
        // simultaneous patches with no wait left five refused after six attempts).
        if (attempt > 0) await new Promise(r => setTimeout(r, Math.floor(Math.random() * MERGE_BACKOFF_MS * attempt)));
        held = [];
        // Re-read on EVERY attempt: a writer that lost the swap merges onto what the winner stored.
        const existing = await storage.getMemory(gaii, key);
        priorVisibility = existing?.visibility;
        hiddenFromWriter = !readsAll && !!existing && !visibleToSameOwnerReader(existing, writer);
        const closed = closedNodeLevel(config, visibility, 'members' as const, { from: existing?.visibility });
        closedWarning = closed.warning;
        askedToPublish = publishAsk.kind === 'ask' && isRaiseToPublic(existing?.visibility, closed.level);
        const wantVisibility = askedToPublish ? undefined : closed.level;
        const levelAfter = (wantVisibility ?? existing?.visibility
            ?? (askedToPublish ? 'private' : memoryVisibilityDefault(config))) as MemoryRecord['visibility'];
        const noGroup = memoryGroupRefusal(levelAfter, undefined, existing);
        if (noGroup) return fail(noGroup.status, noGroup.code, noGroup.message);

        if (if_version !== undefined && (existing?.version ?? 0) !== if_version) {
            return fail(409, 'VERSION_CONFLICT', `Expected version ${if_version} but current is ${existing?.version ?? 0}`,
                { current_version: existing?.version ?? 0, your_version: if_version });
        }
        if (existing?.archived) return fail(409, 'ARCHIVED', 'This record is archived (read-only). Unarchive it before writing.');
        if (existing && existing.ownerGaii !== gaii) return fail(403, 'ACCESS_DENIED', 'You can only modify your own memory records');
        // A record that is not an object is not merged into (see the header).
        if (existing && (typeof existing.value !== 'object' || existing.value === null || Array.isArray(existing.value))) {
            return fail(409, 'NOT_AN_OBJECT',
                `"${key}" holds a ${typeName(existing.value)}, and a patch merges into an object. Write the whole new value instead (POST /v1/memory, or aimeat_memory_write with value).`,
                { holds: typeName(existing.value) });
        }

        let merged = applyMergePatch(existing?.value ?? {}, patch);
        const asked = await memoryWriteAsks({ storage, config }, {
            principal: writer, targetGaii: gaii, roles: capCaller.roles, scopes: capCaller.scopes, federated: capCaller.visitor,
            ...(auth.app ? { app: auth.app } : {}),
        }, key, merged);
        if ('refused' in asked) return fail(asked.refused.status, asked.refused.code, asked.refused.message);
        writeAsks = asked.asks;
        if (writeAsks.length) merged = asked.value as typeof merged;

        mergedSize = Buffer.byteLength(JSON.stringify(merged), 'utf8');
        if (mergedSize > MAX_VALUE_SIZE) {
            return fail(413, 'QUOTA_EXCEEDED',
                `Merged value size ${mergedSize} bytes exceeds limit of ${MAX_VALUE_SIZE} bytes. Split the record by a stable partition (a date, a period) rather than by writer.`);
        }
        if (!existing) {
            const keyCount = await storage.countMemory([gaii]);
            keyCountForAlarm = keyCount + 1;
            if (keyCount >= config.memoryMaxKeysPerAgent) {
                return fail(413, 'QUOTA_EXCEEDED',
                    `Memory key limit reached (${config.memoryMaxKeysPerAgent}). One value may hold ${config.memoryMaxValueSizeKb} kB, so fold a set of small keys into one record holding an array or an object keyed by id, rather than deleting data.`);
            }
        }
        const existingSize = existing ? Buffer.byteLength(JSON.stringify(existing.value), 'utf8') : 0;
        const quotaCheck = await checkMemoryQuota(config, storage, gaii, mergedSize, existingSize);
        if (!quotaCheck.allowed) return fail(413, 'QUOTA_EXCEEDED', quotaCheck.reason!);
        overageMorsels = quotaCheck.overageMorsels;
        bytesForAlarm = quotaCheck.currentBytes - existingSize + mergedSize;

        // The MERGED value is what gets stored, so the merged value is what the schema must accept.
        const validation = await validateMemoryWrite(key, merged, storage);
        if (!validation.valid) {
            return fail(422, 'SCHEMA_VALIDATION_FAILED', 'Merged value does not match the schema for this key', {
                key, violations: validation.errors, schema_url: `/v1/memory/${encodeURIComponent(validation.schemaKey!)}/schema`,
            });
        }
        const odps = odpsWriteRefusal(key, merged, existing?.value);
        if (odps) return fail(odps.status, odps.code, odps.message, odps.details);
        const legacyPacing = legacyPacingWriteRefusal(key, merged);
        if (legacyPacing) return fail(legacyPacing.status, legacyPacing.code, legacyPacing.message);
        const sites = await crewSitesWriteRefusal(storage, key, gaii, merged, auth as Parameters<typeof crewSitesWriteRefusal>[4]);
        if (sites) return fail(403, 'OWNER_APPROVES_SITES', sites);

        // Provenance is stamped against the MERGED bytes, by the WRITER, never the namespace.
        const aiProvenanceId = await stampAgentWrite(storage, {
            principal: writer,
            content: memoryContentBytes(merged),
            mediaKind: mediaKindOfValue(merged),
            pipeline: 'memory.patch',
            surface: { visibility: levelAfter, humanAudience: true },
            labelPolicy: config.aiLabelPublic,
            nodeId: config.nodeId,
            baseUrl: config.baseUrl,
            enabled: config.aiProvenance,
            held,
        });

        // Metadata is patch-like too: omit visibility/tags/ttl and the record keeps what it had.
        const candidate: MemoryRecord = {
            key,
            ownerGaii: gaii,
            value: merged,
            ...(aiProvenanceId ? { aiProvenanceId } : {}),
            visibility: levelAfter,
            tags: Array.isArray(tags) ? tags : (existing?.tags ?? []),
            ttlHours: ttl_hours ?? existing?.ttlHours ?? null,
            version: existing ? existing.version + 1 : 1,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            ...(existing?.groupId ? { groupId: existing.groupId } : {}),
            ...(existing?.workspaceRef ? { workspaceRef: existing.workspaceRef } : {}),
            // A context and its ontology keep the version each write replaces (context/history-keys.ts).
            ...(keepsHistory(key) ? { trackable: true } : {}),
        };
        if (existing) {
            record = await storage.setMemoryIfVersion(candidate, existing.version);
            lastConflictVersion = existing.version;
        } else {
            record = await storage.createMemoryIfAbsent(candidate);
            created = record !== null;
        }
    }

    if (!record) {
        return fail(409, 'VERSION_CONFLICT', `The record changed under ${MAX_MERGE_ATTEMPTS} merge attempts. Retry, or serialise the writers.`,
            { attempts: MAX_MERGE_ATTEMPTS, last_seen_version: lastConflictVersion });
    }
    // Landed: the record the stored value names is stored now, before anything below announces it.
    await storeHeldProvenance(storage, held);
    if (!created && keepsHistory(key)) {
        await storage.pruneMemoryHistory(gaii, key, HISTORY_KEEP)
            .catch(err => logger.warn('memory patch: history prune failed', { key, error: String(err) }));
    }
    classifyAfterWrite({ storage, config }, gaii, key, record.value);
    if (overageMorsels > 0) await chargeOverage(storage, gaii, overageMorsels, 'memory_overage');
    void checkMemoryQuotaAlarm(config, storage, gaii, {
        ...(keyCountForAlarm !== undefined ? { keyCount: keyCountForAlarm } : {}),
        usedBytes: bytesForAlarm,
    });
    if (peers) {
        enqueueMemoryReplication(gaii, key, config, storage, peers).catch(err => {
            logger.warn('memory patch: replication enqueue failed, leaving it to the scheduled sync', { key, error: String(err) });
        });
    }
    // `gaii` is where it LANDED; the hand is the session, the only thing that names who did this.
    recordMemoryTouch({
        ownerGaii: gaii, key, kind: 'write',
        writerPrincipal: auth.app ? tallyWriterOf(capCaller, config.nodeId, auth.app) : writer,
    });
    emitResourceUpdated(gaii, `aimeat://memory/${encodeURIComponent(key)}`);
    if (created) emitResourceListChanged(gaii);
    stats?.increment('memory_writes');
    emitMemoryWritten(gaii, key, created ? 'created' : 'updated');
    await reconcileAfterSourceWrite(storage, gaii, key);

    let publishRequest: ReturnType<typeof publishRequestedBody> | undefined;
    let publishWarning: { code: string; message: string } | undefined;
    if (askedToPublish && publishAsk.kind === 'ask') {
        const filed = await fileAsk({ storage, config }, ownerGhiiOf(gaii), publishAsk.requester, {
            kind: 'memory', target: { namespace: gaii, key: record.key, version: record.version },
            title: `the record ${record.key}`, name: record.key,
            change: { field: 'visibility', from: record.visibility, to: 'public' },
        });
        if (filed.ok) publishRequest = publishRequestedBody({ storage, config }, filed);
        else publishWarning = { code: 'PUBLISH_NOT_ASKED', message: `Saved as ${record.visibility}, not public: ${filed.message}` };
    }
    if (writeAsks.length) {
        const filed = await fileMemoryWriteAsks({ storage, config }, writeAsks);
        publishRequest ??= filed.publishRequest;
        if (filed.warnings.length) publishWarning = filed.warnings[0];
    }

    const data: Record<string, unknown> = {
        ...(publishRequest ? { publish_request: publishRequest } : {}),
        ...(publishWarning || closedWarning ? { warnings: [publishWarning, closedWarning].filter(w => !!w) } : {}),
        key: record.key,
        owner_gaii: record.ownerGaii,
        // Echoed through the one presentation of a memory value; null when this caller may not see it.
        value: hiddenFromWriter ? null : (await presentMemory(who.reader, record))?.value ?? null,
        ...(hiddenFromWriter ? { note: READ_AS_OWNER_NOTE } : {}),
        visibility: record.visibility,
        zone: visibilityToZone(record.visibility),
        tags: record.tags,
        version: record.version,
        bytes: mergedSize,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
    };

    emitRecordChange('memory', record.ownerGaii, record.visibility, ...(priorVisibility ? [priorVisibility] : []));
    if (key.startsWith('organism.')) emitChange('organisms');
    nodeContext().workflow?.onMemoryWrite(gaii, key)
        .catch(e => logger.error('workflow event trigger (memory.patch) failed', { key, error: String(e) }));
    emitEcosystemMemoryWrite(storage, config, gaii, key)
        .catch(e => logger.error('ecosystem outbound (memory.patch) failed', { key, error: String(e) }));
    runAutomationRecipesForWrite(storage, config, gaii, key)
        .catch(e => logger.error('ecosystem automation recipe trigger failed', { key, error: String(e) }));
    if (capCaller.kind === 'agent' && !key.startsWith('onboarding.')) {
        void import('../onboarding-funnel.js')
            .then(m => m.recordActivation(storage, config, auth.owner, 'agent'))
            .catch(e => logger.warn('memory patch: activation marker is best-effort', { error: String(e) }));
    }
    return { ok: true, status: publishRequest ? 202 : created ? 201 : 200, data };
}
