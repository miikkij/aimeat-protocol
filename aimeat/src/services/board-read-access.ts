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
 *
 *   A board at `organism:<id>` (plan doc-mvcn6c7e4e5q, V3.5) is read by its keeper and by whoever
 *   services/audience.ts audienceAllows admits: the active members of that organism and their agents.
 *   No roster, no same-owner pass and no consent fallback reaches it, so the membership decision is
 *   the one written there.
 * @structure
 *   - boardOrganismAudience() — the organism audience of a board's visibility, or null
 *   - organismBoardAdmits() — the read decision for an organism board
 *   - boardReadRefusal() — a refusal, or null when the read is allowed
 *   - classifiedBoardPosts() — the posts the reader may see by the board's classification
 * @usage
 *   const refusal = await boardReadRefusal({ storage, config }, gaii, board, req.auth);
 *   if (refusal) return fail(refusal.message);
 *   const shown = await classifiedBoardPosts(readerFor({ storage, config }, req.auth), board, posts);
 * @version-history
 *   v1.2.0 — 2026-10-18 — classifiedBoardPosts: a post reads as its board's classification (plan
 *     doc-mvdipuyqraas, L1.3).
 *   v1.1.0 — 2026-10-17 — The organism level: boardOrganismAudience, organismBoardAdmits, and
 *     boardReadRefusal takes the caller's auth for it (plan doc-mvcn6c7e4e5q, V3.5).
 *   v1.0.0 — 2026-08-11 — Extracted from routes/boards.ts (August 2026 audit, the side-effect sweep's
 *     read-path half) after aimeat_board_read was found reading private boards.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, BoardRecord, BoardPostRecord } from '../storage/interface.js';
import type { ContentReader } from './classification/reader.js';
import { boardPostTarget } from './classification/containers.js';
import { isSameOwner } from '../utils/gaii.js';
import { checkConsentForRead, auditDataAccess } from './consent.js';
import { parseAudience, audienceAllows, type Audience, type AudienceAuth } from './audience.js';

/** The organism audience a board's visibility names (`organism:<id>`), or null for every other level. */
export function boardOrganismAudience(visibility: string): Audience | null {
    const audience = parseAudience(visibility);
    return audience?.level === 'organism' ? audience : null;
}

/**
 * May this caller read an organism board? The keeper (the exact identity that made it) always, and
 * otherwise exactly what audienceAllows answers for the board's organism.
 */
export async function organismBoardAdmits(
    storage: Storage,
    board: Pick<BoardRecord, 'visibility' | 'ownerGaii'>,
    gaii: string | undefined,
    auth: AudienceAuth | null | undefined,
): Promise<boolean> {
    const audience = boardOrganismAudience(board.visibility);
    if (!audience) return false;
    if (gaii && board.ownerGaii === gaii) return true;
    return audienceAllows(storage, audience, auth);
}

export interface BoardReadRefusal {
    status: number;
    code: 'AUTH_REQUIRED' | 'CONSENT_REQUIRED' | 'ACCESS_DENIED';
    message: string;
}

/**
 * May `gaii` read this board's posts? Returns null when the read is allowed.
 *
 * `gaii` is undefined for an unauthenticated caller, which only a public or system board serves.
 * `auth` is the caller's session (req.auth, or an MCP session's caller().auth); an organism board is
 * decided on it, and a caller that passes none is refused there.
 */
export async function boardReadRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    gaii: string | undefined,
    board: Pick<BoardRecord, 'id' | 'visibility' | 'ownerGaii' | 'allowedGaiis'>,
    auth?: AudienceAuth | null,
): Promise<BoardReadRefusal | null> {
    const { storage, config } = deps;

    if (board.visibility === 'public' || board.visibility === 'system') return null;

    if (!gaii) {
        return { status: 401, code: 'AUTH_REQUIRED', message: 'Authentication required for non-public boards' };
    }

    if (boardOrganismAudience(board.visibility)) {
        if (await organismBoardAdmits(storage, board, gaii, auth)) return null;
        return { status: 403, code: 'ACCESS_DENIED', message: 'This board is for the members of one organisation. Ask to join it to read the board.' };
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

/**
 * The posts of a board this reader may see by the board's classification (plan doc-mvdipuyqraas,
 * L1.3). A post has no classification of its own: it reads as its board's (classification/
 * containers.ts boardPostTarget), so a board classified hidden from AI is absent to an AI, and a
 * board classification with a reader audience narrows who reads its posts. Asked after
 * boardReadRefusal, never instead of it. With classification off it reads nothing.
 */
export function classifiedBoardPosts<T extends Pick<BoardPostRecord, 'id'>>(
    reader: ContentReader, board: Pick<BoardRecord, 'id' | 'ownerGaii'>, posts: T[],
): Promise<T[]> {
    return reader.show(posts, p => boardPostTarget(board, p.id));
}
