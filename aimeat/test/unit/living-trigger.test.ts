/**
 * @file test/unit/living-trigger.test.ts
 * @description THE DOCUMENT TELLS SOMEBODY. A trigger fires when a machine actually TRANSITIONS —
 *   not on every recompute while it sits in the state it reached — and what leaves the browser is
 *   one payload carrying the whole document: which node moved, from where to where, on which event,
 *   at what time, and every value the receiver would need to act on.
 *
 *   FOUR FAILURES THIS FILE EXISTS TO CATCH, each of which would look like working software:
 *   a trigger that fires on every pass (a receiver drowned in identical messages); a burst of
 *   crossings inside ONE recompute delivered as three messages (the same event, told three times);
 *   a payload whose `values` are the raw graph objects rather than the number, unit and label a
 *   receiver can read; and a delivery that goes out for a guest, who has no session and whose call
 *   the node would refuse anyway — the library has to say so in words instead of trying.
 * @usage cd aimeat && pnpm vitest run test/unit/living-trigger.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { describe, it, expect } from 'vitest';

// The library attaches itself to window at import and reads the page's language off the document.
// Both are stubbed before the import, so nothing here depends on a browser being present.
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const { createGraph } = await import('../../src/static/sdk-libs/living/graph.js');
const { createHooks } = await import('../../src/static/sdk-libs/living/hooks.js');
const { createDeliveries } = await import('../../src/static/sdk-libs/living/deliver.js');
const { buildPayload } = await import('../../src/static/sdk-libs/living/payload.js');
const { validate } = await import('../../src/static/sdk-libs/living/index.js');

/** A sheet that crosses a threshold: a battery that charges, then exports, and tells somebody. */
function sheet(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    key: 'living.solar',
    title: { fi: 'Aurinko ja akku', en: 'Solar and battery' },
    register: 'custom:solar-proof',
    lang: 'fi',
    model: {
      nodes: {
        pv: { type: 'value', value: 1, unit: 'kW', label: { fi: 'Tuotto', en: 'Yield' } },
        load: { type: 'value', value: 2, unit: 'kW', label: { fi: 'Kulutus', en: 'Load' } },
        surplus: { type: 'formula', expr: 'pv - load', unit: 'kW', label: { fi: 'Ylijäämä', en: 'Surplus' } },
        day: { type: 'formula', expr: 'range(30)', label: { fi: 'Päivä', en: 'The day' } },
        phase: {
          type: 'machine',
          initial: 'charging',
          states: {
            charging: { on: { EXPORT: 'exporting' } },
            exporting: { on: { CHARGE: 'charging' } },
          },
          when: [
            { expr: 'surplus > 0', send: 'EXPORT' },
            { expr: 'surplus < 0', send: 'CHARGE' },
          ],
        },
        tellTheGrid: {
          type: 'trigger',
          on: 'phase',
          enabled: true,
          target: { kind: 'url', url: 'https://inverter.example/hook', method: 'POST' },
          include: 'all',
          label: { fi: 'Kerro invertterille', en: 'Tell the inverter' },
        },
      },
    },
    ...over,
  };
}

/** A transport that records every request instead of reaching the network. */
function recorder(answer?: (req: Record<string, unknown>) => unknown) {
  const seen: Record<string, unknown>[] = [];
  const fn = (req: Record<string, unknown>) => {
    seen.push(JSON.parse(JSON.stringify(req)));
    return Promise.resolve(answer ? answer(req) : { ok: true, status: 202, ms: 12 });
  };
  return { seen, fn };
}

/** Mount the parts a document's delivery runtime needs, with no DOM and no network. */
function wire(doc: ReturnType<typeof sheet>, opts: Record<string, unknown> = {}) {
  const graph = createGraph(doc, { langs: () => ['fi'] });
  const hooks = createHooks({
    transport: opts.transport, signedIn: opts.signedIn === undefined ? true : opts.signedIn,
  });
  const events: Record<string, unknown>[] = [];
  const deliveries = createDeliveries({
    doc, graph, hooks, langs: () => ['fi'],
    onDelivery: (e: Record<string, unknown>) => { events.push(e); },
  });
  return { graph, hooks, deliveries, events };
}

describe('the trigger fires on a transition and only then', () => {
  it('delivers once when the machine crosses, and says from where to where', async () => {
    const doc = sheet();
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    rec.seen.length = 0;

    // pv over load: surplus turns positive, the machine leaves charging.
    await w.deliveries.after(w.graph.set('pv', 5));

    expect(rec.seen.length).toBe(1);
    const req = rec.seen[0] as { kind: string, url: string, method: string, body: Record<string, any> };
    expect(req.kind).toBe('send');
    expect(req.url).toBe('https://inverter.example/hook');
    expect(req.method).toBe('POST');
    expect(req.body.transition).toEqual({
      node: 'phase', from: 'charging', to: 'exporting', event: 'EXPORT',
    });
    expect(req.body.machines).toEqual({ phase: 'exporting' });
    expect(req.body.trigger).toEqual({ id: 'tellTheGrid', label: 'Kerro invertterille' });
    expect(req.body.document).toEqual({
      key: 'living.solar', title: 'Aurinko ja akku', register: 'custom:solar-proof',
    });
    expect(typeof req.body.at).toBe('string');
    expect(new Date(req.body.at as string).toISOString()).toBe(req.body.at);
  });

  it('says nothing at all while the machine stays where it is', async () => {
    const doc = sheet();
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    rec.seen.length = 0;
    await w.deliveries.after(w.graph.set('pv', 6));
    await w.deliveries.after(w.graph.set('pv', 7));
    expect(rec.seen.length).toBe(0);
  });

  it('carries every value as a number, a unit and a label a receiver can read', async () => {
    const doc = sheet();
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    const body = (rec.seen[0] as { body: Record<string, any> }).body;
    expect(body.values.pv).toEqual({ value: 5, unit: 'kW', label: 'Tuotto' });
    expect(body.values.surplus).toEqual({ value: 3, unit: 'kW', label: 'Ylijäämä' });
    // A machine is not a value; it is in `machines`.
    expect(body.values.phase).toBeUndefined();
    // Nor is the trigger itself.
    expect(body.values.tellTheGrid).toBeUndefined();
  });

  it('abbreviates a row to its length and a head of 24', async () => {
    const doc = sheet();
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    const body = (rec.seen[0] as { body: Record<string, any> }).body;
    expect(body.values.day.value.length).toBe(30);
    expect(body.values.day.value.head.length).toBe(24);
    expect(body.values.day.value.head[0]).toBe(0);
  });
});

describe('one delivery per transition, however many crossings a recompute holds', () => {
  it('a burst of crossings inside one recompute is one message', async () => {
    const doc = sheet();
    // Two machines that both cross on the same move, one trigger watching each — the trigger under
    // test must still send once for its own machine.
    (doc.model.nodes as Record<string, any>).second = {
      type: 'machine', initial: 'low',
      states: { low: { on: { UP: 'high' } }, high: { on: { DOWN: 'low' } } },
      when: [{ expr: 'surplus > 0', send: 'UP' }, { expr: 'surplus < 0', send: 'DOWN' }],
    };
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    rec.seen.length = 0;
    await w.deliveries.after(w.graph.set('pv', 5));
    expect(rec.seen.length).toBe(1);
  });
});

describe('include names what leaves', () => {
  it('sends only the named nodes, and their rows whole', async () => {
    const doc = sheet();
    (doc.model.nodes as Record<string, any>).tellTheGrid.include = ['surplus', 'day'];
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    const body = (rec.seen[0] as { body: Record<string, any> }).body;
    expect(Object.keys(body.values).sort()).toEqual(['day', 'surplus']);
    expect(Array.isArray(body.values.day.value)).toBe(true);
    expect(body.values.day.value.length).toBe(30);
  });
});

describe('the two switches', () => {
  it('the trigger\'s own enabled: false stops it', async () => {
    const doc = sheet();
    (doc.model.nodes as Record<string, any>).tellTheGrid.enabled = false;
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    expect(rec.seen.length).toBe(0);
  });

  it('the document\'s master switch stops every trigger at once', async () => {
    const doc = sheet({ hooks: { enabled: false } });
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    expect(rec.seen.length).toBe(0);
    expect(w.deliveries.status().enabled).toBe(false);
  });
});

describe('a guest is told, not tried', () => {
  it('refuses in words without reaching the transport', async () => {
    const doc = sheet();
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn, signedIn: false });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    expect(rec.seen.length).toBe(0);
    expect(w.deliveries.status().signedIn).toBe(false);
    expect(String(w.deliveries.status().reason)).toMatch(/[Kk]irjaudu/);
  });
});

describe('the deliveries a mount remembers', () => {
  it('reports every delivery with ok, status and how long it took', async () => {
    const doc = sheet();
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    expect(w.events.length).toBe(1);
    expect(w.events[0]).toMatchObject({ trigger: 'tellTheGrid', ok: true, status: 202 });
    expect(typeof (w.events[0] as { ms: number }).ms).toBe('number');
    expect(w.deliveries.list().length).toBe(1);
  });

  it('names the refusal in words when the node turns the call down', async () => {
    const doc = sheet();
    const rec = recorder(() => ({ error: { code: 'ALLOWLIST_REFUSED', message: 'inverter.example is not on the list of hosts this node may call.' } }));
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    expect(w.events[0]).toMatchObject({ ok: false });
    expect(String((w.events[0] as { refusal: string }).refusal)).toContain('inverter.example');
  });

  it('keeps the last fifty and no more', async () => {
    const doc = sheet();
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    for (let i = 0; i < 60; i++) {
      await w.deliveries.after(w.graph.set('pv', i % 2 === 0 ? 5 : 0));
    }
    expect(w.deliveries.list().length).toBe(50);
  });
});

describe('a test send is marked as one', () => {
  it('sends the sample payload with test: true', async () => {
    const doc = sheet();
    const rec = recorder();
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    rec.seen.length = 0;
    const out = await w.deliveries.test('tellTheGrid');
    expect(rec.seen.length).toBe(1);
    expect((rec.seen[0] as { body: Record<string, any> }).body.test).toBe(true);
    expect(out.ok).toBe(true);
  });
});

describe('an agent target is a task, not a POST', () => {
  it('creates a task for the owner\'s named agent, titled with the crossing', async () => {
    const doc = sheet();
    (doc.model.nodes as Record<string, any>).tellTheGrid.target = { kind: 'agent', agent: 'house-crew' };
    const rec = recorder(() => ({ ok: true, status: 201, ms: 30 }));
    const w = wire(doc, { transport: rec.fn });
    await w.deliveries.after(w.graph.refresh());
    await w.deliveries.after(w.graph.set('pv', 5));
    const req = rec.seen[0] as { kind: string, agent: string, title: string, body: Record<string, any> };
    expect(req.kind).toBe('task');
    expect(req.agent).toBe('house-crew');
    expect(req.title).toBe('Living document: Aurinko ja akku, charging → exporting');
    expect(req.body.transition.event).toBe('EXPORT');
  });
});

describe('validate() reads a trigger without running it', () => {
  it('refuses a trigger watching a node that is not a machine', () => {
    const doc = sheet();
    (doc.model.nodes as Record<string, any>).tellTheGrid.on = 'pv';
    const out = validate(doc);
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('pv');
    expect(out.refusals.join(' ')).toMatch(/machine/i);
  });

  it('refuses a crossing with no node to watch', () => {
    const doc = sheet();
    (doc.model.nodes as Record<string, any>).tellTheGrid.on = { when: 'surplus > 0' };
    const out = validate(doc);
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toMatch(/node/i);
  });

  it('refuses a target with neither a url nor an agent', () => {
    const doc = sheet();
    (doc.model.nodes as Record<string, any>).tellTheGrid.target = { kind: 'url' };
    expect(validate(doc).ok).toBe(false);
    (doc.model.nodes as Record<string, any>).tellTheGrid.target = { kind: 'agent' };
    expect(validate(doc).ok).toBe(false);
  });

  it('refuses an include naming a node the document does not have', () => {
    const doc = sheet();
    (doc.model.nodes as Record<string, any>).tellTheGrid.include = ['surplus', 'nosuch'];
    const out = validate(doc);
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('nosuch');
  });

  it('takes the shape the brief agreed', () => {
    expect(validate(sheet()).ok).toBe(true);
  });
});

describe('the payload is built from the record, not from the screen', () => {
  it('answers the same object whether it is sent or shown', () => {
    const doc = sheet();
    const graph = createGraph(doc, { langs: () => ['fi'] });
    graph.refresh();
    const at = '2026-09-06T10:00:00.000Z';
    const payload = buildPayload({
      doc, graph, langs: () => ['fi'], triggerId: 'tellTheGrid',
      trigger: (doc.model.nodes as Record<string, any>).tellTheGrid,
      transition: { node: 'phase', from: 'charging', to: 'exporting', event: 'EXPORT' },
      at,
    });
    expect(payload.at).toBe(at);
    expect(payload.document.title).toBe('Aurinko ja akku');
    expect(payload.values.load).toEqual({ value: 2, unit: 'kW', label: 'Kulutus' });
  });

  it('reads the labels in the language the page is in', () => {
    const doc = sheet();
    const graph = createGraph(doc, { langs: () => ['en'] });
    graph.refresh();
    const payload = buildPayload({
      doc, graph, langs: () => ['en'], triggerId: 'tellTheGrid',
      trigger: (doc.model.nodes as Record<string, any>).tellTheGrid,
      transition: { node: 'phase', from: 'charging', to: 'exporting', event: 'EXPORT' },
      at: '2026-09-06T10:00:00.000Z',
    });
    expect(payload.values.pv.label).toBe('Yield');
    expect(payload.document.title).toBe('Solar and battery');
  });
});
