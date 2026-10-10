/**
 * @file test/unit/atelier-ai-task.test.ts
 * @description The Atelier kit's one-shot AI block (aiTask) over a stub AIMEAT.ai, and the form's
 *   `model` field: the sample sends nothing, an unavailable AI shows the library's fix, a run sends
 *   the built prompt and draws the answer with its label, model and cost, a schema goes through
 *   completeJson, each error code has its words, a cut answer says so, the page without the library
 *   offers the copy route, a stored result is drawn again without a call, and the model field is a
 *   select with the library and a text field without it.
 * @version-history
 *   v1.2.1 - 2026-10-10 - The cost line is compared with the SDK formatter's own output, so the
 *     test passes on a machine whose locale is not English.
 *   v1.2.0 - 2026-10-02 - A stored result: show() and `result` draw it with its label, model and
 *     date and no call; a fresh result carries `at`; render() gets both.
 *   v1.1.0 - 2026-10-01 - The cost line in Finnish: the SDK money formatter and the budget's currency.
 *   v1.0.0 - 2026-10-01 - Initial.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let kit: any;
let formKit: any;
let words: any;
let calls: Array<{ op: string; args: any }>;
let caps: any;
let answer: any;
let failWith: any;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }
function type(box: any, text: string) { box.value = text; box.dispatchEvent({ type: 'input', bubbles: true }); }
const click = (n: any) => n.dispatchEvent({ type: 'click', bubbles: true });

function stubAi() {
  return {
    capabilities: async (o: any) => { calls.push({ op: 'capabilities', args: o }); if (caps instanceof Error) throw caps; return caps; },
    isAvailable: async () => { calls.push({ op: 'isAvailable', args: null }); return false; },
    complete: async (o: any) => { calls.push({ op: 'complete', args: o }); if (failWith) throw failWith; return answer; },
    completeJson: async (o: any) => { calls.push({ op: 'completeJson', args: o }); if (failWith) throw failWith; return { ...answer, parsed: { verdict: 'go' } }; },
    disclose: (p: any, o: any) => { calls.push({ op: 'disclose', args: p }); o.target.appendChild(document.createElement('span')); return null; },
    invalidateCache: () => { calls.push({ op: 'invalidate', args: null }); },
    models: async (o: any) => { calls.push({ op: 'models', args: o }); return [
      { ref: 'openrouter:openai/gpt-4o-mini', id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
      { ref: 'anthropic:claude-haiku', id: 'claude-haiku', name: 'Claude Haiku' },
    ]; },
  };
}

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {};
  kit = await import('../../src/static/sdk-libs/atelier/ai-task.js');
  formKit = await import('../../src/static/sdk-libs/atelier/form.js');
  words = await import('../../src/static/sdk-libs/atelier/ai-task-i18n.js');
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  failWith = null;
  caps = { capabilities: { text: { on: true, model: 'openrouter:openai/gpt-4o-mini' } } };
  answer = {
    content: '# Reading\nThe answer.', model: 'openai/gpt-4o-mini', truncated: false,
    budget: { spent_today_usd: 0.04, daily_budget_usd: 1 }, provenance: { record: { id: 'prov-1' } },
  };
  (window as any).AIMEAT = {
    ai: stubAi(),
    md: { render: (text: string, host: any) => { calls.push({ op: 'md', args: text }); const d = document.createElement('div'); d.textContent = 'MD:' + text; host.appendChild(d); return d; } },
  };
});

async function ready(spec: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const h = kit.aiTask({ target: host, appId: 'my-app', prompt: (t: string) => 'P:' + t, ...spec });
  await settle();
  return { host, h };
}

describe('aiTask', () => {
  it('draws a marked sample for a placeholder app id, and a run sends nothing', async () => {
    const { host, h } = await ready({ appId: '<app-id>' });
    expect(host.textContent).toContain('Sample content');
    expect(host.textContent).toContain('A sample answer.');
    type(part(host, 'input')[0], 'some text to read');
    click(part(host, 'run')[0]);
    await settle();
    expect(calls.filter((c) => c.op !== 'md')).toEqual([]);
    h.destroy();
  });

  it('shows the library\'s own fix when the text capability is off, and no run button', async () => {
    caps = { capabilities: { text: { on: false, reason: 'no_provider', fix: 'Add an AI provider on your AI page.' } } };
    const { host, h } = await ready({});
    expect(part(host, 'notice')[0].textContent).toBe('Add an AI provider on your AI page.');
    expect(part(host, 'run')).toEqual([]);
    h.destroy();
  });

  it('falls back to isAvailable() when capabilities cannot be read', async () => {
    caps = new Error('404');
    const { host, h } = await ready({});
    expect(calls.some((c) => c.op === 'isAvailable')).toBe(true);
    expect(part(host, 'notice')[0].textContent).toBe('Your AI is not ready for this app.');
    h.destroy();
  });

  it('keeps run off under minChars with the reason, then sends the built prompt and draws the answer', async () => {
    let got: any = null;
    const { host, h } = await ready({ input: { minChars: 5, placeholder: 'Describe it' }, systemPrompt: 'Be brief.', onResult: (r: any) => { got = r; } });
    const box = part(host, 'input')[0];
    const run = part(host, 'run')[0];
    expect(run.disabled).toBe(true);
    expect(part(host, 'reason')[0].textContent).toBe('Write something first.');
    type(box, 'abc');
    expect(run.disabled).toBe(true);
    expect(part(host, 'reason')[0].textContent).toBe('Write at least 5 characters. You have 3 now.');
    expect(box.attrs['aria-describedby']).toBe(part(host, 'reason')[0].attrs.id);
    type(box, 'abcdefgh');
    expect(run.disabled).toBe(false);
    click(run);
    expect(part(host, 'status')[0].textContent).toBe('The AI is working on the answer…');
    expect(part(host, 'status')[0].attrs.role).toBe('status');
    await settle();
    const sent = calls.find((c) => c.op === 'complete')?.args;
    expect(sent).toMatchObject({ app_id: 'my-app', prompt: 'P:abcdefgh', systemPrompt: 'Be brief.' });
    expect(calls.some((c) => c.op === 'completeJson')).toBe(false);
    expect(part(host, 'body')[0].textContent).toBe('MD:# Reading\nThe answer.');
    expect(calls.find((c) => c.op === 'disclose')?.args).toEqual({ record: { id: 'prov-1' } });
    expect(part(host, 'model')[0].textContent).toBe('Model: openai/gpt-4o-mini');
    // The amounts are in the reader's own number format, so the expected text uses the same formatter
    // rather than an English literal that fails on a machine whose locale is not English.
    expect(part(host, 'cost')[0].textContent).toBe(`AI use today: ${kit.money(0.04)} of ${kit.money(1)}`);
    expect(part(host, 'truncated')).toEqual([]);
    expect(got.provenance).toEqual({ record: { id: 'prov-1' } });
    h.destroy();
  });

  it('runs with no box when input is null, and run(text) puts the text in the box first', async () => {
    const a = await ready({ input: null });
    expect(part(a.host, 'input')).toEqual([]);
    const r = await a.h.run();
    expect(r.content).toBe('# Reading\nThe answer.');
    expect(calls.find((c) => c.op === 'complete')?.args.prompt).toBe('P:');
    a.h.destroy();
    calls = [];
    const b = await ready({ render: 'text' });
    await b.h.run('from code');
    expect(part(b.host, 'input')[0].value).toBe('from code');
    expect(calls.find((c) => c.op === 'complete')?.args.prompt).toBe('P:from code');
    expect(calls.some((c) => c.op === 'md')).toBe(false);
    expect(part(b.host, 'body')[0].textContent).toBe('# Reading\nThe answer.');
    b.h.destroy();
  });

  it('asks through completeJson when a schema is given', async () => {
    let got: any = null;
    const schema = { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'] };
    const { host, h } = await ready({ schema, onResult: (r: any) => { got = r; } });
    await h.run('a long enough text');
    expect(calls.some((c) => c.op === 'complete')).toBe(false);
    expect(calls.find((c) => c.op === 'completeJson')?.args.schema).toBe(schema);
    expect(got.parsed).toEqual({ verdict: 'go' });
    expect(part(host, 'body')[0].textContent).toContain('"verdict": "go"');
    h.destroy();
  });

  it('says each error code in words, and nothing for a cancelled spend', async () => {
    const expected: Record<string, string> = {
      NO_API_KEY: 'No AI is set up for your account yet. Add one on the AI page of your AIMEAT profile.',
      QUOTA_EXHAUSTED: 'You used all of today\'s AI budget. It starts again tomorrow, or you can make it larger on the AI page.',
      APP_QUOTA_EXHAUSTED: 'This app used all of its AI share for today. It starts again tomorrow, or you can make it larger on the AI page.',
      RATE_LIMITED: 'Your AI provider is busy now. Wait a moment and try again.',
      JSON_SCHEMA_MISMATCH: 'The AI answered, but not in the form this app needs. Try again.',
      PROVIDER_ERROR: 'The AI request did not go through: upstream 502',
    };
    const { host, h } = await ready({});
    for (const code of Object.keys(expected)) {
      failWith = Object.assign(new Error(code === 'PROVIDER_ERROR' ? 'upstream 502' : 'x'), { code });
      const r = await h.run('a long enough text');
      expect(r).toBeNull();
      const failure = part(host, 'failure')[0];
      expect(failure.attrs.role).toBe('alert');
      expect(failure.hidden).toBe(false);
      expect(failure.textContent).toBe(expected[code]);
    }
    failWith = Object.assign(new Error('declined'), { code: 'SPEND_CANCELLED' });
    await h.run('a long enough text');
    expect(part(host, 'failure')[0].hidden).toBe(true);
    expect(part(host, 'failure')[0].textContent).toBe('');
    h.destroy();
  });

  it('notes an answer that was cut at the length limit', async () => {
    answer = { ...answer, truncated: true };
    const { host, h } = await ready({});
    await h.run('a long enough text');
    expect(part(host, 'truncated')[0].textContent).toBe('The answer stopped at the length limit, so it can be unfinished.');
    h.destroy();
  });

  it('writes the cost line in Finnish with the reader\'s own money format and the budget\'s currency', async () => {
    const { i18n } = await import('../../src/static/sdk-libs/atelier/i18n.js');
    // AIMEAT.fmt is how the aimeat-i18n pack hands the SDK formatter a person's own region.
    // A stand-in for a Finnish reader's formatter: the amount first, the symbol after it.
    const fi = (n: number, c: string) => n.toFixed(2).replace('.', ',') + ' ' + (c === 'USD' ? '$' : c === 'EUR' ? '€' : c);
    (window as any).AIMEAT.fmt = { money: fi };
    i18n.setLang('fi');
    try {
      const { host, h } = await ready({});
      await h.run('a long enough text');
      expect(part(host, 'cost')[0].textContent).toBe('Tekoälyn käyttö tänään: ' + fi(0.04, 'USD') + ', päiväraja ' + fi(1, 'USD'));
      expect(part(host, 'cost')[0].textContent).not.toContain('$0.04');
      h.destroy();
      answer = { ...answer, budget: { spent_today_usd: 0.5, daily_budget_usd: 0, currency: 'EUR' } };
      const b = await ready({});
      await b.h.run('a long enough text');
      expect(part(b.host, 'cost')[0].textContent).toBe('Tekoälyn käyttö tänään: ' + fi(0.5, 'EUR'));
      b.h.destroy();
    } finally {
      i18n.setLang('en');
    }
  });

  it('offers only the copy route, in words, when the library is not on the page', async () => {
    delete (window as any).AIMEAT.ai;
    let got: any = null;
    const { host, h } = await ready({ copyPrompt: true, onResult: (r: any) => { got = r; } });
    expect(part(host, 'notice')[0].textContent).toBe('AI is not connected on this page. Copy the prompt to your own AI chat, and paste the answer back here.');
    expect(part(host, 'run')).toEqual([]);
    const copy = part(host, 'copy')[0];
    expect(copy.disabled).toBe(true);
    type(part(host, 'input')[0], 'my situation');
    expect(copy.disabled).toBe(false);
    expect(part(host, 'preview')[0].textContent).toContain('P:my situation');
    part(host, 'answer')[0].value = 'Pasted reply';
    click(part(host, 'apply')[0]);
    await settle();
    expect(got).toMatchObject({ content: 'Pasted reply', pasted: true, provenance: null });
    expect(part(host, 'result')[0].hidden).toBe(false);
    expect(host.textContent).toContain('Pasted from your own AI chat.');
    h.destroy();
  });

  it('names aimeat-ai.js in one sentence when the library is missing and there is no copy route', async () => {
    delete (window as any).AIMEAT.ai;
    const { host, h } = await ready({});
    expect(part(host, 'notice')[0].textContent).toBe('This block needs aimeat-ai.js on the page.');
    expect(part(host, 'input')).toEqual([]);
    h.destroy();
  });

  it('offers sign-in when nobody is signed in, and reads the route again after a sign-in', async () => {
    const handlers: Record<string, Array<() => void>> = {};
    let session: any = null;
    let asked = 0;
    (window as any).AIMEAT.auth = {
      getSession: () => session,
      signIn: async () => { asked += 1; return null; },
      on: (ev: string, fn: () => void) => { (handlers[ev] ||= []).push(fn); },
      off: (ev: string, fn: () => void) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    };
    const { host, h } = await ready({});
    expect(part(host, 'notice')[0].textContent).toBe('Sign in to ask your AI.');
    click(part(host, 'signIn')[0]);
    expect(asked).toBe(1);
    session = { token: 't' };
    for (const fn of handlers.login || []) fn();
    await settle();
    expect(calls.some((c) => c.op === 'invalidate')).toBe(true);
    expect(part(host, 'run').length).toBe(1);
    h.destroy();
    expect((handlers.login || []).length).toBe(0);
  });

  it('draws a stored result with its own label, model and date, calls no AI, and leaves the old cost out', async () => {
    const { host, h } = await ready({});
    calls = [];
    const stored = {
      content: 'Kept answer.', model: 'anthropic/claude-haiku', at: '2026-09-20T10:30:00.000Z',
      budget: { spent_today_usd: 0.3, daily_budget_usd: 1 }, provenance: { record: { id: 'prov-old' } },
    };
    h.show(stored);
    expect(calls.filter((c) => c.op === 'complete' || c.op === 'completeJson')).toEqual([]);
    expect(calls.find((c) => c.op === 'disclose')?.args).toEqual({ record: { id: 'prov-old' } });
    expect(part(host, 'body')[0].textContent).toBe('MD:Kept answer.');
    expect(part(host, 'model')[0].textContent).toBe('Model: anthropic/claude-haiku');
    const made = part(host, 'made')[0];
    expect(made.tagName).toBe('TIME');
    expect(made.attrs.datetime).toBe('2026-09-20T10:30:00.000Z');
    expect(made.textContent.startsWith('Made ')).toBe(true);
    expect(made.textContent).toMatch(/2026/);
    expect(part(host, 'cost')).toEqual([]);
    expect(part(host, 'result')[0].hidden).toBe(false);
    h.show(null);
    expect(part(host, 'result')[0].hidden).toBe(true);
    h.destroy();
  });

  it('stamps a fresh result with the time it was made, and draws the same result again from the spec', async () => {
    let got: any = null;
    const a = await ready({ onResult: (r: any) => { got = r; } });
    const before = Date.now();
    await a.h.run('a long enough text');
    expect(typeof got.at).toBe('string');
    expect(Date.parse(got.at)).toBeGreaterThanOrEqual(before - 1000);
    expect(part(a.host, 'made').length).toBe(1);
    expect(part(a.host, 'cost').length).toBe(1);
    a.h.destroy();
    calls = [];
    const b = await ready({ result: got });
    expect(calls.filter((c) => c.op === 'complete')).toEqual([]);
    expect(part(b.host, 'body')[0].textContent).toBe('MD:# Reading\nThe answer.');
    expect(part(b.host, 'made')[0].attrs.datetime).toBe(got.at);
    expect(part(b.host, 'cost')).toEqual([]);
    b.h.destroy();
  });

  it('hands a structured answer to render() fresh and stored alike, and keeps a stored one in a sample', async () => {
    const schema = { type: 'object', properties: { verdict: { type: 'string' } } };
    const seen: any[] = [];
    const render = (r: any, host: any) => {
      seen.push(r);
      const card = document.createElement('div');
      card.textContent = 'CARD:' + r.parsed.verdict;
      host.appendChild(card);
    };
    let kept: any = null;
    const a = await ready({ schema, render, onResult: (r: any) => { kept = r; } });
    await a.h.run('a long enough text');
    expect(seen[0].parsed).toEqual({ verdict: 'go' });
    expect(part(a.host, 'body')[0].textContent).toBe('CARD:go');
    a.h.show({ ...kept, parsed: { verdict: 'no_go' } });
    expect(seen[1].parsed).toEqual({ verdict: 'no_go' });
    expect(part(a.host, 'body')[0].textContent).toBe('CARD:no_go');
    a.h.destroy();
    calls = [];
    const b = await ready({ appId: '<app-id>', schema, render, result: kept });
    expect(b.host.textContent).toContain('CARD:go');
    expect(b.host.textContent).not.toContain('A sample answer.');
    // The block draws while it checks the route and again when it knows it; each draw labels it.
    const labels = calls.filter((c) => c.op === 'disclose');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((c) => c.args === kept.provenance)).toBe(true);
    b.h.set({ result: null });
    expect(b.host.textContent).toContain('A sample answer.');
    b.h.destroy();
  });

  it('carries the same keys in English, Finnish and Spanish', () => {
    const en = words.aiTaskKeys('en').sort();
    expect(words.aiTaskKeys('fi').sort()).toEqual(en);
    expect(words.aiTaskKeys('es').sort()).toEqual(en);
  });
});

describe('form, the model field', () => {
  it('is a select of the capability\'s models with the library, keeping a value the list does not have', async () => {
    const host = document.createElement('div');
    const f = formKit.form({ target: host, submit: false, fields: [
      { name: 'text', label: 'Text model', type: 'model', value: 'openai/gpt-4o-mini' },
      { name: 'vision', label: 'Vision model', type: 'model', capability: 'vision', value: 'old/model' },
    ] });
    const selects = all(host).filter((n) => n.tagName === 'SELECT');
    expect(selects.length).toBe(2);
    expect(selects[0].value).toBe('openai/gpt-4o-mini');
    await settle();
    expect(calls.filter((c) => c.op === 'models').map((c) => c.args.capability)).toEqual(['text', 'vision']);
    const opts = (s: any) => s.options.map((o: any) => [o.value, o.textContent]);
    expect(opts(selects[0])).toEqual([['', 'The default model'], ['openai/gpt-4o-mini', 'GPT-4o mini'], ['anthropic:claude-haiku', 'Claude Haiku']]);
    expect(opts(selects[1])).toContainEqual(['old/model', 'old/model (not in your list)']);
    expect(f.values()).toEqual({ text: 'openai/gpt-4o-mini', vision: 'old/model' });
    f.setValues({ text: 'mistral:large' });
    expect(selects[0].options.some((o: any) => o.value === 'mistral:large')).toBe(true);
    expect(f.values().text).toBe('mistral:large');
  });

  it('is a text field without the library', () => {
    delete (window as any).AIMEAT.ai;
    const host = document.createElement('div');
    const f = formKit.form({ target: host, submit: false, fields: [{ name: 'm', label: 'Model', type: 'model', value: 'openai/gpt-4o' }] });
    const input = part(host, 'input')[0];
    expect(input.tagName).toBe('INPUT');
    expect(input.attrs['data-ak-model']).toBe('text');
    expect(f.values()).toEqual({ m: 'openai/gpt-4o' });
  });
});
