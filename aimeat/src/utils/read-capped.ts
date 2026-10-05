/**
 * @file src/utils/read-capped.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read an HTTP response body with a ceiling that holds WHILE it arrives.
 *
 *   `arrayBuffer()`, `text()` and `json()` hold the whole body in this process before anything can
 *   measure it, so a cap checked on their result has done nothing about memory: a source that sends
 *   no Content-Length, or a false one, streams as much as it likes first. This reads the stream chunk
 *   by chunk with a running total and cancels it at the first chunk that passes the cap, so a body
 *   costs at most the cap plus one chunk. Promoted from services/connections/read.ts, where it was a
 *   private copy, when the package pull needed the same read (secaudit 2026-09, A6-13).
 *
 *   capResponseBody is the same ceiling for a body this node does not read itself: it hands on a
 *   Response whose body stops at the ceiling, for a library that calls json() or reads the stream
 *   (the MCP SDK, through the guarded fetch in services/mcp-client/transport.ts).
 *
 *   OUTBOUND_READ_MAX_BYTES is the ceiling itself for the three reads of an answer from a service a
 *   person chose to call: a connected account, an extension's ctx.fetch and a decision provider.
 * @structure OUTBOUND_READ_MAX_BYTES · readBodyCapped(resp, maxBytes) · readBodyPrefix(resp, maxBytes) ·
 *   readJsonCapped(resp, maxBytes) · readTextCapped(resp, maxBytes) · readJson(resp, maxBytes) ·
 *   readText(resp, maxBytes) · capResponseBody(resp, maxBytes) ·
 *   ResponseTooLargeError
 * @usage
 *   const body = await readBodyCapped(res, capBytes);
 *   if (body === null) return refuse(413, 'SIZE_EXCEEDED', 'That is over the limit.');
 *   const capped = capResponseBody(await safeFetch(url), 16 * 1024 * 1024);
 *   const answer = await readBodyCapped(res, OUTBOUND_READ_MAX_BYTES);
 * @version-history
 *   v1.3.0 — 2026-10-05 — readBodyPrefix (a cut read, for a link preview's page head), readJsonCapped
 *     and readTextCapped (answer the reason), readJson and readText (throw as json() and text() do):
 *     the capped forms of json() and text() (secaudit 2026-10, C6).
 *   v1.2.0 — 2026-09-26 — OUTBOUND_READ_MAX_BYTES (4 MB): one ceiling for a connected account's read,
 *     an extension's ctx.fetch and a decision provider's answer (secaudit 2026-09, N3).
 *   v1.1.1 — 2026-09-26 — capResponseBody refuses a status outside 200 to 599 and cancels its body
 *     unread: fetch hands back 600 or 999, and rebuilding the Response threw with the body half piped.
 *   v1.1.0 — 2026-09-26 — capResponseBody and ResponseTooLargeError: a body handed on to a library
 *     errors at the ceiling, counted per event on an event stream (secaudit 2026-09, A2-2).
 *   v1.0.0 — 2026-09-24 — Initial: promoted from services/connections/read.ts (secaudit 2026-09, A6-13).
 */
import { logger } from './logger.js';

/**
 * How much of one answer this node reads from a service outside it that a person, or code acting
 * for them, chose to call: a read from a connected account (services/connections/read.ts), an
 * extension's ctx.fetch (services/extension-ctx.ts) and a decision provider's answer
 * (services/decide/systemone-client.ts). One number, so the three cannot drift apart; 4 MB is the
 * ceiling the connection read had first.
 */
export const OUTBOUND_READ_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The body as a Buffer, or null once it passes `maxBytes`. A response with no body is an empty
 * Buffer. When the cap is passed the stream is cancelled, so the rest of it is never read.
 */
export async function readBodyCapped(resp: Response, maxBytes: number): Promise<Buffer | null> {
    if (!resp.body) return Buffer.alloc(0);
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            // The answer is already decided; a source that fails to close must not turn a refusal
            // into an exception.
            await reader.cancel().catch(err => logger.warn('readBodyCapped: cancel after the cap failed', { error: String(err) }));
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

/**
 * The first `maxBytes` of the body, the rest cancelled unread: for a reader that needs only the
 * beginning (a page's <head> for a link preview). A body over the cap is cut, never refused, so use
 * readBodyCapped wherever a cut body would be wrong (an image, JSON).
 */
export async function readBodyPrefix(resp: Response, maxBytes: number): Promise<Buffer> {
    if (!resp.body) return Buffer.alloc(0);
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const room = maxBytes - total;
        if (value.byteLength >= room) {
            chunks.push(value.subarray(0, room));
            await reader.cancel().catch(err => logger.warn('readBodyPrefix: cancel after the prefix failed', { error: String(err) }));
            break;
        }
        total += value.byteLength;
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

/** A JSON answer read under a ceiling, or why it could not be. */
export type CappedJson =
    | { ok: true; value: unknown }
    | { ok: false; reason: 'too-large' }
    | { ok: false; reason: 'not-json'; text: string };

/**
 * A response's JSON, read with readBodyCapped: `res.json()` holds the whole body in memory before
 * anything can measure it, so a remote service decides how much this process reads. The text of a
 * body that is not JSON comes back cut to 500 characters, for an error message.
 */
export async function readJsonCapped(resp: Response, maxBytes: number): Promise<CappedJson> {
    const body = await readBodyCapped(resp, maxBytes);
    if (body === null) return { ok: false, reason: 'too-large' };
    const text = body.toString('utf8');
    try { return { ok: true, value: JSON.parse(text) as unknown }; } catch {
        return { ok: false, reason: 'not-json', text: text.slice(0, 500) };
    }
}

/**
 * `resp.json()` with a ceiling: the parsed body, or ResponseTooLargeError once more than `maxBytes`
 * arrive, or the parse error as json() throws it. For a caller written against json() that should
 * fail the same way, only bounded.
 */
export async function readJson(resp: Response, maxBytes: number): Promise<unknown> {
    const body = await readBodyCapped(resp, maxBytes);
    if (body === null) throw new ResponseTooLargeError(maxBytes);
    return JSON.parse(body.toString('utf8')) as unknown;
}

/** `resp.text()` with a ceiling: the text, or ResponseTooLargeError once more than `maxBytes` arrive. */
export async function readText(resp: Response, maxBytes: number): Promise<string> {
    const body = await readBodyCapped(resp, maxBytes);
    if (body === null) throw new ResponseTooLargeError(maxBytes);
    return body.toString('utf8');
}

/** A response's text under a ceiling, or null once it passes the ceiling. */
export async function readTextCapped(resp: Response, maxBytes: number): Promise<string | null> {
    const body = await readBodyCapped(resp, maxBytes);
    return body === null ? null : body.toString('utf8');
}

/** What a capped body errors with at its ceiling. `code` is how a caller tells it from a dropped socket. */
export class ResponseTooLargeError extends Error {
    readonly code = 'RESPONSE_TOO_LARGE';
    constructor(readonly maxBytes: number) {
        super(`The answer passed ${maxBytes} bytes in one piece, which is more than this node reads.`);
        this.name = 'ResponseTooLargeError';
    }
}

/** Statuses whose response can have no body, which the Response constructor refuses one for. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const LF = 0x0a;
const CR = 0x0d;

/**
 * The same response, with a body that errors with ResponseTooLargeError once more than `maxBytes`
 * of it arrive in one piece, and cancels the rest of the stream so the far side stops sending.
 * Whoever reads the body, json(), text() or a stream parser, gets the error instead of the rest.
 *
 * ONE PIECE is the whole body, except on an event stream (`text/event-stream`), where it is one
 * event: the count starts again at every blank line, which is where an event ends. A stream that
 * stays open for hours carrying small events lives on, and one event larger than the ceiling does
 * not, since a parser holds a whole event before it hands it over.
 */
export function capResponseBody(resp: Response, maxBytes: number): Response {
    if (!resp.body || NULL_BODY_STATUSES.has(resp.status)) return resp;
    // fetch hands back a status such as 600 or 999, which the Response constructor refuses and HTTP
    // gives no meaning. There is nothing to hand on: the body is cancelled unread, and the request
    // fails the way a dropped connection does.
    if (resp.status < 200 || resp.status > 599) {
        resp.body.cancel().catch(err => logger.warn('capResponseBody: cancelling an unusable answer failed', { error: String(err) }));
        throw new TypeError(`The far side answered with status ${resp.status}, which is outside HTTP's 200 to 599.`);
    }
    const perEvent = (resp.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    let run = 0;
    // A line ended with the byte before (so a second line end makes a blank line), and whether that
    // byte was a CR (so a LF after it is the same CRLF line end, not a second one).
    let lineEnded = false;
    let afterCr = false;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            let over = false;
            if (!perEvent) over = (run += chunk.byteLength) > maxBytes;
            else {
                // Asked at every byte, not at the end of the piece: one piece can hold an event past
                // the ceiling AND the blank line that ends it, and the count would be back at nothing.
                for (let i = 0; i < chunk.length && !over; i++) {
                    const b = chunk[i];
                    if (b === LF && afterCr) { afterCr = false; run++; }
                    else if (b === LF || b === CR) {
                        if (lineEnded) { run = 0; lineEnded = false; }
                        else { lineEnded = true; run++; }
                        afterCr = b === CR;
                    } else { lineEnded = false; afterCr = false; run++; }
                    over = run > maxBytes;
                }
            }
            // Erroring the transform aborts the pipe, which cancels the source: the rest is never read.
            if (over) { controller.error(new ResponseTooLargeError(maxBytes)); return; }
            controller.enqueue(chunk);
        },
    });
    return new Response(resp.body.pipeThrough(counter), {
        status: resp.status, statusText: resp.statusText, headers: resp.headers,
    });
}
