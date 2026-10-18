/**
 * @file src/services/board-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A board's visibility and federation flag, changed: the body of PATCH
 *   /v1/boards/:boardId/visibility, moved here so an approved publish request makes a board public
 *   through the same code the keeper's own change runs (plan doc-mvcn6c7e4e5q, V4).
 *
 *   The caller has already established that it keeps the board (the route compares the board's owner
 *   with the session; the applier with the account that approved). This checks the level, the
 *   organisation rule, the federation rule and the public-board ceiling, asks the publish gate when
 *   the change makes the board public, and writes.
 * @structure setBoardVisibility(deps, caller, board, input) · BoardVisibilityResult
 * @usage
 *   const out = await setBoardVisibility({ storage, config }, { gaii, roles }, board, { visibility, federate, publishGate });
 *   if (!out.ok) return res.status(out.status).json(error(nodeId, out.code, out.message));
 * @version-history
 *   v1.1.0 — 2026-10-18 — A level wider than the board's label allows is refused with 409
 *     LABEL_CAPS_AUDIENCE before the publish gate (plan doc-mvdipuyqraas, L3.5).
 *   v1.0.0 — 2026-10-18 — Moved out of routes/boards.ts unchanged, with the publish gate added (plan doc-mvcn6c7e4e5q, V4).
 */
import type { BoardRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { boardOrganismAudience } from './board-read-access.js';
import {
    boardVisibilityRefusal, publicBoardCeiling, fileBoardAsk,
    type BoardWriteCaller, type BoardWriteDeps, type BoardWriteRefusal,
} from './board-write.js';
import { isRaiseToPublic } from './publish-gate.js';
import { publishAskOf } from './publish-requests/ask.js';
import type { DoorAsk, PublishGateInput } from './publish-requests/door.js';
import { audienceCapOf, audienceOfVisibility, capByOf, capRefusalOf } from './classification/audience-cap.js';
import { boardTarget } from './classification/containers.js';

export type BoardVisibilityResult = ({ ok: true; board: BoardRecord } & DoorAsk) | BoardWriteRefusal;

const bad = (message: string): BoardWriteRefusal => ({ ok: false, status: 400, code: 'INVALID_INPUT', message });

/** Change a board's visibility, its federation flag, or both. */
export async function setBoardVisibility(
    deps: BoardWriteDeps,
    caller: Pick<BoardWriteCaller, 'gaii' | 'roles' | 'auth'>,
    board: BoardRecord,
    input: { visibility?: unknown; federate?: unknown; publishGate?: PublishGateInput },
): Promise<BoardVisibilityResult> {
    const { storage } = deps;
    const { visibility: requested, federate } = input;
    if (requested !== undefined && !(['private', 'public', 'shared'].includes(requested as string) || boardOrganismAudience(String(requested)))) {
        return bad('visibility must be "private", "public", "shared" or "organism:<organism id>"');
    }
    if (requested === undefined && typeof federate !== 'boolean') return bad('visibility or federate must be provided');
    // An organisation level names an organism the caller is in, checked before anything is written
    // (boardVisibilityRefusal, the same check create makes).
    let visibility: string | undefined;
    if (requested !== undefined) {
        const level = await boardVisibilityRefusal(storage, requested, { auth: caller.auth ?? null });
        if (!level.ok) return level;
        visibility = level.visibility;
    }
    // An organisation's board is never federated: its readers are the organism's members here.
    if (boardOrganismAudience(visibility ?? board.visibility) && federate === true) {
        return bad('A board shared with an organisation stays on this node, so it cannot be federated.');
    }
    // The board's label caps its level (plan doc-mvdipuyqraas, L3.5), before the publish gate.
    if (input.publishGate && visibility !== undefined) {
        const capped = capRefusalOf(await audienceCapOf(deps, boardTarget(board), audienceOfVisibility(visibility), {
            from: audienceOfVisibility(board.visibility), by: capByOf(input.publishGate.caller), where: 'board visibility',
        }));
        if (capped) return capped;
    }
    // The publish gate (plan doc-mvcn6c7e4e5q, V4): asked by a caller the node asks the owner about,
    // the board keeps its level, the federation flag still applies, and the request is filed.
    const ask = input.publishGate && isRaiseToPublic(board.visibility, visibility)
        ? publishAskOf(deps, input.publishGate.caller, input.publishGate.app) : null;
    if (ask?.kind === 'refused') return { ok: false, status: ask.status, code: ask.code, message: ask.message };
    if (ask?.kind === 'ask') visibility = undefined;
    // Only when this flip is INTO public and the board is not already there: re-saving a board that
    // is public counts itself and would refuse an edit that changes nothing.
    if (visibility === 'public' && board.visibility !== 'public') {
        const ceiling = await publicBoardCeiling(deps, caller, 'public');
        if (ceiling) return ceiling;
    }
    const toOrganism = !!visibility && boardOrganismAudience(visibility) !== null;
    const updated = await storage.updateBoardVisibility(board.id, (visibility || board.visibility) as BoardRecord['visibility'],
        toOrganism ? false : (typeof federate === 'boolean' ? federate : undefined));
    if (!updated) return { ok: false, status: 500, code: 'INTERNAL', message: 'Failed to update board visibility' };
    emitChange('boards');
    if (ask?.kind === 'ask' && input.publishGate) return { ok: true, board: updated, ...(await fileBoardAsk(deps, input.publishGate, ask, updated)) };
    return { ok: true, board: updated };
}
