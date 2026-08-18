/**
 * @file workspace-ref.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Normalise a caller-supplied workspace binding for the 'workspace' visibility tier into
 *   the canonical SPACE-SEPARATED "<org>/<ws> <org>/<ws>" string stored on records/files. A file may be
 *   shared into SEVERAL workspaces (readable by members of any), so callers may pass an array
 *   (`workspace_refs`) or a single string (`workspaceRef`/`workspace_ref`, itself possibly
 *   space-separated). Anything that is not a valid "<org>/<ws>" (a slash with a non-empty org and ws)
 *   is dropped; duplicates are collapsed. Returns '' when nothing valid is supplied.
 * @usage const refs = normalizeWorkspaceRefs(body.workspace_refs, body.workspaceRef);
 * @version-history
 *   v1.0.0 — 2026-07-05 — Extracted so /v1/memory/files, /v1/storage and /v1/memory share one parser.
 */
export function normalizeWorkspaceRefs(arr: unknown, single: unknown): string {
  const list: unknown[] = Array.isArray(arr)
    ? arr
    : (typeof single === 'string' ? single.split(/\s+/) : []);
  const refs = list
    .map(x => String(x).trim())
    .filter(r => { const i = r.indexOf('/'); return i >= 1 && i < r.length - 1; });
  return [...new Set(refs)].join(' ');
}
