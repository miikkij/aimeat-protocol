/**
 * @file check-picture-words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps "door", "road", "way in", "machine room" and "showroom" out of the strings in
 *   code that a person or an AI reads, the way check:locales keeps them out of the language files.
 *
 *   WHY IT EXISTS. On 2026-11-15 the word "door" had become this codebase's name for an endpoint, a
 *   route, a button, a sign-in method and an MCP tool, and a reader could not tell which. The
 *   locale files were swept first and got their ratchets in check:locales; the same words were
 *   then found in about 270 strings outside them: error messages, config descriptions, handbooks,
 *   the component catalogue, the app-building prompts, the built-in skills and static pages. Those
 *   were rewritten, and this keeps a new one out.
 *
 *   WHAT IT READS. Only text, never code: string and template literals in `src/` and `public/`
 *   (through the TypeScript parser, so a comment is never read), and the visible text of the HTML
 *   pages in `public/`. An attribute or prop named `doors`, a CSS class such as `showroom-door`, an
 *   import path and an object key are code names and are skipped. What is left and still allowed
 *   (a real door in sample content, a picture caption, a component name a sentence explains, an old
 *   changelog entry) is in security/picture-words-baseline.json, one reason per entry.
 *
 *   A RATCHET. A new hit fails; an entry that no longer matches fails too, so the baseline only
 *   shrinks. An entry is keyed by its file, the word and a hash of the line's text, so it survives
 *   the file moving lines and goes stale when the sentence changes.
 * @structure
 *   - scan() — every hit: file, word, line text
 *   - main() — compare with the baseline; --list prints the current hits as baseline keys
 * @usage
 *   pnpm check:picture-words           (exit 1 on a new hit or a stale entry)
 *   pnpm check:picture-words --list    (every current hit with its key and text, always exit 0)
 * @version-history
 *   v1.1.0 — 2026-11-22 — The words the Settings and admin pages were rewritten away from (turned
 *     away and torjua for refused, the federation book, rung, welcome mat, the paste, the eleven
 *     moments, miehistö, naapuri, kylvää, tarjoilla and the like), so a prompt, a tool description
 *     or a skill cannot bring one back after the locale files lost it.
 *   v1.0.0 — 2026-11-15 — Initial, after the sweep of door, road, way in and showroom outside the
 *     locale files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BASELINE = path.join(ROOT, 'security', 'picture-words-baseline.json');

/**
 * The pictures, in English and in the Finnish and Spanish copies some files carry (a `.fi.html`
 * sibling, an i18n table). A hyphen or a letter on either side makes it a code name, not prose.
 */
const PICTURE = new RegExp('(?<![\\p{L}\\d_-])(' + [
  // 2026-11-15: the endpoint, route, button and sign-in called a door, a road or a room.
  String.raw`doors?|doorways?|roads?|ways? in|machine room|showroom|(?:sivu|etu|taka|pää)?ov(?:i|et|en|ea|elle|ella|elta|esta|essa|eksi|ia|ien|ille|illa|issa|ista)|puertas?`,
  // 2026-11-22: what the Settings and admin pages, their prompts and the tool texts called by a
  // picture: a refused request turned away, the federation directory a book, a peer's tier a rung,
  // the introduction page a welcome mat, a hook's event a moment, a CrewAI crew a miehistö.
  String.raw`turned away|federation book|rungs?|the paste|bird's-eye|thinks with|budget guards?|welcome mats?|heart morsels?|eleven moments`,
  String.raw`käännyt\p{L}*|torju\p{L}*|torjun\p{L}*|naapuri\p{L}*|kylv\p{L}*|uudelleenkylv\p{L}*|tarjoil\p{L}*|parkissa|parkkeer\p{L}*|julkisivu\p{L}*|pohjapiirro\p{L}*|federaatiokirja(?!utu)\p{L}*|\p{L}*miehistö\p{L}*|käyttökirjanpi\p{L}*|sydänmuru\p{L}*|tervetuloamat\p{L}*|noodi\p{L}*|applikaatio\p{L}*`,
  String.raw`tripulaci(?:ón|ones)|peldaños?|felpudos?|alfombra de bienvenida|morsels? de corazón`,
].join('|') + ')(?![\\p{L}\\d_-])', 'iu');
/** Code names that the word boundary alone does not catch: a `doors=` attribute, `${Doors}`, `.door`. */
const CODE_NAME = /(?:\b(?:doors?|Doors?)\s*=|\$\{Doors?\}|\.doors?\b|class(?:Name)?=)/;
const SKIP_DIR = /node_modules|[\\/]dist[\\/]|[\\/]public[\\/]lib[\\/]|[\\/]public[\\/]data[\\/]|facts\.generated|[\\/]generated[\\/]/;

export interface Hit { file: string; word: string; text: string; key: string }

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (SKIP_DIR.test(p)) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|js|mjs|html)$/.test(name) && !/\.min\.js$/.test(name)) yield p;
  }
}

function keyOf(file: string, word: string, text: string): string {
  const h = createHash('sha256').update(text.trim()).digest('hex').slice(0, 12);
  return `${file}::${word.toLowerCase()}::${h}`;
}

function linesOf(file: string, text: string, out: Hit[]): void {
  for (const line of text.split('\n')) {
    const m = line.match(PICTURE);
    if (!m || CODE_NAME.test(line)) continue;
    out.push({ file, word: m[1], text: line.trim(), key: keyOf(file, m[1], line) });
  }
}

/** Every hit in the visible text of the HTML pages and in the string literals of the code. */
export function scan(): Hit[] {
  const out: Hit[] = [];
  for (const base of ['src', 'public']) {
    for (const abs of walk(path.join(ROOT, base))) {
      const file = path.relative(ROOT, abs).replace(/\\/g, '/');
      const source = readFileSync(abs, 'utf8');
      if (abs.endsWith('.html')) {
        const blank = (s: string) => s.replace(/[^\n]/g, ' ');
        const visible = source.replace(/<!--[\s\S]*?-->/g, blank)
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, blank)
          .replace(/<[^>]*>/g, blank);
        linesOf(file, visible, out);
        continue;
      }
      const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true,
        abs.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
          || node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle
          || node.kind === ts.SyntaxKind.TemplateTail) {
          const p = node.parent;
          const isKey = !!p && ts.isPropertyAssignment(p) && p.name === node;
          const isImport = !!p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)
            || (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword));
          const str = (node as ts.LiteralLikeNode).text ?? '';
          if (!isKey && !isImport && /\s/.test(str)) linesOf(file, str, out);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return out;
}

function main(): void {
  const hits = scan();
  if (process.argv.includes('--list')) {
    for (const h of hits) console.log(`${h.key}\t${h.text.slice(0, 160)}`);
    console.log(`${hits.length} hit(s)`);
    return;
  }
  let baseline: Record<string, string> = {};
  try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string>; } catch { baseline = {}; }
  const current = new Map(hits.map(h => [h.key, h]));
  const fresh = [...current.values()].filter(h => !(h.key in baseline));
  const stale = Object.keys(baseline).filter(k => !current.has(k));
  if (!fresh.length && !stale.length) {
    console.log(`✓ no new picture word in code strings (${current.size} allowed use(s), each with its reason)`);
    return;
  }
  for (const h of fresh) {
    console.error(`✖ ${h.file}: "${h.word}" is a picture, not the thing's name\n      ${h.text.slice(0, 160)}\n      → name the thing: the endpoint, the route, the button, the link, sign-in, this option, a demo; a real use goes in security/picture-words-baseline.json as "${h.key}" with its reason`);
  }
  for (const k of stale) {
    console.error(`✖ baseline entry no longer matches: ${k}\n      → remove it from security/picture-words-baseline.json — the ratchet only tightens`);
  }
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
