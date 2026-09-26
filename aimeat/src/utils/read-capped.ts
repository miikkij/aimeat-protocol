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
 * @structure readBodyCapped(resp, maxBytes) · capResponseBody(resp, maxBytes) · ResponseTooLargeError
 * @usage
 *   const body = await readBodyCapped(res, capBytes);
 *   if (body === null) return refuse(413, 'SIZE_EXCEEDED', 'That is over the limit.');
 *   const capped = capResponseBody(await safeFetch(url), 16 * 1024 * 1024);
 * @version-history
 *   v1.1.0 — 2026-09-26 — capResponseBody and ResponseTooLargeError: a body handed on to a library
 *     errors at the ceiling, counted per event on an event stream (secaudit 2026-09, A2-2).
 *   v1.0.0 — 2026-09-24 — Initial: promoted from services/connections/read.ts (secaudit 2026-09, A6-13).
 */
import { logger } from './logger.js';

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
