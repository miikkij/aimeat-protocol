/**
 * @file src/services/workspace-space-extensions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Name an extension on one space of an existing workspace: add `installer/name`
 *   entries to that object type's `extensions` in the workspace manifest. The body of
 *   POST /v1/organisms/:id/workspace/spaces/:space/extensions.
 *
 *   WHY IT EXISTS. Ruled by the developer on 2026-10-13, part 2 of the recommendation he accepted
 *   ("tehdään niinkuin suosittelet"). An app builds its spaces first and installs its extension
 *   later, and the list of a space that already names extensions is protected: a hosted app's grant
 *   may not replace a manifest that holds one (services/fenced-space.ts fenceChangeRefusal). This is
 *   the app's own way to that list. It ADDS and never removes, and it adds only an extension of the
 *   caller's own account, so the most it does is close a space further or open it to the caller's
 *   own code.
 *
 *   WHAT IT DOES TO A SPACE. On a memory-backed space the first entry makes the space fenced (an
 *   agent's write is then taken only through a named extension) and a further entry widens the
 *   fence. On a row space it opens the space to that extension's row calls, as a manifest edit by
 *   the creator does (services/workspace-rows/row-service.ts authorizeExtension). A tasks space
 *   holds no records and is refused.
 *
 *   WHO MAY CALL IT, all of them, in this order:
 *     1. the session is the account holder in person, a hosted app's grant, or one whose scopes
 *        cover `organism:direct`: exactly the callers the fenced-space rule lets write a fenced
 *        space directly (callerIsFenced), so an agent that could not write the space cannot change
 *        who can;
 *     2. the caller's account is an active member of the organism;
 *     3. the caller's account is the workspace's creator, or a creator or admin of the organism:
 *        the test updateWorkspaceMeta makes for PUT /v1/organisms/:id/workspace.
 *   The route asks `organism:write` of the session before any of this.
 *
 *   WHICH ENTRIES. Each is `installer/name` of an extension INSTALLED on this node whose installer
 *   is the caller's own account, compared as bare account names, lower-cased, the way the row
 *   service names an installer. One entry that fails refuses the whole call, and nothing is written.
 *   An entry already in the list is not an error.
 *
 *   REFUSE BEFORE YOU WRITE: every refusal below comes before the one storage write, which goes
 *   into the copy of the manifest that counts (writeWorkspaceMetaRecord), keeps its owner and raises
 *   its version, as every other manifest change does.
 * @structure
 *   - MAX_ENTRIES_PER_CALL
 *   - NameExtensionsCaller / NameExtensionsResult
 *   - nameSpaceExtensions() — the whole operation
 * @usage
 *   const r = await nameSpaceExtensions({ storage, config }, caller, { orgId, ws, space, add });
 *   if (isRefusal(r)) return res.status(r.status).json(error(config.nodeId, r.code, r.message, r.status, r.details));
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import { localAccountName } from '../utils/gaii.js';
import { validateMemoryWrite } from './schema-validator.js';
import { emitChange } from './event-bus.js';
import { updateOrganismStructure } from './structure-snapshot.js';
import { logger } from '../utils/logger.js';
import { archivedRefusal } from './workspace-write-guards.js';
import {
    findWorkspaceRegistration, readWorkspaceMetaRecord, writeWorkspaceMetaRecord, isMemoryBackedSpace, isRowBackedSpace,
} from './workspace-meta.js';
import { callerIsFenced, extensionMarker, fenceOf, DIRECT_WRITE_SCOPE } from './fenced-space.js';
import { refusal, type ChangeDeps, type ChangeRefusal } from './workspace-change-core.js';

/** How many entries one call adds. A space names a handful of extensions, never a catalogue. */
export const MAX_ENTRIES_PER_CALL = 5;

/** One `installer/name` entry: neither part empty, no whitespace, exactly one slash (the fence's test). */
const ENTRY = /^[^/\s]+\/[^/\s]+$/;

/** The session that asks: its identity, the account it acts in, its roles and its scope words. */
export interface NameExtensionsCaller {
    principal: string;
    /** The bare account name. Memberships and an extension's installer are compared with it. */
    owner: string;
    roles: readonly string[];
    scopes: readonly string[];
}

export interface NameExtensionsResult {
    ws: string;
    /** The space after the call, with its whole list. */
    space: { name: string; namespace: string; backing: string; extensions: string[] };
    /** The entries this call added. */
    added: string[];
    /** The entries that were already in the list. */
    already: string[];
    /** True when the space takes the write of a caller that is not a person only through its list. */
    fenced: boolean;
}

/** `add` as a list of 1 to 5 entries, trimmed and lower-cased, once each; or what is wrong with it. */
function entriesOf(add: unknown): string[] | { error: string } {
    if (!Array.isArray(add) || add.length < 1 || add.length > MAX_ENTRIES_PER_CALL) {
        return { error: `Send add: a list of 1 to ${MAX_ENTRIES_PER_CALL} extensions, each written installer/name.` };
    }
    const out: string[] = [];
    for (const raw of add) {
        const entry = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        if (!ENTRY.test(entry)) {
            return { error: `"${typeof raw === 'string' ? raw : JSON.stringify(raw)}" is not an extension written installer/name, such as alice/my-extension.` };
        }
        if (!out.includes(entry)) out.push(entry);
    }
    return out;
}

/**
 * Add entries to one space's list of extensions. Answers the space with its list, or a refusal with
 * the status and code the route sends.
 */
export async function nameSpaceExtensions(
    deps: ChangeDeps, caller: NameExtensionsCaller,
    args: { orgId: string; ws: string; space: string; add: unknown },
): Promise<NameExtensionsResult | ChangeRefusal> {
    const { storage, config } = deps;
    const { orgId, ws, space } = args;

    const entries = entriesOf(args.add);
    if ('error' in entries) return refusal(400, 'INVALID_INPUT', entries.error);

    // 1. The kind of caller: whoever the fenced-space rule lets write a fenced space directly.
    if (callerIsFenced({ principal: caller.principal, roles: caller.roles, scopes: caller.scopes }, config.nodeId)) {
        return refusal(403, 'ACCESS_DENIED',
            `Naming an extension on a space is done by the account holder in person, by an app the account holder signed in to, or by an agent that holds the permission ${DIRECT_WRITE_SCOPE}. This session is none of them.`);
    }

    // 2 and 3. The organism, the membership, the workspace, and creator-or-admin.
    const organism = await storage.getOrganism(orgId);
    if (!organism) return refusal(404, 'NOT_FOUND', 'Organism not found');
    const membership = caller.owner ? await storage.getMembership(orgId, caller.owner) : null;
    if (!membership || membership.status !== 'active') {
        return refusal(403, 'ACCESS_DENIED', 'Not an active member of this organism');
    }
    const registration = await findWorkspaceRegistration(storage, orgId, ws);
    if (!registration) return refusal(404, 'NOT_FOUND', 'Workspace not found');
    const manager = membership.role === 'creator' || membership.role === 'admin';
    if (registration.creator !== caller.owner && !manager) {
        return refusal(403, 'ACCESS_DENIED', 'Only the workspace creator (or an org admin) can name an extension on one of its spaces.');
    }
    const archived = await archivedRefusal(storage, `organism.${orgId}.w.${ws}.`);
    if (archived) return refusal(409, 'ARCHIVED', archived);

    // The space, from the manifest that counts.
    const man = await readWorkspaceMetaRecord(storage, orgId, ws, 'meta.manifest', config.nodeId);
    const value = man?.value && typeof man.value === 'object' && !Array.isArray(man.value) ? man.value as Record<string, unknown> : null;
    if (!man || !value || !Array.isArray(value.objectTypes)) {
        return refusal(409, 'NO_STRUCTURE', 'This workspace has no structure yet, so it has no space to name an extension on. Its creator sets it up first.');
    }
    const types = value.objectTypes as Array<Record<string, unknown>>;
    const at = types.findIndex(o => !!o && typeof o === 'object' && typeof o.namespace === 'string' && !!o.namespace && (o.name === space || o.namespace === space));
    if (at < 0) {
        const names = types.filter(o => !!o && typeof o === 'object').map(o => String(o.name ?? o.namespace)).join(', ');
        return refusal(404, 'NOT_FOUND', `This workspace has no space "${space}". Its spaces: ${names || 'none yet'}.`);
    }
    const ot = types[at];
    if (!isMemoryBackedSpace(ot) && !isRowBackedSpace(ot)) {
        return refusal(400, 'INVALID_INPUT', `The space "${String(ot.name ?? ot.namespace)}" points at the task system and holds no records, so no extension writes it. Name the extension on a space that holds records, documents or rows.`);
    }
    const current = ot.extensions;
    if (current !== undefined && current !== null && !Array.isArray(current)) {
        return refusal(409, 'INVALID_STATE', `The extensions of the space "${String(ot.name ?? ot.namespace)}" are not a list, so nothing can be added to them. Its creator corrects the manifest first.`);
    }

    // The entries: installed on this node, by the caller's own account.
    const account = caller.owner.trim().toLowerCase();
    for (const entry of entries) {
        const [installer, name] = entry.split('/');
        if (installer !== account) {
            return refusal(400, 'INVALID_INPUT', `${entry} names an extension of another account. A caller names only extensions its own account installed, written ${account}/name.`);
        }
        const ext = await storage.getExtension(name);
        if (!ext || localAccountName(ext.installedBy ?? '').toLowerCase() !== account) {
            return refusal(400, 'INVALID_INPUT', `${entry} is not an extension installed on this node by ${account}. Install it first, then name it.`);
        }
        // The form the capability marks its caller with, so what is stored is what is compared.
        if (extensionMarker(installer, ext.name) !== entry) {
            return refusal(400, 'INVALID_INPUT', `${entry} is not the name the extension is installed under.`);
        }
    }

    const existing = Array.isArray(current) ? current : [];
    const held = new Set(existing.filter((e): e is string => typeof e === 'string').map(e => e.trim().toLowerCase()));
    const added = entries.filter(e => !held.has(e));
    const already = entries.filter(e => held.has(e));
    const next = [...existing, ...added];
    const answer = (list: unknown[]): NameExtensionsResult => {
        const after = { ...ot, extensions: list };
        return {
            ws,
            space: {
                name: String(ot.name ?? ot.namespace), namespace: String(ot.namespace),
                backing: isRowBackedSpace(ot) ? 'rows' : 'memory',
                extensions: list.filter((e): e is string => typeof e === 'string'),
            },
            added, already, fenced: fenceOf(after) !== null,
        };
    };
    if (added.length === 0) return answer(existing);

    const manifestValue: Record<string, unknown> = {
        ...value, objectTypes: types.map((o, i) => (i === at ? { ...o, extensions: next } : o)),
    };
    const root = `organism.${orgId}.w.${ws}`;
    const valid = await validateMemoryWrite(`${root}.meta.manifest`, manifestValue, storage);
    if (!valid.valid) {
        return refusal(400, 'INVALID_INPUT', 'The workspace manifest would not be valid with these entries: ' + JSON.stringify(valid.errors), { violations: valid.errors });
    }
    await writeWorkspaceMetaRecord(storage, `${root}.meta.manifest`, man.ownerGaii, manifestValue, man);
    emitChange('organisms');
    void updateOrganismStructure(storage, config, orgId, { event: 'workspace updated', actor: caller.principal })
        .catch(err => { logger.warn('nameSpaceExtensions: the timeline is best-effort', { error: String(err) }); });
    return answer(next);
}
