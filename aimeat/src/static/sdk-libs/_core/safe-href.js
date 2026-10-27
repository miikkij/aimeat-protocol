/**
 * @file safe-href.js
 * @description Shared SDK-libs core: the scheme rule a served library applies before it puts a URL it
 *   did not build into a link. A link takes http(s), mailto or a relative address; anything else
 *   answers null and no link is drawn. The scheme is decided on the text the browser's URL parser
 *   reads (tabs and newlines removed, C0 controls and spaces trimmed), so `java<TAB>script:` is not
 *   taken for a relative link. It is the rule of AIMEAT.md.sanitizeHref (markdown/index.js, v1.2.1),
 *   which keeps its own copy because test/unit/markdown-href-scheme.test.ts reads it from that file.
 * @structure parserText(url) · sanitizeHref(url)
 * @usage import { sanitizeHref } from '../_core/safe-href.js';  const href = sanitizeHref(url); if (href) a.href = href;
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial, for the AI label's record link (secaudit2026oct26,
 *     sdk-libs/ai/disclose:buildLabel-recordUrl-unchecked-scheme).
 */

const SAFE = /^(https?:|mailto:)/i;

/** The text the browser's URL parser reads: every ASCII tab and newline removed, leading and trailing
 *  C0 controls and spaces trimmed. */
export function parserText(url) {
  const s = url.replace(/[\t\n\r]/g, '');
  let a = 0, b = s.length;
  while (a < b && s.charCodeAt(a) <= 0x20) a++;
  while (b > a && s.charCodeAt(b - 1) <= 0x20) b--;
  return s.slice(a, b).trim();
}

/** The link to draw, or null: http(s), mailto, or a relative or fragment address. */
export function sanitizeHref(url) {
  if (typeof url !== 'string') return null;
  const t = parserText(url);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) return t || null;
  return SAFE.test(t) ? t : null;
}
