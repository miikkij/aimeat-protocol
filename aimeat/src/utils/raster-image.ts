/**
 * @file src/utils/raster-image.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether some bytes are a picture a browser can only ever draw: a PNG, JPEG, WebP, GIF or
 *   AVIF image, read from the bytes' own signature rather than from the label somebody put on them.
 *
 *   WHY THE BYTES AND NOT THE LABEL. An app's icon and screenshot are served from the node's own
 *   origin to anybody, and they were served with whatever Content-Type they were stored with. The
 *   label is a claim made by the same caller who supplied the bytes, so `text/html` or
 *   `image/svg+xml` came back as a page on the node's origin (A7-2). The icon door already read the
 *   PNG signature for exactly this reason; this is the same test, in one place, for every door that
 *   stores or serves an app's picture.
 *
 *   WHY THESE FIVE. PNG, JPEG and WebP are what the node itself and its clients produce (the
 *   screenshot capture writes JPEG, the icon door takes PNG, a browser screenshot is PNG or WebP).
 *   GIF and AVIF are here because screenshots were stored with any type until A7-2 and the
 *   catalogue's upload offers every image, so leaving them out refused an ordinary picture. None of
 *   the five can carry script. SVG is a document that can, and stays out.
 * @structure
 *   - RasterImageType — the five types
 *   - rasterImageType(bytes) — which of the five the bytes are, or null
 *   - isRasterImageType(label) — whether a declared type names one of the five
 *   - imageUploadType(bytes, label?) — the type to store an uploaded picture as, or null to refuse it
 * @usage
 *   const type = imageUploadType(data, req.body.screenshot_mime_type);
 *   if (!type) return res.status(400).json(error(nodeId, 'INVALID_INPUT', 'A PNG, JPEG or WebP image'));
 * @version-history
 *   v1.1.0 — 2026-09-24 — GIF and AVIF (the `avif` and `avis` brands of an ISO-BMFF `ftyp` box).
 *   v1.0.0 — 2026-09-24 — Initial (A7-2).
 */

export type RasterImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif';

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
 * Which of the five pictures these bytes are, read from their signature, or null.
 *
 * PNG: the eight-byte signature. JPEG: FF D8 FF, the start-of-image marker and the first marker of
 * the next segment. WebP: a RIFF container whose form type, at byte 8, is `WEBP`, which is what
 * separates it from a WAV or an AVI in the same container. GIF: `GIF87a` or `GIF89a`. AVIF: an
 * ISO-BMFF `ftyp` box at byte 4 whose major brand is `avif` (a still) or `avis` (a sequence), which
 * is what separates it from an MP4 or a HEIC in the same container.
 */
export function rasterImageType(data: Uint8Array | null | undefined): RasterImageType | null {
    if (!data || data.length === 0) return null;
    if (startsWith(data, PNG_SIGNATURE)) return 'image/png';
    if (startsWith(data, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
    if (startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8)) return 'image/webp';
    if (startsWith(data, ascii('GIF87a')) || startsWith(data, ascii('GIF89a'))) return 'image/gif';
    if (startsWith(data, ascii('ftyp'), 4) && (startsWith(data, ascii('avif'), 8) || startsWith(data, ascii('avis'), 8))) return 'image/avif';
    return null;
}

/** The labels of the five, as a caller may spell them. `image/jpg` is how many clients say JPEG. */
const RASTER_LABELS = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/avif']);

/**
 * Does a declared type name one of the five? Case and parameters are ignored, and `image/jpg`, the
 * spelling many clients use for a JPEG, counts as one. Anything that is not a string is no.
 */
export function isRasterImageType(mimeType: unknown): boolean {
    if (typeof mimeType !== 'string') return false;
    return RASTER_LABELS.has(mimeType.split(';')[0].trim().toLowerCase());
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
