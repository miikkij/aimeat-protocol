/**
 * @file src/services/design-book/component-scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading a proposed component's markup and stylesheet the way a browser reads them,
 *   with the parsers a browser's reading is specified by. Nothing here is a hand-written imitation.
 *
 *   THE MARKUP IS READ BY THE HTML PARSER ITSELF: parse5, the parsing algorithm of the WHATWG HTML
 *   standard, which is what a browser runs (`readMarkup`). The checks get the elements it builds,
 *   each attribute value DECODED as a browser decodes it, and the first thing that keeps the bench
 *   from vouching for the markup: a parse error, a comment, or a "<" that starts no tag the parser
 *   built.
 *
 *   THE STYLESHEET IS READ BY A CSS PARSER: css-tree, which tokenizes and parses by CSS Syntax
 *   Level 3 (`readStylesheet`). It reads twice. Its TOKENIZER sees every at-rule, function and
 *   address wherever it stands, a string being one token whatever it holds, and every name is read
 *   with its escapes resolved (`u\72 l(` is `url(`), since a browser resolves them before it matches
 *   a name. Its PARSER gives the declarations and the selectors, each selector read to its end
 *   (`ComplexSelector`), since its end is what a rule styles.
 *
 *   WHAT THE PARSERS CANNOT READ CLEANLY IS REFUSED: a parse error, or a part css-tree keeps as raw
 *   text. An allowlist is only as good as the agreement on what the text holds, and the parser's
 *   reading is the one a browser follows. Both parsers cost more the deeper the text nests, so the
 *   bench hands them no more than its ceiling (COMPONENT_LIMITS in component.ts), and css-tree is not
 *   run at all on a stylesheet nesting deeper than MAX_NESTING.
 *
 *   THE MARKUP CLOSES EVERY ELEMENT IT OPENS. A page writes its own content after the component, and
 *   an element still open where the markup ends takes that content in, so a rule of the component
 *   styles it. The markup is read once more with an element after it, the way a page follows it.
 * @structure readMarkup · readStylesheet · MAX_NESTING · MarkupElement · MarkupProblem · StylesheetReading ·
 *   DeclarationRead · ComplexSelector · Compound · Pseudo
 * @usage const { elements, problem } = readMarkup(html); const sheet = readStylesheet(css);
 * @version-history
 *   v2.3.0 — 2026-09-26 — readMarkup reports an element still open where the markup ends (`open`,
 *     with the outermost one's name), read by parsing the markup with an element after it: that
 *     element stands last at the top only when every element of the markup closed. Its name is one
 *     no rule of the parser treats apart, so an open <svg> holds it as it holds the page's own
 *     elements, where a <br> would break out.
 *   v2.2.0 — 2026-09-26 — A pseudo whose argument is not a selector, and which the parser keeps as raw
 *     text holding only words and numbers (::part(label), :state(on), :nth-col(2n+1)), reads as
 *     `plain`, and the walk does not report that text as unreadable.
 *   v2.1.0 — 2026-09-26 — readStylesheet says of every selector whether it stands in a rule nested
 *     inside a style rule (`nested`), at-rules between them or not: there "&" is that rule's own
 *     elements, and at the top of the stylesheet it is the page.
 *   v2.0.0 — 2026-09-26 — The stylesheet is read by css-tree (readStylesheet, in place of cssAsRead,
 *     declarationsOf, selectorsOf, selectorListOf, complexSelectorOf and withoutVarFallbacks): its
 *     tokenizer for the at-rules, functions and addresses, with every name's escapes resolved, and
 *     its parser for the declarations and the selectors. A string is one token, whatever it holds. A
 *     parse error or a part kept as raw text is reported, and a stylesheet nesting deeper than 32 is
 *     not parsed (e82c9f26d729).
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
import {
  ident, parse as parseCss, tokenize, tokenTypes, walk,
  type CssNode, type Declaration, type PseudoClassSelector, type PseudoElementSelector, type Rule, type Selector, type SelectorList,
} from 'css-tree';

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
  | { kind: 'stray'; at: number }
  /** An element still open where the markup ends, by the name of the outermost one. */
  | { kind: 'open'; element: string };

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
 * What the markup is read again with, after it: an element a page might write next. Its name is a
 * custom element's, which no rule of the parser treats apart and no allowlist carries: an open <p>
 * does not close for it, an open <svg> holds it (a <br> would break out of the <svg> to the top), and
 * <select> drops it and a <table> puts it before itself, so in neither is it last.
 */
const END_NAME = 'aimeat-bench-end';
const END_MARK = `<${END_NAME}></${END_NAME}>`;

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
 *
 * A markup that reads cleanly is read once more with END_MARK after it, as a page follows the
 * component with its own content: when END_MARK is not the last thing at the top, standing empty, an
 * element of the markup is still open and would take that content in.
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
  // NOTHING IS LEFT OPEN: what a page writes next stands at the top, after the component.
  const followed = parseFragment(CONTEXT, html + END_MARK, {}).childNodes;
  const last = followed[followed.length - 1];
  if (!last || last.nodeName !== END_NAME || !('childNodes' in last) || last.childNodes.length > 0) {
    // The outermost element still open is the last one at the top: END_MARK is inside it, or it
    // dropped END_MARK (<select>) or put it before itself (<table>).
    const open = [...followed].reverse().find(n => 'tagName' in n);
    return { elements, problem: { kind: 'open', element: open && 'tagName' in open ? open.tagName.toLowerCase() : '' } };
  }
  return { elements, problem: null };
}

/**
 * A pseudo-class or pseudo-element as the checks read it: its name with its escapes resolved and
 * lower-cased, and what its parentheses hold, or null when it has none:
 *   - `list`: a selector list (:is, :where, :not, :has, ::slotted, …), each entry a complex selector,
 *     or null where one does not read as a selector;
 *   - `nth`: :nth-child() and its kin, with the list after "of" when there is one;
 *   - `plain`: words, strings and commas, which name no element (:lang(fi), :dir(rtl)), and the
 *     argument of a pseudo whose argument is not a selector, when the parser kept it as raw text and
 *     it holds only words, numbers, commas and spaces (::part(label), :state(on), :nth-col(2n+1));
 *   - `unreadable`: anything else the parser kept as raw text.
 */
export interface Pseudo {
  name: string;
  element: boolean;
  arg: null
    | { kind: 'list'; list: Array<ComplexSelector | null> }
    | { kind: 'nth'; of: Array<ComplexSelector | null> | null }
    | { kind: 'plain' }
    | { kind: 'unreadable' };
}

/**
 * One compound selector as the check reads it: what is written on the element itself. A class
 * inside a pseudo-class's parentheses is a condition, not the element's own class, so it stays with
 * its pseudo-class and is never counted in `classes`. An id or an attribute selector is a condition
 * on the element and is not kept.
 */
export interface Compound {
  /** Class names with their escapes resolved: `.a\;b` is the one class `a;b`. */
  classes: string[];
  /** Type names, lower-cased, `*` included. */
  types: string[];
  pseudos: Pseudo[];
  /** `&`, the parent rule's selector under CSS nesting. */
  nesting: boolean;
}

/**
 * A complex selector: compounds joined by combinators, `' '` (descendant), `'>'`, `'+'` or `'~'`.
 * `lead` is a combinator written before the first compound, which is what a relative selector looks
 * like (inside `:has()`, or a nested rule).
 */
export interface ComplexSelector { lead: string | null; compounds: Compound[]; combinators: string[] }

/** One declaration as the checks read it, outside the conditions of an at-rule's prelude. */
export interface DeclarationRead {
  /** The property with its escapes resolved, lower-cased. */
  property: string;
  important: boolean;
  /** The value when it is one keyword, escapes resolved and lower-cased, and null otherwise. */
  keyword: string | null;
  /** Every keyword in the value, escapes resolved and lower-cased. A string is not a keyword. */
  keywords: string[];
  /** Every literal colour in the value outside var(): "#111111", "rgb(". */
  literals: string[];
  /** The value as written, for a message. */
  text: string;
}

/** A stylesheet as the CSS parser reads it (readStylesheet). */
export interface StylesheetReading {
  /** Every at-rule's name the tokenizer saw, escapes resolved, lower-cased. */
  atRules: string[];
  /** Every function's name the tokenizer saw, escapes resolved, lower-cased, and "url" for an address token. */
  functions: string[];
  /** Whether a var() reads one of the page's tokens, `--ak-…`. */
  readsPageTokens: boolean;
  /** How deep brackets and blocks nest. */
  depth: number;
  declarations: DeclarationRead[];
  /**
   * Every selector of every style rule outside @keyframes, as written, and read, or null where it
   * does not read. `nested` when the rule stands inside another style rule, at-rules between them
   * or not: there "&" is that rule's own elements, and at the top it is the page.
   */
  selectors: Array<{ text: string; selector: ComplexSelector | null; nested: boolean }>;
  /** The first part the parser could not read (a parse error, or text it kept raw), or null. */
  unreadable: string | null;
}

/** How deep brackets and blocks may nest before css-tree is not run at all. No component needs more. */
export const MAX_NESTING = 32;

const KEYFRAMES = /^(?:-[a-z]+-)?keyframes$/;
const COMBINATORS = new Set([' ', '>', '+', '~']);
const COLOUR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch']);
const HEX_COLOUR = /^[0-9a-f]{3,8}$/i;
const T = tokenTypes;

/** A name as the text spells it, escapes resolved and lower-cased: `U\72 L` is `url`, as a browser matches it. */
const nameOf = (raw: string): string => ident.decode(raw).toLowerCase();

/** The text a node stands on, trimmed. */
const textOf = (css: string, node: CssNode): string => (node.loc ? css.slice(node.loc.start.offset, node.loc.end.offset).trim() : '');

/**
 * The stylesheet as a browser reads it, in two passes of css-tree.
 *
 * THE TOKENS. A browser's tokenizer makes a token the same way wherever it stands, so the at-rules,
 * the functions and the addresses are taken from the tokens, and none hides in a part the parser
 * later keeps raw. A string is one token, so nothing it holds is an at-rule, a function or a
 * structure. A name is read with its escapes resolved: css-tree matches `url(` as written, and a
 * browser matches it after resolving `u\72 l(`, so every function name is resolved here and the
 * checks read that. The same pass measures how deep the brackets and blocks nest, pairing each
 * closer with its own opener as CSS does (a "]" inside "(" closes nothing).
 *
 * THE STRUCTURE, from css-tree's parser, only when the nesting is within MAX_NESTING: every
 * declaration outside an at-rule's conditions, and every selector of every style rule outside
 * @keyframes (whose from, to and percentages are steps, not selectors). A parse error, and any part
 * the parser keeps as raw text, is reported as unreadable.
 */
export function readStylesheet(css: string): StylesheetReading {
  const reading: StylesheetReading = { atRules: [], functions: [], readsPageTokens: false, depth: 0, declarations: [], selectors: [], unreadable: null };
  const tokens: Array<{ type: number; start: number; end: number }> = [];
  tokenize(css, (type, start, end) => { tokens.push({ type, start, end }); });
  const closers: number[] = [];
  const open = (closer: number) => { closers.push(closer); reading.depth = Math.max(reading.depth, closers.length); };
  for (let t = 0; t < tokens.length; t++) {
    const { type, start, end } = tokens[t];
    if (type === T.AtKeyword) reading.atRules.push(nameOf(css.slice(start + 1, end)));
    else if (type === T.Url || type === T.BadUrl) reading.functions.push('url');
    else if (type === T.Function) {
      const name = nameOf(css.slice(start, end - 1));
      reading.functions.push(name);
      if (name === 'var') {
        let next = t + 1;
        while (next < tokens.length && (tokens[next].type === T.WhiteSpace || tokens[next].type === T.Comment)) next++;
        // A custom property's name keeps its case: `--AK-ink` is not one of the page's tokens.
        const arg = tokens[next];
        if (arg?.type === T.Ident && ident.decode(css.slice(arg.start, arg.end)).startsWith('--ak-')) reading.readsPageTokens = true;
      }
      open(T.RightParenthesis);
    } else if (type === T.LeftParenthesis) open(T.RightParenthesis);
    else if (type === T.LeftSquareBracket) open(T.RightSquareBracket);
    else if (type === T.LeftCurlyBracket) open(T.RightCurlyBracket);
    else if (closers.length && type === closers[closers.length - 1]) closers.pop();
  }
  if (reading.depth > MAX_NESTING) return reading;

  try {
    const ast = parseCss(css, {
      positions: true,
      parseCustomProperty: true,
      onParseError: (error, fallback) => { reading.unreadable ??= (fallback.type === 'Raw' ? fallback.value : css.slice(error.offset)).trim().slice(0, 60); },
    });
    let keyframes = 0;
    // How many style rules the walk stands inside: a rule inside one is a nested rule.
    let styleRules = 0;
    walk(ast, {
      enter(node) {
        if (node.type === 'Raw') reading.unreadable ??= node.value.trim().slice(0, 60);
        // Raw text a pseudo holds that is only words and numbers is read, not refused (pseudoOf).
        else if ((node.type === 'PseudoClassSelector' || node.type === 'PseudoElementSelector') && wordsOnly(node)) return this.skip;
        else if (node.type === 'Atrule' && KEYFRAMES.test(nameOf(node.name))) keyframes++;
        else if (node.type === 'Rule' && keyframes === 0) reading.selectors.push(...selectorsOfRule(node, css, styleRules > 0));
        else if (node.type === 'Declaration' && !this.atrulePrelude) reading.declarations.push(declarationOf(node, css));
        if (node.type === 'Rule') styleRules++;
        return undefined;
      },
      leave(node) {
        if (node.type === 'Atrule' && KEYFRAMES.test(nameOf(node.name))) keyframes--;
        if (node.type === 'Rule') styleRules--;
      },
    });
  } catch (err) {
    // css-tree reads a failing part as raw text and goes on; an error that escapes it is a text it
    // could not read at all, and that is what the bench says.
    reading.unreadable ??= `the stylesheet (${String((err as Error)?.message ?? err).slice(0, 60)})`;
  }
  return reading;
}

/** One declaration, its value's keywords and literal colours read from the parser's nodes. */
function declarationOf(node: Declaration, css: string): DeclarationRead {
  const read: DeclarationRead = { property: nameOf(node.property), important: Boolean(node.important), keyword: null, keywords: [], literals: [], text: textOf(css, node.value) };
  if (node.value.type === 'Raw') return read;
  const parts = node.value.children.toArray().filter(n => n.type !== 'WhiteSpace');
  if (parts.length === 1 && parts[0].type === 'Identifier') read.keyword = nameOf(parts[0].name);
  // A colour inside var(--x, …) is a fallback, which the page's token overrides: not a literal.
  let insideVar = 0;
  walk(node.value, {
    enter(n) {
      if (n.type === 'Identifier') read.keywords.push(nameOf(n.name));
      else if (n.type === 'Function') {
        const name = nameOf(n.name);
        if (name === 'var') insideVar++;
        else if (!insideVar && COLOUR_FUNCTIONS.has(name)) read.literals.push(`${name}(`);
      } else if (n.type === 'Hash' && !insideVar && HEX_COLOUR.test(ident.decode(n.value))) read.literals.push(`#${ident.decode(n.value)}`);
    },
    leave(n) {
      if (n.type === 'Function' && nameOf(n.name) === 'var') insideVar--;
    },
  });
  return read;
}

/** Every selector of one style rule, as written and as read. A prelude the parser kept raw is one unreadable entry. */
function selectorsOfRule(rule: Rule, css: string, nested: boolean): StylesheetReading['selectors'] {
  if (rule.prelude.type === 'Raw') return [{ text: rule.prelude.value.trim(), selector: null, nested }];
  return rule.prelude.children.toArray().map(s => ({
    text: s.type === 'Raw' ? s.value.trim() : textOf(css, s), selector: s.type === 'Selector' ? complexOf(s) : null, nested,
  }));
}

const listOf = (list: SelectorList): Array<ComplexSelector | null> => list.children.toArray().map(s => (s.type === 'Selector' ? complexOf(s) : null));

/**
 * One selector as compounds and combinators, or null when it does not read as one: two combinators
 * with nothing between them, a combinator at its end, a type or a namespace written anywhere but at
 * a compound's start, a combinator CSS no longer has (`/deep/`), or anything but a simple selector
 * in a compound (a percentage outside @keyframes). Null is a refusal to the caller.
 */
function complexOf(selector: Selector): ComplexSelector | null {
  const out: ComplexSelector = { lead: null, compounds: [], combinators: [] };
  let compound: Compound | null = null;
  let pending: string | null = null;
  for (const node of selector.children.toArray()) {
    if (node.type === 'Combinator') {
      if (!COMBINATORS.has(node.name)) return null;
      if (compound) { out.compounds.push(compound); compound = null; pending = node.name; continue; }
      if (out.compounds.length === 0 && out.lead === null && pending === null) { out.lead = node.name; continue; }
      return null;
    }
    if (!compound) {
      compound = { classes: [], types: [], pseudos: [], nesting: false };
      if (pending !== null) { out.combinators.push(pending); pending = null; }
    }
    if (node.type === 'TypeSelector') {
      const name = nameOf(node.name);
      if (name.includes('|') || compound.types.length || compound.classes.length || compound.pseudos.length || compound.nesting) return null;
      compound.types.push(name);
    } else if (node.type === 'ClassSelector') compound.classes.push(ident.decode(node.name));
    else if (node.type === 'NestingSelector') compound.nesting = true;
    else if (node.type === 'PseudoClassSelector' || node.type === 'PseudoElementSelector') compound.pseudos.push(pseudoOf(node));
    else if (node.type !== 'IdSelector' && node.type !== 'AttributeSelector') return null;
  }
  if (!compound) return null;
  out.compounds.push(compound);
  return out;
}

/** Pseudos whose argument is a selector: the checks follow that argument, so a raw one stays unreadable. */
const SELECTOR_ARGUMENT = new Set([
  'is', 'where', 'not', 'matches', '-webkit-any', '-moz-any', 'has', 'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type',
  'host', 'host-context', 'slotted', 'cue', 'cue-region', 'current', 'past', 'future',
]);
/** The tokens an argument of words and numbers is made of. */
const WORD_TOKENS = new Set([T.Ident, T.Number, T.Dimension, T.Percentage, T.Comma, T.WhiteSpace]);

/**
 * Whether a pseudo holds, as raw text, an argument of words and numbers only: ::part(label),
 * :state(on), :nth-col(2n+1). A pseudo-class only narrows the element its compound names and a
 * pseudo-element hangs off it, so such an argument changes nothing a rule reaches. A pseudo whose
 * argument is a selector is never read this way: its argument is what the checks follow.
 */
function wordsOnly(node: PseudoClassSelector | PseudoElementSelector): boolean {
  if (node.children === null || SELECTOR_ARGUMENT.has(nameOf(node.name))) return false;
  const kids = node.children.toArray();
  return kids.length > 0 && kids.every(kid => {
    if (kid.type !== 'Raw') return false;
    let words = true;
    tokenize(kid.value, type => { if (!WORD_TOKENS.has(type)) words = false; });
    return words;
  });
}

/** A pseudo-class or pseudo-element with what its parentheses hold, as css-tree read it. */
function pseudoOf(node: PseudoClassSelector | PseudoElementSelector): Pseudo {
  const pseudo: Pseudo = { name: nameOf(node.name), element: node.type === 'PseudoElementSelector', arg: null };
  if (node.children === null) return pseudo;
  if (wordsOnly(node)) { pseudo.arg = { kind: 'plain' }; return pseudo; }
  const kids = node.children.toArray();
  const [only] = kids;
  if (kids.length === 1 && only.type === 'SelectorList') pseudo.arg = { kind: 'list', list: listOf(only) };
  else if (kids.length === 1 && only.type === 'Selector') pseudo.arg = { kind: 'list', list: [complexOf(only)] };
  else if (kids.length === 1 && only.type === 'Nth') pseudo.arg = { kind: 'nth', of: only.selector ? listOf(only.selector) : null };
  else if (kids.length > 0 && kids.every(k => k.type === 'Identifier' || k.type === 'String' || k.type === 'Operator')) pseudo.arg = { kind: 'plain' };
  else pseudo.arg = { kind: 'unreadable' };
  return pseudo;
}
