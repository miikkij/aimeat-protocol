/**
 * @file src/services/boards/board-members.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Changing a board's reader list as a caller: the board read, who may change it, and
 *   the roster write (setBoardMembers, services/board-write.ts). PATCH /v1/boards/:boardId/members
 *   and aimeat_board_members both call it (developer approval 2026-11-14, parity section
 *   BOARD-MEMBERS).
 *
 *   WHO. The board's owner in person, or the operator in person through operatorOverride (which
 *   writes the operator trail); or an agent of the board's owner holding `social:members`, which acts
 *   for its owner, as agents are first-class users. A visitor from another node, an app grant, an
 *   ecosystem app and an agent of anyone else are refused. What kind of principal the caller is, is
 *   asked of its caller object (services/caller-context.ts), built by callerOf on the route and by the
 *   MCP session.
 * @structure setBoardMembersAs(deps, caller, boardId, change) → { ok, board } | refusal
 * @usage const out = await setBoardMembersAs({ storage, config }, callerOf(req, config.nodeId, storage), boardId, { add, remove });
 * @version-history
 *   v1.1.0 — 2026-11-14 — Takes the CallerContext and asks its `kind`, `inPerson`, `has()` and
 *     `principal` instead of reading token roles inline (check:single-entry agent-role; repairs
 *     edd02b508). The same answers on both surfaces.
 *   v1.0.0 — 2026-11-14 — The two surfaces' own checks in one function; REST now admits the owner's
 *     agent holding social:members, as the tool did (structure programme 2026-11, unit 2b phase B).
 */
import type { CallerContext } from '../caller-context.js';
import { localAccountName } from '../../utils/gaii.js';
import { operatorOverride } from '../operator-override.js';
import { setBoardMembers, type BoardMembersResult, type BoardWriteDeps } from '../board-write.js';

/** Change the reader list when this caller may, or say why not. */
export async function setBoardMembersAs(
    deps: BoardWriteDeps,
    caller: CallerContext | undefined,
    boardId: string,
    change: { add?: unknown; remove?: unknown },
): Promise<BoardMembersResult> {
    const { storage, config } = deps;
    const board = await storage.getBoard(boardId);
    if (!board) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Board not found: ${boardId}` };
    // The board's owner comes from localAccountName, which keeps an owner of another node whole, so a
    // visitor's board is never the namesake's.
    const boardOwner = localAccountName(board.ownerGaii);
    if (caller?.inPerson) {
        // The owner in person, or the operator in person (operatorOverride writes the trail).
        if (caller.owner !== boardOwner && !(await operatorOverride(storage, config, caller.auth,
            { ownerOf: board.ownerGaii, area: 'board', action: 'members', subject: board.name }))) {
            return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'You do not own this board' };
        }
    } else if (caller?.kind === 'agent') {
        // An agent acts for its owner when it holds social:members and its owner keeps the board. The
        // kind is never 'agent' for a visitor, an app grant or an ecosystem app (caller-facts.ts).
        if (!caller.has('social:members')) {
            return { ok: false, status: 403, code: 'SCOPE_DENIED', message: 'Changing a board\'s readers needs the social:members permission.' };
        }
        if (localAccountName(caller.principal) !== boardOwner) {
            return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the board owner can manage members' };
        }
    } else {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the board owner, an agent of the owner, or the operator can manage members' };
    }
    // The roster arithmetic, the write and the change event are services/board-write.ts.
    return setBoardMembers(deps, board, change);
}
