/**
 * @file src/services/memory-search-shape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a memory search ANSWERS WITH, in one place, for every door that performs one.
 *
 *   WHY IT EXISTS. `aimeat_memory_search` was two capabilities under one name. The node MCP returned
 *   SNIPPETS — a window of text around the match, plus the byte size — defaulted to 50 hits, capped
 *   at 200 and dropped `.version.N` history rows; both connector doors passed the query straight to
 *   `GET /v1/memory/search`, which answers with the FULL `value` of every hit, defaults to 200 and
 *   has no version filter. So the same tool, called from a fleet agent instead of from the node,
 *   pulled whole records across the wire and through a model's context to answer "which keys mention
 *   this". That is pitfalls §44 exactly — the shape `aimeat_memory_list` was fixed for on 2026-09-04
 *   by forcing `include=meta`, and the search twin was left behind. Review item 6.4, 2026-09-06.
 *
 *   The snippet computation was a closure inside mcp/memory-extended.ts, which is why the route
 *   could not offer it and the connector could not ask for it. It is here now, and both call it.
 * @structure
 *   - SNIPPET_RADIUS — characters kept either side of the match
 *   - isVersionKey(key) — is this a `.version.N` history row
 *   - snippetOf(text, needle) — the window, with ellipses where it was cut
 *   - searchHitShape(record, query) — the meta-only hit: key, snippet, bytes, visibility, tags, updated_at
 *   - typeOfRecord(value) / matchesType(value, wanted) — the semantic `@type` filter, one place
 * @usage
 *   import { isVersionKey, searchHitShape, matchesType } from '../services/memory-search-shape.js';
 * @version-history
 *   v1.1.0 — 2026-09-08 — `matchesType`: search narrowed by what a record IS. Records have carried
 *     `@type` since Phase 0.7 and nothing could filter on it, so the annotation was written and
 *     never read — which is what made it decorative.
 *   v1.0.0 — 2026-09-06 — Extracted from mcp/memory-extended.ts so the REST door can answer the same
 *     way (review item 6.4).
 */
import type { MemoryRecord } from '../storage/interface.js';
import { contextOf, expandTerm } from '../utils/onto-context.js';

/** Characters kept either side of the match. Enough to read the sentence, not the record. */
export const SNIPPET_RADIUS = 120;

/** A `.version.N` history snapshot: immutable, never what a search is looking for. */
export function isVersionKey(key: string): boolean {
    return /\.version\.\d+$/.test(key);
}

/** A window of `text` around `needle`, with ellipses marking where it was cut. */
export function snippetOf(text: string, needle: string): string {
    const i = text.toLowerCase().indexOf(needle.toLowerCase());
    if (i < 0) return text.slice(0, SNIPPET_RADIUS * 2).trim() + (text.length > SNIPPET_RADIUS * 2 ? '…' : '');
    const s = Math.max(0, i - SNIPPET_RADIUS);
    const e = i + needle.length + SNIPPET_RADIUS;
    return (s > 0 ? '…' : '') + text.slice(s, e).trim() + (e < text.length ? '…' : '');
}

export interface MemorySearchHit {
    key: string;
    snippet: string;
    bytes: number;
    visibility: string;
    tags?: string[];
    updated_at?: string;
}

/**
 * The `@type` a stored value declares, or null.
 *
 * Reads the value's OWN annotation only. It does not go hunting through nested objects: a record
 * saying what it is says so at the top, and a type found three levels down belongs to something the
 * record contains rather than to the record.
 */
export function typeOfRecord(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const t = (value as Record<string, unknown>)['@type'];
    if (typeof t === 'string') return t;
    if (Array.isArray(t) && typeof t[0] === 'string') return t[0];
    return null;
}

/**
 * Is this record one of the types asked for?
 *
 * Compares EXPANDED forms, so `schema:Person` matches a record written as
 * `https://schema.org/Person` and the caller does not have to know which spelling the writer used.
 * A record's own `@context` is honoured, so a document that remapped a prefix is read the way it
 * meant itself.
 *
 * WHAT THIS CANNOT SEE, and it is written here rather than left to be discovered: the filter runs
 * over what the text search already found. A record of the right type that the query did not match
 * is not in the candidate set and cannot be recovered by filtering. The doors handle that by
 * searching for the type STRING when no query is given, which is what makes "list my Person records"
 * work at all — the type is indexed like any other scalar in the value.
 */
export function matchesType(value: unknown, wanted: string[]): boolean {
    if (!wanted.length) return true;
    const t = typeOfRecord(value);
    if (!t) return false;
    const ctx = contextOf(value);
    const have = expandTerm(t, ctx);
    return wanted.some((w) => expandTerm(w.trim(), ctx) === have);
}

/** One hit with the value replaced by a window of it and its size. */
export function searchHitShape(r: MemoryRecord, query: string): MemorySearchHit {
    const valStr = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
    return {
        key: r.key,
        snippet: snippetOf(valStr, query.trim()),
        bytes: valStr.length,
        visibility: r.visibility,
        tags: r.tags,
        updated_at: r.updatedAt,
    };
}
