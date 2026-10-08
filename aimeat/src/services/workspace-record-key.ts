/**
 * @file src/services/workspace-record-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading a workspace record's parts out of its memory key. Moved unchanged out of
 *   services/workspace-tool-ops.ts (max-file-lines), which re-exports it.
 * @structure instanceFromKey(root, namespaces, asked)
 * @usage const named = instanceFromKey(`organism.${org}.w.${ws}`, ['shared.notes'], key);
 * @version-history
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
    const instance = rest.slice(namespace.length + 1).split('.')[0];
    return instance ? { namespace, instance } : null;
}
