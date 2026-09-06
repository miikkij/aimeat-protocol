/**
 * @file test/unit/living-describe.test.ts
 * @description The vocabulary an AI reads before writing a living document, held to the source it
 *   came from. Three things are proved: the generated describe-data.js matches the node modules'
 *   own JSDoc RIGHT NOW (the same assertion `pnpm check:living-nodes` makes in the hook), every
 *   type the registry can build has an entry, and every worked example in that vocabulary is a
 *   document the engine actually accepts.
 *
 *   The third one is the point. A vocabulary whose examples do not run is worse than none: a model
 *   copies the example, the document refuses, and the model has no way to know which of the two
 *   was wrong.
 * @usage cd aimeat && pnpm vitest run test/unit/living-describe.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-06 — The company an example keeps gains a machine, because a trigger watches
 *     one (living 0.6.0).
 *   v1.0.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { describe, it, expect } from 'vitest';
import { NODES } from '../../src/static/sdk-libs/living/describe-data.js';
import { NODE_TYPES } from '../../src/static/sdk-libs/living/nodes/index.js';
import { readTags } from '../../tools/build-living-nodes.js';
import { createGraph } from '../../src/static/sdk-libs/living/graph.js';

describe('the generated vocabulary', () => {
  it('matches the node modules\' own JSDoc', () => {
    const fromSource = readTags();
    expect(fromSource.map((r) => r.id).sort()).toEqual(Object.keys(NODES).sort());
    for (const rec of fromSource) {
      const entry = (NODES as Record<string, Record<string, unknown>>)[rec.id];
      expect(entry.summary).toBe(rec.summary);
      expect(entry.inputs).toEqual(rec.inputs);
      expect(entry.outputs).toEqual(rec.outputs);
      expect(entry.options).toEqual(rec.options);
      expect(entry.example).toEqual(rec.example);
      expect(entry.file).toBe(rec.file);
    }
  });

  it('has an entry for every type the registry can build, and no others', () => {
    expect(Object.keys(NODES).sort()).toEqual(Object.keys(NODE_TYPES).sort());
  });

  it('says something about each type: a summary, what it reads, what it answers, an example', () => {
    for (const id of Object.keys(NODES)) {
      const entry = (NODES as Record<string, Record<string, unknown>>)[id];
      expect(String(entry.summary).length).toBeGreaterThan(20);
      expect((entry.outputs as string[]).length).toBeGreaterThan(0);
      expect(entry.example).toBeTruthy();
      expect((entry.example as { type: string }).type).toBe(id);
    }
  });
});

describe('every worked example is a document the engine accepts', () => {
  it('mounts each example as its own node and finds no refusal it did not expect', () => {
    for (const id of Object.keys(NODES)) {
      const example = (NODES as Record<string, { example: Record<string, unknown> }>)[id].example;
      // The examples name the other nodes a real document would have around them; give them
      // those, so what is under test is the example itself and not the company it keeps.
      const nodes: Record<string, unknown> = {
        t: { type: 'value', value: 22, unit: '°C', min: -20, max: 45 },
        note: { type: 'value', value: '' },
        advice: { type: 'value', value: '' },
        // A trigger watches a machine, so the company an example keeps now includes one.
        phase: {
          type: 'machine', initial: 'charging',
          states: { charging: { on: { EXPORT: 'exporting' } }, exporting: { on: { CHARGE: 'charging' } } },
        },
        [id === 'value' ? 'example' : id]: example,
      };
      const g = createGraph({ v: 1, model: { nodes } });
      // A binding writes to a block, which only validate() (with a layout) can check; the graph
      // itself must still build it without complaint.
      expect({ id, errors: g.errors }).toEqual({ id, errors: [] });
      g.refresh();
    }
  });

  it('the formula example works out to what its unit says it does', () => {
    const g = createGraph({
      v: 1,
      model: {
        nodes: {
          t: { type: 'value', value: 22, unit: '°C' },
          f: (NODES as Record<string, { example: Record<string, unknown> }>).formula.example,
        },
      },
    });
    g.refresh();
    const out = g.valueOf('f') as { n: number; u: { label: string } };
    expect(out.n).toBeCloseTo(71.6, 10);
    expect(out.u.label).toBe('°F');
  });

  it('the machine example starts where it says and crosses when the reading does', () => {
    const g = createGraph({
      v: 1,
      model: {
        nodes: {
          t: { type: 'value', value: 22, unit: '°C', min: -20, max: 45 },
          note: { type: 'value', value: '' },
          state: (NODES as Record<string, { example: Record<string, unknown> }>).machine.example,
        },
      },
    });
    g.refresh();
    expect(g.valueOf('state')).toBe('fine');
    g.set('t', 33);
    expect(g.valueOf('state')).toBe('hot');
    expect(g.valueOf('note')).toBe('jäähdytä');
  });
});
