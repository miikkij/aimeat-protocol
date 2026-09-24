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
 * @structure readBodyCapped(resp, maxBytes)
 * @usage
 *   const body = await readBodyCapped(res, capBytes);
 *   if (body === null) return refuse(413, 'SIZE_EXCEEDED', 'That is over the limit.');
 * @version-history
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
