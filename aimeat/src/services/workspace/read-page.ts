/**
 * @file src/services/workspace/read-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One page of a workspace index, for a reader whose answer has a size limit: an AI over
 *   MCP. Pure functions over the entries readWorkspaceOp (./tool-ops.ts) already built.
 *
 *   WHY. The index answers with one entry per record, titles and no values, and was written to stay
 *   small however many records a workspace holds. An entry is about 240 characters, so a workspace
 *   of 1040 records answered with 249 000 characters of index, six times what a client accepts in one
 *   answer (measured on 2026-11-24). A list that grows with the data is read in pages.
 *
 *   THE ORDER IS THE INDEX'S OWN: newest change first, then id. A page is cut by a keyset cursor on
 *   (updated, id), so a record written between two pages never shifts the page after it. A record
 *   changed between two pages moves to the first page: a reader that pages to find one record uses
 *   `q`, which filters by title and id before the page is cut.
 *
 *   TWO LIMITS. `limit` is entries per space. The character budget is the whole answer's
 *   (models/answer-budget.ts): when the entries so far reach it, the spaces after that show none and
 *   are named in `more`, so a workspace of many spaces does not pass the limit a page was made for.
 * @structure
 *   - BoundedRead -- what a reader with a limit may pass: limit, cursor, q
 *   - pageLimitOf / encodeCursor / decodeCursor
 *   - pageIndex(spaces, opts) -- the page of each space, and what is left
 * @usage
 *   const { index, page } = pageIndex(spaces, { limit, cursor, q, only, budgetChars });
 * @version-history
 *   2026-11-24 — Initial.
 */
import { ANSWER_PAGE_DEFAULT, ANSWER_PAGE_MAX } from '../../models/answer-budget.js';

/** What a reader whose answer has a size limit may pass to a read. */
export interface BoundedRead {
    /** Entries per space on the index. Default ANSWER_PAGE_DEFAULT, at most ANSWER_PAGE_MAX. */
    limit?: number;
    /** The `next_cursor` of the page before, with `space`. */
    cursor?: string;
    /** Keep the entries whose title or id contains this text, whatever the letter case. */
    q?: string;
}

/** One index entry, as far as paging reads it. */
export interface PageEntry { id: string; title: string; updated: string }

interface CursorAt { updated: string; id: string }

/** `limit` as a whole number inside 1..ANSWER_PAGE_MAX; the default when it is not a number. */
export function pageLimitOf(limit: unknown): number {
    const n = typeof limit === 'number' ? limit : Number.NaN;
    if (!Number.isFinite(n)) return ANSWER_PAGE_DEFAULT;
    return Math.min(Math.max(Math.trunc(n), 1), ANSWER_PAGE_MAX);
}

/** What stands between the two parts of a cursor: a character no timestamp holds. */
const CURSOR_SEPARATOR = '\u0000';

/** The cursor that continues after `entry`: opaque to the caller, base64url of its change time and id. */
export function encodeCursor(entry: CursorAt): string {
    return Buffer.from(`${entry.updated}${CURSOR_SEPARATOR}${entry.id}`, 'utf8').toString('base64url');
}

/**
 * The position a cursor names, or null for text that is not a cursor this module made. Nothing here
 * throws on any text: base64url decoding skips what it does not know, and a text without the
 * separator or with an empty part is no position. The change time is compared as text, as the index
 * orders it, so its form is not checked: a record's time is whatever its writer stored.
 */
export function decodeCursor(cursor: string): CursorAt | null {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    const cut = text.indexOf(CURSOR_SEPARATOR);
    if (cut < 0) return null;
    const updated = text.slice(0, cut);
    const id = text.slice(cut + 1);
    return updated.length > 0 && id.length > 0 ? { updated, id } : null;
}

/** True when `e` comes after `at` in the index order: newest change first, then id ascending. */
function isAfter(e: PageEntry, at: CursorAt): boolean {
    return e.updated < at.updated || (e.updated === at.updated && e.id > at.id);
}

export interface PageOptions {
    limit: number;
    /** Continue this space after this position. Read with `only`. */
    cursor?: CursorAt;
    q?: string;
    /** Page this space alone (its name). The others are neither shown nor named in `more`. */
    only?: string;
    /** Characters the index entries may take together. */
    budgetChars: number;
}

export interface IndexPage {
    limit: number;
    /** Entries in this answer, per space. */
    shown: Record<string, number>;
    /** Per space with entries left: how many, and where the next page starts (no cursor: from the top). */
    more: Record<string, { remaining: number; next_cursor?: string }>;
    /** With `q`: how many entries of each space it matched. */
    matched?: Record<string, number>;
    q?: string;
}

/**
 * Cut one page of each space. `spaces` holds every entry of each space in index order. A space gets
 * at most `limit` entries; once the entries shown reach `budgetChars`, no more are added, and what a
 * space still holds is named in `more`. The first entry of the answer is always shown, so a page is
 * never empty while there is something to read.
 */
export function pageIndex<E extends PageEntry>(
    spaces: Array<{ name: string; entries: E[] }>, opts: PageOptions,
): { index: Record<string, E[]>; page: IndexPage } {
    const needle = opts.q?.trim().toLowerCase();
    const index: Record<string, E[]> = {};
    const page: IndexPage = { limit: opts.limit, shown: {}, more: {}, ...(needle ? { matched: {}, q: opts.q!.trim() } : {}) };
    let chars = 0;
    let shownTotal = 0;
    for (const s of spaces) {
        if (opts.only && s.name !== opts.only) continue;
        let rest = needle
            ? s.entries.filter(e => e.title.toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle))
            : s.entries;
        if (page.matched) page.matched[s.name] = rest.length;
        if (opts.cursor && opts.only) rest = rest.filter(e => isAfter(e, opts.cursor!));
        const out: E[] = [];
        for (const e of rest) {
            if (out.length >= opts.limit) break;
            const size = JSON.stringify(e).length + 1;
            if (shownTotal > 0 && chars + size > opts.budgetChars) break;
            out.push(e);
            chars += size;
            shownTotal++;
        }
        index[s.name] = out;
        page.shown[s.name] = out.length;
        const remaining = rest.length - out.length;
        if (remaining > 0) {
            page.more[s.name] = { remaining, ...(out.length ? { next_cursor: encodeCursor(out[out.length - 1]) } : {}) };
        }
    }
    return { index, page };
}
