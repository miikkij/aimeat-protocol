/**
 * @file workspace-write-items.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared normalisation for workspace draft writes — the part `aimeat_workspace_write`
 *   does identically on all three MCP surfaces (the node-hosted server, the `aimeat connect` CLI
 *   server, and the tool-call definition table). One call may carry ONE item (space + value) or a
 *   BATCH (`items: [...]`), and a batch matters for more than round trips: an MCP client asks the
 *   human to approve every tool CALL, so migrating twenty documents one call at a time is twenty
 *   approval prompts — and one unanswered prompt ends the migration half-done.
 *
 *   The batch is all-or-nothing at the RESOLVE stage: every item is checked (space exists, is
 *   memory-backed, has an id where one is required) before anything is written. Documents get an
 *   auto-generated id when the caller gives none, so a half-written batch that the caller retries
 *   would otherwise duplicate the documents that already landed.
 * @structure MAX_BATCH_ITEMS · genDocId() · normalizeWriteItems() · resolveSpace() · resolveWriteItem()
 *   · isPlatformWorkspaceNamespace() · undeclaredSpaceRefusal() · readPublishSpace() · undeclaredSpaceForKey()
 * @usage const norm = normalizeWriteItems({ space, value, id, section, items });
 *   if ('error' in norm) return fail(norm.error);
 *   const resolved = norm.items.map(it => resolveWriteItem(it, objectTypes));
 *   const refusal = await undeclaredSpaceForKey(storage, key);   // before anything is written
 * @version-history
 *   v1.3.0 — 2026-09-13 — UNDECLARED_SPACE is a REFUSAL on every door, decided by the developer on
 *     2026-09-13: 422, nothing written, naming the namespace, the spaces the manifest declares and how
 *     to declare one. undeclaredSpaceRefusal() is the one decision and the one wording; resolveSpace()
 *     (the MCP, connector and CLI workspace write, the document edits) and readPublishSpace() /
 *     undeclaredSpaceForKey() (the memory doors, publishDraft, the batch publish, intake) all return
 *     it. A workspace with no manifest declares nothing and is refused the same way. The workspace's
 *     own meta.* keys and the node-owned skills.* and access.* keys are not spaces and are exempt
 *     (isPlatformWorkspaceNamespace), because a skill file named `notes.draft` parses as a record.
 *   v1.2.0 — 2026-09-13 — UNDECLARED_SPACE: the warning a memory write or a publish carries when the
 *     workspace manifest declares no space for its namespace. The MCP write door refused that write
 *     here, while POST /v1/memory, the SDK's writeDraft and both publish doors stored the record and
 *     answered success, and the workspace read, which lists declared spaces only, never showed it.
 *     A production CRM ran a month and forty-four releases with four such spaces.
 *     readPublishSpace() is the manifest read both publish paths made inline.
 *   v1.1.0 — 2026-09-02 — resolveSpace() split out of resolveWriteItem(), which now calls it. The
 *     in-place document edits need the same manifest lookup and the same two refusals, and a second
 *     copy of "No space named X" is a second sentence to keep true.
 *   v1.0.0 — 2026-07-31 — Initial: batch normalisation shared by the three workspace_write surfaces.
 */

import type { Storage, MemoryRecord } from '../storage/interface.js';
import { isMemoryBackedSpace } from './workspace-meta.js';
import { parseWorkspaceRecordKey } from './write-guards.js';

/** One tool call may carry this many items. Past this the caller should split the migration. */
export const MAX_BATCH_ITEMS = 50;

/** An objectType as the manifest declares it (only the fields a write needs). */
export interface WriteObjectType {
    name?: string;
    namespace?: string;
    mode?: string;
    kind?: string;
    backing?: string;
}

/** One requested write, after the top-level defaults have been folded in. */
export interface WriteItemInput {
    space: string;
    value: unknown;
    id?: string;
    section?: string;
}

/** A space the caller may write: it exists in the manifest, and it is memory-backed. */
export interface ResolvedSpace {
    /** The objectType NAME, which is what a caller and an error message should say. */
    name: string;
    /** Its namespace, which is what the memory key is built from. */
    namespace: string;
    /** Documents (`{ title, markdown }`) rather than schema-validated records. */
    isDoc: boolean;
}

/** A write the caller may perform: the space is real, memory-backed, and the id is settled. */
export interface ResolvedWriteItem {
    space: string;
    namespace: string;
    instanceId: string;
    isDoc: boolean;
    value: unknown;
    section?: string;
}

/** Document ids are generated when the caller gives none — unique per item within a batch. */
export function genDocId(): string {
    return 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Fold a call's arguments into a list of items. Single-item and batch calls come out the same shape,
 * so every surface has one code path below this line.
 *
 * `items` entries inherit `space` and `section` from the top level, which is what a migration into
 * one space actually looks like — the caller repeats only what differs.
 */
export function normalizeWriteItems(args: {
    space?: unknown;
    value?: unknown;
    id?: unknown;
    section?: unknown;
    items?: unknown;
}): { items: WriteItemInput[] } | { error: string } {
    const topSpace = typeof args.space === 'string' ? args.space.trim() : '';
    const topSection = typeof args.section === 'string' ? args.section.trim() : '';

    if (args.items !== undefined && args.items !== null) {
        // Some clients JSON-stringify an array param; accept that rather than failing on a string.
        let raw = args.items;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch { return { error: '`items` must be an array of objects (it arrived as a string that is not JSON).' }; }
        }
        if (!Array.isArray(raw)) return { error: '`items` must be an ARRAY of { space?, id?, value, section? } objects.' };
        if (raw.length === 0) return { error: '`items` is empty — pass at least one item, or use `value` for a single write.' };
        if (raw.length > MAX_BATCH_ITEMS) {
            return { error: `\`items\` holds ${raw.length} entries; the cap is ${MAX_BATCH_ITEMS} per call. Split the migration into batches of ${MAX_BATCH_ITEMS}.` };
        }
        const items: WriteItemInput[] = [];
        for (let i = 0; i < raw.length; i++) {
            const it = raw[i] as Record<string, unknown> | null;
            if (!it || typeof it !== 'object' || Array.isArray(it)) return { error: `items[${i}] must be an object with a \`value\`.` };
            const space = typeof it.space === 'string' && it.space.trim() ? it.space.trim() : topSpace;
            if (!space) return { error: `items[${i}] has no \`space\`, and no top-level \`space\` was given to fall back on.` };
            if (it.value === undefined || it.value === null) return { error: `items[${i}] has no \`value\`.` };
            const section = typeof it.section === 'string' && it.section.trim() ? it.section.trim() : topSection;
            items.push({
                space,
                value: it.value,
                ...(typeof it.id === 'string' && it.id.trim() ? { id: it.id.trim() } : {}),
                ...(section ? { section } : {}),
            });
        }
        return { items };
    }

    if (!topSpace) return { error: 'Pass `space` + `value` for one write, or `items: [...]` for several.' };
    if (args.value === undefined || args.value === null) return { error: 'Pass `value` for one write, or `items: [...]` for several.' };
    return {
        items: [{
            space: topSpace,
            value: args.value,
            ...(typeof args.id === 'string' && args.id.trim() ? { id: args.id.trim() } : {}),
            ...(topSection ? { section: topSection } : {}),
        }],
    };
}

/** Which workspace a refusal is about, so its repair can name the exact route to call. */
export interface WorkspaceCoordinate {
    organismId: string;
    ws: string;
}

/**
 * Resolve a space NAME (or its namespace) against the workspace manifest. A space the manifest does
 * not declare, or declares with a backing whose data does not live in workspace records, is refused
 * with undeclaredSpaceRefusal(), the one decision every door that writes a workspace record answers to.
 *
 * Shared by the write path below and by the in-place document edits (services/workspace-doc-edit.ts).
 * `at` names the item in a batch, so the caller learns WHICH of twenty documents was wrong instead of
 * that "the batch" failed. `where` names the workspace for the repair; the connector and CLI doors
 * that do not pass it get the route with its placeholders left in.
 *
 * `error` stays a plain string beside the refusal, because the connector MCP door and the CLI dispatch
 * render `error` and nothing else.
 */
export function resolveSpace(
    space: string,
    objectTypes: WriteObjectType[],
    at?: string,
    where?: WorkspaceCoordinate,
): ResolvedSpace | { error: string; refusal: UndeclaredSpaceRefusal } {
    const types = (objectTypes ?? []).filter((o): o is WriteObjectType => !!o && typeof o === 'object');
    const ot = types.find(o => (o.name === space || o.namespace === space) && !!o.namespace && isMemoryBackedSpace(o));
    if (!ot || !ot.namespace) {
        // Built by construction to refuse: no memory-backed space matched by name or namespace.
        const refusal = undeclaredSpaceRefusal(space, types, {
            organismId: where?.organismId ?? '{organism_id}', ws: where?.ws ?? '{ws}', acceptName: true, at,
        }) as UndeclaredSpaceRefusal;
        return { error: refusal.message, refusal };
    }
    return {
        name: ot.name || space,
        namespace: ot.namespace,
        // Old manifests declared documents as kind:'document' without a mode — honour the intent.
        isDoc: ot.mode === 'document' || (!ot.mode && ot.kind === 'document'),
    };
}

/** A space's manifest entry as a publish reads it: the retention and write-guard flags beside the name. */
export interface PublishObjectType extends WriteObjectType {
    versioned?: boolean;
    create_only?: boolean;
    requires_expected_version?: boolean;
    maxVersions?: number;
}

/**
 * Who will read a refusal, which decides how much of the manifest it may show.
 *   - 'member': a member, an agent or an app grant that passed the organism access rule, and so may
 *     read the manifest. Told the namespace, the declared spaces and how to declare one.
 *   - 'writer': an ecosystem app, which may hold a write area without the read area the manifest
 *     needs (services/ecosystem-access.ts). Told the namespace and how to declare it, not what is declared.
 *   - 'public': an anonymous submitter (public intake), who is told nothing about the workspace.
 */
export type UndeclaredSpaceAudience = 'member' | 'writer' | 'public';

/**
 * The refusal for a workspace record whose space the manifest does not declare. Its status and code
 * are what every door sends; `details` carries the same facts as fields a program can act on.
 * A type alias rather than an interface, so it is assignable to a door's `Record<string, unknown>`.
 */
export type UndeclaredSpaceRefusal = {
    ok: false;
    status: 422;
    code: 'UNDECLARED_SPACE';
    message: string;
    details: {
        namespace?: string;
        declared_spaces?: Array<{ name: string; namespace: string }>;
        backing?: string;
        how_to_fix: string;
    };
};

export interface UndeclaredSpaceContext extends WorkspaceCoordinate {
    /** Match a space by NAME as well as by namespace. Only a caller that names a space (the workspace
     *  write tools) sets this: a key carries a namespace, and a space whose name happens to equal it
     *  is not the namespace a workspace read lists. */
    acceptName?: boolean;
    audience?: UndeclaredSpaceAudience;
    /** Which item of a batch this is. */
    at?: string;
}

/**
 * Not a space at all: the workspace's own configuration (`meta.*`: manifest, readme, sections,
 * intake forms, comments), the skills published into it (`skills.{name}.manifest | .versions.{semver}
 * | .files.{path}`) and access requests (`access.request.{owner}`). The node writes these under the
 * workspace root and no manifest declares them. They must be named here rather than left to the key
 * parser: a skill file called `notes.draft`, or one under `refs.version.3`, has exactly the shape
 * parseWorkspaceRecordKey reads as a workspace record, and would be refused as one.
 */
export function isPlatformWorkspaceNamespace(namespace: string): boolean {
    const head = namespace.split('.')[0];
    return head === 'meta' || head === 'skills' || head === 'access';
}

/**
 * THE DECISION. Decided by the developer on 2026-09-13: a workspace record written or published into
 * a space the workspace manifest does not declare is refused, 422 UNDECLARED_SPACE, before anything is
 * written. Returns null when a memory-backed space declares `space`, and the refusal otherwise.
 *
 * Why refuse rather than store: a workspace read builds its spaces from the manifest, so such a record
 * is stored and listed by nothing. Every door but one answered that write with success, and a
 * production CRM wrote four such spaces for a month before anyone saw the tab was empty.
 *
 * A space declared with a backing whose data lives elsewhere (tasks, rows) is refused too, with the
 * way to reach that data instead. A workspace with no manifest declares nothing and is refused the
 * same way. Pure: the caller reads the manifest (readPublishSpace, or its own copy) and passes the
 * objectTypes of every copy it holds.
 */
export function undeclaredSpaceRefusal(
    space: string, objectTypes: WriteObjectType[], ctx: UndeclaredSpaceContext,
): UndeclaredSpaceRefusal | null {
    const types = (objectTypes ?? []).filter((o): o is WriteObjectType => !!o && typeof o === 'object');
    const matches = (o: WriteObjectType) => o.namespace === space || (ctx.acceptName === true && !!o.name && o.name === space);
    if (types.some(o => matches(o) && !!o.namespace && isMemoryBackedSpace(o))) return null;

    const at = ctx.at ? `${ctx.at}: ` : '';
    const audience = ctx.audience ?? 'member';
    const refusal = (message: string, details: UndeclaredSpaceRefusal['details']): UndeclaredSpaceRefusal =>
        ({ ok: false, status: 422, code: 'UNDECLARED_SPACE', message: at + message, details });

    if (audience === 'public') {
        const how = 'Tell whoever runs this form or workspace: its destination has to be declared as a space in the workspace before anything can be saved there.';
        return refusal(`Nothing was saved: the destination is not a space its workspace declares, so the record could never be listed. ${how}`, { how_to_fix: how });
    }

    const declareRoute = `PUT /v1/organisms/${ctx.organismId}/workspace?ws=${ctx.ws} with { add_object_types: [{ name, namespace, mode }], schemas }, or aimeat_workspace_update { organism_id, ws, add_spaces, schemas }`;
    const declareWho = 'Only the workspace creator or an organism admin may: a plain member is answered 403 NOT_CREATOR, and any other answer is a failure to show someone who can act.';

    const other = types.find(o => matches(o) && !isMemoryBackedSpace(o));
    if (other && audience === 'member') {
        const label = `"${other.name || space}"${other.namespace && other.namespace !== (other.name || space) ? ` (${other.namespace})` : ''}`;
        const how = other.backing === 'tasks'
            ? 'Create tasks with the task tools (aimeat_task_create) instead of writing workspace records.'
            : other.backing === 'rows'
                ? `Append rows with aimeat_workspace_rows_append or POST /v1/organisms/${ctx.organismId}/workspace/rows/${other.name || space}?ws=${ctx.ws} instead.`
                : 'Update the space to backing \'memory\' (aimeat_workspace_update); files and knowledge packages attach through workspace Sources or embedded document images.';
        return refusal(
            `Nothing was written: space ${label} has backing '${other.backing}', so its data does not live in workspace records and no workspace read would list this one. ${how}`,
            { namespace: other.namespace ?? space, backing: String(other.backing), how_to_fix: how },
        );
    }

    const declared = types
        .filter(o => typeof o.namespace === 'string' && !!o.namespace && isMemoryBackedSpace(o))
        .map(o => ({ name: o.name || (o.namespace as string), namespace: o.namespace as string }));
    const how = `Declare the space, then write again: ${declareRoute}. ${declareWho}`;
    const head = `Nothing was written: the manifest of workspace ${ctx.ws} declares no space "${space}" that holds workspace records, and a workspace read lists only the spaces its manifest declares.`;
    if (audience === 'writer') {
        return refusal(`${head} Ask the workspace creator or an organism admin to declare it: ${declareRoute}.`, { namespace: space, how_to_fix: how });
    }
    const list = declared.length
        ? declared.map(d => d.name === d.namespace ? d.namespace : `${d.name} (${d.namespace})`).join(', ')
        : 'none (a workspace without a manifest declares nothing, so check the ws id)';
    return refusal(
        `${head} Declared: ${list}. A workspace keeps the spaces it was created with, so one made from an older version of an app's manifest lacks the newer ones. ${how} Read the manifest back afterwards and compare its objectTypes with the ones the app ships.`,
        { namespace: space, declared_spaces: declared, how_to_fix: how },
    );
}

/**
 * Read the manifest entry a publish into `namespace` needs, and the UNDECLARED_SPACE refusal.
 *
 * `ot` comes from the first live copy of the manifest the scan returns, which is what both publish
 * paths read inline before this existed. The decision reads EVERY copy, archived ones included: a key
 * is unique per owner, so a workspace can hold more than one manifest, and a space any of them
 * declares is declared. An archived workspace is refused by the archive guard, which the doors run
 * separately and which says so; without the archived copies it would be refused here as having no
 * manifest, which is not true. The organism root (no `ws`) has no workspace manifest and is not refused.
 */
export async function readPublishSpace(
    storage: Storage, organismId: string, ws: string | undefined, namespace: string,
    opts?: { audience?: UndeclaredSpaceAudience },
): Promise<{ ot: PublishObjectType | undefined; refusal: UndeclaredSpaceRefusal | null }> {
    const mkey = `${ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`}.meta.manifest`;
    const copies = (await storage.listAllMemory({ prefix: mkey, limit: 10, archived: 'include' })).items.filter(r => r.key === mkey);
    const typesOf = (r: MemoryRecord | undefined): PublishObjectType[] =>
        (r?.value as { objectTypes?: PublishObjectType[] } | undefined)?.objectTypes ?? [];
    const ot = typesOf(copies.find(r => !r.archived) ?? copies[0]).find(o => o?.namespace === namespace);
    const refusal = ws && !isPlatformWorkspaceNamespace(namespace)
        ? undeclaredSpaceRefusal(namespace, copies.flatMap(typesOf), { organismId, ws, audience: opts?.audience })
        : null;
    return { ot, refusal };
}

/**
 * The UNDECLARED_SPACE refusal for a memory key, when it is a workspace record
 * (`organism.{org}.w.{ws}.{namespace}.{id}.draft|latest|version.N`) in a space the manifest does not
 * declare; null for every other key. What the memory doors call before they write.
 */
export async function undeclaredSpaceForKey(
    storage: Storage, key: string, opts?: { audience?: UndeclaredSpaceAudience },
): Promise<UndeclaredSpaceRefusal | null> {
    const parts = parseWorkspaceRecordKey(key);
    if (!parts) return null;
    return (await readPublishSpace(storage, parts.organismId, parts.ws, parts.namespace, opts)).refusal;
}

/**
 * Check one item against the workspace manifest and settle its id. Returns the resolved write or a
 * message written for the agent that has to fix the call; `refusal` is set when the space is the
 * problem, so a door can answer with its status and code.
 */
export function resolveWriteItem(
    item: WriteItemInput,
    objectTypes: WriteObjectType[],
    at?: string,
    where?: WorkspaceCoordinate,
): ResolvedWriteItem | { error: string; refusal?: UndeclaredSpaceRefusal } {
    const prefix = at ? `${at}: ` : '';
    const ot = resolveSpace(item.space, objectTypes, at, where);
    if ('error' in ot) return ot;
    const isDoc = ot.isDoc;
    const fromValue = item.value && typeof item.value === 'object' && !Array.isArray(item.value)
        ? String((item.value as Record<string, unknown>).id ?? '').trim()
        : '';
    let instanceId = item.id || fromValue;
    if (!instanceId && isDoc) instanceId = genDocId();
    if (!instanceId) return { error: `${prefix}A records write needs an id (pass \`id\`, or include \`id\` in \`value\`).` };
    return {
        space: ot.name || item.space,
        namespace: ot.namespace,
        instanceId,
        isDoc,
        value: item.value,
        ...(item.section ? { section: item.section } : {}),
    };
}
