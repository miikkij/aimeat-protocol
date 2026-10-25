/**
 * @file public/views/profile/memory-tab/inert-blob.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The blob a private file is opened in a new tab as. An object URL belongs to the
 *   page that made it, the node's own origin, where the session lives, and the blob's type is the
 *   stored one, which whoever wrote the file chose (an agent, or an app under the owner's grant).
 *   So only the types a browser cannot run script from keep their own type: the same list the
 *   server's download routes use (src/utils/file-download-headers.ts isInlineSafeFileType). Text
 *   that could be a document (HTML, SVG, XML, script) opens as plain text, so the owner still reads
 *   it in the tab; anything else is an octet-stream, which the browser saves instead of rendering.
 * @structure isInlineSafeType(type) · inertBlob(blob)
 * @usage const u = URL.createObjectURL(inertBlob(await fetchFileBytes(file, nodeUrl)));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, Files view object URL on the node's origin).
 */

/** One `type/subtype`, with optional parameters and no comma; anything else is not a single type. */
const SINGLE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(\s*;.*)?$/i;

/** Whether a browser cannot run script from a document of this type. */
export function isInlineSafeType(type) {
  const raw = String(type || '').trim();
  if (!raw || raw.includes(',') || !SINGLE.test(raw)) return false;
  const t = raw.split(';')[0].trim().toLowerCase();
  if (t.startsWith('image/svg')) return false;
  if (t.startsWith('image/') || t.startsWith('audio/') || t.startsWith('video/')) return true;
  return t === 'application/pdf' || t === 'text/plain';
}

/** Types that are text a person can read, though a browser would run them as a document. */
const READABLE = /^(text\/|image\/svg|application\/(xml|xhtml\+xml|javascript|json|ecmascript)|[^/]+\/[^;]*\+xml)/i;

/** The blob as it may be opened in a tab of the node's own origin. */
export function inertBlob(blob) {
  const type = (blob && blob.type) || '';
  if (isInlineSafeType(type)) return blob;
  return new Blob([blob], { type: READABLE.test(type.trim()) ? 'text/plain;charset=utf-8' : 'application/octet-stream' });
}
