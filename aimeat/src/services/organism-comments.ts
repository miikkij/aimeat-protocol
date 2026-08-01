/**
 * @file organism-comments.ts
 * @description Comments / threads on workspace objects (records + documents). A comment targets one
 *   object by (ws, space, instanceId), may be anchored to part of a document (anchor.section or
 *   anchor.quote) or general (no anchor), and may reply to another comment (parentId) to thread.
 *   Memory-backed under `organism.{id}.w.{ws}.meta.comments.{space}~{instance}.{commentId}` — the
 *   meta.* prefix keeps comments OUT of the workspace read + content search. Read/write require the
 *   same workspace-level read authorization as the content (manifest gate). Shared by the REST
 *   routes and the MCP tools so the two surfaces stay identical.
 * @structure
 *   - canAccessWorkspaceComments(...) -- membership + workspace-read gate
 *   - addComment(...) / listComments(...) -- create + read a target's thread
 * @version-history
 *   v1.1.0 -- 2026-08-01 -- TARGET-058 Phase 8b: addComment() takes an optional `aiProvenanceId` and
 *     writes it onto the comment's memory row. A comment IS a memory record, so it already had the
 *     column — the id had nowhere to be passed in, which is a different problem with the same effect.
 *   v1.0.0 -- 2026-06-09 -- Initial: extracted so the MCP comment tools reuse the route logic.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, OrganismRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { canReadWorkspace } from './workspace-access.js';

export interface CommentAnchor { section?: string; quote?: string }
export interface WorkspaceComment {
  id: string; ws: string; space: string; instanceId: string;
  anchor: CommentAnchor | null; author: string; body: string;
  parentId: string | null; createdAt: string;
}

export const commentPrefix = (id: string, ws: string, space: string, instanceId: string): string =>
  `organism.${id}.w.${ws}.meta.comments.${space}~${instanceId}.`;

/**
 * Membership (active member or org agent) AND can read the workspace (manifest gate).
 * Thin alias over the shared {@link canReadWorkspace} gate — comment read/write require the SAME
 * workspace-level read authorization as the content, so the two never drift.
 */
export async function canAccessWorkspaceComments(
  storage: Storage, config: AimeatConfig, organism: OrganismRecord,
  callerSub: string | undefined, callerOwner: string | undefined, callerGaii: string, ws: string,
): Promise<boolean> {
  return canReadWorkspace(storage, config, organism, callerSub, callerOwner, callerGaii, ws);
}

function normaliseAnchor(anchor: unknown): CommentAnchor | null {
  if (!anchor || typeof anchor !== 'object') return null;
  const a = anchor as Record<string, unknown>;
  const section = typeof a.section === 'string' ? a.section.slice(0, 200) : undefined;
  const quote = typeof a.quote === 'string' ? a.quote.slice(0, 1000) : undefined;
  if (!section && !quote) return null;
  return { ...(section ? { section } : {}), ...(quote ? { quote } : {}) };
}

export async function addComment(
  storage: Storage, organismId: string, author: string,
  input: {
    ws: string; space: string; instanceId: string; body: string; anchor?: unknown; parentId?: unknown;
    /** TARGET-058: the provenance record describing this comment's body. Absent means UNSTATED. */
    aiProvenanceId?: string;
  },
): Promise<WorkspaceComment> {
  const commentId = randomUUID();
  const now = new Date().toISOString();
  const comment: WorkspaceComment = {
    id: commentId, ws: input.ws, space: input.space, instanceId: input.instanceId,
    anchor: normaliseAnchor(input.anchor), author, body: input.body.slice(0, 10000),
    parentId: typeof input.parentId === 'string' ? input.parentId : null, createdAt: now,
  };
  await storage.setMemory({
    key: `${commentPrefix(organismId, input.ws, input.space, input.instanceId)}${commentId}`,
    ownerGaii: author, value: comment, visibility: 'private', tags: ['comment'],
    ...(input.aiProvenanceId ? { aiProvenanceId: input.aiProvenanceId } : {}),
    ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
  return comment;
}

export async function listComments(
  storage: Storage, organismId: string, ws: string, space: string, instanceId: string,
): Promise<WorkspaceComment[]> {
  const { items } = await storage.listAllMemory({ prefix: commentPrefix(organismId, ws, space, instanceId), limit: 2000 });
  return items
    .map(r => r.value as unknown as WorkspaceComment)
    .filter(v => v && typeof v === 'object')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
