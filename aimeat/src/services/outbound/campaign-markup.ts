/**
 * @file src/services/outbound/campaign-markup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The small, closed formatting vocabulary a campaign body may use, and its two
 *   renderings: inline-styled HTML for the mail's HTML part, and readable plain text for its text
 *   part.
 *
 *   THE VOCABULARY, and nothing else:
 *     `## ` and `### ` at the start of a line   two heading levels
 *     `- ` at the start of a line               a bullet; consecutive bullets are one list
 *     `---` alone on a line                     a horizontal rule
 *     `**bold**`                                bold, inside any block
 *     `[label](https://...)`                    a link, inside any block; https only
 *     anything else                             paragraphs as before: a blank line starts a new
 *                                               one, a single line break stays a line break
 *
 *   WHY A VOCABULARY AND NOT HTML. The body is text a caller wrote, and it goes out in the owner's
 *   name to somebody else's inbox. No caller markup ever reaches the message: the server reads the
 *   few patterns above and builds every tag itself, from escaped text. A pattern that does not match
 *   exactly stays literal text, escaped.
 *
 *   WHY A LINK MUST BE HTTPS. `javascript:` and `data:` addresses are a script in some mail clients,
 *   and a plain http link in a newsletter is one a mailbox provider marks down. A link whose address
 *   fails the check is left as the literal text the caller wrote, so the reader still sees it and
 *   nothing becomes a working anchor. Credentials in an address (`https://user:pw@host`) are refused
 *   too: they are the classic way to make a link read as one host and open another.
 *
 *   EMAIL-CLIENT RULES, the same ones campaign-email.ts keeps: every style is inline, and the rule is
 *   a one-pixel table cell with `bgcolor`, because Outlook draws `<hr>` in its own grey and ignores
 *   most margins.
 * @structure Block · parseCampaignBody · safeHttpsUrl · renderBlocksHtml · renderBlocksText
 * @usage const blocks = parseCampaignBody(body); renderBlocksHtml(blocks, theme); renderBlocksText(blocks)
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial, for the newsletter: headings, bullets, bold, links and a rule.
 */
import { escapeHtml } from '../../utils/html-escape.js';
import { fontStack, type ThemeTokens } from './email-theme.js';

export type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h2' | 'h3'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'hr' };

/** The longest link address the vocabulary accepts; the same cap the `links` buttons have. */
const MAX_URL = 600;
const MAX_LABEL = 200;

/**
 * An https address with a host and no credentials, normalised, or null.
 *
 * Shared by the inline links, the lead image and the sender record's privacy address, so the three
 * places an address enters a campaign answer the same question the same way.
 */
export function safeHttpsUrl(raw: unknown, max = MAX_URL): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > max || !/^https:\/\//i.test(s) || !URL.canParse(s)) return null;
  const u = new URL(s);
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
  return u.href;
}

/** Read the body into blocks. Never throws: text that matches no pattern is a paragraph. */
export function parseCampaignBody(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] | null = null;
  let list: string[] | null = null;
  const flush = (): void => {
    if (para) blocks.push({ kind: 'p', lines: para });
    if (list) blocks.push({ kind: 'ul', items: list });
    para = null;
    list = null;
  };
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (t === '---') { flush(); blocks.push({ kind: 'hr' }); continue; }
    const heading = /^(#{2,3}) (.+)$/.exec(t);
    if (heading) {
      flush();
      blocks.push({ kind: heading[1] === '##' ? 'h2' : 'h3', text: heading[2]!.trim() });
      continue;
    }
    const bullet = /^- (.+)$/.exec(t);
    if (bullet) {
      if (para) { blocks.push({ kind: 'p', lines: para }); para = null; }
      (list ??= []).push(bullet[1]!.trim());
      continue;
    }
    if (list) { blocks.push({ kind: 'ul', items: list }); list = null; }
    (para ??= []).push(t);
  }
  flush();
  return blocks;
}

/**
 * The two inline patterns. A link label may not contain brackets and its address may not contain
 * parentheses or whitespace, so the match ends where the reader expects it to end.
 */
const INLINE = new RegExp(
  String.raw`\[([^\[\]\n]{1,${MAX_LABEL}})\]\(([^()\s]{1,${MAX_URL}})\)` + '|' + String.raw`\*\*([^*\n]{1,500}?)\*\*`,
  'g',
);

type Piece = { text: string } | { bold: string } | { label: string; href: string };

/** Split one line of text into literal text, bold runs and links. Pure, and the only parser of inline syntax. */
function inlinePieces(s: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > at) out.push({ text: s.slice(at, start) });
    if (m[3] !== undefined) {
      out.push({ bold: m[3] });
    } else {
      const href = safeHttpsUrl(m[2]);
      // A link whose address fails the check stays exactly what the caller wrote, as text.
      out.push(href ? { label: m[1]!, href } : { text: m[0] });
    }
    at = start + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

function inlineHtml(s: string, th: ThemeTokens): string {
  return inlinePieces(s).map((p) => {
    if ('bold' in p) return `<strong style="font-weight:700;">${escapeHtml(p.bold)}</strong>`;
    if ('href' in p) return `<a href="${escapeHtml(p.href)}" style="color:${th.accent};text-decoration:underline;">${escapeHtml(p.label)}</a>`;
    return escapeHtml(p.text);
  }).join('');
}

function inlineText(s: string): string {
  return inlinePieces(s).map((p) => {
    if ('bold' in p) return `*${p.bold}*`;
    if ('href' in p) return p.label === p.href ? p.href : `${p.label} (${p.href})`;
    return p.text;
  }).join('');
}

/** The blocks as inline-styled HTML, in the theme's colours. */
export function renderBlocksHtml(blocks: Block[], th: ThemeTokens): string {
  const font = fontStack(th.font);
  const textStyle = `font-family:${font};font-size:15px;line-height:1.65;color:${th.text};`;
  return blocks.map((b) => {
    switch (b.kind) {
      case 'p':
        return `<p style="margin:0 0 14px;${textStyle}">${b.lines.map((l) => inlineHtml(l, th)).join('<br>')}</p>`;
      case 'h2':
        return `<h2 style="margin:26px 0 10px;font-family:${font};font-size:19px;line-height:1.35;font-weight:700;color:${th.heading};">${inlineHtml(b.text, th)}</h2>`;
      case 'h3':
        return `<h3 style="margin:20px 0 8px;font-family:${font};font-size:16px;line-height:1.4;font-weight:700;color:${th.heading};">${inlineHtml(b.text, th)}</h3>`;
      case 'ul':
        return `<ul style="margin:0 0 14px;padding:0 0 0 22px;">${b.items
          .map((i) => `<li style="margin:0 0 6px;${textStyle}">${inlineHtml(i, th)}</li>`).join('')}</ul>`;
      case 'hr':
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 24px;">`
          + `<tr><td height="1" bgcolor="${th.border}" style="height:1px;line-height:1px;font-size:0;background-color:${th.border};">&nbsp;</td></tr></table>`;
    }
  }).join('');
}

/** The blocks as plain text a reader without HTML can follow. Every link address is spelled out. */
export function renderBlocksText(blocks: Block[]): string {
  return blocks.map((b) => {
    switch (b.kind) {
      case 'p': return b.lines.map(inlineText).join('\n');
      case 'h2': { const t = inlineText(b.text); return `${t}\n${'='.repeat(Math.min(t.length, 60))}`; }
      case 'h3': { const t = inlineText(b.text); return `${t}\n${'-'.repeat(Math.min(t.length, 60))}`; }
      case 'ul': return b.items.map((i) => `• ${inlineText(i)}`).join('\n');
      case 'hr': return '* * *';
    }
  }).join('\n\n');
}
