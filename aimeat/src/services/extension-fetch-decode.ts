/**
 * @file src/services/extension-fetch-decode.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How ctx.fetch reads an answer into text: up to a byte ceiling, inflated when asked,
 *   decoded by the charset the header or the document declares. Moved out of
 *   services/extension-ctx.ts unchanged when that file passed 800 lines (pure extraction).
 * @structure looksLikeUtf8 · hostOfUrl · decodeBody (exported)
 * @usage const text = await decodeBody(resp, url, strictCharset, { gunzip, maxBytes });
 * @version-history
 *   v1.0.0 — 2026-10-10 — Moved from services/extension-ctx.ts (800-line rule), no change in behaviour.
 */
import { readBodyCapped, inflateCapped, OUTBOUND_READ_MAX_BYTES } from '../utils/read-capped.js';
import { logger } from '../utils/logger.js';

/** Does the buffer contain a well-formed UTF-8 multibyte sequence? Used to overrule a charset label
 *  that says otherwise, which is what a CDN doing its own transcoding leaves behind. */
function looksLikeUtf8(bytes: Uint8Array): boolean {
    for (let i = 0; i < bytes.length - 1; i++) {
        if (bytes[i] >= 0xC2 && bytes[i] <= 0xDF && (bytes[i + 1] & 0xC0) === 0x80) return true;
        if (bytes[i] >= 0xE0 && bytes[i] <= 0xEF && i + 2 < bytes.length &&
            (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) return true;
    }
    return false;
}

/**
 * The host of an address a script called, with its port when it has one, for a message about that
 * call. Never more of the address: the userinfo, the path, the query and the fragment can each carry
 * a key, and the message reaches logs, run records and a person's screen. Null when the string is not
 * an address, which safeFetch would already have refused.
 */
function hostOfUrl(url: string): string | null {
    try {
        return new URL(url).host || null;
    } catch {
        // eslint-disable-next-line aimeat/no-silent-catch -- safeFetch refused an address that does not parse before any answer was read; here it only leaves the host out of one message
        return null;
    }
}

/**
 * Read a response body as text, honouring the charset from the header or the document prolog.
 * Extracted because each hand-built context carried its own copy and they had drifted: three had
 * the mislabelled-encoding guard below and the MCP one did not, so the same feed that reads
 * correctly over REST came back as mojibake through a tool call.
 *
 * TWO MODES, AND THE DEFAULT DOES NOT CHANGE. An extension reading a source feed wants the bytes it
 * can get: a document declaring an encoding nobody has heard of is that document's problem, not a
 * reason to fail the call, so the default falls back to UTF-8 with a warning. That is the right
 * choice for a reader and the WRONG one for a PRODUCER — a data package built from a body that was
 * decoded with a guessed codec is a version with mojibake in it, published at a permanent address,
 * hashed, and indistinguishable from a good one until somebody reads the rows. So `strictCharset`
 * makes an undecodable charset a thrown error, which on the unattended roads is a failed run that
 * leaves the previous version standing. An extension that produces packages opts in with
 * `config: { strictCharset: true }` in its manifest.
 *
 * THE ANSWER IS READ UP TO A CEILING, counted while it arrives: OUTBOUND_READ_MAX_BYTES
 * (utils/read-capped.ts, 4 MB), the one a connected account's read and a decision provider's answer
 * share, or the extension's own `limits.fetch_max_mb` when its manifest declared one. Past it the
 * rest of the stream is cancelled, nothing is decoded, and the call throws `RESPONSE_TOO_LARGE: …`.
 * With `gunzip` the bytes are inflated under the same ceiling before they are decoded, so a gzip
 * bomb stops at the ceiling as a plain stream does. The code leads the message as it does in
 * SECRET_UNKNOWN, because the message is all a script receives, and every road into the sandbox
 * then carries the same code. The message names the host the script called, so an owner whose
 * script calls several services can tell which one answered too much (hostOfUrl below).
 */
export async function decodeBody(resp: Response, url: string, strictCharset = false, read: { gunzip?: boolean; maxBytes?: number } = {}): Promise<string> {
    const maxBytes = read.maxBytes ?? OUTBOUND_READ_MAX_BYTES;
    const raw = await readBodyCapped(resp, maxBytes);
    const buf = raw === null ? null : read.gunzip ? inflateCapped(raw, maxBytes) : raw;
    if (buf === null) {
        const host = hostOfUrl(url);
        const mb = maxBytes / (1024 * 1024);
        throw new Error(`RESPONSE_TOO_LARGE: The answer ${host ? `from ${host} ` : ''}is larger than `
            + `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB, the most ctx.fetch reads of one answer`
            + `${raw !== null ? ' once inflated' : ''}. Ask the source for less: fewer items, one page at a time, or a `
            + 'shorter date range; or raise `limits.fetch_max_mb` in the manifest.');
    }
    const ct = resp.headers.get('content-type') || '';
    let charset = (/charset=([^\s;]+)/i.exec(ct)?.[1] ?? '').toLowerCase();
    if (!charset) {
        const peek = new TextDecoder('ascii').decode(buf.subarray(0, 512));
        const xml = /encoding=['"]([^'"]+)['"]/i.exec(peek)?.[1];
        const meta = /<meta[^>]+charset=["']?([^\s"';>]+)/i.exec(peek)?.[1];
        charset = (xml || meta || 'utf-8').toLowerCase();
    }
    // A document that declares latin-1 but carries valid UTF-8 bytes is mislabelled, not latin-1.
    if (charset !== 'utf-8' && charset !== 'utf8' && looksLikeUtf8(buf)) charset = 'utf-8';
    try {
        return new TextDecoder(charset === 'utf8' ? 'utf-8' : charset).decode(buf);
    } catch {
        if (strictCharset) {
            // A producer's road. Decoding with a codec we had to guess would publish a version whose
            // text is wrong, at a permanent address, with a content hash that makes it look
            // deliberate. Better a failed run: the package stays on its last good version and the
            // owner is told which charset nobody could read.
            throw new Error(
                `CHARSET_UNDECODABLE: the response declares charset "${charset}", which this node cannot decode. `
                + 'Refusing rather than guessing, because a guessed decode becomes a published version nobody can tell '
                + 'apart from a good one. Ask the source for UTF-8, or drop strictCharset if this feed is not a package source.');
        }
        // An unknown label is the document's problem, not a reason to fail the call: fall back to
        // utf-8 and let the extension see the bytes it can.
        logger.warn('extension ctx: unknown charset, decoding as utf-8', { charset });
        return new TextDecoder('utf-8').decode(buf);
    }
}
