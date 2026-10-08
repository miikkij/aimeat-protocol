/**
 * @file organism-comments.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Comments / threads on workspace objects (records + documents). A comment targets one
 *   object by (ws, space, instanceId), may be anchored to part of a document (anchor.section or
 *   anchor.quote) or general (no anchor), and may reply to another comment (parentId) to thread.
 *   Memory-backed under `organism.{id}.w.{ws}.meta.comments.{space}~{instance}.{commentId}` — the
 *   meta.* prefix keeps comments OUT of the workspace read + content search. Read/write require the
 *   same workspace-level read authorization as the content (manifest gate). Shared by the REST
 *   routes and the MCP tools so the two surfaces stay identical.
 * @structure
 *   - canAccessWorkspaceComments(...) -- membership + workspace-read gate
 *   - addComment(...) / listComments(storage, reader, ...) -- create + read a target's thread
 *   - deleteComment(...) -- author or creator/admin removes one comment
 * @version-history
 *   v1.4.0 -- 2026-10-08 -- addComment() and listComments() return each comment's `aiProvenanceId`,
 *     read from its row, so a reader of a thread can resolve how a comment was made (aiprov E8).
 *   v1.3.0 -- 2026-09-30 -- deleteComment(): moved out of the DELETE route so the new MCP tool
 *     aimeat_workspace_comment_delete runs the same checks. It also requires the workspace gate that
 *     reading and writing a comment require, so deleting one takes no less than writing one.
 *   v1.2.0 -- 2026-09-29 -- TARGET-082 V4: listComments takes the caller's ContentReader and returns
 *     only the comments it may see (reader.show on each comment record); a warning an AI reader was
 *     shown under rides on the comment as `classificationWarning`.
 *   v1.1.0 -- 2026-08-01 -- TARGET-058 Phase 8b: addComment() takes an optional `aiProvenanceId` and
 *     writes it onto the comment's memory row. A comment IS a memory record, so it already had the
 *     column — the id had nowhere to be passed in, which is a different problem with the same effect.
 *   v1.0.0 -- 2026-06-09 -- Initial: extracted so the MCP comment tools reuse the route logic.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, OrganismRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { canReadWorkspace } from './workspace-access.js';
import { memoryTarget } from './classification/labels.js';
import type { ContentReader } from './classification/reader.js';
import { classificationWarningOf } from './classification/present-memory.js';
import { isOrganismOwner } from './organism-ownership.js';

export interface CommentAnchor { section?: string; quote?: string }
export interface WorkspaceComment {
  id: string; ws: string; space: string; instanceId: string;
  anchor: CommentAnchor | null; author: string; body: string;
  parentId: string | null; createdAt: string;
  /** Set on a listed comment when an AI reader was shown it under a warning classification. */
  classificationWarning?: { label: string; name: string; says: string };
  /** The provenance record of the body, read from the comment's row; null is UNSTATED. Never stored in the value. */
  aiProvenanceId?: string | null;
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
  return { ...comment, aiProvenanceId: input.aiProvenanceId ?? null };
}

export type DeleteCommentResult =
  | { ok: true }
  | { ok: false; status: 403 | 404; code: 'ACCESS_DENIED' | 'NOT_FOUND'; message: string };

/**
 * Delete one comment. The caller must reach the workspace (the same gate as reading and writing a
 * comment), and must be the comment's
 * author or the organism's creator or an admin. The admin test reads the caller's owner name, so an
 * admin's app or agent acting in their name may clean up a thread too; the permission word it needs
 * (organism:write) is enforced by the caller's route or MCP tool. The row is soft-deleted
 * (deleteMemory), as it always was.
 */
export async function deleteComment(
  storage: Storage, config: AimeatConfig, organism: OrganismRecord,
  caller: { sub: string | undefined; owner: string | undefined; gaii: string },
  target: { ws: string; space: string; instanceId: string; commentId: string },
): Promise<DeleteCommentResult> {
  if (!(await canAccessWorkspaceComments(storage, config, organism, caller.sub, caller.owner, caller.gaii, target.ws))) {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'You cannot reach this workspace' };
  }
  const key = `${commentPrefix(organism.id, target.ws, target.space, target.instanceId)}${target.commentId}`;
  const scan = await storage.listAllMemory({ prefix: key, limit: 5 });
  const rec = scan.items.find(r => r.key === key);
  if (!rec) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Comment not found' };
  const isAuthor = rec.ownerGaii === caller.gaii;
  const isAdmin = !!caller.owner && (isOrganismOwner(organism, caller.owner) || organism.admins.includes(caller.owner));
  if (!isAuthor && !isAdmin) {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the comment author or an organism admin can delete it' };
  }
  await storage.deleteMemory(rec.ownerGaii, key);
  return { ok: true };
}

export async function listComments(
  storage: Storage, reader: ContentReader, organismId: string, ws: string, space: string, instanceId: string,
): Promise<WorkspaceComment[]> {
  const { items } = await storage.listAllMemory({ prefix: commentPrefix(organismId, ws, space, instanceId), limit: 2000 });
  return (await reader.show(items, r => memoryTarget(r.ownerGaii, r.key)))
    .map(r => {
      // An AI shown a warning-classified comment gets the warning on the comment itself.
      const w = classificationWarningOf(r);
      const c = r.value as unknown as WorkspaceComment;
      if (!c || typeof c !== 'object') return c;
      // The record of how the body was made lives on the row, so a reader can resolve its label.
      return { ...c, aiProvenanceId: r.aiProvenanceId ?? null, ...(w ? { classificationWarning: w } : {}) };
    })
    .filter(v => v && typeof v === 'object')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
