/**
 * @file src/services/boards/board-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Setting a board's own rules as a caller: the board read, the keeper rule (the exact
 *   identity that created the board, or an operator through operatorOverride, which writes the
 *   operator trail) and the write (setBoardRules, services/board-write.ts). PATCH
 *   /v1/boards/:boardId/rules and aimeat_board_rules_set both call it, so the keeper rule is written
 *   once (structure programme 2026-11, unit 2b).
 *
 *   Another agent of the same owner is refused. Whether a same-owner principal should pass is open;
 *   until it is decided, both surfaces give the same answer because they ask this function.
 * @structure setBoardRulesAs(deps, who, boardId, rules) → { ok, board } | refusal
 * @usage const out = await setBoardRulesAs({ storage, config }, { gaii, auth: req.auth }, boardId, rules);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/boards.ts and mcp/boards.ts, which each held a copy of the
 *     keeper rule (structure programme 2026-11, unit 2b).
 */
import { operatorOverride, type OperatorAuth } from '../operator-override.js';
import { setBoardRules, type BoardRulesResult, type BoardWriteDeps } from '../board-write.js';

/** Replace the board's rules when this caller keeps the board, or say why not. */
export async function setBoardRulesAs(
    deps: BoardWriteDeps,
    who: { gaii: string; auth: OperatorAuth | null | undefined },
    boardId: string,
    rules: unknown,
): Promise<BoardRulesResult> {
    const { storage, config } = deps;
    const board = await storage.getBoard(boardId);
    if (!board) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Board not found: ${boardId}` };
    if (board.ownerGaii !== who.gaii && !(await operatorOverride(storage, config, who.auth,
        { ownerOf: board.ownerGaii, area: 'board', action: 'rules', subject: board.name }))) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the keeper of this board sets its rules. Ask them, or open a board of your own.' };
    }
    // The shape check, the write and the change event are services/board-write.ts.
    return setBoardRules(deps, board, rules);
}
