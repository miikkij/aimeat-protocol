/**
 * @file test/fixtures/editor-sanitizer/editor-html-sanitizer-walker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description NOT SERVED. The hand-written sanitizer the editors used from 2026-10-31 to 2026-11-01
 *   (public/js/editor-html-sanitizer.js in round 10). It is kept here only so that
 *   test/unit/editor-sanitizer-compare.test.ts can re-run the comparison that replaced it with
 *   DOMPurify 3.4.17 (secaudit2026oct31w2 round 10b). Nothing in public/ or src/ imports it.
 *
 *   What it was: the HTML sanitizer the Toast UI editor used (its `customHTMLSanitizer` option) for
 *   the Markdown preview and the HTML it converts. A workspace document can hold raw HTML written by
 *   another member or that member's agent, and the editor's Markdown preview writes the sanitized
 *   string into the live page on the apex origin, where the session is kept. The bundled Toast UI
 *   3.2.2 carries DOMPurify 2.3.3, older than the published mutation-XSS fixes, so the editor does
 *   not use it.
 *
 *   How it works: the string is parsed in an inert document (DOMParser: no script runs, no image
 *   loads), every node is checked against an allowlist of plain HTML elements and attributes, and
 *   the cleaned tree is serialized. Foreign content (svg, math) and the raw-text elements are dropped
 *   with their content, because namespace and parser-mode switches are what mutation XSS needs. The
 *   result is cleaned again and must come back unchanged; a string that still changes is shown as
 *   text. Links keep http(s), mailto, tel and relative targets; images keep http(s), relative, blob:
 *   and data:image addresses (the editor shows stored and pasted images that way). Toast UI's own
 *   data-* attributes (data-nodeid and the task list marks) are kept so the preview stays in step
 *   with the Markdown side.
 * @structure sanitizeEditorHtml(html) -> string
 * @usage new Editor({ ..., customHTMLSanitizer: sanitizeEditorHtml })
 * @version-history
 *   2026-11-01 — Moved out of public/ into a test fixture; the editors use DOMPurify 3.4.17
 *     (secaudit2026oct31w2 round 10b).
 *   2026-10-31 — Initial (secaudit2026oct31w2 round 10, toastui:dompurify-2.3.3-member-markdown-wysiwyg).
 */

const KEEP = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1',
  'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
  'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
]);
/** Removed with everything inside them: script and style, foreign content, raw-text and form parts. */
const DROP = new Set([
  'script', 'style', 'template', 'svg', 'math', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext', 'textarea', 'title', 'select',
  'option', 'optgroup', 'head', 'meta', 'link', 'base', 'audio', 'video', 'source', 'track', 'picture',
  'canvas', 'portal', 'slot', 'dialog',
]);
const ATTRS = new Set([
  'class', 'title', 'lang', 'dir', 'align', 'valign', 'colspan', 'rowspan', 'span', 'start',
  'reversed', 'alt', 'width', 'height', 'open', 'datetime', 'hreflang', 'rel', 'target', 'type',
]);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** The URL without the characters a browser skips when it reads a scheme: controls and spaces. */
function withoutIgnored(value) {
  let out = '';
  for (const ch of String(value)) {
    const c = ch.codePointAt(0);
    if (c <= 32 || (c >= 127 && c <= 160) || /\s/.test(ch)) continue;
    out += ch;
  }
  return out;
}

function safeUrl(value, forImage) {
  const v = withoutIgnored(value);
  const m = SCHEME.exec(v);
  if (!m) return true;                                   // relative: /path, ./x, #frag, ?q
  const scheme = m[1].toLowerCase();
  if (scheme === 'http' || scheme === 'https') return true;
  if (forImage) return scheme === 'blob' || /^data:image\//i.test(v);
  return scheme === 'mailto' || scheme === 'tel';
}

function cleanElement(el) {
  const tag = el.localName;
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    let keep = ATTRS.has(name) || /^data-[a-z0-9-]+$/.test(name) || /^aria-[a-z]+$/.test(name);
    if (name === 'href') keep = tag === 'a' && safeUrl(attr.value, false);
    if (name === 'src') keep = tag === 'img' && safeUrl(attr.value, true);
    if (name === 'target') keep = tag === 'a' && attr.value === '_blank';
    if (!keep) el.removeAttribute(attr.name);
  }
  if (tag === 'a' && el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer');
}

function walk(parent) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3) continue;                    // text
    if (node.nodeType !== 1) { node.remove(); continue; } // comments, processing instructions
    const tag = node.localName;
    if (node.namespaceURI !== HTML_NS || DROP.has(tag)) { node.remove(); continue; }
    walk(node);
    if (!KEEP.has(tag)) { node.replaceWith(...Array.from(node.childNodes)); continue; }
    cleanElement(node);
  }
}

function cleanOnce(html) {
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`, 'text/html');
  walk(doc.body);
  return doc.body.innerHTML;
}

function asText(html) {
  return String(html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The HTML with only plain, inert markup left; a string that does not settle is returned as text. */
export function sanitizeEditorHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  let out = cleanOnce(html);
  for (let i = 0; i < 2; i++) {
    const again = cleanOnce(out);
    if (again === out) return out;
    out = again;
  }
  return asText(html);
}
