/**
 * @file src/services/boards/board-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The boards a caller may see: every board, filtered by who may see each one
 *   (boardVisibleToCaller, services/board-write.ts; an organism board by membership). GET /v1/boards,
 *   aimeat_board_list and the aimeat://boards resource list call it, so the surfaces ask the same
 *   rule around the same read (structure programme 2026-11, unit 2b).
 *
 *   WHO. `gaii` is undefined for an unauthenticated caller or the shared anonymous principal (each
 *   surface works that out itself); such a caller sees public and system boards only. `auth` is the
 *   caller's session, which an organism board is decided on.
 * @structure boardsVisibleTo(storage, who) → BoardRecord[]
 * @usage const boards = await boardsVisibleTo(storage, { gaii, auth: req.auth });
 * @version-history
 *   v1.0.0 — 2026-11-13 — The rule GET /v1/boards wrote inline and the MCP board list asked through
 *     boardVisibleToCaller, in one place (structure programme 2026-11, unit 2b).
 */
import type { Storage, BoardRecord } from '../../storage/interface.js';
import type { AudienceAuth } from '../audience.js';
import { boardVisibleToCaller } from '../board-write.js';

/** Every board this caller may see, in the store's order. */
export async function boardsVisibleTo(
    storage: Storage,
    who: { gaii: string | undefined; auth: AudienceAuth | null | undefined },
): Promise<BoardRecord[]> {
    const boards = await storage.listBoards();
    const { gaii } = who;
    const seen = await Promise.all(boards.map(b => {
        if (b.visibility === 'public' || b.visibility === 'system') return true;
        if (!gaii) return false;
        return boardVisibleToCaller(storage, b, { gaii, auth: who.auth });
    }));
    return boards.filter((_, i) => seen[i]);
}
