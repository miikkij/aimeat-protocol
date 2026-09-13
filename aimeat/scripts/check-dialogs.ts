/**
 * @file check-dialogs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The site has one dialog: public/css/dialog.css for the look, public/js/dialog.js for
 *   the closing rules, components/Modal.js for the SPA and src/static/app-catalog/js/dialogs.js for
 *   the catalog. Until 2026-09-13 the SPA and the catalog carried more than twenty hand-rolled
 *   overlays, each with its own frame, X, width, phone behaviour and way of scrolling, and every
 *   overflow fix had to be made again in each. This gate refuses a new one.
 *   What a hand-rolled dialog looks like, and what is refused in the SPA (public/views, components,
 *   js, css) and in the app catalog (src/static/app-catalog): a stylesheet rule whose selector names
 *   an overlay, backdrop or modal and sets position: fixed; a ::backdrop styled outside dialog.css;
 *   a .showModal() call; role="dialog" or aria-modal; a <dialog> without the dlg class. Comments are
 *   read past. The four files above are where these belong, and ALLOWED names the few that are
 *   something else with a reason each; an entry there is a decision, not a way around the gate.
 * @structure dialogFindings(file, source) → string[] · main() walks the two trees
 * @usage pnpm check:dialogs
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (wish "Yksi dialogikomponentti kaikille dialogeille").
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where a dialog is made. Everything these files do is the component itself. */
const HOMES = new Set([
  'public/css/dialog.css',
  'public/js/dialog.js',
  'public/components/Modal.js',
  'src/static/app-catalog/js/dialogs.js',
]);

/** Files that match a shape and are not a dialog, each with what it is instead. */
const ALLOWED: Record<string, string> = {
  'public/css/components/app-sandbox.css':
    'The full-screen viewer for a published app (/js/app-sandbox.js): a page layer with its own toolbar that the person leaves by its X, not a question over the page.',
};

const SCAN = [
  { dir: 'public/views', ext: ['.js', '.css'] },
  { dir: 'public/components', ext: ['.js', '.css'] },
  { dir: 'public/js', ext: ['.js'] },
  { dir: 'public/css', ext: ['.css'] },
  { dir: 'src/static/app-catalog', ext: ['.js', '.css', '.html'] },
];

function stripCss(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Block and HTML comments go; a line comment goes only where `//` does not follow a colon or a quote (a URL). */
function stripScript(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** The hand-rolled dialog shapes in one file, as readable lines. Pure: a path and its text in, findings out. */
export function dialogFindings(file: string, source: string): string[] {
  const found: string[] = [];
  if (file.endsWith('.css')) {
    const css = stripCss(source);
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = block[1].trim().replace(/\s+/g, ' ');
      if (/::backdrop/.test(selector)) found.push(`${file}: a dialog backdrop styled here (${selector}); it is dialog.css's`);
      else if (/[.#][\w-]*(overlay|backdrop|modal)[\w-]*/i.test(selector) && /(^|;)\s*position\s*:\s*fixed/i.test(block[2])) {
        found.push(`${file}: a fixed overlay (${selector}); open the dialog component instead`);
      }
    }
    return found;
  }
  const code = stripScript(source);
  if (/\.showModal\s*\(/.test(code)) found.push(`${file}: calls showModal() on a <dialog> of its own`);
  if (/role\s*[=:]\s*\\?["'`]dialog\\?["'`]/.test(code)) found.push(`${file}: declares role="dialog" on a box of its own`);
  if (/aria-modal/.test(code)) found.push(`${file}: declares aria-modal on a box of its own`);
  for (const tag of code.matchAll(/<dialog\b([^>]*)>/g)) {
    const cls = /class\s*=\s*["'`]([^"'`]*)["'`]/.exec(tag[1]);
    if (!cls || !/(^|\s)dlg(\s|$)/.test(cls[1])) found.push(`${file}: a <dialog> without the dlg class`);
  }
  if (/createElement\(\s*["'`]dialog["'`]\s*\)/.test(code) && !/className\s*=\s*["'`]dlg(\s|["'`])/.test(code)) {
    found.push(`${file}: builds a <dialog> without the dlg class`);
  }
  return found;
}

function walk(dir: string, ext: string[], out: string[]): void {
  const abs = path.join(ROOT, dir);
  for (const name of readdirSync(abs).sort()) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, ext, out);
    else if (ext.some((e) => name.endsWith(e))) out.push(rel);
  }
}

function main(): void {
  const files = new Set<string>();
  for (const { dir, ext } of SCAN) {
    const list: string[] = [];
    walk(dir, ext, list);
    list.forEach((f) => files.add(f));
  }
  const findings: string[] = [];
  let allowedHits = 0;
  for (const file of files) {
    if (HOMES.has(file)) continue;
    const hits = dialogFindings(file, readFileSync(path.join(ROOT, file), 'utf8'));
    if (!hits.length) continue;
    if (ALLOWED[file]) { allowedHits += hits.length; continue; }
    findings.push(...hits);
  }
  for (const [file, reason] of Object.entries(ALLOWED)) {
    if (!reason.trim()) findings.push(`${file}: an ALLOWED entry without a reason`);
  }
  console.log(`Dialogs: ${files.size} files read; ${findings.length} hand-rolled, ${allowedHits} in ${Object.keys(ALLOWED).length} allowed file(s).`);
  if (findings.length) {
    for (const line of findings) console.error(line);
    console.error('Use the one dialog: <Modal> from /components/Modal.js in the SPA, a <dialog class="dlg"> opened with openDlg() in the app catalog.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
