/**
 * @file src/utils/raw-body.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bytes of a request body that express.raw() read, or null when the body is
 *   anything else (parsed JSON, a form, nothing).
 *
 *   WHY. A route that accepts either a raw file or JSON tested `Buffer.isBuffer(req.body)` and then
 *   handed `req.body` on. CodeQL does not take that test as a type check, so every `.length` and
 *   `.subarray` on the bytes downstream read as a request parameter that may be an array or a
 *   string (js/type-confusion-through-parameter-tampering, alerts 1712-1719 and 1721-1725 in the
 *   docsign services). This returns a new Buffer over the same memory, so nothing is copied, and
 *   what the caller holds is a Buffer by construction rather than by a test it cannot see.
 * @structure rawBodyBytes(body)
 * @usage const bytes = rawBodyBytes(req.body); if (bytes) { ... }
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (code scanning alerts 1712-1719, 1721-1725).
 */

/** The raw body as a Buffer over the same memory, or null when the body is not raw bytes. */
export function rawBodyBytes(body: unknown): Buffer | null {
  if (!(body instanceof Uint8Array)) return null;
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}
