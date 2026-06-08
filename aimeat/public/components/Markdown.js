/**
 * @file Markdown.js
 * @description Minimal, safe GitHub-flavored-Markdown renderer for untrusted,
 *   agent-authored (often LLM-generated) content. Renders to Preact vnodes via
 *   `h` — never innerHTML — so there is no raw-HTML / <script> / <iframe> XSS
 *   surface at all (any literal HTML in the source is shown as plain text).
 *   Link hrefs are scheme-sanitized (only http/https/mailto pass; javascript:,
 *   data:, etc. are dropped to a non-navigable anchor). Fenced code blocks
 *   preserve whitespace exactly so ASCII-art logos keep their alignment.
 *
 *   Supported GFM subset: headings (#..######), fenced code blocks (```),
 *   unordered/ordered lists, tables (pipe), blockquotes, paragraphs, and inline
 *   spans (code, bold, italic, links). This is presentation-only — never use
 *   rendered content for any trust or routing decision.
 * @structure
 *   - Markdown ({ text }) -> vnode tree wrapped in a div.md-body
 *   - sanitizeHref(url) -> safe href or null
 * @usage
 *   import { Markdown } from '/components/Markdown.js';
 *   html`<${Markdown} text=${someMarkdownString} />`
 * @version-history
 *   v1.0.0 -- 2026-05-31 -- Initial creation for the agent README tab
 */
import { h } from 'preact';

// Only these schemes may appear in a rendered link. Everything else (javascript:,
// data:, vbscript:, file:, etc.) is dropped — the anchor renders without href.
const SAFE_SCHEME = /^(https?:|mailto:)/i;

// Slug used for heading anchor ids — kept in sync with the [[Doc#Heading]] wiki-link resolver.
export function slugifyHeading(text) {
  return String(text).toLowerCase().trim().replace(/[`*_~[\]()#]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function sanitizeHref(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  // Relative links (no scheme) and fragment/anchor links are safe.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return SAFE_SCHEME.test(trimmed) ? trimmed : null;
}

// ── Inline parsing: code, bold, italic, links. Returns an array of vnodes/strings.
// Order matters: inline code is extracted first so markup inside it is literal.
function parseInline(text, onWikiLink) {
  const out = [];
  let i = 0;
  let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };

  while (i < text.length) {
    const c = text[i];

    // Image ![alt](url) — checked before links so the leading ! is consumed.
    if (c === '!' && text[i + 1] === '[') {
      const close = text.indexOf(']', i + 2);
      if (close > i && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren > close) {
          const alt = text.slice(i + 2, close);
          const src = sanitizeHref(text.slice(close + 2, paren));
          flush();
          if (src) out.push(h('img', { src, alt, class: 'md-img', loading: 'lazy' }));
          i = paren + 1;
          continue;
        }
      }
    }

    // Wiki link [[Document Title]] — resolves to another document when a resolver is supplied.
    if (c === '[' && text[i + 1] === '[') {
      const end = text.indexOf(']]', i + 2);
      if (end > i) {
        flush();
        const title = text.slice(i + 2, end).trim();
        out.push(onWikiLink
          ? h('a', { href: '#', class: 'md-wikilink', onClick: (e) => { e.preventDefault(); onWikiLink(title); } }, title.replace('#', ' › '))
          : '[[' + title + ']]');
        i = end + 2;
        continue;
      }
    }

    // Inline code `...` — contents are literal (no further parsing).
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push(h('code', { class: 'md-code' }, text.slice(i + 1, end)));
        i = end + 1;
        continue;
      }
    }

    // Link [label](url)
    if (c === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren > close) {
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, paren);
          const href = sanitizeHref(url);
          flush();
          out.push(
            href
              ? h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, parseInline(label, onWikiLink))
              : h('span', null, parseInline(label, onWikiLink)),
          );
          i = paren + 1;
          continue;
        }
      }
    }

    // Bold **...**
    if (c === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i) {
        flush();
        out.push(h('strong', null, parseInline(text.slice(i + 2, end), onWikiLink)));
        i = end + 2;
        continue;
      }
    }

    // Italic *...* (single asterisk, not part of **)
    if (c === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i) {
        flush();
        out.push(h('em', null, parseInline(text.slice(i + 1, end), onWikiLink)));
        i = end + 1;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
  return out;
}

function parseTableRow(line) {
  // Split on unescaped pipes, dropping the leading/trailing empties.
  let cells = line.trim().split('|');
  if (cells.length && cells[0] === '') cells = cells.slice(1);
  if (cells.length && cells[cells.length - 1] === '') cells = cells.slice(0, -1);
  return cells.map(c => c.trim());
}

function isTableDivider(line) {
  // e.g. | --- | :--: | ---: |
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

// ── Block parsing. Walks lines, emits block-level vnodes.
function parseBlocks(src, onWikiLink) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (line.trim() === '') { i++; continue; }

    // Fenced code block ``` (preserve whitespace EXACTLY; no inline parsing).
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1][0];
      const codeLines = [];
      i++;
      while (i < lines.length && !new RegExp('^\\s*' + marker + '{3,}\\s*$').test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF)
      blocks.push(h('pre', { class: 'md-pre' }, h('code', { class: 'md-code' }, codeLines.join('\n'))));
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(h('h' + level, { id: slugifyHeading(heading[2].trim()) }, parseInline(heading[2].trim(), onWikiLink)));
      i++;
      continue;
    }

    // Blockquote (collect consecutive > lines)
    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(h('blockquote', null, parseBlocks(quoted.join('\n'), onWikiLink)));
      continue;
    }

    // Table: a header row followed by a divider row.
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = parseTableRow(line);
      i += 2; // skip header + divider
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push(h('table', null, [
        h('thead', null, h('tr', null, header.map((c, ci) => h('th', { key: ci }, parseInline(c, onWikiLink))))),
        h('tbody', null, rows.map((r, ri) =>
          h('tr', { key: ri }, r.map((c, ci) => h('td', { key: ci }, parseInline(c, onWikiLink)))))),
      ]));
      continue;
    }

    // Lists (unordered - / * / +, or ordered 1.)
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      const ordered = !!olMatch;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(ordered ? /^(\s*)(\d+)\.\s+(.*)$/ : /^(\s*)([-*+])\s+(.*)$/);
        if (!m) break;
        items.push(h('li', { key: items.length }, parseInline(m[3], onWikiLink)));
        i++;
      }
      blocks.push(h(ordered ? 'ol' : 'ul', null, items));
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-block lines.
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(`{3,}|~{3,})/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(\s*)([-*+])\s+/.test(lines[i]) &&
      !/^(\s*)(\d+)\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    // Join wrapped lines with a space (standard markdown paragraph behavior).
    blocks.push(h('p', null, parseInline(para.join(' '), onWikiLink)));
  }

  return blocks;
}

export function Markdown({ text, onWikiLink }) {
  const src = typeof text === 'string' ? text : '';
  return h('div', { class: 'md-body' }, parseBlocks(src, onWikiLink));
}

export default Markdown;
