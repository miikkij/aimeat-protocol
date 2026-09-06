/**
 * @file test/unit/living-source-url.test.ts
 * @description A VALUE THAT COMES FROM A URL. The memory-key source has been here since 0.1.0; this
 *   is the other road — a reading pulled off an address through the node's extension, dug out of the
 *   answer with a path, or taken raw.
 *
 *   THE FAILURE THIS FILE IS WRITTEN FOR IS THE ONE THAT LOOKS FINE: a read that fails and BLANKS
 *   the node. A day's spot prices that go to zero because the server was down for one poll is a
 *   document that lies, and it lies with a number rather than with a message. So a failed read keeps
 *   the last value and marks the node stale IN WORDS, which the sentence and the chain can show.
 *   The rest is arithmetic on the answer: a dotted-and-bracketed path, a raw body that is a number
 *   if it parses and a string otherwise, and a poll interval with a floor under it so a document
 *   cannot be written that hammers somebody's API ten times a second.
 * @usage cd aimeat && pnpm vitest run test/unit/living-source-url.test.ts
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
const { createHooks } = await import('../../src/static/sdk-libs/living/hooks.js');
const { createUrlSources } = await import('../../src/static/sdk-libs/living/sources-url.js');
const { digPath, pathError } = await import('../../src/static/sdk-libs/living/json-path.js');
const { validate } = await import('../../src/static/sdk-libs/living/index.js');

/** A sheet whose price comes off an address. */
function sheet(source: Record<string, unknown>) {
  return {
    v: 1,
    lang: 'fi',
    model: {
      nodes: {
        spot: { type: 'source', unit: 'EUR/kWh', value: 0, label: { fi: 'Pörssihinta', en: 'Spot price' }, ...source },
        doubled: { type: 'formula', expr: 'spot * 2', unit: 'EUR/kWh' },
      },
    },
  };
}

function wire(doc: ReturnType<typeof sheet>, answer: (req: Record<string, any>) => unknown, signedIn = true) {
  const graph = createGraph(doc, { langs: () => ['fi'] });
  graph.refresh();
  const seen: Record<string, any>[] = [];
  const hooks = createHooks({
    signedIn,
    transport: (req: Record<string, any>) => { seen.push(req); return Promise.resolve(answer(req)); },
  });
  const runtime = createUrlSources({ doc, graph, hooks, langs: () => ['fi'] });
  return { graph, hooks, runtime, seen };
}

describe('the path into the answer', () => {
  it('reads dots and brackets, counted from zero', () => {
    const body = { prices: [{ price: 4.2 }, { price: 9.1 }], meta: { unit: 'c' } };
    expect(digPath(body, 'prices[1].price')).toBe(9.1);
    expect(digPath(body, 'meta.unit')).toBe('c');
    expect(digPath(body, 'prices.0.price')).toBe(4.2);
    expect(digPath(body, '')).toBe(body);
  });

  it('answers undefined rather than throwing where the path runs out', () => {
    expect(digPath({ a: 1 }, 'a.b.c')).toBe(undefined);
    expect(digPath(null, 'a')).toBe(undefined);
  });

  it('names a path it cannot read as a path', () => {
    expect(pathError('prices[1].price')).toBe(null);
    expect(pathError('')).toBe(null);
    expect(pathError('prices[').toString()).toMatch(/path/i);
    expect(pathError('a..b')).toBeTruthy();
    expect(pathError('a b')).toBeTruthy();
  });
});

describe('a reading pulled off an address', () => {
  it('puts the value at the path into the graph, with the node\'s unit on it', async () => {
    const doc = sheet({ url: 'https://api.example/prices', path: 'prices[1].price', every: 60 });
    const w = wire(doc, () => ({
      value: 9.1, fetchedAt: '2026-09-06T10:00:00.000Z', contentType: 'application/json',
    }));
    await w.runtime.readOnce('spot');
    expect((w.graph.valueOf('spot') as { n: number, u: { label: string } }).n).toBe(9.1);
    expect((w.graph.valueOf('spot') as { u: { label: string } }).u.label).toBe('EUR/kWh');
    expect((w.graph.valueOf('doubled') as { n: number }).n).toBeCloseTo(18.2, 10);
  });

  it('hands the extension the url, the path and nothing this library invented', async () => {
    const doc = sheet({ url: 'https://api.example/prices', path: 'prices[1].price' });
    const w = wire(doc, () => ({ value: 9.1, fetchedAt: 'now', contentType: 'application/json' }));
    await w.runtime.readOnce('spot');
    expect(w.seen[0]).toMatchObject({
      kind: 'read', url: 'https://api.example/prices', path: 'prices[1].price',
    });
  });

  it('takes the body raw when the record asks for it: a number if it parses, otherwise the text', async () => {
    const num = sheet({ url: 'https://api.example/n', raw: true });
    const a = wire(num, () => ({ value: '12.5', fetchedAt: 'now', contentType: 'text/plain' }));
    await a.runtime.readOnce('spot');
    expect((a.graph.valueOf('spot') as { n: number }).n).toBe(12.5);

    const word = sheet({ url: 'https://api.example/s', raw: true, unit: undefined });
    const b = wire(word, () => ({ value: 'kaunis', fetchedAt: 'now', contentType: 'text/plain' }));
    await b.runtime.readOnce('spot');
    expect(b.graph.valueOf('spot')).toBe('kaunis');
  });
});

describe('a failed read keeps the last value and says so', () => {
  it('leaves the number where it was and marks the node stale in words', async () => {
    const doc = sheet({ url: 'https://api.example/prices', path: 'price' });
    let ok = true;
    const w = wire(doc, () => (ok
      ? { value: 7.5, fetchedAt: 'now', contentType: 'application/json' }
      : { error: { code: 'UPSTREAM_FAILED', message: 'api.example answered 503.' } }));
    await w.runtime.readOnce('spot');
    expect((w.graph.valueOf('spot') as { n: number }).n).toBe(7.5);

    ok = false;
    await w.runtime.readOnce('spot');
    expect((w.graph.valueOf('spot') as { n: number }).n).toBe(7.5);
    const stale = String((w.graph.fieldsOf('spot') as { stale?: string }).stale || '');
    expect(stale).toContain('503');
    expect(stale.length).toBeGreaterThan(10);
  });

  it('clears the stale words on the next read that works', async () => {
    const doc = sheet({ url: 'https://api.example/prices', path: 'price' });
    let ok = false;
    const w = wire(doc, () => (ok
      ? { value: 3, fetchedAt: 'now', contentType: 'application/json' }
      : { error: { code: 'RATE_LIMITED', message: 'Too many reads this minute.' } }));
    await w.runtime.readOnce('spot');
    expect(String((w.graph.fieldsOf('spot') as { stale?: string }).stale)).toBeTruthy();
    ok = true;
    await w.runtime.readOnce('spot');
    expect((w.graph.fieldsOf('spot') as { stale?: string }).stale).toBe('');
  });

  it('a guest is told to sign in, and the last value stays', async () => {
    const doc = sheet({ url: 'https://api.example/prices', path: 'price', value: 4 });
    const w = wire(doc, () => ({ value: 9, fetchedAt: 'now', contentType: 'application/json' }), false);
    await w.runtime.readOnce('spot');
    expect(w.seen.length).toBe(0);
    expect((w.graph.valueOf('spot') as { n: number }).n).toBe(4);
    expect(String((w.graph.fieldsOf('spot') as { stale?: string }).stale)).toMatch(/[Kk]irjaudu/);
  });
});

describe('the poll has a floor under it', () => {
  it('refuses an every under ten seconds, by name and with the number', () => {
    const out = validate(sheet({ url: 'https://api.example/p', every: 2 }));
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('spot');
    expect(out.refusals.join(' ')).toContain('10');
  });

  it('refuses a path it cannot read', () => {
    const out = validate(sheet({ url: 'https://api.example/p', path: 'prices[' }));
    expect(out.ok).toBe(false);
    expect(out.refusals.join(' ')).toContain('spot');
  });

  it('takes a proper one', () => {
    expect(validate(sheet({ url: 'https://api.example/p', path: 'a.b[0]', every: 10 })).ok).toBe(true);
    expect(validate(sheet({ url: 'https://api.example/p', raw: true })).ok).toBe(true);
  });

  it('leaves the memory-key form exactly as it was', () => {
    expect(validate(sheet({ key: 'sensors.livingroom', path: 'celsius' })).ok).toBe(true);
  });

  it('names which nodes are polled and how often, clamped to the floor', () => {
    const doc = sheet({ url: 'https://api.example/p', every: 10 });
    const w = wire(doc, () => ({ value: 1, fetchedAt: 'now', contentType: 'application/json' }));
    expect(w.runtime.polled()).toEqual([{ id: 'spot', every: 10 }]);
  });
});
