/**
 * @file test/unit/design-book-component.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The component bench: what a component may carry and what it may not. The good case
 *   is the part three measured builds each made by hand on 2026-09-20, a week grid a person ticks.
 * @version-history
 *   v1.16.0 — 2026-09-26 — A stylesheet that ends inside a block, a bracket, a comment, a string or a
 *     rule with no block is refused, by what is open, and one whose comments and strings close passes;
 *     the reader is timed on blocks and brackets left open.
 *     Four older inputs were stylesheets that end inside an unclosed block or a rule; they close it now,
 *     so each still reaches the check it asserts.
 *   v1.15.0 — 2026-09-26 — The at-rules are a list: @font-palette-values, @position-try, @function and
 *     @font-feature-values pass under a name that starts with the prefix and are refused under another,
 *     an at-rule off the list (@document, @charset, one nobody has named yet, a feature block outside
 *     @font-feature-values) is refused with the list, and the reader is timed on at-rules that define a name.
 *   v1.14.0 — 2026-09-26 — @layer, @page and @view-transition are refused, each by name; a @keyframes,
 *     @property or @counter-style whose name does not start with the prefix is refused with the
 *     prefixed form, and one whose name does passes, as does a use of the page's own names.
 *   v1.13.0 — 2026-09-26 — A stylesheet carrying @scope is refused wherever it stands, its name escaped
 *     or in capitals included, and the refusal shows the rule on the component's own classes; a string
 *     or a comment naming @scope passes.
 *   v1.12.0 — 2026-09-26 — The preview and the snippet say why a stored component no longer passes,
 *     the preview's words escaped.
 *   v1.11.0 — 2026-09-26 — A repeated attribute, a missing space between attributes and a "/" on a
 *     <div> each get their own sentence.
 *   v1.10.0 — 2026-09-26 — Markup that leaves an element open where it ends is refused, with the
 *     outermost open element named; implied end tags and self-closing SVG pass.
 *   v1.9.0 — 2026-09-26 — A pseudo whose argument is words and numbers passes (::part(label),
 *     :state(on), :nth-col(2n+1)); one whose argument is a selector the parser cannot read, and every
 *     pseudo that names the page, is refused.
 *   v1.8.0 — 2026-09-26 — A rule nested behind "&" reads "&" as the parent rule's own elements, and
 *     "&" at the top of the stylesheet as the page; a rule nested without "&" is refused with the
 *     forms that pass.
 *   v1.7.0 — 2026-09-26 — A stylesheet holding "</" is refused, in a comment or in a string, and the
 *     preview and the snippet bench a stored one again; "<\/" inside a string passes.
 *   v1.6.0 — 2026-09-26 — The stylesheet is read by the CSS parser (e82c9f26d729): a string passes
 *     whatever it holds (url(, @import, !important, a colour, an escaped url(), and only a real var()
 *     reads the page's tokens; an escape spells the name it stands in, in any case (R\47 B( is rgb();
 *     the column combinator is refused as a selector the bench cannot read; readStylesheet is timed at
 *     the ceiling, and at MAX_NESTING.
 *   v1.5.0 — 2026-09-26 — The markup is read by the HTML parser (1a0a15eb7b20): a character reference
 *     of any spelling is decoded, so a plain value holding one passes and an address spelled with one
 *     is refused as an address; a reference without its ";" is refused as markup that does not read
 *     cleanly; a tag the parser drops or reads as text is refused; readMarkup is timed at the ceiling.
 *   v1.4.0 — 2026-09-26 — What an escape stands for, and what a string holds, is never read as
 *     structure (e82c9f26d729): `p, .wkgrid\;.wkgrid` and a "{" in a string before a body rule are
 *     refused, a string may hold a brace or a semicolon, and cssAsRead writes an escaped "/*" as "__".
 *     Failed on the old code first.
 *   v1.3.0 — 2026-09-26 — An attribute value is read as a browser uses it (1a0a15eb7b20): a character
 *     reference other than &amp;, and a backslash, are refused, each of which made fill a url() the
 *     preview fetched. Failed on the old code first.
 *   v1.2.0 — 2026-09-24 — Every selector is read to its end: `.wkgrid ~ p` and `.wkgrid + *` reach the
 *     page beside the component and are refused, as are a :has() looking sideways, an :is() looking
 *     up and a rule naming the page; what stays inside the component still passes. The two new
 *     readers are timed like the others.
 *   v1.1.0 — 2026-09-24 — The bench reads what a browser reads (1a0a15eb7b20, e82c9f26d729): an "="
 *     with no name before it, a tag a browser reads as text or a comment, a closing tag carrying
 *     anything, and a stylesheet whose escapes, strings or comments hide url(), @import,
 *     position: fixed or !important. The preview benches the stored body again before it shows it.
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { validateComponentBody, componentPreviewHtml, componentSnippet, type ComponentBody } from '../../src/services/design-book/component.js';
import { validatePartInput, PART_KINDS } from '../../src/services/design-book/validate.js';
import { MAX_NESTING, readMarkup, readStylesheet } from '../../src/services/design-book/component-scan.js';

const WEEK_GRID = {
  prefix: 'wkgrid',
  html: '<div class="wkgrid" role="grid" aria-label="This week">'
    + '<div class="wkgrid-row" role="row"><span class="wkgrid-name" role="rowheader">Read</span>'
    + '<button class="wkgrid-cell" type="button" role="gridcell" aria-pressed="true" data-day="mon"></button>'
    + '<button class="wkgrid-cell wkgrid-cell-today" type="button" role="gridcell" aria-pressed="false" data-day="tue"></button>'
    + '</div></div>',
  css: '.wkgrid { display: grid; gap: var(--ak-gap, 8px); color: var(--ak-ink); }\n'
    + '.wkgrid-row { display: grid; grid-template-columns: minmax(0, 1fr) repeat(7, 40px); align-items: center; }\n'
    + '.wkgrid-cell { min-height: 40px; border: var(--ak-line-w, 1px) solid var(--ak-line); background: var(--ak-surface); border-radius: var(--ak-radius-sm); }\n'
    + '.wkgrid-cell[aria-pressed="true"] { background: var(--ak-accent); border-color: var(--ak-accent); }\n'
    + '.wkgrid-cell-today { outline: 2px solid color-mix(in oklab, var(--ak-accent) 60%, var(--ak-bg)); }\n'
    + '@media (max-width: 480px) { .wkgrid-row { grid-template-columns: minmax(0, 1fr) repeat(7, 32px); } }',
  use: 'One .wkgrid-row per thing, seven .wkgrid-cell buttons with data-day. The app toggles aria-pressed on click and saves; mark today with .wkgrid-cell-today.',
  judgement: { reach: 'general', why: 'Any app where a person ticks days against rows uses it: habits, chores, medication, attendance, watering plants.' },
  from_app: 'habits.html',
};
const bad = (patch: Record<string, unknown>) => () => validateComponentBody({ ...WEEK_GRID, ...patch });

describe('the component bench', () => {
  it('the week grid three builders made by hand passes, whole', () => {
    const body = validateComponentBody(WEEK_GRID);
    expect(body.prefix).toBe('wkgrid');
    expect(body.judgement.reach).toBe('general');
    expect(componentSnippet(body).use).toMatch(/aria-pressed/);
    expect(PART_KINDS).toContain('component');
    expect(validatePartInput({ id: 'comp-week-grid', kind: 'component', title: 'A week you tick', summary: 'Rows against seven days, every cell a button.', body: WEEK_GRID }).kind).toBe('component');
  });

  it('carries no script, in any of the ways script gets in', () => {
    expect(bad({ html: '<div class="wkgrid"><script>alert(1)</script></div>' })).toThrow(/may not carry <script>/);
    expect(bad({ html: '<div class="wkgrid" onclick="x()"></div>' })).toThrow(/attribute "onclick"/);
    expect(bad({ html: '<div class="wkgrid"><a href="javascript:x()">x</a></div>' })).toThrow(/may not carry <a>/);
    expect(bad({ html: '<div class="wkgrid"><iframe></iframe></div>' })).toThrow(/may not carry <iframe>/);
    expect(bad({ html: '<div class="wkgrid"><img src="x"></div>' })).toThrow(/may not carry <img>/);
    expect(bad({ html: '<div class="wkgrid" style="color:red"></div>' })).toThrow(/attribute "style"/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-x { background: url(https://evil.example/x.png); color: var(--ak-ink); }' })).toThrow(/no url\(\)/);
    expect(bad({ css: '@import "https://evil.example/a.css";\n' + WEEK_GRID.css })).toThrow(/loads nothing/);
  });

  it('agrees with a browser on where a tag ends, so nothing rides in behind a quoted ">"', () => {
    // Read to the first ">" of any kind, this is the tag `div class="wkgrid" title="x` and some text;
    // a browser ends the tag after the quoted value and sees the handler.
    expect(bad({ html: '<div class="wkgrid" title="x>" onclick="steal()"></div>' })).toThrow(/quote or an angle bracket|attribute "onclick"/);
    expect(bad({ html: '<div class="wkgrid" title=x"y><script>alert(1)</script>' })).toThrow();
    expect(bad({ html: '<div class="wkgrid" data-x="a<b"></div>' })).toThrow(/quote or an angle bracket/);
    expect(bad({ html: '<div class="wkgrid"' })).toThrow(/never meets its ">"/);
    expect(bad({ html: '<div class="wkgrid" title="never closed></div>' })).toThrow(/never meets its ">"/);
    // A browser drops tabs and newlines inside a scheme, so the bench does before it looks.
    expect(bad({ html: '<div class="wkgrid" title="java\tscript:x()"></div>' })).toThrow(/may not carry an address/);
    expect(bad({ html: '<svg class="wkgrid"><path class="wkgrid-p" d="java\nscript:alert(1)"></path></svg>' })).toThrow(/may not carry an address/);
  });

  // 1a0a15eb7b20: each of these passed the bench, and a browser ran the script in it. A browser
  // reads an "=" where it expects a name as the NAME, quotes and all, and ends the tag at the first
  // ">"; it reads "</ div" as a comment that ends at the first ">"; it reads the attributes of a
  // closing tag like any other. The bench read a quoted value there, so the <script> was inside it.
  it('reads an attribute region the way a browser does, and refuses what it cannot read cleanly', () => {
    expect(bad({ html: '<div class="wkgrid" ="><script>alert(1)</script>"></div>' })).toThrow(/"=" stands where a browser expects/);
    expect(bad({ html: '<div class="wkgrid" = "><script>alert(1)</script>"></div>' })).toThrow(/"=" stands where a browser expects/);
    expect(bad({ html: '<div class="wkgrid" hidden/="><script>alert(1)</script>"></div>' })).toThrow();
    expect(bad({ html: '<div class="wkgrid"></div ="><script>alert(1)</script>">' })).toThrow(/closing tag carries nothing/);
    expect(bad({ html: '<div class="wkgrid"></div title="><script>alert(1)</script>">' })).toThrow(/closing tag carries nothing/);
    expect(bad({ html: '<div class="wkgrid"></ div title="><script>alert(1)</script>">' })).toThrow(/right after "<" or "<\/"/);
    expect(bad({ html: '<div class="wkgrid">< div title="x"></div>' })).toThrow(/right after "<" or "<\/"/);
    // The reader says so itself, from the parser's own error: nothing it could not read is dropped on the floor.
    expect(readMarkup('<div class="wkgrid" ="><script>x</script>"></div>').problem).toEqual({ kind: 'equals', element: 'div' });
    expect(readMarkup('<div></ div title="><script>x</script>">').problem).toEqual({ kind: 'tag-start' });
    expect(readMarkup('<div></div title="x">').problem).toEqual({ kind: 'closing', element: 'div', rest: ' title="x"' });
    // What a browser and the bench agree on still passes: a self-closing SVG path, a bare attribute.
    expect(() => validateComponentBody({ ...WEEK_GRID, html: '<div class="wkgrid" hidden><svg class="wkgrid-i" viewBox="0 0 8 8"><path class="wkgrid-p" d="M0 0L8 8"/></svg><br/></div >' })).not.toThrow();
  });

  // 1a0a15eb7b20, the value: a browser decodes a character reference in an attribute value before
  // anything uses it, and reads an SVG presentation attribute (fill, stroke) as a style value, where
  // an escape resolves. The checks read the decoded value, and a value holding a backslash is refused.
  it('reads an attribute value as a browser uses it: decoded, and with no escape', () => {
    const svg = (attr: string) => ({ html: `<svg class="wkgrid-i" viewBox="0 0 8 8"><rect class="wkgrid-r" width="8" height="8" ${attr}></rect></svg>` });
    expect(bad(svg('fill="u\\72 l(https://e.example/p.svg#g)"'))).toThrow(/backslash/);
    expect(bad(svg('stroke="u\\rl(https://e.example/p.svg#g)"'))).toThrow(/backslash/);
    expect(bad(svg('stroke="u&#92;rl(https://e.example/p.svg#g)"'))).toThrow(/backslash/);
    // The reader hands over what a browser uses: every reference decoded, whatever its spelling.
    const [, rect] = readMarkup('<svg><rect fill="u&#114;l(x)" stroke="&#x75;rl(y)" aria-label="A &ndash; B &amp; C" data-a="&lpar;"></rect></svg>').elements;
    expect(rect.attrs).toEqual([
      { name: 'fill', value: 'url(x)' }, { name: 'stroke', value: 'url(y)' }, { name: 'aria-label', value: 'A – B & C' }, { name: 'data-a', value: '(' },
    ]);
    // An SVG name comes back lower-cased, as the allowlist spells it, and a prefixed one keeps its prefix.
    expect(readMarkup('<svg viewBox="0 0 8 8"><linearGradient xlink:href="#g"></linearGradient></svg>').elements).toEqual([
      { name: 'svg', attrs: [{ name: 'viewbox', value: '0 0 8 8' }] },
      { name: 'lineargradient', attrs: [{ name: 'xlink:href', value: '#g' }] },
    ]);
    expect(() => validateComponentBody({ ...WEEK_GRID, html: WEEK_GRID.html.replace('aria-label="This week"', 'aria-label="Read &amp; write"') })).not.toThrow();
  });

  // What the parser builds is what is checked, so a tag it drops or reads as text is refused where it
  // stands: to a browser that reads the same text in another place, it is a tag.
  it('checks every tag the parser builds, and refuses a "<" that starts none', () => {
    expect(bad({ html: '<div class="wkgrid"><td class="wkgrid-c" onclick="x()">1</td></div>' })).toThrow(/starts no tag a browser reads in that place/);
    expect(bad({ html: '<textarea class="wkgrid-t"><script>alert(1)</script></textarea>' })).toThrow(/starts no tag a browser reads in that place/);
    expect(bad({ html: '<select class="wkgrid-s"><option>a</option><title><script>alert(1)</script></title></select>' })).toThrow(/may not carry <script>|starts no tag/);
    expect(bad({ html: '<div class="wkgrid"><body onload="x()"></body></div>' })).toThrow(/starts no tag a browser reads in that place/);
    expect(bad({ html: '<svg class="wkgrid-i"><![CDATA[><script>alert(1)</script>]]></svg>' })).toThrow(/starts no tag a browser reads in that place/);
    expect(bad({ html: '<div class="wkgrid">x</p></div>' })).toThrow(/starts no tag a browser reads in that place/);
    expect(bad({ html: '<div class="wkgrid"/>' })).toThrow(/ignores the "\/"/);
    // Markup a browser and the parser agree on passes: a table with its rows, a list closed by its end
    // tag, text with its references, a textarea whose text holds no "<".
    for (const html of [
      '<table class="wkgrid"><tr><td>1</td></tr></table>',
      '<ul class="wkgrid"><li>a<li>b</ul>',
      '<p class="wkgrid">Tom &amp; Jerry &lt;3 &copy; 2026</p>',
      '<textarea class="wkgrid-t">a &lt; b</textarea>',
      '<pre class="wkgrid">\nx</pre>',
    ]) {
      expect(() => validateComponentBody({ ...WEEK_GRID, html }), html).not.toThrow();
    }
  });

  // 1a0a15eb7b20, read by the HTML parser: a character reference is decoded where a browser decodes
  // it, and the decoded value is what the checks read. A plain value holding one passes; an address
  // spelled with one is refused as an address.
  it('decodes every character reference in a value, and checks what it decodes to', () => {
    const labelled = (label: string) => ({ ...WEEK_GRID, html: WEEK_GRID.html.replace('aria-label="This week"', `aria-label="${label}"`) });
    expect(() => validateComponentBody(labelled('Mon &ndash; Sun'))).not.toThrow();
    expect(() => validateComponentBody(labelled('&#169; 2026, Tom &#x26; Jerry'))).not.toThrow();
    expect(() => validateComponentBody(labelled('Read &AMP; write'))).not.toThrow();
    const svg = (attr: string) => ({ html: `<svg class="wkgrid-i" viewBox="0 0 8 8"><rect class="wkgrid-r" width="8" height="8" ${attr}></rect></svg>` });
    expect(bad(svg('fill="u&#114;l(https://e.example/p.svg#g)"'))).toThrow(/may not carry an address/);
    expect(bad(svg('fill="&#x75;rl(https://e.example/p.svg#g)"'))).toThrow(/may not carry an address/);
    expect(bad(svg('fill="url&lpar;https://e.example/p.svg#g)"'))).toThrow(/may not carry an address/);
    expect(bad(svg('fill=u&#114;l(https://e.example/p.svg#g)'))).toThrow(/may not carry an address/);
    // Without its semicolon a reference still decodes, and the parser says the markup is not clean.
    expect(bad(svg('fill="u&#114l(https://e.example/p.svg#g)"'))).toThrow(/does not read cleanly/);
    expect(bad({ html: WEEK_GRID.html.replace('aria-label="This week"', 'aria-label="&copy 2026"') })).toThrow(/does not read cleanly/);
  });

  // e82c9f26d729: a browser resolves CSS escapes, so each of these is url(), @import, fixed or
  // !important to it; and it has no comment inside a string or behind a backslash, so a "comment"
  // the bench skipped over was rules to a browser.
  it('reads the stylesheet the way a browser does: escapes resolved, comments only where a browser has one', () => {
    const rule = (decl: string) => `\n.wkgrid-x { ${decl}; color: var(--ak-ink); }`;
    expect(bad({ css: WEEK_GRID.css + rule('background: u\\rl(https://evil.example/x.png)') })).toThrow(/no url\(\)/);
    expect(bad({ css: WEEK_GRID.css + rule('background: \\75 rl(https://evil.example/x.png)') })).toThrow(/no url\(\)/);
    expect(bad({ css: '@\\import "https://evil.example/a.css";\n' + WEEK_GRID.css })).toThrow(/loads nothing/);
    expect(bad({ css: WEEK_GRID.css + rule('position: f\\ixed') })).toThrow(/position/);
    expect(bad({ css: WEEK_GRID.css + rule('p\\osition: fixed') })).toThrow(/position/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-x { color: var(--ak-ink) !\\important; }' })).toThrow(/no !important/);
    expect(bad({ css: WEEK_GRID.css + rule('color: r\\gb(0, 0, 0)') })).toThrow(/never a literal/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-a::before { content: "/*"; }\n.wkgrid-b { background: url(https://evil.example/x.png); }\n.wkgrid-c::before { content: "*/"; }' })).toThrow(/no url\(\)/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-a\\/* { }\n.wkgrid-b { background: url(https://evil.example/x.png); }\n.wkgrid-c { color: var(--ak-ink); } */ { }' })).toThrow(/no url\(\)/);
    // A value handed in through a custom property is not the word the bench reads, so position is a word.
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-x { --wkgrid-p: fixed; position: var(--wkgrid-p); color: var(--ak-ink); }' })).toThrow(/position/);
    // image-set() takes its address as a string, with no url( in sight.
    expect(bad({ css: WEEK_GRID.css + rule('background-image: image-set("https://evil.example/x.png" 1x)') })).toThrow(/no url\(\)/);
    // The tokenizer resolves an escape inside the name it stands in, and a comment or a string
    // holds no function: what is left is what a browser reads.
    expect(readStylesheet('a { b: \\75 rl(x) /* image-set( */ "src(" v\\61r(--ak-ink); }')).toMatchObject({ functions: ['url', 'var'], readsPageTokens: true });
    // An escape a real component uses, a tick drawn by the stylesheet, still passes.
    expect(() => validateComponentBody({ ...WEEK_GRID, css: WEEK_GRID.css + '\n.wkgrid-cell[aria-pressed="true"]::after { content: "\\2713"; position: absolute; color: var(--ak-accent-ink); }' })).not.toThrow();
  });

  // e82c9f26d729: a browser reads `\;` as part of a class name and a "{" inside a string as text, so
  // each of these styles the page around the component. The bench reads them the same way.
  it('never reads what an escape stands for, or what a string holds, as structure', () => {
    // A browser reads the class `wkgrid;` and styles every p on the page.
    expect(bad({ css: WEEK_GRID.css + '\np, .wkgrid\\;.wkgrid { display: none; }' })).toThrow(/starts at one of its own classes/);
    // A "{" in a string opens no block, so the rule after @keyframes is read, and it names the page.
    expect(bad({ css: WEEK_GRID.css + '\n@keyframes wkgrid-a { from { content: "{"; } }\nbody { display: none; }' })).toThrow(/starts at one of its own classes/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-a::before { content: "}"; }\nbody { display: none; }' })).toThrow(/starts at one of its own classes/);
    // An escaped quote, written plain or in hex, does not end the string to a browser.
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-a::before { content: "\\22"; }\nbody { display: none; }' })).toThrow(/starts at one of its own classes/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-a::before { content: "\\""; }\nbody { display: none; }' })).toThrow(/starts at one of its own classes/);
    // An escaped character is part of the name it stands in: `.a\;b` is the one class `a;b`.
    expect(readStylesheet('.a\\;b { c: d }').selectors[0].selector?.compounds[0].classes).toEqual(['a;b']);
    expect(readStylesheet('@keyframes k { from { content: "{"; } }\nbody { color: red; }').selectors.map(s => s.text)).toEqual(['body']);
    expect(readStylesheet('.a { content: ";position: fixed"; color: red }').declarations.map(d => d.property)).toEqual(['content', 'color']);
    // A string may hold a brace, a semicolon or a quote of the other kind, and a real component passes.
    expect(() => validateComponentBody({ ...WEEK_GRID, css: WEEK_GRID.css + '\n.wkgrid-cell[data-mark="{;}"]::after { content: "a;b{c}\'"; color: var(--ak-ink); }' })).not.toThrow();
  });

  // e82c9f26d729, read by the CSS parser: a string is one token, whatever it holds, and an escape is
  // resolved inside the name it belongs to. What a string holds loads nothing and sets nothing.
  it('reads a string as text, whatever it holds, and an escaped name as the name it spells', () => {
    const rule = (decl: string) => ({ css: `${WEEK_GRID.css}\n.wkgrid-x::before { ${decl}; color: var(--ak-ink); }` });
    for (const decl of [
      'content: "see url(x)"', 'content: "@import"', 'content: "!important"', 'content: "#fff rgb(0, 0, 0)"',
      'content: "\\75 rl(x)"', 'content: \'image-set("x" 1x)\'',
    ]) {
      expect(() => validateComponentBody({ ...WEEK_GRID, ...rule(decl) }), decl).not.toThrow();
    }
    // A string that names the page's tokens does not read them.
    expect(bad({ css: '.wkgrid::before { content: "var(--ak-ink)"; color: red; }' })).toThrow(/reads the page's tokens/);
    // An escape spells the name it stands in, in any case: R\47 B( is rgb( to a browser.
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-x { color: R\\47 B(0 0 0); }' })).toThrow(/never a literal/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-x { background: u\\72 l("https://evil.example/x.png"); }' })).toThrow(/no url\(\)/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-x { background: \\55 RL(https://evil.example/x.png); }' })).toThrow(/no url\(\)/);
    // What follows a string is still read: the rule after it names the page and is refused.
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-a::before { content: "a;b}{"; }\nbody { display: none; }' })).toThrow(/starts at one of its own classes/);
  });

  // The preview, and the page an app pastes the component into, put the stylesheet in a <style>
  // element, which the first "</style" ends. No "</" is allowed anywhere, so the stylesheet reads the
  // same wherever it lands.
  it('carries no "</", so every page reads the stylesheet as the bench does', () => {
    const commented = WEEK_GRID.css + '\n@media (width </* ) { } .wkgrid-x { background: url(https://evil.example/x.png) } @media ( */ 600px) { .wkgrid-y { color: var(--ak-ink); } }';
    expect(bad({ css: commented })).toThrow(/carries no "<\/"/);
    expect(componentPreviewHtml({ ...WEEK_GRID, css: commented } as unknown as ComponentBody)).not.toContain('evil.example');
    const closing = WEEK_GRID.css + '\n.wkgrid-x::before { content: "</style><p>"; color: var(--ak-ink); }';
    expect(bad({ css: closing })).toThrow(/carries no "<\/"/);
    expect(() => componentSnippet({ ...WEEK_GRID, css: closing } as unknown as ComponentBody)).toThrow(/no longer passes/);
    // Inside a string, "<\/" reads the same and passes.
    expect(() => validateComponentBody({ ...WEEK_GRID, css: WEEK_GRID.css + '\n.wkgrid-x::before { content: "<\\/p>"; color: var(--ak-ink); }' })).not.toThrow();
  });

  // An app pastes the stylesheet into its page before the page's own rules. What is still open
  // where the stylesheet ends takes those rules in: they nest under a rule of the component, apply
  // only in print, or vanish inside a comment or a string.
  it('ends at the top of the stylesheet: a block, a comment, a string, a bracket or a rule still open where it ends is refused, by what is open', () => {
    for (const [tail, message] of [
      ['\n.wkgrid-cell { color: var(--ak-ink);',
        /The block of "\.wkgrid-cell" is still open where the stylesheet ends, so it would take in whatever a page writes after the component\. Close every block inside the stylesheet: "\.wkgrid-cell \{ … \}"\./],
      ['\n@media print {', /The block of "@media print" is still open where the stylesheet ends/],
      ['\n@media print { .wkgrid-x { color: var(--ak-ink); }', /The block of "@media print" is still open where the stylesheet ends/],
      ['\n.wkgrid-row { color: var(--ak-ink); & .wkgrid-x { color: var(--ak-ink);', /The block of "& \.wkgrid-x" is still open where the stylesheet ends/],
      ['\n/* rest of page', /The comment "\/\* rest of page" is still open where the stylesheet ends.*Close every comment inside the stylesheet: "\/\* … \*\/"\./],
      ['\n/*/', /The comment "\/\*\/" is still open where the stylesheet ends/],
      ['\n.wkgrid-x::after { content: "abc', /The string "abc is still open where the stylesheet ends.*Close every string inside the stylesheet with the quote it starts with\./],
      ['\n.wkgrid-x::after { content: \'a\\\'', /The string 'a\\' is still open where the stylesheet ends/],
      ['\n@media (min-width: 1px', /The "\(" of "@media \(min-width: 1px" is still open where the stylesheet ends.*Close every bracket inside the stylesheet: "\( … \)"\./],
      ['\n.wkgrid-x { background: color-mix(in oklab, var(--ak-ink)', /The "\(" of "background: color-mix\(in oklab, var\(--ak-ink\)" is still open/],
      ['\n.wkgrid-x[data-a', /The "\[" of "\.wkgrid-x\[data-a" is still open where the stylesheet ends.*"\[ … \]"/],
      ['\n@media print', /The rule "@media print" is still open where the stylesheet ends: it has no block yet, so the first rule a page writes after the component would join it\. Give every rule its block inside the stylesheet: "@media print \{ … \}"\./],
      ['\n.wkgrid-x', /The rule "\.wkgrid-x" is still open where the stylesheet ends/],
      ['\n.wkgrid-x { color: var(--ak-ink); } }', /The "\}" at the top of the stylesheet has no rule before it, so a browser reads it as the start of a rule that is still open where the stylesheet ends.*Take out the "\}"\./],
      ['\n.wkgrid-x { color: var(--ak-ink); };', /The ";" at the top of the stylesheet has no rule before it/],
    ]) {
      expect(bad({ css: WEEK_GRID.css + tail }), JSON.stringify(tail)).toThrow(message as RegExp);
    }
    // The reader says what is open: the comment or string the text ends in, else the innermost bracket or block, else a rule at the top with no block.
    expect(readStylesheet('.a { b: c').open).toEqual({ kind: 'block', text: '.a' });
    expect(readStylesheet('.a { b: c; } /* x').open).toEqual({ kind: 'comment', text: '/* x' });
    expect(readStylesheet('.a { b: "c').open).toEqual({ kind: 'string', text: '"c' });
    expect(readStylesheet('@media (a').open).toEqual({ kind: 'bracket', bracket: '(', text: '@media (a' });
    expect(readStylesheet('.a { } @media print').open).toEqual({ kind: 'rule', text: '@media print' });
    for (const css of ['.a { }', '.a { } /* end */', '.a { } /**/', '.a { b: "c\\\\" }', '@media print { .a { b: c } }', '.a { }\n<!--', '']) {
      expect(readStylesheet(css).open, css).toBeNull();
    }
    // What closes inside the stylesheet passes, a comment or a string holding a brace or "*/" included.
    for (const tail of ['\n/* the end */', '\n.wkgrid-x::after { content: "} /* *\\/ {"; color: var(--ak-ink); }', '\n@media print { .wkgrid-x { color: var(--ak-ink); } }']) {
      expect(() => validateComponentBody({ ...WEEK_GRID, css: WEEK_GRID.css + tail }), tail).not.toThrow();
    }
  });

  // Served from the node's own origin, so a body stored before the bench learned a trick is not
  // trusted for having passed once: the page shows only what passes the bench now.
  it('benches the stored body again before the preview shows any of it', () => {
    const stored = { ...WEEK_GRID, html: '<div class="wkgrid" ="><script>alert(1)</script>"></div>' } as unknown as ComponentBody;
    const page = componentPreviewHtml(stored);
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toContain('alert(1)');
    expect(page).toMatch(/no longer passes/);
    const styled = componentPreviewHtml({ ...WEEK_GRID, css: WEEK_GRID.css + '\n.wkgrid-x { background: u\\rl(https://evil.example/x.png); color: var(--ak-ink); }' } as unknown as ComponentBody);
    expect(styled).not.toContain('evil.example');
    // Taking it hands the two texts to a builder who pastes them into an app: the same bench first.
    expect(() => componentSnippet(stored)).toThrow(/no longer passes/);
    expect(componentSnippet(validateComponentBody(WEEK_GRID)).html).toContain('class="wkgrid"');
  });

  it('reads text that opens and never closes in bounded time, at the most the bench accepts', () => {
    // MEASURED 2026-09-20 on the patterns the first readers used, 40 000 openings each: the tag
    // pattern took 1.3 s, the comment strip 0.6 s, the at-rule strip 3.2 s and "animation … infinite"
    // 6.3 s. The parsers read the text once, and each costs more the deeper the text nests, so each
    // is handed no more than the bench's 12 000-character ceiling and timed here at it.
    const timed = (name: string, run: () => unknown) => {
      const started = performance.now();
      run();
      expect(performance.now() - started, name).toBeLessThan(400);
    };
    // The HTML parser's cost grows with how deep the markup nests (every new element looks down the
    // stack of open ones), so it is handed no more than the bench's ceiling. Measured 2026-09-26 at
    // 12 000 characters: 80 ms for the worst of seventeen shapes, and 9.4 s for <div> at 200 000.
    const ceiling = (unit: string, head = '') => head + unit.repeat(Math.floor((12_000 - head.length) / unit.length));
    for (const [shape, unit, head] of [
      ['tags', '<a '], ['attributes', 'a= ', '<div '], ['nesting', '<div>'], ['list items', '<li>', '<ul>'], ['misnesting', '<b>x</i>'],
      ['stray end tags', '</p>'], ['formatting', '<a><p>'], ['tables', '<table>'], ['references', '&#', '<div title="'],
    ]) timed(`markup, ${shape}`, () => readMarkup(ceiling(unit, head)));
    // The CSS parser's cost grows with how deep brackets and blocks nest, and it runs out of stack.
    // Measured 2026-09-26 at 12 000 characters: 570 ms for "@supports ((((…", and a RangeError for
    // "@media{@media{…". So it is not run on a stylesheet nesting deeper than MAX_NESTING.
    for (const [shape, unit, head] of [
      ['comments', '/* '], ['strings', '"a\\'], ['escapes', '\\75 '], ['declarations', 'animation ', '.a{'], ['strings in rules', '"{\'', '.a{'],
      ['flat at-rules', '@media '], ['selector lists', '.a, '], ['conditions', '(', '@supports '], ['blocks', '@media{'], ['nested rules', '& {', '.a{'],
      ['pseudo-classes', ':is(', '.a'], ['var fallbacks', 'var(--a,(', '.a{b:'], ['closed declarations', 'a:b; ', '.a{'],
      ['at-rules that define a name', '@keyframes '], ['custom functions', '@function --a('],
      ['blocks left open', '.a{b:c;'], ['brackets left open', '[(', '.a{b:'],
    ]) timed(`stylesheet, ${shape}`, () => readStylesheet(ceiling(unit, head)));
    // Nesting at the most the bench reads is parsed, and parsed quickly.
    timed('stylesheet, nested as deep as the bench reads', () => {
      expect(readStylesheet('@supports ' + '('.repeat(MAX_NESTING) + 'a' + ')'.repeat(MAX_NESTING) + ' {}').depth).toBe(MAX_NESTING);
    });
    // And through the bench itself, at the most it accepts.
    timed('the bench, markup', () => { try { validateComponentBody({ ...WEEK_GRID, html: '<div class="wkgrid">' + '<a '.repeat(3900) }); } catch { /* refused is the right answer */ } });
    timed('the bench, markup nesting', () => { try { validateComponentBody({ ...WEEK_GRID, html: ceiling('<div class="wkgrid">') }); } catch { /* refused is the right answer */ } });
    // The stored body a preview benches again gets the same ceiling, whatever its length.
    timed('the preview, a stored body past the ceiling', () => {
      expect(componentPreviewHtml({ ...WEEK_GRID, html: '<div class="wkgrid">' + '<div>'.repeat(40_000) } as unknown as ComponentBody)).toMatch(/no longer passes/);
    });
    timed('the bench, styles', () => { try { validateComponentBody({ ...WEEK_GRID, css: '.wkgrid { color: var(--ak-ink); }' + 'animation '.repeat(1100) }); } catch { /* refused is the right answer */ } });
    timed('the bench, selectors', () => { try { validateComponentBody({ ...WEEK_GRID, css: '.wkgrid { color: var(--ak-ink); }\n.wkgrid' + ':is(.wkgrid'.repeat(900) + ')'.repeat(900) + ' { color: var(--ak-ink); }' }); } catch { /* refused is the right answer */ } });
  });

  it('cannot reach outside itself', () => {
    expect(bad({ css: 'body { margin: 0; color: var(--ak-ink); }' })).toThrow(/starts at one of its own classes/);
    expect(bad({ css: '.ak-card { color: var(--ak-ink); }' })).toThrow(/starts at one of its own classes/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-bar { position: fixed; color: var(--ak-ink); }' })).toThrow(/no position: fixed/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-x { color: var(--ak-ink) !important; }' })).toThrow(/no !important/);
    expect(bad({ html: '<div class="wkgrid other-thing"></div>' })).toThrow(/starts with its prefix/);
    expect(bad({ prefix: 'ak' })).toThrow(/the kit's prefix/);
  });

  // A rule styles whatever its WHOLE selector reaches, which a browser reads to the end: the first
  // class says only where it starts. `.wkgrid ~ p` starts at the component and styles every
  // paragraph after it on the page.
  it('reads every selector to its end, and each one stays inside the component', () => {
    // `close` ends the blocks the selector opens, so the stylesheet ends at its top level.
    const rule = (selector: string, close = '') => ({ css: `${WEEK_GRID.css}\n${selector} { color: var(--ak-ink); }${close}` });
    expect(bad(rule('.wkgrid ~ p'))).toThrow(/beside it/);
    expect(bad(rule('.wkgrid + *'))).toThrow(/beside it/);
    expect(bad(rule('.wkgrid, body'))).toThrow(/starts at one of its own classes/);
    expect(bad(rule('@media (min-width: 1px) { .wkgrid-row ~ div', ' }'))).toThrow(/beside it/);
    expect(bad(rule('@supports (display: grid) { .wkgrid-a, .wkgrid-b + section', ' }'))).toThrow(/beside it/);
    expect(bad(rule('.wkgrid:has(~ p)'))).toThrow(/looks only down/);
    expect(bad(rule('.wkgrid-x:is(.page-theme .wkgrid-x)'))).toThrow(/looks only down/);
    expect(bad(rule('.wkgrid:not(body)'))).toThrow(/names the page itself/);
    expect(bad(rule('.wkgrid:root'))).toThrow(/names the page itself/);
    expect(bad(rule('*.wkgrid'))).toThrow(/names the page itself/);
    // The column combinator is not one the CSS parser reads, so the bench cannot follow it.
    expect(bad(rule('.wkgrid || td'))).toThrow(/does not read as a selector/);
    // Nested, "&" is .wkgrid-x, so this is `.wkgrid-x ~ p`: it reaches beside the component.
    expect(bad(rule('.wkgrid-x { & ~ p', ' }'))).toThrow(/beside it/);
    // …and what a component legitimately writes still passes: inside it, and between its own parts.
    for (const ok of [
      '.wkgrid > *', '.wkgrid li', '.wkgrid-row + .wkgrid-row', '.wkgrid-cell ~ .wkgrid-cell-today',
      '.wkgrid-cell:not(:last-child)', '.wkgrid-row:nth-child(2n+1)', '.wkgrid-cell:is(:hover, :focus-visible)',
      '.wkgrid:has(.wkgrid-cell[aria-pressed="true"])', '.wkgrid:has(> .wkgrid-row)', ':where(.wkgrid-cell)',
      '.wkgrid-cell[aria-pressed="true"]::after', 'div.wkgrid', '.wkgrid-a, .wkgrid-b',
    ]) {
      expect(() => validateComponentBody({ ...WEEK_GRID, ...rule(ok) }), ok).not.toThrow();
    }
  });

  // CSS nesting: inside a style rule, "&" is that rule's own elements, and every selector of that
  // rule is checked on its own. At the top of the stylesheet "&" is the page.
  it('reads "&" in a nested rule as the parent rule\'s own elements, and at the top as the page', () => {
    const nest = (inner: string) => ({ css: `${WEEK_GRID.css}\n.wkgrid-row { color: var(--ak-ink); ${inner} }` });
    for (const ok of [
      '& .wkgrid-cell { color: var(--ak-accent); }', '&:hover { color: var(--ak-accent); }', '& > span { color: var(--ak-accent); }',
      '&.wkgrid-on { color: var(--ak-accent); }', '& + & { margin-top: 4px; }', '& + .wkgrid-row { margin-top: 4px; }',
      '&::after { content: ""; }', '@media (max-width: 480px) { & .wkgrid-cell { min-height: 32px; } }',
      '& .wkgrid-cell { &:hover { color: var(--ak-accent); } }',
    ]) {
      expect(() => validateComponentBody({ ...WEEK_GRID, ...nest(ok) }), ok).not.toThrow();
    }
    // A nested rule reaches what the rule it stands for reaches: inside .wkgrid-row, `& ~ p` is `.wkgrid-row ~ p`.
    expect(bad(nest('& ~ p { color: var(--ak-accent); }'))).toThrow(/beside it/);
    expect(bad(nest('& + p { color: var(--ak-accent); }'))).toThrow(/beside it/);
    expect(bad(nest('&:has(~ p) { color: var(--ak-accent); }'))).toThrow(/looks only down/);
    expect(bad(nest('& :root { color: var(--ak-accent); }'))).toThrow(/names the page itself/);
    // The parent rule is checked too: under `p`, "&" is every paragraph on the page.
    expect(bad({ css: `${WEEK_GRID.css}\np { & .wkgrid-cell { color: var(--ak-accent); } }` })).toThrow(/starts at one of its own classes/);
    // At the top of the stylesheet "&" is the page, wherever it stands in the selector.
    expect(bad({ css: `${WEEK_GRID.css}\n& .wkgrid-cell { color: var(--ak-accent); }` })).toThrow(/starts at one of its own classes/);
    expect(bad({ css: `${WEEK_GRID.css}\n.wkgrid & { color: var(--ak-accent); }` })).toThrow(/names the page itself/);
    expect(bad({ css: `${WEEK_GRID.css}\n@media (min-width: 1px) { & p { color: var(--ak-accent); } }` })).toThrow(/starts at one of its own classes/);
    // Nesting without "&" stays refused, and the refusal shows the forms that pass.
    expect(bad(nest('.wkgrid-cell { color: var(--ak-accent); }'))).toThrow(/"& \.wkgrid-cell \{ … \}", "&:hover \{ … \}"/);
    expect(bad(nest('> .wkgrid-cell { color: var(--ak-accent); }'))).toThrow(/"& \.wkgrid-cell \{ … \}"/);
    expect(readStylesheet('.a { & .b { c: d } }').selectors.map(s => [s.text, s.nested])).toEqual([['.a', false], ['& .b', true]]);
  });

  // Inside @scope, "&" stands for the elements its prelude chooses, which can be outside the
  // component. A component's own classes already keep every rule inside it, so it carries no @scope.
  it('refuses @scope wherever it stands, and says how to write the rule on the component\'s own classes', () => {
    // Nested in a rule of the component, the prelude makes "&" the page's <body>.
    expect(bad({ css: `${WEEK_GRID.css}\n.wkgrid { @scope (body) { & p { color: var(--ak-accent); } } }` }))
      .toThrow(/carries no @scope, and a component does not need it.*"@scope \(\.wkgrid\) \{ \.wkgrid-cell \{ … \} \}" is "\.wkgrid \.wkgrid-cell \{ … \}", or "& \.wkgrid-cell \{ … \}" inside "\.wkgrid \{ … \}"/);
    for (const css of [
      `@scope (.wkgrid) { .wkgrid-cell { color: var(--ak-accent); } }\n${WEEK_GRID.css}`,
      `${WEEK_GRID.css}\n.wkgrid-row { @scope (.wkgrid-row) to (.wkgrid-cell) { & { color: var(--ak-accent); } } }`,
      `${WEEK_GRID.css}\n@media (min-width: 1px) { .wkgrid { @scope (html) { & .wkgrid-cell { color: var(--ak-accent); } } } }`,
      `${WEEK_GRID.css}\n.wkgrid { @SCOPE (body) { & p { color: var(--ak-accent); } } }`,
      `${WEEK_GRID.css}\n.wkgrid { @\\73 cope (body) { & p { color: var(--ak-accent); } } }`,
    ]) {
      expect(bad({ css }), css).toThrow(/carries no @scope/);
    }
    // What a string or a comment holds is text.
    for (const css of [`${WEEK_GRID.css}\n.wkgrid-cell::after { content: "@scope (body)"; }`, `${WEEK_GRID.css}\n/* no @scope here */`]) {
      expect(() => validateComponentBody({ ...WEEK_GRID, css }), css).not.toThrow();
    }
  });

  // A component's stylesheet reaches only the component. These three act on the whole page by nature.
  it.each([
    ['layer', '@layer wkgrid-base { .wkgrid-cell { color: var(--ak-accent); } }', /carries no @layer: the order of cascade layers belongs to the whole page.*":where\(\.wkgrid-cell\) \{ … \}"/],
    ['layer', '@layer wkgrid-base, wkgrid-top;', /carries no @layer: /],
    ['layer', '.wkgrid { @LAYER wkgrid-base { & .wkgrid-cell { color: var(--ak-accent); } } }', /carries no @layer: /],
    ['page', '@page { margin: 0; }', /carries no @page: it sets how the whole page prints.*How a page prints is the page's to say/],
    ['page', '@\\70 age :first { margin: 0; }', /carries no @page: /],
    ['view-transition', '@view-transition { navigation: auto; }', /carries no @view-transition: it sets how the whole page changes to the next one/],
  ])('refuses @%s, which acts on the whole page: %s', (_name, rule, message) => {
    expect(bad({ css: `${WEEK_GRID.css}\n${rule}` })).toThrow(message);
  });

  // A name one of these at-rules defines is shared by the whole page, so a component defines names
  // of its own only, and says which form passes.
  it.each([
    ['@keyframes fade { from { opacity: 0; } to { opacity: 1; } }',
      /defines the animation "fade" with @keyframes, a name the whole page shares.*"@keyframes wkgrid-fade", and use it as "animation-name: wkgrid-fade"/],
    ['@-webkit-keyframes fade { from { opacity: 0; } }', /defines the animation "fade" with @-webkit-keyframes.*"@-webkit-keyframes wkgrid-fade"/],
    ['@keyframes "ak-fade" { from { opacity: 0; } }', /defines the animation "ak-fade" with @keyframes.*"@keyframes wkgrid-ak-fade"/],
    ['@keyframes \\61 k-fade { from { opacity: 0; } }', /defines the animation "ak-fade" with @keyframes/],
    ['@keyframes wkgridx { from { opacity: 0; } }', /defines the animation "wkgridx" with @keyframes/],
    ['@keyframes wkgrid-a, fade { from { opacity: 0; } }', /"@keyframes wkgrid-a, fade" does not name one animation.*"@keyframes wkgrid-spin"/],
    ['@property --ak-ink { syntax: "*"; inherits: false; }',
      /defines the custom property "--ak-ink" with @property, a name the whole page shares.*"@property --wkgrid-ak-ink", and use it as "var\(--wkgrid-ak-ink\)"/],
    ['@property wkgrid-x { syntax: "*"; inherits: false; }', /defines the custom property "wkgrid-x" with @property.*"@property --wkgrid-wkgrid-x"/],
    ['@counter-style decimal { system: numeric; symbols: "0" "1"; }',
      /defines the counter style "decimal" with @counter-style, a name the whole page shares.*"@counter-style wkgrid-decimal", and use it as "list-style-type: wkgrid-decimal"/],
    ['@counter-style DISC { system: cyclic; symbols: "*"; }', /defines the counter style "disc" with @counter-style/],
    ['@font-palette-values --ak-pal { font-family: Inter; override-colors: 0 var(--ak-ink); }',
      /defines the font palette "--ak-pal" with @font-palette-values, a name the whole page shares.*"@font-palette-values --wkgrid-ak-pal", and use it as "font-palette: --wkgrid-ak-pal"/],
    ['@position-try --ak-top { top: 0; }',
      /defines the position fallback "--ak-top" with @position-try, a name the whole page shares.*"@position-try --wkgrid-ak-top", and use it as "position-try-fallbacks: --wkgrid-ak-top"/],
    ['@function --ak-gap() { result: 4px; }',
      /defines the custom function "--ak-gap" with @function, a name the whole page shares.*"@function --wkgrid-ak-gap\(\)", and use it as "--wkgrid-ak-gap\(\)"/],
    ['@font-feature-values Inter { @styleset { nice: 1; } }',
      /defines feature values for the font family "inter" with @font-feature-values, a family the whole page shares.*"@font-feature-values wkgrid-inter", and use it as "font-family: wkgrid-inter"/],
  ])('refuses %s: the name it defines does not start with the prefix', (rule, message) => {
    expect(bad({ css: `${WEEK_GRID.css}\n${rule}` })).toThrow(message);
  });

  // The at-rules a component's stylesheet may carry are a list, so an at-rule nobody has thought of
  // yet is refused too, and the refusal says what the list is.
  it.each([
    ['document', '@document url-prefix() { .wkgrid-cell { color: var(--ak-accent); } }'],
    ['charset', '@charset "utf-8";'],
    ['charset', '@\\63 harset "utf-8";'],
    ['tomorrow', '@tomorrow (x) { .wkgrid-cell { color: var(--ak-accent); } }'],
    ['styleset', '@styleset { nice: 1; }'],
  ])('refuses @%s, which is not on the list, and says what a component may use: %s', (name, rule) => {
    expect(bad({ css: `${rule}\n${WEEK_GRID.css}` })).toThrow(new RegExp(`@${name}.*uses only @media, @supports, @container and @starting-style, which condition its own rules, `
      + 'and @keyframes, @property, @counter-style, @font-palette-values, @position-try, @function and @font-feature-values under a name that starts with its prefix'));
  });

  it('passes @keyframes, @property and @counter-style under names of its own, and the page\'s own names where it uses them', () => {
    for (const css of [
      '@keyframes wkgrid-spin { from { opacity: 0; } to { opacity: 1; } }\n.wkgrid-cell { animation: wkgrid-spin 1s; }',
      '@keyframes wkgrid { from { opacity: 0; } }', '@keyframes "wkgrid-in" { from { opacity: 0; } }', '@-webkit-keyframes WKGRID-spin { from { opacity: 0; } }',
      '@keyframes \\77 kgrid-out { to { opacity: 0; } }',
      '@property --wkgrid-x { syntax: "<length>"; inherits: false; initial-value: 0px; }',
      '@counter-style wkgrid-count { system: cyclic; symbols: "*"; }\n.wkgrid-row { list-style-type: wkgrid-count; }',
      '.wkgrid-cell { animation: ak-fade 1s; }', '.wkgrid-row { counter-increment: ak-step; list-style-type: decimal; }',
      '@container (min-width: 30em) { .wkgrid-cell { min-height: 32px; } }', '@starting-style { .wkgrid-cell { opacity: 0; } }',
      '@font-palette-values --wkgrid-pal { font-family: Inter; override-colors: 0 var(--ak-ink); }', '@position-try --wkgrid-top { top: 0; }',
      '@function --wkgrid-gap() { result: 4px; }', '@font-feature-values wkgrid-font { @styleset { nice: 1; } @swash { fancy: 1; } }',
    ]) {
      expect(() => validateComponentBody({ ...WEEK_GRID, css: `${WEEK_GRID.css}\n${css}` }), css).not.toThrow();
    }
  });

  // A pseudo-class only narrows the element its compound names, and a pseudo-element hangs off it,
  // so an argument of words and numbers changes nothing a rule reaches. A pseudo whose argument is
  // a selector the parser cannot read, and every pseudo that names the page, stay refused.
  it('reads a pseudo whose argument is only words and numbers, and refuses one it cannot follow', () => {
    const rule = (selector: string) => ({ css: `${WEEK_GRID.css}\n${selector} { color: var(--ak-accent); }` });
    for (const ok of [
      '.wkgrid-cell::part(label)', '.wkgrid-cell::part(label icon)', '.wkgrid-cell:state(on)', '.wkgrid-cell:nth-col(2n+1)',
      '.wkgrid-cell::highlight(wkgrid-hit)', '.wkgrid::view-transition-old(wkgrid-a)', '.wkgrid-cell:state(on)::part(label)',
    ]) {
      expect(() => validateComponentBody({ ...WEEK_GRID, ...rule(ok) }), ok).not.toThrow();
    }
    expect(readStylesheet('.a::part(b) { c: d }').unreadable).toBeNull();
    expect(bad(rule('.wkgrid-cell:foo(.a > p)'))).toThrow(/does not read as a selector/);
    expect(bad(rule('.wkgrid-cell:foo("x")'))).toThrow(/does not read as a selector/);
    expect(bad(rule('.wkgrid-cell:current(p)'))).toThrow(/does not read as a selector/);
    expect(bad(rule('.wkgrid-cell:foo(url(x))'))).toThrow(/no url\(\)/);
    expect(bad(rule('.wkgrid-cell:host(.x)'))).toThrow(/names the page itself/);
    expect(bad(rule('.wkgrid-cell::slotted(p)'))).toThrow(/names the page itself/);
    expect(bad(rule('.wkgrid-cell:host-context(body)'))).toThrow(/names the page itself/);
    expect(bad(rule('.wkgrid-cell:root'))).toThrow(/names the page itself/);
    expect(bad(rule('p::part(label)'))).toThrow(/starts at one of its own classes/);
    expect(bad(rule('.wkgrid ~ p::part(label)'))).toThrow(/beside it/);
  });

  // An element still open where the markup ends takes in whatever the page writes after the
  // component, so a rule of the component styles the page's own content.
  it('refuses markup that leaves an element open where it ends, and says which', () => {
    for (const [html, element] of [
      ['<div class="wkgrid" role="grid"><span class="wkgrid-b">x</span>', 'div'],
      ['<div class="wkgrid"></div><p class="wkgrid-p">a', 'p'],
      ['<div class="wkgrid"><select class="wkgrid-s"><option>a', 'div'],
      ['<select class="wkgrid-s"><option>a</option>', 'select'],
      ['<svg class="wkgrid-i" viewBox="0 0 8 8"><path class="wkgrid-p" d="M0 0L8 8"/>', 'svg'],
      ['<table class="wkgrid"><tr><td>1</td></tr>', 'table'],
      ['<ul class="wkgrid"><li>a', 'ul'],
    ]) {
      expect(bad({ html }), html).toThrow(new RegExp(`<${element}> is still open where the markup ends.*Close every element inside the markup`));
      expect(readMarkup(html).problem, html).toEqual({ kind: 'open', element });
    }
    // Implied end tags, and foreign content that closes itself, close inside the markup.
    for (const html of [
      '<ul class="wkgrid"><li>a<li>b</ul>', '<svg class="wkgrid-i" viewBox="0 0 8 8"><path class="wkgrid-p" d="M0 0L8 8"/></svg>',
      '<div class="wkgrid"><p>a</div>', '<p class="wkgrid">a<div class="wkgrid-b">b</div>', '<div class="wkgrid"></div>text after',
    ]) {
      expect(() => validateComponentBody({ ...WEEK_GRID, html }), html).not.toThrow();
    }
  });

  it('says in words of its own what a repeated attribute, a missing space and a "/" on a <div> are', () => {
    expect(bad({ html: '<div class="wkgrid" class="wkgrid-x"></div>' })).toThrow(/On <div>, the attribute "class" is written twice/);
    expect(bad({ html: '<div class="wkgrid" hidden data-x="1" hidden></div>' })).toThrow(/the attribute "hidden" is written twice/);
    expect(bad({ html: '<div class="wkgrid"role="grid"></div>' })).toThrow(/On <div>, the attribute "role" follows the value before it with no space/);
    expect(bad({ html: '<div class="wkgrid"/>' })).toThrow(/A browser ignores the "\/" at the end of <div …\/>, so the <div> stays open.*Close every element inside the markup/);
    expect(bad({ html: '<div class="wkgrid"><span class="wkgrid-b"/></div>' })).toThrow(/the <span> stays open/);
    expect(readMarkup('<div hidden hidden></div>').problem).toEqual({ kind: 'duplicate', element: 'div', attribute: 'hidden' });
    expect(readMarkup('<div class="a"id="b"></div>').problem).toEqual({ kind: 'no-space', element: 'div', attribute: 'id' });
    expect(readMarkup('<div class="a"/>').problem).toEqual({ kind: 'slash', element: 'div' });
  });

  // A stored component that no longer passes is not shown and not handed out, and both say why in
  // the bench's own words. The preview is a page of this node, so what the bench quotes from the
  // stored body is text on it, never markup.
  it('says why a stored component no longer passes, in the preview and in the refusal to hand it out', () => {
    const stored = { ...WEEK_GRID, css: WEEK_GRID.css + '\n.wkgrid ~ p { color: var(--ak-ink); }' } as unknown as ComponentBody;
    expect(() => componentSnippet(stored)).toThrow(/no longer passes.*"\.wkgrid ~ p" reaches from the component to an element beside it/s);
    const page = componentPreviewHtml(stored);
    expect(page).toMatch(/no longer passes/);
    expect(page).toContain('&quot;.wkgrid ~ p&quot; reaches from the component to an element beside it');
    const quoted = componentPreviewHtml({ ...WEEK_GRID, html: '<div class="wkgrid"><td class="wkgrid-c"><img src=x onerror=alert(1)></td></div>' } as unknown as ComponentBody);
    expect(quoted).toContain('&lt;td class=&quot;wkgrid-c&quot;&gt;&lt;img');
    expect(quoted).not.toMatch(/<img|<td/i);
  });

  it('wears the page it lands in: a literal colour is refused with the tokens named, a fallback is fine', () => {
    expect(bad({ css: '.wkgrid { color: #111111; background: var(--ak-bg); }' })).toThrow(/never a literal \("#111111"\)/);
    expect(bad({ css: '.wkgrid { color: rgb(0,0,0); background: var(--ak-bg); }' })).toThrow(/never a literal/);
    expect(bad({ css: '.wkgrid { display: grid; }' })).toThrow(/reads the page's tokens/);
    expect(() => validateComponentBody({ ...WEEK_GRID, css: '.wkgrid { color: var(--ak-ink, #111111); }' })).not.toThrow();
  });

  it('does not move at idle', () => {
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-pulse { animation: p 2s infinite; color: var(--ak-ink); }' })).toThrow(/no infinite animation/);
  });

  it('owes its builder\'s judgement, with a reason', () => {
    expect(bad({ judgement: undefined })).toThrow(/YOUR judgement/);
    expect(bad({ judgement: { reach: 'useful', why: 'Any app where a person ticks days uses it.' } })).toThrow(/"general".*"special"/);
    expect(bad({ judgement: { reach: 'general', why: 'yes' } })).toThrow(/judgement\.why/);
    expect(validateComponentBody({ ...WEEK_GRID, judgement: { reach: 'special', why: 'It draws a flute fingering chart, which only a flute app needs.' } }).judgement.reach).toBe('special');
  });

  it('previews as a page with the kit\'s tokens and no script', () => {
    const page = componentPreviewHtml(validateComponentBody(WEEK_GRID));
    expect(page).toContain('/lib/aimeat-atelier.css');
    expect(page).toContain('class="wkgrid"');
    expect(page).not.toMatch(/<script/i);
  });
});
