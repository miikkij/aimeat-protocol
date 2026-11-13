/**
 * @file src/services/content/shared-profile-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a workspace document's shared fingerprint is stored, as keys only. It imports
 *   nothing, so the workspace delete path (services/workspace/write.ts) and the content pipeline can
 *   both read it without an import cycle through the content service.
 *
 *   One record per document, `organism.<org>.w.<ws>.meta.fingerprint.<namespace>~<id>`, held by the
 *   node's own identity (`system@<node>`) and private. The `meta.` prefix keeps it out of the
 *   workspace read, the index and the content search, as the comments are kept out
 *   (services/organism-comments.ts); being under the workspace's prefix makes it go wherever the
 *   workspace's own keys go. Readers reach it only through the content service, which asks the
 *   workspace read gate first (shared-profile.ts). Decision
 *   decision-sormenj-lki-yksi-yhteinen-per-ty-tilan-asiakirja-sama-lukulu (Jouni, 2026-11-03).
 * @structure SHARED_PROFILE_PART · workspaceDocOfKey · sharedProfileKeyOf · sharedProfilePrefixOf · systemOwnerOf
 * @usage const key = sharedProfileKeyOf('org1', 'ws-a', 'shared.notes', 'doc-1');
 * @version-history
 *   v1.0.0 — 2026-11-03 — Initial (wish-sormenj-lki-jaetuksi-yksi-per-ty-tilan-asiakirja-ja-ty-tilan).
 */

/** The part of a workspace's meta namespace that holds the shared fingerprints. */
export const SHARED_PROFILE_PART = 'meta.fingerprint.';

/**
 * The organism and workspace of a published workspace document's key
 * (`organism.<org>.w.<ws>.<namespace>.<id>.latest`), or null for any other key. Which part of
 * `rest` is the namespace and which the id is the manifest's to say (shared-profile.ts).
 */
export function workspaceDocOfKey(key: string): { organismId: string; ws: string; rest: string } | null {
  const m = /^organism\.([^.]+)\.w\.([^.]+)\.(.+)\.latest$/.exec(key);
  if (!m || m[3].startsWith('meta.')) return null;
  return { organismId: m[1], ws: m[2], rest: m[3] };
}

/** The shared fingerprint record of one workspace document. */
export function sharedProfileKeyOf(organismId: string, ws: string, namespace: string, id: string): string {
  return `organism.${organismId}.w.${ws}.${SHARED_PROFILE_PART}${namespace}~${id}`;
}

/** Every shared fingerprint record of one workspace starts with this. */
export function sharedProfilePrefixOf(organismId: string, ws: string): string {
  return `organism.${organismId}.w.${ws}.${SHARED_PROFILE_PART}`;
}

/** The node's own identity, which holds the shared fingerprints. */
export function systemOwnerOf(nodeId: string): string { return `system@${nodeId}`; }
