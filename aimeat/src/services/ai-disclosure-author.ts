/**
 * @file src/services/ai-disclosure-author.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app document says about its own AI involvement, read before the node adds its
 *   marks, so the node does not speak over the author.
 *
 *   WHY THE NODE STANDS BACK. Under the W3C AI Content Disclosure report (Final Community Group
 *   Report, 2026-10-09) the page default is the FIRST `<meta name="ai-disclosure">` in the head and
 *   every later one is ignored, while an `ai-disclosure` attribute on an element, `<html>` included,
 *   applies to that element and everything inside it. So a second meta from the node is noise at
 *   best, and a valid value on `<html>` would override the author's meta for the whole document.
 *   When the author declared, the node serves the author's words and adds neither. The record link
 *   and the JSON-LD still go in: they carry the record and do not compete with the declaration.
 *
 *   A DISAGREEMENT IS TRACED, NOT FIXED. When the author's value differs from what the record says,
 *   one log line per app and value records it, so it can be looked at later. The page is still
 *   served with the author's value; the record stays reachable through the link.
 * @structure
 *   - authorDisclosure(html) — the author's own meta value and `<html>` attribute value, or null each
 *   - traceAuthorDisclosure(recordUrl, nodeValue, own) — the log line for a disagreement
 * @usage
 *   const own = authorDisclosure(text);
 *   if (own.meta !== null) skip the node's meta and the attribute
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial. aimeat.io served an app's own `ai-autonomous` meta followed by the
 *     node's draft-vocabulary `autonomous` meta.
 */
import { logger } from '../utils/logger.js';
import { W3C_AI_DISCLOSURE_VALUES } from './ai-provenance-adapters.js';

/** What the author declared. null means the author did not declare it there. */
export interface AuthorDisclosure {
  /** The content of the first `<meta name="ai-disclosure">` in the head, trimmed. */
  meta: string | null;
  /** The `ai-disclosure` attribute on the `<html>` tag, trimmed. */
  documentElement: string | null;
}

/** markDocumentElement looks for `<html>` in this many characters, so the author's attribute is read there too. */
const DOCUMENT_ELEMENT_WINDOW = 512;

/** Elements whose content is raw text: a `<meta>` written inside one is not a tag. */
const RAW_TEXT = new Set(['script', 'style', 'template', 'noscript', 'title', 'textarea']);

/** The tag name at `lt` (lower case), and whether it is a closing tag. */
function tagAt(lower: string, lt: number): { name: string; closing: boolean } {
  const closing = lower[lt + 1] === '/';
  let i = lt + (closing ? 2 : 1);
  const start = i;
  while (i < lower.length && /[a-z0-9]/.test(lower[i])) i++;
  return { name: lower.slice(start, i), closing };
}

/** The attributes of one tag's text, names in lower case. A later duplicate never replaces the first. */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/**
 * The first `<meta name="ai-disclosure">` in the head. The scan stops at `</head>` or `<body>`, and
 * skips comments and raw-text elements, so an app whose script builds such a tag as a string is not
 * taken to have declared. A document with neither boundary is read to its end.
 */
function headMeta(html: string): string | null {
  const lower = html.toLowerCase();
  let at = 0;
  for (;;) {
    const lt = lower.indexOf('<', at);
    if (lt < 0) return null;
    if (lower.startsWith('<!--', lt)) {
      const end = lower.indexOf('-->', lt + 4);
      if (end < 0) return null;
      at = end + 3;
      continue;
    }
    const { name, closing } = tagAt(lower, lt);
    if (closing && name === 'head') return null;
    if (!closing && name === 'body') return null;
    const gt = lower.indexOf('>', lt);
    if (gt < 0) return null;
    if (!closing && RAW_TEXT.has(name)) {
      const close = lower.indexOf(`</${name}`, gt + 1);
      if (close < 0) return null;
      at = close + 2;
      continue;
    }
    if (!closing && name === 'meta') {
      const attrs = attributes(html.slice(lt + 5, gt));
      if ((attrs.get('name') ?? '').trim().toLowerCase() === 'ai-disclosure') return (attrs.get('content') ?? '').trim();
    }
    at = gt + 1;
  }
}

/** The `ai-disclosure` attribute of the first `<html>` tag, in the window markDocumentElement reads. */
function documentElementValue(html: string): string | null {
  const head = html.slice(0, DOCUMENT_ELEMENT_WINDOW);
  const m = /<html(\s[^>]*)?>/i.exec(head);
  if (!m?.[1]) return null;
  const value = attributes(m[1]).get('ai-disclosure');
  return value === undefined ? null : value.trim();
}

/** What the author of this document declared, before the node adds anything. */
export function authorDisclosure(html: string): AuthorDisclosure {
  return { meta: headMeta(html), documentElement: documentElementValue(html) };
}

/** One line per app and value, and no more than this many remembered, so a busy app logs once. */
const TRACED_MAX = 1000;
const traced = new Set<string>();

/**
 * Log, once per app and value, an author declaration that differs from the record's value. The
 * report matches values ASCII case-insensitively, so case alone is no disagreement.
 */
export function traceAuthorDisclosure(recordUrl: string, nodeValue: string | undefined, own: AuthorDisclosure): void {
  const node = (nodeValue ?? '').toLowerCase();
  for (const [where, value] of [['meta', own.meta], ['html', own.documentElement]] as const) {
    if (value === null || value.toLowerCase() === node) continue;
    const key = `${recordUrl} ${where} ${value}`;
    if (traced.has(key)) continue;
    if (traced.size >= TRACED_MAX) traced.clear();
    traced.add(key);
    logger.info('ai-disclosure: the app declares a value the record does not', {
      record: recordUrl, where, author: value, record_value: nodeValue ?? null,
      author_valid: (W3C_AI_DISCLOSURE_VALUES as readonly string[]).includes(value.toLowerCase()),
    });
  }
}
