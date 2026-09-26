/**
 * @file src/services/design-book/component-scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading a proposed component's markup and stylesheet the way a browser reads them.
 *
 *   THE MARKUP IS READ BY THE HTML PARSER ITSELF: parse5, the parsing algorithm of the WHATWG HTML
 *   standard, which is what a browser runs (`readMarkup`). The checks get the elements it builds,
 *   each attribute value DECODED as a browser decodes it, and the first thing that keeps the bench
 *   from vouching for the markup: a parse error, a comment, or a "<" that starts no tag the parser
 *   built. WHAT THE PARSER CANNOT READ CLEANLY IS REFUSED, because an allowlist is only as good as
 *   the agreement on what the markup holds, and the parser's reading is the one a browser follows.
 *   Its cost grows with how deep the markup nests, so the bench hands it no more than its ceiling
 *   (COMPONENT_LIMITS in component.ts).
 *
 *   THE STYLESHEET IS READ ONE CHARACTER AT A TIME. The first version of the bench read the text
 *   with regular expressions whose parts could each give way to the next, and on text built to never
 *   close what it opens each of those scanned the rest of the input from every start, which is
 *   quadratic (CodeQL js/polynomial-redos, alerts 1646 to 1648). Every stylesheet reader here walks
 *   the text once with an index, as utils/html-blocks.ts does for the publish checks. The stylesheet
 *   is read as a browser's tokenizer reads it (`cssAsRead`), escapes resolved, and each selector is
 *   read to its end (`complexSelectorOf`), since its end is what a rule styles. UNCLOSED MEANS
 *   REFUSED, where a pattern used to mean "not matched".
 * @structure readMarkup · cssAsRead · declarationsOf · selectorsOf · selectorListOf · complexSelectorOf ·
 *   withoutVarFallbacks
 * @usage const { elements, problem } = readMarkup(html);
 * @version-history
 *   v1.4.0 — 2026-09-26 — The markup is read by the WHATWG HTML parser, parse5 (readMarkup, in place
 *     of tagsOf and attributesOf), in the context the preview gives it, the inside of a <div>. The
 *     checks read the elements it builds and every attribute value decoded as a browser decodes it,
 *     character references of every spelling included, so a plain value may hold one. A parse error,
 *     a comment, and a "<" that starts no tag the parser built are refused (1a0a15eb7b20).
 *   v1.3.0 — 2026-09-26 — What an escape stands for is never read as structure, nor what a string
 *     holds (e82c9f26d729). cssAsRead writes an escape that stands for anything but a name character
 *     as "_", and selectorsOf, declarationsOf, selectorListOf and closingOf step over strings with
 *     one reader (stringEnd), ending a string where a browser ends it. `p, .wkgrid\;.wkgrid` read as
 *     `.wkgrid` alone, and a "{" in a string kept selectorsOf inside @keyframes, so a rule after it
 *     that styled the page was never checked.
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
import { defaultTreeAdapter, html as HTML, parseFragment, type DefaultTreeAdapterTypes, type ParserError } from 'parse5';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Template = DefaultTreeAdapterTypes.Template;

/** One element as the HTML parser built it. */
export interface MarkupElement {
  /** The tag name, lower-cased as the allowlist spells it: an SVG `linearGradient` is `lineargradient`. */
  name: string;
  /**
   * Each attribute with its qualified name lower-cased (`xlink:href` keeps its prefix), and its value
   * DECODED, as a browser uses it: `u&#114;l(` comes out as `url(`, `A &ndash; B` as `A – B`.
   */
  attrs: Array<{ name: string; value: string }>;
}

/** Why the markup cannot be vouched for, with what a message needs to say where. */
export type MarkupProblem =
  | { kind: 'comment' }
  /** A tag that never meets its ">". */
  | { kind: 'unclosed' }
  /** An "=" where a browser expects an attribute's name. */
  | { kind: 'equals'; element: string }
  /** A closing tag carrying anything after its name; `rest` is what follows the name. */
  | { kind: 'closing'; element: string; rest: string }
  /** A "<" with no tag name straight after it, or after "</". */
  | { kind: 'tag-start' }
  /** A quote or an angle bracket in a name or a bare value, a missing value, a repeated name. */
  | { kind: 'attribute'; element: string; attribute: string }
  /** Any other place the parser reports the markup as not well formed, by its WHATWG error code. */
  | { kind: 'unclean'; code: string; at: number }
  /** A "<" the parser read as no tag: text inside <textarea> or <title>, or a tag HTML drops there. */
  | { kind: 'stray'; at: number };

/** The parse error codes that say where a tag ends, what starts one and what an attribute holds. */
const UNCLOSED_CODES = new Set(['eof-in-tag', 'eof-before-tag-name']);
const TAG_START_CODES = new Set([
  'invalid-first-character-of-tag-name', 'unexpected-question-mark-instead-of-tag-name', 'missing-end-tag-name',
  'incorrectly-opened-comment', 'cdata-in-html-content',
]);
const ATTRIBUTE_CODES = new Set([
  'unexpected-character-in-attribute-name', 'unexpected-character-in-unquoted-attribute-value', 'missing-attribute-value',
  'missing-whitespace-between-attributes', 'unexpected-solidus-in-tag', 'duplicate-attribute',
]);

/**
 * The context the markup is parsed in: the inside of a <div>, where the preview puts it. A fragment
 * parsed with no context is parsed as the inside of a <template>, where a lone <td> is a cell; in a
 * page it is dropped.
 */
const CONTEXT = defaultTreeAdapter.createElement('div', HTML.NS.HTML, []);

/** A start or end tag the parser read, by where it stands in the text. */
interface TagSpan { start: number; end: number; name: string; closing: boolean; attrs: Record<string, { startOffset: number }> }

/**
 * The markup as the WHATWG HTML parser reads it (parse5, the parser the specification describes),
 * with every element it built and the first thing that keeps the bench from vouching for it:
 *   - a comment, which says nothing a component needs;
 *   - a parse error, the parser's own word that a browser has to mend the markup its own way;
 *   - a "<" that is the start of no tag the parser built. The parser drops some tags where they
 *     stand (a <td> outside a row, an <html> inside a page, a <div> inside <select>) and reads
 *     others as text (inside <textarea> or <title>). Such a "<" is a tag to a browser that reads the
 *     text in another place, so every "<" has to be one of the tags the checks see.
 * Elements come in document order, the contents of a <template> included. The walk is a loop, not
 * a recursion, since a nesting depth is whatever the text says.
 */
export function readMarkup(html: string): { elements: MarkupElement[]; problem: MarkupProblem | null } {
  const errors: ParserError[] = [];
  const fragment = parseFragment(CONTEXT, html, { sourceCodeLocationInfo: true, onParseError: e => errors.push(e) });
  const elements: MarkupElement[] = [];
  const spans: TagSpan[] = [];
  let comment = false;
  const stack: ChildNode[] = [...fragment.childNodes].reverse();
  while (stack.length) {
    const node = stack.pop() as ChildNode;
    if (node.nodeName === '#comment') comment = true;
    if (!('tagName' in node)) continue;
    const loc = node.sourceCodeLocation;
    const attrLocs = loc?.attrs ?? {};
    if (loc?.startTag) spans.push({ start: loc.startTag.startOffset, end: loc.startTag.endOffset, name: node.tagName, closing: false, attrs: attrLocs });
    if (loc?.endTag) spans.push({ start: loc.endTag.startOffset, end: loc.endTag.endOffset, name: node.tagName, closing: true, attrs: {} });
    elements.push({
      name: node.tagName.toLowerCase(),
      attrs: node.attrs.map(a => ({ name: (a.prefix ? `${a.prefix}:${a.name}` : a.name).toLowerCase(), value: a.value })),
    });
    const children = node.tagName === 'template' ? (node as Template).content.childNodes : node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  spans.sort((a, b) => a.start - b.start);
  const spanAt = (at: number): TagSpan | undefined => spans.find(s => s.start <= at && at < s.end);

  if (html.includes('<!--')) return { elements, problem: { kind: 'comment' } };
  const first = errors.sort((a, b) => a.startOffset - b.startOffset)[0];
  if (first) {
    const span = spanAt(first.startOffset);
    if (span?.closing) return { elements, problem: { kind: 'closing', element: span.name, rest: html.slice(span.start + 2 + span.name.length, span.end - 1) } };
    if (first.code === 'unexpected-equals-sign-before-attribute-name') return { elements, problem: { kind: 'equals', element: span?.name ?? '' } };
    if (UNCLOSED_CODES.has(first.code)) return { elements, problem: { kind: 'unclosed' } };
    if (TAG_START_CODES.has(first.code)) return { elements, problem: { kind: 'tag-start' } };
    if (ATTRIBUTE_CODES.has(first.code) && span) {
      // The attribute the error sits in, or nearest before it: parse5 gives each one's place.
      let attribute = '';
      let from = -1;
      for (const [attrName, where] of Object.entries(span.attrs)) {
        if (where.startOffset <= first.startOffset && where.startOffset > from) { attribute = attrName; from = where.startOffset; }
      }
      return { elements, problem: { kind: 'attribute', element: span.name, attribute } };
    }
    return { elements, problem: { kind: 'unclean', code: first.code, at: first.startOffset } };
  }
  if (comment) return { elements, problem: { kind: 'tag-start' } };
  // Every "<" stands inside a tag the parser built: at its start, or inside one of its quoted
  // values, which the checks read on their own. The spans are sorted, so one sweep does it.
  let s = 0;
  let reach = -1;
  for (let at = html.indexOf('<'); at !== -1; at = html.indexOf('<', at + 1)) {
    while (s < spans.length && spans[s].start <= at) { reach = Math.max(reach, spans[s].end); s++; }
    if (at >= reach) return { elements, problem: { kind: 'stray', at } };
  }
  return { elements, problem: null };
}

const HEX = /[0-9a-fA-F]/;
const CSS_NEWLINE = new Set(['\n', '\r', '\f']);
/** An ASCII character a name is made of: a letter, a digit, "-" or "_". Past ASCII, every character is. */
const ASCII_NAME_CHAR = /^[A-Za-z0-9_-]$/;
/**
 * What an escape stands for, as the readers after cssAsRead may see it. A name character is itself,
 * because those are what spell `url(`, `@import` and `fixed`. Anything else becomes "_": to a
 * browser an escaped character is always part of a name or of a string, never a ";", a brace, a
 * quote or a comma, and a reader that met the character itself would take it for one.
 */
const escaped = (ch: string): string => (ASCII_NAME_CHAR.test(ch) || ch.charCodeAt(0) > 0x7f ? ch : '_');

/**
 * Where the string opened by the quote at `at` ends: the index after its closing quote, or the
 * newline a browser ends it at, or the end of the text. Every reader below steps over a string with
 * it, since a brace or a semicolon inside one is text. Meant for cssAsRead's output, where every
 * quote is a real one: an escaped quote comes out as "_".
 */
function stringEnd(s: string, at: number): number {
  const quote = s[at];
  for (let i = at + 1; i < s.length; i++) {
    if (s[i] === quote) return i + 1;
    if (CSS_NEWLINE.has(s[i])) return i;
  }
  return s.length;
}

/**
 * The stylesheet as a browser's tokenizer reads it, so that a check reads what the browser reads:
 *   - every escape is resolved: `u\rl(` is `url(`, `\75 rl(` is `url(` (up to six hex digits and
 *     one whitespace after them), `f\ixed` is `fixed`. An escape that stands for anything but a name
 *     character comes out as "_" (see `escaped`), so `.a\;b` reads as the one class a browser reads;
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
        out += cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) ? '�' : escaped(String.fromCodePoint(cp));
        if (css[j] === '\r' && css[j + 1] === '\n') j += 2;
        else if (css[j] === ' ' || css[j] === '\t' || CSS_NEWLINE.has(css[j])) j++;
        i = j;
        continue;
      }
      out += escaped(next);
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

/** Every `property: value` of the stylesheet, as written, whatever rule it sits in. Strings stepped over. */
export function declarationsOf(css: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i <= css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === '\'') { i = stringEnd(css, i) - 1; continue; }
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
 * percentages are steps, not selectors). A brace or a semicolon inside a string is text: it opens
 * or closes nothing, so it cannot hold the reader inside a block the browser has left.
 */
export function selectorsOf(css: string): string[] {
  const out: string[] = [];
  const stack: Array<'rule' | 'at' | 'keyframes'> = [];
  let from = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === '\'') { i = stringEnd(css, i) - 1; continue; }
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
  for (let i = at; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === '\'') i = stringEnd(s, i) - 1;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** The entries of a selector list: split at the commas outside parentheses, brackets and strings. */
export function selectorListOf(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === '\'') i = stringEnd(text, i) - 1;
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
