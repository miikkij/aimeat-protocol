/**
 * @file src/services/workspace-record-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading a workspace record's parts out of its memory key. Moved unchanged out of
 *   services/workspace-tool-ops.ts (max-file-lines), which re-exports it.
 * @structure instanceFromKey(root, namespaces, asked) · recordAt(rest)
 * @usage const named = instanceFromKey(`organism.${org}.w.${ws}`, ['shared.notes'], key);
 * @version-history
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
