import { describe, it, expect } from 'vitest';
import { evaluateSignal, extractProgress, globToRegExp, SignalTemplateError, type SignalEvalCtx, type MemoryValue } from '../../src/services/workflow/signal-eval.js';
import type { Signal } from '../../src/models/workflow-schemas.js';

/** Build an eval context backed by an in-memory key→value map. */
function ctxFrom(
  store: Record<string, unknown>,
  opts: Partial<SignalEvalCtx> = {},
): SignalEvalCtx {
  const recs: MemoryValue[] = Object.entries(store).map(([key, value]) => ({ key, value }));
  return {
    read: async (key) => recs.find(r => r.key === key) ?? null,
    listGlob: async (glob) => {
      const re = globToRegExp(glob);
      return recs.filter(r => re.test(r.key));
    },
    vars: opts.vars ?? {},
    llm: opts.llm ?? null,
    validateJsonSchema: opts.validateJsonSchema,
  };
}

describe('deterministic leaves', () => {
  it('exists: true when the key is present', async () => {
    const r = await evaluateSignal({ kind: 'deterministic', key: 'a', op: 'exists' }, ctxFrom({ a: 1 }));
    expect(r.ok).toBe(true);
  });

  it('exists: false when the key is absent', async () => {
    const r = await evaluateSignal({ kind: 'deterministic', key: 'missing', op: 'exists' }, ctxFrom({ a: 1 }));
    expect(r.ok).toBe(false);
  });

  it('nonempty: empty string / array / object fail, real content passes', async () => {
    const store = { s: '   ', arr: [], obj: {}, real: 'hello' };
    expect((await evaluateSignal({ kind: 'deterministic', key: 's', op: 'nonempty' }, ctxFrom(store))).ok).toBe(false);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'arr', op: 'nonempty' }, ctxFrom(store))).ok).toBe(false);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'obj', op: 'nonempty' }, ctxFrom(store))).ok).toBe(false);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'real', op: 'nonempty' }, ctxFrom(store))).ok).toBe(true);
  });

  it('count_nonempty: counts non-empty matches over a glob', async () => {
    const store = { 'news.a': 'x', 'news.b': '', 'news.c': 'y', other: 'z' };
    const sig: Signal = { kind: 'deterministic', key_glob: 'news.*', op: 'count_nonempty', min: 2 };
    expect((await evaluateSignal(sig, ctxFrom(store))).ok).toBe(true);
    const sig3: Signal = { kind: 'deterministic', key_glob: 'news.*', op: 'count_nonempty', min: 3 };
    expect((await evaluateSignal(sig3, ctxFrom(store))).ok).toBe(false);
  });

  // The path form (2026-08-09). Without it a step that means "at least 12 articles" can only be
  // written as "at least 12 KEYS matching article.*", which is what pinned Sanomat at 44 keys per
  // edition: consolidating them would have broken the step that verifies the consolidation.
  it('count_nonempty + path: counts the non-empty VALUES of an object inside one record', async () => {
    const store = {
      'news.2026-08-09.evening': {
        status: { fetch: 'done' },
        articles: { talous: { body: 'a' }, tiede: { body: 'b' }, urheilu: { body: 'c' } },
      },
    };
    const two: Signal = { kind: 'deterministic', key: 'news.2026-08-09.evening', op: 'count_nonempty', min: 2, path: 'articles' };
    expect((await evaluateSignal(two, ctxFrom(store))).ok).toBe(true);
    const four: Signal = { kind: 'deterministic', key: 'news.2026-08-09.evening', op: 'count_nonempty', min: 4, path: 'articles' };
    expect((await evaluateSignal(four, ctxFrom(store))).ok).toBe(false);
  });

  it('count_nonempty + path: an empty entry does not count towards the minimum', async () => {
    const store = { rec: { articles: { a: { body: 'x' }, b: {}, c: '' } } };
    const sig: Signal = { kind: 'deterministic', key: 'rec', op: 'count_nonempty', min: 2, path: 'articles' };
    expect((await evaluateSignal(sig, ctxFrom(store))).ok).toBe(false);
  });

  it('count_nonempty + path: counts array elements too', async () => {
    const store = { rec: { items: ['a', '', 'c'] } };
    const sig: Signal = { kind: 'deterministic', key: 'rec', op: 'count_nonempty', min: 2, path: 'items' };
    expect((await evaluateSignal(sig, ctxFrom(store))).ok).toBe(true);
  });

  it('count_nonempty + path: a missing record fails rather than counting as zero-and-passing', async () => {
    const sig: Signal = { kind: 'deterministic', key: 'gone', op: 'count_nonempty', min: 0, path: 'articles' };
    const r = await evaluateSignal(sig, ctxFrom({}));
    expect(r.ok).toBe(false);
    expect((r.observed as { error?: string }).error).toBe('missing');
  });

  it('count_nonempty + path: a non-collection at the path counts as nothing, not as a pass', async () => {
    const store = { rec: { articles: 'not a collection' } };
    const sig: Signal = { kind: 'deterministic', key: 'rec', op: 'count_nonempty', min: 1, path: 'articles' };
    expect((await evaluateSignal(sig, ctxFrom(store))).ok).toBe(false);
  });

  it('count_nonempty + path: still feeds the watchdog progress sum', async () => {
    // Same op on purpose: a consolidated pipeline must keep the slow-vs-stuck signal it had while
    // it was sharded, or the watchdog starts calling every long step "stuck".
    const store = { rec: { articles: { a: 1, b: 2 } } };
    const { observed } = await evaluateSignal(
      { kind: 'deterministic', key: 'rec', op: 'count_nonempty', min: 5, path: 'articles' }, ctxFrom(store));
    expect(extractProgress(observed)).toEqual({ count: 2, min: 5 });
  });

  it('count_nonempty + path: templates {var} in the key like every other leaf', async () => {
    const store = { 'news.2026-08-09.evening': { articles: { a: 1, b: 2 } } };
    const sig: Signal = { kind: 'deterministic', key: 'news.{date}.{edition}', op: 'count_nonempty', min: 2, path: 'articles' };
    const r = await evaluateSignal(sig, ctxFrom(store, { vars: { date: '2026-08-09', edition: 'evening' } }));
    expect(r.ok).toBe(true);
  });

  it('json_valid: object passes, malformed string fails', async () => {
    const store = { obj: { a: 1 }, str: '{"a":1}', bad: 'not json' };
    expect((await evaluateSignal({ kind: 'deterministic', key: 'obj', op: 'json_valid' }, ctxFrom(store))).ok).toBe(true);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'str', op: 'json_valid' }, ctxFrom(store))).ok).toBe(true);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'bad', op: 'json_valid' }, ctxFrom(store))).ok).toBe(false);
  });

  it('json_field: nonempty / min / equals over a dot-path', async () => {
    const store = { doc: { title: 'Hi', items: [1, 2, 3], status: 'ready' } };
    const ctx = ctxFrom(store);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'doc', op: 'json_field', path: 'title', nonempty: true }, ctx)).ok).toBe(true);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'doc', op: 'json_field', path: 'items', min: 3 }, ctx)).ok).toBe(true);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'doc', op: 'json_field', path: 'items', min: 4 }, ctx)).ok).toBe(false);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'doc', op: 'json_field', path: 'status', equals: 'ready' }, ctx)).ok).toBe(true);
    expect((await evaluateSignal({ kind: 'deterministic', key: 'doc', op: 'json_field', path: 'missing', nonempty: true }, ctx)).ok).toBe(false);
  });

  it('json_schema: delegates to the injected validator; degrades to json_valid when absent', async () => {
    const store = { doc: { a: 1 } };
    const withValidator = ctxFrom(store, { validateJsonSchema: (v) => ({ ok: typeof (v as { a?: unknown }).a === 'number' }) });
    expect((await evaluateSignal({ kind: 'deterministic', key: 'doc', op: 'json_schema', schema: {} }, withValidator)).ok).toBe(true);
    // No validator → degrades to json_valid (object is valid) → passes.
    expect((await evaluateSignal({ kind: 'deterministic', key: 'doc', op: 'json_schema', schema: {} }, ctxFrom(store))).ok).toBe(true);
  });
});

describe('composites', () => {
  it('all: passes only when every child passes', async () => {
    const store = { a: 'x', b: 'y' };
    const ok: Signal = { all: [{ kind: 'deterministic', key: 'a', op: 'nonempty' }, { kind: 'deterministic', key: 'b', op: 'nonempty' }] };
    const bad: Signal = { all: [{ kind: 'deterministic', key: 'a', op: 'nonempty' }, { kind: 'deterministic', key: 'missing', op: 'exists' }] };
    expect((await evaluateSignal(ok, ctxFrom(store))).ok).toBe(true);
    expect((await evaluateSignal(bad, ctxFrom(store))).ok).toBe(false);
  });

  it('any: passes when at least one child passes', async () => {
    const store = { a: 'x' };
    const sig: Signal = { any: [{ kind: 'deterministic', key: 'missing', op: 'exists' }, { kind: 'deterministic', key: 'a', op: 'nonempty' }] };
    expect((await evaluateSignal(sig, ctxFrom(store))).ok).toBe(true);
  });

  it('when: a closed gate makes the conditional not-applicable (passes)', async () => {
    // when fails ⇒ then is never checked ⇒ overall passes.
    const sig: Signal = {
      when: { kind: 'deterministic', key: 'missing', op: 'exists' },
      then: { kind: 'deterministic', key: 'also-missing', op: 'exists' },
    };
    const r = await evaluateSignal(sig, ctxFrom({}));
    expect(r.ok).toBe(true);
    expect((r.observed as { notApplicable?: boolean }).notApplicable).toBe(true);
  });

  it('when: an open gate evaluates then', async () => {
    const store = { gate: 'present' };
    const sig: Signal = {
      when: { kind: 'deterministic', key: 'gate', op: 'exists' },
      then: { kind: 'deterministic', key: 'missing', op: 'exists' },
    };
    expect((await evaluateSignal(sig, ctxFrom(store))).ok).toBe(false);
  });
});

describe('llm leaf', () => {
  it('degrades to pass when llm is disabled (null)', async () => {
    const sig: Signal = { kind: 'llm', key: 'doc', ask: 'is this real content?' };
    const r = await evaluateSignal(sig, ctxFrom({ doc: 'something' }, { llm: null }));
    expect(r.ok).toBe(true);
    expect((r.observed as { disabled?: boolean }).disabled).toBe(true);
  });

  it('uses the injected judge when enabled', async () => {
    const sig: Signal = { kind: 'llm', key: 'doc', ask: 'is this an error page?' };
    const judge = async () => ({ ok: false, reason: 'looks like an error placeholder' });
    const r = await evaluateSignal(sig, ctxFrom({ doc: 'ERROR 500' }, { llm: judge }));
    expect(r.ok).toBe(false);
    expect((r.observed as { reason?: string }).reason).toMatch(/error/);
  });
});

describe('extractProgress (slow-vs-stuck)', () => {
  it('reads count + min from a count_nonempty observed leaf', async () => {
    const store = { 'art.a': 'x', 'art.b': 'y', 'art.c': '' };
    const { observed } = await evaluateSignal({ kind: 'deterministic', key_glob: 'art.*', op: 'count_nonempty', min: 3 }, ctxFrom(store));
    expect(extractProgress(observed)).toEqual({ count: 2, min: 3 });
  });

  it('sums progress across nested composites (all/any/when)', async () => {
    const store = { 'a.1': 'x', 'a.2': 'y', 'b.1': 'z', gate: 'open' };
    const sig: Signal = {
      all: [
        { kind: 'deterministic', key_glob: 'a.*', op: 'count_nonempty', min: 2 },
        { when: { kind: 'deterministic', key: 'gate', op: 'exists' }, then: { kind: 'deterministic', key_glob: 'b.*', op: 'count_nonempty', min: 5 } },
      ],
    };
    const { observed } = await evaluateSignal(sig, ctxFrom(store));
    expect(extractProgress(observed)).toEqual({ count: 3, min: 7 }); // (2 + 1) counts, (2 + 5) mins
  });

  it('returns null for a signal with no countable leaf (binary recovery only, no slide)', async () => {
    const { observed } = await evaluateSignal({ kind: 'deterministic', key: 'a', op: 'exists' }, ctxFrom({ a: 1 }));
    expect(extractProgress(observed)).toBeNull();
  });

  it('reports count 0 (found) when the glob matches nothing — a stuck step, not "no metric"', async () => {
    const { observed } = await evaluateSignal({ kind: 'deterministic', key_glob: 'none.*', op: 'count_nonempty', min: 3 }, ctxFrom({ other: 'x' }));
    expect(extractProgress(observed)).toEqual({ count: 0, min: 3 });
  });
});

describe('{var} templating + namespace safety', () => {
  it('substitutes declared vars into the key', async () => {
    const sig: Signal = { kind: 'deterministic', key: 'news.{date}.edition', op: 'exists' };
    const r = await evaluateSignal(sig, ctxFrom({ 'news.2026-06-11.edition': 'x' }, { vars: { date: '2026-06-11' } }));
    expect(r.ok).toBe(true);
  });

  it('rejects a "::" namespace escape in the template', async () => {
    const sig: Signal = { kind: 'deterministic', key: 'other::owner.key', op: 'exists' };
    await expect(evaluateSignal(sig, ctxFrom({}))).rejects.toBeInstanceOf(SignalTemplateError);
  });

  it('rejects a "::" namespace escape smuggled through a var value', async () => {
    const sig: Signal = { kind: 'deterministic', key: 'news.{date}', op: 'exists' };
    await expect(evaluateSignal(sig, ctxFrom({}, { vars: { date: 'x::evil' } }))).rejects.toBeInstanceOf(SignalTemplateError);
  });

  it('rejects an undeclared var', async () => {
    const sig: Signal = { kind: 'deterministic', key: 'news.{missing}', op: 'exists' };
    await expect(evaluateSignal(sig, ctxFrom({}, { vars: {} }))).rejects.toBeInstanceOf(SignalTemplateError);
  });
});
