/**
 * @file src/services/fenced-space.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fenced record space: a MEMORY-backed space of an organism workspace whose
 *   manifest object type names extensions (`objectTypes[].extensions`, entries `installer/name`,
 *   the field row spaces already use) takes a write-mode operation from a caller that is not a
 *   person only when the operation arrives through one of the named extensions.
 *
 *   Ruled by the developer on 2026-10-13: "sovelluksen tietuetila ottaa agentin kirjoituksen vain
 *   sovelluksen oman laajennuksen kautta".
 *
 *   WHAT WAS MEASURED. On aimeat.io on 2026-10-13 an agent made from the home page for the app
 *   MUISTIO wrote decision and action records directly into the app's spaces with the plain
 *   workspace-write tool, past the app's own tool: a quote with spelling slips the tool would have
 *   refused, a decision the note said was not decided, and an author field the model typed wrongly.
 *   The app's tool is an extension action that checks what it writes; the workspace write tools
 *   check only the schema. Every other check on the write stays as it is (membership, the
 *   contributor grant, scopes, the schema lock, the publish gate): this rule is one more refusal
 *   after them, never a replacement for one.
 *
 *   WHO IS ALLOWED DIRECTLY, decided on the session's roles first and on the identity's shape only
 *   where a code path holds no session:
 *     - the account holder in person (isOwnerInPerson, utils/gaii.ts). An owner's import that names
 *       one of their agents passes the agent's identity with the owner's roles, and stays allowed.
 *     - a hosted app's grant (role `app`): it acts as its person, in the person's browser.
 *   Every other caller is fenced: an agent (every MCP session), an ecosystem app, a session from
 *   another node. The extension is named by the workspace capability of an extension action
 *   (services/extension-workspace.ts), which marks its caller with `installer/name`; no request
 *   field sets the marker.
 *
 *   WHAT IS A FENCE. A list with at least one entry. The valid entries (`installer/name`, trimmed
 *   and lower-cased, compared as the row service compares them) are the extensions that open the
 *   space. A list whose entries are all invalid FAILS CLOSED: the space is fenced and no extension
 *   opens it, because dropping a mistyped entry and then reading the list as empty would open the
 *   space to every agent. An absent field and an empty list name nothing, so there is no fence.
 *
 *   MATCHED BY NAMESPACE PREFIX of the key (`organism.<org>.w.<ws>.<namespace>.`), never by a parser
 *   that expects a `.draft` or `.latest` suffix: a bare key is a live record too.
 *
 *   THE MANIFEST is the copy that counts (services/workspace-meta.ts), the one the row service
 *   reads, and it is not read at all for a caller the rule allows directly: a person's write costs
 *   nothing more than before.
 *
 *   WHERE IT RUNS. checkOrganismNamespaceAccess (services/organism-namespace-access.ts) asks it for
 *   every write-mode check made with a record's real key. The code paths that do not pass a real key
 *   there ask fencedSpaceRefusal themselves, before their first storage write: the draft write, the
 *   publish of a draft, the batch publish and delete, reopening a record, the MCP record delete, the
 *   bulk delete, archive and unarchive of a record or a space, and public intake.
 *
 *   OUT OF SCOPE, on purpose: deleting or archiving a WHOLE workspace or organism (its creator or an
 *   admin, and the delete also asks memory:purge), and a ZIP import into a NEW workspace, which
 *   creates the spaces it fills. A visitor deleting their own intake conversation is the node's
 *   act for that visitor, not a caller's write.
 *
 *   THE PERMISSION `organism:direct` (v1.1.0). Ruled by the developer on 2026-10-13, on a
 *   recommendation in three parts ("tehdään niinkuin suosittelet"), after his objection to the rule
 *   above: "miksi se hylättäisiin jos agentille on annettu lupa tehdä niin? … voiko sen tehdä niin
 *   että agentille antaa täydet oikeudet?"
 *     1. A fenced caller whose SESSION scopes cover `organism:direct` writes a fenced space
 *        directly. The word is an ordinary one: the cover test is the node's one
 *        (utils/scope-coverage.ts scopeIsCovered), so `*` and `organism:*` cover it. It is the
 *        session's scopes that are read, never the agent record's: a token narrowed below the
 *        agent's grant does not pass. A code path that hands over no scopes FAILS CLOSED (fenced),
 *        and an identity with no session is decided by its shape as before, whatever list is
 *        beside it.
 *     2. A hosted app names its own extension on a space of an existing workspace through its own
 *        add-only route (services/workspace-space-extensions.ts), which asks callerIsFenced() for
 *        who may call it.
 *     3. THE LIST IS PROTECTED. A change to the manifest is protected when it touches the fence of
 *        a memory-backed object type that has one BEFORE the change: its `extensions` value differs
 *        in any way, the object type is removed, or its namespace or backing changes. It is
 *        accepted from the account holder in person, or from a caller whose session covers
 *        `organism:direct`. A hosted app is not accepted here: its way to a list is the route of
 *        part 2, which adds and never removes. Before this, the workspace creator's own agent
 *        replaced the manifest and with it the list that kept the agent out. A new object type
 *        that names extensions, and any change to a space with no fence, stay as they were.
 *
 *   WHERE THE PROTECTION RUNS. Every code path that writes a manifest compares it before the write
 *   with fenceChangeRefusal(): updateWorkspaceMeta (PUT /v1/organisms/:id/workspace and the MCP tool
 *   aimeat_workspace_update) and applySpaces (the member space-add and an approved suggestion). The
 *   manifest is also a memory record, `organism.<org>.w.<ws>.meta.manifest`, and a copy under an
 *   agent of the creator is the copy that counts when it is the newest (workspace-meta-read.ts
 *   pickWorkspaceMetaCopy). So that record is a TARGET of fencedSpaceRefusal() as well: a write-mode
 *   operation that names it is compared by value where the code path hands the value over
 *   (services/memory-write.ts) and is read as the removal of every fence where it does not (PUT,
 *   PATCH and DELETE /v1/memory/:key, the bin, the batch delete, the bulk delete, the MCP record
 *   delete). No request reaches the manifest record without passing one of the two.
 * @structure
 *   - DIRECT_WRITE_SCOPE — the word `organism:direct`
 *   - FenceCaller / callerIsFenced() — who the rule lets write directly
 *   - mayChangeFence() — who changes the list of a fenced space
 *   - SpaceFence / fenceOf() — the fence one object type declares, or none
 *   - extensionMarker() — `installer/name`, as the capability marks its caller
 *   - protectedFenceChanges() / fenceChangeRefusal() — the comparison of a manifest before and after
 *   - ManifestWrite / manifestWriteRefusal() — the manifest record as a target
 *   - fencedSpaceRefusal() — the rule for one workspace; fencedKeysRefusal() for keys of several
 *   - archiveFenceTarget() — what an archive or unarchive touches, as a target of the rule
 *   - fencedFormRefusal() — the rule for the identity a public intake form writes under
 *   - fencedSpaceMessage() / fenceChangeMessage() — the one sentence each refusal answers with
 * @usage
 *   const fenced = await fencedSpaceRefusal({ storage, config }, { principal, roles, scopes }, orgId, wsId, { key });
 *   if (fenced) return res.status(fenced.status).json(error(config.nodeId, fenced.code, fenced.message, fenced.status, fenced.details));
 *   const changed = fenceChangeRefusal(manifestBefore, manifestAfter, { principal, roles, scopes });
 * @version-history
 *   v1.1.0 — 2026-10-13 — The permission `organism:direct`: a session that covers it writes a
 *     fenced space directly (the caller carries `scopes`), and a change to a fenced space's list,
 *     object type, namespace or backing is accepted only from the account holder in person or from
 *     such a session (fenceChangeRefusal, and the manifest record as a target of the rule). Ruled by
 *     the developer on 2026-10-13: no permission let an agent through, and the creator's own agent
 *     could replace the manifest that held the list.
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import { isOwnerInPerson, isGEAI } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { isMemoryBackedSpace, readWorkspaceMetaRecord, type WorkspaceManifest } from './workspace-meta-read.js';

export interface FenceDeps { storage: Storage; config: { nodeId: string } }

/**
 * The permission that lets a caller that is not a person write a fenced space directly, and change
 * which extensions such a space names. An ordinary scope word: `*` and `organism:*` cover it.
 */
export const DIRECT_WRITE_SCOPE = 'organism:direct';

/** The caller of a write-mode operation, in the terms this rule decides on. */
export interface FenceCaller {
    /** The identity the operation is made by: a GHII, an agent GAII, an ecosystem id. */
    principal: string;
    /**
     * The session's roles. Absent ONLY where a code path holds an identity and no session (a stored
     * intake form names the identity its records are written under): the identity's shape decides
     * then. An empty list is a session with no role, which is fenced.
     */
    roles?: readonly string[];
    /**
     * The SESSION's scope words, as the token carries them: never the agent record's stored list,
     * which a narrowed token does not hold. A session that covers `organism:direct` writes a fenced
     * space directly. Absent means the code path has no scopes to hand over, which reads as "does
     * not hold the word".
     */
    scopes?: readonly string[];
    /** `installer/name` of the extension whose action makes the call. Set by
     *  services/extension-workspace.ts and by nothing else. */
    extension?: string;
}

/** The fence one object type declares. */
export interface SpaceFence {
    /** The object type's name, for the refusal's details. */
    space: string;
    namespace: string;
    /** The extensions that open the space, `installer/name` lower-cased. Empty = closed to all. */
    extensions: string[];
}

export interface FencedSpaceRefusal {
    status: 403;
    code: 'ACCESS_DENIED';
    message: string;
    details: { reason: 'FENCED_SPACE'; space: string; extensions: string[] };
}

/** How a change touches the fence of one object type. */
export type FenceChangeKind = 'extensions' | 'removed' | 'namespace' | 'backing';

/** The refusal of a protected change to a manifest: the spaces it touches, and how. */
export interface FenceChangeRefusal {
    status: 403;
    code: 'ACCESS_DENIED';
    message: string;
    details: { reason: 'FENCE_CHANGE'; spaces: Array<{ space: string; change: FenceChangeKind }> };
}

/** What the rule answers: the write into a fenced space, or the change to a fenced space's list. */
export type FenceRefusal = FencedSpaceRefusal | FenceChangeRefusal;

/**
 * What a write-mode operation that names a workspace's manifest record will store, when the code
 * path knows it. `after` is the value itself, which is compared with the manifest that counts.
 * `keepsFences` is for a code path that joins object types and changes none (unionObjectTypes) and
 * makes its own comparison before it writes. A code path that hands over neither is read as the
 * removal of every fence, which is what a delete is and what a replacement of unknown value may be.
 */
export type ManifestWrite = { after: unknown } | { keepsFences: true };

/**
 * What the operation touches. `key` and `keys` are record keys in any form (bare, `.draft`,
 * `.latest`, `.version.N`). `subtree` is a key whose whole subtree the operation touches: the
 * archive of a record or of a space, which also covers a fenced space that lies INSIDE the subtree.
 */
export type FenceTarget = { key: string } | { keys: readonly string[] } | { subtree: string };

/**
 * What an archive or unarchive touches, as a target of this rule: a record's subtree or a space's.
 * Null for a whole workspace or organism, which this rule leaves to the creator-or-admin rule.
 */
export function archiveFenceTarget(
    t: { level: string; orgId: string; ws?: string; namespace?: string; key?: string },
): FenceTarget | null {
    if (!t.ws) return null;
    if (t.level === 'record' && t.key) return { subtree: t.key };
    if (t.level === 'space' && t.namespace) return { subtree: `organism.${t.orgId}.w.${t.ws}.${t.namespace}` };
    return null;
}

/** One `installer/name` entry: neither part empty, no whitespace, exactly one slash. The row
 *  service's test (workspace-rows/row-space.ts), so one entry means the same on both backings. */
const ENTRY = /^[^/\s]+\/[^/\s]+$/;

/** `installer/name`, lower-cased: the marker the capability puts on its caller, and the form a
 *  manifest entry is compared in. */
export function extensionMarker(installer: string, name: string): string {
    return `${installer.trim().toLowerCase()}/${name.trim().toLowerCase()}`;
}

/**
 * Is this identity a person's own, on this node? Asked only when there is no session to ask. By
 * shape, not by the naming rules: `name@this-node` with no `#` (an agent) and no `eco:` prefix (an
 * ecosystem app). An account made before today's naming rules is still a person's. One `@` only:
 * a visitor's home identity with this node appended (`alice@their-node@this-node`) is a visitor.
 */
function isLocalPersonIdentity(identity: string, nodeId: string): boolean {
    if (identity.includes('#') || isGEAI(identity)) return false;
    const at = identity.lastIndexOf('@');
    return at > 0 && identity.indexOf('@') === at && identity.slice(at + 1) === nodeId;
}

/**
 * Does the rule apply to this caller? Roles first: the account holder in person and a hosted
 * app's grant write directly. A hosted app's grant is the role `app` ALONE, which is what
 * routes/app-grants.ts and services/schedule-actor.ts mint; the role beside any other one is not
 * that grant, so it is fenced.
 *
 * Every other session is fenced unless its scopes cover `organism:direct`: the account holder gave
 * that session the permission to write such a space directly. The scopes count only beside a
 * session's roles: an identity with no session is decided by its shape.
 */
export function callerIsFenced(caller: FenceCaller, nodeId: string): boolean {
    if (caller.roles === undefined) return !isLocalPersonIdentity(caller.principal, nodeId);
    const roles = caller.roles;
    if (isOwnerInPerson({ roles })) return false;
    if (isHostedAppGrant(roles)) return false;
    return !scopeIsCovered(caller.scopes ?? [], DIRECT_WRITE_SCOPE);
}

/** A hosted app's grant: the role `app` and no other. */
function isHostedAppGrant(roles: readonly string[]): boolean {
    return roles.length === 1 && roles[0] === 'app';
}

/**
 * May this caller change the list of a fenced space? The account holder in person, or a session
 * whose scopes cover `organism:direct`. A hosted app's grant may not, whatever words it holds: it
 * writes records directly because it acts as its person, and its way to a list is the add-only
 * route (services/workspace-space-extensions.ts). A caller with no session may not either: no code
 * path changes a manifest without one.
 */
export function mayChangeFence(caller: FenceCaller): boolean {
    if (caller.roles === undefined) return false;
    if (isOwnerInPerson({ roles: caller.roles })) return true;
    if (isHostedAppGrant(caller.roles)) return false;
    return scopeIsCovered(caller.scopes ?? [], DIRECT_WRITE_SCOPE);
}

/**
 * The fence an object type declares, or null when it declares none.
 *
 * Only a memory-backed space: a row space reads the same field under its own rule
 * (workspace-rows/row-service.ts authorizeExtension), and a tasks space holds no records.
 * A value that is not a list (the manifest schema asks for one) names no extension this rule can
 * trust, so it closes the space as a list of invalid entries does.
 */
export function fenceOf(ot: { name?: unknown; namespace?: unknown; backing?: unknown; extensions?: unknown } | null | undefined): SpaceFence | null {
    if (!ot || typeof ot.namespace !== 'string' || !ot.namespace) return null;
    if (!isMemoryBackedSpace(ot)) return null;
    const raw = ot.extensions;
    if (raw === undefined || raw === null) return null;
    if (Array.isArray(raw) && raw.length === 0) return null;
    const entries: unknown[] = Array.isArray(raw) ? raw : [];
    const extensions = [...new Set(entries
        .filter((e): e is string => typeof e === 'string' && ENTRY.test(e.trim()))
        .map(e => e.trim().toLowerCase()))];
    return { space: typeof ot.name === 'string' && ot.name ? ot.name : ot.namespace, namespace: ot.namespace, extensions };
}

/** Every fence a manifest declares. */
export function fencesOf(manifest: WorkspaceManifest | null | undefined): SpaceFence[] {
    const types = Array.isArray(manifest?.objectTypes) ? manifest.objectTypes : [];
    return types.map(fenceOf).filter((f): f is SpaceFence => f !== null);
}

/** The fences a target meets. `root` is `organism.<org>.w.<ws>`. */
export function fencesMet(fences: readonly SpaceFence[], root: string, target: FenceTarget): SpaceFence[] {
    if ('subtree' in target) {
        const at = target.subtree.replace(/\.+$/, '');
        return fences.filter(f => {
            const space = `${root}.${f.namespace}`;
            return at === space || at.startsWith(`${space}.`) || space.startsWith(`${at}.`);
        });
    }
    const keys = 'keys' in target ? target.keys : [target.key];
    return fences.filter(f => keys.some(k => k.startsWith(`${root}.${f.namespace}.`)));
}

/**
 * The one sentence every code path answers with. It names the extensions, because that is what the
 * caller can act on: the app's tool is an action of one of them.
 */
export function fencedSpaceMessage(extensions: readonly string[]): string {
    if (extensions.length === 0) {
        return "This space takes an agent's write only through the app's own tool, and it names no tool that can be used. Ask the workspace's creator to correct the list.";
    }
    const which = extensions.length === 1 ? `the extension ${extensions[0]}` : `one of the extensions ${extensions.join(', ')}`;
    return `This space takes an agent's write only through the app's own tool. Use an action of ${which} to add, change or remove a record here.`;
}

/**
 * What a visitor of a public form reads when the form's stored identity may not write the space.
 * It names neither the space nor an extension: `installer/name` holds an account name, and the
 * visitor is not signed in. The person who can act on it is the form's owner.
 */
export const FENCED_FORM_PUBLIC_MESSAGE = 'This form cannot take a message at the moment. Tell the owner of the page that the form needs to be set up again.';

function refusalFor(fence: SpaceFence): FencedSpaceRefusal {
    return {
        status: 403, code: 'ACCESS_DENIED', message: fencedSpaceMessage(fence.extensions),
        details: { reason: 'FENCED_SPACE', space: fence.space, extensions: [...fence.extensions] },
    };
}

/** The object types of a manifest value of any shape; a value that holds none gives an empty list. */
function objectTypesOf(manifest: unknown): Array<Record<string, unknown>> {
    const list = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
        ? (manifest as { objectTypes?: unknown }).objectTypes : undefined;
    return Array.isArray(list)
        ? list.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o))
        : [];
}

/** Two `extensions` values are the same list only when they are the same value, entry for entry. */
function sameList(a: unknown, b: unknown): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The fences a manifest change touches: every memory-backed object type that declares a fence
 * BEFORE the change and does not stand the same AFTER it.
 *
 * A fence stands the same when the manifest after the change holds a memory-backed object type on
 * the same namespace with the same `extensions` value. The namespace is what the rule matches a
 * record by, so that is what the comparison follows: a new name on the same namespace and list
 * changes nothing the rule reads. The list is compared as written, so a reordered or respelled
 * list is a change. A manifest that is gone or holds no object types removes every fence.
 *
 * Not touched, and so never protected: an object type with no fence (changed, removed, or given a
 * list), a row space's list (the row service reads it under its own rule), and a new object type.
 */
export function protectedFenceChanges(before: unknown, after: unknown): Array<{ space: string; change: FenceChangeKind }> {
    const afterTypes = objectTypesOf(after);
    const touched: Array<{ space: string; change: FenceChangeKind }> = [];
    for (const ot of objectTypesOf(before)) {
        const fence = fenceOf(ot);
        if (!fence) continue;
        const onNamespace = afterTypes.filter(o => o.namespace === fence.namespace);
        const memoryBacked = onNamespace.filter(o => isMemoryBackedSpace(o));
        if (memoryBacked.some(o => sameList(o.extensions, ot.extensions))) continue;
        const change: FenceChangeKind = memoryBacked.length ? 'extensions'
            : onNamespace.length ? 'backing'
                : afterTypes.some(o => o.name === ot.name) ? 'namespace' : 'removed';
        touched.push({ space: fence.space, change });
    }
    return touched;
}

/**
 * The one sentence a refused change answers with. It says who makes the change and names the
 * permission, because that is what the caller's person can act on.
 */
export function fenceChangeMessage(spaces: readonly string[]): string {
    const which = spaces.length === 1 ? `the space ${spaces[0]}` : `the spaces ${spaces.join(', ')}`;
    return `The list of extensions of a space that an app closed to agents is changed by the account holder in person, or by an agent that holds the permission ${DIRECT_WRITE_SCOPE}. This change touches ${which}, so nothing was written.`;
}

/**
 * The comparison every code path that writes a manifest makes before the write: null when the
 * change is allowed, else the refusal. `before` is the manifest that counts and `after` the value
 * about to be stored, each in any shape.
 *
 * A protected change (protectedFenceChanges) is accepted from the account holder in person and
 * from a session whose scopes cover `organism:direct` (mayChangeFence). Every other change is
 * accepted from whoever the code path's own checks let this far.
 */
export function fenceChangeRefusal(before: unknown, after: unknown, caller: FenceCaller): FenceChangeRefusal | null {
    if (mayChangeFence(caller)) return null;
    const spaces = protectedFenceChanges(before, after);
    if (spaces.length === 0) return null;
    return {
        status: 403, code: 'ACCESS_DENIED', message: fenceChangeMessage(spaces.map(s => s.space)),
        details: { reason: 'FENCE_CHANGE', spaces },
    };
}

/** The key of a workspace's manifest record. Readers take this exact key and no suffixed form. */
function manifestKeyOf(organismId: string, wsId: string): string {
    return `organism.${organismId}.w.${wsId}.meta.manifest`;
}

/** Does the target name this exact key? A subtree does not: an archive changes no value. */
function targetNames(target: FenceTarget, key: string): boolean {
    if ('key' in target) return target.key === key;
    if ('keys' in target) return target.keys.includes(key);
    return false;
}

/**
 * The rule for a write-mode operation on a workspace's manifest RECORD: null when allowed, else
 * the refusal. The manifest is a memory record, so the generic memory code paths reach it, and a
 * copy stored under an agent of the workspace's creator counts when it is the newest. A caller who
 * may change a fence returns before the manifest is read.
 */
export async function manifestWriteRefusal(
    deps: FenceDeps, caller: FenceCaller, organismId: string, wsId: string, write?: ManifestWrite,
): Promise<FenceChangeRefusal | null> {
    if (mayChangeFence(caller)) return null;
    if (write && 'keepsFences' in write) return null;
    const record = await readWorkspaceMetaRecord(deps.storage, organismId, wsId, 'meta.manifest', deps.config.nodeId, { archived: 'include' });
    return fenceChangeRefusal(record?.value, write ? write.after : null, caller);
}

/**
 * The rule for one workspace: null when the operation is allowed, else the refusal.
 *
 * A caller the rule allows directly returns before the manifest is read. The manifest is the copy
 * that counts, archived or not: an archived workspace's records are unarchived one by one, and its
 * fence still holds then.
 *
 * A target that names the workspace's manifest record is asked manifestWriteRefusal() first, with
 * `write` when the code path knows the value it stores. That question has its own callers allowed
 * (mayChangeFence): a hosted app writes a fenced space and does not change its list.
 */
export async function fencedSpaceRefusal(
    deps: FenceDeps, caller: FenceCaller, organismId: string, wsId: string, target: FenceTarget, write?: ManifestWrite,
): Promise<FenceRefusal | null> {
    if (targetNames(target, manifestKeyOf(organismId, wsId))) {
        const changed = await manifestWriteRefusal(deps, caller, organismId, wsId, write);
        if (changed) return changed;
    }
    if (!callerIsFenced(caller, deps.config.nodeId)) return null;
    const record = await readWorkspaceMetaRecord(deps.storage, organismId, wsId, 'meta.manifest', deps.config.nodeId, { archived: 'include' });
    const fences = fencesOf(record?.value as WorkspaceManifest | null | undefined);
    if (fences.length === 0) return null;
    const through = (caller.extension ?? '').trim().toLowerCase();
    for (const fence of fencesMet(fences, `organism.${organismId}.w.${wsId}`, target)) {
        if (!through || !fence.extensions.includes(through)) return refusalFor(fence);
    }
    return null;
}

/**
 * The rule for a public intake form (routes/organisms/intake.ts, intake-thread.ts). A form's
 * records are written under the identity that defined it, with no session present, so the rule is
 * asked for THAT identity: with the session's `roles` when the form is being defined, and with
 * none when a visitor submits, where the stored identity's shape decides. The target is the whole
 * destination namespace, because the node makes the record ids.
 *
 * No scopes are taken, so the permission `organism:direct` does not open this: it is a session's,
 * a submission holds no session, and a form defined on the word would be stored under an agent's
 * identity and then take no message.
 */
export function fencedFormRefusal(
    deps: FenceDeps, identity: string, roles: readonly string[] | undefined, organismId: string, wsId: string, namespace: string,
): Promise<FenceRefusal | null> {
    return fencedSpaceRefusal(deps, { principal: identity, ...(roles ? { roles } : {}) },
        organismId, wsId, { subtree: `organism.${organismId}.w.${wsId}.${namespace}` });
}

const WORKSPACE_KEY = /^organism\.([^.]+)\.w\.([^.]+)\./;

/**
 * The rule for a list of keys that may lie in several workspaces (the bulk delete): one manifest
 * read per workspace named, and none for a caller the rule allows directly. A key outside every
 * workspace is not this rule's. A key that is a workspace's manifest record is asked as a removal of
 * that manifest (fencedSpaceRefusal), which a hosted app is refused too.
 */
export async function fencedKeysRefusal(
    deps: FenceDeps, caller: FenceCaller, keys: Iterable<string>,
): Promise<FenceRefusal | null> {
    if (!callerIsFenced(caller, deps.config.nodeId) && mayChangeFence(caller)) return null;
    const byWorkspace = new Map<string, { organismId: string; wsId: string; keys: string[] }>();
    for (const key of keys) {
        const m = WORKSPACE_KEY.exec(key);
        if (!m) continue;
        const group = byWorkspace.get(`${m[1]}/${m[2]}`) ?? { organismId: m[1], wsId: m[2], keys: [] };
        group.keys.push(key);
        byWorkspace.set(`${m[1]}/${m[2]}`, group);
    }
    for (const group of byWorkspace.values()) {
        const refusal = await fencedSpaceRefusal(deps, caller, group.organismId, group.wsId, { keys: group.keys });
        if (refusal) return refusal;
    }
    return null;
}
