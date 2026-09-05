/**
 * @file living/text.js
 * @description THE EXPLANATION THAT CHANGES WITH THE STATE. The sentence under a chart is where
 *   a document earns its keep, and a sentence that was typed once is a sentence that will be
 *   wrong the first time somebody moves a slider. So the prose is a TEMPLATE over the same graph
 *   the numbers come from: "Lämpötila on {{ t }} °C, {{ if t > 30 }}liian kuuma{{ else }}hyvä
 *   {{ end }}" — and the words move when the number does, in the same recompute, with no second
 *   copy of the threshold sitting in a caption.
 *
 *   WHAT GOES IN THE BRACES IS A FORMULA, not just a name, so {{ round(t, 1) }} and
 *   {{ if state = "hot" }} work without a new syntax; the condition of an if is the ordinary
 *   expression language and nothing else.
 *
 *   A VALUE PRINTS AS A NUMBER, NOT AS A NUMBER AND A UNIT, because the author is writing a
 *   sentence and has already typed the °C after it. {{ t | unit }} is how you ask for both.
 *
 *   THE OUTPUT IS TEXT. Never HTML: a template is written by an AI and edited by a person, and
 *   the one thing that must not be possible is for either of them to put markup on the screen by
 *   accident. Whoever renders it sets textContent.
 * @structure parseTemplate(src) · renderTemplate(parts, scope) · symbolsOfTemplate(parts) · FORMATS
 * @usage
 *   import { parseTemplate, renderTemplate } from './text.js';
 *   const parts = parseTemplate('It is {{ t }} °C{{ if t > 30 }} — too hot{{ end }}.');
 *   renderTemplate(parts, scope);
 *   THE TEMPLATE ITSELF MAY BE A LANGUAGE MAP. One template per language, each written as its own
 *   sentence rather than as a translation of the other — { fi: "Lämpötila on {{ t | 1 }} °C",
 *   en: "It is {{ t | 1 }} °C" } — and the holes are the same nodes in both, which validate()
 *   checks by name so a sentence cannot go blank in one language and read in the other. Resolving
 *   which one is in force is i18n.js's; this file only ever sees the string that came back.
 * @version-history
 *   v0.4.0 — 2026-09-06 — The printers take the language as a last argument, for a `format` that
 *     asked for `locale: "auto"`. A template with no such format prints exactly as it did.
 *   v0.3.0 — 2026-09-05 — The words after the bar are format.js's now, not a second copy: the
 *     same vocabulary a node's `format` option takes, so {{ t | 1 }} in a sentence and
 *     "format": 1 on a figure print the same number. `plain` finally means what it said — it
 *     was in the documented list and fell through to the branch that prints the unit as well.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parse, symbolsOf } from './formula-parse.js';
import { evaluate, isError, isQuantity } from './formula-eval.js';
import { formatValue as printValue, FORMATS } from './format.js';
import { unitLabel } from './units.js';

/** @typedef {{ kind: 'text', text: string }} TextPart */
/** @typedef {{ kind: 'value', tree: any, format: string|null, source: string }} ValuePart */
/** @typedef {{ kind: 'if', tree: any, then: any[], other: any[], source: string }} IfPart */

/** The named ways a value is written out. A bare number after the bar is that many decimals. */
export { FORMATS };

/**
 * Write one value the way the template asked for — the SAME printer a node's `format` option
 * goes through, so a sentence and a figure reading the same node cannot disagree about it.
 * @param {any} value @param {string|null} format @param {string} [lang]
 * @returns {string}
 */
export function formatValue(value, format, lang) { return printValue(value, format, lang); }

/** One {{ … }} tag, split into its expression and its format. */
function splitTag(body) {
  const bar = body.lastIndexOf('|');
  if (bar < 0) return { expr: body.trim(), format: null };
  // A bar inside a text literal is not a format bar.
  const before = body.slice(0, bar);
  const quotes = (before.match(/"/g) || []).length + (before.match(/'/g) || []).length;
  if (quotes % 2 === 1) return { expr: body.trim(), format: null };
  return { expr: before.trim(), format: body.slice(bar + 1).trim() };
}

/**
 * Read a template into parts. Never throws; a bad tag comes back as { error }.
 * @param {string} src
 * @returns {Array<any>|{ error: string }}
 */
export function parseTemplate(src) {
  const text = String(src == null ? '' : src);
  const root = [];
  const stack = [{ parts: root, branch: null }];
  let i = 0;

  function push(part) { stack[stack.length - 1].parts.push(part); }

  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open < 0) { if (i < text.length) push({ kind: 'text', text: text.slice(i) }); break; }
    if (open > i) push({ kind: 'text', text: text.slice(i, open) });
    const close = text.indexOf('}}', open);
    if (close < 0) return { error: 'A tag opens with {{ and never closes.' };
    const body = text.slice(open + 2, close);
    i = close + 2;
    const trimmed = body.trim();
    const lower = trimmed.toLowerCase();

    if (lower === 'end') {
      if (stack.length === 1) return { error: 'An {{ end }} with no {{ if }} in front of it.' };
      stack.pop();
      continue;
    }
    if (lower === 'else') {
      const top = stack[stack.length - 1];
      if (!top.branch) return { error: 'An {{ else }} with no {{ if }} in front of it.' };
      top.parts = top.branch.other;
      continue;
    }
    if (lower.indexOf('if ') === 0) {
      const tree = parse(trimmed.slice(3));
      if (isError(tree)) return { error: 'The condition ' + trimmed.slice(3).trim() + ' has ' + tree.error + '.' };
      const part = { kind: 'if', tree: tree, then: [], other: [], source: trimmed.slice(3).trim() };
      push(part);
      stack.push({ parts: part.then, branch: part });
      continue;
    }
    const { expr, format } = splitTag(body);
    if (!expr) return { error: 'An empty {{ }} tag.' };
    const tree = parse(expr);
    if (isError(tree)) return { error: 'The tag ' + expr + ' has ' + tree.error + '.' };
    push({ kind: 'value', tree: tree, format: format, source: expr });
  }
  if (stack.length > 1) return { error: 'An {{ if }} that never reaches its {{ end }}.' };
  return root;
}

/**
 * Render parsed parts against a scope.
 * @param {Array<any>|{ error: string }} parts @param {{ get: (id: string) => any }} scope
 * @param {string} [lang]  the language, for a format that asked for `locale: "auto"`
 * @returns {string}
 */
export function renderTemplate(parts, scope, lang) {
  if (!Array.isArray(parts)) return parts && parts.error ? parts.error : '';
  let out = '';
  for (const part of parts) {
    if (part.kind === 'text') { out += part.text; continue; }
    if (part.kind === 'value') { out += formatValue(evaluate(part.tree, scope), part.format, lang); continue; }
    if (part.kind === 'if') {
      const v = evaluate(part.tree, scope);
      if (isError(v)) { out += v.error; continue; }
      const yes = typeof v === 'boolean' ? v
        : isQuantity(v) ? v.n !== 0
          : typeof v === 'number' ? v !== 0
            : typeof v === 'string' ? v !== ''
              : !!v;
      out += renderTemplate(yes ? part.then : part.other, scope, lang);
    }
  }
  return out;
}

/**
 * Every node id a template reads, in first-seen order — this is what the graph wires it to.
 * @param {Array<any>|{ error: string }} parts @param {string[]} [into]
 * @returns {string[]}
 */
export function symbolsOfTemplate(parts, into) {
  const out = into || [];
  if (!Array.isArray(parts)) return out;
  for (const part of parts) {
    if (part.kind === 'value' || part.kind === 'if') symbolsOf(part.tree, out);
    if (part.kind === 'if') { symbolsOfTemplate(part.then, out); symbolsOfTemplate(part.other, out); }
  }
  return out;
}

/** The unit a quantity carries, for a display that wants to print it beside the number. */
export function unitOfValue(value) { return isQuantity(value) ? unitLabel(value.u) : ''; }
