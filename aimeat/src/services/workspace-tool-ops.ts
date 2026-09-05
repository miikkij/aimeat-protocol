/**
 * @file src/services/workspace-tool-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three workspace operations an agent performs most — read the index or open
 *   records, write a draft, publish a draft — as plain functions that take a CALLER and return a
 *   verdict, so more than one door can perform them without carrying its own copy.
 *
 *   WHY THIS FILE EXISTS. These three lived as the bodies of aimeat_workspace_read, _write and
 *   _publish in src/mcp/workspaces.ts, which is a fine place for a tool's name and parameters and
 *   the wrong place for the work: the sandbox (`ctx.workspace`, services/extension-workspace.ts)
 *   needed to do exactly what the tools do, as the caller, with every refusal the tools make. A
 *   second copy in the sandbox would have been the fourth surface with its own idea of who may
 *   write a workspace record. So the bodies moved here, unchanged in what they check and in what
 *   they say, and the tools call them.
 *
 *   The shape of a verdict is deliberate: `{ ok: true, data }` or `{ ok: false, status, code,
 *   message }`. The MCP door renders the message as text (its callers never saw a code); the
 *   sandbox throws `CODE: message` and its route answers with the status. The messages are the ones
 *   the tools always produced, so an agent that learned them keeps recognising them.
 * @structure
 *   - WorkspaceOpsCaller / workspaceCallerOf() — who is asking, in the terms the rules decide on
 *   - readWorkspaceOp() — the index (titles, no bodies) or the full values of named ids
 *   - writeWorkspaceDraftsOp() — one draft or a batch, resolved and validated before any write
 *   - publishWorkspaceOp() — the same publishDraft POST /v1/organisms/:id/publish calls
 * @usage
 *   const caller = workspaceCallerOf({ principal: agentGaii, ownerName, roles: ['agent'] }, config);
 *   const r = await readWorkspaceOp({ storage, config }, caller, { organismId, ws });
 *   if (!r.ok) return fail(r.message);
 * @version-history
 *   v1.0.0 — 2026-09-05 — Extracted from src/mcp/workspaces.ts (a pure move of the three tool
 *     bodies) so ctx.workspace in the extension sandbox calls the same functions the tools call.
 *     Two additions the tools do not use yet: `ifVersion` on a single-record draft write (the
 *     compare-and-swap services/workspace-write.ts already offered) and `_draftVersion` on an
 *     opened record, which is what a script needs to swap against.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { canWriteNamespaceRule, readOrganismConfig, createOrganismHelpers, fresherRec } from '../routes/organisms/shared.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';
import { workspaceRowIndex } from './workspace-rows/row-service.js';
import type { RowObjectType } from './workspace-rows/row-space.js';
import { archivedRefusal, checkWorkspaceWriteLimits } from './workspace-write-guards.js';
import { parseGAII, isSameOwner } from '../utils/gaii.js';
import { validateMemoryWrite } from './schema-validator.js';
import { authorizeRead } from './access-guard.js';
import { entryTitle } from './structure-overview.js';
import { isMemoryBackedSpace, readWorkspaceSchemas } from './workspace-meta.js';
import { emitChange } from './event-bus.js';
import { updateOrganismStructure } from './structure-snapshot.js';
import { normalizeDocValueImages } from './doc-images.js';
import { normalizeWriteItems, resolveWriteItem, type ResolvedWriteItem } from './workspace-write-items.js';
import { findWorkspaceRecord, writeWorkspaceRecord } from './workspace-write.js';
import { writeProvenanceEcho, readProvenanceMany } from '../mcp/ai-provenance-result.js';
import { provenanceForWrite, stampAutonomousOutput, type DeclaredProvenance } from './ai-provenance.js';
import type { AiProvenanceLevel, AiProvenanceMethod } from '../models/ai-provenance-schemas.js';
import { memoryContentBytes } from '../routes/memory/shared.js';
import { logger } from '../utils/logger.js';

type ObjType = { name: string; namespace?: string; backing?: string; mode?: string; kind?: string; versioned?: boolean; create_only?: boolean; maxVersions?: number };
type Manifest = { objectTypes?: ObjType[] } & Record<string, unknown>;

export interface WorkspaceOpsDeps { storage: Storage; config: AimeatConfig }

/** Who is asking, in the terms every rule below decides on. */
export interface WorkspaceOpsCaller {
    /** The session principal: an agent GAII, an owner GHII, or an app or ecosystem id. */
    principal: string;
    /** The bare account name. Memberships are keyed by it. */
    ownerName: string;
    /** `${ownerName}@${nodeId}`: where current state and meta live. */
    ownerGhii: string;
    /** Who AUTHORS content: an agent's own GAII when an agent calls, else the owner GHII. */
    writerGaii: string;
    /** The session's roles, for the organism namespace rule. */
    roles: string[];
}

/** A refusal, with the status and code the HTTP doors send for the same thing. */
export interface WorkspaceOpRefusal { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }
export type WorkspaceOpResult<T> = { ok: true; data: T } | WorkspaceOpRefusal;

const refuse = (status: number, code: string, message: string, details?: Record<string, unknown>): WorkspaceOpRefusal =>
    ({ ok: false, status, code, message, ...(details ? { details } : {}) });

/**
 * Build the caller from a principal. The owner name is taken from the session when the door knows
 * it (an owner GHII carries no `#`, so parsing cannot recover it from an agent-shaped id) and from
 * the GAII otherwise, which is what the MCP door has always done.
 */
export function workspaceCallerOf(
    args: { principal: string; ownerName?: string; roles: string[] },
    config: AimeatConfig,
): WorkspaceOpsCaller {
    const parsed = parseGAII(args.principal);
    const ownerName = args.ownerName ?? (parsed ? parsed.owner : args.principal.split('@')[0]);
    const ownerGhii = `${ownerName}@${config.nodeId}`;
    return {
        principal: args.principal, ownerName, ownerGhii,
        writerGaii: parsed ? args.principal : ownerGhii,
        roles: args.roles,
    };
}

const wsRoot = (orgId: string, ws: string) => `organism.${orgId}.w.${ws}`;

/** Membership gate — an organism agent, or the owner is an active member. Null when allowed. */
async function denyReason(storage: Storage, caller: WorkspaceOpsCaller, orgId: string): Promise<WorkspaceOpRefusal | null> {
    const org = await storage.getOrganism(orgId);
    if (!org) return refuse(404, 'NOT_FOUND', 'Organism not found');
    if (org.agentGaiis?.includes(caller.principal)) return null;
    const m = await storage.getMembership(orgId, caller.ownerName);
    return m && m.status === 'active' ? null : refuse(403, 'ACCESS_DENIED', 'Not an active member of this organism');
}

/** The caller's role for the meta.* rule; an organism agent is a member and nothing more. */
async function memberRoleOf(storage: Storage, caller: WorkspaceOpsCaller, orgId: string): Promise<'creator' | 'admin' | 'member' | null> {
    const m = await storage.getMembership(orgId, caller.ownerName);
    if (m && m.status === 'active') return m.role;
    const org = await storage.getOrganism(orgId);
    return org?.agentGaiis?.includes(caller.principal) ? 'member' : null;
}

/** The manifest from whichever member created the workspace. */
async function readManifest(storage: Storage, orgId: string, ws: string): Promise<Manifest | null> {
    const key = `${wsRoot(orgId, ws)}.meta.manifest`;
    const { items } = await storage.listAllMemory({ prefix: key, limit: 100 });
    const rec = items.find(r => r.key === key);
    return rec ? (rec.value as Manifest) : null;
}

/** A draft value should be an object; tolerate a JSON string, then stamp the instance id. */
function coerceValue(value: unknown, id: string): unknown {
    let v = value;
    // eslint-disable-next-line aimeat/no-silent-catch -- leave as string → schema rejects clearly
    if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') v = p; } catch { /* leave as string → schema rejects clearly */ } }
    return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(v as Record<string, unknown>), id } : v;
}

export interface ReadWorkspaceArgs {
    organismId: string; ws: string;
    /** Batch-open: the FULL value of only these ids. Omit for the index. */
    ids?: string[];
    /** With `ids`: restrict to this space (name or namespace). */
    space?: string;
    includeArchived?: boolean;
}

/**
 * Two modes, one function. DEFAULT (no `ids`) → the INDEX: per space, every instance's id + title +
 * updated + version + byte-size, no bodies, plus the manifest, the pinned apps and the locked
 * schemas. BATCH-OPEN (`ids`) → the full value of only those instances. Authorization is at the
 * workspace level: whoever may read the manifest sees all of its content, whoever wrote it.
 */
export async function readWorkspaceOp(
    deps: WorkspaceOpsDeps, caller: WorkspaceOpsCaller, args: ReadWorkspaceArgs,
): Promise<WorkspaceOpResult<Record<string, unknown>>> {
    const { storage, config } = deps;
    const { organismId, ws, ids, space } = args;
    const deny = await denyReason(storage, caller, organismId); if (deny) return deny;
    const root = wsRoot(organismId, ws);
    const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 5000, archived: args.includeArchived ? 'include' : undefined, excludeVersionRows: true });
    const manRec = items.find(r => r.key === `${root}.meta.manifest`);
    let canRead = false;
    if (manRec) {
        canRead = manRec.ownerGaii === caller.ownerGhii || isSameOwner(manRec.ownerGaii, caller.ownerGhii);
        if (!canRead) {
            const d = await authorizeRead(storage, config, { ownerGaii: manRec.ownerGaii, accessorGaii: caller.ownerGhii, resourceKey: manRec.key, visibility: manRec.visibility, groupId: manRec.groupId, action: 'read' });
            canRead = d.allowed;
        }
    }
    if (!manRec || !canRead) return refuse(404, 'NOT_FOUND', `No manifest at ${root}.meta.manifest — empty workspace, wrong ws id, or no access (request access with aimeat_workspace_access).`);
    const manifest = manRec.value as Manifest;

    type Slot = { latest?: MemoryRecord; draft?: MemoryRecord };
    const spaces = new Map<string, { ot: ObjType; inst: Map<string, Slot> }>();
    for (const ot of manifest.objectTypes ?? []) {
        if (!ot.namespace || !isMemoryBackedSpace(ot)) continue;
        const nsPrefix = `${root}.${ot.namespace}.`;
        const inst = new Map<string, Slot>();
        for (const r of items) {
            if (!r.key.startsWith(nsPrefix)) continue;
            const parts = r.key.slice(nsPrefix.length).split('.');
            const role = parts.slice(1).join('.');
            const slot = inst.get(parts[0]) ?? {};
            if (role === '' || role === 'latest') slot.latest = fresherRec(slot.latest, r);
            else if (role === 'draft') slot.draft = fresherRec(slot.draft, r);
            inst.set(parts[0], slot);
        }
        spaces.set(ot.name, { ot, inst });
    }
    const byteLen = (v: unknown): number => (typeof v === 'string' ? v.length : JSON.stringify(v ?? null).length);

    if (ids && ids.length) {
        const scoped = space ? [...spaces.values()].filter(s => s.ot.name === space || s.ot.namespace === space) : [...spaces.values()];
        const found: unknown[] = [];
        const missing: string[] = [];
        const provFor = await readProvenanceMany(storage, config, items.map(r => r.aiProvenanceId));
        for (const id of new Set(ids.map(String))) {
            let hit = false;
            for (const s of scoped) {
                const slot = s.inst.get(id);
                const cur = slot?.latest ?? slot?.draft;
                if (!slot || !cur) continue;
                found.push({
                    space: s.ot.name, id, value: cur.value,
                    published: !!slot.latest, _version: cur.version, _createdAt: cur.createdAt, _updatedAt: cur.updatedAt,
                    // The draft's own version is what a compare-and-swap write needs to name.
                    ...(slot.draft ? { draft: slot.draft.value, _draftVersion: slot.draft.version } : {}),
                    ...provFor(cur.aiProvenanceId),
                });
                hit = true; break;
            }
            if (!hit) missing.push(id);
        }
        return { ok: true, data: { organism_id: organismId, ws, mode: 'content', items: found, ...(missing.length ? { missing } : {}) } };
    }

    const apps = ((items.find(r => r.key === `${root}.meta.apps`)?.value as { apps?: unknown[] } | undefined)?.apps) ?? [];
    const index: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const [name, s] of spaces) {
        const entries = [...s.inst.entries()]
            .map(([id, slot]) => {
                const cur = slot.latest ?? slot.draft!;
                return { id, title: entryTitle(cur.value, id), updated: cur.updatedAt, version: slot.latest?.version ?? 0, bytes: byteLen(cur.value), published: !!slot.latest, has_draft: !!slot.draft };
            })
            .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id < b.id ? -1 : 1));
        index[name] = entries;
        counts[name] = entries.length;
    }
    // Row spaces answer with a count, never with rows: this index materialises every value.
    const rowSpaces = await workspaceRowIndex({ storage, config }, organismId, ws, manifest.objectTypes as RowObjectType[] | undefined);
    for (const [name, s] of Object.entries(rowSpaces)) counts[name] = s.rows;
    const schemas = await readWorkspaceSchemas(storage, organismId, ws);

    return { ok: true, data: { organism_id: organismId, ws, mode: 'index', manifest, apps, counts, index,
        ...(Object.keys(schemas).length ? { schemas } : {}),
        ...(Object.keys(rowSpaces).length ? { row_spaces: rowSpaces } : {}),
        hint: 'Titles only. Open the ones you need with aimeat_workspace_read(ids:["<id>", ...]) to get their full values.'
            + (Object.keys(schemas).length ? ' `schemas` is what is locked on each records space now — edit that map and send it back through aimeat_workspace_update, which REPLACES it.' : '')
            + (Object.keys(rowSpaces).length ? ' Row spaces show a count and a span here; read their rows with aimeat_workspace_rows_read.' : '') } };
}

export interface WriteWorkspaceDraftsArgs {
    organismId: string; ws: string;
    space?: string; value?: unknown; id?: string; section?: string;
    /** BATCH: an array of { value, space?, id?, section? }. All-or-nothing. */
    items?: unknown;
    aiProvenance?: DeclaredProvenance;
    aiProvenanceId?: string;
    /**
     * The NODE's own stamp, for a write whose bytes a script produced rather than the caller: the
     * extension sandbox. A declaration (`aiProvenance`) is the caller asserting how content was
     * made and needs `provenance:write`; this is the node recording what it ran, stamped by the
     * node with the pipeline naming the producer, and needs no scope. Mutually exclusive with
     * `aiProvenance`, and it wins when both are given.
     */
    nodeStamp?: { level?: AiProvenanceLevel; method?: AiProvenanceMethod };
    /** Which door orchestrated the write, for the provenance record. */
    pipeline: string;
    /**
     * COMPARE-AND-SWAP on the draft, single-record writes only: land only if the stored draft is
     * still at this version; `null` means "only if there is no draft yet". Refused with
     * VERSION_CONFLICT and nothing written.
     */
    ifVersion?: number | null;
}

/**
 * Write one draft or a batch of them. Every item is resolved and schema-validated before ANY is
 * written; a document with no id gets a generated one, so a half-landed batch retried would
 * duplicate what landed. Content is authored under the member GHII with the caller as the hand.
 */
export async function writeWorkspaceDraftsOp(
    deps: WorkspaceOpsDeps, caller: WorkspaceOpsCaller, args: WriteWorkspaceDraftsArgs,
): Promise<WorkspaceOpResult<Record<string, unknown>>> {
    const { storage, config } = deps;
    const { organismId, ws } = args;
    const deny = await denyReason(storage, caller, organismId); if (deny) return deny;
    // The rule is services/organism-namespace-access.ts, the one the HTTP door answers to.
    const writeRefusal = await checkOrganismNamespaceAccess({ storage, config },
        { principal: caller.principal, owner: caller.ownerName, roles: caller.roles }, `${wsRoot(organismId, ws)}.probe`, 'write');
    if (writeRefusal) return refuse(403, 'ACCESS_DENIED', 'You are not approved to write to this workspace. Request access with aimeat_workspace_access(action:"request") and wait for the creator to approve.');
    const norm = normalizeWriteItems({ space: args.space, value: args.value, id: args.id, section: args.section, items: args.items });
    if ('error' in norm) return refuse(400, 'INVALID_INPUT', norm.error);
    const batch = args.items !== undefined && args.items !== null;
    if (batch && args.ifVersion !== undefined) return refuse(400, 'INVALID_INPUT', 'ifVersion applies to a single record, not to a batch');
    const root = wsRoot(organismId, ws);
    const types = (await readManifest(storage, organismId, ws))?.objectTypes ?? [];
    const planned: { key: string; v: unknown; item: ResolvedWriteItem }[] = [];
    for (const [i, want] of norm.items.entries()) {
        const item = resolveWriteItem(want, types, batch ? `items[${i}]` : undefined);
        if ('error' in item) return refuse(400, 'INVALID_INPUT', item.error);
        const key = `${root}.${item.namespace}.${item.instanceId}.draft`;
        let v = coerceValue(item.value, item.instanceId);
        if (item.isDoc) v = await normalizeDocValueImages(storage, config, v, caller.ownerName, `${organismId}/${ws}`);
        const valid = await validateMemoryWrite(key, v, storage);
        if (!valid.valid) return refuse(422, 'SCHEMA_VALIDATION_FAILED', `${batch ? `items[${i}]: ` : ''}Draft rejected by schema: ` + JSON.stringify(valid.errors), { violations: valid.errors });
        planned.push({ key, v, item });
    }
    const wsArchived = await archivedRefusal(storage, `${root}.`);
    if (wsArchived) return refuse(409, 'ARCHIVED', wsArchived);
    for (const [i, p] of planned.entries()) {
        const rowArchived = await archivedRefusal(storage, `${root}.`, { ownerGhii: caller.ownerGhii, key: p.key });
        if (rowArchived) return refuse(409, 'ARCHIVED', `${batch ? `items[${i}]: ` : ''}${rowArchived}`);
    }
    const overLimit = await checkWorkspaceWriteLimits(storage, config, caller.ownerGhii, planned, i => (batch ? `items[${i}]: ` : ''));
    if (overLimit) return refuse(413, 'LIMIT_EXCEEDED', overLimit);

    const written: Record<string, unknown>[] = [];
    let lastProvenanceId: string | undefined;
    for (const { key, v, item } of planned) {
        // Per ITEM: a batch of twenty records is twenty different sets of bytes. A draft lands
        // private; publishing is what makes it readable, and the publish path re-derives the label.
        const provenanceSurface = {
            surface: { visibility: 'private' as const, humanAudience: true },
            labelPolicy: config.aiLabelPublic,
            nodeId: config.nodeId,
            baseUrl: config.baseUrl,
            enabled: config.aiProvenance,
        };
        const provenanceId = args.nodeStamp
            ? await stampAutonomousOutput(storage, {
                principal: caller.principal, content: memoryContentBytes(v),
                level: args.nodeStamp.level, method: args.nodeStamp.method, pipeline: args.pipeline,
                ...provenanceSurface,
            })
            : await provenanceForWrite(storage, {
                principal: caller.principal, content: memoryContentBytes(v),
                declaredId: args.aiProvenanceId, declared: args.aiProvenance, pipeline: args.pipeline,
                ...provenanceSurface,
            });
        lastProvenanceId = provenanceId ?? lastProvenanceId;
        const prev = await findWorkspaceRecord(storage, key);
        const outcome = await writeWorkspaceRecord({ storage, config }, {
            key, value: v, owner: caller.ownerGhii, prev, aiProvenanceId: provenanceId, principal: caller.principal,
            ...(args.ifVersion !== undefined ? { ifVersion: args.ifVersion } : {}),
        });
        if (!outcome.written) {
            return refuse(409, 'VERSION_CONFLICT',
                `Draft at ${key} is at version ${outcome.version}, not ${args.ifVersion ?? 'absent'}; nothing was written. Read it again and retry.`,
                { version: outcome.version });
        }
        if (item.isDoc && item.section) {
            const secKey = `${root}.meta.sections.${item.space}`;
            const secRec = await findWorkspaceRecord(storage, secKey);
            const sections = ((secRec?.value as { sections?: { id: string; name?: string; documents?: string[] }[] } | undefined)?.sections) ?? [];
            const target = sections.find(s => s.id === item.section || s.name === item.section);
            if (target) {
                target.documents = [...(target.documents ?? []).filter(d => d !== item.instanceId), item.instanceId];
                await writeWorkspaceRecord({ storage, config }, { key: secKey, value: { sections }, owner: caller.ownerGhii, prev: secRec, principal: caller.principal });
            }
        }
        written.push({ written: key, id: item.instanceId, space: item.space, mode: item.isDoc ? 'document' : 'records', section: item.section ?? null, version: outcome.version });
    }
    emitChange('organisms');
    const echo = await writeProvenanceEcho(storage, config, lastProvenanceId);
    return { ok: true, data: batch ? { count: written.length, items: written, ...echo } : { ...written[0], ...echo } };
}

export interface PublishWorkspaceArgs { organismId: string; ws: string; namespace: string; id: string; expectedVersion?: number | null }

/**
 * Publish a draft: the same publishDraft POST /v1/organisms/:id/publish calls, behind the same
 * gates (membership, the meta.* role, archive, the publish gate), with the decision-log entry and
 * the timeline snapshot the web door writes.
 */
export async function publishWorkspaceOp(
    deps: WorkspaceOpsDeps, caller: WorkspaceOpsCaller, args: PublishWorkspaceArgs,
): Promise<WorkspaceOpResult<{ published: string; version: number; skipped?: boolean }>> {
    const { storage, config } = deps;
    const { organismId, ws, namespace, id } = args;
    const H = createOrganismHelpers(config, storage);
    const deny = await denyReason(storage, caller, organismId); if (deny) return deny;
    const role = await memberRoleOf(storage, caller, organismId);
    if (!role || !canWriteNamespaceRule(role, namespace)) {
        return refuse(403, 'ACCESS_DENIED', 'Admin/creator role required to publish in a meta.* namespace');
    }
    const archived = await archivedRefusal(storage, `${wsRoot(organismId, ws)}.`);
    if (archived) return refuse(409, 'ARCHIVED', archived);
    const cfg = await readOrganismConfig(storage, organismId);
    const gate = (cfg as { gates?: { publish?: { enabled?: boolean } } } | null)?.gates?.publish?.enabled;
    if (gate) return refuse(409, 'GATE_ENABLED', 'Publishing requires human approval (the publish gate is on). Leave it as a draft for the owner to review and publish.');
    const base = `${wsRoot(organismId, ws)}.${namespace}.${id}`;
    const result = await H.publishDraft(organismId, ws, namespace, id, caller.writerGaii, args.expectedVersion ?? null);
    if (!result.ok) {
        return result.code === 'NO_DRAFT'
            ? refuse(404, 'NOT_FOUND', `No draft at ${base}.draft`)
            : refuse(409, 'PUBLISH_REFUSED', 'Publish refused: ' + JSON.stringify(result.violations), { violations: result.violations });
    }
    emitChange('organisms');
    // A no-op re-publish leaves no new version, so it earns no audit entry and no snapshot either.
    if (result.skipped) return { ok: true, data: { published: base, version: result.version, skipped: true } };
    await H.writeDecision(organismId, caller.writerGaii, `published ${namespace}.${id} v${result.version}`, [`${namespace}.${id}`]);
    void updateOrganismStructure(storage, config, organismId, { event: 'content published', actor: caller.writerGaii }).catch(err => { logger.warn('publish: timeline best-effort', { error: String(err) }); });
    void import('./onboarding-funnel.js')
        .then(m => m.recordActivation(storage, config, caller.ownerName, 'workspace'))
        .catch(err => { logger.warn('publish: activation marker is best-effort', { error: String(err) }); });
    return { ok: true, data: { published: base, version: result.version } };
}
