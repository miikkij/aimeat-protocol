/**
 * @file src/utils/markdown-lite.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A small markdown-to-HTML renderer for text an OWNER wrote and the node serves to
 *   strangers: an app's terms, privacy notice, imprint. Deliberately small, because the whole value
 *   of it is that every character of the input is escaped before anything is emitted. Raw HTML in
 *   the source is shown as text, never rendered; a link is a link only when its target is http(s)
 *   or mailto. There is no markdown dependency in this codebase and this is not the place to add
 *   one: a legal page needs headings, paragraphs, lists, emphasis, links and code, and nothing else.
 *
 *   Supported: `#`–`###` headings, paragraphs, `-`/`*` bullets, `1.` numbered lists, `>` quotes,
 *   fenced code (```), inline `code`, **bold**, *italic*, [text](https://…), and `---` rules.
 * @structure renderMarkdownLite(md) → HTML fragment
 * @usage
 *   const html = renderMarkdownLite(doc.content);
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial, for the app legal pages (services/app-legal.ts).
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline marks over ALREADY-ESCAPED text, so nothing the author wrote can open a tag. */
function inline(escaped: string): string {
  let out = escaped;
  // `code` first, and its contents are left alone by the marks below.
  const codes: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_m, c: string) => { codes.push(`<code>${c}</code>`); return `\uE000${codes.length - 1}\uE000`; });
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_m, text: string, href: string) => `<a href="${href}" rel="noopener">${text}</a>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => codes[Number(i)]);
  return out;
}

export function renderMarkdownLite(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let quote: string[] = [];
  let code: string[] | null = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${inline(esc(quote.join(' ')))}</p></blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (code) {
      if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushAll(); code = []; continue; }
    if (!line.trim()) { flushAll(); continue; }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) { flushAll(); out.push(`<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushAll(); out.push('<hr>'); continue; }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushPara(); flushQuote();
      if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(esc(bullet[1]))}</li>`);
      continue;
    }
    const num = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (num) {
      flushPara(); flushQuote();
      if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(esc(num[1]))}</li>`);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    flushList(); flushQuote();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flushAll();
  return out.join('\n');
}
