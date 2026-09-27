/**
 * @file src/services/design-book/component.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ninth kind of Design Book part: a COMPONENT, a piece of page an AI builder made
 *   by hand because the Book had nothing for it, offered to the next builder.
 *
 *   WHY IT EXISTS. Measured 2026-09-20: three builders of one app each made the same tickable
 *   week grid by hand, each writing that "the Book's grids are read-only", and a fourth build made
 *   three flute components. None of it could go into the Book, because every kind the Book had
 *   was an arrangement of the kit's own blocks or a sheet of tokens. The developer's ruling the
 *   same day: no person makes anything here; the Book grows from apps that turned out well.
 *
 *   WHAT A COMPONENT IS: markup and a stylesheet, and NO SCRIPT. It gives the structure and the
 *   look; the app that takes it wires the behaviour, the way an app wires its own `section`. That
 *   is a security decision before it is a design one: a part's preview is served from the node's
 *   own origin, so a part that carried script would be anybody's code running as this node. For
 *   the same reason the markup is read against an ALLOWLIST of elements and attributes, and the
 *   stylesheet may not load anything, reach outside its own prefix, carry an at-rule off its list, or
 *   fix itself over the page.
 *
 *   IT WEARS WHATEVER PAGE IT LANDS IN. Every colour is a `var(--ak-…)` token, never a literal,
 *   so inside a genre it takes the genre's ground, ink and accent through the genre's bridge, and
 *   in a plain Atelier page it takes the look's. A literal colour is refused with the tokens named.
 *
 *   THE BUILDER SAYS WHETHER IT IS WORTH HAVING. `judgement.reach` is "general" (another kind of
 *   app would use this) or "special" (it is this app's own), with the reason in a sentence. The
 *   bench can prove a component renders and cannot prove anybody else wants it: a flute fingering
 *   chart passes every check and belongs to one app. Only a general one is published on its own
 *   (service.ts); a special one stays proposed, listed and usable by whoever made it.
 *
 *   A STORED BODY IS BENCHED AGAIN before anything reads it (componentBench): the bench learns with
 *   a deploy. One that no longer passes says why, in the bench's own words, wherever it is refused;
 *   its markup and stylesheet go only to its proposer (componentAsRead), who needs them to fix it.
 * @structure COMPONENT_LIMITS · validateComponentBody(raw) · componentBench(body) · componentDigest(body) ·
 *   componentAsRead(body, bench, proposer) · componentPreviewHtml(body) · componentSnippet(body)
 * @usage const body = validateComponentBody(raw);
 * @version-history
 *   v1.13.0 — 2026-09-26 — The at-rules a component's stylesheet may carry are a list: @media, @supports,
 *     @container and @starting-style, and @keyframes, @property, @counter-style, @font-palette-values,
 *     @position-try, @function and @font-feature-values under a name that starts with its prefix, with
 *     the blocks of @font-feature-values inside it. Every other at-rule, known or unknown, is refused,
 *     and every refusal of an at-rule says what the list is.
 *   v1.12.0 — 2026-09-26 — A component's stylesheet reaches only the component: @layer, @page and
 *     @view-transition are refused, each in a sentence of its own, and the name a @keyframes, @property
 *     or @counter-style defines starts with the component's prefix, the refusal showing the prefixed
 *     form. A name the stylesheet only uses may be the page's own.
 *   v1.11.0 — 2026-09-26 — A stylesheet carrying @scope is refused in a sentence of its own, which shows
 *     the same rule written on the component's own classes: inside @scope, "&" stands for the elements
 *     its prelude chooses, and a component's own classes already keep every rule inside it.
 *   v1.10.0 — 2026-09-26 — componentBench answers why a stored body no longer passes, once per body and
 *     process, through the same checks a proposal passes (benchTexts). The preview sentence and the
 *     snippet's refusal carry that reason, the preview's escaped, and componentAsRead withholds the
 *     markup and the stylesheet of a failing body from anyone but its proposer.
 *   v1.9.0 — 2026-09-26 — A repeated attribute, a missing space between two attributes and a "/"
 *     ending a <div> are each refused in words of their own: a browser keeps the first of two, and
 *     ignores the "/" and leaves the element open.
 *   v1.8.0 — 2026-09-26 — The markup closes every element it opens: one still open where the markup
 *     ends would take in whatever a page writes after the component, and it is refused by name.
 *   v1.7.0 — 2026-09-26 — A pseudo whose argument is not a selector and is only words and numbers
 *     (::part(label), :state(on), :nth-col(2n+1)) passes: it narrows the element its compound names
 *     and changes nothing a rule reaches. A pseudo that names the page stays refused by its name.
 *   v1.6.0 — 2026-09-26 — A rule nested inside a style rule may start at "&", which is that rule's own
 *     elements (and every selector of that rule is checked too); "&" anywhere at the top of the
 *     stylesheet is the page. The refusal of a rule the parser keeps raw shows the nested forms that
 *     pass.
 *   v1.5.1 — 2026-09-26 — A stylesheet carries no "</". A page reads it inside a <style> element, which
 *     "</style" ends, so with none the text every page reads is the text the bench read. Inside a
 *     string "<\/" reads the same and passes.
 *   v1.5.0 — 2026-09-26 — The stylesheet is benched as the CSS parser reads it (component-scan.ts
 *     readStylesheet, css-tree): @import, @font-face and @namespace, url(), image-set(), src(),
 *     image() and expression() are found among its tokens with every name's escapes resolved, and
 *     what a string holds is text. Declarations, !important, position, animation, literal colours and
 *     selectors are read from its parser's nodes, a declaration inside an at-rule's condition apart.
 *     A stylesheet nesting deeper than MAX_NESTING, a parse error, and a part the parser keeps as raw
 *     text are refused, and the parser reads no more than the ceiling (e82c9f26d729).
 *   v1.4.0 — 2026-09-26 — The markup is benched as the HTML parser reads it (component-scan.ts
 *     readMarkup, parse5): the elements a browser builds, with every attribute value decoded, so a
 *     plain value may hold a character reference and an address spelled with one is refused as an
 *     address. A parse error, a comment and a "<" that starts no tag the parser built are refused,
 *     each in its own words, and the parser reads no more than the ceiling (1a0a15eb7b20).
 *   v1.3.1 — 2026-09-26 — An attribute value is benched as a browser uses it (1a0a15eb7b20): a value
 *     holding a character reference other than &amp; is refused, since a browser decodes it before
 *     use (`u&#114;l(` is url(), and so is one holding a backslash, since a browser reads an SVG
 *     attribute such as fill as a style value, where `u\72 l(` is url() too. The address check read
 *     the value as written, and a preview fetched the address.
 *   v1.3.0 — 2026-09-24 — Every selector is read to its end (selectorEscape), since a rule styles
 *     what its last compound names: it starts at one of the component's own elements, goes down
 *     freely, goes sideways only onto another of its own elements until it has gone down once, and
 *     names no part of the page (html, body, :root, :scope, :host, a leading *). :is(), :where() and
 *     :not() hold plain conditions on the element, and :has() looks only down into it. The check
 *     read only the first class, so `.wkgrid ~ p` restyled every paragraph after the component.
 *   v1.2.0 — 2026-09-24 — The bench reads what a browser reads, and refuses what it cannot read
 *     cleanly (1a0a15eb7b20, e82c9f26d729). An "=" with no name before it, a tag whose name does
 *     not follow its "<" at once, and a closing tag carrying anything are refused: each let a
 *     <script> through as a quoted value the browser never saw as one. The stylesheet checks read
 *     the text with its escapes resolved and its comments found where a browser finds them, so
 *     `u\rl(`, `@\import`, `f\ixed`, `!\important` and a url() between two strings holding "/*"
 *     and "*\/" are refused. Position is one of three words, so `var(--p)` cannot carry "fixed" in,
 *     and image-set() is refused beside url(). The preview and the snippet an adopter takes bench
 *     the stored body again: the preview shows none of it, and the snippet is refused, when it no
 *     longer passes.
 *   v1.1.1 — 2026-09-20 — componentPreviewHtml takes the theme the reader is on.
 *   v1.1.0 — 2026-09-20 — The markup and the stylesheet are read with an index, one character at a
 *     time (component-scan.ts), and no longer with patterns over the whole text. Three of those
 *     were quadratic on text that opens and never closes (CodeQL js/polynomial-redos, alerts 1646
 *     to 1648, the day this shipped). Found while replacing them, and worse: the tag pattern ended
 *     a tag at the first ">" of any kind, so `<div title="x>" onclick="…">` was read as a harmless
 *     tag and some text while a browser saw the handler. A tag now ends where a browser ends it,
 *     and an attribute the two could read differently is refused.
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { createHash } from 'node:crypto';
import { DesignBookError } from './errors.js';
import {
  MAX_NESTING, nameKindOf, readMarkup, readStylesheet, type ComplexSelector, type Compound, type MarkupProblem, type NameDefinition, type NameKind,
} from './component-scan.js';
import { escapeHtml } from '../site-tags.js';

export const COMPONENT_LIMITS = { html: 12_000, css: 12_000, use: 600, why: 400, whyMin: 20 } as const;

export interface ComponentBody {
  /** The class prefix every rule and every class in the markup carries, so it cannot collide. */
  prefix: string;
  html: string;
  css: string;
  /** How an app mounts it: which element it fills, which `data-` hooks it reads, what to wire. */
  use: string;
  judgement: { reach: 'general' | 'special'; why: string };
  /** The app it came out of, when its proposer says (the owner's own published filename). */
  from_app?: string;
}

const PREFIX_RE = /^[a-z][a-z0-9]{1,11}$/;

/** The only positions a component may take: it stays where the app puts it, and says so in a word. */
const POSITIONS = new Set(['static', 'relative', 'absolute']);

const ELEMENTS = new Set([
  'div', 'span', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'strong', 'em', 'small', 'b', 'i', 'u', 's', 'sub', 'sup',
  'br', 'hr', 'time', 'abbr', 'code', 'kbd', 'pre', 'blockquote', 'q', 'mark', 'label', 'button', 'input', 'select', 'option',
  'textarea', 'output', 'progress', 'meter', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'details', 'summary', 'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'title', 'desc',
]);

const ATTRIBUTES = new Set([
  'class', 'id', 'role', 'type', 'name', 'value', 'placeholder', 'for', 'title', 'lang', 'dir', 'hidden', 'disabled', 'checked',
  'selected', 'readonly', 'required', 'min', 'max', 'step', 'rows', 'cols', 'colspan', 'rowspan', 'scope', 'tabindex', 'datetime',
  'open', 'width', 'height', 'viewbox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'fill',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'transform', 'offset', 'stop-color',
  'stop-opacity', 'opacity', 'text-anchor', 'dominant-baseline', 'preserveaspectratio', 'xmlns', 'focusable', 'autocomplete', 'inputmode',
]);

const refuse = (message: string): never => { throw new DesignBookError('BODY_INVALID', message, 422); };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const TAG_START_REFUSAL = 'A tag starts with its element\'s name right after "<" or "</". With a space or anything but a letter there, a browser reads it as text or as a comment ending at the first ">", '
  + 'so the bench and the browser would disagree about what is markup. A "<" in text is written &lt;.';
const ODD_ATTRIBUTE_REFUSAL = (element: string, key: string) => `On <${element}>, the attribute "${key.slice(0, 40)}" carries a quote or an angle bracket where a browser and this bench could read the tag differently. `
  + 'Write every value in double quotes, with no quote, "<" or ">" inside it.';

/** What the bench says when the HTML parser's reading keeps it from vouching for the markup (component-scan.ts readMarkup). */
function markupRefusal(problem: MarkupProblem, html: string): string {
  switch (problem.kind) {
    case 'comment': return 'A component\'s markup carries no comments: say what it is in `use`.';
    case 'unclosed': return 'A component\'s markup has a "<" that never meets its ">". Every tag is closed, and a "<" in text is written &lt;.';
    case 'equals':
      return `On <${problem.element}>, an "=" stands where a browser expects an attribute's name. A browser reads the "=" and what follows it as the name, quotes included, and ends the tag at the first ">". `
        + 'Every attribute is a name, "=", and a value in double quotes.';
    case 'closing':
      return `A closing tag carries nothing but its name: "</${problem.element}${problem.rest.slice(0, 40)}>" does not, and a browser reads what follows the name as attributes, quotes and all. Write </${problem.element}>.`;
    case 'tag-start': return TAG_START_REFUSAL;
    case 'attribute': return ODD_ATTRIBUTE_REFUSAL(problem.element, problem.attribute);
    case 'duplicate':
      return `On <${problem.element}>, the attribute "${problem.attribute.slice(0, 40)}" is written twice. A browser keeps the first and drops the second. Write each attribute once.`;
    case 'no-space':
      return `On <${problem.element}>, the attribute "${problem.attribute.slice(0, 40)}" follows the value before it with no space between them. Put a space between one attribute and the next.`;
    case 'slash':
      return `A browser ignores the "/" at the end of <${problem.element} …/>, so the <${problem.element}> stays open and takes in whatever a page writes after it. `
        + `Close every element inside the markup: <${problem.element} …></${problem.element}>. Only an element that holds nothing, such as <br> or <input>, and an SVG shape such as <path/> end with "/>".`;
    case 'open': {
      const name = problem.element || 'div';
      return `${problem.element ? `<${name}>` : 'An element'} is still open where the markup ends, so it would take in whatever a page writes after the component. `
        + `Close every element inside the markup: <${name} …></${name}>.`;
    }
    case 'unclean':
      return `The markup does not read cleanly as HTML at character ${problem.at} (${problem.code}). A browser mends such markup in a way of its own, and the bench vouches only for markup that reads cleanly. `
        + 'Close every tag, write every value in double quotes, and end every character reference with ";".';
    case 'stray':
      return `The "<" at character ${problem.at} ("${html.slice(problem.at, problem.at + 30)}") starts no tag a browser reads in that place: it is text inside <textarea> or <title>, or a tag HTML drops where it stands, `
        + 'such as a <td> outside a table row. A "<" in text is written &lt;, and every tag stands where HTML allows it.';
  }
}

function checkMarkup(html: string, prefix: string): void {
  // The parser's cost grows with how deep the markup nests, so it reads no more than the ceiling.
  if (html.length > COMPONENT_LIMITS.html) refuse(`A component carries its markup in \`html\`, up to ${COMPONENT_LIMITS.html} characters.`);
  // READ BY THE HTML PARSER (component-scan.ts readMarkup): the elements a browser builds, and every
  // attribute value decoded as a browser decodes it, so a check below reads what a browser uses.
  const { elements, problem } = readMarkup(html);
  if (problem) refuse(markupRefusal(problem, html));
  for (const { name, attrs } of elements) {
    if (!ELEMENTS.has(name)) {
      refuse(`A component's markup may not carry <${name}>. It is structure and nothing else: no script, style, link, iframe, object, embed, form, img, video, audio or anchor. `
        + 'A picture or a link is the app\'s to add, where it knows the address.');
    }
    for (const { name: key, value } of attrs) {
      if (key.includes('`') || value.includes('<') || value.includes('>')) refuse(ODD_ATTRIBUTE_REFUSAL(name, key));
      if (!(ATTRIBUTES.has(key) || key.startsWith('data-') || key.startsWith('aria-'))) {
        refuse(`A component's markup may not carry the attribute "${key}" on <${name}>. Allowed: class, id, role, data-*, aria-*, the form and table attributes, and the SVG drawing attributes. `
          + 'An event handler is the app\'s to wire, in its own script.');
      }
      // A browser reads an SVG drawing attribute (fill, stroke, …) as a style value, where an escape
      // stands for another character: `u\72 l(` is url( to it, and the address check below would
      // read past it. No value a component needs holds a backslash.
      if (value.includes('\\')) {
        refuse(`The attribute "${key}" on <${name}> carries a backslash. A browser reads an SVG attribute such as fill as a style value, where a backslash stands for another character, so the bench could not read the value the browser uses. `
          + 'Write the characters themselves.');
      }
      // A browser drops whitespace and control characters inside a scheme, so they go first.
      // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
      const address = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (address.startsWith('javascript:') || address.startsWith('data:') || address.startsWith('vbscript:') || address.includes('url(')) {
        refuse(`The attribute "${key}" on <${name}> may not carry an address.`);
      }
      if (key === 'class') {
        for (const cls of value.split(/\s+/).filter(Boolean)) {
          if (cls !== prefix && !cls.startsWith(prefix + '-')) {
            refuse(`Every class in a component's markup starts with its prefix, "${prefix}" or "${prefix}-…", so it cannot collide with the page it lands in: "${cls}" does not. `
              + 'The kit\'s own classes (ak-) are the kit\'s: a component that needs a kit block asks the app to mount one beside it.');
          }
        }
      }
    }
  }
}

/** At-rules that load something from an address. */
const LOADING_AT_RULES = new Set(['import', 'font-face', 'namespace']);
const LOADS_NOTHING = 'A component\'s stylesheet loads nothing: no @import, @font-face or @namespace. The type comes from the page it lands in (var(--ak-font)).';
/**
 * Inside @scope, "&" stands for the elements its prelude chooses, which can be outside the component,
 * and the component's own classes already keep every rule inside it. So @scope is refused, with the
 * same rule written on the component's own classes.
 */
const SCOPE_REFUSAL = (prefix: string) => 'A component\'s stylesheet carries no @scope, and a component does not need it: its own classes already keep every rule inside it. '
  + 'Inside @scope, "&" stands for the elements its prelude chooses, and they can be outside the component. '
  + `Write the same rule on the component's own classes: "@scope (.${prefix}) { .${prefix}-cell { … } }" is ".${prefix} .${prefix}-cell { … }", or "& .${prefix}-cell { … }" inside ".${prefix} { … }".`;

/** At-rules that act on the whole page by nature, each refused with what a component does instead. */
const PAGE_AT_RULES = new Map<string, (prefix: string) => string>([
  ['layer', prefix => 'A component\'s stylesheet carries no @layer: the order of cascade layers belongs to the whole page, and a component\'s stylesheet reaches only the component. '
    + `To lose to the page where the two disagree, write the selector inside :where(): ":where(.${prefix}-cell) { … }".`],
  ['page', () => 'A component\'s stylesheet carries no @page: it sets how the whole page prints, and a component\'s stylesheet reaches only the component. How a page prints is the page\'s to say.'],
  ['view-transition', () => 'A component\'s stylesheet carries no @view-transition: it sets how the whole page changes to the next one, and a component\'s stylesheet reaches only the component. '
    + 'How a page changes to the next is the page\'s to say.'],
]);

/**
 * THE AT-RULES A COMPONENT'S STYLESHEET MAY CARRY ARE A LIST, so an at-rule nobody has thought of yet
 * is refused too: the ones that condition the rules inside them and name nothing the page shares
 * (CONDITIONS), and the ones that define a name, under a name of the component's own (DEFINED).
 */
const CONDITIONS = new Set(['media', 'supports', 'container', 'starting-style']);
/** The blocks of @font-feature-values: their names belong to the font family it names, so they stand only inside it. */
const FEATURE_BLOCKS = new Set(['styleset', 'stylistic', 'character-variant', 'swash', 'ornaments', 'annotation', 'historical-forms']);
/** The list, as every refusal of an at-rule says it. */
const USES_ONLY = 'uses only @media, @supports, @container and @starting-style, which condition its own rules, '
  + 'and @keyframes, @property, @counter-style, @font-palette-values, @position-try, @function and @font-feature-values under a name that starts with its prefix';

/** May a component's stylesheet carry this at-rule where it stands? The name it defines is checked apart (ownDefinition). */
const listed = (a: { name: string; within: string | null }): boolean => CONDITIONS.has(a.name) || nameKindOf(a.name) !== null
  || (FEATURE_BLOCKS.has(a.name) && a.within === 'font-feature-values');

/** Why an at-rule off the list is refused: in words of its own where a component reaches for one, and with the list either way. */
function atRuleRefusal(name: string, prefix: string): string {
  if (FEATURE_BLOCKS.has(name)) return `A component's stylesheet carries @${name} only inside the @font-feature-values it belongs to: it ${USES_ONLY}.`;
  const own = LOADING_AT_RULES.has(name) ? LOADS_NOTHING : name === 'scope' ? SCOPE_REFUSAL(prefix) : PAGE_AT_RULES.get(name)?.(prefix);
  return own ? `${own} A component's stylesheet ${USES_ONLY}.` : `A component's stylesheet carries no @${name.slice(0, 40)}: it ${USES_ONLY}.`;
}

/**
 * What the at-rules that define a page-wide name define. The whole page shares the name, so a
 * component defines names of its own only: its prefix, or its prefix and a dash (after the "--" of a
 * dashed name). A name it only USES may be the page's own.
 */
const DEFINED: Record<NameKind, {
  noun: string; stem: string; dashes: string; after?: string; use: (name: string) => string; still: string; found?: (name: string, atRule: string) => string;
}> = {
  keyframes: { noun: 'animation', stem: 'spin', dashes: '', use: n => `animation-name: ${n}`, still: 'An animation the page defines is still used by its name.' },
  property: { noun: 'custom property', stem: 'x', dashes: '--', use: n => `var(${n})`, still: 'The page\'s tokens are still read by their names.' },
  'counter-style': { noun: 'counter style', stem: 'count', dashes: '', use: n => `list-style-type: ${n}`, still: 'A counter style the page defines is still used by its name.' },
  'font-palette-values': { noun: 'font palette', stem: 'palette', dashes: '--', use: n => `font-palette: ${n}`, still: 'A palette the page defines is still used by its name.' },
  'position-try': { noun: 'position fallback', stem: 'try', dashes: '--', use: n => `position-try-fallbacks: ${n}`, still: 'A fallback the page defines is still used by its name.' },
  function: { noun: 'custom function', stem: 'fn', dashes: '--', after: '()', use: n => `${n}()`, still: 'A function the page defines is still called by its name.' },
  'font-feature-values': {
    noun: 'font family', stem: 'font', dashes: '', use: n => `font-family: ${n}`, still: 'A font family the page uses keeps the feature values the page gives it.',
    found: (n, at) => `The stylesheet defines feature values for the font family "${n}" with @${at}, a family the whole page shares, so the page's own text in that family would change.`,
  },
};

/** Is the name this at-rule defines one of the component's own? */
function ownDefinition(d: NameDefinition, prefix: string): boolean {
  const { dashes } = DEFINED[d.kind];
  return d.name !== null && d.name.startsWith(dashes) && ownClass(d.name.slice(dashes.length), prefix);
}

/** Why the name an at-rule defines is refused, with the same name under the component's prefix. */
function definitionRefusal(d: NameDefinition, prefix: string): string {
  const def = DEFINED[d.kind];
  const stem = (d.name ?? '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || def.stem;
  const own = `${def.dashes}${prefix}-${stem}`;
  const name = d.name?.slice(0, 40);
  const found = name === undefined
    ? `"${d.text}" does not name one ${def.noun} the bench can read.`
    : def.found?.(name, d.atRule)
      ?? `The stylesheet defines the ${def.noun} "${name}" with @${d.atRule}, a name the whole page shares, so the page's own ${def.noun} of that name would change.`;
  return `${found} A component defines names of its own only: start the name with its prefix, "@${d.atRule} ${own}${def.after ?? ''}", and use it as "${def.use(own)}". ${def.still}`;
}
/** Functions that take an address: url() as a token or a function, and the ones that take it as a plain string. */
const loads = (fn: string) => fn === 'url' || fn === 'src' || fn === 'image' || fn.endsWith('image-set');
/** Properties that bind a behaviour, in the browsers that had them. */
const BINDINGS = new Set(['behavior', '-ms-behavior', '-moz-binding']);

function checkStyles(css: string, prefix: string): void {
  // The parser's cost grows with how deep the stylesheet nests, so it reads no more than the ceiling.
  if (css.length > COMPONENT_LIMITS.css) refuse(`A component carries its stylesheet in \`css\`, up to ${COMPONENT_LIMITS.css} characters.`);
  // A PAGE READS THE STYLESHEET INSIDE A <style> ELEMENT, the preview's and the one an app pastes it
  // into, and the first "</style" ends that element. With no "</" at all, the text every page reads is
  // the text the bench read.
  if (css.includes('</')) {
    refuse('A component\'s stylesheet carries no "</": the page it lands in reads "</style" as the end of the stylesheet. Inside a string, write "<\\/", which reads the same.');
  }
  // READ BY THE CSS PARSER (component-scan.ts readStylesheet): the at-rules, functions and addresses
  // from its tokens, every name with its escapes resolved, since `u\72 l(` is url( to a browser; the
  // declarations and selectors from its parser. A string is one token: what it holds is text.
  const sheet = readStylesheet(css);
  // A COMPONENT'S STYLESHEET REACHES ONLY THE COMPONENT. It carries the at-rules on the list and no
  // other, known or unknown, and every name it defines for the whole page (an animation, a custom
  // property, a font palette, …) is its own. What it uses by name may be the page's own.
  const unlisted = sheet.atRules.find(a => !listed(a));
  if (unlisted) refuse(atRuleRefusal(unlisted.name, prefix));
  const foreign = sheet.definitions.find(d => !ownDefinition(d, prefix));
  if (foreign) refuse(definitionRefusal(foreign, prefix));
  // image-set() takes its address as a plain string, so it loads with no url( written anywhere.
  if (sheet.functions.some(loads)) refuse('A component\'s stylesheet carries no url() or image-set(): it loads nothing, and a picture is the app\'s to add.');
  if (sheet.depth > MAX_NESTING) {
    refuse(`A component's stylesheet nests brackets and blocks ${sheet.depth} deep. The bench reads a stylesheet ${MAX_NESTING} deep at most, and no component needs more.`);
  }
  if (sheet.functions.includes('expression') || sheet.declarations.some(d => BINDINGS.has(d.property))) refuse('A component\'s stylesheet carries no expression(), behavior or binding.');
  if (sheet.declarations.some(d => d.important)) refuse('A component\'s stylesheet carries no !important: it lands inside somebody else\'s page and must lose to it where they disagree.');
  // POSITION IS A WORD, read one declaration at a time: `position: var(--p)` with `--p: fixed`
  // is fixed to a browser, and no reading of this text short of the cascade could tell.
  for (const d of sheet.declarations) {
    if (d.property === 'position' && !(d.keyword && POSITIONS.has(d.keyword))) {
      refuse(`A component stays where the app puts it: no position: fixed or sticky. Position is static, relative or absolute, written as the word itself and never through a variable ("${d.text.toLowerCase().slice(0, 40)}").`);
    }
  }
  if (sheet.declarations.some(d => d.property.startsWith('animation') && d.keywords.includes('infinite'))) {
    refuse('A component does not move at idle: no infinite animation. An entrance that ends is fine, and the ambient is the one layer allowed to keep moving.');
  }
  // A literal colour cannot follow the page it lands in. Inside var(--ak-x, #fallback) it is a fallback, which is fine.
  const [literal] = sheet.declarations.flatMap(d => d.literals);
  if (literal) {
    refuse(`A component's colours are the page's tokens, never a literal ("${literal}"): it has to wear whatever page it lands in, a Swiss poster or a night board. `
      + 'Use var(--ak-bg), --ak-surface, --ak-surface-2, --ak-ink, --ak-ink-dim, --ak-line, --ak-accent, --ak-accent-ink, --ak-ok, --ak-warn, --ak-err, and color-mix() of those. '
      + 'A genre hands the kit its own values through its bridge, so these are already the genre\'s.');
  }
  if (!sheet.readsPageTokens) refuse('A component\'s stylesheet reads the page\'s tokens (var(--ak-…)) at least once: one that reads none cannot follow a look, a theme or a genre.');
  // EVERY RULE STAYS INSIDE THE COMPONENT, read to the END of its selector: a rule styles what its
  // last compound names, and the first class says only where it starts. `.wkgrid ~ p` starts at the
  // component and styles every paragraph after it on the page. Every entry of every selector list,
  // in every rule, nested rules, @media and @supports included. In a NESTED rule "&" is
  // the elements of the rule it stands in, whose own selectors are in this list and checked here,
  // so a nested rule may start at "&"; at the top of the stylesheet "&" is the page.
  for (const { text, selector, nested } of sheet.selectors) {
    const escape = selectorEscape(selector, prefix, nested);
    if (escape) refuse(SELECTOR_REFUSAL[escape](text.slice(0, 60), prefix));
  }
  // WHAT THE PARSER CANNOT READ IS REFUSED. A browser drops what it cannot read and reads on from a
  // place of its own choosing, so the bench vouches only for a stylesheet it reads whole. A rule
  // nested without "&" is such a part: the parser keeps it, and what follows it, as raw text.
  if (sheet.unreadable !== null) {
    refuse(`A component's stylesheet reads as CSS from its first character to its last, and "${sheet.unreadable}" does not. A browser drops such a part and reads on from a place of its own choosing, so the bench vouches only for a stylesheet it reads whole. `
      + `Write each rule as its selector and its declarations in braces. A rule nested inside another starts with "&": "& .${prefix}-cell { … }", "&:hover { … }".`);
  }
}

/** A class of the component's own: the prefix itself, or the prefix and a dash. */
const ownClass = (cls: string, prefix: string) => cls === prefix || cls.startsWith(prefix + '-');

const PAGE_TYPES = new Set(['html', 'body']);
const PAGE_PSEUDOS = new Set(['root', 'scope', 'host', 'host-context', 'slotted']);
/** Pseudo-classes whose argument is a list the element ITSELF matches, or does not. */
const ELEMENT_CONDITIONS = new Set(['is', 'where', 'not', 'matches', '-webkit-any', '-moz-any']);
const NTH = new Set(['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']);
/** How deep a check follows pseudo-classes inside pseudo-classes before it stops vouching. */
const MAX_DEPTH = 4;

type SelectorEscape = 'anchor' | 'page' | 'beside' | 'reach' | 'unreadable';

const SELECTOR_REFUSAL: Record<SelectorEscape, (sel: string, prefix: string) => string> = {
  anchor: (sel, prefix) => `Every rule in a component's stylesheet starts at one of its own classes (".${prefix}" or ".${prefix}-…"), and a rule nested inside another may start at "&": "${sel}" does not, so it would restyle the page it lands in.`,
  page: sel => `"${sel}" names the page itself (html, body, :root, :scope, :host, "&" outside a rule, or * at the start). A component's rules stay inside the component.`,
  beside: sel => `"${sel}" reaches from the component to an element beside it. After "+" or "~" the next element is one of the component's own classes too, or the rule would restyle the page around it.`,
  reach: sel => `"${sel}" reaches out of the element it styles. :is(), :where() and :not() take plain conditions on that element, and :has() looks only down into it, never beside or above it.`,
  unreadable: sel => `"${sel}" does not read as a selector the bench can follow the way a browser does. Write the component's own classes joined by spaces or ">", and "+" or "~" between two of its own classes.`,
};

/** The alternatives of a condition list, each a single compound, or why they are not. */
function conditionCompounds(list: Array<ComplexSelector | null>): Compound[] | 'reach' | 'unreadable' {
  const out: Compound[] = [];
  for (const x of list) {
    if (!x) return 'unreadable';
    if (x.lead || x.compounds.length !== 1) return 'reach';
    out.push(x.compounds[0]);
  }
  return out;
}

/**
 * Is this compound one of the component's own elements? Its own class written on it, "&" in a
 * nested rule (the elements of the rule it stands in, whose selectors are checked on their own), or
 * an `:is()` or `:where()` every alternative of which is one: `:where(.wkgrid-cell)` keeps the
 * specificity at nothing, which is how a component loses to the page it lands in.
 */
function isOwnCompound(c: Compound, prefix: string, nested: boolean, depth = 0): boolean {
  if (c.classes.some(cls => ownClass(cls, prefix)) || (nested && c.nesting)) return true;
  if (depth >= MAX_DEPTH) return false;
  return c.pseudos.some(p => {
    if (p.element || p.arg?.kind !== 'list' || (p.name !== 'is' && p.name !== 'where')) return false;
    const alts = conditionCompounds(p.arg.list);
    return Array.isArray(alts) && alts.length > 0 && alts.every(a => isOwnCompound(a, prefix, nested, depth + 1));
  });
}

/**
 * Why a compound reaches the page, its functional pseudo-classes followed down, or null. A pseudo's
 * argument is what the CSS parser made of it (component-scan.ts Pseudo), so a pseudo it does not
 * know, whose argument it keeps as raw text, cannot be followed and is refused, unless that text is
 * only words and numbers. "&" outside a nested rule is the page (:scope, the document's root).
 */
function compoundEscape(c: Compound, prefix: string, first: boolean, nested: boolean, depth = 0): SelectorEscape | null {
  if (c.types.some(t => PAGE_TYPES.has(t)) || (first && c.types.includes('*')) || (c.nesting && !nested)) return 'page';
  for (const p of c.pseudos) {
    if (PAGE_PSEUDOS.has(p.name)) return 'page';
    const arg = p.arg;
    if (arg === null) continue;
    if (depth >= MAX_DEPTH || arg.kind === 'unreadable') return 'unreadable';
    if (arg.kind === 'plain') continue;
    let inner: Compound[] = [];
    if (!p.element && ELEMENT_CONDITIONS.has(p.name) && arg.kind === 'list') {
      const alts = conditionCompounds(arg.list);
      if (!Array.isArray(alts)) return alts;
      inner = alts;
    } else if (!p.element && p.name === 'has' && arg.kind === 'list') {
      // A relative selector that looks DOWN: into the element (` `) or at its children (`>`).
      for (const x of arg.list) {
        if (!x) return 'unreadable';
        if ((x.lead && x.lead !== '>') || x.combinators.some(k => k !== ' ' && k !== '>')) return 'reach';
        inner.push(...x.compounds);
      }
    } else if (!p.element && NTH.has(p.name) && arg.kind === 'nth') {
      if (arg.of) {
        const alts = conditionCompounds(arg.of);
        if (!Array.isArray(alts)) return alts;
        inner = alts;
      }
    } else {
      // A selector list or a step where this pseudo takes neither: nothing the check can follow.
      return 'unreadable';
    }
    for (const x of inner) {
      const escape = compoundEscape(x, prefix, false, nested, depth + 1);
      if (escape) return escape;
    }
  }
  return null;
}

/**
 * Why this selector could style something outside the component, or null when every element it can
 * reach is the component's own. It starts at one of the component's own elements; going down (` `,
 * `>`) stays inside; going sideways (`+`, `~`) stays inside once the chain has gone down at least
 * once, because siblings share their parent, and otherwise only onto another of the component's own
 * elements, because the one it started at may be the component's root with the page all around it.
 * In a nested rule "&" is one of the component's own elements, as its own class is: it stands for
 * the elements of the rule it is nested in, and that rule's selectors are checked on their own.
 */
function selectorEscape(x: ComplexSelector | null, prefix: string, nested: boolean): SelectorEscape | null {
  if (!x) return 'unreadable';
  if (x.lead || !isOwnCompound(x.compounds[0], prefix, nested)) return 'anchor';
  let below = false;
  for (const [i, c] of x.compounds.entries()) {
    if (i > 0) {
      const k = x.combinators[i - 1];
      if (k === ' ' || k === '>') below = true;
      else if (!below && !isOwnCompound(c, prefix, nested)) return 'beside';
    }
    const escape = compoundEscape(c, prefix, i === 0, nested);
    if (escape) return escape;
  }
  return null;
}

/**
 * The bench proper: the prefix, the markup under it and the stylesheet under it. What a proposal
 * passes before it lands, and what a stored body passes again before anything reads it.
 */
function benchTexts(prefix: string, html: string, css: string): void {
  if (!PREFIX_RE.test(prefix)) refuse('A component names its class prefix: 2-12 lowercase letters and digits, starting with a letter, like "wkgrid". Every class it uses starts with it.');
  if (prefix === 'ak' || prefix === 'aimeat') refuse(`"${prefix}" is the kit's prefix. Choose one of the component's own.`);
  if (!html || html.length > COMPONENT_LIMITS.html) refuse(`A component carries its markup in \`html\`, up to ${COMPONENT_LIMITS.html} characters.`);
  if (!css || css.length > COMPONENT_LIMITS.css) refuse(`A component carries its stylesheet in \`css\`, up to ${COMPONENT_LIMITS.css} characters.`);
  checkMarkup(html, prefix);
  checkStyles(css, prefix);
}

export function validateComponentBody(raw: unknown): ComponentBody {
  const o = (raw ?? {}) as Record<string, unknown>;
  const prefix = str(o.prefix).trim();
  const html = str(o.html).trim();
  const css = str(o.css).trim();
  benchTexts(prefix, html, css);

  const use = str(o.use).replace(/\s+/g, ' ').trim();
  if (use.length < 20 || use.length > COMPONENT_LIMITS.use) {
    refuse(`A component says how an app uses it, in \`use\` (20-${COMPONENT_LIMITS.use} characters): what it fills, which data- hooks carry the values, and what the app wires itself, since a component carries no script.`);
  }

  const j = (o.judgement ?? {}) as Record<string, unknown>;
  const reach = str(j.reach);
  const why = str(j.why).replace(/\s+/g, ' ').trim();
  if (reach !== 'general' && reach !== 'special') {
    refuse('A component carries YOUR judgement of it: judgement.reach is "general" (another kind of app would use this) or "special" (it belongs to this one app). '
      + 'Be honest: a special one is still kept and listed, and a general one that nobody else wants clutters the shelf every builder reads.');
  }
  if (why.length < COMPONENT_LIMITS.whyMin || why.length > COMPONENT_LIMITS.why) {
    refuse(`judgement.why says in a sentence (${COMPONENT_LIMITS.whyMin}-${COMPONENT_LIMITS.why} characters) which other apps would use this, or why none would.`);
  }

  const fromApp = str(o.from_app).trim();
  if (fromApp && !/^[\w.-]{1,120}$/.test(fromApp)) refuse('from_app is the filename of one of your own published apps, like "habits.html".');
  return { prefix, html, css, use, judgement: { reach: reach as 'general' | 'special', why }, ...(fromApp ? { from_app: fromApp } : {}) };
}

/**
 * What an app gets when it takes the component: the two texts to paste, and how to wire it. They
 * are benched again first (componentBench): a builder pastes them into a page as they come, so a
 * body that no longer passes is refused here, not handed out, with the bench's reason.
 */
export function componentSnippet(body: ComponentBody): { html: string; css: string; use: string; prefix: string } {
  const shown = componentBench(body);
  if (!shown.passes) return refuse(`This component no longer passes the Design Book's bench, so it is not handed out. The bench says: ${shown.why} Its proposer can propose it again as the bench asks.`);
  return { html: shown.html, css: shown.css, use: body.use, prefix: body.prefix };
}

/** What the bench says of a body today: it passes, with the texts it read, or why it does not. */
export type ComponentBench = { passes: true; html: string; css: string } | { passes: false; why: string };

/** The bench's answer by the body's digest, so a stored body is benched once per process, not on every read of the shelf. */
const BENCHED = new Map<string, string | null>();
/** How many answers are kept. The Book is a bounded, curated set; past this, the oldest answer goes first. */
const BENCHED_KEPT = 1000;

/** The three texts the bench reads, trimmed as it reads them. */
function benchedTexts(body: unknown): { prefix: string; html: string; css: string } {
  const o = (body ?? {}) as Record<string, unknown>;
  return { prefix: str(o.prefix).trim(), html: str(o.html).trim(), css: str(o.css).trim() };
}

/** The digest of the texts the bench reads: two bodies with one digest get one answer. */
export function componentDigest(body: unknown): string {
  const { prefix, html, css } = benchedTexts(body);
  return createHash('sha256').update(JSON.stringify([prefix, html, css])).digest('base64');
}

/**
 * The markup and the stylesheet as the bench reads them TODAY, or why they no longer pass, in the
 * bench's own words. A body is benched when it is proposed and stored as it passed; the bench has
 * learned since, and what this node serves, lists or hands out cannot lean on a check made under
 * older rules. The answer depends on nothing but the body, so it is kept by the body's digest.
 */
export function componentBench(body: unknown): ComponentBench {
  const { prefix, html, css } = benchedTexts(body);
  const key = componentDigest(body);
  let why = BENCHED.get(key);
  if (why === undefined) {
    why = benchWhy(prefix, html, css);
    if (BENCHED.size >= BENCHED_KEPT) BENCHED.delete(BENCHED.keys().next().value as string);
    BENCHED.set(key, why);
  }
  return why === null ? { passes: true, html, css } : { passes: false, why };
}

/** The propose bench's own checks (benchTexts), as an answer: null when the texts pass, and why when they do not. */
function benchWhy(prefix: string, html: string, css: string): string | null {
  try {
    benchTexts(prefix, html, css);
    return null;
  } catch (err) {
    if (err instanceof DesignBookError) return err.message;
    throw err;
  }
}

/** What a reader of a component is told about the bench (DesignBookService.get). */
export type ComponentBenchRead = { passes: true } | { passes: false; why: string; note: string };

/**
 * A component's body as one reader gets it, with the bench's answer. A body that no longer passes
 * keeps its markup and its stylesheet from everyone but its proposer, who needs them to fix it:
 * nobody can take it, and a text the bench refuses is not handed out to paste.
 */
export function componentAsRead(body: Record<string, unknown>, bench: ComponentBench, proposer: boolean): { body: Record<string, unknown>; bench: ComponentBenchRead } {
  if (bench.passes) return { body, bench: { passes: true } };
  if (proposer) {
    return { body, bench: { passes: false, why: bench.why, note: 'This component no longer passes the bench, for the reason in `why`. Its markup and stylesheet are here as stored, for you to fix: propose it again under the same id. Until then nobody can take it, and search and the map leave it out.' } };
  }
  const rest = { ...body };
  delete rest.html;
  delete rest.css;
  return { body: rest, bench: { passes: false, why: bench.why, note: 'This component no longer passes the bench, for the reason in `why`. Nobody can take it, search and the map leave it out, and only its proposer is shown its markup and stylesheet.' } };
}

/**
 * The component as a page: the kit's stylesheet for the tokens, the component's own, its markup
 * on the page ground and again on a surface, so it is seen where an app would put it. No script.
 * `theme` is the ground the reader is on: a component reads the page's tokens, so the same markup
 * is a different picture in the dark, and the gallery asks for the one its reader is looking at.
 *
 * What it shows is benched again first (componentBench): a stored body that no longer passes is a
 * sentence saying so and why, and none of its markup or stylesheet reaches the page. The reason can
 * quote the stored body, so it is escaped: it is text on this node's page, never markup.
 */
export function componentPreviewHtml(body: ComponentBody, theme: 'light' | 'dark' = 'light'): string {
  const shown = componentBench(body);
  return [
    `<!DOCTYPE html><html lang="en" data-theme="${theme === 'dark' ? 'dark' : 'light'}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    '<style>body { margin: 0; background: var(--ak-bg); color: var(--ak-ink); font-family: var(--ak-font); }',
    '.dbc-stage { max-width: 960px; margin: 0 auto; padding: 24px 16px; display: grid; gap: 24px; }',
    '.dbc-surface { background: var(--ak-surface); border: var(--ak-line-w, 1px) solid var(--ak-line); border-radius: var(--ak-radius); padding: 16px; }',
    '</style>',
    shown.passes ? `<style>${shown.css.replace(/<\//g, '<\\/')}</style>` : '',
    '</head><body class="ak-root"><div class="dbc-stage">',
    ...(shown.passes
      ? [`<div>${shown.html}</div>`, `<div class="dbc-surface">${shown.html}</div>`]
      : [`<p>This component no longer passes the Design Book's bench, so it is not shown. The bench says: ${escapeHtml(shown.why)} Its proposer can propose it again as the bench asks.</p>`]),
    '</div></body></html>',
  ].join('\n');
}
