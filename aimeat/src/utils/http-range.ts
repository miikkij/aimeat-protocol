/**
 * @file src/utils/http-range.ts
 * @description HTTP byte-range parsing for the stored-file download paths, in one place.
 *
 *   WHAT WAS WRONG. Three download handlers each carried the same four lines, and those four lines
 *   were `/bytes=(\d+)-(\d*)/`. That regex does not match `bytes=-8` — the SUFFIX range, which is
 *   exactly the request a Parquet reader makes first, because the footer is at the end of the file.
 *   A client asking for the last eight bytes got status 200 and the whole file, with no header
 *   anywhere saying the request had not been honoured. That is a silent fallback: the reader
 *   believes it is streaming and is in fact downloading everything, once per range it asks for.
 *   The fourth path, `GET /v1/pub`, never looked at `Range` at all.
 *
 *   And no path ever sent `Accept-Ranges`. A client cannot discover range support by guessing, so
 *   DuckDB, pandas and every HTTP range reader concluded the node does not do ranges — correctly,
 *   from the evidence they had.
 *
 *   THE RULES THIS ENCODES, and why each one is what it is:
 *
 *   - `bytes=N-M`, `bytes=N-` and `bytes=-N` all parse. `M` past the end clamps to the last byte,
 *     which RFC 9110 §14.1.2 requires; `-N` larger than the file means the whole file, same clause.
 *   - A range unit that is NOT `bytes` is IGNORED and the full representation is sent. RFC 9110
 *     §14.2 says MUST on this, and it is not a covering fallback: `Accept-Ranges: bytes` on the
 *     same response has already told the client which unit this server speaks.
 *   - A `bytes=` header that does not parse, or that starts past the end of the file, is
 *     UNSATISFIABLE. That answers 416 with a `Content-Range` of `bytes STAR/size`, never a 200. This is
 *     the case the old regex covered up.
 *   - A MULTI-range request (`bytes=0-9, 20-29`) is refused with 416 rather than served as one
 *     coalesced span or silently reduced to its first range. A `multipart/byteranges` body is not
 *     implemented here, and answering a two-range request with one range's bytes, under a status
 *     code that claims the request was honoured, is the same class of defect this file exists to
 *     remove. No stored-file client on this node sends one.
 * @structure parseRangeHeader() — the verdict · sendPartialContent() / setAcceptRanges() /
 *   rangeNotSatisfiable() — the three response shapes a door needs
 * @usage
 *   const verdict = parseRangeHeader(req.headers.range, file.size);
 *   if (verdict.kind === 'unsatisfiable') { rangeNotSatisfiable(res, file.size); return; }
 *   if (verdict.kind === 'partial') { sendPartialContent(res, file, verdict); return; }
 *   setAcceptRanges(res); setStoredFileHeaders(res, file); res.end(file.data);
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- TARGET-063 A1: extracted from the three copies in routes/storage-files.ts,
 *     with suffix ranges, 416 and Accept-Ranges added. GET /v1/pub gains range support for the first
 *     time; it is the door a program reading a data package from its permanent address knocks at.
 */
import type { Response } from 'express';
import { setStoredFileHeaders } from './file-download-headers.js';

/** What a `Range` header means for one representation of a known size. */
export type RangeVerdict =
    /** No usable range: absent header, or a unit this server does not speak. Send the whole thing, 200. */
    | { kind: 'full' }
    /** Inclusive byte offsets into the representation. Send 206. */
    | { kind: 'partial'; start: number; end: number }
    /** The header named `bytes` and could not be honoured. Send 416 — never 200. */
    | { kind: 'unsatisfiable'; reason: string };

/**
 * Decide what a `Range` header asks for.
 *
 * `size` is the complete length of the representation. A zero-length file makes every byte range
 * unsatisfiable, which is what RFC 9110 §15.5.17 describes and what a client needs to hear rather
 * than a 200 with no bytes and a status that says it was a partial answer.
 */
export function parseRangeHeader(header: string | undefined | null, size: number): RangeVerdict {
    const raw = (header ?? '').trim();
    if (!raw) return { kind: 'full' };

    // A unit we do not speak. RFC 9110 §14.2: ignore it and answer with the full representation.
    // `Accept-Ranges: bytes` is on that same response, so the client is not left guessing.
    if (!/^bytes\s*=/i.test(raw)) return { kind: 'full' };

    const spec = raw.slice(raw.indexOf('=') + 1).trim();
    if (spec.includes(',')) {
        return {
            kind: 'unsatisfiable',
            reason: 'This server serves one byte range per request. A multipart/byteranges response is '
                + 'not implemented, and answering part of what was asked under a success status would '
                + 'hide that. Ask for one range at a time.',
        };
    }

    // suffix-byte-range-spec: "-N" — the LAST N bytes. The shape a Parquet reader opens with.
    const suffix = /^-(\d+)$/.exec(spec);
    if (suffix) {
        const wanted = parseInt(suffix[1], 10);
        if (!Number.isFinite(wanted) || wanted <= 0 || size === 0) {
            return { kind: 'unsatisfiable', reason: `suffix range "${spec}" against a ${size}-byte representation` };
        }
        // Asking for more than there is means the whole thing (RFC 9110 §14.1.2), not an error.
        return { kind: 'partial', start: Math.max(0, size - wanted), end: size - 1 };
    }

    // int-byte-range-spec: "N-" or "N-M".
    const explicit = /^(\d+)-(\d*)$/.exec(spec);
    if (!explicit) {
        return { kind: 'unsatisfiable', reason: `unparseable byte range "${spec}"` };
    }
    const start = parseInt(explicit[1], 10);
    // An absent last-byte-pos means "to the end"; one past the end clamps to the last byte.
    const end = explicit[2] === '' ? size - 1 : Math.min(parseInt(explicit[2], 10), size - 1);
    if (!Number.isFinite(start) || size === 0 || start >= size || end < start) {
        return { kind: 'unsatisfiable', reason: `byte range "${spec}" against a ${size}-byte representation` };
    }
    return { kind: 'partial', start, end };
}

/**
 * Announce range support. Belongs on EVERY response that carries (or describes) stored bytes,
 * including the 200 and the HEAD: a client decides whether to range-read from this header, and a
 * server that answers ranges without advertising them is a server nothing ranges against.
 */
export function setAcceptRanges(res: Response): void {
    res.setHeader('Accept-Ranges', 'bytes');
}

/**
 * 416 with the one header that makes it actionable: a `Content-Range` of `bytes STAR/size` tells the
 * client how long the representation actually is, so its next request can be a valid one.
 *
 * Deliberately NOT the envelope. This is a byte-serving path, the caller may be a database engine
 * rather than a browser, and the status plus Content-Range is the whole message.
 */
export function rangeNotSatisfiable(res: Response, size: number, reason: string): void {
    res.status(416);
    setAcceptRanges(res);
    res.setHeader('Content-Range', `bytes */${size}`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`416 Range Not Satisfiable: ${reason}\n`);
}

/**
 * 206 with the slice. `setStoredFileHeaders` is passed the WHOLE file on purpose (its own contract):
 * the content type is sniffed from the complete bytes, so a multi-byte character straddling the
 * boundary cannot make a good UTF-8 file look like a broken one.
 */
export function sendPartialContent(
    res: Response,
    file: { key: string; mimeType: string; size: number; data: Buffer },
    range: { start: number; end: number },
): void {
    const chunk = file.data.subarray(range.start, range.end + 1);
    res.status(206);
    setStoredFileHeaders(res, file);
    setAcceptRanges(res);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
    res.setHeader('Content-Length', chunk.length);
    res.end(chunk);
}
