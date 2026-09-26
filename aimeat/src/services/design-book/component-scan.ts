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
 *
 *   WHAT THE READER CANNOT READ CLEANLY IS ODD, AND ODD IS REFUSED. Every place where a browser
 *   and this reader could part ways is marked, never stepped over: an "=" where a browser expects
 *   a name, a tag whose name does not follow its "<" at once, a closing tag carrying anything. And
 *   the stylesheet is read as a browser's tokenizer reads it (`cssAsRead`), escapes resolved, and
 *   each selector is read to its end (`complexSelectorOf`), since its end is what a rule styles.
 * @structure tagsOf · attributesOf · cssAsRead · declarationsOf · selectorsOf · selectorListOf ·
 *   complexSelectorOf · withoutVarFallbacks
 * @usage for (const tag of tagsOf(html)) { … }
 * @version-history
 *   v1.2.1 — 2026-09-26 — attributesOf marks a value holding a character reference odd, `&amp;` apart
 *     (1a0a15eb7b20): a browser decodes it before the value is used, and the value was read as written.
 *   v1.2.0 — 2026-09-24 — selectorListOf and complexSelectorOf: a selector list split where a browser
 *     splits it, and each selector read to its end, compound by compound, with its combinators and
 *     the arguments of its pseudo-classes. The bench read only a selector's first class, and a rule
 *     styles what its last compound names.
 *   v1.1.0 — 2026-09-24 — The reader fails closed where it used to step over (1a0a15eb7b20). An
 *     attribute with no name was dropped, so `<div class="x" ="><script>…</script>">` read as a
 *     clean div while a browser took `="` for the name, ended the tag at the first ">" and ran the
 *     script. A closing tag's attributes were never read, and `</ div` was read as a tag where a
 *     browser has a comment. All three are odd now. The stylesheet is read with its escapes
 *     resolved and its comments found only where a browser finds them (e82c9f26d729): `u\rl(` is
 *     `url(` to a browser, and `content: "/*"` opens a string, not a comment.
 *   v1.0.0 — 2026-09-20 — Initial.
 */

/**
 * One tag. `odd` is set when a browser would not read it as the tag this reader does: its name does
 * not follow the "<" or "</" at once (a browser reads that as text, or as a comment that ends at the
 * first ">"), or a closing tag carries anything after its name (a browser reads it as attributes).
 */
export interface Tag { closing: boolean; name: string; attrs: string; odd: boolean }

const LETTER = /[a-zA-Z]/;

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
    // Nothing is trimmed off the front: a browser starts a tag only on a letter straight after
    // "<" or "</". `< div` is text to it and `</ div` a comment that ends at the first ">", quoted
    // or not, so whatever this reader would take for a quoted value there is markup to a browser.
    let inner = html.slice(at + 1, end);
    const closing = inner.startsWith('/');
    if (closing) inner = inner.slice(1);
    let odd = !LETTER.test(inner[0] ?? '');
    let n = 0;
    while (n < inner.length && /[\w:-]/.test(inner[n])) n++;
    const attrs = inner.slice(n);
    // A closing tag is its name and nothing else. A browser reads what follows the name as
    // attributes, "=" and quotes included, and never shows them to anyone, so nothing there is
    // needed and nothing there is checked: it is refused instead of skipped.
    if (closing && attrs.trim()) odd = true;
    tags.push({ closing, name: inner.slice(0, n).toLowerCase(), attrs, odd });
    at = html.indexOf('<', end + 1);
  }
  return { tags, unclosed: false };
}

/** What separates two attributes: HTML whitespace, and "/" (a browser starts the next attribute after it). */
const SPACE = new Set([' ', '\t', '\n', '\r', '\f', '/']);
/** What a browser skips around an "=": whitespace only. A "/" there is part of a name or a value. */
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

/**
 * The attributes of one tag's text: name, and value with its quotes taken off (empty when bare).
 * `odd` marks an attribute a browser and this reader could disagree about: a quote or an angle
 * bracket in a name or in an unquoted value, a quoted value that never closes, an "=" where a
 * browser expects a name (it reads the "=" and what follows as the NAME, quotes and all, and ends
 * the tag at the first ">"), or a character reference in a value. The bench refuses those
 * outright, because an allowlist is only as good as the agreement on where a tag ends and on what
 * a value says. Nothing is dropped: an attribute with no name is returned with `key: ''`, odd, so
 * the one who reads the list sees it.
 *
 * A VALUE IS RETURNED AS WRITTEN, and a browser decodes its character references before anything
 * uses it: `u&#114;l(` is `url(` to a browser. So a value holding any reference is odd, except
 * `&amp;`, which decodes to a plain "&" that nothing decodes again.
 */
export function attributesOf(text: string): Array<{ key: string; value: string; odd: boolean }> {
  const out: Array<{ key: string; value: string; odd: boolean }> = [];
  const risky = (s: string) => s.includes('"') || s.includes('\'') || s.includes('`') || s.includes('<') || s.includes('>');
  const decodes = (s: string) => s.replaceAll('&amp;', '').includes('&');
  let i = 0;
  const skip = (set: Set<string>) => { while (i < text.length && set.has(text[i])) i++; };
  while (i < text.length) {
    skip(SPACE);
    if (i >= text.length) break;
    const start = i;
    while (i < text.length && !SPACE.has(text[i]) && text[i] !== '=') i++;
    const key = text.slice(start, i).toLowerCase();
    skip(WHITESPACE);
    let value = '';
    let odd = !key || risky(key);
    if (text[i] === '=') {
      i++;
      skip(WHITESPACE);
      const quote = text[i] === '"' || text[i] === '\'' ? text[i] : '';
      if (quote) {
        const close = text.indexOf(quote, i + 1);
        if (close === -1) odd = true;
        value = text.slice(i + 1, close === -1 ? text.length : close);
        i = close === -1 ? text.length : close + 1;
        if (value.includes('<') || value.includes('>') || decodes(value)) odd = true;
      } else {
        const from = i;
        while (i < text.length && !WHITESPACE.has(text[i])) i++;
        value = text.slice(from, i);
        if (risky(value) || decodes(value)) odd = true;
      }
    }
    // An empty name is always an "=" (the loop above stops only at one or at a separator, and
    // separators were skipped), and the "=" branch always moves past it: no stray character is
    // stepped over, and the loop always advances.
    out.push({ key, value, odd });
  }
  return out;
}

const HEX = /[0-9a-fA-F]/;
const CSS_NEWLINE = new Set(['\n', '\r', '\f']);

/**
 * The stylesheet as a browser's tokenizer reads it, so that a check reads what the browser reads:
 *   - every escape is resolved to the character it stands for: `u\rl(` is `url(`, `\75 rl(` is
 *     `url(` (up to six hex digits and one whitespace after them), `f\ixed` is `fixed`;
 *   - a comment is blanked only where a browser has one: never inside a string (`content: "/*"`
 *     opens a string) and never behind a backslash (`\/*` is an escaped "/" and a "*"). An
 *     unclosed comment takes the rest, as a parser does;
 *   - a string ends at its quote or at a newline, as a browser ends it.
 * One pass with an index, like every reader here. What an escape turns into is never read again
 * as structure: an escaped quote does not open a string and an escaped "/*" does not open a comment.
 */
export function cssAsRead(css: string): string {
  let out = '';
  let quote = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '\\') {
      const next = css[i + 1];
      if (next === undefined) { out += '�'; i++; continue; }
      if (CSS_NEWLINE.has(next)) {
        // In a string a backslash before a newline joins the lines; outside one it escapes nothing.
        if (quote) i += next === '\r' && css[i + 2] === '\n' ? 3 : 2;
        else { out += ch; i++; }
        continue;
      }
      if (HEX.test(next)) {
        let j = i + 1;
        while (j < css.length && j < i + 7 && HEX.test(css[j])) j++;
        const cp = parseInt(css.slice(i + 1, j), 16);
        out += cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) ? '�' : String.fromCodePoint(cp);
        if (css[j] === '\r' && css[j + 1] === '\n') j += 2;
        else if (css[j] === ' ' || css[j] === '\t' || CSS_NEWLINE.has(css[j])) j++;
        i = j;
        continue;
      }
      out += next;
      i += 2;
      continue;
    }
    if (quote) {
      if (ch === quote || CSS_NEWLINE.has(ch)) quote = '';
      out += ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === '\'') { quote = ch; out += ch; i++; continue; }
    if (ch === '/' && css[i + 1] === '*') {
      out += ' ';
      const close = css.indexOf('*/', i + 2);
      if (close === -1) return out;
      i = close + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
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

/**
 * One compound selector as the check reads it: what is written on the element itself. A class
 * inside a pseudo-class's parentheses is a condition, not the element's own class, so it stays with
 * its pseudo-class and is never counted in `classes`.
 */
export interface Compound {
  classes: string[];
  /** Type names, lower-cased, `*` included. */
  types: string[];
  /** Pseudo-classes and pseudo-elements, lower-cased, each with its argument when it takes one. */
  pseudos: Array<{ name: string; element: boolean; arg: string | null }>;
  /** `&`, the parent rule's selector under CSS nesting. */
  nesting: boolean;
}

/**
 * A complex selector: compounds joined by combinators, `' '` (descendant), `'>'`, `'+'`, `'~'` or
 * `'||'`. `lead` is a combinator written before the first compound, which is what a relative
 * selector looks like (inside `:has()`, or a nested rule).
 */
export interface ComplexSelector { lead: string | null; compounds: Compound[]; combinators: string[] }

const IDENT_CHAR = /[\w\u0080-￿-]/;

/** Where the bracket opened at `at` closes, strings stepped over, or -1 when it never does. */
function closingOf(s: string, at: number, open: string, close: string): number {
  let depth = 0;
  let quote = '';
  for (let i = at; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === '\'') quote = ch;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** The entries of a selector list: split at the commas outside parentheses, brackets and strings. */
export function selectorListOf(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === '\'') quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) { out.push(text.slice(from, i)); from = i + 1; }
  }
  out.push(text.slice(from));
  return out.map(s => s.trim()).filter(Boolean);
}

/**
 * One complex selector read to its end, as a browser reads it, or null when it does not read as one
 * (a namespace bar, two compounds with nothing between them, a bracket that never closes). Null is a
 * refusal to the caller: what this reader cannot follow, the bench cannot vouch for. Meant for the
 * stylesheet as cssAsRead gives it, escapes resolved.
 */
export function complexSelectorOf(text: string): ComplexSelector | null {
  const s = text.trim();
  let i = 0;
  const identAt = (): string => { const from = i; while (i < s.length && IDENT_CHAR.test(s[i])) i++; return s.slice(from, i); };
  const spaceAt = (): boolean => { const from = i; while (i < s.length && /\s/.test(s[i])) i++; return i > from; };
  const combinatorAt = (): string | null => (s.startsWith('||', i) ? '||' : s[i] === '>' || s[i] === '+' || s[i] === '~' ? s[i] : null);
  const compoundAt = (): Compound | null => {
    const c: Compound = { classes: [], types: [], pseudos: [], nesting: false };
    const start = i;
    if (s[i] === '*') { c.types.push('*'); i++; } else if (IDENT_CHAR.test(s[i] ?? '')) c.types.push(identAt().toLowerCase());
    for (;;) {
      const ch = s[i];
      if (ch === '.' || ch === '#') {
        i++;
        const name = identAt();
        if (!name) return null;
        if (ch === '.') c.classes.push(name);
      } else if (ch === '&') {
        i++;
        c.nesting = true;
      } else if (ch === '[') {
        const close = closingOf(s, i, '[', ']');
        if (close < 0) return null;
        i = close + 1;
      } else if (ch === ':') {
        const element = s[i + 1] === ':';
        i += element ? 2 : 1;
        const name = identAt().toLowerCase();
        if (!name) return null;
        let arg: string | null = null;
        if (s[i] === '(') {
          const close = closingOf(s, i, '(', ')');
          if (close < 0) return null;
          arg = s.slice(i + 1, close);
          i = close + 1;
        }
        c.pseudos.push({ name, element, arg });
      } else break;
    }
    return i > start ? c : null;
  };

  const out: ComplexSelector = { lead: null, compounds: [], combinators: [] };
  const lead = combinatorAt();
  if (lead) { out.lead = lead; i += lead.length; spaceAt(); }
  for (;;) {
    const compound = compoundAt();
    if (!compound) return null;
    out.compounds.push(compound);
    const spaced = spaceAt();
    if (i >= s.length) return out;
    const combinator = combinatorAt();
    if (combinator) { out.combinators.push(combinator); i += combinator.length; spaceAt(); continue; }
    if (!spaced) return null;
    out.combinators.push(' ');
  }
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
