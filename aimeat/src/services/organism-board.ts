/**
 * @file src/services/organism-board.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The visibility of an organism's discussion board (`org-<id>`), derived from the
 *   organism's own visibility (plan doc-mvcn6c7e4e5q, V3.5).
 *
 *   Until 2026-10-18 a private or listed organism got a 'shared' board with an empty allowedGaiis.
 *   A shared board admits its keeper, the keeper's other principals and the roster, and nothing ever
 *   wrote the organism's members onto that roster, so an active member got 403 CONSENT_REQUIRED on
 *   the organism's own board. The organism level (`organism:<id>`, services/audience.ts) admits
 *   exactly the active members and their agents, and follows the live membership.
 *
 *   The rule: a public organism has a public board; a listed or private one has a board at
 *   `organism:<its id>`. When the organism's visibility changes, the board follows, but only while it
 *   still carries the value the rule gave for the old visibility: a level the keeper chose by hand
 *   since is kept. Boards created before this rule are not migrated here.
 * @structure organismBoardVisibility() · followOrganismVisibility()
 * @usage
 *   await storage.createBoard({ ..., visibility: organismBoardVisibility(id, visibility) });
 *   await followOrganismVisibility(storage, organism, updated.visibility);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial: the organism's board follows the organism's visibility (plan
 *     doc-mvcn6c7e4e5q, V3.5).
 */
import type { Storage, OrganismRecord, BoardRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { boardOrganismAudience } from './board-read-access.js';

/** The board visibility an organism at `visibility` gives its discussion board. */
export function organismBoardVisibility(organismId: string, visibility: string): BoardRecord['visibility'] {
  return visibility === 'public' ? 'public' : `organism:${organismId}`;
}

/**
 * Move the organism's board to the level the rule gives for `nextVisibility`. Nothing changes when
 * the two levels give the same board visibility (listed and private), when the board is missing, or
 * when the board's current visibility is not the one the rule gave for the old organism visibility.
 *
 * No publish gate is asked: a raise to public here follows a raise of the organism itself, which the
 * organism update already put through the gate. The public-board ceiling is not asked either, as on
 * create: the board is part of the organism, not one of the keeper's own boards.
 *
 * Returns the board as stored after the call, or null when the board was left as it was.
 */
export async function followOrganismVisibility(
  storage: Storage,
  organism: Pick<OrganismRecord, 'id' | 'boardId' | 'visibility'>,
  nextVisibility: string | undefined,
): Promise<BoardRecord | null> {
  if (!nextVisibility || nextVisibility === organism.visibility || !organism.boardId) return null;
  const from = organismBoardVisibility(organism.id, organism.visibility);
  const to = organismBoardVisibility(organism.id, nextVisibility);
  if (from === to) return null;
  const board = await storage.getBoard(organism.boardId);
  if (!board || board.visibility !== from) return null;
  // A board at the organism level is never federated (services/board-visibility.ts applies the same
  // rule to a keeper's change); a move to public keeps the flag the board has.
  const updated = await storage.updateBoardVisibility(board.id, to, boardOrganismAudience(to) ? false : undefined);
  if (updated) emitChange('boards');
  return updated;
}
