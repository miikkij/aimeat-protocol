/**
 * @file test/unit/atelier-doc-decision.test.ts
 * @description The Atelier kit's doc and decision blocks over a stub AIMEAT.md and AIMEAT.decide,
 *   and the living decide row's "taken out before sending" sentence, which both now draw through
 *   decide/removed-line.js. doc: sample, empty, no library, a render that throws, rendered, the
 *   rich swap, citations. decision: sample, signed out, no library, unavailable with the settings
 *   link, empty, ready, asking, answered with bars and numbers, the removed data, the cost and who
 *   answered, under the threshold the person's Confirm and Override through review(), a rule run,
 *   the provider choice, and a refusal in the kit's words for its code. Key parity across en, fi
 *   and es.
 * @version-history
 *   v1.0.0 - 2026-10-01 - Initial.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let living: any;
let docMod: any;
let decMod: any;
let words: any;
let kitI18n: any;
let calls: Array<{ op: string; args: any }>;
let session: any;
let available: boolean;
let askAnswer: () => Promise<any>;
let reviewAnswer: () => Promise<any>;
let mdRender: (text: string) => any;
let mdRich: ((text: string) => Promise<any>) | null;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const byClass = (root: any, cls: string) => all(root).filter((n) => n.attrs && String(n.attrs.class || '').split(/\s+/).includes(cls));
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const click = (n: any) => n.dispatchEvent({ type: 'click', bubbles: true });
async function settle() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); }

/** An answer the node gives for questions with thresholds: urgent passes, topic falls short. */
const ANSWER = {
  decision_id: 'dec_1',
  model: 'jev-1',
  cached: false,
  answers: {
    urgent: { type: 'noul', value: 0.91 },
    topic: { type: 'choice', value: 'invoice', probabilities: { invoice: 0.55, meeting: 0.35, other: 0.1 }, confidence: 0.55 },
  },
  passed: { urgent: true, topic: false },
  scrub: { removed: { person: 2, phone: 1 }, total: 3, skipped: false },
  usage: { input_tokens: 300, cost_usd: 0.0003 },
  key_source: 'own',
  provider: { id: 'typesafe', kind: 'hosted', chosen_by: 'owner' },
};

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {
    auth: { getSession: () => session, on: () => {}, off: () => {} },
    md: {
      render: (text: string) => mdRender(text),
      get renderRich() { return mdRich || undefined; },
      sanitizeHref: (u: string) => (/^https?:/.test(u) ? u : null),
      citations: (text: string) => ({ body: text.replace(/^Sources?:.*$/m, '').trim(), sources: [{ url: 'https://example.com/a', host: 'example.com', shortened: false }, { url: 'https://bit.ly/x', host: 'bit.ly', shortened: true }] }),
    },
    decide: {
      isAvailable: async () => { calls.push({ op: 'isAvailable', args: null }); return available; },
      unavailableReason: () => 'No TypeSafe key is set.',
      // The library names the settings page; the kit holds no node path of its own (e2e-libs).
      settingsUrl: () => 'https://node.test/v1/profile?tab=ai&open=decide-card',
      ask: async (state: any, questions: any, opts: any) => { calls.push({ op: 'ask', args: { state, questions, opts } }); return askAnswer(); },
      gate: async (state: any, questions: any, thresholds: any, opts: any) => { calls.push({ op: 'gate', args: { state, questions, thresholds, opts } }); return askAnswer(); },
      rule: async (id: string) => {
        calls.push({ op: 'rule', args: id });
        return { id, title: 'Urgent mail', thresholds: { urgent: 0.8 }, ask: async (state: any, opts: any) => { calls.push({ op: 'ruleAsk', args: { state, opts } }); return askAnswer(); } };
      },
      review: async (id: string, outcome: string, extra: any) => { calls.push({ op: 'review', args: { id, outcome, extra } }); return reviewAnswer(); },
      providers: async () => ({ providers: [
        { id: 'typesafe', title: 'TypeSafe', kind: 'hosted', data_statement: 'Your text goes to TypeSafe in the EU.' },
        { id: 'home', title: 'Home box', kind: 'local', data_statement: 'Your text stays on your machine.' },
      ], default: 'typesafe', node_default: 'typesafe' }),
    },
  };
  living = await import('../../src/static/sdk-libs/living/render-decide.js');
  docMod = await import('../../src/static/sdk-libs/atelier/doc.js');
  decMod = await import('../../src/static/sdk-libs/atelier/decision.js');
  words = await import('../../src/static/sdk-libs/atelier/decision-i18n.js');
  kitI18n = (await import('../../src/static/sdk-libs/atelier/i18n.js')).i18n;
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  session = { token: 't' };
  available = true;
  askAnswer = async () => JSON.parse(JSON.stringify(ANSWER));
  reviewAnswer = async () => ({ ok: true });
  mdRender = (text: string) => { const d = document.createElement('div'); d.setAttribute('class', 'md-body'); d.textContent = 'MD:' + text; return d; };
  mdRich = null;
  kitI18n.setLang('en');
});

describe('living decideRow: the removed line stays as it was', () => {
  function row(fields: Record<string, any>, langs: string[]) {
    const host = document.createElement('div');
    const graph = { valueOf: () => 'decided', fieldsOf: () => fields, nodeOf: () => ({}) };
    living.decideRow(host, { id: 'triage', node: { questions: {}, gates: 'g' }, graph, label: () => 'Triage', langs: () => langs });
    return byClass(host, 'ak-living__decide-removed')[0];
  }
  it('names each kind with its count, in order, singular and plural', () => {
    const f = { removed: 4, 'removed.email': 2, 'removed.person': 1, 'removed.iban': 1 };
    expect(row(f, ['en']).textContent).toBe('Taken out of the text before sending: 1 name, 2 e-mail addresses, 1 account number. The screen shows the message as you wrote it.');
    expect(row(f, ['fi']).textContent).toBe('Poistettiin tekstistä ennen lähetystä: 1 nimi, 2 sähköpostiosoitetta, 1 tilinumero. Ruudulla viesti näkyy sellaisena kuin kirjoitit sen.');
  });
  it('says nothing was found, and is hidden before an answer', () => {
    expect(row({ removed: 0 }, ['en']).textContent).toBe('No personal data was found, so nothing was taken out of the text before sending.');
    expect(row({ removed: '' }, ['en']).hidden).toBe(true);
  });
});

describe('the words', () => {
  it('carry the same keys in en, fi and es', () => {
    const { en, fi, es } = words.DECISION_KEYS;
    expect([...fi].sort()).toEqual([...en].sort());
    expect([...es].sort()).toEqual([...en].sort());
  });
});

describe('doc', () => {
  it('renders through AIMEAT.md and keeps the element in its box', () => {
    const host = document.createElement('div');
    const d = docMod.doc({ target: host, markdown: '# Hello', title: 'Notes' });
    expect(d.el.getAttribute('data-ak-state')).toBe('rendered');
    expect(part(host, 'title')[0].textContent).toBe('Notes');
    const md = part(host, 'md')[0];
    expect(md.attrs.class).toBe('md-body');
    expect(md.textContent).toBe('MD:# Hello');
    d.set({ markdown: 'Second' });
    expect(part(host, 'md')[0].textContent).toBe('MD:Second');
    d.destroy();
    expect(host.children.length).toBe(0);
  });
  it('shows the empty card with the app words, and the sample with its badge', () => {
    const host = document.createElement('div');
    const d = docMod.doc({ target: host, markdown: '  ', empty: { title: 'No handoff yet', hint: 'Write one first.' } });
    expect(d.el.getAttribute('data-ak-state')).toBe('empty');
    expect(part(host, 'empty')[0].textContent).toContain('No handoff yet');
    expect(part(host, 'empty')[0].textContent).toContain('Write one first.');
    const s = docMod.doc({ target: host, markdown: '<markdown>' });
    expect(s.el.getAttribute('data-ak-state')).toBe('sample');
    expect(byClass(s.el, 'ak-mem-sample').length).toBe(1);
    expect(part(s.el, 'md')[0].textContent).toContain('Weekly summary');
  });
  it('falls back to the text as written without the library, and when render throws', () => {
    const host = document.createElement('div');
    const saved = (window as any).AIMEAT.md;
    (window as any).AIMEAT.md = undefined;
    const a = docMod.doc({ target: host, markdown: 'line one\nline two' });
    expect(a.el.getAttribute('data-ak-state')).toBe('text');
    expect(part(a.el, 'text')[0].textContent).toBe('line one\nline two');
    (window as any).AIMEAT.md = saved;
    mdRender = () => { throw new Error('boom'); };
    const b = docMod.doc({ target: host, markdown: 'kept' });
    expect(b.el.getAttribute('data-ak-state')).toBe('error');
    expect(part(b.el, 'text')[0].textContent).toBe('kept');
  });
  it('draws the safe subset at once and swaps in the rich render', async () => {
    let resolveRich: (v: any) => void = () => {};
    mdRich = () => new Promise((r) => { resolveRich = r; });
    const host = document.createElement('div');
    const d = docMod.doc({ target: host, markdown: 'rich text', rich: true });
    expect(d.el.getAttribute('data-ak-state')).toBe('rendering');
    expect(part(host, 'md')[0].textContent).toBe('MD:rich text');
    await settle();
    const rich = document.createElement('div');
    rich.setAttribute('class', 'md-body');
    rich.textContent = 'RICH';
    resolveRich(rich);
    await settle();
    expect(d.el.getAttribute('data-ak-state')).toBe('rendered');
    expect(part(host, 'md')[0].textContent).toBe('RICH');
  });
  it('keeps the plain render when the rich one rejects', async () => {
    mdRich = () => Promise.reject(new Error('cdn down'));
    const host = document.createElement('div');
    const d = docMod.doc({ target: host, markdown: 'x', rich: true });
    await settle();
    expect(d.el.getAttribute('data-ak-state')).toBe('rendered');
    expect(part(host, 'md')[0].textContent).toBe('MD:x');
  });
  it('lists cited sources under the text, and says which link is shortened', () => {
    const host = document.createElement('div');
    docMod.doc({ target: host, markdown: 'Body text\nSources: https://example.com/a', citations: true });
    expect(part(host, 'md')[0].textContent).toBe('MD:Body text');
    const items = part(host, 'source');
    expect(items.length).toBe(2);
    expect(items[0].children[0].attrs.href).toBe('https://example.com/a');
    expect(items[0].children[0].attrs.rel).toContain('noopener');
    expect(items[1].textContent).toContain('shortened link');
  });
});

describe('decision', () => {
  const Q = { urgent: { type: 'noul', instructions: 'Needs an answer today.' }, topic: { type: 'choice', instructions: 'Topic', criteria: { invoice: null, meeting: null, other: null } } };

  it('draws the sample without asking anything', async () => {
    const host = document.createElement('div');
    const d = decMod.decision({ target: host, appId: '<app>' });
    await settle();
    expect(d.el.getAttribute('data-ak-state')).toBe('sample');
    expect(byClass(d.el, 'ak-mem-sample').length).toBe(1);
    expect(part(d.el, 'answer').length).toBe(2);
    click(part(d.el, 'confirm')[0]);
    await settle();
    expect(calls.filter((c) => c.op === 'review' || c.op === 'ask')).toEqual([]);
    expect(part(d.el, 'status')[0].textContent).toBe('A sample. Nothing was recorded.');
  });

  it('says what is missing: the library, a session, availability', async () => {
    const host = document.createElement('div');
    const saved = (window as any).AIMEAT.decide;
    (window as any).AIMEAT.decide = undefined;
    const a = decMod.decision({ target: host, appId: 'app1', questions: Q });
    await settle();
    expect(a.el.getAttribute('data-ak-state')).toBe('no-library');
    expect(part(a.el, 'failure')[0].attrs.role).toBe('alert');
    (window as any).AIMEAT.decide = saved;
    session = null;
    const b = decMod.decision({ target: host, appId: 'app1', questions: Q });
    await settle();
    expect(b.el.getAttribute('data-ak-state')).toBe('signed-out');
    session = { token: 't' };
    available = false;
    const c = decMod.decision({ target: host, appId: 'app1', questions: Q, state: 'x' });
    await settle();
    expect(c.el.getAttribute('data-ak-state')).toBe('unavailable');
    expect(part(c.el, 'failure')[0].textContent).toContain('No TypeSafe key is set.');
    expect(part(c.el, 'settings')[0].attrs.href).toContain('/v1/profile?tab=ai&open=decide-card');
    expect(await c.ask()).toBe(null);
    expect(calls.some((x) => x.op === 'ask' || x.op === 'gate')).toBe(false);
  });

  it('waits for a state, then for a press, and never asks on its own', async () => {
    const host = document.createElement('div');
    const d = decMod.decision({ target: host, appId: 'app1', questions: Q });
    await settle();
    expect(d.el.getAttribute('data-ak-state')).toBe('empty');
    const r = decMod.decision({ target: host, appId: 'app1', questions: Q, state: 'Please pay by Friday' });
    await settle();
    expect(r.el.getAttribute('data-ak-state')).toBe('ready');
    expect(calls.some((x) => x.op === 'ask')).toBe(false);
    click(part(r.el, 'ask')[0]);
    await settle();
    expect(calls.find((x) => x.op === 'ask')!.args).toEqual({ state: 'Please pay by Friday', questions: Q, opts: { app_id: 'app1' } });
    expect(r.el.getAttribute('data-ak-state')).toBe('answered');
  });

  it('shows each answer with its number, threshold, verdict, removed data, cost and who answered', async () => {
    const host = document.createElement('div');
    let seen: any = null;
    const d = decMod.decision({ target: host, appId: 'app1', questions: Q, thresholds: { urgent: 0.8, topic: 0.7 }, gates: 'which folder', subject: 'mail:1', labels: { urgent: 'Urgent' }, onOutcome: (x: any) => { seen = x; } });
    let mid = '';
    askAnswer = async () => { mid = d.el.getAttribute('data-ak-state'); return JSON.parse(JSON.stringify(ANSWER)); };
    const r = await d.ask('Call me today');
    expect(mid).toBe('asking');
    expect(r.decision_id).toBe('dec_1');
    expect(calls.find((x) => x.op === 'gate')!.args.opts).toEqual({ app_id: 'app1', subject: 'mail:1', gates: 'which folder' });
    expect(seen.needsPerson).toBe(true);
    const answers = part(d.el, 'answer');
    expect(answers.map((a: any) => a.attrs['data-question'])).toEqual(['urgent', 'topic']);
    expect(part(answers[0], 'question')[0].textContent).toBe('Urgent');
    expect(part(answers[0], 'value')[0].textContent).toBe('0.91');
    expect(part(answers[0], 'verdict')[0].textContent).toBe('reaches the threshold');
    const bar0 = part(answers[0], 'bar')[0];
    expect(bar0.attrs.role).toBe('meter');
    expect(bar0.attrs['aria-valuetext']).toBe('0.91, threshold 0.80');
    expect(bar0.textContent).toContain('0.91');
    expect(answers[1].attrs.class).toContain('ak-dec__answer--under');
    expect(part(answers[1], 'verdict')[0].textContent).toBe('under the threshold');
    expect(part(answers[1], 'options')[0].textContent).toContain('meeting');
    expect(part(d.el, 'removed')[0].textContent).toBe('Taken out of the text before sending: 2 names, 1 phone number. The text on your screen did not change.');
    expect(part(d.el, 'cost')[0].textContent).toBe('Cost $0.0003, paid with your own key.');
    expect(part(d.el, 'who')[0].textContent).toBe('Answered by typesafe (an outside service, your default). Model: jev-1.');
    expect(part(d.el, 'status')[0].textContent).toBe('The decision model answered.');
  });

  it('records Confirm and Override through review(), and only on a press', async () => {
    const host = document.createElement('div');
    const d = decMod.decision({ target: host, appId: 'app1', questions: Q, thresholds: { topic: 0.7 }, state: 'x' });
    await d.ask();
    expect(calls.some((x) => x.op === 'review')).toBe(false);
    click(part(d.el, 'confirm')[0]);
    await settle();
    expect(calls.find((x) => x.op === 'review')!.args).toEqual({ id: 'dec_1', outcome: 'confirmed', extra: {} });
    expect(part(d.el, 'recorded')[0].textContent).toBe('Saved: you confirmed the answer.');

    calls = [];
    const e = decMod.decision({ target: host, appId: 'app1', questions: Q, thresholds: { topic: 0.7 }, state: 'x' });
    await e.ask();
    click(part(e.el, 'override')[0]);
    expect(part(e.el, 'overridePanel')[0].hidden).toBe(false);
    const pick = part(e.el, 'overridePick')[0];
    expect(pick.options.map((o: any) => o.value)).toEqual(['invoice', 'meeting', 'other']);
    pick.value = 'meeting';
    part(e.el, 'note')[0].value = 'It is a meeting request';
    click(part(e.el, 'record')[0]);
    await settle();
    expect(calls.find((x) => x.op === 'review')!.args).toEqual({ id: 'dec_1', outcome: 'overridden', extra: { override: 'meeting', note: 'It is a meeting request' } });
    expect(part(e.el, 'recorded')[0].textContent).toBe('Saved: you changed the answer to meeting.');
  });

  it('keeps the buttons and says why when review() is refused', async () => {
    reviewAnswer = async () => { const err: any = new Error('Not yours'); err.code = 'FORBIDDEN'; throw err; };
    const host = document.createElement('div');
    const d = decMod.decision({ target: host, appId: 'app1', questions: Q, thresholds: { topic: 0.7 }, state: 'x' });
    await d.ask();
    click(part(d.el, 'confirm')[0]);
    await settle();
    expect(part(d.el, 'failure')[0].textContent).toBe('Your answer was not saved: Not yours');
    expect(part(d.el, 'confirm').length).toBe(1);
  });

  it('runs a rule by id with only the state, and draws its outcome and thresholds', async () => {
    askAnswer = async () => ({ ...JSON.parse(JSON.stringify(ANSWER)), passed: { urgent: true }, outcome: 'act', rule: { id: 'urgent-mail', version: 2 } });
    const host = document.createElement('div');
    const d = decMod.decision({ target: host, appId: 'app1', rule: 'urgent-mail', thresholds: { urgent: 0.1 } });
    const r = await d.ask({ text: 'hello' });
    expect(r.outcome).toBe('act');
    expect(calls.find((x) => x.op === 'ruleAsk')!.args).toEqual({ state: { text: 'hello' }, opts: { app_id: 'app1' } });
    expect(calls.some((x) => x.op === 'gate')).toBe(false);
    expect(part(d.el, 'outcome')[0].textContent).toBe('The answer is sure enough to act on.');
    expect(part(d.el, 'person').length).toBe(0);
    expect(part(part(d.el, 'answer')[0], 'threshold')[0].textContent).toBe('threshold 0.80');
  });

  it('offers the providers with their data statement, and asks the one picked', async () => {
    const host = document.createElement('div');
    const d = decMod.decision({ target: host, appId: 'app1', questions: Q, provider: 'pick', state: 'x' });
    await settle();
    const sel = part(d.el, 'provider')[0];
    expect(sel.options.map((o: any) => o.textContent)).toEqual(['TypeSafe (your default)', 'Home box · your own machine']);
    expect(part(d.el, 'providerNote')[0].textContent).toBe('Your text goes to TypeSafe in the EU.');
    sel.value = 'home';
    sel.dispatchEvent({ type: 'change', bubbles: true });
    expect(part(d.el, 'providerNote')[0].textContent).toBe('Your text stays on your machine.');
    await d.ask();
    expect(calls.find((x) => x.op === 'ask')!.args.opts.provider).toBe('home');
  });

  it('says a refusal in the kit words for its code, in the language in force', async () => {
    askAnswer = async () => { const err: any = new Error('The AI budget or allowance is used up for now.'); err.code = 'QUOTA_EXHAUSTED'; throw err; };
    kitI18n.setLang('fi');
    const host = document.createElement('div');
    const d = decMod.decision({ target: host, appId: 'app1', questions: Q, state: 'x' });
    expect(await d.ask()).toBe(null);
    expect(d.el.getAttribute('data-ak-state')).toBe('failed');
    const f = part(d.el, 'failure')[0];
    expect(f.attrs.role).toBe('alert');
    expect(f.textContent).toBe('Kysymys ei mennyt perille: Tekoälybudjettisi on nyt käytetty.');
    expect(part(d.el, 'retry').length).toBe(1);
  });

  it('drops an answer that arrives after destroy', async () => {
    let release: (v: any) => void = () => {};
    askAnswer = () => new Promise((r) => { release = r; });
    let seen = 0;
    const host = document.createElement('div');
    const d = decMod.decision({ target: host, appId: 'app1', questions: Q, state: 'x', onOutcome: () => { seen++; } });
    const p = d.ask();
    await settle();
    d.destroy();
    release(JSON.parse(JSON.stringify(ANSWER)));
    await p;
    expect(seen).toBe(0);
    expect(host.children.length).toBe(0);
  });
});
