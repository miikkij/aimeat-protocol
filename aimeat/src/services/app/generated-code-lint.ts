/**
 * @file src/services/app/generated-code-lint.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two publish checks for the faults that generated code makes most often, read from
 *   the bytes at publish:
 *
 *     key-in-page-source       an API key, token or private key in the page (REFUSES the publish)
 *     html-built-from-values   page code writes values it read into HTML and escapes nothing (warns)
 *
 *   WHY. Veracode's 2025 study of generated code found an insecure choice in 45% of 80 tasks and
 *   cross-site scripting failed in 86% of its cases, and it named an unstated security requirement
 *   as the cause. An app on this node is one HTML file that often renders records other people
 *   wrote, so markup built from those values is the hole, and a key pasted into the page is public
 *   the moment the page is.
 *
 *   A KEY REFUSES, ON THE PROOF GROUND. The published page is readable by every visitor, so a key in
 *   it is leaked when the publish succeeds; refusing before the write is the only point where the
 *   leak can still be stopped. The pattern is the content classification's `salaisuus` rule (one
 *   home, services/classification/defaults.ts), plus Stripe's secret and restricted keys, which use
 *   an underscore that rule does not read. A match whose body has fewer than six distinct
 *   characters is a placeholder (`sk-xxxxxxxx…`) and passes.
 *
 *   BUILT HTML WARNS, as every page-code check does (services/app/page-code-lint.ts): a page can
 *   build markup from its own constants or numbers and be right. It speaks only when three things
 *   hold together: the page writes a value that is not a plain string literal into innerHTML,
 *   outerHTML, insertAdjacentHTML or document.write; the page reads something from outside itself
 *   (AIMEAT.data, a fetch, a form field, the address, a message); and the page calls no escape
 *   function anywhere. That is the shape the study found, and a page that escapes in one place is
 *   left to its builder. Every scan uses indexOf or a bounded pattern (CodeQL js/polynomial-redos).
 * @structure secretFindings(html) · htmlSinkFindings(html) · generatedCodeFindings(html)
 * @usage blocking.push(...secretFindings(html)); warnings.push(...htmlSinkFindings(html));
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-publish-lint-checks-for-the-faults-of-generated-code).
 */
import type { AppArtifactFinding } from './artifact-lint.js';
import { DEFAULT_RULES } from '../classification/defaults.js';
import { elementBodies, withoutBlockComments } from '../../utils/html-blocks.js';

/** The classification rule's key pattern, read from its one home. */
const CLASSIFIED_SECRET = DEFAULT_RULES.find(r => r.id === 'salaisuus')?.pattern ?? '(?!)';
/** Stripe's secret and restricted keys: `sk_live_…`, `rk_test_…`. A publishable `pk_` key is public by design. */
const STRIPE_SECRET = '\\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}';

const MAX_LISTED = 3;

function finding(pitfall: string, severity: AppArtifactFinding['severity'], message: string): AppArtifactFinding {
  return { pitfall, severity, message, url: `/v1/appdev/pitfalls/${pitfall}` };
}

/** The line a character offset is on, 1-based. */
function lineAt(text: string, at: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/** True when the key's body is a placeholder: fewer than six distinct characters after its prefix. */
function isPlaceholder(match: string): boolean {
  const body = match.replace(/^(?:sk-(?:ant-|proj-)?|AKIA|gh[pousr]_|xox[baprs]-|[sr]k_(?:live|test)_)/, '');
  return new Set(body).size < 6;
}

/** A key, token or private key anywhere in the page's bytes, scripts and markup alike. */
export function secretFindings(html: string): AppArtifactFinding[] {
  const re = new RegExp(`${CLASSIFIED_SECRET}|${STRIPE_SECRET}`, 'g');
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (isPlaceholder(m[0])) continue;
    found.push(`line ${lineAt(html, m.index)}: \`${m[0].slice(0, 8)}…\``);
    if (found.length >= MAX_LISTED) break;
  }
  if (!found.length) return [];
  return [finding('key-in-page-source', 'critical',
    `This page carries what reads as an API key, a token or a private key (${found.join('; ')}). A published page is readable by `
    + 'every visitor, so the key would be public the moment the publish succeeds, and the publish is refused. Remove it from the page, '
    + 'store it as a secret (aimeat_secret_set, bound to the host it is for) and call it through an extension action that names '
    + '{{secret:NAME}}, so the key stays on the node. Revoke the key at its provider too: it has already left your machine in this file.')];
}

/** The inline scripts' code, block comments blanked. */
function inlineCode(html: string): string {
  return withoutBlockComments(elementBodies(html, 'script', attrs => !/\bsrc\s*=/i.test(attrs)).join('\n'));
}

/** The page reads something from outside itself: stored or shared data, the network, a form, the address, a message. */
const READS_OUTSIDE = /\bAIMEAT\.(?:data|org|organism|members|board|boards|workspace|files)\b|\bsession\.fetch\b|\bfetch\s*\(|\bURLSearchParams\b|\blocation\.(?:search|hash)\b|\.value\b|\blocalStorage\b|addEventListener\s*\(\s*['"]message['"]/;

/**
 * The page escapes somewhere: AIMEAT.escapeHtml, a helper of its own, a sanitizer, or a replace over
 * `<` or `&` (`s.replace(/[&<>"]/g, …)`, the shape two apps in the app repository use).
 */
const ESCAPES = /\b(?:escapeHtml|escapeHTML|escHtml|escHTML|esc|escape|htmlEscape|sanitize\w{0,20}|purify)\s*\(|\bDOMPurify\b|\.replace\(\s*\/[^/\n]{0,40}[<&][^/\n]{0,40}\/g/;

/** The sinks that parse a string as HTML. */
const SINKS: ReadonlyArray<{ token: string; name: string; value: 'assign' | 'second-arg' | 'call' }> = [
  { token: '.innerHTML', name: 'innerHTML', value: 'assign' },
  { token: '.outerHTML', name: 'outerHTML', value: 'assign' },
  { token: '.insertAdjacentHTML(', name: 'insertAdjacentHTML', value: 'second-arg' },
  { token: 'document.write(', name: 'document.write', value: 'call' },
  { token: 'document.writeln(', name: 'document.writeln', value: 'call' },
];

/**
 * Where the value written into a sink starts, or -1 when the token is a read (`x = el.innerHTML`,
 * `el.innerHTML === ''`).
 */
function valueStart(code: string, after: number, kind: 'assign' | 'second-arg' | 'call'): number {
  if (kind === 'call') return after;
  if (kind === 'second-arg') {
    const comma = code.indexOf(',', after);
    return comma === -1 || comma - after > 80 ? -1 : comma + 1;
  }
  let i = after;
  while (code[i] === ' ' || code[i] === '\t') i++;
  if (code[i] === '+' && code[i + 1] === '=') return i + 2;
  if (code[i] === '=' && code[i + 1] !== '=') return i + 1;
  return -1;
}

/** The written value: a whole template literal, or the rest of the statement, bounded. */
function valueAt(code: string, start: number): string {
  let i = start;
  while (code[i] === ' ' || code[i] === '\t' || code[i] === '\n' || code[i] === '\r') i++;
  if (code[i] === '`') {
    const close = code.indexOf('`', i + 1);
    return code.slice(i, close === -1 ? Math.min(code.length, i + 4000) : Math.min(close + 1, i + 4000));
  }
  let end = i;
  while (end < code.length && end - i < 400 && code[end] !== ';' && code[end] !== '\n') end++;
  return code.slice(i, end).trim();
}

/** The parts of a written value that are not fixed text: each `${…}` of a template, or the value with its string literals cut out. */
function dynamicParts(value: string): string[] {
  if (value.startsWith('`')) {
    const parts: string[] = [];
    for (let at = value.indexOf('${'); at !== -1; at = value.indexOf('${', at + 2)) {
      let depth = 1;
      let i = at + 2;
      while (i < value.length && depth > 0) { if (value[i] === '{') depth++; else if (value[i] === '}') depth--; i++; }
      parts.push(value.slice(at + 2, i - 1));
    }
    return parts;
  }
  return [value.replace(/'[^'\\\n]{0,400}'|"[^"\\\n]{0,400}"/g, ' ')];
}

/**
 * A part that reads a field of something: `n.title`, `row[i]`, `d.items.map(…)`. A bare name (a
 * constant, a string built earlier), a name in capitals (a constant table), a translation call
 * (`t(…)`), a number or a length is left alone, and so is a field whose name says a library drew it
 * (`out.svg`, `r.icon`). Measured on the 263 pages of the app repository on 2026-11-26: without these
 * exceptions 26 pages warned and nearly none was a fault; with them, two, each a field read the
 * reader cannot tell from data (and the key check refused none). A bare name holding built markup is the case this check misses.
 */
const FIELD_READ = /(?<![\w$.])[A-Za-z_$][\w$]{0,40}(?:\s*\.\s*[A-Za-z_$][\w$]{0,40}|\s*\[)/g;
const SAFE_FIELD = /\.\s*(?:length|size|id|count|toFixed|toLocaleString|toString|valueOf|getTime|svg|SVG|icon)\b[^.]{0,40}$/;
const SAFE_CALL = /^\s*(?:t|T|tr|i18n|_|Number|Math\.\w+|String\(\s*\d)/;

function readsAField(part: string): boolean {
  if (SAFE_CALL.test(part)) return false;
  for (const m of part.matchAll(FIELD_READ)) {
    const rest = part.slice(m.index);
    const head = m[0].replace(/\s+/g, '');
    if (/^(?:Math|JSON|Number|Object|Array|Date|console|window|document|AIMEAT)[.[]/.test(head)) continue;
    if (/^[A-Z][A-Z0-9_]{1,40}[.[]/.test(head)) continue;
    if (SAFE_FIELD.test(rest.slice(0, rest.search(/[+,;)]|$/) === -1 ? rest.length : Math.max(rest.search(/[+,;)]|$/), m[0].length)))) continue;
    return true;
  }
  return false;
}

/** A value that writes a field of something it read into the markup. */
function isDynamic(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return dynamicParts(v).some(readsAField);
}

/** Markup built from values the page read, with nothing escaped anywhere on the page. */
export function htmlSinkFindings(html: string): AppArtifactFinding[] {
  const code = inlineCode(html);
  if (!code || ESCAPES.test(code) || !READS_OUTSIDE.test(code)) return [];
  const hits: string[] = [];
  for (const sink of SINKS) {
    for (let at = code.indexOf(sink.token); at !== -1 && hits.length < MAX_LISTED; at = code.indexOf(sink.token, at + 1)) {
      const start = valueStart(code, at + sink.token.length, sink.value);
      if (start === -1) continue;
      const value = valueAt(code, start);
      if (!isDynamic(value)) continue;
      hits.push(`${sink.name} ← \`${value.replace(/\s+/g, ' ').slice(0, 60)}\``);
    }
  }
  if (!hits.length) return [];
  return [finding('html-built-from-values', 'warn',
    `This page writes values into HTML (${hits.join('; ')}) and escapes nothing anywhere, while it reads data from outside itself. `
    + 'A value that holds markup, such as a record another member wrote or text from the address, then runs as part of the page '
    + '(cross-site scripting). Set text with textContent, build elements with createElement, or wrap every value in '
    + 'AIMEAT.escapeHtml(value) before it goes into a template.')];
}

/** Both checks, for the artifact lint: the refusals first, then the warnings. */
export function generatedCodeFindings(html: string): { blocking: AppArtifactFinding[]; warnings: AppArtifactFinding[] } {
  return { blocking: secretFindings(html), warnings: htmlSinkFindings(html) };
}
