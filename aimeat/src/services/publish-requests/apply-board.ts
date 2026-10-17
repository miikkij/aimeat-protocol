/**
 * @file src/services/publish-requests/apply-board.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a board: it becomes public, as its keeper, through
 *   setBoardVisibility (services/board-visibility.ts), the change PATCH /v1/boards/:id/visibility runs
 *   (plan doc-mvcn6c7e4e5q, V4). The public-board ceiling applies as it does to the keeper's own change.
 *
 *   A board has no version. The request carries its name, which is what the owner read: a board
 *   deleted, renamed or given another level since is not made public.
 * @structure applyBoardPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.board (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { setBoardVisibility } from '../board-visibility.js';
import { namespaceOfOwner } from './apply-memory.js';

export async function applyBoardPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const id = String(request.target.board_id ?? '');
  const board = id ? await ctx.storage.getBoard(id) : null;
  if (!board) return { ok: false, reason: 'the board was deleted' };
  // The board is kept by the owner or by one of their agents.
  if (!namespaceOfOwner(board.ownerGaii, ownerGhii)) return { ok: false, reason: 'the board is not kept by this account' };
  if (board.name !== String(request.target.name)) return { ok: false, reason: 'the board changed after the request was made' };
  if (board.visibility === 'public') return { ok: true };
  if (board.visibility !== request.change.from) return { ok: false, reason: 'who may read the board changed after the request was made' };
  // As the board's keeper, without the publish gate: the owner approved it.
  const out = await setBoardVisibility(ctx, { gaii: board.ownerGaii, roles: [] }, board, { visibility: 'public' });
  return out.ok ? { ok: true } : { ok: false, reason: out.message };
}
