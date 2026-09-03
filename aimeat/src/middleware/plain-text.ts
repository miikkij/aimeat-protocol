/**
 * @file src/middleware/plain-text.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Send a text body and make the promise that it is text enforceable.
 *
 *   The prompt routes answer `?format=txt` with a document built around what the caller asked for:
 *   their `idea`, their `owner`, verbatim, because the whole point is a prompt they paste into their
 *   own chat. Escaping it would corrupt the product, so the defence has to be the content type
 *   rather than the content — and a content type is only a defence when the browser is told not to
 *   second-guess it. `text/plain` alone is a suggestion; with `X-Content-Type-Options: nosniff` it
 *   is a rule, and a body a browser cannot be talked into parsing as HTML cannot carry a script.
 *
 *   In one place because it was in six, three lines at a time, and the sixth (prompts-cortex.ts)
 *   arrived without the header the way a copied block always eventually does.
 * @structure sendPlainText(res, body)
 * @usage
 *   if (req.query.format === 'txt') { sendPlainText(res, full); return; }
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial, with nosniff (CodeQL js/reflected-xss 1602).
 */
import type { Response } from 'express';

/**
 * Answer with `body` as plain UTF-8 text that a browser may not reinterpret.
 *
 * The header is set before the body rather than chained onto the send, so the response object
 * carries its content type as its own state — which is what both a browser and a reader of this
 * code can check.
 */
export function sendPlainText(res: Response, body: string): void {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(body);
}
