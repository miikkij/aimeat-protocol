/**
 * @file src/routes/storage-files-request.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The request readers and inline limits of the binary file storage routes
 *   (routes/storage-files.ts): the storage key from an Express 5 wildcard, the save-as name a handle
 *   request names, and which files the inline download mode may return as text. Moved out of
 *   storage-files.ts by pure extraction when that file reached the 800-line ceiling.
 * @structure INLINE_MAX_BYTES · isInlineableMime() · extractKey() · requestedFilename()
 * @usage
 *   import { INLINE_MAX_BYTES, isInlineableMime, extractKey, requestedFilename } from './storage-files-request.js';
 * @version-history
 *   v1.0.0 — 2026-10-20 — Extracted from routes/storage-files.ts (max-file-lines), unchanged.
 */
import type { Request } from 'express';
import { safeDownloadName } from '../utils/file-download-headers.js';

/** F11: max bytes returned inline (base64) from handle/inline download mode — keeps big binaries out of the model context. */
export const INLINE_MAX_BYTES = 32 * 1024;
/** F11: mime types small enough / textual enough to be safe to inline. */
export function isInlineableMime(mime: string): boolean {
    return mime.startsWith('text/') || /(json|xml|csv|javascript|yaml|markdown|x-www-form-urlencoded)/i.test(mime);
}

/**
 * Extract storage key from Express 5 wildcard {*key} param.
 * path-to-regexp v8 returns an array of path segments and auto-decodes %xx.
 * Handles both encoded slashes (%2F → single element) and raw slashes (multiple elements).
 */
export function extractKey(params: Record<string, string | string[]>): string {
    const k = params.key;
    return Array.isArray(k) ? k.join('/') : k;
}

/**
 * `?filename=` on a handle request: the name the file should be SAVED as, from whoever knows it.
 *
 * A key is an address, and for a direct-message attachment its last segment is an id — so a person
 * pressing download got a file called `23ea6d2c`. The inbox knows the name the sender gave it, and
 * this is how it says so. Reduced to something that can only be a filename before it goes anywhere
 * near a header, and the caller only ever names their own download.
 */
export function requestedFilename(req: Request): string | undefined {
    const raw = Array.isArray(req.query.filename) ? req.query.filename[0] : req.query.filename;
    return safeDownloadName(typeof raw === 'string' ? raw : undefined) || undefined;
}
