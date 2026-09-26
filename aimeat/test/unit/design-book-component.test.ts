/**
 * @file test/unit/design-book-component.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The component bench: what a component may carry and what it may not. The good case
 *   is the part three measured builds each made by hand on 2026-09-20, a week grid a person ticks.
 * @version-history
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
    expect(bad({ html: '<div class="wkgrid"/>' })).toThrow(/does not read cleanly/);
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
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-a\\/* { }\n.wkgrid-b { background: url(https://evil.example/x.png); }\n.wkgrid-c { color: var(--ak-ink); } */' })).toThrow(/no url\(\)/);
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
    const rule = (selector: string) => ({ css: `${WEEK_GRID.css}\n${selector} { color: var(--ak-ink); }` });
    expect(bad(rule('.wkgrid ~ p'))).toThrow(/beside it/);
    expect(bad(rule('.wkgrid + *'))).toThrow(/beside it/);
    expect(bad(rule('.wkgrid, body'))).toThrow(/starts at one of its own classes/);
    expect(bad(rule('@media (min-width: 1px) { .wkgrid-row ~ div'))).toThrow(/beside it/);
    expect(bad(rule('@supports (display: grid) { .wkgrid-a, .wkgrid-b + section'))).toThrow(/beside it/);
    expect(bad(rule('.wkgrid:has(~ p)'))).toThrow(/looks only down/);
    expect(bad(rule('.wkgrid-x:is(.page-theme .wkgrid-x)'))).toThrow(/looks only down/);
    expect(bad(rule('.wkgrid:not(body)'))).toThrow(/names the page itself/);
    expect(bad(rule('.wkgrid:root'))).toThrow(/names the page itself/);
    expect(bad(rule('*.wkgrid'))).toThrow(/names the page itself/);
    // The column combinator is not one the CSS parser reads, so the bench cannot follow it.
    expect(bad(rule('.wkgrid || td'))).toThrow(/does not read as a selector/);
    expect(bad(rule('.wkgrid-x { & ~ p'))).toThrow(/starts at one of its own classes/);
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
