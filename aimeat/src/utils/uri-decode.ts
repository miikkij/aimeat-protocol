/**
 * @file src/utils/uri-decode.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Percent-decoding that answers instead of throwing. decodeURIComponent throws on a
 *   stray `%` or an escape that is not UTF-8, and every caller then needed a catch that turned the
 *   failure into "nothing here", which is the shape the no-silent-catch rule refuses. Here a string
 *   that is not well-formed percent-encoding is null, decided before anything is decoded, and bytes
 *   that are not UTF-8 decode to U+FFFD: a name that never matches anything stored.
 * @structure decodeUriSegment(s) → string | null
 * @usage const key = decodeUriSegment(seg); if (key === null) return notFound();
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (the page frame's file references and a shared page's image).
 */

const WELL_FORMED = /^(?:[^%]|%[0-9A-Fa-f]{2})*$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/** One URI component decoded, or null when it is not well-formed percent-encoding. */
export function decodeUriSegment(s: string): string | null {
    if (typeof s !== 'string' || !WELL_FORMED.test(s)) return null;
    if (!s.includes('%')) return s;
    const bytes: number[] = [];
    for (let i = 0; i < s.length;) {
        if (s[i] === '%') { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; continue; }
        const ch = String.fromCodePoint(s.codePointAt(i)!);
        for (const b of encoder.encode(ch)) bytes.push(b);
        i += ch.length;
    }
    return decoder.decode(new Uint8Array(bytes));
}
