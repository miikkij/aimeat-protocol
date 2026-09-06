/**
 * @file test/unit/atelier-recipe.test.ts
 * @description The Atelier spec's recipe half (src/services/build-atelier-recipe.ts) held to the
 *   kit it describes. The customisation section names variants and per-component tokens by hand,
 *   which is the one thing in this prompt that is not rendered from a registry — so the guard is
 *   here: every variant the prompt promises exists in `sdk-libs/atelier/describe-data.js`
 *   (generated from the components' own source), every per-component token it names exists there
 *   too, and the count it gives is the count that file carries. A prompt that promises a shape the
 *   kit refuses teaches a builder to write a call that fails, and the builder reads the console
 *   line as a broken kit.
 *
 *   The six patterns are proven differently — pasted into a running Atelier page and driven in a
 *   browser — because whether a call RUNS is a browser's answer, not a string's. What this file
 *   can prove about them is that every kit function they call is a real export.
 *
 *   THE SIXTH ONE IS PROVEN FURTHER, because it is DATA rather than calls: the living record is
 *   lifted out of the prompt text and put through `AIMEAT.living.validate()` and the engine
 *   itself, so a record this spec hands a builder is one the library accepts and works out. The
 *   living section's node types are held to `sdk-libs/living/describe-data.js` the same way the
 *   variant table is held to atelier's.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-recipe.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-05 — The living section and the sixth pattern (the living document, stage
 *     3a): the node types named are exactly describe-data.js's, and the worked record validates,
 *     computes 4.8 L and crosses to two tins when the wall grows.
 *   v1.0.0 — 2026-09-05 — initial (wish-atelier-always-excellent, part 4).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  renderCustomisation, renderLiving, renderPatterns,
} from '../../src/services/build-atelier-recipe.js';
import { NODES } from '../../src/static/sdk-libs/living/describe-data.js';
import { createGraph } from '../../src/static/sdk-libs/living/graph.js';

// A served browser lib reads the page as it loads: it attaches itself to `window.AIMEAT`, and the
// shared config looks for the node's `<meta>` and falls back to the origin. Node has neither, so
// the three globals it touches are put there first — which is why this one import is dynamic and
// the ones above are not. Nothing under test draws, so a querySelector that finds nothing is
// enough; `validate()` and the graph never touch the DOM.
Object.assign(globalThis, {
  window: globalThis,
  document: { querySelector: () => null },
  location: { protocol: 'https:', origin: 'https://aimeat.io' },
});
const { validate } = await import('../../src/static/sdk-libs/living/index.js');

/** The generated truth: what each component actually accepts. */
const DESCRIBE_SRC = readFileSync(
  new URL('../../src/static/sdk-libs/atelier/describe-data.js', import.meta.url), 'utf8');

/** Every `component: variant` pair the generated file declares. */
function declaredVariants(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const re = /"([a-zA-Z]+)":\s*\{[\s\S]*?variants:\s*\[([^\]]*)\]/g;
  for (const m of DESCRIBE_SRC.matchAll(re)) {
    const names = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    out.set(m[1], new Set(names));
  }
  return out;
}

/** Every `--ak-*` custom property the generated file declares, per component. */
function declaredTokens(): Set<string> {
  return new Set([...DESCRIBE_SRC.matchAll(/--ak-[a-z0-9-]+/g)].map((m) => m[0]));
}

describe('the customisation section is held to describe-data.js', () => {
  const text = renderCustomisation();
  const variants = declaredVariants();

  it('reads the generated file at all — a silent empty parse would pass every check below', () => {
    expect(variants.size).toBeGreaterThanOrEqual(18);
    expect(variants.get('list')).toEqual(new Set(['dense', 'numbered', 'plain']));
  });

  it('every variant it promises is one the component accepts', () => {
    // The variants door only — the slots door names `extra` and `aside`, which are part names.
    const door = /3\. \*\*Variants\.\*\*([\s\S]*?)\n4\. \*\*Per-component/.exec(text);
    expect(door).toBeTruthy();
    // Each clause reads "`<v>` and `<v>` on a, b and c", so the backticked words are the variants
    // and the words after the last one are the components they are promised on.
    const claims: Array<[string, string]> = [];
    for (const clause of door![1].split(';')) {
      const named = [...clause.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
      if (named.length === 0) continue;
      const tail = clause.slice(clause.lastIndexOf('`') + 1);
      const comps = [...tail.matchAll(/\b([a-z][a-zA-Z]{2,})\b/g)].map((m) => m[1])
        .filter((w) => variants.has(w));
      for (const v of named) for (const c of comps) claims.push([c, v]);
    }
    expect(claims.length).toBeGreaterThan(20);
    const wrong = claims.filter(([c, v]) => !variants.get(c)?.has(v));
    expect(wrong.map(([c, v]) => `${c}: ${v}`)).toEqual([]);
  });

  it('every component that carries variants is offered at least one', () => {
    const door = /3\. \*\*Variants\.\*\*([\s\S]*?)\n4\. \*\*Per-component/.exec(text)![1];
    const missing = [...variants.entries()]
      .filter(([name, set]) => set.size > 0 && !door.includes(name))
      // The dialog family's variants are tones and sizes taught in the dialog's own section, and
      // the spec keeps a builder out of forking it at all.
      .filter(([name]) => name !== 'dialog')
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('every per-component token it names is one the kit declares', () => {
    const tokens = declaredTokens();
    const named = [...text.matchAll(/--ak-[a-z0-9-]+/g)].map((m) => m[0]);
    expect(named.length).toBeGreaterThanOrEqual(4);
    expect(named.filter((t) => !tokens.has(t))).toEqual([]);
  });

  it('the count it gives is the count the kit carries', () => {
    // Four are named in the sentence and the rest are counted, so the two must add up. The three
    // contract tokens the components also read (--ak-chrome-bottom, --ak-hero-image, --ak-scrim)
    // belong to the shell and the theme, not to a component's own sizes.
    const CONTRACT = new Set(['--ak-chrome-bottom', '--ak-hero-image', '--ak-scrim']);
    const perComponent = [...declaredTokens()].filter((t) => !CONTRACT.has(t));
    const named = new Set([...text.matchAll(/--ak-[a-z0-9-]+/g)].map((m) => m[0]));
    const WORDS: Record<string, number> = {
      'thirty-one': 31, 'thirty-two': 32, 'thirty-three': 33, 'thirty-four': 34, 'thirty-five': 35,
    };
    const said = [...text.matchAll(/and (thirty-[a-z]+) more/g)].map((m) => WORDS[m[1]]);
    expect(said.length).toBe(1);
    expect(named.size + said[0]).toBe(perComponent.length);
  });

  it('the four doors and the fork\'s price are all said', () => {
    for (const phrase of ['data-ak-part', 'parts: {', 'data-ak-variant', 'describe(id).fork']) {
      expect(text).toContain(phrase);
    }
    // The dialog family is the one component the spec refuses to let a builder fork.
    expect(text).toMatch(/dialog family[\s\S]{0,200}body\(host\)/);
  });
});

describe('the six patterns call the kit, not an invented surface', () => {
  const text = renderPatterns();

  it('names all six', () => {
    for (const title of ['A LIST THAT ARRIVES', 'A PANEL THAT CHANGES', 'A SCREEN THAT SWITCHES',
      'A FORM THAT LANDS', 'A NEARLY-RIGHT ROW', 'A SHEET THAT RECOMPUTES']) {
      expect(text).toContain(title);
    }
  });

  it('every AIMEAT.atelier.<fn> it calls is exported by the kit', () => {
    const index = readFileSync(
      new URL('../../src/static/sdk-libs/atelier/index.js', import.meta.url), 'utf8');
    const called = new Set([...text.matchAll(/AIMEAT\.atelier\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
    expect(called.size).toBeGreaterThanOrEqual(5);
    // The surface object lists every name it attaches; a call to something absent from it would
    // throw in the browser and read to a builder as the spec being wrong about the kit.
    for (const fn of called) expect(index).toMatch(new RegExp(`\\b${fn}\\b`));
  });

  it('the pattern that customises a row uses the empty slots rather than a fork', () => {
    expect(text).toMatch(/parts:\s*\{[\s\S]{0,80}extra:/);
    expect(text).toContain('aside: function (r)');
  });
});

/** The living section, rendered once with a base URL a builder could actually fetch. */
const LIVING = renderLiving('https://aimeat.io');

/** The node type ids the library itself carries — the list this section is held to. */
const TYPE_IDS = Object.keys(NODES).sort();

describe('the living section is held to living/describe-data.js', () => {
  it('reads the generated file at all — an empty parse would pass every check below', () => {
    expect(TYPE_IDS.length).toBeGreaterThanOrEqual(7);
    expect(TYPE_IDS).toContain('formula');
  });

  it('names exactly the node types the library carries, and no other', () => {
    const clause = /THE EIGHT NODE TYPES([\s\S]*?)\n\n/.exec(LIVING);
    expect(clause).toBeTruthy();
    const named = [...clause![1].matchAll(/`([a-z]+)`/g)].map((m) => m[1]).sort();
    expect(named).toEqual(TYPE_IDS);
  });

  it('the vocabulary is asked of the library and the document is read before it is saved', () => {
    for (const phrase of ['AIMEAT.living.describe()', 'AIMEAT.living.validate(record)',
      'AIMEAT.living.mount(host, record)', '{ v: 1, register, look, layout, model }',
      'genre-living']) {
      expect(LIVING).toContain(phrase);
    }
  });

  it('the two spellings that decide the numbers are both said', () => {
    // A percentage is a label on a face number and the two temperatures are affine — the pair a
    // first document trips over, and both are the library's behaviour rather than a convention.
    expect(LIVING).toMatch(/A PERCENTAGE IS A LABEL ON A FACE NUMBER/);
    expect(LIVING).toContain('fraction(');
    expect(LIVING).toContain('percent(');
    expect(LIVING).toMatch(/SCALES WITH AN OFFSET/);
  });
});

describe('the sixth pattern is a record the library accepts', () => {
  /** The record lifted out of the prompt text itself, so the thing tested is the thing shipped. */
  const source = /var sheet = (\{[\s\S]*?\n\});\n/.exec(renderPatterns());
  const sheet = new Function('return ' + source![1])() as {
    layout: { blocks: Array<{ id: string; component: string }> };
    model: { nodes: Record<string, { type: string }> };
  };

  it('every `type` it writes is one the library declares', () => {
    const used = [...new Set(Object.values(sheet.model.nodes).map((n) => n.type))].sort();
    expect(used.length).toBeGreaterThanOrEqual(5);
    expect(used.filter((t) => !TYPE_IDS.includes(t))).toEqual([]);
  });

  it('carries the six pieces the section promises a sheet has', () => {
    const nodes = sheet.model.nodes;
    const byType = (t: string) => Object.entries(nodes).filter(([, n]) => n.type === t);
    const valued = byType('value').find(([id]) => id === 'area');
    expect((valued![1] as { unit?: string }).unit).toBe('m^2');            // a value with a unit
    expect(byType('control')[0][1]).toMatchObject({ kind: 'slider', target: 'area' });
    expect(byType('formula')[0][1]).toMatchObject({ block: 'maths' });     // printed as maths
    expect(byType('binding')[0][1]).toMatchObject({ block: 'tin', prop: 'value', from: 'paint' });
    expect(String((byType('text')[0][1] as { template: string }).template)).toContain('{{ if paint > 5 }}');
    expect(Object.keys((byType('machine')[0][1] as { states: object }).states)).toEqual(['one', 'two']);
  });

  it('validate() finds nothing to refuse', () => {
    expect(validate(sheet)).toEqual({ ok: true, refusals: [] });
  });

  it('works the wall out in litres, and crosses to two tins when it grows', () => {
    const g = createGraph(sheet);
    expect(g.errors).toEqual([]);
    g.refresh();
    // 24 m² in 2 coats at 10 m²/L is 4.8 L — the unit is division, not decoration.
    const paint = g.valueOf('paint') as { n: number; u: { label: string } };
    expect(paint.n).toBeCloseTo(4.8, 10);
    expect(paint.u.label).toBe('L');
    expect(g.valueOf('tins')).toBe('one');
    expect(String(g.valueOf('advice'))).toContain('One 5 litre tin covers it.');

    g.set('area', 40);
    expect((g.valueOf('paint') as { n: number }).n).toBeCloseTo(8, 10);
    expect(g.valueOf('tins')).toBe('two');
    expect(String(g.valueOf('advice'))).toContain('Buy two tins.');
  });

  it('every block a node names is a block the layout has', () => {
    const ids = new Set(sheet.layout.blocks.map((b) => b.id));
    for (const node of Object.values(sheet.model.nodes) as Array<{ block?: string }>) {
      if (node.block) expect([...ids]).toContain(node.block);
    }
  });
});
