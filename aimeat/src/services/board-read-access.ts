/**
 * @file src/services/board-read-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may READ a board's posts, once, for every surface that serves them.
 *
 *   The sweep that produced this file asked what a WRITE owes. This is the other half: what a READ
 *   owes, which nobody had asked, and it turned out to hide a cross-owner read.
 *
 *   `aimeat_board_read` called storage.listPosts(board_id) and nothing else — it never loaded the
 *   board, so it never had a visibility to rule on. Any MCP session could read another owner's
 *   PRIVATE board, and no consent-denial row existed to show that it happened. The tool's own scope
 *   entry justified leaving it ungated with "the REST GET route is public", which is true of public
 *   and system boards and of no others.
 *
 *   Two doors to the same board also disagreed with each other: the MCP RESOURCE template
 *   (aimeat://boards/{id}) filtered on visibility, and the TOOL beside it did not.
 *
 *   The rule here is the HTTP route's rule, in the same order: public and system are open; the owner
 *   always; a shared board also to that owner's other principals and to anyone on allowedGaiis; and
 *   failing all of those, the consent layer, whose refusal is audited because a denied read is
 *   exactly the event a person asks about afterwards.
 * @structure
 *   - boardReadRefusal() — a refusal, or null when the read is allowed
 * @usage
 *   const refusal = await boardReadRefusal({ storage, config }, gaii, board);
 *   if (refusal) return fail(refusal.message);
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from routes/boards.ts (August 2026 audit, the side-effect sweep's
 *     read-path half) after aimeat_board_read was found reading private boards.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, BoardRecord } from '../storage/interface.js';
import { isSameOwner } from '../utils/gaii.js';
import { checkConsentForRead, auditDataAccess } from './consent.js';

export interface BoardReadRefusal {
    status: number;
    code: 'AUTH_REQUIRED' | 'CONSENT_REQUIRED' | 'ACCESS_DENIED';
    message: string;
}

/**
 * May `gaii` read this board's posts? Returns null when the read is allowed.
 *
 * `gaii` is undefined for an unauthenticated caller, which only a public or system board serves.
 */
export async function boardReadRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    gaii: string | undefined,
    board: Pick<BoardRecord, 'id' | 'visibility' | 'ownerGaii' | 'allowedGaiis'>,
): Promise<BoardReadRefusal | null> {
    const { storage, config } = deps;

    if (board.visibility === 'public' || board.visibility === 'system') return null;

    if (!gaii) {
        return { status: 401, code: 'AUTH_REQUIRED', message: 'Authentication required for non-public boards' };
    }

    // isSameOwner only grants access on shared boards — a private board is strictly owner-only.
    const sameOwnerAccess = board.visibility === 'shared' && isSameOwner(board.ownerGaii, gaii);
    if (board.ownerGaii === gaii || sameOwnerAccess || board.allowedGaiis.includes(gaii)) return null;

    if (!config.consentEnabled) {
        return { status: 403, code: 'ACCESS_DENIED', message: 'You do not have access to this board' };
    }

    const consentResult = await checkConsentForRead(
        storage, `board:${board.id}`, board.ownerGaii, gaii, board.visibility,
    );
    if (consentResult.allowed) return null;

    // Denials only — an allowed read is not logged (see consent-audit-buffer). A denial is the event
    // somebody asks about later, so it is the one that has to exist.
    await auditDataAccess(storage, consentResult.consentId ?? null,
        board.ownerGaii, gaii, `board:${board.id}`, 'read', false);
    return { status: 403, code: 'CONSENT_REQUIRED', message: 'You do not have consent to access this board' };
}
