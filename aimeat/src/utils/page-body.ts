/**
 * @file page-body.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Puts a public page's own words INSIDE the document that is sent, instead of leaving
 *   them to appear only after the browser has run the Preact bundle.
 *
 *   The failure this fixes was measured on aimeat.io on 2026-09-11. Twelve of the fifteen registry
 *   pages answered with the same spa.html shell, whose body holds 203 characters of text, and those
 *   203 characters are byte-identical on every one of them. To a reader that does not run
 *   JavaScript, twelve addresses were twelve copies of one near-empty document. Bing's own report
 *   on the property said so: sixteen URLs indexed, sixteen excluded, eight impressions in six
 *   months. Googlebot renders and therefore saw the real pages; nothing else does, and "nothing
 *   else" is Bing, Copilot, DuckDuckGo, and the three AI search crawlers that robots.txt goes to
 *   some trouble to welcome by name.
 *
 *   The words already existed. Every registry page carries an authored `markdown` body, served at
 *   `<path>.md` and read by agents. This renders that same text into the shell, so the document as
 *   sent says what the page is about. Nothing is written that a reader cannot also see: the block
 *   is visible until the view mounts, and the SPA removes it at that moment (public/spa.html), so
 *   a person gets the normal page and a crawler gets the prose. It is the same content in both
 *   cases, which is what keeps this progressive enhancement rather than a second document written
 *   for machines.
 *
 *   THE RENDERER IS DELIBERATELY SMALL. It covers the constructs the registry bodies actually use —
 *   headings, paragraphs, both kinds of list, blockquotes, fenced and inline code, bold, links —
 *   and nothing else, because a markdown library would be a production dependency, a licence entry
 *   and an attack surface for one paragraph per page of repo-authored text. Everything is escaped
 *   before any markup is emitted and only a fixed tag set is produced, so the output is safe even
 *   though the input is ours.
 *
 * @structure
 *   - renderMarkdownBody(markdown)     — the markdown subset, as HTML
 *   - injectPageBody(html, page, ...)  — put it in the shell, after the app root
 * @usage
 *   html = injectPageBody(html, page, config, isShell);
 * @version-history
 *   v1.0.0 — 2026-09-11 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { PublicPage } from '../data/public-pages.js';

/** HTML-escape. Runs before any markup is emitted, so nothing downstream can produce a tag. */
function esc(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The href schemes a link in this text may use. Everything else renders as its own label and no
 * anchor, which is the quiet-but-visible failure: the words survive, the link does not.
 * `javascript:` and `data:` are the reason this list is an allowlist rather than a denylist.
 */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (u.startsWith('/') || u.startsWith('#')) return u;
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  return null;
}

/**
 * Inline markup on an already-escaped line: code spans, bold, links.
 *
 * Code spans are lifted out first and put back last, so a backtick span containing `**` or a
 * bracket is left exactly as written. The placeholder is U+FFFC, the character whose whole purpose
 * is "something else belongs here", and it is stripped from the input before the pass runs, so a
 * source text carrying one cannot address a code span it never opened. (NUL would read better in
 * a diff and do the same job, but a control character in a regular expression is an ESLint error
 * across this repo, and that rule is right more often than it is wrong.)
 */
const SLOT = '\uFFFC';
const SLOT_RE = new RegExp(`${SLOT}(\\d{1,4})${SLOT}`, 'g');

function inline(escaped: string): string {
  const codes: string[] = [];
  let s = escaped.replaceAll(SLOT, '').replace(/`([^`]{1,400})`/g, (_m, code: string) => {
    codes.push(code);
    return `${SLOT}${codes.length - 1}${SLOT}`;
  });

  s = s.replace(/\*\*([^*]{1,300})\*\*/g, '<strong>$1</strong>');

  s = s.replace(/\[([^\]]{1,300})\]\(([^)\s]{1,500})\)/g, (_whole, label: string, url: string) => {
    // The URL arrives escaped, which turns `&` into `&amp;` — correct inside an attribute, so it
    // is checked in that form and emitted unchanged.
    const href = safeHref(url.replace(/&amp;/g, '&'));
    if (!href) return label;
    return `<a href="${esc(href)}">${label}</a>`;
  });

  return s.replace(SLOT_RE, (_m, i: string) => `<code class="md-code">${codes[Number(i)]}</code>`);
}

/** True for a line that begins a block of its own, i.e. one that ends the paragraph above it. */
function startsBlock(line: string): boolean {
  return line.trim() === ''
    || /^```/.test(line)
    || /^#{1,6}\s/.test(line)
    || /^[-*]\s/.test(line)
    || /^\d{1,3}\.\s/.test(line)
    || /^>\s?/.test(line);
}

/**
 * The markdown subset the public-page registry is written in, as HTML.
 *
 * Heading levels are shifted down by one: the block is introduced by the page title as an `<h2>`
 * (see injectPageBody), and a registry body's own top level is `##`, so `##` becomes `<h3>` and the
 * outline reads as one document rather than two competing ones.
 */
export function renderMarkdownBody(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i += 1; continue; }

    // Fenced code. An unterminated fence runs to the end of the text rather than erroring: this is
    // our own copy, and losing the rest of a page to one stray backtick line would be worse.
    if (/^```/.test(line)) {
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.{1,300})$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(esc(heading[2].trim()))}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(/^[-*]\s+/, '')))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d{1,3}\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d{1,3}\.\s/.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(/^\d{1,3}\.\s+/, '')))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote><p>${inline(esc(quoted.join(' ').trim()))}</p></blockquote>`);
      continue;
    }

    // A paragraph: this line and every following one that does not start a block of its own.
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && !startsBlock(lines[i])) { para.push(lines[i]); i += 1; }
    out.push(`<p>${inline(esc(para.join(' ').trim()))}</p>`);
  }

  return out.join('\n');
}

/**
 * Put the page's rendered body into the shell, immediately after the app root.
 *
 * After, not inside: Preact's render() diffs against whatever DOM it finds in its container, and
 * handing it a tree it did not build is a class of bug nobody should have to debug later. The
 * block is its own sibling, and spa.html removes it the moment a view mounts.
 *
 * Returns the document unchanged, and that is the normal case rather than a failure, when:
 *   - the document is not the SPA shell. /v1/connect, /v1/privacy and /v1/terms are real HTML
 *     pages with six to twenty thousand characters of their own; injecting a summary of a page
 *     into that page is duplication, not content.
 *   - the page carries no authored markdown, or the app root is not where it is expected.
 */
export function injectPageBody(
  html: string,
  page: PublicPage | undefined,
  config: AimeatConfig,
  opts: {
    /** Whether the document being served is spa.html, the shell whose body is empty until scripts run. */
    isShell: boolean;
    /**
     * Body text for a page whose real content is built rather than stored in the registry. The
     * glossary is the case this exists for: its registry entry is one paragraph, and its two
     * hundred definitions are generated from src/data/glossary.ts.
     */
    markdown?: string;
  },
): string {
  const source = opts.markdown ?? page?.markdown;
  if (!opts.isShell || !page || !source) return html;
  const marker = '<div id="app"></div>';
  if (!html.includes(marker)) return html;

  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const markdown = source
    .replaceAll('{{BASE_URL}}', baseUrl)
    .replaceAll('{{NODE_ID}}', config.nodeId);

  const block = `<div id="crawler-body" class="md-body">`
    + `<h2>${esc(page.title)}</h2>`
    + renderMarkdownBody(markdown)
    + `<p><a href="${esc(baseUrl + (page.path === '/' ? '/index.md' : `${page.path}.md`))}">`
    + `This page as markdown</a></p>`
    + `</div>`;

  return html.replace(marker, `${marker}\n  ${block}`);
}
