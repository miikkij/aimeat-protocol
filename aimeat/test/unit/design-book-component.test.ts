/**
 * @file test/unit/design-book-component.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The component bench: what a component may carry and what it may not. The good case
 *   is the part three measured builds each made by hand on 2026-09-20, a week grid a person ticks.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { validateComponentBody, componentPreviewHtml, componentSnippet } from '../../src/services/design-book/component.js';
import { validatePartInput, PART_KINDS } from '../../src/services/design-book/validate.js';
import { attributesOf, declarationsOf, selectorsOf, tagsOf, withoutComments, withoutVarFallbacks } from '../../src/services/design-book/component-scan.js';

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
    timed('comments', () => withoutComments('/* '.repeat(n)));
    timed('declarations', () => declarationsOf('animation '.repeat(n)));
    timed('selectors', () => selectorsOf('@media '.repeat(n)));
    timed('var fallbacks', () => withoutVarFallbacks('var(--a,('.repeat(n)));
    // And through the bench itself, at the most it accepts.
    timed('the bench, markup', () => { try { validateComponentBody({ ...WEEK_GRID, html: '<div class="wkgrid">' + '<a '.repeat(3900) }); } catch { /* refused is the right answer */ } });
    timed('the bench, styles', () => { try { validateComponentBody({ ...WEEK_GRID, css: '.wkgrid { color: var(--ak-ink); }' + 'animation '.repeat(1100) }); } catch { /* refused is the right answer */ } });
  });

  it('cannot reach outside itself', () => {
    expect(bad({ css: 'body { margin: 0; color: var(--ak-ink); }' })).toThrow(/starts at one of its own classes/);
    expect(bad({ css: '.ak-card { color: var(--ak-ink); }' })).toThrow(/starts at one of its own classes/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-bar { position: fixed; color: var(--ak-ink); }' })).toThrow(/no position: fixed/);
    expect(bad({ css: WEEK_GRID.css + '\n.wkgrid-x { color: var(--ak-ink) !important; }' })).toThrow(/no !important/);
    expect(bad({ html: '<div class="wkgrid other-thing"></div>' })).toThrow(/starts with its prefix/);
    expect(bad({ prefix: 'ak' })).toThrow(/the kit's prefix/);
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
