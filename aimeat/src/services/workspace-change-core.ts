/**
 * @file src/services/workspace-change-core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts of a member's change to a workspace that both of its roads share: the road
 *   that writes it at once (services/workspace-member-changes.ts) and the road that writes it when an
 *   admin approves a suggestion (services/workspace-suggestions.ts). Who the caller is to the
 *   workspace, what a valid change is, and the write itself, which always goes into the copy of the
 *   record that counts (services/workspace-meta.ts), under the identity that already holds it, with
 *   the member's full identity and the time stamped on the change. Never into a copy of the member's
 *   own: a memory key is unique per owner, so a member's own copy would sit beside the workspace's
 *   record and change nothing anybody reads.
 *
 *   WHO MAY CHANGE. The workspace's creator and an organism creator or admin are its managers: their
 *   change is written at once, as it always was on the update path. Any other member needs the
 *   contributor role the creator grants (services/workspace-roles.ts), the same role that lets them
 *   write the workspace's content; a viewer reads and does not change. An agent attached to the
 *   organism works in the organism's shared area and never in a workspace, as the namespace rule
 *   already says (services/organism-namespace-access.ts).
 * @structure
 *   - ChangeCaller, ChangeDeps, ChangeRefusal, refusal(), isRefusal()
 *   - workspaceStanding() — the caller's place in one workspace, and the workspace's rule
 *   - refuseUnlessMayChange() — manager or contributor, or the refusal that says how to become one
 *   - validateSpaceRequest() — the spaces and schemas a caller sent, checked
 *   - newSpacesOf() — which of them the manifest that counts does not have yet (read-only)
 *   - applySpaces() — the spaces joined to the manifest that counts, schemas locked for the new ones
 *   - resolveDocumentSpace(), readSections(), writeSections() — one document space's section index
 *   - existingDocIds() — which of some document ids still name a record in the space
 * @usage
 *   const standing = await workspaceStanding(deps, caller, orgId, ws);
 *   if (isRefusal(standing)) return standing;
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: the member change doors (workspace actions for plain members).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord, OrganismRecord } from '../storage/interface.js';
import {
    findWorkspaceRegistration, readWorkspaceMetaRecord, readMemberChangeRule, unionObjectTypes,
    writeWorkspaceMetaRecord, isMemoryBackedSpace, WorkspaceMetaError, type MemberChangeRule,
} from './workspace-meta.js';
import { listWorkspaceMemberRoles } from './workspace-roles.js';
import { archivedRefusal } from './workspace-write-guards.js';
import { isPlatformWorkspaceNamespace } from './workspace-write-items.js';
import { validateMemoryWrite } from './schema-validator.js';
import { readStoredSections, type Section } from './workspace-sections.js';

/** Who is asking, in the terms the rules decide on. `principal` is the full identity (GHII or GAII). */
export interface ChangeCaller { principal: string; owner: string; roles: string[] }

/** What every function here needs. `now` is the clock, so a test can move it. */
export interface ChangeDeps { storage: Storage; config: AimeatConfig; now?: () => Date }

/** A refusal, with the status and code the HTTP door sends for it. */
export interface ChangeRefusal { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }

export const refusal = (status: number, code: string, message: string, details?: Record<string, unknown>): ChangeRefusal =>
    ({ ok: false, status, code, message, ...(details ? { details } : {}) });

export function isRefusal(x: unknown): x is ChangeRefusal {
    return !!x && typeof x === 'object' && (x as { ok?: unknown }).ok === false;
}

export const nowOf = (deps: ChangeDeps): Date => (deps.now ? deps.now() : new Date());

const wsRoot = (orgId: string, ws: string) => `organism.${orgId}.w.${ws}`;

/** The caller's place in one workspace, and the rule the workspace has set for its members. */
export interface WorkspaceStanding {
    organism: OrganismRecord;
    /** The workspace creator's bare account name, as the registry names it. */
    creator: string;
    /** The identity that registered the workspace: where a meta record goes when none exists yet. */
    registrarGaii: string;
    wsName: string;
    role: 'creator' | 'admin' | 'member';
    /** The workspace creator, or an organism creator or admin. */
    manager: boolean;
    /** Holds the contributor role, or is a manager. */
    contributor: boolean;
    rule: MemberChangeRule;
}

/**
 * Where the caller stands in one workspace. Refuses what no member change could get past: an
 * organism that is not there, a caller who is not an active member (or is an agent attached to the
 * organism), a workspace nobody registered, and an archived one. Whether the caller may CHANGE the
 * workspace is refuseUnlessMayChange()'s question, asked separately, because the approver's side asks
 * it of somebody else.
 */
export async function workspaceStanding(
    deps: ChangeDeps, caller: ChangeCaller, orgId: string, ws: string,
): Promise<WorkspaceStanding | ChangeRefusal> {
    const { storage, config } = deps;
    const organism = await storage.getOrganism(orgId);
    if (!organism) return refusal(404, 'NOT_FOUND', 'Organism not found. Check the id with aimeat_organism_list.');
    if (organism.agentGaiis.includes(caller.principal)) {
        return refusal(403, 'ACCESS_DENIED', 'An agent attached to the organism works in its shared area and does not change a workspace. Make the change as a member instead.');
    }
    const membership = caller.owner ? await storage.getMembership(orgId, caller.owner) : null;
    if (!membership || membership.status !== 'active') {
        return refusal(403, 'ACCESS_DENIED', 'You are not an active member of this organism. Join it first, then ask the workspace creator for access.');
    }
    const registration = await findWorkspaceRegistration(storage, orgId, ws);
    if (!registration) return refusal(404, 'NOT_FOUND', `Workspace ${ws} not found in this organism. Check the id with aimeat_workspace_list.`);
    const archived = await archivedRefusal(storage, `${wsRoot(orgId, ws)}.`);
    if (archived) return refusal(409, 'ARCHIVED', archived);
    const role = membership.role as WorkspaceStanding['role'];
    const manager = role === 'creator' || role === 'admin' || registration.creator === caller.owner;
    let contributor = manager;
    if (!manager) {
        const roles = await listWorkspaceMemberRoles(storage, config, { creatorGhii: `${registration.creator}@${config.nodeId}`, orgId, ws });
        contributor = roles.get(caller.owner)?.role === 'contributor';
    }
    return {
        organism, creator: registration.creator, registrarGaii: registration.record.ownerGaii,
        wsName: registration.entry.name ?? ws, role, manager, contributor,
        rule: await readMemberChangeRule(storage, orgId, ws, config.nodeId),
    };
}

/** A manager or a contributor may change the workspace; anyone else is told how to become one. */
export function refuseUnlessMayChange(standing: WorkspaceStanding): ChangeRefusal | null {
    if (standing.manager || standing.contributor) return null;
    return refusal(403, 'ACCESS_DENIED',
        `You cannot change this workspace: its creator ${standing.creator} has not given you the contributor role. Ask for it with aimeat_workspace_access, or from the workspace page.`);
}

/** How many spaces one change may add, and how large a schema one of them may lock. */
export const MAX_SPACES_PER_CHANGE = 20;
const MAX_SCHEMA_CHARS = 100_000;
const NAMESPACE = /^[A-Za-z0-9_-]{1,60}(\.[A-Za-z0-9_-]{1,60}){0,4}$/;
/** Fields the node writes on a space it adds for a member; a caller cannot send them. */
const STAMP_FIELDS = ['addedBy', 'addedAt', 'approvedBy', 'suggestion'];

export interface SpaceRequest {
    spaces: Array<Record<string, unknown>>;
    /** Namespace → JSON Schema, only for the spaces in `spaces`. */
    schemas: Record<string, Record<string, unknown>>;
}

/**
 * The spaces a caller asks to add, checked before anything is looked up. A space needs a name and a
 * namespace; the namespace is the dotted key segment its records live under and may not be one the
 * platform keeps for itself (`meta`, `skills`, `access`). A schema may be sent only for a namespace
 * being added in the same change, which is what keeps a member from replacing the lock on a space
 * that already holds somebody's records.
 */
export function validateSpaceRequest(rawSpaces: unknown, rawSchemas: unknown): SpaceRequest | { error: string } {
    const list = Array.isArray(rawSpaces) ? rawSpaces : (rawSpaces && typeof rawSpaces === 'object' ? [rawSpaces] : null);
    if (!list || !list.length) return { error: 'Send the space to add: { name, namespace, mode } (mode "document" for pages, "records" for a list), or a list of them.' };
    if (list.length > MAX_SPACES_PER_CHANGE) return { error: `One change adds at most ${MAX_SPACES_PER_CHANGE} spaces; this one has ${list.length}.` };
    const spaces: Array<Record<string, unknown>> = [];
    for (const [i, raw] of list.entries()) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `spaces[${i}] is not a space object.` };
        const ot = { ...(raw as Record<string, unknown>) };
        for (const f of STAMP_FIELDS) delete ot[f];
        const name = typeof ot.name === 'string' ? ot.name.trim() : '';
        if (!name || name.length > 100) return { error: `spaces[${i}] needs a name of 1 to 100 characters.` };
        const ns = typeof ot.namespace === 'string' ? ot.namespace.trim() : '';
        if (!NAMESPACE.test(ns)) return { error: `spaces[${i}] needs a namespace of letters, digits, '-' or '_', in up to five dot-separated parts, such as "shared.notes".` };
        if (isPlatformWorkspaceNamespace(ns)) return { error: `spaces[${i}]: "${ns}" begins with a name the platform keeps for itself (meta, skills, access). Choose another, such as "shared.${ns.split('.').pop()}".` };
        spaces.push({ ...ot, name, namespace: ns });
    }
    const schemas: Record<string, Record<string, unknown>> = {};
    if (rawSchemas !== undefined && rawSchemas !== null) {
        if (typeof rawSchemas !== 'object' || Array.isArray(rawSchemas)) return { error: 'schemas is a map of namespace to JSON Schema.' };
        const adding = new Set(spaces.map(s => s.namespace as string));
        for (const [ns, schema] of Object.entries(rawSchemas as Record<string, unknown>)) {
            if (!adding.has(ns)) return { error: `A schema was sent for "${ns}", which this change does not add. A schema goes only with a space added in the same change.` };
            if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { error: `The schema for "${ns}" must be a JSON Schema object.` };
            if (JSON.stringify(schema).length > MAX_SCHEMA_CHARS) return { error: `The schema for "${ns}" is larger than ${MAX_SCHEMA_CHARS} characters.` };
            schemas[ns] = schema as Record<string, unknown>;
        }
    }
    return { spaces, schemas };
}

/**
 * Which of the requested spaces the manifest that counts does not have yet: the part of a request
 * that would change anything. Read-only; the write is applySpaces().
 */
export async function newSpacesOf(
    deps: ChangeDeps, orgId: string, ws: string, request: SpaceRequest,
): Promise<{ fresh: Array<Record<string, unknown>>; skipped: string[] } | ChangeRefusal> {
    const man = await readWorkspaceMetaRecord(deps.storage, orgId, ws, 'meta.manifest', deps.config.nodeId);
    const value = man?.value && typeof man.value === 'object' && !Array.isArray(man.value) ? man.value as Record<string, unknown> : null;
    if (!value || !Array.isArray(value.objectTypes)) {
        return refusal(409, 'NO_STRUCTURE', 'This workspace has no structure yet, so there is nothing to add a space to. Its creator sets it up first.');
    }
    try {
        const union = unionObjectTypes(value, request.spaces);
        return { fresh: request.spaces.filter(s => union.added.includes(String(s.name))), skipped: union.skipped };
    } catch (e) {
        if (e instanceof WorkspaceMetaError) return refusal(400, 'INVALID_SPACE', e.message);
        throw e;
    }
}

/**
 * Join spaces to the manifest that counts, and lock the schemas sent for the ones this adds. Spaces
 * whose name or namespace already exists are skipped, so running the same change twice adds nothing
 * the second time. A schema is locked only where no lock exists yet. `stamp` goes on every space this
 * adds: who added it, when, and who approved it when it came through a suggestion.
 */
export async function applySpaces(
    deps: ChangeDeps, standing: WorkspaceStanding,
    args: { orgId: string; ws: string; request: SpaceRequest; stamp: Record<string, unknown> },
): Promise<{ added: string[]; skipped: string[] } | ChangeRefusal> {
    const { storage, config } = deps;
    const { orgId, ws, request, stamp } = args;
    const root = wsRoot(orgId, ws);
    const man = await readWorkspaceMetaRecord(storage, orgId, ws, 'meta.manifest', config.nodeId);
    const value = man?.value && typeof man.value === 'object' && !Array.isArray(man.value) ? man.value as Record<string, unknown> : null;
    if (!man || !value || !Array.isArray(value.objectTypes)) {
        return refusal(409, 'NO_STRUCTURE', 'This workspace has no structure yet, so there is nothing to add a space to. Its creator sets it up first.');
    }
    let union: ReturnType<typeof unionObjectTypes>;
    try {
        union = unionObjectTypes(value, request.spaces, stamp);
    } catch (e) {
        if (e instanceof WorkspaceMetaError) return refusal(400, 'INVALID_SPACE', e.message);
        throw e;
    }
    if (!union.added.length) return { added: [], skipped: union.skipped };
    const manifestValue: Record<string, unknown> = { ...value, objectTypes: union.objectTypes, id: orgId, status: (value.status as string) || 'active' };
    const valid = await validateMemoryWrite(`${root}.meta.manifest`, manifestValue, storage);
    if (!valid.valid) return refusal(422, 'INVALID_SPACE', 'The workspace structure would not be valid with this space: ' + JSON.stringify(valid.errors), { violations: valid.errors });
    const now = nowOf(deps).toISOString();
    const addedNs = request.spaces.filter(s => union.added.includes(String(s.name))).map(s => s.namespace as string);
    for (const ns of addedNs) {
        const schema = request.schemas[ns];
        if (!schema || await storage.getSchema(`${root}.${ns}`, 'prefix')) continue;
        await storage.setSchema({ keyPattern: `${root}.${ns}`, applyTo: 'prefix', schemaJson: schema, schemaMode: 'strict', lockedBy: `${standing.creator}@${config.nodeId}`, setAt: now, updatedAt: now });
    }
    await writeWorkspaceMetaRecord(storage, `${root}.meta.manifest`, man.ownerGaii, manifestValue, man);
    return { added: union.added, skipped: union.skipped };
}

/** A document space of the workspace, by its name or its namespace, from the manifest that counts. */
export async function resolveDocumentSpace(
    deps: ChangeDeps, orgId: string, ws: string, space: string,
): Promise<{ name: string; namespace: string } | ChangeRefusal> {
    const man = await readWorkspaceMetaRecord(deps.storage, orgId, ws, 'meta.manifest', deps.config.nodeId);
    const types = ((man?.value as { objectTypes?: Array<Record<string, unknown>> } | undefined)?.objectTypes ?? []);
    const ot = types.find(o => (o?.name === space || o?.namespace === space) && typeof o.namespace === 'string' && isMemoryBackedSpace(o));
    const isDoc = !!ot && (ot.mode === 'document' || (!ot.mode && ot.kind === 'document'));
    if (!ot || !isDoc) {
        const docs = types.filter(o => o?.mode === 'document' || (!o?.mode && o?.kind === 'document')).map(o => String(o.name));
        return refusal(422, 'NOT_A_DOCUMENT_SPACE',
            `Sections belong to a document space, and "${space}" is not one in this workspace. Its document spaces: ${docs.length ? docs.join(', ') : 'none yet'}.`);
    }
    return { name: String(ot.name), namespace: String(ot.namespace) };
}

/** One document space's section index: the record that counts, and the index it holds. */
export async function readSections(
    deps: ChangeDeps, orgId: string, ws: string, spaceName: string,
): Promise<{ record: MemoryRecord | null; sections: Section[] }> {
    const record = await readWorkspaceMetaRecord(deps.storage, orgId, ws, `meta.sections.${spaceName}`, deps.config.nodeId);
    return { record, sections: readStoredSections(record?.value) };
}

/**
 * Write a section index into the record that counts, or, when there is none yet, under `registrar`:
 * the identity that registered the workspace. `stamp` records who changed it, when, and who approved it.
 */
export async function writeSections(
    deps: ChangeDeps,
    args: { orgId: string; ws: string; spaceName: string; sections: Section[]; prev: MemoryRecord | null; registrar: string; stamp: Record<string, unknown> },
): Promise<void> {
    const { orgId, ws, spaceName, sections, prev, registrar, stamp } = args;
    await writeWorkspaceMetaRecord(deps.storage, `${wsRoot(orgId, ws)}.meta.sections.${spaceName}`,
        prev?.ownerGaii ?? registrar, { sections, ...stamp }, prev);
}

/**
 * Which of `ids` still name a record in the space: a bare key, a draft, a published copy or a
 * version, under anyone. One key-only scan of the space, so no value is loaded.
 */
export async function existingDocIds(
    deps: ChangeDeps, orgId: string, ws: string, namespace: string, ids: string[],
): Promise<Set<string>> {
    const prefix = `${wsRoot(orgId, ws)}.${namespace}.`;
    const keys = deps.storage.listMemoryKeysByPrefix
        ? (await deps.storage.listMemoryKeysByPrefix(prefix)).map(r => r.key)
        : (await deps.storage.listAllMemory({ prefix, limit: 10000, archived: 'include' })).items.map(r => r.key);
    const present = new Set(keys.map(k => k.slice(prefix.length).split('.')[0]));
    return new Set(ids.filter(id => present.has(id)));
}
