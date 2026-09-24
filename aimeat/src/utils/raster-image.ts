/**
 * @file src/utils/raster-image.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether some bytes are a picture a browser can only ever draw: a PNG, a JPEG or a WebP
 *   image, read from the bytes' own signature rather than from the label somebody put on them.
 *
 *   WHY THE BYTES AND NOT THE LABEL. An app's icon and screenshot are served from the node's own
 *   origin to anybody, and they were served with whatever Content-Type they were stored with. The
 *   label is a claim made by the same caller who supplied the bytes, so `text/html` or
 *   `image/svg+xml` came back as a page on the node's origin (A7-2). The icon door already read the
 *   PNG signature for exactly this reason; this is the same test, in one place, for every door that
 *   stores or serves an app's picture.
 *
 *   WHY THESE THREE. They are what the node itself and its clients produce (the screenshot capture
 *   writes JPEG, the icon door takes PNG, a browser screenshot is PNG or WebP), and none of them can
 *   carry script. SVG is a document that can. GIF, AVIF and the rest stay out until somebody needs
 *   one, and adding one is a line here and a line in its test.
 * @structure
 *   - RasterImageType — the three types
 *   - rasterImageType(bytes) — which of the three the bytes are, or null
 *   - isRasterImageType(label) — whether a declared type names one of the three
 *   - imageUploadType(bytes, label?) — the type to store an uploaded picture as, or null to refuse it
 * @usage
 *   const type = imageUploadType(data, req.body.screenshot_mime_type);
 *   if (!type) return res.status(400).json(error(nodeId, 'INVALID_INPUT', 'A PNG, JPEG or WebP image'));
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (A7-2).
 */

export type RasterImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/** The eight-byte PNG signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/** True when `data` starts with `bytes` at `offset`. */
function startsWith(data: Uint8Array, bytes: number[], offset = 0): boolean {
    if (data.length < offset + bytes.length) return false;
    return bytes.every((b, i) => data[offset + i] === b);
}

/** ASCII as byte values, for the RIFF container's four-letter tags. */
const ascii = (s: string): number[] => [...s].map(c => c.charCodeAt(0));

/**
 * Which of the three pictures these bytes are, read from their signature, or null.
 *
 * PNG: the eight-byte signature. JPEG: FF D8 FF, the start-of-image marker and the first marker of
 * the next segment. WebP: a RIFF container whose form type, at byte 8, is `WEBP`, which is what
 * separates it from a WAV or an AVI in the same container.
 */
export function rasterImageType(data: Uint8Array | null | undefined): RasterImageType | null {
    if (!data || data.length === 0) return null;
    if (startsWith(data, PNG_SIGNATURE)) return 'image/png';
    if (startsWith(data, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
    if (startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8)) return 'image/webp';
    return null;
}

/**
 * Does a declared type name one of the three? Case and parameters are ignored, and `image/jpg`, the
 * spelling many clients use for a JPEG, counts as one. Anything that is not a string is no.
 */
export function isRasterImageType(mimeType: unknown): boolean {
    if (typeof mimeType !== 'string') return false;
    const type = mimeType.split(';')[0].trim().toLowerCase();
    return type === 'image/png' || type === 'image/jpeg' || type === 'image/jpg' || type === 'image/webp';
}

/**
 * The type an uploaded picture is stored as, or null when the upload must be refused.
 *
 * The bytes decide what is stored, so a JPEG labelled `image/png` is stored as the JPEG it is. A label
 * is still checked when one is given: a caller who calls a picture `text/html` is told so rather than
 * having the label quietly replaced, because the next thing they send under that label may not be a
 * picture at all. A label that is not a non-empty string counts as none, as it always has on these
 * doors.
 */
export function imageUploadType(data: Uint8Array | null | undefined, declared?: unknown): RasterImageType | null {
    const labelled = typeof declared === 'string' && declared.trim() !== '';
    if (labelled && !isRasterImageType(declared)) return null;
    return rasterImageType(data);
}
