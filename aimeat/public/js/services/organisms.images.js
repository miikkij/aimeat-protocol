/**
 * @file public/js/services/organisms.images.js
 * @description Document/image storage helpers for organism workspaces — blob→base64/dataURL, upload
 *   to private storage, session-token fetch, per-image visibility, and the markdown embed rewriter
 *   (public → /v1/pub, otherwise → /v1/storage). Extracted from organisms.js.
 * @usage import { uploadImage, uploadFile, extractStorageImages, applyImageVisibilityUrls } from './organisms.images.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from organisms.js (max-file-lines)
 */
import { apiGet, apiPost, apiPatch } from '/js/api.js';

/** ── Document images (stored in /v1/storage, fetched with the session for display) ── */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Full data: URL (for immediate display in the editor before the storage upload finishes). */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Upload an image blob to the organism's private storage. Returns a /v1/storage/<key> URL to
 *  embed in markdown; the document view resolves it with the session token (storage GET needs auth). */
export async function uploadImage(orgId, blob, mime) {
  const ext = (mime && mime.split('/')[1]) ? '.' + mime.split('/')[1].replace(/[^a-z0-9]/gi, '') : '';
  const key = `organism.${orgId}.img.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${ext}`;
  const resp = await apiPost('/v1/storage', { key, visibility: 'private', data: await blobToBase64(blob), mime_type: mime || 'application/octet-stream' });
  if (resp?.ok === false) throw new Error(resp?.error?.message || 'Upload failed');
  return `/v1/storage/${encodeURIComponent(resp?.data?.key || key)}`;
}

/** Upload any file blob (document or image) to an organism's private storage. Returns
 *  { key, url, mime } where url is a /v1/storage/<key> path (the owner fetches it with the
 *  session token). Generic sibling of uploadImage — used by the Secretary doc/image intake. */
export async function uploadFile(orgId, file) {
  const mime = (file && file.type) || 'application/octet-stream';
  const rawName = (file && file.name) || 'file';
  const safe = rawName.replace(/[^a-z0-9.\-_]/gi, '_').slice(-60);
  const key = `organism.${orgId}.files.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
  const resp = await apiPost('/v1/storage', { key, visibility: 'private', data: await blobToBase64(file), mime_type: mime });
  if (resp?.ok === false) throw new Error(resp?.error?.message || 'Upload failed');
  const finalKey = resp?.data?.key || key;
  return { key: finalKey, url: `/v1/storage/${encodeURIComponent(finalKey)}`, mime };
}

/** Fetch a /v1/storage file with the session token and return an object URL (for <img>). */
export async function fetchStorageObjectUrl(url) {
  const jwt = window.AIMEAT?.auth?.getSession?.()?.jwt;
  const resp = await fetch(url, { headers: jwt ? { Authorization: 'Bearer ' + jwt } : {} });
  if (!resp.ok) throw new Error('image fetch failed: ' + resp.status);
  return URL.createObjectURL(await resp.blob());
}

/** List the caller's storage files → map of key → visibility (for showing per-image visibility). */
export async function listStorageVisibilities() {
  const resp = await apiGet('/v1/storage');
  const out = {};
  for (const f of (resp?.data?.files || [])) out[f.key] = f.visibility;
  return out;
}

/** Change one stored image's visibility ('private' | 'owner' | 'public'). */
export async function setImageVisibility(key, visibility) {
  return apiPatch(`/v1/storage/${encodeURIComponent(key)}/visibility`, { visibility });
}

// Matches an embedded storage image in either URL form, capturing the bare object key in group 3:
//   ![alt](/v1/storage/<key>)            — private, owner fetches with the session token
//   ![alt](/v1/pub/<ownerGhii>/<key>)    — public, anyone loads it via a plain <img>
const STORAGE_IMG_RE = /!\[([^\]]*)\]\(\/v1\/(?:storage|pub\/[^/)]+)\/([^\s)]+)\)/g;

/** Pull the storage object keys (+ alt text) embedded in a markdown document, in order (both forms). */
export function extractStorageImages(markdown) {
  const out = []; const seen = new Set();
  STORAGE_IMG_RE.lastIndex = 0;
  let m;
  while ((m = STORAGE_IMG_RE.exec(String(markdown || ''))) !== null) {
    const key = decodeURIComponent(m[2]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, alt: m[1] || key.split('.').pop() });
  }
  return out;
}

/** Rewrite each embedded image's URL to match its visibility: public → /v1/pub/<ghii>/<key> (loads
 *  for any viewer), otherwise → /v1/storage/<key> (owner-only, session-fetched). `visByKey` maps the
 *  bare object key → 'public' | 'private' | 'owner'; keys not present default to private. */
export function applyImageVisibilityUrls(markdown, visByKey, ghii) {
  return String(markdown || '').replace(STORAGE_IMG_RE, (full, alt, rawKey) => {
    const key = decodeURIComponent(rawKey);
    const url = (visByKey[key] === 'public' && ghii)
      ? `/v1/pub/${encodeURIComponent(ghii)}/${encodeURIComponent(key)}`
      : `/v1/storage/${encodeURIComponent(key)}`;
    return `![${alt}](${url})`;
  });
}
