/**
 * @file src/services/workspace-record-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading a workspace record's parts out of its memory key. Moved unchanged out of
 *   services/workspace-tool-ops.ts (max-file-lines), which re-exports it.
 * @structure instanceFromKey(root, namespaces, asked) · recordAt(rest) · recordRowAt(rest) ·
 *   spaceRowAt(key, nsPrefix, prefixes) · declaredNamespaceOf(parsed, declared) · spacePrefixesOf(root, objectTypes) ·
 *   NODE_META_PARTS · isNodeReservedPart(rel) · isNodeReservedWorkspaceKey(key)
 * @usage const named = instanceFromKey(`organism.${org}.w.${ws}`, ['shared.notes'], key);
 *   const row = spaceRowAt(r.key, `${root}.notes.`, spacePrefixesOf(root, manifest.objectTypes));
 * @version-history
 *   2026-11-08 — isNodeReservedPart() and isNodeReservedWorkspaceKey(): the parts of a workspace the
 *     node keeps for itself (share, access requests, intake forms, fingerprints, skills, the manifest
 *     and its siblings). spaceRowAt reads no row there, so a manifest that declares a space over such a
 *     part lists only that space's own records (secaudit2026nov08 round 14,
 *     workspace-content:reserved-workspace-records-served-through-declared-namespace-unmasked).
 *   2026-11-01 — recordRowAt(), spaceRowAt() and spacePrefixesOf(): the record and copy of a row read
 *     from the end of its key with the space's longer namespaces left to them, for the readers outside
 *     the index; declaredNamespaceOf() for the write guard (secaudit2026oct31w2 round 10b, dotted
 *     record ids).
 *   2026-10-31 — recordAt(): a record's id and role read from the end of its key, which the index
 *     and instanceFromKey use, so an id with a dot in it is one record (secaudit2026oct31w2 round 10,
 *     f-2026-10-23-dotted-id-breaks-index).
 *   v1.0.0 — 2026-10-08 — Moved from services/workspace-tool-ops.ts (max-file-lines).
 */

/**
 * Read an instance out of a full memory key, when the key belongs to THIS workspace.
 *
 *   organism.<org>.w.<ws>.<namespace>.<instance>[.latest | .draft | .version.N]
 *
 * `root` is `organism.<org>.w.<ws>`, so a key from another organism or another workspace matches
 * no prefix and the answer is null: the caller then treats what was asked as a plain instance id,
 * finds nothing, and reports it missing under its own name. The longest matching namespace wins,
 * because one namespace may be the beginning of another (`shared.notes`, `shared.notes-old`).
 */
export function instanceFromKey(root: string, namespaces: string[], asked: string): { namespace: string; instance: string } | null {
    if (!asked.startsWith(`${root}.`)) return null;
    const rest = asked.slice(root.length + 1);
    const namespace = namespaces.filter(ns => rest.startsWith(`${ns}.`)).sort((a, b) => b.length - a.length)[0];
    if (!namespace) return null;
    const tail = rest.slice(namespace.length + 1);
    const instance = recordAt(tail)?.id ?? tail.split('.')[0];
    return instance ? { namespace, instance } : null;
}

/**
 * The record id and role in what follows `<root>.<namespace>.` in a key: `<id>.latest`, `<id>.draft`,
 * or a bare `<id>` (the published copy, as records were written before roles). The role is read from
 * the END, as services/write-guards.ts parseWorkspaceRecordKey reads it, so an id that holds a dot is
 * one record under its whole id. A `.version.N` history row gives null, and so does a bare rest with a
 * dot in it, which no reading can tell apart from an id and a role.
 */
export function recordAt(rest: string): { id: string; role: 'latest' | 'draft' } | null {
    if (/\.version\.\d+$/.test(rest)) return null;
    for (const role of ['latest', 'draft'] as const) {
        if (rest.endsWith(`.${role}`)) {
            const id = rest.slice(0, -(role.length + 1));
            return id ? { id, role } : null;
        }
    }
    return rest && !rest.includes('.') ? { id: rest, role: 'latest' } : null;
}

/** One stored copy of a record: its id and which copy the row is. */
export interface RecordRow { id: string; copy: 'latest' | 'bare' | 'draft' | 'version' }

/**
 * The record and copy in what follows `<root>.<namespace>.` in a key, read from the end as recordAt
 * reads it: `<id>.latest`, a bare `<id>` (the published copy written before roles), `<id>.draft`, or a
 * `<id>.version.N` history row. A bare rest with a dot in it gives null, as in recordAt.
 */
export function recordRowAt(rest: string): RecordRow | null {
    const version = /^(.+)\.version\.\d+$/.exec(rest);
    if (version) return { id: version[1]!, copy: 'version' };
    const at = recordAt(rest);
    if (!at) return null;
    return { id: at.id, copy: at.role === 'draft' ? 'draft' : rest.endsWith('.latest') ? 'latest' : 'bare' };
}

/**
 * The record row a key holds in one space, or null when the key is not a row of that space.
 * `nsPrefix` is the space's `<root>.<namespace>.`, and `prefixes` are those of every space the manifest
 * declares: a key under a longer one that begins with `nsPrefix` (`notes.` and `notes.old.`) belongs to
 * that longer space, as the workspace index reads it.
 */
export function spaceRowAt(key: string, nsPrefix: string, prefixes: readonly string[]): RecordRow | null {
    if (!key.startsWith(nsPrefix)) return null;
    // A record the node keeps for itself is no row of any space, whatever a manifest declares.
    if (isNodeReservedWorkspaceKey(key)) return null;
    if (prefixes.some(p => p.length > nsPrefix.length && p.startsWith(nsPrefix) && key.startsWith(p))) return null;
    return recordRowAt(key.slice(nsPrefix.length));
}

/**
 * The declared space of a key that was split with the last part before its role as the id
 * (services/write-guards.ts parseWorkspaceRecordKey): `parsed` itself when it is declared, else the
 * longest declared namespace it continues, because an id with a dot puts its first parts into
 * `parsed` (`logs.e1` for the record `e1.2` of `logs`). Null when no declared space holds it.
 */
export function declaredNamespaceOf(parsed: string, declared: readonly string[]): string | null {
    return declared.filter(ns => parsed === ns || parsed.startsWith(`${ns}.`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * The parts under `meta.` of a workspace (or of an organism's own root) that the node writes for
 * itself: the manifest, readme, section index, share record, pinned apps, member-change rule, opened
 * marks, sources and config, intake form configs, comments, the shared fingerprints and their setting,
 * and on the organism root the workspace registry, its structure snapshot and its colours. Any other
 * `meta.<x>` is free for a space: the project shape declares meta.goals, meta.plans and meta.decisions.
 */
export const NODE_META_PARTS: ReadonlySet<string> = new Set([
    'manifest', 'readme', 'sections', 'share', 'apps', 'rules', 'opened', 'sources', 'config',
    'intake', 'comments', 'fingerprint', 'contentclass', 'workspaces', 'structure', 'colors',
]);

/**
 * Whether `rel`, a key or a namespace read from the workspace root, lies in a part the node keeps for
 * itself: `access.*` (access requests), `skills.*` (the skills published into the workspace), `meta`
 * itself, a NODE_META_PARTS entry under `meta.`, or a `meta._<x>` probe key. Such a part is never a
 * space (a manifest write refuses it, services/workspace-meta.ts) and its records are never a row of
 * one (spaceRowAt), so a space declared over it before this rule lists only its own records.
 */
export function isNodeReservedPart(rel: string): boolean {
    const [head, second] = rel.split('.');
    if (head === 'access' || head === 'skills') return true;
    if (head !== 'meta') return false;
    return second === undefined || second === '' || NODE_META_PARTS.has(second) || second.startsWith('_');
}

const WORKSPACE_KEY_RE = /^organism\.[^.]+\.w\.[^.]+\.(.+)$/;
const ORGANISM_KEY_RE = /^organism\.[^.]+\.(.+)$/;

/** Whether a full memory key is a record the node keeps under a workspace root (or an organism's own root). */
export function isNodeReservedWorkspaceKey(key: string): boolean {
    const rel = WORKSPACE_KEY_RE.exec(key)?.[1] ?? ORGANISM_KEY_RE.exec(key)?.[1];
    return !!rel && isNodeReservedPart(rel);
}

/** The `<root>.<namespace>.` prefix of every space a manifest declares, for spaceRowAt. */
export function spacePrefixesOf(root: string, objectTypes: ReadonlyArray<{ namespace?: unknown }> | undefined): string[] {
    return (objectTypes ?? []).flatMap(ot => (typeof ot?.namespace === 'string' && ot.namespace ? [`${root}.${ot.namespace}.`] : []));
}
