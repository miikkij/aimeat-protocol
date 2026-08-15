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
 *   rangeNotSatisfiable() — the three response shapes a door needs · serveStoredFile() — all three,
 *   plus the read, in the one order that does not load a file to send part of it
 * @usage
 *   const file = await storage.getStorageFileMeta(gaii, key);      // no bytes yet
 *   if (!file) { …404… }
 *   res.setHeader('Cache-Control', 'public, max-age=300');          // this door's own headers first
 *   const served = await serveStoredFile(res, file, req.headers.range, {
 *       range: (start, length) => storage.readStorageFileRange(gaii, key, start, length),
 *       all: () => storage.getStorageFile(gaii, key).then(f => f?.data ?? null),
 *   });
 *   if (!served) { …404… }                                         // it vanished mid-request
 * @version-history
 *   v1.1.0 -- 2026-08-15 -- TARGET-063: serveStoredFile(), so a range is read as a range. The four
 *     doors each carried the same three-line dance and each began by loading the whole file.
 *   v1.0.0 -- 2026-08-15 -- TARGET-063 A1: extracted from the three copies in routes/storage-files.ts,
 *     with suffix ranges, 416 and Accept-Ranges added. GET /v1/pub gains range support for the first
 *     time; it is the door a program reading a data package from its permanent address knocks at.
 */
import type { Response } from 'express';
import { setStoredFileHeaders } from './file-download-headers.js';
import { needsUtf8Verdict } from './app-content-type.js';

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
 * 206 with the slice.
 *
 * `chunk` is the slice and `file` describes the WHOLE representation, which is the distinction the
 * Content-Range header itself makes. `setStoredFileHeaders` follows the same rule: it takes the
 * file's stored UTF-8 verdict when there is one, so this response names the same content type the
 * full GET does. Sniffing the slice would not — a multi-byte character straddling the boundary
 * fails a decode that the whole file passes.
 */
export function sendPartialContent(
    res: Response,
    file: { key: string; mimeType: string; size: number; data?: Buffer; utf8Verified?: boolean },
    range: { start: number; end: number },
    chunk: Buffer,
): void {
    res.status(206);
    setStoredFileHeaders(res, file);
    setAcceptRanges(res);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
    res.setHeader('Content-Length', chunk.length);
    res.end(chunk);
}

/**
 * Does naming this file's content type still require reading it?
 *
 * Only for a row written before the UTF-8 verdict was recorded, and only for a type whose served
 * form the verdict would change. Everything written since answers from metadata alone, and this
 * shrinks to nothing as old rows are rewritten.
 */
export function needsBytesForType(file: { mimeType: string; utf8Verified?: boolean }): boolean {
    return file.utf8Verified === undefined && needsUtf8Verdict(file.mimeType);
}

/** How a door gets at the bytes it is about to serve. Both halves come from the storage layer, and
 *  a range read never touches the rest of the file. */
export interface StoredFileReader {
    /** `length` bytes from byte offset `start`. Null only if the file has disappeared. */
    range(start: number, length: number): Promise<Buffer | null>;
    /** The whole representation. Null only if the file has disappeared. */
    all(): Promise<Buffer | null>;
}

/**
 * Serve one stored file, honouring `Range`, from METADATA plus a reader.
 *
 * WHY THE READER IS A CALLBACK AND NOT A BUFFER. Every door here used to load the entire file and
 * then decide what part of it to send, which meant an eight-byte suffix request — the first thing a
 * Parquet reader asks for — read 25 MB out of the database to answer it. Measured on Postgres:
 * 181 ms that way, 3 ms as a database-side substring, and the gap widens with the file. Taking the
 * reader rather than the bytes is what lets the decision come BEFORE the read.
 *
 * The caller sets its own caching and CORS headers first; they differ per door and these do not.
 * Returns false when the file vanished between the metadata read and the bytes, and sends nothing —
 * the caller owns the 404 because only it knows which shape of "not found" that door tells.
 */
export async function serveStoredFile(
    res: Response,
    file: { key: string; mimeType: string; size: number; utf8Verified?: boolean },
    rangeHeader: string | undefined,
    read: StoredFileReader,
    opts: { headOnly?: boolean } = {},
): Promise<boolean> {
    // ONE decision, made before anything is sent: can this file's content type be named without its
    // bytes? With a stored verdict, yes, and nothing outside the requested range is ever read. For a
    // file written before the verdict existed the charset still lives in the content, so the whole
    // file is read — the same cost as before this change, paid only by rows that predate it, and
    // gone the next time each one is written.
    //
    // Getting this wrong is not a slow response but a false one. An earlier draft passed the
    // metadata record straight through, and its `data` is an EMPTY buffer: the sniffer decoded zero
    // bytes, found them valid UTF-8, and stamped `charset=utf-8` on a range reply. On a genuinely
    // cp1252 file that declares an encoding the file does not have, over a GET of the same file that
    // correctly declares nothing.
    const whole = needsBytesForType(file) ? await read.all() : null;
    if (needsBytesForType(file) && !whole) return false;
    const described = whole ? { ...file, data: whole } : file;

    // A HEAD answers out of that and reads nothing more. Express auto-handles HEAD through the GET
    // handler, so /v1/pub was loading the entire file and discarding the body: 114 ms measured, for
    // a 10 MB file, to send zero bytes.
    if (opts.headOnly) {
        setStoredFileHeaders(res, described);
        setAcceptRanges(res);
        res.setHeader('Content-Length', file.size);
        res.end();
        return true;
    }

    const verdict = parseRangeHeader(rangeHeader, file.size);
    if (verdict.kind === 'unsatisfiable') { rangeNotSatisfiable(res, file.size, verdict.reason); return true; }
    if (verdict.kind === 'partial') {
        // When the file is already in hand there is nothing to gain from asking the database for a
        // slice of it, so the second read is skipped rather than repeated.
        const chunk = whole
            ? whole.subarray(verdict.start, verdict.end + 1)
            : await read.range(verdict.start, verdict.end - verdict.start + 1);
        if (!chunk) return false;
        sendPartialContent(res, described, verdict, chunk);
        return true;
    }
    const data = whole ?? await read.all();
    if (!data) return false;
    setStoredFileHeaders(res, { ...described, data });
    setAcceptRanges(res);
    res.setHeader('Content-Length', file.size);
    res.end(data);
    return true;
}
