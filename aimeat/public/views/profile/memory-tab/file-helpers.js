/**
 * @file public/views/profile/memory-tab/file-helpers.js
 * @description Pure file helpers for the Memory tab — mime/extension categorization, category
 *   icons, authenticated blob fetch, and owner_gaii-aware byte-URL builders. Extracted from
 *   memory-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from public/views/profile/memory-tab.js (max-file-lines)
 */

export function fileIcon(type) {
  if (type?.startsWith('image')) return '\u{1F5BC}️';
  if (type?.includes('pdf')) return '\u{1F4C4}';
  return '\u{1F4CE}';
}

// Extensions treated as text when the upload's mime is a generic octet-stream.
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yml', 'yaml',
  'js', 'mjs', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'py', 'sh', 'ini', 'conf', 'toml', 'sql']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv', 'mov', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac']);

// Which preview element a file gets. Prefers the mime type; falls back to the key's
// extension for generic octet-stream uploads. 'other' → no inline preview (download only).
export function fileCategory(mime, key) {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml'
    || m === 'application/javascript' || m.endsWith('+json') || m.endsWith('+xml')) return 'text';
  const ext = (key || '').split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'other';
}

export function categoryIcon(cat) {
  switch (cat) {
    case 'image': return '\u{1F5BC}️';
    case 'pdf': return '\u{1F4C4}';
    case 'video': return '\u{1F3AC}';
    case 'audio': return '\u{1F3B5}';
    case 'text': return '\u{1F4DD}';
    default: return '\u{1F4CE}';
  }
}

// Authenticated blob fetch — browser <img>/<video>/<a> can't attach the JWT, so private files
// are fetched with the session token and shown from an object URL (the AuthImage pattern).
export async function fetchFileBlob(url) {
  const headers = /** @type {Record<string,string>} */ ({});
  if (window.AIMEAT?.auth?.hasSession) {
    const s = window.AIMEAT.auth.getSession();
    if (s?.jwt) headers['Authorization'] = 'Bearer ' + s.jwt;
  }
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(String(resp.status));
  return resp.blob();
}

// Per-segment encode — keeps slashes literal for the /v1/pub wildcard route (keys like images/x.png).
export const encKeyPath = (k) => String(k || '').split('/').map(encodeURIComponent).join('/');

// Best single URL to fetch a file's bytes. The Files list AGGREGATES the owner's own GHII files AND
// every agent's files, but the auth route GET /v1/memory/files/:key is scoped to the CALLER's
// resolved gaii — so an agent-owned file 404s there. Public files therefore go through the
// owner_gaii-aware /v1/pub route (serves any owner's public bytes); everything else uses the auth
// route, which serves the caller's own GHII files (incl. private, no consent needed).
export function fileBytesUrl(f, nodeUrl) {
  return (f.visibility === 'public' && f.owner_gaii)
    ? `${nodeUrl}/v1/pub/${encodeURIComponent(f.owner_gaii)}/${encKeyPath(f.key || f.name)}`
    : `${nodeUrl}/v1/memory/files/${encodeURIComponent(f.key || f.name)}`;
}

// Fetch a file's bytes with a fallback: try the primary URL, then the owner_gaii /v1/pub route (with
// the JWT for consented reads). Covers own GHII files, public agent-owned files, and consented ones.
export async function fetchFileBytes(f, nodeUrl) {
  const primary = fileBytesUrl(f, nodeUrl);
  try { return await fetchFileBlob(primary); }
  catch (e) {
    if (f.owner_gaii) {
      const pub = `${nodeUrl}/v1/pub/${encodeURIComponent(f.owner_gaii)}/${encKeyPath(f.key || f.name)}`;
      if (pub !== primary) return fetchFileBlob(pub);
    }
    throw e;
  }
}
