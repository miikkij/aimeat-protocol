/**
 * @file src/utils/http-range.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   rangeNotSatisfiable() — the three response shapes a door needs · storedFileVersion() /
 *   storedFileEtag() / versionedAddress() — the per-write token behind the ETag and an upload
 *   answer's `?v=` · serveStoredFile() — all of it,
 *   plus the read, in the one order that does not load a file to send part of it or to answer 304
 * @usage
 *   const file = await storage.getStorageFileMeta(gaii, key);      // no bytes yet
 *   if (!file) { …404… }
 *   res.setHeader('Cache-Control', 'public, max-age=300');          // this door's own headers first
 *   const served = await serveStoredFile(res, file, req.headers.range, {
 *       range: (start, length) => storage.readStorageFileRange(gaii, key, start, length),
 *       all: () => storage.getStorageFile(gaii, key).then(f => f?.data ?? null),
 *   }, { headOnly: req.method === 'HEAD', conditionals: req.headers });
 *   if (!served) { …404… }                                         // it vanished mid-request
 * @version-history
 *   v1.2.0 -- 2026-09-13 -- Revalidation. Every stored-file response carries a strong ETag built from
 *     the write time and size (storedFileVersion), If-None-Match and If-Modified-Since are answered
 *     304 before anything is read, and If-Range that no longer names the file sends the whole file.
 *     A re-upload to the same key was served stale for up to five minutes with nothing to revalidate
 *     against (appdev pitfall pub-file-cache-stale-assets).
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
    file: { key: string; mimeType: string; size: number; data?: Buffer; utf8Verified?: boolean; downloadName?: string },
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

/**
 * The version of one stored write, as a short URL-safe token: the write time in milliseconds and the
 * size, both in base 36. Null when the record carries no write time.
 *
 * Every write stamps a new `createdAt` (services/storage-file-write.ts, and both providers overwrite
 * it on conflict), so the token changes each time a key is written again, and it is read from
 * metadata alone. Two uses: the strong ETag below, and the `?v=` an upload answer puts on the file's
 * address so a re-upload is a different URL to every cache (GET /v1/pub ignores the query).
 */
export function storedFileVersion(file: { size: number; createdAt?: string }): string | null {
    if (!file.createdAt) return null;
    const at = Date.parse(file.createdAt);
    if (Number.isNaN(at)) return null;
    return `${at.toString(36)}-${file.size.toString(36)}`;
}

/** The strong ETag of one stored write, quoted, or null when the record carries no write time. */
export function storedFileEtag(file: { size: number; createdAt?: string }): string | null {
    const version = storedFileVersion(file);
    return version ? `"${version}"` : null;
}

/**
 * A file's address with `v=<storedFileVersion>` added to its query, for an upload answer to hand
 * out. The address stays the one the file is served at: GET /v1/pub reads the path and ignores the
 * query. What changes is the cache key, so a page that switches to the new address after a
 * re-upload gets the new bytes at once rather than when the old copy's max-age runs out.
 */
export function versionedAddress(url: string, file: { size: number; createdAt?: string }): string {
    const version = storedFileVersion(file);
    return version ? `${url}${url.includes('?') ? '&' : '?'}v=${version}` : url;
}

/** The request headers a conditional answer reads. `req.headers` fits as it is. */
export interface ConditionalHeaders {
    'if-none-match'?: string;
    'if-modified-since'?: string;
    'if-range'?: string;
}

/** The entity tags in an If-None-Match or If-Range value, each without its `W/` prefix. */
function entityTags(value: string): string[] {
    return [...value.matchAll(/(?:W\/)?("[^"]*")/g)].map(m => m[1]);
}

/**
 * RFC 9110 §13.2.2 steps 3 and 4 for a GET or HEAD: may this request be answered 304?
 *
 * If-None-Match is decided first and, when present, If-Modified-Since is not consulted at all. The
 * comparison is WEAK, so a `W/` form of our tag matches: a proxy that compresses the response weakens
 * the tag it forwards, and the browser sends that form back. If-Modified-Since compares at whole
 * seconds, which is the resolution of an HTTP-date, and an unparseable date is ignored.
 */
function notModified(headers: ConditionalHeaders, etag: string | null, modifiedMs: number | null): boolean {
    const inm = headers['if-none-match'];
    if (typeof inm === 'string' && inm.trim()) {
        if (inm.trim() === '*') return true;
        return etag !== null && entityTags(inm).includes(etag);
    }
    const ims = headers['if-modified-since'];
    if (typeof ims === 'string' && ims.trim() && modifiedMs !== null) {
        const since = Date.parse(ims);
        if (Number.isNaN(since)) return false;
        return Math.floor(modifiedMs / 1000) * 1000 <= since;
    }
    return false;
}

/**
 * RFC 9110 §13.1.5: does an If-Range still name this representation? An entity tag must match
 * STRONGLY, and a date must equal Last-Modified exactly. Anything else means the file changed since
 * the client's earlier ranges, and the answer is the whole new file, never a slice of it.
 */
function ifRangeHolds(value: string, etag: string | null, lastModified: string | null): boolean {
    const v = value.trim();
    if (v.startsWith('"') || v.startsWith('W/')) return etag !== null && v === etag;
    return lastModified !== null && Date.parse(v) === Date.parse(lastModified);
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
    file: { key: string; mimeType: string; size: number; utf8Verified?: boolean; createdAt?: string; downloadName?: string },
    rangeHeader: string | undefined,
    read: StoredFileReader,
    opts: { headOnly?: boolean; conditionals?: ConditionalHeaders } = {},
): Promise<boolean> {
    // Validators, on every representation of the file. A ranged reader keeps one of these between
    // requests to know the bytes did not move under it, and DuckDB reads Last-Modified straight off
    // the probe. They cost nothing: the write time and the size are already in the metadata.
    let lastModified: string | null = null;
    let modifiedMs: number | null = null;
    if (file.createdAt) {
        const at = new Date(file.createdAt);
        if (!Number.isNaN(at.getTime())) {
            lastModified = at.toUTCString();
            modifiedMs = at.getTime();
            res.setHeader('Last-Modified', lastModified);
        }
    }
    // THE ETAG IS WHAT MAKES A SHORT max-age SAFE. A re-upload replaces the row under the same key,
    // and GET /v1/pub answers with five minutes of freshness: with only Last-Modified, a browser
    // holding the old response had no cheap way to learn the bytes changed, and an app iterating on
    // an asset looked at the old picture and concluded its fix had failed (appdev pitfall
    // pub-file-cache-stale-assets). Strong, because a new write is a new createdAt.
    const etag = storedFileEtag(file);
    if (etag) res.setHeader('ETag', etag);

    // A conditional request that still holds is answered before anything is read, the legacy
    // charset read included, and before Range: RFC 9110 §13.2.2 evaluates the preconditions first,
    // and a 304 ignores the range. The caller's own headers (Cache-Control, CORS) are already set.
    const conditionals = opts.conditionals ?? {};
    if (notModified(conditionals, etag, modifiedMs)) {
        res.status(304);
        res.end();
        return true;
    }
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

    // If-Range that no longer names this file turns the range request into a plain GET.
    const ifRange = conditionals['if-range'];
    const rangeStillApplies = !(typeof ifRange === 'string' && ifRange.trim())
        || ifRangeHolds(ifRange, etag, lastModified);
    const verdict = parseRangeHeader(rangeStillApplies ? rangeHeader : undefined, file.size);

    // A HEAD answers out of the metadata and reads nothing more. Express auto-handles HEAD through
    // the GET handler, so /v1/pub was loading the entire file and discarding the body: 114 ms
    // measured, for a 10 MB file, to send zero bytes.
    //
    // IT STILL HONOURS `Range`, and that is not pedantry about RFC 9110's "same headers a GET would
    // send". A HEAD carrying `Range: bytes=0-` is how a client ASKS whether this server does ranges,
    // and DuckDB-Wasm's own words for the answer are `if (contentLength !== null && status == 206)`.
    // An earlier version of this function short-circuited before reading the Range header, so that
    // probe got 200 and the full length. DuckDB read it as "no ranges here" and downloaded an 8.45 MB
    // Parquet file in one request to answer a two-column aggregate — and with full reads disabled it
    // refused to open the file at all. A fast HEAD that lies about ranges is worse than a slow one.
    if (opts.headOnly) {
        if (verdict.kind === 'unsatisfiable') { rangeNotSatisfiable(res, file.size, verdict.reason); return true; }
        setStoredFileHeaders(res, described);
        setAcceptRanges(res);
        if (verdict.kind === 'partial') {
            res.status(206);
            res.setHeader('Content-Range', `bytes ${verdict.start}-${verdict.end}/${file.size}`);
            res.setHeader('Content-Length', verdict.end - verdict.start + 1);
        } else {
            res.setHeader('Content-Length', file.size);
        }
        res.end();
        return true;
    }
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
