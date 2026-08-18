/**
 * @file ImageDeliverable.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ONE shared image detector + renderer for agent deliverables, used across every surface
 *   where an agent-produced value may be an image (task results, the memory viewer, the offers / Ask
 *   inbox deliverable preview, and workflow run/step results). A value counts as an image when it is a
 *   `/v1/pub/<gaii>/<key>.{jpg,jpeg,png,webp,gif}` URL, a `data:image/*` URI, or an object with
 *   `{ url, mime: "image/*" }`. The public `/v1/pub` route is anon-readable so its images render via a
 *   plain `<img src>`; owner-only AIMEAT routes (`/v1/memory`, `/v1/storage`, `/v1/deliverables`) are
 *   fetched with the session JWT and shown as a blob URL. Thumbnails are lazy-loaded, click-to-open, and
 *   size-capped; a load/fetch failure renders an explicit failure chip — never an empty box.
 * @structure
 *   - isImageUrl(s) -> boolean (string is an image URL / data URI)
 *   - detectImage(value, altFallback) -> { url, mime?, alt } | null   (whole-value detector)
 *   - findImageUrls(text) -> string[]                                  (bare image URLs inside text)
 *   - collectImages(value, altFallback) -> descriptor[]               (deep scan of objects/arrays)
 *   - ImageView ({ desc })        -> one thumbnail (anon or authed), failure-safe
 *   - ImageStrip ({ images })     -> a row of thumbnails
 *   - DeliverableBody ({ value, alt }) -> image | markdown(+embedded images) | JSON
 * @usage
 *   import { detectImage, ImageView, DeliverableBody } from '/components/ImageDeliverable.js';
 *   const desc = detectImage(value, 'prompt'); desc && html`<${ImageView} desc=${desc} />`;
 * @version-history
 *   v1.0.0 -- 2026-06-13 -- Initial: shared image deliverable detector + renderer across the four
 *     agent surfaces (task result, memory, offers/inbox, workflow run). Pairs with the new
 *     deliverable.format:"image" offer field. See AIMEAT Development note doc-jjif4rs.
 *   v1.1.0 -- 2026-06-16 -- DeliverableBody renders STRUCTURED values (a JSON object/array, or
 *     deliverable.format:"json") as a key/value tree via the shared JsonNode, instead of raw JSON in
 *     a <pre>. Plain-string / image paths unchanged. Pairs with deliverable.format:"json".
 *   v1.1.1 -- 2026-06-19 -- JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { authHeaders } from '/js/services/auth.js';
import { Markdown } from '/components/Markdown.js';
import { JsonNode } from '/components/JsonView.js';

const html = htm.bind(h);

/** A value is "structured" (render as a key/value tree, not raw text) when it is a non-null object/
 *  array, or a string that parses as a JSON object/array. `format:"json"` forces the structured path
 *  for anything parseable. Returns the parsed value to render, or undefined when it's plain text. */
function asStructured(value, format) {
  if (value !== null && typeof value === 'object') return value;
  if (typeof value === 'string') {
    const s = value.trim();
    const looksJson = s[0] === '{' || s[0] === '[';
    if (s && (looksJson || format === 'json')) {
      try { const p = JSON.parse(s); if (p !== null && typeof p === 'object') return p; }
      // eslint-disable-next-line aimeat/no-silent-catch -- not JSON after all — fall through to text
      catch { /* not JSON after all — fall through to text */ }
    }
  }
  return undefined;
}

// A path ending in one of these (after stripping any ?query / #hash) is treated as an image.
const IMG_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;
// Tokens that look like URLs inside free text: absolute http(s) or a root-relative /v1/ path.
const URL_TOKEN_RE = /(?:https?:\/\/[^\s)<>"'`\]]+|\/v1\/[^\s)<>"'`\]]+)/gi;

/** True when `s` is an image URL string: a data:image/* URI, or an http(s)/root-relative URL
 *  whose path ends in a known image extension (covers the /v1/pub/<gaii>/<key>.jpg shape). */
export function isImageUrl(s) {
  if (typeof s !== 'string') return false;
  const u = s.trim();
  if (!u) return false;
  if (/^data:image\//i.test(u)) return true;
  if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) return false;
  const path = u.split(/[?#]/)[0];
  return IMG_EXT_RE.test(path);
}

/** Whole-value image detector. Returns a render descriptor `{ url, mime?, alt }` or null.
 *  - object: `{ url, mime:"image/*" }` (mime authoritative) OR `{ url }` with an image-looking url;
 *    `prompt` / `alt` / `title` become the alt text.
 *  - string: an image URL / data URI. */
export function detectImage(value, altFallback) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const url = typeof value.url === 'string' ? value.url.trim() : null;
    const mime = typeof value.mime === 'string' ? value.mime : null;
    if (url && ((mime && /^image\//i.test(mime)) || isImageUrl(url))) {
      return { url, mime: mime || undefined, alt: value.prompt || value.alt || value.title || altFallback || '' };
    }
    return null;
  }
  if (typeof value === 'string' && isImageUrl(value)) {
    return { url: value.trim(), alt: altFallback || '' };
  }
  return null;
}

/** Find bare image URLs embedded in a text blob (e.g. an agent's "Image generated: <url>" output).
 *  Skips URLs that are the target of a markdown image `![alt](url)` — the Markdown renderer draws
 *  those itself, so we don't want a duplicate thumbnail. */
export function findImageUrls(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(URL_TOKEN_RE)) {
    const u = m[0].replace(/[.,;:!?]+$/, ''); // strip trailing sentence punctuation
    const before = text.slice(Math.max(0, m.index - 2), m.index);
    if (before === '](') continue; // already a markdown image/link target
    if (isImageUrl(u) && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

/** Deep-scan an arbitrary value (object/array/string) for every image it contains, deduped by url.
 *  Used by the workflow run view, where the image may sit inside an observed/writes structure. */
export function collectImages(value, altFallback) {
  const out = [];
  const seen = new Set();
  const push = (d) => { if (d && d.url && !seen.has(d.url)) { seen.add(d.url); out.push(d); } };
  const walk = (v, depth) => {
    if (v == null || depth > 5) return;
    const direct = detectImage(v, altFallback);
    if (direct) { push(direct); return; }
    if (typeof v === 'string') { for (const u of findImageUrls(v)) push({ url: u, alt: altFallback || '' }); return; }
    if (Array.isArray(v)) { for (const it of v) walk(it, depth + 1); return; }
    if (typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], depth + 1); }
  };
  walk(value, 0);
  return out;
}

// Owner-only AIMEAT routes a browser <img> can't read without the session JWT. The public /v1/pub
// route (and external/data URLs) load directly; these are fetched as an auth'd blob.
function needsAuth(url) {
  if (/^data:/i.test(url)) return false;
  let path = url;
  try { path = new URL(url, window.location.origin).pathname; } catch { /* keep relative */ }   // eslint-disable-line aimeat/no-silent-catch -- keep relative
  if (path.includes('/v1/pub/')) return false;            // public, anon-readable
  return /\/v1\/(memory|storage|deliverables)\b/.test(path);
}

/** One image thumbnail: lazy-loaded, click-to-open in a new tab, size-capped, failure-safe.
 *  Anon-readable sources (`/v1/pub`, external, data:) render directly; owner-only AIMEAT keys are
 *  fetched with the session JWT and shown as a blob URL. Any failure renders a failure chip. */
export function ImageView({ desc }) {
  const url = desc?.url;
  const alt = desc?.alt || '';
  const authed = url ? needsAuth(url) : false;
  const [src, setSrc] = useState(authed ? null : url);
  const [failed, setFailed] = useState(false);
  const objUrlRef = useRef(null);

  useEffect(() => {
    if (!url) { setFailed(true); return undefined; }
    if (!authed) { setSrc(url); setFailed(false); return undefined; }
    let cancelled = false;
    setSrc(null); setFailed(false);
    const headers = /** @type {Record<string,string>} */ ({ ...authHeaders() });
    fetch(url, { headers })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then(blob => {
        if (cancelled) return;
        const o = URL.createObjectURL(blob);
        objUrlRef.current = o;
        setSrc(o);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    };
  }, [url, authed]);

  if (failed) return html`<div class="imgd imgd--fail" title=${alt}>⚠ ${t('imageDeliverable.failed')}</div>`;
  if (!src) return html`<div class="imgd imgd--loading">${t('imageDeliverable.loading')}</div>`;
  // For authed images the href opens the same blob; for anon, the original URL.
  const href = authed ? src : url;
  return html`
    <a class="imgd" href=${href} target="_blank" rel="noopener noreferrer" title=${alt || t('imageDeliverable.open')}>
      <img class="imgd-thumb" src=${src} alt=${alt} loading="lazy" onError=${() => setFailed(true)} />
    </a>`;
}

/** A row of image thumbnails from an array of descriptors (or plain URL strings). */
export function ImageStrip({ images, alt }) {
  const descs = (images || []).map(im => (typeof im === 'string' ? { url: im, alt: alt || '' } : im)).filter(d => d && d.url);
  if (!descs.length) return null;
  return html`<div class="imgd-strip">${descs.map(d => html`<${ImageView} key=${d.url} desc=${d} />`)}</div>`;
}

/** Convenience body for a deliverable value, in priority order:
 *  1. the whole value is an image → inline thumbnail (failure-safe);
 *  2. it is structured (a JSON object/array, or `format:"json"`) → a clean key/value tree (JsonNode),
 *     far easier to scan than raw JSON — used for both an offer's `sample` and live deliverables;
 *  3. otherwise → markdown (with any embedded image URLs surfaced as thumbnails).
 *  `format` (the offer's deliverable.format) forces the structured path for a parseable string. */
export function DeliverableBody({ value, alt, format }) {
  const desc = detectImage(value, alt);
  if (desc) return html`<${ImageView} desc=${desc} />`;
  const structured = asStructured(value, format);
  if (structured !== undefined) {
    return html`<div class="imgd-json-tree"><${JsonNode} value=${structured} /></div>`;
  }
  const text = typeof value === 'string' ? value : String(value ?? '');
  const urls = findImageUrls(text);
  return html`
    <div class="imgd-textblock">
      <${Markdown} text=${text} />
      ${urls.length ? html`<${ImageStrip} images=${urls} alt=${alt} />` : null}
    </div>`;
}

export default ImageView;
