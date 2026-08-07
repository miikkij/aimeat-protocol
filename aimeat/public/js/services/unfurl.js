/**
 * @file public/js/services/unfurl.js
 * @description Frontend service for link previews (unfurls). `fetchPreview(url)` asks the node for a
 *   pasted link's OpenGraph/Twitter-card metadata; `fetchPreviewImageUrl(imageUrl)` pulls the preview
 *   image THROUGH the node (same-origin, auth'd) into a `blob:` object URL — the SPA's CSP forbids remote
 *   image hosts, so a direct <img src="https://…"> would be blocked. Both back the inbox message cards.
 * @structure fetchPreview / fetchPreviewImageUrl
 * @usage import * as unfurl from '/js/services/unfurl.js';
 * @version-history
 *   v1.0.0 — 2026-07-21 — Initial link-preview service (inbox message link cards).
 */
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { authHeaders } from '/js/services/auth.js';

const enc = encodeURIComponent;

/** Fetch OG/Twitter-card metadata for one URL. Returns { url, resolvedUrl, title, description, image,
 *  siteName } or null if the node couldn't unfurl it (blocked/failed fetch, non-HTML, etc.). */
export async function fetchPreview(url) {
  try {
    const r = await apiGet(`/v1/unfurl?url=${enc(url)}`);
    return r?.data || null;
  } catch (err) {
    swallowed('unfurl', err);
    return null;   // a preview is best-effort — a link that won't unfurl just shows no card
  }
}

/** Fetch a preview image through the node's proxy and return a blob: object URL (CSP-safe, auth'd via
 *  the session JWT — an <img> tag can't send an Authorization header, so we fetch the bytes ourselves).
 *  Returns null on any failure. The CALLER owns the returned URL and must URL.revokeObjectURL it. */
export async function fetchPreviewImageUrl(imageUrl) {
  try {
    const headers = /** @type {Record<string, string>} */ ({ ...authHeaders() });
    const resp = await fetch(`/v1/unfurl/image?url=${enc(imageUrl)}`, { headers });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) return null;
    return URL.createObjectURL(blob);
  } catch (err) { swallowed('unfurl', err); return null; }
}
