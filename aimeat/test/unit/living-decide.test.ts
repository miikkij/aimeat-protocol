/**
 * @file test/unit/living-decide.test.ts
 * @description A JUDGEMENT ABOUT TEXT MOVES A MACHINE, AND ONLY WHEN IT IS SURE. The decide node
 *   asks the decision model about another node's text and sends the winning event to a statechart
 *   when its confidence reaches the record's threshold; under the threshold a person decides.
 *
 *   THE FAILURES THIS FILE EXISTS TO CATCH, each of which would look like working software: a node
 *   that asks on mount or on every keystroke (a bill for half-words); a node that asks twice about
 *   the same text; an answer under the threshold that moves the machine anyway; an event the machine
 *   cannot take in its current state offered to the model; an answer invented when the model is not
 *   available; an older answer overwriting a newer one; and a person's verdict that is never
 *   recorded on the decision.
 * @usage cd aimeat && pnpm vitest run test/unit/living-decide.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial (living 0.8.0).
 */
import { describe, it, expect } from 'vitest';

(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const { createGraph } = await import('../../src/static/sdk-libs/living/graph.js');
const { createDecisions } = await import('../../src/static/sdk-libs/living/decide-run.js');
const { eventsAccepted } = await import('../../src/static/sdk-libs/living/nodes/decide.js');
const { validate, describe: describeType } = await import('../../src/static/sdk-libs/living/index.js');

type Any = Record<string, any>;

/** The support ticket's life cycle, as the Työkirja example writes it. */
function sheet(over: Any = {}): Any {
  return {
    v: 1,
    key: 'apps.tyokirja.sheets.tuki',
    lang: 'fi',
    model: {
      nodes: {
        message: { type: 'value', value: '', label: { fi: 'Viesti', en: 'Message' } },
        // A message is several lines: the control is the kit's textarea.
        messageBox: { type: 'control', kind: 'area', target: 'message' },
        customer: { type: 'value', value: 'Anna Virtanen' },
        ticket: {
          type: 'machine',
          initial: 'new',
          states: {
            new: { on: { URGENT: 'urgent', NORMAL: 'normal', RESOLVE: 'resolved' } },
            urgent: { on: { WAIT: 'waiting', RESOLVE: 'resolved' } },
            normal: { on: { URGENT: 'urgent', WAIT: 'waiting', RESOLVE: 'resolved' } },
            waiting: { on: { URGENT: 'urgent', NORMAL: 'normal', RESOLVE: 'resolved' } },
            resolved: { on: { REOPEN: 'normal' } },
          },
        },
        triage: {
          type: 'decide',
          input: 'message',
          names: ['customer'],
          machine: 'ticket',
          event: 'next',
          gates: 'which step the support ticket takes next',
          questions: {
            next: {
              pickOne: 'Which step does this customer message call for?',
              options: {
                URGENT: 'The customer cannot work at all.',
                NORMAL: 'An ordinary question or problem.',
                WAIT: 'We asked the customer something and wait for the answer.',
                RESOLVE: 'The customer says the problem is solved.',
                REOPEN: 'The customer says a solved problem came back.',
                NONE: 'None of the steps above.',
              },
            },
            angry: { yesNo: 'The customer is angry or threatens to leave.' },
          },
          thresholds: { next: 0.7, angry: 0.8 },
        },
        tone: { type: 'formula', expr: 'if(triage.angry >= 0.8, "vihainen", "rauhallinen")' },
      },
    },
    ...over,
  };
}

/** A clock the test turns by hand. */
function clock() {
  const queue: { fn: () => void; id: number }[] = [];
  let n = 0;
  return {
    timers: {
      set(fn: () => void) { n += 1; queue.push({ fn, id: n }); return n; },
      clear(id: number) { const at = queue.findIndex(q => q.id === id); if (at >= 0) queue.splice(at, 1); },
    },
    pending() { return queue.length; },
    run() { const all = queue.splice(0); for (const q of all) q.fn(); },
  };
}

/** A decision model that answers what the test says and records what it was asked. */
function model(answer: (state: any, questions: Any) => Any, opts: { available?: boolean } = {}) {
  const asked: Any[] = [];
  const reviews: Any[] = [];
  return {
    asked, reviews,
    api: {
      isAvailable: () => Promise.resolve(opts.available !== false),
      unavailableReason: () => (opts.available === false ? 'No TypeSafe key is set.' : null),
      ask(state: any, questions: Any, o: Any) {
        asked.push(JSON.parse(JSON.stringify({ state, questions, opts: o })));
        return Promise.resolve(answer(state, questions));
      },
      review(id: string, outcome: string, extra: Any) { reviews.push({ id, outcome, extra }); return Promise.resolve({}); },
    },
  };
}

function choice(value: string, confidence: number, angry = 0.1) {
  return {
    decision_id: 'dec-' + value + '-' + confidence,
    answers: {
      next: { type: 'choice', value, confidence, probabilities: { [value]: confidence } },
      angry: { type: 'noul', value: angry },
    },
  };
}

/** Mount the graph and the runtime, the way mount() wires them, without a screen. */
function rig(doc: Any, api: any) {
  const graph = createGraph(doc, { langs: () => ['fi'] });
  graph.refresh();
  const c = clock();
  const results: Any[] = [];
  const judge = createDecisions({
    doc, graph, langs: () => ['fi'], decide: () => api, timers: c.timers,
    onResult(out: Any) { results.push(out); },
  });
  judge.prime();
  const type = (text: string) => judge.after(graph.set('message', text));
  const flush = () => new Promise(r => setTimeout(r, 0));
  return { graph, judge, clock: c, results, type, flush };
}

describe('the decide node: its shape', () => {
  it('a sheet that writes it right mounts, and describe() teaches it with an example', () => {
    expect(validate(sheet()).refusals).toEqual([]);
    const d = describeType('decide') as Any;
    expect(d.id).toBe('decide');
    expect(d.example.type).toBe('decide');
    expect(d.languages).toEqual(['label']);
  });

  it('refuses a node that does not say what it gates', () => {
    const doc = sheet();
    delete doc.model.nodes.triage.gates;
    expect(validate(doc).refusals.join(' ')).toMatch(/no `gates`/);
  });

  it('refuses a question written as a language map, because the model is asked in English', () => {
    const doc = sheet();
    doc.model.nodes.triage.questions.angry = { yesNo: { fi: 'Asiakas on vihainen.', en: 'The customer is angry.' } };
    expect(validate(doc).refusals.join(' ')).toMatch(/asked in English/);
  });

  it('refuses an event question with no threshold, and one whose options are no events of the machine', () => {
    const a = sheet();
    delete a.model.nodes.triage.thresholds.next;
    expect(validate(a).refusals.join(' ')).toMatch(/no threshold for the event question "next"/);
    const b = sheet();
    b.model.nodes.triage.questions.next.options = { YES: 'yes', NO: 'no' };
    expect(validate(b).refusals.join(' ')).toMatch(/none of whose options is an event/);
  });

  it('knows which events a state accepts', () => {
    const m = sheet().model.nodes.ticket;
    expect(eventsAccepted(m, 'new')).toEqual(['URGENT', 'NORMAL', 'RESOLVE']);
    expect(eventsAccepted(m, 'resolved')).toEqual(['REOPEN']);
  });
});

describe('the decide node: when it asks', () => {
  it('asks nothing on mount, even when the input already holds text', async () => {
    const doc = sheet();
    doc.model.nodes.message.value = 'Kaikki kaatui, emme pääse töihin.';
    const m = model(() => choice('URGENT', 0.9));
    const r = rig(doc, m.api);
    expect(r.clock.pending()).toBe(0);
    await r.flush();
    expect(m.asked).toHaveLength(0);
  });

  it('waits for the text to rest: three keystrokes are one question', async () => {
    const m = model(() => choice('NORMAL', 0.9));
    const r = rig(sheet(), m.api);
    r.type('Hei');
    r.type('Hei, lasku');
    r.type('Hei, laskussa on virhe.');
    expect(r.clock.pending()).toBe(1);
    r.clock.run();
    await r.flush();
    expect(m.asked).toHaveLength(1);
    expect(m.asked[0].state).toBe('Hei, laskussa on virhe.');
  });

  it('names the app the page says it is, so the decision is the app\'s in the ledger', async () => {
    const doc = (globalThis as unknown as { document: Any }).document;
    const before = doc.querySelector;
    doc.querySelector = (sel: string) => (sel === 'meta[name="aimeat-app"]' ? { getAttribute: () => 'tyokirja.html' } : null);
    try {
      const m = model(() => choice('NORMAL', 0.9));
      const r = rig(sheet(), m.api);
      r.type('Laskussa on virhe.');
      r.clock.run(); await r.flush();
      expect(m.asked[0].opts.app_id).toBe('tyokirja.html');
    } finally { doc.querySelector = before; }
  });

  it('does not ask twice about the same text', async () => {
    const m = model(() => choice('NORMAL', 0.9));
    const r = rig(sheet(), m.api);
    r.type('Laskussa on virhe.');
    r.clock.run(); await r.flush();
    r.type('x');
    r.type('Laskussa on virhe.');
    r.clock.run(); await r.flush();
    expect(m.asked).toHaveLength(1);
  });

  it('sends the gates, the thresholds in force and the names, and offers only what the state accepts', async () => {
    const m = model(() => choice('NORMAL', 0.9));
    const r = rig(sheet(), m.api);
    r.type('Anna Virtanen kysyy laskusta.');
    r.clock.run(); await r.flush();
    const sent = m.asked[0];
    expect(sent.opts.gates).toBe('which step the support ticket takes next');
    expect(sent.opts.thresholds).toEqual({ next: 0.7, angry: 0.8 });
    expect(sent.opts.names).toEqual(['Anna Virtanen']);
    expect(sent.opts.subject).toBe('apps.tyokirja.sheets.tuki#triage');
    // No <meta name="aimeat-app"> in this stub page, so no app is claimed.
    expect(sent.opts.app_id).toBeUndefined();
    // In "new", WAIT and REOPEN are not events this state takes; NONE is no event at all, so it stays.
    expect(Object.keys(sent.questions.next.criteria).sort()).toEqual(['NONE', 'NORMAL', 'RESOLVE', 'URGENT']);
    expect(sent.questions.angry).toEqual({ type: 'noul', instructions: 'The customer is angry or threatens to leave.' });
  });
});

describe('the decide node: what an answer does', () => {
  it('a sure answer moves the machine, and a formula reads the answers', async () => {
    const m = model(() => choice('URGENT', 0.91, 0.86));
    const r = rig(sheet(), m.api);
    r.type('Järjestelmä on alhaalla, menetämme rahaa. Tämä on kolmas kerta!');
    r.clock.run(); await r.flush();
    expect(r.graph.valueOf('ticket')).toBe('urgent');
    expect(r.graph.valueOf('triage')).toBe('moved');
    expect(r.graph.fieldsOf('triage').next).toBe('URGENT');
    expect(r.graph.fieldsOf('triage')['next.confidence']).toBe(0.91);
    expect(r.graph.fieldsOf('triage')['angry.passed']).toBe(true);
    expect(r.graph.valueOf('tone')).toBe('vihainen');
    const moved = r.results.flatMap(x => x.transitions);
    expect(moved).toEqual([{ node: 'ticket', from: 'new', to: 'urgent', event: 'URGENT' }]);
    expect(r.judge.list()[0]).toMatchObject({ outcome: 'moved', by: 'model', event: 'URGENT', gates: 'which step the support ticket takes next' });
  });

  it('says what personal data never left: the node counts it, the sheet reads it', async () => {
    const m = model(() => ({ ...choice('NORMAL', 0.9), scrub: { total: 2, removed: { person: 1, email: 1, phone: 0 } } }));
    const r = rig(sheet(), m.api);
    expect(r.graph.fieldsOf('triage').removed).toBe('');
    r.type('Anna Virtanen, anna@example.fi: laskussa on virhe.');
    r.clock.run(); await r.flush();
    const f = r.graph.fieldsOf('triage');
    expect(f.removed).toBe(2);
    expect(f['removed.person']).toBe(1);
    expect(f['removed.email']).toBe(1);
  });

  it('an answer under the threshold does not move the machine; it waits for a person', async () => {
    const m = model(() => choice('RESOLVE', 0.55));
    const r = rig(sheet(), m.api);
    r.type('No nyt se ehkä toimii, en ole varma.');
    r.clock.run(); await r.flush();
    expect(r.graph.valueOf('ticket')).toBe('new');
    expect(r.graph.valueOf('triage')).toBe('person');
    expect(r.graph.fieldsOf('triage').pending).toBe('RESOLVE');
    expect(r.results.flatMap(x => x.transitions)).toEqual([]);
  });

  it('the person confirms: the machine moves and the verdict is recorded as confirmed', async () => {
    const m = model(() => choice('RESOLVE', 0.55));
    const r = rig(sheet(), m.api);
    r.type('No nyt se ehkä toimii.');
    r.clock.run(); await r.flush();
    r.judge.resolve('triage', 'RESOLVE');
    expect(r.graph.valueOf('ticket')).toBe('resolved');
    expect(r.graph.valueOf('triage')).toBe('moved');
    expect(m.reviews).toEqual([{ id: 'dec-RESOLVE-0.55', outcome: 'confirmed', extra: {} }]);
    expect(r.judge.list().at(-1)).toMatchObject({ by: 'person', outcome: 'moved', event: 'RESOLVE' });
  });

  it('the person overrides, or keeps the state: recorded as overridden', async () => {
    const m = model(() => choice('RESOLVE', 0.55));
    const a = rig(sheet(), m.api);
    a.type('Ehkä toimii.');
    a.clock.run(); await a.flush();
    a.judge.resolve('triage', 'NORMAL');
    expect(a.graph.valueOf('ticket')).toBe('normal');
    const b = rig(sheet(), m.api);
    b.type('Ehkä toimii taas.');
    b.clock.run(); await b.flush();
    b.judge.resolve('triage', '');
    expect(b.graph.valueOf('ticket')).toBe('new');
    expect(b.graph.valueOf('triage')).toBe('stayed');
    expect(m.reviews.map(x => [x.outcome, x.extra.override])).toEqual([['overridden', 'NORMAL'], ['overridden', 'NONE']]);
  });

  it('a sure "none of these" keeps the state', async () => {
    const m = model(() => choice('NONE', 0.95));
    const r = rig(sheet(), m.api);
    r.type('Kiitos viestistä.');
    r.clock.run(); await r.flush();
    expect(r.graph.valueOf('ticket')).toBe('new');
    expect(r.graph.valueOf('triage')).toBe('stayed');
  });
});

describe('the decide node: when it cannot ask', () => {
  it('not available on this account: says why, invents nothing, moves nothing', async () => {
    const m = model(() => choice('URGENT', 0.99), { available: false });
    const r = rig(sheet(), m.api);
    r.type('Kaikki kaatui.');
    r.clock.run(); await r.flush();
    expect(m.asked).toHaveLength(0);
    expect(r.graph.valueOf('triage')).toBe('unavailable');
    expect(r.graph.fieldsOf('triage').reason).toBe('No TypeSafe key is set.');
    expect(r.graph.fieldsOf('triage').next).toBe('');
    expect(r.graph.fieldsOf('triage').angry).toBe('');
    expect(r.graph.valueOf('ticket')).toBe('new');
  });

  it('when the model cannot answer, a person moves the machine by hand and nothing is reviewed', async () => {
    const m = model(() => choice('URGENT', 0.99), { available: false });
    const r = rig(sheet(), m.api);
    r.type('Kaikki kaatui.');
    r.clock.run(); await r.flush();
    r.judge.resolve('triage', 'URGENT');
    expect(r.graph.valueOf('ticket')).toBe('urgent');
    expect(m.reviews).toEqual([]);
    expect(r.judge.list().at(-1)).toMatchObject({ by: 'person', outcome: 'moved', decision: '' });
  });

  it('a person cannot press for the model while it is sure: resolve() does nothing after a move', async () => {
    const m = model(() => choice('URGENT', 0.95));
    const r = rig(sheet(), m.api);
    r.type('Kaikki kaatui.');
    r.clock.run(); await r.flush();
    expect(r.judge.resolve('triage', 'RESOLVE')).toBeNull();
    expect(r.graph.valueOf('ticket')).toBe('urgent');
  });

  it('no decision library on the page: says so in the page language', async () => {
    const r = rig(sheet(), null);
    r.type('Kaikki kaatui.');
    r.clock.run(); await r.flush();
    expect(r.graph.valueOf('triage')).toBe('unavailable');
    expect(r.graph.fieldsOf('triage').reason).toMatch(/aimeat-decide\.js/);
  });

  it('a refused call is "failed" with the node\'s own words, and the machine stays', async () => {
    const m = model(() => { throw Object.assign(new Error('This app must say in its data map that data goes to TypeSafe before it can ask.'), { code: 'DATAMAP_REQUIRED' }); });
    m.api.ask = () => Promise.reject(Object.assign(new Error('This app must say in its data map that data goes to TypeSafe before it can ask.'), { code: 'DATAMAP_REQUIRED' }));
    const r = rig(sheet(), m.api);
    r.type('Kaikki kaatui.');
    r.clock.run(); await r.flush();
    expect(r.graph.valueOf('triage')).toBe('failed');
    expect(r.graph.fieldsOf('triage').reason).toMatch(/data map/);
    expect(r.graph.valueOf('ticket')).toBe('new');
  });

  it('an older answer that arrives late is dropped: the newest text wins', async () => {
    const pending: ((v: Any) => void)[] = [];
    const m = model(() => choice('NORMAL', 0.9));
    m.api.ask = () => new Promise(res => pending.push(res));
    const r = rig(sheet(), m.api);
    r.type('Ensimmäinen viesti.');
    r.clock.run(); await r.flush();
    r.type('Toinen viesti: kaikki on alhaalla.');
    r.clock.run(); await r.flush();
    expect(pending).toHaveLength(2);
    pending[1](choice('URGENT', 0.9));
    await r.flush();
    pending[0](choice('RESOLVE', 0.99));
    await r.flush();
    expect(r.graph.valueOf('ticket')).toBe('urgent');
    expect(r.graph.fieldsOf('triage').next).toBe('URGENT');
  });
});
