/**
 * @file test/unit/living-dialogs.test.ts
 * @description WHAT THE GEAR EXPLAINS, WITHOUT THE DIALOG AROUND IT. The two gear dialogs are drawn
 *   with the kit's own dialog part, but everything they SAY is worked out here — the shape a URL's
 *   answer must have for this exact node, the POST that writes the value in from outside, the
 *   sentence to say to your own AI, and the payload a trigger would send for the state the document
 *   is in right now.
 *
 *   THEY ARE TESTED AS DATA BECAUSE THAT IS WHAT THEY ARE. A dialog that shows a plausible-looking
 *   example somebody typed into a template is worse than no dialog: the person copies it, the shape
 *   is wrong for their node, and the failure lands on the far side of an API call. So the JSON on
 *   the screen is generated from the record and from describe() — the same describe() the AI reads —
 *   and this file holds the two together. If the source node's fields change, the words in the
 *   dialog change with them or this test goes red.
 * @usage cd aimeat && pnpm vitest run test/unit/living-dialogs.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { describe, it, expect } from 'vitest';

// The library attaches itself to window at import and reads the page's language off the document.
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const { createGraph } = await import('../../src/static/sdk-libs/living/graph.js');
const { inwardShape, outwardShape } = await import('../../src/static/sdk-libs/living/hooks-shapes.js');
const { describe: describeType } = await import('../../src/static/sdk-libs/living/index.js');

function sheet() {
  return {
    v: 1,
    key: 'living.solar',
    title: { fi: 'Aurinko ja akku', en: 'Solar and battery' },
    register: 'custom:solar-proof',
    lang: 'fi',
    model: {
      nodes: {
        t: {
          type: 'value', value: 21.5, unit: '°C', min: -20, max: 45, step: 0.5,
          label: { fi: 'Lämpötila', en: 'Temperature' },
        },
        dial: { type: 'control', kind: 'slider', target: 't', label: { fi: 'Säädä', en: 'Adjust' } },
        spot: {
          type: 'source', url: 'https://api.example/prices', path: 'prices[0].price',
          every: 60, unit: 'EUR/kWh', value: 4.2, label: { fi: 'Pörssihinta', en: 'Spot price' },
        },
        phase: {
          type: 'machine', initial: 'charging',
          states: {
            charging: { on: { EXPORT: 'exporting' } },
            exporting: { on: { CHARGE: 'charging' }, states: { high: {} }, initial: 'high' },
          },
          when: [{ expr: 't > 30', send: 'EXPORT' }],
          label: { fi: 'Vaihe', en: 'Phase' },
        },
        tell: {
          type: 'trigger', on: 'phase', enabled: true,
          target: { kind: 'url', url: 'https://inverter.example/hook', method: 'POST' },
          include: 'all', label: { fi: 'Kerro invertterille', en: 'Tell the inverter' },
        },
      },
    },
  };
}

function shaped(id: string, doc = sheet(), langs = ['fi']) {
  const graph = createGraph(doc, { langs: () => langs });
  graph.refresh();
  const node = (doc.model.nodes as Record<string, any>)[id];
  const ctx = { id, node, doc, graph, langs: () => langs, base: 'https://node.example' };
  return { ctx, graph, doc, node };
}

describe('the inward dialog: this value can come from outside', () => {
  it('shows the answer a URL must give for THIS node, with the node\'s own path', () => {
    const s = shaped('spot');
    const shape = inwardShape(s.ctx);
    expect(shape.expected).toEqual({ prices: [{ price: 4.2 }] });
  });

  it('shows one bare value when the record asks for the body raw', () => {
    const doc = sheet();
    (doc.model.nodes as Record<string, any>).spot = {
      type: 'source', url: 'https://api.example/n', raw: true, unit: 'EUR/kWh', value: 4.2,
    };
    const shape = inwardShape(shaped('spot', doc).ctx);
    expect(shape.expected).toBe(4.2);
  });

  it('names the memory key a writer would POST to, built from the document and the node', () => {
    const shape = inwardShape(shaped('spot').ctx);
    expect(shape.write.key).toBe('living.solar.in.spot');
    expect(shape.write.request.method).toBe('POST');
    expect(shape.write.request.url).toBe('https://node.example/v1/memory');
    expect(shape.write.request.body).toEqual({
      key: 'living.solar.in.spot', value: { value: 4.2 },
    });
    expect(shape.write.curl).toContain('living.solar.in.spot');
    expect(shape.write.curl).toContain('/v1/memory');
  });

  it('writes the agent road as a sentence a person says, in the page\'s language', () => {
    const fi = inwardShape(shaped('spot').ctx);
    expect(fi.sentence).toContain('living.solar.in.spot');
    expect(fi.sentence).toMatch(/[Kk]irjoita/);
    const en = inwardShape(shaped('spot', sheet(), ['en']).ctx);
    expect(en.sentence).toContain('living.solar.in.spot');
    expect(en.sentence).toMatch(/[Ww]rite/);
  });

  it('shows a control\'s range, read off the value it moves rather than typed twice', () => {
    const shape = inwardShape(shaped('dial').ctx);
    expect(shape.target).toBe('t');
    expect(shape.range).toEqual({ min: -20, max: 45, step: 0.5, unit: '°C' });
    // The gear on a control is a gear on the value under it, so the key and the sample follow.
    expect(shape.write.key).toBe('living.solar.in.t');
    expect(shape.expected).toEqual({ value: 21.5 });
  });

  it('a plain value with no road yet is offered the memory key and no url', () => {
    const shape = inwardShape(shaped('t').ctx);
    expect(shape.road).toBe('hand');
    expect(shape.url).toBe('');
    expect(shape.write.key).toBe('living.solar.in.t');
  });

  it('carries the type\'s own vocabulary, straight from describe()', () => {
    const shape = inwardShape(shaped('spot').ctx);
    expect(shape.vocabulary.id).toBe('source');
    expect(shape.vocabulary.options).toEqual((describeType('source') as { options: string[] }).options);
    expect(shape.vocabulary.summary).toBe((describeType('source') as { summary: string }).summary);
  });
});

describe('the outward dialog: when this changes, tell someone', () => {
  it('shows the payload exactly as it would go, for the state the document is in now', () => {
    const shape = outwardShape(shaped('tell').ctx);
    expect(shape.payload.document).toEqual({
      key: 'living.solar', title: 'Aurinko ja akku', register: 'custom:solar-proof',
    });
    expect(shape.payload.machines).toEqual({ phase: 'charging' });
    expect(shape.payload.values.t).toEqual({ value: 21.5, unit: '°C', label: 'Lämpötila' });
    expect(shape.payload.trigger).toEqual({ id: 'tell', label: 'Kerro invertterille' });
    expect(shape.payload.transition.node).toBe('phase');
  });

  it('lists a machine\'s states, nested ones included, so the dialog can name them', () => {
    const shape = outwardShape(shaped('phase').ctx);
    expect(shape.states).toEqual(['charging', 'exporting', 'high']);
    expect(shape.watching).toBe('phase');
  });

  it('offers a machine with no trigger yet an id to write one under', () => {
    const doc = sheet();
    delete (doc.model.nodes as Record<string, any>).tell;
    const shape = outwardShape(shaped('phase', doc).ctx);
    expect(shape.trigger).toBe(null);
    expect(shape.newId).toBe('phaseTells');
    expect(shape.target).toEqual({ kind: 'url', url: '', method: 'POST' });
    expect(shape.enabled).toBe(true);
  });

  it('a gear on a machine that already tells somebody opens THAT trigger', () => {
    const shape = outwardShape(shaped('phase').ctx);
    expect(shape.trigger).toBe('tell');
    expect(shape.target).toEqual({ kind: 'url', url: 'https://inverter.example/hook', method: 'POST' });
  });

  it('opens an existing trigger on its own fields', () => {
    const shape = outwardShape(shaped('tell').ctx);
    expect(shape.trigger).toBe('tell');
    expect(shape.target).toEqual({ kind: 'url', url: 'https://inverter.example/hook', method: 'POST' });
    expect(shape.enabled).toBe(true);
  });

  it('carries the trigger type\'s own vocabulary, straight from describe()', () => {
    const shape = outwardShape(shaped('tell').ctx);
    expect(shape.vocabulary.id).toBe('trigger');
    expect(shape.vocabulary.options).toEqual((describeType('trigger') as { options: string[] }).options);
  });

  it('reads its words in the page\'s language, like everything else here', () => {
    const shape = outwardShape(shaped('tell', sheet(), ['en']).ctx);
    expect(shape.payload.values.t.label).toBe('Temperature');
    expect(shape.payload.trigger.label).toBe('Tell the inverter');
  });
});

describe('describe() answers for the two new types', () => {
  it('names the trigger, with an example that is a trigger', () => {
    const d = describeType('trigger') as { id: string, summary: string, example: Record<string, unknown> };
    expect(d.id).toBe('trigger');
    expect(d.summary.length).toBeGreaterThan(10);
    expect(d.example.type).toBe('trigger');
  });

  it('the source now says it may read a url as well as a key', () => {
    const d = describeType('source') as { inputs: string[], options: string[] };
    expect(d.inputs.join(' ')).toContain('url');
    expect(d.options.join(' ')).toContain('every');
  });

  it('lists the trigger among the types', () => {
    expect(describeType()).toContain('trigger');
  });
});
