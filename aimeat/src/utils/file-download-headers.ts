/**
 * @file src/utils/file-download-headers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The response headers a STORED file is served with, in one place: the content type,
 *   whether a browser may render it, and what it is allowed to do if it does.
 *
 *   THE HOLE THIS CLOSES (August 2026 audit, H-26). A stored file's `Content-Type` comes from
 *   whoever uploaded it, and `GET /v1/pub/:gaii/{*key}` serves a public file to anyone, from the
 *   apex origin, with no auth. Upload `text/html`, mark it public, and the node hands your page to
 *   any visitor on the same origin as the portal, its cookies and its session storage. `image/svg+xml`
 *   is the same hole with a friendlier name: an SVG is a document that may carry `<script>`.
 *
 *   THE ANSWER, IN THREE HEADERS.
 *   - `Content-Disposition: attachment` for anything outside the inline allowlist below, so the
 *     browser saves the file instead of making a document out of it. This is the header that
 *     actually stops it; the other two are what happens when something ignores this one.
 *   - `X-Content-Type-Options: nosniff`, so a file declared `text/plain` is never re-read as HTML
 *     because its first bytes look like markup. The node already sets this on every response from
 *     server-bootstrap/static-files.ts; it is repeated here so the guarantee belongs to the download
 *     path rather than to the order two middlewares happen to be mounted in.
 *   - A `Content-Security-Policy` that overrides the node-wide one for this response. The node-wide
 *     policy allows `script-src 'self'`, and an uploaded file IS 'self': a stored HTML page could
 *     load a stored .js file from the same origin and be a fully scripted page. These two policies
 *     allow neither.
 *
 *   WHY THE ALLOWLIST IS SHAPED THE WAY IT IS. Content-Disposition only affects a top-level
 *   navigation; `<img>`, `<video>`, a scripted request and every non-browser client ignore it. So
 *   the cost of
 *   marking a type as an attachment is paid by exactly one surface, "open this file in a new tab",
 *   and the types on the list are the ones a person expects to see when they do that. Everything on
 *   the list is also inert: a browser builds an image, media or text document out of it, and none of
 *   those can run script or read the origin's storage. HTML, SVG and XML can, and unknown types
 *   (`application/octet-stream`, the default when an upload declares no type) could be anything.
 * @structure
 *   - isInlineSafeFileType() -- the allowlist, as a predicate
 *   - setStoredFileHeaders() -- sets Content-Type, nosniff, Content-Disposition and the CSP
 * @usage
 *   import { setStoredFileHeaders } from '../utils/file-download-headers.js';
 *   setStoredFileHeaders(res, file);       // then Content-Length / Content-Range / Cache-Control
 *   res.end(file.data);
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- August 2026 audit H-26: extracted from routes/storage-files.ts, which
 *     had seven download responses each setting the uploader's Content-Type and nothing else.
 */
import type { Response } from 'express';
import { sniffedContentType, verifiedContentType } from './app-content-type.js';

/**
 * Everything a stored file may be rendered as when someone navigates to it. Read the reasoning in
 * the file header before adding to it: a type belongs here only when a browser CANNOT run script
 * from it, whatever the bytes say.
 *
 * SVG is checked first and on purpose. It is an image by name and a scriptable document in fact,
 * and `startsWith('image/')` would otherwise wave it through.
 */
export function isInlineSafeFileType(mimeType: string | undefined | null): boolean {
    const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
    if (type.startsWith('image/svg')) return false;
    if (type.startsWith('image/')) return true;
    // A media document is as inert as an image document, and this is the difference between a public
    // .mp4 playing in a tab and a public .mp4 landing in the downloads folder.
    if (type.startsWith('audio/') || type.startsWith('video/')) return true;
    // A PDF's own scripting runs in the viewer, with no access to the page's origin, cookies or
    // storage. It is the one entry here that is not literally inert, and it is on the list because
    // the viewer is the boundary.
    if (type === 'application/pdf') return true;
    // text/plain only. text/html is the attack, and the rest of text/* (xml, xsl, and whatever a
    // browser decides to handle next) is not worth guessing about.
    if (type === 'text/plain') return true;
    return false;
}

/**
 * For a file that will never be rendered. `sandbox` with no tokens gives the document an opaque
 * origin and no script, no forms and no top-level navigation, so a browser that ignores the
 * attachment disposition still gets a page that can reach nothing. It costs nothing here: an
 * attachment produces no document, and a download is not subject to the response's own CSP.
 */
const CSP_ATTACHMENT = "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/**
 * For a file that IS meant to be shown. Same "reach nothing" policy, minus `sandbox`, plus the
 * three sources a browser-generated document needs to display the very bytes it navigated to:
 * `img-src` for an image document, `media-src` for audio and video, `object-src` for the PDF viewer,
 * which embeds the document it is showing. A bare `default-src 'none'` has broken image and PDF
 * documents in shipped browsers, and a blank tab where a picture used to be is not a security win.
 *
 * `frame-ancestors 'self'` states what the node already enforces with `X-Frame-Options: SAMEORIGIN`
 * on every response, so nothing that frames a file today stops working.
 */
const CSP_INLINE = "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/**
 * `Content-Disposition` value with a filename a person recognises.
 *
 * Two forms, because one of them cannot carry a Finnish filename and the other is not understood
 * everywhere: `filename=` is the ASCII fallback, `filename*=` is the RFC 5987 UTF-8 form that every
 * current browser prefers. The ASCII form is sanitised rather than dropped, because a header value
 * with a non-ASCII byte in it makes Node throw ERR_INVALID_CHAR and turns a download into a 500.
 * The percent-encoding escapes `'()*` on top of encodeURIComponent: they are legal in a URI
 * component and illegal in an RFC 5987 ext-value.
 */
function dispositionValue(disposition: 'inline' | 'attachment', filename: string): string {
    if (!filename) return disposition;
    const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    const utf8 = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * Set every header that describes WHAT a stored file is and what a browser may do with it. Call it
 * on each response that carries file bytes, including HEAD and byte-range replies, so a client
 * cannot learn one answer from a HEAD and get a different one from the GET.
 *
 * The caller still sets `Content-Length` (or `Content-Range`), caching and any CORS headers: those
 * depend on which door the file came through, and these four do not.
 *
 * Pass `utf8Verified` when the record carries it — a metadata read has it and a range reply cannot
 * sniff. Otherwise pass the WHOLE file as `data`, even when replying with a range: the content type
 * is sniffed from it, and a multi-byte character straddling a range boundary would fail a decode of
 * the slice while the file itself is good UTF-8.
 */
export function setStoredFileHeaders(
    res: Response,
    file: { key: string; mimeType: string; data?: Buffer | Uint8Array | null; utf8Verified?: boolean },
): void {
    const inline = isInlineSafeFileType(file.mimeType);
    // A stored verdict WINS over the bytes in hand, and that ordering is the point: a range response
    // holds a slice, and sniffing a slice can disagree with the full GET when a multi-byte character
    // straddles the boundary. The verdict is a property of the file, so both responses name the same
    // type. Only a file written before the verdict existed falls through to reading the bytes.
    //
    // An EMPTY `data` is treated as "no bytes were supplied" rather than as an empty file, and that
    // is not pedantry: a metadata-only record carries a zero-length buffer, zero bytes decode as
    // valid UTF-8, and the sniffer would cheerfully stamp `charset=utf-8` on a file it has never
    // seen. A genuinely empty file loses nothing by not being told which encoding its no bytes are in.
    const supplied = file.data && file.data.length > 0 ? file.data : null;
    res.setHeader('Content-Type', file.utf8Verified === undefined
        ? sniffedContentType(file.mimeType, supplied)
        : verifiedContentType(file.mimeType, file.utf8Verified));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', inline ? CSP_INLINE : CSP_ATTACHMENT);
    // The key is an address, so its last segment is the closest thing to a filename we have; a key
    // with no segments at all still gets a bare disposition rather than a broken header.
    const filename = String(file.key ?? '').split('/').filter(Boolean).pop() ?? '';
    res.setHeader('Content-Disposition', dispositionValue(inline ? 'inline' : 'attachment', filename));
}
