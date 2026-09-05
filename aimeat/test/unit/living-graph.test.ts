/**
 * @file test/unit/living-graph.test.ts
 * @description The engine: one dependency graph, worked out in topological order, recomputed
 *   PARTIALLY when one thing moves, and refusing a circle by naming the two nodes that make it.
 *
 *   The changed list is the thing under test, not a by-product. It is what the bindings use to
 *   refresh the two blocks that moved instead of the eleven that did not, and what the chain view
 *   flashes — so a test that only asserted the final numbers would pass on an engine that
 *   recomputed everything every time, which is the failure this file exists to catch.
 * @usage cd aimeat && pnpm vitest run test/unit/living-graph.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-05 — The first refresh enters each machine's initial state, so what a
 *     machine writes is right on the first paint (living 0.3.0).
 *   v1.0.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { describe, it, expect } from 'vitest';
import { createGraph } from '../../src/static/sdk-libs/living/graph.js';

/** The temperature document the proof page mounts, minus its layout. */
function tempDoc() {
  return {
    v: 1,
    model: {
      nodes: {
        t: { type: 'value', value: 22, unit: '°C', min: -20, max: 45, step: 0.5, label: 'Lämpötila' },
        slider: { type: 'control', kind: 'slider', target: 't' },
        f: { type: 'formula', expr: 't * 9/5 + 32', unit: '°F', label: 'Fahrenheit' },
        judgement: { type: 'formula', expr: 'if(t > 30, "liian kuuma", "hyvä")' },
        note: { type: 'text', template: 'Nyt {{ t | 1 }} °C, {{ judgement }}.' },
        untouched: { type: 'value', value: 7 },
      },
    },
  };
}

describe('createGraph: the order', () => {
  it('puts everything a node stands on before it', () => {
    const g = createGraph(tempDoc());
    expect(g.errors).toEqual([]);
    expect(g.order.indexOf('t')).toBeLessThan(g.order.indexOf('f'));
    expect(g.order.indexOf('judgement')).toBeLessThan(g.order.indexOf('note'));
    expect(g.order.length).toBe(6);
  });

  it('names what each node stands on and who stands on it', () => {
    const g = createGraph(tempDoc());
    expect(g.dependencies('f')).toEqual(['t']);
    expect(g.dependents('t').sort()).toEqual(['f', 'judgement', 'note', 'slider']);
    expect(g.edges()).toContainEqual({ from: 't', to: 'f' });
  });

  it('works the whole document out on refresh', () => {
    const g = createGraph(tempDoc());
    g.refresh();
    expect((g.valueOf('f') as { n: number }).n).toBeCloseTo(71.6, 10);
    expect(g.valueOf('judgement')).toBe('hyvä');
    expect(g.valueOf('note')).toBe('Nyt 22.0 °C, hyvä.');
  });

  it('a formula answers with its TeX as well as its number', () => {
    const g = createGraph(tempDoc());
    g.refresh();
    expect(g.fieldsOf('f').tex).toContain('\\frac');
  });
});

describe('createGraph: a change travels, and only where it has to', () => {
  it('recomputes exactly the nodes that stood on what moved', () => {
    const g = createGraph(tempDoc());
    g.refresh();
    const out = g.set('t', 31);
    expect(out.changed.sort()).toEqual(['f', 'judgement', 'note', 'slider', 't']);
    expect(out.changed).not.toContain('untouched');
    expect(g.valueOf('judgement')).toBe('liian kuuma');
  });

  it('reports nothing when a node is set to what it already was', () => {
    const g = createGraph(tempDoc());
    g.refresh();
    expect(g.set('t', 22).changed).toEqual([]);
  });

  it('reports only the nodes whose ANSWER moved, not everything downstream', () => {
    const g = createGraph(tempDoc());
    g.refresh();
    // 22 → 23 changes the number and the sentence, but not which side of 30 it is on.
    const out = g.set('t', 23);
    expect(out.changed).toContain('f');
    expect(out.changed).toContain('note');
    expect(out.changed).not.toContain('judgement');
  });

  it('keeps a value inside the range the node declared', () => {
    const g = createGraph(tempDoc());
    g.refresh();
    g.set('t', 999);
    expect((g.valueOf('t') as { n: number }).n).toBe(45);
    g.set('t', -999);
    expect((g.valueOf('t') as { n: number }).n).toBe(-20);
  });

  it('a control cannot be written to; only the value it moves can', () => {
    const g = createGraph(tempDoc());
    g.refresh();
    expect(g.set('slider', 5).changed).toEqual([]);
    expect((g.valueOf('t') as { n: number }).n).toBe(22);
  });
});

describe('createGraph: the refusals', () => {
  it('a circle is refused by naming the two nodes', () => {
    const g = createGraph({
      v: 1,
      model: { nodes: { a: { type: 'formula', expr: 'b + 1' }, b: { type: 'formula', expr: 'a + 1' } } },
    });
    expect(g.errors.length).toBe(1);
    expect(g.errors[0]).toContain('"a"');
    expect(g.errors[0]).toContain('"b"');
    expect(g.errors[0]).toMatch(/circle/);
  });

  it('a longer circle is still refused, and still names two of its nodes', () => {
    const g = createGraph({
      v: 1,
      model: {
        nodes: {
          a: { type: 'formula', expr: 'c + 1' },
          b: { type: 'formula', expr: 'a + 1' },
          c: { type: 'formula', expr: 'b + 1' },
        },
      },
    });
    expect(g.errors.length).toBe(1);
    expect(g.errors[0]).toMatch(/circle/);
  });

  it('a node reading something this document does not have is named', () => {
    const g = createGraph({ v: 1, model: { nodes: { a: { type: 'formula', expr: 'ghost + 1' } } } });
    expect(g.errors.join(' ')).toContain('"ghost"');
  });

  it('a node of a type this build does not have is named, with the types it does', () => {
    const g = createGraph({ v: 1, model: { nodes: { a: { type: 'generator' } } } });
    expect(g.errors.join(' ')).toContain('generator');
    expect(g.errors.join(' ')).toContain('formula');
  });

  it('a formula that will not parse is refused at build, not at every recompute', () => {
    const g = createGraph({ v: 1, model: { nodes: { a: { type: 'formula', expr: '2 * * 3' } } } });
    expect(g.errors.length).toBe(1);
    expect(g.errors[0]).toContain('"a"');
  });

  it('a unit nobody has heard of is refused by name', () => {
    const g = createGraph({ v: 1, model: { nodes: { a: { type: 'value', value: 1, unit: 'bananas' } } } });
    expect(g.errors.join(' ')).toContain('bananas');
  });
});

describe('createGraph: the machine is a reader and a writer', () => {
  function withMachine() {
    return {
      v: 1,
      model: {
        nodes: {
          t: { type: 'value', value: 20, unit: '°C', min: -20, max: 45 },
          advice: { type: 'value', value: '' },
          state: {
            type: 'machine',
            initial: 'fine',
            states: {
              fine: { on: { HOT: 'hot' }, entry: { advice: '"ei mitään"' } },
              hot: { entry: { advice: '"tuuleta"' }, on: { COOL: { target: 'fine', guard: 't < 30' } } },
            },
            when: [{ expr: 't > 30', send: 'HOT' }, { expr: 't < 30', send: 'COOL' }],
          },
        },
      },
    };
  }

  it('orders the machine before the value its entry action writes', () => {
    const g = createGraph(withMachine());
    expect(g.errors).toEqual([]);
    expect(g.order.indexOf('t')).toBeLessThan(g.order.indexOf('state'));
    expect(g.order.indexOf('state')).toBeLessThan(g.order.indexOf('advice'));
  });

  // A machine that merely OCCUPIED its initial state left the value it writes at whatever the
  // record seeded, so the document opened saying nothing and only became right once somebody
  // moved a control. The first refresh enters the state instead.
  it('the initial state is entered, so what the machine writes is right on the first paint', () => {
    const g = createGraph(withMachine());
    const out = g.refresh();
    expect(g.valueOf('state')).toBe('fine');
    expect(g.valueOf('advice')).toBe('ei mitään');
    expect(out.changed).toContain('advice');
  });

  it('it enters once: a second refresh does not run the entry again', () => {
    const g = createGraph(withMachine());
    g.refresh();
    g.set('advice', 'käsin');
    expect(g.refresh().changed).not.toContain('advice');
    expect(g.valueOf('advice')).toBe('käsin');
  });

  it('a crossing sends the event and the entry action lands in the same change', () => {
    const g = createGraph(withMachine());
    g.refresh();
    expect(g.valueOf('state')).toBe('fine');
    const out = g.set('t', 31);
    expect(g.valueOf('state')).toBe('hot');
    expect(g.valueOf('advice')).toBe('tuuleta');
    expect(out.changed).toContain('state');
    expect(out.changed).toContain('advice');
  });

  it('a guard refuses the transition until it is true', () => {
    const g = createGraph(withMachine());
    g.refresh();
    g.set('t', 31);
    expect(g.valueOf('state')).toBe('hot');
    // COOL is guarded on t < 30, and the crossing only fires when the condition BECOMES true.
    g.set('t', 29);
    expect(g.valueOf('state')).toBe('fine');
  });

  it('an event sent by hand reaches the machines', () => {
    const g = createGraph(withMachine());
    g.refresh();
    const out = g.send('HOT');
    expect(out.changed).toContain('state');
    expect(g.valueOf('state')).toBe('hot');
  });
});
