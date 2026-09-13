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
 *   · undeclaredSpaceWarning() · readPublishSpace() · undeclaredSpaceForKey()
 * @usage const norm = normalizeWriteItems({ space, value, id, section, items });
 *   if ('error' in norm) return fail(norm.error);
 *   const resolved = norm.items.map(it => resolveWriteItem(it, objectTypes));
 * @version-history
 *   v1.2.0 — 2026-09-13 — UNDECLARED_SPACE: the warning a memory write or a publish carries when the
 *     workspace manifest declares no space for its namespace. The MCP write door refused that write
 *     here, while POST /v1/memory, the SDK's writeDraft and both publish doors stored the record and
 *     answered success, and the workspace read, which lists declared spaces only, never showed it.
 *     A production CRM ran a month and forty-four releases with four such spaces. Warned rather than
 *     refused on those doors, because live apps may keep keys there today (the 2026-09-13 default;
 *     whether to refuse later is the developer's decision). readPublishSpace() is the manifest read both publish paths made inline.
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

/**
 * Resolve a space NAME (or its namespace) against the workspace manifest, and refuse a backing whose
 * data does not live in workspace records.
 *
 * Shared by the write path below and by the in-place document edits (services/workspace-doc-edit.ts),
 * so "no space named X" and "that backing is not writable here" are one sentence with one meaning
 * however the caller arrived. `at` names the item in a batch, so the caller learns WHICH of twenty
 * documents was wrong instead of that "the batch" failed.
 */
export function resolveSpace(
    space: string,
    objectTypes: WriteObjectType[],
    at?: string,
): ResolvedSpace | { error: string } {
    const where = at ? `${at}: ` : '';
    const ot = objectTypes.find(o => o.name === space || o.namespace === space);
    if (!ot || !ot.namespace) {
        const names = objectTypes.map(o => o.name).filter(Boolean).join(', ');
        return { error: `${where}No space named "${space}" in this workspace. Available spaces: ${names || '(none)'}. Pass the space NAME, not its namespace.` };
    }
    // A non-memory space's data does NOT live in workspace records — writing it here would store
    // memory keys that no read surface ever lists. That silent black hole is how 16 published
    // documents once went invisible, so it is refused loudly instead.
    if (!isMemoryBackedSpace(ot)) {
        return {
            error: ot.backing === 'tasks'
                ? `${where}Space "${ot.name}" is backed by the task system (backing:'tasks') — create tasks with the task tools, not workspace writes.`
                : `${where}Space "${ot.name}" has backing '${ot.backing}', which workspace writes do not support. Update the space to backing:'memory' (aimeat_workspace_update); files and knowledge packages attach via workspace Sources or embedded document images.`,
        };
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
 * What a write or a publish answers, beside its success, when the workspace manifest declares no
 * memory-backed space for the record's namespace. The record IS stored; no workspace read lists it,
 * because the read builds its spaces from the manifest. The usual cause is a workspace created from
 * an older version of an app's manifest, which keeps the spaces it was made with.
 */
export interface UndeclaredSpaceWarning {
    code: 'UNDECLARED_SPACE';
    message: string;
    namespace: string;
    declared_spaces: Array<{ name: string; namespace: string }>;
    how_to_fix: string;
}

/**
 * The warning for `namespace` against a workspace's objectTypes, or null when a memory-backed space
 * declares it. A `meta.*` namespace is the workspace's own configuration and is never a space.
 */
export function undeclaredSpaceWarning(
    namespace: string, objectTypes: WriteObjectType[], organismId: string, ws: string,
): UndeclaredSpaceWarning | null {
    if (namespace === 'meta' || namespace.startsWith('meta.')) return null;
    const types = objectTypes.filter((o): o is WriteObjectType => !!o && typeof o === 'object');
    if (types.some(o => o.namespace === namespace && isMemoryBackedSpace(o))) return null;
    const declared = types
        .filter(o => typeof o.namespace === 'string' && isMemoryBackedSpace(o))
        .map(o => ({ name: o.name || (o.namespace as string), namespace: o.namespace as string }));
    const list = declared.map(d => `${d.name} (${d.namespace})`).join(', ') || '(none)';
    const otherBacking = types.find(o => o.namespace === namespace);
    return {
        code: 'UNDECLARED_SPACE',
        message: otherBacking
            ? `Stored, but no workspace read will list it: the space "${namespace}" has backing '${otherBacking.backing}', so its data does not live in workspace records. Spaces that do: ${list}.`
            : `Stored, but no workspace read will list it: this workspace's manifest declares no space "${namespace}". A workspace keeps the spaces it was created with, so one made from an older version of an app's manifest lacks the newer ones. Declared: ${list}.`,
        namespace,
        declared_spaces: declared,
        how_to_fix: `Add the space to this workspace: PUT /v1/organisms/${organismId}/workspace?ws=${ws} with { add_object_types: [{ name, namespace: "${namespace}", mode }], schemas }, or aimeat_workspace_update { organism_id, ws, add_spaces, schemas }. Only the workspace creator or an organism admin may: a plain member is answered 403 NOT_CREATOR, and any other answer is a failure to show someone who can act. Then read the manifest back and compare its objectTypes with the ones the app ships.`,
    };
}

/**
 * Read the manifest entry a publish into `namespace` needs, and the UNDECLARED_SPACE warning.
 *
 * `ot` comes from the first copy of the manifest the scan returns, which is what both publish paths
 * read inline before this existed. The warning reads EVERY copy: a key is unique per owner, so a
 * workspace can hold more than one manifest, and a space any of them declares is not undeclared.
 * The organism root (no `ws`) has no workspace manifest to compare with and never warns.
 */
export async function readPublishSpace(
    storage: Storage, organismId: string, ws: string | undefined, namespace: string,
): Promise<{ ot: PublishObjectType | undefined; warning: UndeclaredSpaceWarning | null }> {
    const mkey = `${ws ? `organism.${organismId}.w.${ws}` : `organism.${organismId}`}.meta.manifest`;
    const copies = (await storage.listAllMemory({ prefix: mkey, limit: 10 })).items.filter(r => r.key === mkey);
    const typesOf = (r: MemoryRecord | undefined): PublishObjectType[] =>
        (r?.value as { objectTypes?: PublishObjectType[] } | undefined)?.objectTypes ?? [];
    const ot = typesOf(copies[0]).find(o => o?.namespace === namespace);
    const warning = ws && copies.length ? undeclaredSpaceWarning(namespace, copies.flatMap(typesOf), organismId, ws) : null;
    return { ot, warning };
}

/**
 * The UNDECLARED_SPACE warning for a memory key, when it is a workspace record
 * (`organism.{org}.w.{ws}.{namespace}.{id}.draft|latest|version.N`); null for every other key.
 */
export async function undeclaredSpaceForKey(storage: Storage, key: string): Promise<UndeclaredSpaceWarning | null> {
    const parts = parseWorkspaceRecordKey(key);
    if (!parts) return null;
    return (await readPublishSpace(storage, parts.organismId, parts.ws, parts.namespace)).warning;
}

/**
 * Check one item against the workspace manifest and settle its id. Returns the resolved write or a
 * message written for the agent that has to fix the call.
 */
export function resolveWriteItem(
    item: WriteItemInput,
    objectTypes: WriteObjectType[],
    at?: string,
): ResolvedWriteItem | { error: string } {
    const where = at ? `${at}: ` : '';
    const ot = resolveSpace(item.space, objectTypes, at);
    if ('error' in ot) return ot;
    const isDoc = ot.isDoc;
    const fromValue = item.value && typeof item.value === 'object' && !Array.isArray(item.value)
        ? String((item.value as Record<string, unknown>).id ?? '').trim()
        : '';
    let instanceId = item.id || fromValue;
    if (!instanceId && isDoc) instanceId = genDocId();
    if (!instanceId) return { error: `${where}A records write needs an id (pass \`id\`, or include \`id\` in \`value\`).` };
    return {
        space: ot.name || item.space,
        namespace: ot.namespace,
        instanceId,
        isDoc,
        value: item.value,
        ...(item.section ? { section: item.section } : {}),
    };
}
