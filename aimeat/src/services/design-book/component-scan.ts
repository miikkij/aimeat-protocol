/**
 * @file src/services/design-book/component-scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading a proposed component's markup and stylesheet ONE CHARACTER AT A TIME.
 *
 *   A component is text a stranger sends. The first version of its bench (component.ts) read that
 *   text with regular expressions whose parts could each give way to the next: a tag pattern that
 *   restarted at every `<`, a comment pattern that restarted at every `/*`, an `animation … infinite`
 *   pattern that restarted at every "animation". On text built to never close what it opens, each
 *   of those scans the rest of the input from every start, which is quadratic. CodeQL reported
 *   three of them the day the kind shipped (js/polynomial-redos, alerts 1646 to 1648).
 *
 *   The answer is the one utils/html-blocks.ts gives for the publish checks: no pattern that can
 *   backtrack over the whole input. Every reader here walks the text once with an index, so its
 *   cost is the length of the text and nothing about its content changes that. The only regular
 *   expressions left are anchored at the start of a short slice this file has already cut.
 *
 *   UNCLOSED MEANS REFUSED, where a pattern used to mean "not matched". A `<` with no `>` is not
 *   skipped: `tagsOf` reports it, because skipping it is how markup gets past an allowlist.
 * @structure tagsOf · attributesOf · declarationsOf · selectorsOf · withoutComments · withoutVarFallbacks
 * @usage for (const tag of tagsOf(html)) { … }
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */

export interface Tag { closing: boolean; name: string; attrs: string }

/** Every tag in the markup, in order. `unclosed` is set when a `<` never meets its `>`. */
export function tagsOf(html: string): { tags: Tag[]; unclosed: boolean } {
  const tags: Tag[] = [];
  let at = html.indexOf('<');
  while (at !== -1) {
    // The tag ends at the first ">" OUTSIDE a quoted value, which is where a browser ends it.
    // Ending at the first ">" of any kind reads `<div title="x>" onclick="…">` as the tag
    // `div title="x` followed by text, and the handler the browser sees is never looked at.
    let end = -1;
    let quote = '';
    for (let i = at + 1; i < html.length; i++) {
      const ch = html[i];
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === '\'') quote = ch;
      else if (ch === '>') { end = i; break; }
    }
    if (end === -1) return { tags, unclosed: true };
    let inner = html.slice(at + 1, end).trim();
    const closing = inner.startsWith('/');
    if (closing) inner = inner.slice(1).trim();
    let n = 0;
    while (n < inner.length && /[\w:-]/.test(inner[n])) n++;
    tags.push({ closing, name: inner.slice(0, n).toLowerCase(), attrs: inner.slice(n) });
    at = html.indexOf('<', end + 1);
  }
  return { tags, unclosed: false };
}

const SPACE = new Set([' ', '\t', '\n', '\r', '\f', '/']);

/**
 * The attributes of one tag's text: name, and value with its quotes taken off (empty when bare).
 * `odd` marks an attribute a browser and this reader could disagree about: a quote or an angle
 * bracket in a name or in an unquoted value, or a quoted value that never closes. The bench
 * refuses those outright, because an allowlist is only as good as the agreement on where a tag ends.
 */
export function attributesOf(text: string): Array<{ key: string; value: string; odd: boolean }> {
  const out: Array<{ key: string; value: string; odd: boolean }> = [];
  const risky = (s: string) => s.includes('"') || s.includes('\'') || s.includes('`') || s.includes('<') || s.includes('>');
  let i = 0;
  const skipSpace = () => { while (i < text.length && SPACE.has(text[i])) i++; };
  while (i < text.length) {
    skipSpace();
    const start = i;
    while (i < text.length && !SPACE.has(text[i]) && text[i] !== '=') i++;
    const key = text.slice(start, i).toLowerCase();
    skipSpace();
    let value = '';
    let odd = risky(key);
    if (text[i] === '=') {
      i++;
      skipSpace();
      const quote = text[i] === '"' || text[i] === '\'' ? text[i] : '';
      if (quote) {
        const close = text.indexOf(quote, i + 1);
        if (close === -1) odd = true;
        value = text.slice(i + 1, close === -1 ? text.length : close);
        i = close === -1 ? text.length : close + 1;
        if (value.includes('<') || value.includes('>')) odd = true;
      } else {
        const from = i;
        while (i < text.length && !SPACE.has(text[i])) i++;
        value = text.slice(from, i);
        if (risky(value)) odd = true;
      }
    }
    if (key) out.push({ key, value, odd });
    else if (i === start) i++;   // a stray character: step over it, never loop on it
  }
  return out;
}

/** The stylesheet with its block comments blanked. An unclosed comment takes the rest, as a parser does. */
export function withoutComments(css: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = css.indexOf('/*', at);
    if (open === -1) return out + css.slice(at);
    out += css.slice(at, open) + ' ';
    const close = css.indexOf('*/', open + 2);
    if (close === -1) return out;
    at = close + 2;
  }
}

/** Every `property: value` of the stylesheet, as written, whatever rule it sits in. */
export function declarationsOf(css: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i <= css.length; i++) {
    const ch = css[i];
    if (i === css.length || ch === ';' || ch === '{' || ch === '}') {
      const piece = css.slice(from, i).trim();
      if (piece.includes(':')) out.push(piece);
      from = i + 1;
    }
  }
  return out;
}

/**
 * The selector of every style rule, with at-rules seen through (`@media`, `@supports`, `@container`,
 * `@layer` wrap rules that still count) and `@keyframes` skipped whole (its `from`, `to` and
 * percentages are steps, not selectors).
 */
export function selectorsOf(css: string): string[] {
  const out: string[] = [];
  const stack: Array<'rule' | 'at' | 'keyframes'> = [];
  let from = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const prelude = css.slice(from, i).trim();
      if (prelude.startsWith('@')) stack.push(/^@(?:-[a-z]+-)?keyframes\b/i.test(prelude) ? 'keyframes' : 'at');
      else {
        if (!stack.includes('keyframes')) out.push(prelude);
        stack.push('rule');
      }
      from = i + 1;
    } else if (ch === '}') {
      stack.pop();
      from = i + 1;
    } else if (ch === ';') {
      from = i + 1;
    }
  }
  return out;
}

/** The stylesheet with every `var(--x, fallback)` reduced to `var()`, parentheses matched by counting. */
export function withoutVarFallbacks(css: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = css.indexOf('var(', at);
    if (open === -1) return out + css.slice(at);
    out += css.slice(at, open) + 'var()';
    let depth = 1;
    let i = open + 4;
    while (i < css.length && depth > 0) {
      if (css[i] === '(') depth++;
      else if (css[i] === ')') depth--;
      i++;
    }
    at = i;
  }
}
