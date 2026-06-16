import { describe, it, expect } from 'vitest';
import { evaluatePrereqs, offerHasPrereqs, type OfferDepResolver } from '../../src/services/offer-prereqs.js';
import { globToRegExp, type SignalEvalCtx, type MemoryValue } from '../../src/services/workflow/signal-eval.js';
import type { Offer } from '../../src/models/offer-schemas.js';

/** Eval context backed by an in-memory key→value map (mirrors the signal-eval test helper). */
function ctxFrom(store: Record<string, unknown>): SignalEvalCtx {
  const recs: MemoryValue[] = Object.entries(store).map(([key, value]) => ({ key, value }));
  return {
    read: async (key) => recs.find(r => r.key === key) ?? null,
    listGlob: async (glob) => { const re = globToRegExp(glob); return recs.filter(r => re.test(r.key)); },
    vars: {},
    llm: null,
  };
}

const noDeps: OfferDepResolver = async () => null;

/** Minimal Offer cast — these tests only touch required_to_function + dependsOn. */
const offer = (o: Partial<Offer>): Pick<Offer, 'required_to_function' | 'dependsOn'> => o as Offer;

describe('offerHasPrereqs', () => {
  it('false when no input gate and no dependsOn', () => {
    expect(offerHasPrereqs(offer({}))).toBe(false);
    expect(offerHasPrereqs(offer({ required_to_function: 'none' }))).toBe(false);
  });
  it('true with a real input gate or any dependsOn', () => {
    expect(offerHasPrereqs(offer({ required_to_function: { kind: 'deterministic', key: 'a', op: 'exists' } }))).toBe(true);
    expect(offerHasPrereqs(offer({ dependsOn: [{ signal: { kind: 'deterministic', key: 'a', op: 'exists' }, label: 'x' }] }))).toBe(true);
  });
});

describe('evaluatePrereqs', () => {
  it('no prereqs → runnable, not blocked, empty items', async () => {
    const r = await evaluatePrereqs(offer({}), ctxFrom({}), noDeps);
    expect(r).toEqual({ runnable: true, blocked: false, items: [] });
  });

  it('required_to_function is a HARD prereq — unmet blocks', async () => {
    const o = offer({ required_to_function: { kind: 'deterministic', key: 'input.ready', op: 'nonempty' } });
    const blockedR = await evaluatePrereqs(o, ctxFrom({}), noDeps);
    expect(blockedR.blocked).toBe(true);
    expect(blockedR.runnable).toBe(false);
    expect(blockedR.items[0]).toMatchObject({ kind: 'required', hard: true, ok: false });

    const okR = await evaluatePrereqs(o, ctxFrom({ 'input.ready': 'go' }), noDeps);
    expect(okR.blocked).toBe(false);
    expect(okR.runnable).toBe(true);
    expect(okR.items[0].ok).toBe(true);
  });

  it('signal dependency: hard unmet blocks; advisory (hard:false) does not', async () => {
    const hard = offer({ dependsOn: [{ signal: { kind: 'deterministic', key: 'k', op: 'nonempty' }, label: 'data' }] });
    expect((await evaluatePrereqs(hard, ctxFrom({}), noDeps)).blocked).toBe(true);

    const advisory = offer({ dependsOn: [{ signal: { kind: 'deterministic', key: 'k', op: 'nonempty' }, label: 'data', hard: false }] });
    const r = await evaluatePrereqs(advisory, ctxFrom({}), noDeps);
    expect(r.blocked).toBe(false);
    expect(r.runnable).toBe(true);
    expect(r.items[0]).toMatchObject({ kind: 'signal', hard: false, ok: false });
  });

  it('upstream-offer dependency: met when its deliverable key is non-empty', async () => {
    const resolver: OfferDepResolver = async ({ offer: id }) =>
      id === 'fetch-news' ? { deliverableKey: 'news.today' } : null;
    const o = offer({ dependsOn: [{ offer: 'fetch-news', label: 'fresh news' }] });

    const blocked = await evaluatePrereqs(o, ctxFrom({}), resolver);
    expect(blocked.blocked).toBe(true);
    expect(blocked.items[0]).toMatchObject({ kind: 'offer', ref: 'fetch-news', ok: false });

    const ok = await evaluatePrereqs(o, ctxFrom({ 'news.today': 'headlines…' }), resolver);
    expect(ok.runnable).toBe(true);
    expect(ok.items[0].ok).toBe(true);
  });

  it('upstream-offer dependency that cannot be resolved is reported unmet, never a silent pass', async () => {
    const o = offer({ dependsOn: [{ offer: 'ghost', label: 'missing upstream' }] });
    const r = await evaluatePrereqs(o, ctxFrom({}), noDeps);
    expect(r.blocked).toBe(true);
    expect(r.items[0]).toMatchObject({ kind: 'offer', ok: false });
  });

  it('mixes input gate + multiple deps — runnable only when every HARD one is met', async () => {
    const resolver: OfferDepResolver = async () => ({ deliverableKey: 'up.key' });
    const o = offer({
      required_to_function: { kind: 'deterministic', key: 'gate', op: 'exists' },
      dependsOn: [
        { signal: { kind: 'deterministic', key: 'sig', op: 'nonempty' }, label: 'sig' },
        { offer: 'up', label: 'upstream' },
      ],
    });
    const allMet = await evaluatePrereqs(o, ctxFrom({ gate: 1, sig: 'x', 'up.key': 'y' }), resolver);
    expect(allMet.runnable).toBe(true);
    expect(allMet.items).toHaveLength(3);

    const oneMissing = await evaluatePrereqs(o, ctxFrom({ gate: 1, sig: 'x' }), resolver);
    expect(oneMissing.blocked).toBe(true);
  });
});
