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
 * @structure
 *   - FenceCaller / callerIsFenced() — who the rule lets write directly
 *   - SpaceFence / fenceOf() — the fence one object type declares, or none
 *   - extensionMarker() — `installer/name`, as the capability marks its caller
 *   - fencedSpaceRefusal() — the rule for one workspace; fencedKeysRefusal() for keys of several
 *   - archiveFenceTarget() — what an archive or unarchive touches, as a target of the rule
 *   - fencedFormRefusal() — the rule for the identity a public intake form writes under
 *   - fencedSpaceMessage() — the one sentence every code path answers with
 * @usage
 *   const fenced = await fencedSpaceRefusal({ storage, config }, { principal, roles }, orgId, wsId, { key });
 *   if (fenced) return res.status(fenced.status).json(error(config.nodeId, fenced.code, fenced.message, fenced.status, fenced.details));
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import { isOwnerInPerson, isGEAI } from '../utils/gaii.js';
import { isMemoryBackedSpace, readWorkspaceMetaRecord, type WorkspaceManifest } from './workspace-meta.js';

export interface FenceDeps { storage: Storage; config: { nodeId: string } }

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
 */
export function callerIsFenced(caller: FenceCaller, nodeId: string): boolean {
    if (caller.roles === undefined) return !isLocalPersonIdentity(caller.principal, nodeId);
    const roles = caller.roles;
    if (isOwnerInPerson({ roles })) return false;
    const hostedApp = roles.length === 1 && roles[0] === 'app';
    return !hostedApp;
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

/**
 * The rule for one workspace: null when the operation is allowed, else the refusal.
 *
 * A caller the rule allows directly returns before the manifest is read. The manifest is the copy
 * that counts, archived or not: an archived workspace's records are unarchived one by one, and its
 * fence still holds then.
 */
export async function fencedSpaceRefusal(
    deps: FenceDeps, caller: FenceCaller, organismId: string, wsId: string, target: FenceTarget,
): Promise<FencedSpaceRefusal | null> {
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
 */
export function fencedFormRefusal(
    deps: FenceDeps, identity: string, roles: readonly string[] | undefined, organismId: string, wsId: string, namespace: string,
): Promise<FencedSpaceRefusal | null> {
    return fencedSpaceRefusal(deps, { principal: identity, ...(roles ? { roles } : {}) },
        organismId, wsId, { subtree: `organism.${organismId}.w.${wsId}.${namespace}` });
}

const WORKSPACE_KEY = /^organism\.([^.]+)\.w\.([^.]+)\./;

/**
 * The rule for a list of keys that may lie in several workspaces (the bulk delete): one manifest
 * read per workspace named, and none for a caller the rule allows directly. A key outside every
 * workspace is not this rule's.
 */
export async function fencedKeysRefusal(
    deps: FenceDeps, caller: FenceCaller, keys: Iterable<string>,
): Promise<FencedSpaceRefusal | null> {
    if (!callerIsFenced(caller, deps.config.nodeId)) return null;
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
