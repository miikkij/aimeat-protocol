/**
 * @file scripts/check-docs.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Check documentation coverage, local links, asset syntax and package help parity.
 * @structure Git file inventory, catalog validation, links and data syntax, duplicate check.
 * @usage pnpm check:docs
 * @version-history
 *   v1.0.0 - 2026-09-16 - Track both documentation trees and distinguish history from guidance.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const errors = [];
const statuses = new Set(['maintained', 'runtime', 'reference', 'historical', 'entry']);
const files = [...new Set(execFileSync('git', [
  'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs', 'aimeat/docs',
], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean))]
  .filter(path => existsSync(resolve(ROOT, path))).sort();
const catalog = new Map();
for (const line of read('docs/catalog.md').split('\n')) {
  const match = line.match(/^\| \[([^\]]+)\]\([^)]+\) \| ([^|]+) \| [^|]+ \| `([^`]+)` \|$/);
  if (!match) continue;
  const [, path, rawStatus, source] = match;
  const status = rawStatus.trim();
  if (catalog.has(path)) errors.push(`Duplicate catalog entry: ${path}`);
  if (!statuses.has(status)) errors.push(`Unknown status for ${path}: ${status}`);
  if (!existsSync(resolve(ROOT, source))) errors.push(`Missing source for ${path}: ${source}`);
  catalog.set(path, status);
}
for (const path of files) if (!catalog.has(path)) errors.push(`Unclassified file: ${path}`);
for (const path of catalog.keys()) if (!files.includes(path)) errors.push(`Catalog names absent file: ${path}`);

// Fenced examples can contain Markdown-shaped regexes and hypothetical paths.
function withoutFences(content) {
  let fence = null;
  return content.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

for (const path of files) {
  const content = read(path);
  if (path.endsWith('.json')) {
    try { JSON.parse(content); } catch (error) { errors.push(`${path}: ${error.message}`); }
  }
  if (/\.ya?ml$/.test(path)) {
    for (const error of parseDocument(content).errors) errors.push(`${path}: ${error.message}`);
  }
  if (!path.endsWith('.md')) continue;
  if (path.startsWith('docs/archive/') && path !== 'docs/archive/README.md' &&
      !content.includes('> Historical document.')) errors.push(`Archive notice missing: ${path}`);
  // Historical links are part of the evidence and may refer to removed source files.
  if (catalog.get(path) === 'historical') continue;
  for (const match of withoutFences(content).matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let target = match[1].split(/\s+"/)[0].replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.includes('{{')) continue;
    // Root paths without a tracked documentation prefix are routes on the target node.
    if (target.startsWith('/') && !/^\/(?:docs|aimeat)\//.test(target)) continue;
    target = target.split(/[?#]/)[0];
    if (!target) continue;
    try { target = decodeURIComponent(target); } catch { errors.push(`${path}: malformed link ${target}`); continue; }
    const destination = target.startsWith('/') ? resolve(ROOT, target.slice(1)) : resolve(ROOT, dirname(path), target);
    const rel = relative(ROOT, destination);
    if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(destination)) errors.push(`${path}: missing local link ${target}`);
  }
}

if (read('docs/AIMEAT_Help_Prompt.md') !== read('aimeat/docs/AIMEAT_Help_Prompt.md')) {
  errors.push('Help prompt differs between docs/ and aimeat/docs/. Update both copies together.');
}
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`Documentation check failed: ${errors.length} problem(s).`);
  process.exitCode = 1;
} else {
  const counts = [...statuses].map(status => `${status}: ${[...catalog.values()].filter(s => s === status).length}`);
  console.log(`Documentation structure checked: ${files.length} files (${counts.join(', ')}).`);
}
