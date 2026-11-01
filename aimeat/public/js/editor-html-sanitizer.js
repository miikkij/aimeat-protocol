/**
 * @file public/js/editor-html-sanitizer.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The HTML sanitizer the Toast UI editor uses (its `customHTMLSanitizer` option) for
 *   the Markdown preview and the HTML it converts. A workspace document can hold raw HTML written by
 *   another member or that member's agent, and the editor's Markdown preview writes the sanitized
 *   string into the live page on the apex origin, where the session is kept. The bundled Toast UI
 *   3.2.2 carries DOMPurify 2.3.3, older than the published mutation-XSS fixes, so the editor does
 *   not use it.
 *
 *   How it works: DOMPurify 3.4.17, vendored at /lib/dompurify@3.4.17/, in an instance of its own,
 *   so its hooks reach no other caller of the page's DOMPurify. The allow lists are the ones the
 *   round-10 hand-written sanitizer used: plain HTML elements and attributes, Toast UI's data-*
 *   attributes and aria-*. Foreign content (svg, math), script, style, the raw-text elements and the
 *   embedding elements are dropped with their content. Links keep http(s), mailto, tel and relative
 *   targets, on <a> only; images keep http(s), relative, blob: and data:image addresses, on <img>
 *   only (the editor shows stored and pasted images that way). target is kept only as _blank on a
 *   link, which then gets rel="noopener noreferrer". When DOMPurify did not load, the input is shown
 *   as text.
 * @structure sanitizeEditorHtml(html) -> string
 * @usage new Editor({ ..., customHTMLSanitizer: sanitizeEditorHtml })
 * @version-history
 *   2026-11-01 — DOMPurify 3.4.17 with the same allow lists replaces the hand-written walker
 *     (secaudit2026oct31w2 round 10b; the comparison is test/unit/editor-sanitizer-compare.test.ts).
 *   2026-10-31 — Initial (secaudit2026oct31w2 round 10, toastui:dompurify-2.3.3-member-markdown-wysiwyg).
 */
// The UMD build sets globalThis.DOMPurify when it runs as a module.
import '/lib/dompurify@3.4.17/purify.min.js';

const KEEP = [
  'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1',
  'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
  'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
];
/** Removed with everything inside them: script and style, foreign content, raw-text and form parts. */
const DROP = [
  'script', 'style', 'template', 'svg', 'math', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext', 'textarea', 'title', 'select',
  'option', 'optgroup', 'head', 'meta', 'link', 'base', 'audio', 'video', 'source', 'track', 'picture',
  'canvas', 'portal', 'slot', 'dialog',
];
const ATTRS = [
  'class', 'title', 'lang', 'dir', 'align', 'valign', 'colspan', 'rowspan', 'span', 'start',
  'reversed', 'alt', 'width', 'height', 'open', 'datetime', 'hreflang', 'rel', 'target', 'type',
  'href', 'src',
];
const CONFIG = {
  ALLOWED_TAGS: KEEP,
  ALLOWED_ATTR: ATTRS,
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
  ADD_FORBID_CONTENTS: DROP,
  // http(s), mailto and tel, or an address with no scheme (relative, #fragment, ?query).
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

function makePurifier() {
  const factory = globalThis.DOMPurify;
  if (typeof factory !== 'function' || factory.version !== '3.4.17') return null;
  const purify = factory(window);
  purify.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.localName;
    if (data.attrName === 'href' && tag !== 'a') data.keepAttr = false;
    if (data.attrName === 'src') {
      if (tag !== 'img') data.keepAttr = false;
      else if (/^blob:/i.test(data.attrValue)) data.forceKeepAttr = true;
      else if (/^data:/i.test(data.attrValue) && !/^data:image\//i.test(data.attrValue)) data.keepAttr = false;
    }
    if (data.attrName === 'target' && (tag !== 'a' || data.attrValue !== '_blank')) data.keepAttr = false;
  });
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.localName === 'a' && node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
  });
  return purify;
}

const purifier = makePurifier();

function asText(html) {
  return String(html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The HTML with only plain, inert markup left; without DOMPurify the input is returned as text. */
export function sanitizeEditorHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  if (!purifier) return asText(html);
  return purifier.sanitize(html, CONFIG);
}
