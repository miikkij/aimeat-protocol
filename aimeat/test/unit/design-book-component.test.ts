/**
 * @file test/unit/design-book-component.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The component bench: what a component may carry and what it may not. The good case
 *   is the part three measured builds each made by hand on 2026-09-20, a week grid a person ticks.
 * @version-history
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
import {
  attributesOf, complexSelectorOf, cssAsRead, declarationsOf, selectorListOf, selectorsOf, tagsOf, withoutVarFallbacks,
} from '../../src/services/design-book/component-scan.js';

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
    // The reader says so itself: nothing it could not read is dropped on the floor.
    expect(attributesOf(' class="wkgrid" ="><script>x</script>"')).toEqual([
      { key: 'class', value: 'wkgrid', odd: false },
      { key: '', value: '><script>x</script>', odd: true },
    ]);
    expect(tagsOf('<div></ div title="><script>x</script>">').tags[1]).toMatchObject({ closing: true, odd: true });
    // What a browser and the bench agree on still passes: a self-closing SVG path, a bare attribute.
    expect(() => validateComponentBody({ ...WEEK_GRID, html: '<div class="wkgrid" hidden><svg class="wkgrid-i" viewBox="0 0 8 8"><path class="wkgrid-p" d="M0 0L8 8"/></svg><br/></div >' })).not.toThrow();
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
    expect(cssAsRead('a\\62 c /* x */ "/*" \\2f\\2a d')).toBe('abc   "/*" /*d');
    // An escape a real component uses, a tick drawn by the stylesheet, still passes.
    expect(() => validateComponentBody({ ...WEEK_GRID, css: WEEK_GRID.css + '\n.wkgrid-cell[aria-pressed="true"]::after { content: "\\2713"; position: absolute; color: var(--ak-accent-ink); }' })).not.toThrow();
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

  it('reads text that opens and never closes in time that grows with its length and nothing else', () => {
    // MEASURED 2026-09-20 on the patterns this replaced, 40 000 openings each: the tag pattern took
    // 1.3 s, the comment strip 0.6 s, the at-rule strip 3.2 s and "animation … infinite" 6.3 s, and
    // ten times less input took a hundred times less time. The bench's 12 000-character ceiling is
    // what kept that to a tenth of a second in practice; the readers no longer depend on it.
    const n = 40_000;
    const timed = (name: string, run: () => unknown) => {
      const started = performance.now();
      run();
      expect(performance.now() - started, name).toBeLessThan(400);
    };
    timed('tags', () => tagsOf('<a '.repeat(n)));
    timed('attributes', () => attributesOf('a= '.repeat(n)));
    timed('comments', () => cssAsRead('/* '.repeat(n)));
    timed('strings', () => cssAsRead('"a\\'.repeat(n)));
    timed('escapes', () => cssAsRead('\\75 '.repeat(n)));
    timed('selector lists', () => selectorListOf('(,'.repeat(n)));
    timed('selectors, open', () => complexSelectorOf('.a:is('.repeat(n)));
    timed('selectors, nested', () => complexSelectorOf(':is('.repeat(n) + '.a' + ')'.repeat(n)));
    timed('declarations', () => declarationsOf('animation '.repeat(n)));
    timed('selectors', () => selectorsOf('@media '.repeat(n)));
    timed('var fallbacks', () => withoutVarFallbacks('var(--a,('.repeat(n)));
    // And through the bench itself, at the most it accepts.
    timed('the bench, markup', () => { try { validateComponentBody({ ...WEEK_GRID, html: '<div class="wkgrid">' + '<a '.repeat(3900) }); } catch { /* refused is the right answer */ } });
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
    expect(bad(rule('.wkgrid || td'))).toThrow(/beside it/);
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
