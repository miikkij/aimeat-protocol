/**
 * @file lib-markdown.ts
 * @description aimeat-markdown.js — a vanilla, dependency-free, XSS-safe GitHub-flavored-Markdown
 *   renderer for standalone published apps (and cortex). Mirrors the SPA's components/Markdown.js
 *   rules + its .md-body styling, but builds the DOM with createElement / textContent (never
 *   innerHTML for content), so agent/LLM-authored markdown has no raw-HTML / <script> surface.
 *   Link hrefs + image srcs are scheme-sanitized. The .md-body CSS is injected once and uses
 *   daisyUI base vars with dark fallbacks, so it looks right in the standard app shells.
 * @structure aimeatMarkdownLib(config) -> string (IIFE attaching global.AIMEAT.md)
 *   - AIMEAT.md.render(text, target?) -> HTMLElement (div.md-body); replaces target if given
 * @usage <script src="/v1/libs/aimeat-markdown.js"></script>  then  AIMEAT.md.render(md, '#out')
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial: vanilla port of components/Markdown.js GFM subset (no wiki-links /
 *     mermaid) for standalone apps; exposes AIMEAT.md.render.
 */
import type { AimeatConfig } from '../config.js';

export function aimeatMarkdownLib(config: AimeatConfig): string {
  return `// aimeat-markdown.js — AIMEAT Markdown renderer (safe GFM subset, no dependencies)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Usage: AIMEAT.md.render(markdownString, '#target')  ->  renders into #target (and returns the node)
(function (global) {
'use strict';
var BT = String.fromCharCode(96); // backtick, kept out of this template literal
var SAFE = /^(https?:|mailto:)/i;
var SAFE_IMG = /^(https?:|blob:)/i;

function sanitizeHref(url) {
  if (typeof url !== 'string') return null;
  var t = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;       // relative / fragment links are safe
  return SAFE.test(t) ? t : null;
}
function sanitizeImgSrc(url) {
  if (typeof url !== 'string') return null;
  var t = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;        // relative (e.g. /v1/pub/…)
  return SAFE_IMG.test(t) ? t : null;
}

function txt(s) { return document.createTextNode(s == null ? '' : String(s)); }
function append(node, kids) {
  if (kids == null) return;
  if (!Array.isArray(kids)) kids = [kids];
  for (var i = 0; i < kids.length; i++) {
    var c = kids[i];
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? txt(c) : c);
  }
}
function el(tag, attrs, kids) {
  var n = document.createElement(tag);
  if (attrs) for (var k in attrs) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
  append(n, kids);
  return n;
}

// ── Inline parsing: image, code, link, bold, italic. Returns an array of (string | Node).
function parseInline(text) {
  var out = [], i = 0, buf = '';
  function flush() { if (buf) { out.push(buf); buf = ''; } }
  while (i < text.length) {
    var c = text[i];
    // Image ![alt](url)
    if (c === '!' && text[i + 1] === '[') {
      var close = text.indexOf(']', i + 2);
      if (close > i && text[close + 1] === '(') {
        var paren = text.indexOf(')', close + 2);
        if (paren > close) {
          var src = sanitizeImgSrc(text.slice(close + 2, paren));
          flush();
          if (src) out.push(el('img', { src: src, alt: text.slice(i + 2, close), 'class': 'md-img', loading: 'lazy' }));
          i = paren + 1; continue;
        }
      }
    }
    // Inline code
    if (c === BT) {
      var endc = text.indexOf(BT, i + 1);
      if (endc > i) { flush(); out.push(el('code', { 'class': 'md-code' }, text.slice(i + 1, endc))); i = endc + 1; continue; }
    }
    // Link [label](url)
    if (c === '[') {
      var lc = text.indexOf(']', i + 1);
      if (lc > i && text[lc + 1] === '(') {
        var lp = text.indexOf(')', lc + 2);
        if (lp > lc) {
          var href = sanitizeHref(text.slice(lc + 2, lp));
          var label = parseInline(text.slice(i + 1, lc));
          flush();
          out.push(href
            ? el('a', { href: href, target: '_blank', rel: 'noopener noreferrer nofollow' }, label)
            : el('span', null, label));
          i = lp + 1; continue;
        }
      }
    }
    // Bold **...**
    if (c === '*' && text[i + 1] === '*') {
      var be = text.indexOf('**', i + 2);
      if (be > i) { flush(); out.push(el('strong', null, parseInline(text.slice(i + 2, be)))); i = be + 2; continue; }
    }
    // Italic *...*
    if (c === '*') {
      var ie = text.indexOf('*', i + 1);
      if (ie > i) { flush(); out.push(el('em', null, parseInline(text.slice(i + 1, ie)))); i = ie + 1; continue; }
    }
    // Italic _..._ at word boundaries (so snake_case stays literal)
    if (c === '_' && (i === 0 || !/\\w/.test(text[i - 1])) && text[i + 1] && text[i + 1] !== ' ') {
      var j = i + 1;
      while ((j = text.indexOf('_', j)) >= 0) {
        var after = text[j + 1];
        if (text[j - 1] !== ' ' && (after === undefined || !/\\w/.test(after))) break;
        j++;
      }
      if (j >= 0) { flush(); out.push(el('em', null, parseInline(text.slice(i + 1, j)))); i = j + 1; continue; }
    }
    buf += c; i++;
  }
  flush();
  return out;
}

function tableRow(line) {
  var cells = line.trim().split('|');
  if (cells.length && cells[0] === '') cells = cells.slice(1);
  if (cells.length && cells[cells.length - 1] === '') cells = cells.slice(0, -1);
  return cells.map(function (c) { return c.trim(); });
}
function isDivider(line) { return /^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)*\\|?\\s*$/.test(line); }
function fenceInfo(line) {
  var t = line.replace(/^\\s+/, ''), ch = t.charAt(0);
  if ((ch === BT || ch === '~') && t.slice(0, 3) === ch + ch + ch) return { marker: ch, lang: t.slice(3).trim().toLowerCase() };
  return null;
}
function isFenceLine(line) { return fenceInfo(line) !== null; }
function isHeading(line) { return /^#{1,6}\\s/.test(line); }
function isQuote(line) { return /^\\s*>/.test(line); }
function isHr(line) { return /^\\s*([-*_])\\1{2,}\\s*$/.test(line); }
function isUl(line) { return /^(\\s*)([-*+])\\s+/.test(line); }
function isOl(line) { return /^(\\s*)(\\d+)\\.\\s+/.test(line); }
function isBlockStart(line) { return isFenceLine(line) || isHeading(line) || isQuote(line) || isUl(line) || isOl(line); }

function parseBlocks(src) {
  var lines = src.replace(/\\r\\n?/g, '\\n').split('\\n');
  var blocks = [], i = 0;
  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '') { i++; continue; }

    var fence = fenceInfo(line);
    if (fence) {
      var code = []; i++;
      while (i < lines.length && lines[i].trim().split('').join('') !== '' &&
             !(lines[i].trim().length >= 3 && lines[i].trim().split('').every(function (x) { return x === fence.marker; }))) {
        code.push(lines[i]); i++;
      }
      i++; // consume closing fence (or EOF)
      blocks.push(el('pre', { 'class': 'md-pre' }, el('code', { 'class': 'md-code' }, code.join('\\n'))));
      continue;
    }

    var h = line.match(/^(#{1,6})\\s+(.*)$/);
    if (h) { blocks.push(el('h' + h[1].length, null, parseInline(h[2].trim()))); i++; continue; }

    if (isQuote(line)) {
      var quoted = [];
      while (i < lines.length && isQuote(lines[i])) { quoted.push(lines[i].replace(/^\\s*>\\s?/, '')); i++; }
      blocks.push(el('blockquote', null, parseBlocks(quoted.join('\\n'))));
      continue;
    }

    if (line.indexOf('|') !== -1 && i + 1 < lines.length && isDivider(lines[i + 1])) {
      var header = tableRow(line); i += 2;
      var rows = [];
      while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') { rows.push(tableRow(lines[i])); i++; }
      var thead = el('thead', null, el('tr', null, header.map(function (c) { return el('th', null, parseInline(c)); })));
      var tbody = el('tbody', null, rows.map(function (r) {
        return el('tr', null, r.map(function (c) { return el('td', null, parseInline(c)); }));
      }));
      blocks.push(el('table', null, [thead, tbody]));
      continue;
    }

    if (isHr(line)) { blocks.push(el('hr', { 'class': 'md-hr' })); i++; continue; }

    if (isUl(line) || isOl(line)) {
      var ordered = isOl(line), items = [];
      while (i < lines.length && (ordered ? isOl(lines[i]) : isUl(lines[i]))) {
        var m = lines[i].match(ordered ? /^(\\s*)(\\d+)\\.\\s+(.*)$/ : /^(\\s*)([-*+])\\s+(.*)$/);
        var parts = [m[3]]; i++;
        while (i < lines.length && lines[i].trim() !== '' && !isUl(lines[i]) && !isOl(lines[i]) &&
               !isHeading(lines[i]) && !isFenceLine(lines[i]) && !isQuote(lines[i]) && !isHr(lines[i])) {
          parts.push(lines[i].trim()); i++;
        }
        items.push(el('li', null, parseInline(parts.join(' '))));
      }
      blocks.push(el(ordered ? 'ol' : 'ul', null, items));
      continue;
    }

    var para = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(el('p', null, parseInline(para.join(' '))));
  }
  return blocks;
}

function render(text, target) {
  var div = el('div', { 'class': 'md-body' }, parseBlocks(typeof text === 'string' ? text : ''));
  if (target) {
    var t = typeof target === 'string' ? document.querySelector(target) : target;
    if (t) { t.innerHTML = ''; t.appendChild(div); }   // div content is built with createElement — safe
  }
  return div;
}

var CSS = '.md-body{line-height:1.6;color:var(--color-base-content,#e6e6e6);word-wrap:break-word;}' +
  '.md-body>:first-child{margin-top:0;}.md-body>:last-child{margin-bottom:0;}' +
  '.md-body h1,.md-body h2,.md-body h3,.md-body h4,.md-body h5,.md-body h6{font-weight:700;line-height:1.3;margin:1.8em 0 .6em;}' +
  '.md-body h1{font-size:1.7rem;padding-bottom:.3em;border-bottom:2px solid var(--color-base-300,#3a3a3a);margin-top:.2em;}' +
  '.md-body h2{font-size:1.32rem;padding-bottom:.25em;border-bottom:1px solid var(--color-base-300,#3a3a3a);}' +
  '.md-body h3{font-size:1.13rem;}.md-body h4{font-size:1rem;}.md-body h5{font-size:.9rem;}.md-body h6{font-size:.85rem;opacity:.7;}' +
  '.md-body p{margin:.85em 0;}.md-body ul,.md-body ol{margin:.7em 0;padding-left:1.7em;}' +
  '.md-body ul{list-style:disc;}.md-body ol{list-style:decimal;}.md-body li{margin:.32em 0;padding-left:.2em;}' +
  '.md-body a{color:var(--color-primary,#4f9eff);text-decoration:none;}.md-body a:hover{text-decoration:underline;}' +
  '.md-body strong{font-weight:700;}.md-body em{font-style:italic;}' +
  '.md-body .md-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em;background:var(--color-base-200,#1c1c1c);padding:.12em .42em;border-radius:4px;border:1px solid var(--color-base-300,#3a3a3a);}' +
  '.md-body .md-pre{background:var(--color-base-200,#1c1c1c);border:1px solid var(--color-base-300,#3a3a3a);border-radius:8px;padding:.9em 1.1em;overflow-x:auto;margin:1em 0;line-height:1.5;}' +
  '.md-body .md-pre .md-code{background:none;border:none;padding:0;font-size:.84rem;white-space:pre;}' +
  '.md-body blockquote{margin:1em 0;padding:.3em 1.1em;border-left:3px solid var(--color-primary,#4f9eff);background:var(--color-base-200,#1c1c1c);border-radius:0 6px 6px 0;opacity:.85;}' +
  '.md-body blockquote p{margin:.4em 0;}' +
  '.md-body table{border-collapse:collapse;margin:1em 0;width:100%;font-size:.9rem;display:block;overflow-x:auto;}' +
  '.md-body th,.md-body td{border:1px solid var(--color-base-300,#3a3a3a);padding:.45em .75em;text-align:left;vertical-align:top;}' +
  '.md-body th{background:var(--color-base-200,#1c1c1c);font-weight:600;}.md-body tbody tr:nth-child(even){background:var(--color-base-200,#1c1c1c);}' +
  '.md-body .md-img{max-width:100%;height:auto;border-radius:6px;margin:.6em 0;}' +
  '.md-body hr,.md-body .md-hr{border:none;border-top:1px solid var(--color-base-300,#3a3a3a);margin:1.6em 0;}';

function injectCss() {
  if (document.getElementById('aimeat-md-styles')) return;
  var s = document.createElement('style');
  s.id = 'aimeat-md-styles';
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}
injectCss();

global.AIMEAT = global.AIMEAT || {};
global.AIMEAT.md = { render: render, sanitizeHref: sanitizeHref, sanitizeImgSrc: sanitizeImgSrc };
})(window);
`;
}
