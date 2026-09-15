/**
 * @file build-everything.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds the "Everything in AIMEAT" page's data from docs/AIMEAT-Feature-List.md:
 *   the whole list, as it is, into public/data/everything.json (the groups, their leads, their
 *   tables with every row and column), public/data/everything-meta.json (the row count and
 *   version stamp), and complete Markdown and static HTML. The list is the source;
 *   the page never carries a hand-copied second version of it, and `--check` refuses a committed
 *   artefact that has fallen behind the file.
 *
 *   THE ROWS ARE NOT REWRITTEN. Each cell's inline markdown (bold, code, links) becomes the HTML
 *   the page shows, and nothing else changes: the row count is asserted against the source, so a
 *   parse that dropped a row fails the build rather than shipping a shorter list. The HTML is
 *   trusted because the source is a file in this repository, never a person's input.
 *
 *   THE STAMP IS READ, NEVER WRITTEN. "Node version X, checked against the code on D" is parsed
 *   from the list's own header line; if the line stops saying it, the stamp is absent and the page
 *   shows none, so the page cannot claim a version the list does not.
 * @usage
 *   pnpm build:everything            # write all four artefacts
 *   pnpm check:everything            # fail when the committed artefacts are stale
 * @structure inline · parse · main
 * @version-history
 *   v1.1.0 - 2026-09-15 - Generate complete Markdown and HTML with feature anchors alongside JSON.
 *   v1.0.1 — 2026-09-15 — plain() strips tags until none remain and decodes entities in one pass.
 *     The artefacts it writes are byte-identical; what changed is that `&amp;lt;` no longer decodes
 *     twice and a split tag cannot reassemble (CodeQL #1633, #1634).
 *   v1.0.0 — 2026-09-15 — Initial (TARGET-077).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..', '..', 'docs', 'AIMEAT-Feature-List.md');
const OUT_DIR = resolve(HERE, '..', 'public', 'data');
const OUT_FILE = join(OUT_DIR, 'everything.json');
const META_FILE = join(OUT_DIR, 'everything-meta.json');
const MD_FILE = join(OUT_DIR, 'everything.md');
const HTML_FILE = join(OUT_DIR, 'everything.html');
/** Where a relative link in the list points on the web: the repo's docs folder. */
const DOCS_URL = 'https://github.com/miikkij/aimeat-protocol/blob/main/docs/';

interface Group { n: number; title: string; slug: string; lead: string[]; columns: string[]; reach: number; rows: { slug: string; cells: string[]; plain: string }[] }
interface Everything { title: string; stamp: { version: string; date: string } | null; intro: string[]; groups: Group[]; outro: string; counts: { groups: number; rows: number } }

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A link target in the list, resolved: anchors stay, http stays, a relative file goes to GitHub. */
function href(target: string): string {
  if (/^(https?:)?\/\//.test(target) || target.startsWith('#') || target.startsWith('mailto:')) return target;
  if (target.startsWith('/')) return target;
  // `../openapi.yaml` sits one level above docs/.
  const clean = target.replace(/^\.\//, '');
  return clean.startsWith('../') ? DOCS_URL.replace(/docs\/$/, '') + clean.slice(3) : DOCS_URL + clean;
}

/** Inline markdown to HTML: bold, code, links; the [off] and [testnet] markers get their own class. */
export function inline(md: string): string {
  let s = escapeHtml(md);
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    const bare = code.trim();
    if (bare === '[off]' || bare === '[testnet]') return `<span class="ev-mark showroom-slab--sun">${bare.slice(1, -1)}</span>`;
    return `<code>${code}</code>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, target: string) => {
    const url = href(target.replace(/&amp;/g, '&'));
    const ext = /^https?:/.test(url) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${escapeHtml(url)}"${ext}>${text}</a>`;
  });
  return s;
}

/**
 * A rendered cell as text, for the page's search and for reading the version stamp. It is never put
 * back into HTML (views/everything.js only lowercases it and tests `includes`), but the decoder is
 * written correctly regardless, because a wrong one is wrong wherever its output lands and CodeQL
 * cannot see where that is (#1633, #1634):
 *   - tags are stripped until none are left, so a fragment like `<scr<b>ipt>` cannot reassemble
 *     into a tag after the inner one is removed;
 *   - the four entities are decoded in ONE pass, so `&amp;lt;` becomes the text `&lt;`. Decoding
 *     `&amp;` first and `&lt;` after it turned that into `<`, a second round of unescaping the
 *     source never asked for.
 */
const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
function plain(html: string): string {
  let s = html;
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/<[^>]*>/g, ''); }
  return s.replace(/&(?:amp|lt|gt|quot);/g, (entity) => ENTITY[entity]);
}

/** A table line into its cells; a cell may hold `|` inside backticks, which is not a boundary. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inCode = false;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (const ch of body) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parse(md: string): Everything {
  const lines = md.split(/\r?\n/);
  const out: Everything = { title: '', stamp: null, intro: [], groups: [], outro: '', counts: { groups: 0, rows: 0 } };
  let group: Group | null = null;
  let mode: 'head' | 'contents' | 'group' = 'head';
  let para: string[] = [];
  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(' ');
    if (mode === 'head') out.intro.push(inline(text));
    else if (mode === 'group' && group) group.lead.push(inline(text));
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^# /.test(line)) { out.title = line.replace(/^# /, '').trim(); i++; continue; }
    const h2 = line.match(/^## (?:(\d+)\.\s+)?(.+)$/);
    if (h2) {
      flushPara();
      if (h2[2].trim() === 'Contents') { mode = 'contents'; group = null; i++; continue; }
      const n = Number(h2[1]);
      group = { n, title: h2[2].trim(), slug: `g-${n}`, lead: [], columns: [], reach: -1, rows: [] };
      out.groups.push(group);
      mode = 'group';
      i++;
      continue;
    }
    if (mode === 'contents') { i++; continue; }
    if (/^---\s*$/.test(line)) { flushPara(); i++; continue; }
    if (/^\s*\|/.test(line) && group) {
      flushPara();
      const header = cells(line);
      const sep = lines[i + 1] || '';
      if (!/^\s*\|?\s*:?-+/.test(sep)) throw new Error(`table without a separator row at line ${i + 1}`);
      group.columns = header;
      group.reach = header.findIndex((c) => /^(reach|where)$/i.test(c.trim()));
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const row = cells(lines[i]);
        if (row.length !== header.length) throw new Error(`row with ${row.length} cells under ${header.length} columns at line ${i + 1}: ${lines[i].slice(0, 80)}`);
        const html = row.map(inline);
        const label = plain(inline(row[0].replace(/`\[(off|testnet)\]`/g, '')));
        const slug = `${group.slug}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
        if (group.rows.some((r) => r.slug === slug)) throw new Error(`duplicate feature anchor: ${slug}`);
        group.rows.push({ slug, cells: html, plain: html.map(plain).join(' ') });
        i++;
      }
      continue;
    }
    if (line.trim() === '') { flushPara(); i++; continue; }
    if (/^\*.*\*$/.test(line.trim()) && mode === 'group' && group && i > lines.length - 4) {
      // The closing italic line after the last table: the list's own sign-off.
      flushPara();
      out.outro = inline(line.trim().replace(/^\*|\*$/g, ''));
      i++;
      continue;
    }
    if (/^- /.test(line)) { flushPara(); para.push(line); flushPara(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flushPara();
  const stampLine = out.intro.map(plain).find((p) => /Node version/.test(p)) || '';
  const m = stampLine.match(/Node version ([0-9][0-9a-z.-]*), checked against the code on (\d{4}-\d{2}-\d{2})/);
  out.stamp = m ? { version: m[1], date: m[2] } : null;
  out.counts = { groups: out.groups.length, rows: out.groups.reduce((s, g) => s + g.rows.length, 0) };
  return out;
}

/** The Markdown source with web links and the same anchors as the interactive page. */
export function renderMarkdown(md: string, parsed: Everything): string {
  let group: Group | undefined;
  let row = 0;
  return md.split(/\r?\n/).map((line) => {
    const heading = line.match(/^## (\d+)\./);
    if (heading) {
      group = parsed.groups.find((g) => g.n === Number(heading[1]));
      row = 0;
      return `<a id="${group!.slug}"></a>\n\n${line}`;
    }
    let result = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, target: string) => {
      const section = target.match(/^#(\d+)-/);
      return `[${label}](${section ? '#g-' + section[1] : href(target)})`;
    });
    if (group && /^\|\s*\*\*/.test(line)) {
      result = result.replace(/^\|\s*/, `| <a id="${group.rows[row++].slug}"></a> `);
    }
    return result;
  }).join('\n').trimEnd() + '\n';
}

/** Static, escaped content generated at build time, used by the existing public-page shell. */
export function renderHtml(parsed: Everything): string {
  return [
    '<div class="ev-static">',
    ...parsed.intro.map((p) => `<p>${p}</p>`),
    '<nav aria-label="Contents"><ol>',
    ...parsed.groups.map((g) => `<li><a href="#${g.slug}">${escapeHtml(g.title)}</a></li>`),
    '</ol></nav>',
    ...parsed.groups.map((g) => [
      `<section id="${g.slug}"><h2>${g.n}. ${escapeHtml(g.title)}</h2>`,
      ...g.lead.map((p) => `<p>${p}</p>`),
      '<table><thead><tr>',
      ...g.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`),
      '</tr></thead><tbody>',
      ...g.rows.map((r) => `<tr id="${r.slug}">${r.cells.map((c) => `<td>${c}</td>`).join('')}</tr>`),
      '</tbody></table></section>',
    ].join('\n')),
    `<p>${parsed.outro}</p>`,
    '</div>',
  ].join('\n') + '\n';
}

function render(): { data: string; meta: string; markdown: string; html: string; counts: Everything['counts']; stamp: Everything['stamp'] } {
  const md = readFileSync(SOURCE, 'utf-8');
  const parsed = parse(md);
  // The count in the source: every table row that is not a header or a separator, outside Contents.
  let expected = 0;
  let inContents = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^## /.test(line)) inContents = /^## Contents/.test(line);
    if (inContents) continue;
    if (/^\s*\|/.test(line) && !/^\s*\|?\s*:?-+/.test(line) && !/^\|\s*(Feature|Standard|Project|Was)\s*\|/.test(line)) expected++;
  }
  if (parsed.counts.rows !== expected) throw new Error(`parsed ${parsed.counts.rows} rows, the source has ${expected}: a row was dropped`);
  if (parsed.groups.some((g) => g.rows.length === 0)) throw new Error('a group parsed with no rows');
  const meta = { rows: parsed.counts.rows, groups: parsed.counts.groups, version: parsed.stamp?.version ?? null, date: parsed.stamp?.date ?? null };
  return { data: JSON.stringify(parsed, null, 1) + '\n', meta: JSON.stringify(meta, null, 1) + '\n', markdown: renderMarkdown(md, parsed), html: renderHtml(parsed), counts: parsed.counts, stamp: parsed.stamp };
}

function main(): void {
  const check = process.argv.includes('--check');
  const built = render();
  const artifacts = [[OUT_FILE, built.data], [META_FILE, built.meta], [MD_FILE, built.markdown], [HTML_FILE, built.html]] as const;
  if (check) {
    let stale = false;
    for (const [file, content] of artifacts) {
      let onDisk: string;
      try { onDisk = readFileSync(file, 'utf-8'); } catch { onDisk = ''; }
      if (onDisk !== content) { console.error(`✖ ${file} is behind docs/AIMEAT-Feature-List.md. Run: pnpm build:everything`); stale = true; }
    }
    if (stale) process.exit(1);
    console.log(`✓ everything.json current: ${built.counts.groups} groups, ${built.counts.rows} rows, ${built.stamp ? `node ${built.stamp.version} (${built.stamp.date})` : 'no version stamp'}`);
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, content] of artifacts) writeFileSync(file, content, 'utf-8');
  console.log(`Wrote JSON, metadata, Markdown and HTML: ${built.counts.groups} groups, ${built.counts.rows} rows, ${built.stamp ? `node ${built.stamp.version} (${built.stamp.date})` : 'no version stamp'}`);
}

main();
