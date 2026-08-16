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
 *   - sanitizeImgSrc(url) -> safe <img> src or null (also permits blob: object URLs)
 * @usage
 *   import { Markdown } from '/components/Markdown.js';
 *   html`<${Markdown} text=${someMarkdownString} />`
 * @version-history
 *   v1.0.0 -- 2026-05-31 -- Initial creation for the agent README tab
 *   v1.1.0 -- 2026-06-08 -- Image src sanitized separately, allowing blob: (auth'd object URLs)
 *     so callers can swap a private /v1/storage URL to a fetched blob in the markdown text.
 *   v1.2.0 -- 2026-06-08 -- ```mermaid fenced blocks render as diagrams (lazy-loaded Mermaid),
 *     so documents (and any Markdown view) can embed charts.
 *   v1.3.0 -- 2026-06-16 -- Horizontal rules (---, ***, ___) render as <hr>; LIST ITEMS may span
 *     multiple lines (wrapped continuation lines join the current item) so ordered-list numbering no
 *     longer restarts at 1 on every wrapped line.
 *   v1.4.0 -- 2026-07-02 -- ```aimeat-memory fenced blocks render as LIVE data embeds (MemoryEmbed):
 *     the named memory key is fetched at render time and shown as a table/props/list/value, so a
 *     document referencing agent-produced data is fresh on every open.
 *   v1.6.0 -- 2026-08-16 -- A bare HOST autolinks too (laake.apps.aimeat.io), because an agent
 *     listing addresses writes them the way a person says them. Gated on a short suffix list, so a
 *     token like package.json stays text.
 *   v1.5.0 -- 2026-07-12 -- Bare http(s) URLs autolink (GFM extended autolink): a raw https://… in the
 *     source becomes a clickable link (target=_blank, scheme-sanitized), so a pasted URL in a message /
 *     document is clickable without [label](url) syntax. Trailing sentence punctuation is trimmed.
 */
import { h } from 'preact';
import { Mermaid } from './Mermaid.js';
import { MemoryEmbed } from './MemoryEmbed.js';

// Only these schemes may appear in a rendered link. Everything else (javascript:,
// data:, vbscript:, file:, etc.) is dropped — the anchor renders without href.
const SAFE_SCHEME = /^(https?:|mailto:)/i;
// Image src may additionally be a blob: object URL — a caller resolving a private /v1/storage image
// to an auth'd `blob:` URL (scripts never execute from an <img src>, and blob: is same-origin).
const SAFE_IMG_SCHEME = /^(https?:|blob:)/i;

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

export function sanitizeImgSrc(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;   // relative (e.g. /v1/storage/…)
  return SAFE_IMG_SCHEME.test(trimmed) ? trimmed : null;
}

// Match a BARE http(s) URL starting at index i (GFM extended autolink). Trims trailing sentence
// punctuation and an unbalanced closing paren so "see https://x." / "(https://x)" link the URL only.
// Returns the URL string, or null. Scheme is validated separately by sanitizeHref before rendering.
function matchAutolinkUrl(text, i) {
  const m = /^https?:\/\/[^\s<]+/i.exec(text.slice(i));
  if (!m) return null;
  let url = m[0];
  for (let trimming = true; trimming && url;) {
    trimming = false;
    const last = url[url.length - 1];
    if ('.,;:!?\'"'.includes(last)) { url = url.slice(0, -1); trimming = true; }
    else if (last === ')' && (url.split(')').length - 1) > (url.split('(').length - 1)) { url = url.slice(0, -1); trimming = true; }
  }
  return url || null;
}

/**
 * A bare HOST that a person is meant to be able to open — `laake.apps.aimeat.io`, `aimeat.io`.
 *
 * An agent listing twenty apps writes their addresses as hosts, because that is how a person says
 * an address out loud. Rendered as text they are twenty things to retype; the reason to link them
 * is the same reason `https://…` is linked, and the only difference is a scheme nobody says either.
 *
 * The suffix list is what keeps this from linking `package.json` or `Array.prototype`: a token is an
 * address when it ends in a public suffix we actually serve or link to. Kept deliberately short —
 * a name that is not on it renders as text, which is the safe way to be wrong.
 */
const LINKABLE_SUFFIX = /\.(io|com|net|org|fi|dev|ai|app|sh|me)$/i;
function matchBareHost(text, i) {
    const m = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+/i.exec(text.slice(i));
    if (!m) return null;
    let host = m[0];
    // A trailing dot is sentence punctuation rather than part of the name.
    while (host.endsWith('.')) host = host.slice(0, -1);
    if (!LINKABLE_SUFFIX.test(host)) return null;
    if (host.length > 253) return null;
    return host;
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
          const src = sanitizeImgSrc(text.slice(close + 2, paren));
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

    // Italic _..._ (underscore) — only at word boundaries, so snake_case identifiers stay literal.
    if (c === '_' && (i === 0 || !/\w/.test(text[i - 1])) && text[i + 1] && text[i + 1] !== ' ') {
      let j = i + 1;
      while ((j = text.indexOf('_', j)) >= 0) {
        const after = text[j + 1];
        if (text[j - 1] !== ' ' && (after === undefined || !/\w/.test(after))) break;
        j++;
      }
      if (j >= 0) {
        flush();
        out.push(h('em', null, parseInline(text.slice(i + 1, j), onWikiLink)));
        i = j + 1;
        continue;
      }
    }

    // Bare URL autolink (http/https only) — turn a raw https://… into a clickable link. Only at a
    // boundary (start, or after whitespace / an opening bracket) so a scheme glued inside a token, or
    // the url in an existing [label](url) link (consumed above), is left alone.
    if ((c === 'h' || c === 'H') && (i === 0 || /\s|[([{<]/.test(text[i - 1]))) {
      const url = matchAutolinkUrl(text, i);
      if (url) {
        const href = sanitizeHref(url);
        flush();
        out.push(href
          ? h('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, url)
          : url);
        i += url.length;
        continue;
      }
    }

    // A bare host, at a token boundary, when nothing above claimed it. After the URL branch, so
    // `https://x.io` is still matched as a URL with its scheme rather than as a host.
    if (/[a-z0-9]/i.test(c) && (i === 0 || /[\s([{<>"']/.test(text[i - 1]))) {
      const host = matchBareHost(text, i);
      if (host) {
        flush();
        out.push(h('a', { href: `https://${host}`, target: '_blank', rel: 'noopener noreferrer nofollow' }, host));
        i += host.length;
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
      const lang = (fence[2] || '').trim().toLowerCase();
      if (lang === 'mermaid') {
        // ```mermaid → render the diagram (Mermaid lazy-loads its 3MB renderer only when used).
        blocks.push(h(Mermaid, { chart: codeLines.join('\n') }));
      } else if (lang === 'aimeat-memory') {
        // ```aimeat-memory → live data embed: the named memory key is fetched at render time and
        // shown as a table/props/list/value, so the document is fresh on every open. Access is the
        // server's memory read (workspace rules + entry visibility) — denials render a placeholder.
        blocks.push(h(MemoryEmbed, { spec: codeLines.join('\n') }));
      } else {
        blocks.push(h('pre', { class: 'md-pre' }, h('code', { class: 'md-code' }, codeLines.join('\n'))));
      }
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

    // Horizontal rule: a line of 3+ identical -, *, or _ (e.g. ---, ***, ___) on its own.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(h('hr', { class: 'md-hr' }));
      i++;
      continue;
    }

    // Lists (unordered - / * / +, or ordered 1.). A list item may span multiple lines: any following
    // non-blank line that is NOT a new list item and NOT a block starter is a CONTINUATION of the
    // current item (joined with a space). Without this, a wrapped item line breaks the list and the
    // numbering restarts at 1 each time.
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      const ordered = !!olMatch;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(ordered ? /^(\s*)(\d+)\.\s+(.*)$/ : /^(\s*)([-*+])\s+(.*)$/);
        if (!m) break;
        const parts = [m[3]];
        i++;
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          !/^(\s*)(\d+)\.\s+/.test(lines[i]) &&
          !/^(\s*)([-*+])\s+/.test(lines[i]) &&
          !/^#{1,6}\s/.test(lines[i]) &&
          !/^\s*(`{3,}|~{3,})/.test(lines[i]) &&
          !/^\s*>/.test(lines[i]) &&
          !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
        ) {
          parts.push(lines[i].trim());
          i++;
        }
        items.push(h('li', { key: items.length }, parseInline(parts.join(' '), onWikiLink)));
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
