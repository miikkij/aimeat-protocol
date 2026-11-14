/**
 * @file src/services/organism-read/comments.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism read with the comment gate around it (services/organism-comments.ts
 *   canAccessWorkspaceComments: whoever reads the workspace reads and writes its comments).
 *   POST/GET/DELETE /v1/organisms/:id/comments and aimeat_workspace_comment, _comments and
 *   _comment_delete each read the organism and asked that gate; they call these functions now
 *   (structure programme 2026-11, unit 2b).
 *
 *   WHO. `sub` and `owner` are the session's subject and account; `gaii` is the identity the
 *   workspace read is asked for (resolveIdentity on REST, the session's GAII over MCP). The refusal is
 *   a code; each surface keeps its own sentence for it.
 * @structure commentWorkspace(deps, id, who, ws) · deleteCommentIn(deps, id, who, target)
 * @usage const gate = await commentWorkspace({ storage, config }, id, { sub, owner, gaii }, ws);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/organisms/workspace-read.ts and mcp/organisms.ts, which each
 *     held a copy (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, OrganismRecord } from '../../storage/interface.js';
import { canAccessWorkspaceComments, deleteComment, type DeleteCommentResult } from '../organism-comments.js';

type Deps = { storage: Storage; config: AimeatConfig };
type Who = { sub: string | undefined; owner: string | undefined; gaii: string };

/** The organism, when the caller may read the workspace's comments (and so write one). */
export async function commentWorkspace(
    deps: Deps, organismId: string, who: Who, ws: string,
): Promise<{ ok: true; organism: OrganismRecord } | { ok: false; code: 'NOT_FOUND' | 'ACCESS_DENIED' }> {
    const organism = await deps.storage.getOrganism(organismId);
    if (!organism) return { ok: false, code: 'NOT_FOUND' };
    if (!(await canAccessWorkspaceComments(deps.storage, deps.config, organism, who.sub, who.owner, who.gaii, ws))) {
        return { ok: false, code: 'ACCESS_DENIED' };
    }
    return { ok: true, organism };
}

/** Delete one comment: the organism read, then deleteComment, which holds the gate and the author rule. */
export async function deleteCommentIn(
    deps: Deps, organismId: string, who: Who,
    target: { ws: string; space: string; instanceId: string; commentId: string },
): Promise<DeleteCommentResult> {
    const organism = await deps.storage.getOrganism(organismId);
    if (!organism) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Organism not found' };
    return deleteComment(deps.storage, deps.config, organism, who, target);
}
