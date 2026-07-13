/**
 * @file public/js/services/organisms.shared.js
 * @description Shared leaf helpers for the organisms service and its sibling modules — the workspace
 *   key root, the memory/document space predicates, and the object-type schema fetch. Extracted from
 *   organisms.js so the workspace-gen / prompts / charts siblings can reuse them without a cycle.
 * @usage import { wsRoot, isMemorySpace, isDocSpace, getObjectSchema } from './organisms.shared.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from organisms.js (max-file-lines)
 */
import { apiGet } from '/js/api.js';

/** Does this space's data live in workspace memory keys (records/documents the workspace view can
 *  show)? Missing backing counts as memory. Mirrors the server's isMemoryBackedSpace — THE one
 *  frontend predicate; hand-rolled per-view variants of this check are how published content once
 *  went invisible. backing:'tasks' points at the task system; other values are legacy/unsupported. */
export const isMemorySpace = (ot) => !ot?.backing || ot.backing === 'memory';

/** Is this space a document space? Old manifests declared kind:'document' without a mode — honour
 *  the intent (mirrors the server's normalizeObjectTypes inference). */
export const isDocSpace = (ot) => ot?.mode === 'document' || (!ot?.mode && ot?.kind === 'document');

/** Key root for one workspace — an organism holds many workspaces under organism.{id}.w.{wsId}. */
export function wsRoot(orgId, wsId) { return `organism.${orgId}.w.${wsId}`; }

/** Fetch the JSON Schema registered for an object-type namespace (drives schema-aware forms).
 *  Probes a sub-key so the prefix schema resolves (a prefix schema doesn't self-match its own key). */
export async function getObjectSchema(orgId, wsId, namespace) {
  const key = `${wsRoot(orgId, wsId)}.${namespace}._form`;
  try {
    const resp = await apiGet(`/v1/memory/${encodeURIComponent(key)}/schema`);
    return resp?.data?.has_schema ? resp.data.schema : null;
  } catch { return null; }
}
