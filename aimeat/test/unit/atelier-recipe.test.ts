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
 *   The five patterns are proven differently — pasted into a running Atelier page and driven in a
 *   browser — because whether a call RUNS is a browser's answer, not a string's. What this file
 *   can prove about them is that every kit function they call is a real export.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-recipe.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — initial (wish-atelier-always-excellent, part 4).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderCustomisation, renderPatterns } from '../../src/services/build-atelier-recipe.js';

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

describe('the five patterns call the kit, not an invented surface', () => {
  const text = renderPatterns();

  it('names all five', () => {
    for (const title of ['A LIST THAT ARRIVES', 'A PANEL THAT CHANGES', 'A SCREEN THAT SWITCHES',
      'A FORM THAT LANDS', 'A NEARLY-RIGHT ROW']) {
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
