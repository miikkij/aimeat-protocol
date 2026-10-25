/**
 * @file src/utils/html-document-element.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the `<html>` tag of a single-file app is, for the code that marks it, reads it
 *   and takes the mark back out.
 *
 *   WHY NOT THE ONE-LINE PATTERN. `/<html(\s[^>]*)?>/i` over the first 512 characters matched the
 *   first `<html` in the text, wherever it stood. Lifecycle Central opens with a version-history
 *   comment, and a `<html>` written in that comment was taken for the document element: the node
 *   wrote its `ai-disclosure` attribute into the comment (2026-10-25). This scan skips comments and
 *   the content of raw-text elements, so only a real tag is found.
 *
 *   THE WINDOW STAYS. Only a tag that starts in the first 512 characters is found, as before: the
 *   document element comes before any content, and a match further in is more likely a string in the
 *   app's own script than the element itself.
 * @structure
 *   - DOCUMENT_ELEMENT_WINDOW — how far into the text the tag may start
 *   - findDocumentElement(text) — the `<html …>` tag's span and its attribute text, or null
 * @usage
 *   const el = findDocumentElement(text);
 *   if (el) text.slice(el.start, el.end)   // the whole `<html …>` tag
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial. One scan for markDocumentElement, the author-attribute reader and
 *     the publish strip, which each matched a `<html>` inside a comment.
 */

/** The `<html>` tag is looked for only if it starts in this many characters. */
export const DOCUMENT_ELEMENT_WINDOW = 512;

/** Elements whose content is text, not markup: a `<html>` inside one is not a tag. */
const RAW_TEXT = ['script', 'style', 'template', 'noscript', 'title', 'textarea'];

/** The `<html …>` tag: `[start, end)` covers it whole, `attrs` is the text between the name and `>`. */
export interface DocumentElementTag { start: number; end: number; attrs: string }

/**
 * The first `<html>` start tag outside comments and raw-text elements, when it starts inside the
 * window. A comment or a raw-text element that does not close ends the search, because what follows
 * it is not markup to a browser either.
 */
export function findDocumentElement(text: string): DocumentElementTag | null {
  const lower = text.toLowerCase();
  let at = 0;
  while (at < DOCUMENT_ELEMENT_WINDOW) {
    const lt = lower.indexOf('<', at);
    if (lt < 0 || lt >= DOCUMENT_ELEMENT_WINDOW) return null;
    if (lower.startsWith('<!--', lt)) {
      const end = lower.indexOf('-->', lt + 4);
      if (end < 0) return null;
      at = end + 3;
      continue;
    }
    const name = /^<([a-z][a-z0-9]*)/.exec(lower.slice(lt, lt + 12))?.[1];
    const gt = lower.indexOf('>', lt);
    if (gt < 0) return null;
    if (name === 'html') {
      const after = lower[lt + 5];
      if (after === '>' || /\s/.test(after)) {
        return { start: lt, end: gt + 1, attrs: text.slice(lt + 5, gt) };
      }
    }
    if (name && RAW_TEXT.includes(name)) {
      const close = lower.indexOf(`</${name}`, gt + 1);
      if (close < 0) return null;
      at = close + 2;
      continue;
    }
    at = gt + 1;
  }
  return null;
}
