/**
 * @file src/utils/html-tag-scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The attribute text of every `<script ...>` or `<link ...>` tag in an HTML document,
 *   read in one linear pass. The publish-time asset scan (services/app-artifact-lint.ts) runs on the
 *   node's event loop before the write, on HTML an uploader chose. The patterns it used ran `[^>]*`
 *   from each opener, and an opener with no `>` after it cost a scan to the end of the text, so k such
 *   openers cost k times the size of the upload (secaudit2026oct26,
 *   collectAssetRefs:unclosed-tag-quadratic-scan). Moved out of app-artifact-lint.ts at its line limit.
 *
 *   metaTags and titleText read a fetched page's `<meta>` tags and its `<title>` for the link preview
 *   (routes/unfurl.ts) and the welcome-mat reader (services/welcome-mat-parse.ts). Their patterns ran
 *   `[^>]+` or `[^>]*?` from each `<meta`, so a page of many openers cost the square of its size per
 *   pattern (secaudit2026oct31w2 round 10, f-2026aug-dos-ratelimit-1).
 * @structure tagAttributes(html, name) · metaTags(html) · tagSpans(html, name) · metaContentOf(tags, attrs, key) · titleText(html)
 * @usage for (const attrs of tagAttributes(html, 'link')) { ... }
 *   const title = metaContentOf(metaTags(head), ['property', 'name'], 'og:title');
 * @version-history
 *   2026-11-12 — tagSpans: a `<meta>` or `<link>` tag with its place in the text, for the head stamp of
 *     an operator template (utils/page-head.ts), which rewrites a tag where it stands.
 *   2026-10-31 — metaTags, metaContentOf and titleText: one linear pass over a page's `<meta>` tags and
 *     its `<title>` (secaudit2026oct31w2 round 10, f-2026aug-dos-ratelimit-1).
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */

/**
 * The attribute text of every `<name ...>` tag, in order: from the opener to the next `>`. Found with
 * one opener pattern and indexOf, so the whole HTML is read once. A scan resumes after the `>` it
 * found, as the global patterns it replaces did. When no `>` follows an opener, none follows a later
 * one either, so the scan stops there.
 */
export function tagAttributes(html: string, name: 'script' | 'link'): string[] {
  const out: string[] = [];
  const opener = name === 'script' ? /<script\b/gi : /<link\b/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(html)) !== null) {
    const start = m.index + m[0].length;
    const end = html.indexOf('>', start);
    if (end < 0) break;
    out.push(html.slice(start, end));
    opener.lastIndex = end + 1;
  }
  return out;
}

/** The quoted attributes of one `<meta>` tag: lower-case names, values as written. */
export type MetaAttributes = Record<string, string>;

const isSpace = (c: string): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';

/**
 * Read one tag's attributes from `i` (just after the tag name) to its closing `>`. A quoted value may
 * hold a `>`. Only quoted values are recorded, as the patterns this replaces read only those; the
 * first of two same-named attributes wins, as in a browser. Every character is read once.
 */
function readTagAttributes(html: string, i: number): { attrs: MetaAttributes; end: number } {
  const attrs: MetaAttributes = Object.create(null) as MetaAttributes;
  const n = html.length;
  while (i < n) {
    const c = html[i];
    if (c === '>') return { attrs, end: i };
    if (isSpace(c) || c === '/') { i++; continue; }
    const nameStart = i;
    while (i < n && !isSpace(html[i]) && html[i] !== '=' && html[i] !== '>' && html[i] !== '/') i++;
    const name = html.slice(nameStart, i).toLowerCase();
    let j = i;
    while (j < n && isSpace(html[j])) j++;
    // A name with no value: the next round reads from the character after it (a space, `/` or `>`).
    // An empty name is only possible at `=`, which goes on to the value below.
    if (html[j] !== '=') { i = j; continue; }
    j++;
    while (j < n && isSpace(html[j])) j++;
    const quote = html[j];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, j + 1);
      if (close < 0) return { attrs, end: n };
      if (name && !(name in attrs)) attrs[name] = html.slice(j + 1, close);
      i = close + 1;
    } else {
      while (j < n && !isSpace(html[j]) && html[j] !== '>') j++;
      i = j;
    }
  }
  return { attrs, end: n };
}

/**
 * Every `<meta ...>` tag's quoted attributes, in document order, in one linear pass: a scan resumes
 * after the tag it read, so no character is read twice however many openers the page holds.
 */
export function metaTags(html: string): MetaAttributes[] {
  return tagSpans(html, 'meta').map(span => span.attrs);
}

/** One tag as read: its quoted attributes, where it starts and the index after its closing `>`. */
export interface TagSpan { attrs: MetaAttributes; start: number; end: number }

/**
 * Every `<meta ...>` or `<link ...>` tag with its place in the text, in document order, in the same
 * linear pass as metaTags. A caller that rewrites a tag slices the text at `start` and `end`.
 */
export function tagSpans(html: string, name: 'meta' | 'link'): TagSpan[] {
  const out: TagSpan[] = [];
  const opener = name === 'meta' ? /<meta\b/gi : /<link\b/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(html)) !== null) {
    const { attrs, end } = readTagAttributes(html, m.index + m[0].length);
    out.push({ attrs, start: m.index, end: Math.min(end + 1, html.length) });
    if (end >= html.length) break;
    opener.lastIndex = end + 1;
  }
  return out;
}

/**
 * The `content` of the first tag whose attribute in `keyAttrs` equals `key` (case-insensitive) and
 * whose `content` holds more than white space, untrimmed; null when there is none.
 */
export function metaContentOf(tags: MetaAttributes[], keyAttrs: readonly string[], key: string): string | null {
  const want = key.toLowerCase();
  for (const t of tags) {
    if (!t.content || !t.content.trim()) continue;
    if (keyAttrs.some(a => a in t && t[a].toLowerCase() === want)) return t.content;
  }
  return null;
}

/** The text between the first `<title ...>` and the `</title>` after it, or null. Linear. */
export function titleText(html: string): string | null {
  const open = /<title/i.exec(html);
  if (!open) return null;
  const gt = html.indexOf('>', open.index + open[0].length);
  if (gt < 0) return null;
  const close = /<\/title>/gi;
  close.lastIndex = gt + 1;
  const end = close.exec(html);
  return end ? html.slice(gt + 1, end.index) : null;
}
