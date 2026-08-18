/**
 * @file base64.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Strict base64 decoder used by every inline-upload endpoint
 *   (POST /v1/apps, POST /v1/memory/files, POST /v1/storage, app screenshot).
 *   Wraps Node's `Buffer.from(str, 'base64')` with input validation because
 *   the built-in is permissive: it silently drops characters outside the
 *   base64 alphabet. A caller that mistakenly sends raw HTML, JSON, or
 *   binary therefore gets a successful upload with a tiny garbage payload,
 *   served back as 200 to downloaders with no diagnostic anywhere.
 * @structure
 *   - decodeStrictBase64() -- validate, then decode. Null on invalid input.
 * @usage
 *   import { decodeStrictBase64 } from '../utils/base64.js';
 *   const data = decodeStrictBase64(req.body.content);
 *   if (!data) {
 *     res.status(400).json(error(nodeId, 'INVALID_INPUT', 'content must be base64'));
 *     return;
 *   }
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Initial utility. Added in response to a silent-
 *     corruption bug discovered while seeding the directory-submission
 *     reviewer account: raw HTML POSTed to /v1/apps was accepted as base64
 *     and stored as a 14-byte garbage buffer.
 */

/**
 * Decode `content` as base64 into a Buffer. Returns null if `content` is
 * not a valid base64 string. Whitespace is tolerated (stripped before
 * decoding). Standard and URL-safe base64 are both accepted.
 *
 * Validation rules:
 *  - Non-empty after whitespace stripping
 *  - Only characters from [A-Za-z0-9+/_-]
 *  - Optional trailing padding of 0, 1, or 2 `=` characters
 */
export function decodeStrictBase64(content: string): Buffer | null {
    const clean = content.replace(/\s+/g, '');
    if (clean.length === 0) return null;
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean)) return null;
    return Buffer.from(clean, 'base64');
}
