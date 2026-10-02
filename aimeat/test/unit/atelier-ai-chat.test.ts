/**
 * @file test/unit/atelier-ai-chat.test.ts
 * @description The Atelier kit's follow-up chat over one document (aiChat), over a stub AIMEAT.ai:
 *   the sample sends nothing, the unavailable and missing-library states say so and draw no box, a
 *   question goes out with the document, the earlier turns and the question, each answer is drawn
 *   as markdown under its own AI label with the model and date, onTurn gets the conversation, a
 *   kept conversation is drawn again with its labels, an empty document holds Ask, a failure puts
 *   the question back in the box, Start over empties it, and every element is a named part.
 * @version-history
 *   v1.0.0 - 2026-10-02 - Initial.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let kit: any;
let calls: Array<{ op: string; args: any }>;
let caps: any;
let answers: string[];
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
  let n = 0;
  return {
    capabilities: async (o: any) => { calls.push({ op: 'capabilities', args: o }); return caps; },
    isAvailable: async () => true,
    complete: async (o: any) => {
      calls.push({ op: 'complete', args: o });
      if (failWith) throw failWith;
      n += 1;
      return { content: answers[n - 1] || 'Answer ' + n, model: 'openai/gpt-4o-mini', provenance: { record: { id: 'prov-' + n } }, truncated: n === 3 };
    },
    disclose: (p: any, o: any) => { calls.push({ op: 'disclose', args: p }); o.target.appendChild(document.createElement('span')); return null; },
    chatNotice: (o: any) => { calls.push({ op: 'chatNotice', args: null }); const d = document.createElement('div'); d.textContent = 'NOTICE'; o.target.appendChild(d); return d; },
    invalidateCache: () => { calls.push({ op: 'invalidate', args: null }); },
  };
}

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {};
  kit = await import('../../src/static/sdk-libs/atelier/ai-chat.js');
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  failWith = null;
  answers = [];
  caps = { capabilities: { text: { on: true } } };
  (window as any).AIMEAT = {
    ai: stubAi(),
    md: { render: (text: string, host: any) => { calls.push({ op: 'md', args: text }); const d = document.createElement('div'); d.textContent = 'MD:' + text; host.appendChild(d); return d; } },
  };
});

async function ready(spec: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const h = kit.aiChat({ target: host, appId: 'my-app', context: 'THE TENDER: bids close on 1 November.', ...spec });
  await settle();
  return { host, h };
}

describe('aiChat', () => {
  it('draws a marked sample exchange for a placeholder app id, and a question sends nothing', async () => {
    let turns = 0;
    const { host, h } = await ready({ appId: '<app-id>', onTurn: () => { turns += 1; } });
    expect(host.textContent).toContain('Sample content');
    expect(host.textContent).toContain('What does the document say about the deadline?');
    type(part(host, 'input')[0], 'Who is the buyer?');
    click(part(host, 'send')[0]);
    await settle();
    expect(calls.filter((c) => c.op !== 'md')).toEqual([]);
    expect(part(host, 'question').map((n: any) => n.textContent)).toEqual(['Who is the buyer?']);
    expect(part(host, 'body')[0].textContent).toContain('A sample answer.');
    expect(turns).toBe(0);
    h.destroy();
  });

  it('shows the library\'s own fix when the text capability is off, and no box', async () => {
    caps = { capabilities: { text: { on: false, fix: 'Add an AI provider on your AI page.' } } };
    const { host, h } = await ready({});
    expect(part(host, 'notice')[0].textContent).toBe('Add an AI provider on your AI page.');
    expect(part(host, 'input')).toEqual([]);
    expect(part(host, 'send')).toEqual([]);
    h.destroy();
  });

  it('names aimeat-ai.js when the library is missing', async () => {
    delete (window as any).AIMEAT.ai;
    const { host, h } = await ready({});
    expect(part(host, 'notice')[0].textContent).toBe('This block needs aimeat-ai.js on the page.');
    expect(part(host, 'input')).toEqual([]);
    h.destroy();
  });

  it('sends the document, the earlier turns and the question, and draws each answer with its label', async () => {
    const got: any[] = [];
    answers = ['It closes on **1 November**.', 'The city of Turku.'];
    const { host, h } = await ready({ onTurn: (hist: any) => got.push(hist) });
    expect(calls.filter((c) => c.op === 'chatNotice').length).toBe(1);
    expect(part(host, 'chatNotice')[0].textContent).toBe('NOTICE');
    expect(part(host, 'empty')[0].textContent).toBe('No questions yet. The AI answers from the document and from this conversation.');
    expect(part(host, 'log')[0].attrs.role).toBe('log');
    const box = part(host, 'input')[0];
    type(box, 'When do bids close?');
    click(part(host, 'send')[0]);
    expect(part(host, 'status')[0].textContent).toBe('The AI is working on the answer…');
    expect(part(host, 'send')[0].disabled).toBe(true);
    await settle();
    const first = calls.find((c) => c.op === 'complete')?.args;
    expect(first.app_id).toBe('my-app');
    expect(first.prompt).toBe('THE DOCUMENT\nTHE TENDER: bids close on 1 November.\n\nTHE QUESTION\nWhen do bids close?');
    expect(first.systemPrompt).toMatch(/^You answer follow-up questions about one document\./);
    expect(box.value).toBe('');
    expect(part(host, 'empty')).toEqual([]);
    expect(part(host, 'body')[0].textContent).toBe('MD:It closes on **1 November**.');
    expect(calls.find((c) => c.op === 'disclose')?.args).toEqual({ record: { id: 'prov-1' } });
    expect(part(host, 'model')[0].textContent).toBe('Model: openai/gpt-4o-mini');
    expect(part(host, 'made')[0].textContent.startsWith('Made ')).toBe(true);
    expect(got.length).toBe(1);
    expect(got[0].map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(got[0][1]).toMatchObject({ content: 'It closes on **1 November**.', model: 'openai/gpt-4o-mini', provenance: { record: { id: 'prov-1' } } });
    expect(typeof got[0][1].at).toBe('string');
    const turn = await h.ask('Who is the buyer?');
    expect(turn.content).toBe('The city of Turku.');
    const second = calls.filter((c) => c.op === 'complete')[1].args;
    expect(second.prompt).toContain('THE CONVERSATION SO FAR\nQuestion: When do bids close?\n\nAnswer: It closes on **1 November**.');
    expect(second.prompt.endsWith('THE QUESTION\nWho is the buyer?')).toBe(true);
    expect(part(host, 'turn').map((n: any) => n.attrs['data-ak-role'])).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(got[1].length).toBe(4);
    const third = await h.ask('Anything else?');
    expect(third.truncated).toBe(true);
    expect(part(host, 'truncated')[0].textContent).toBe('The answer stopped at the length limit, so it can be unfinished.');
    h.destroy();
  });

  it('sends only the last `keep` messages, and the app\'s own system prompt in place of the block\'s', async () => {
    const history = [
      { role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' }, { role: 'assistant', content: 'A2' },
    ];
    const { h } = await ready({ history, keep: 2, systemPrompt: 'Answer as a lawyer.' });
    await h.ask('Q3');
    const sent = calls.find((c) => c.op === 'complete')?.args;
    expect(sent.systemPrompt).toBe('Answer as a lawyer.');
    expect(sent.prompt).not.toContain('Q1');
    expect(sent.prompt).toContain('Question: Q2\n\nAnswer: A2');
    h.destroy();
  });

  it('draws a kept conversation again with each answer\'s own label, and set({ history }) replaces it', async () => {
    const history = [
      { role: 'user', content: 'Who is the buyer?' },
      { role: 'assistant', content: 'Turku.', model: 'm-1', provenance: { record: { id: 'kept-1' } }, at: '2026-09-20T10:30:00.000Z' },
      { role: 'system', content: 'not a turn' },
    ];
    const { host, h } = await ready({ history });
    expect(part(host, 'turn').length).toBe(2);
    // Drawn while the route is checked and again when it is known: every label is the kept record.
    const labels = calls.filter((c) => c.op === 'disclose').map((c) => c.args);
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels.map((a) => JSON.stringify(a)))).toEqual(new Set([JSON.stringify({ record: { id: 'kept-1' } })]));
    expect(part(host, 'aiLabel').length).toBe(1);
    expect(part(host, 'made')[0].attrs.datetime).toBe('2026-09-20T10:30:00.000Z');
    expect(calls.some((c) => c.op === 'complete')).toBe(false);
    h.set({ history: [] });
    expect(part(host, 'turn')).toEqual([]);
    expect(part(host, 'empty').length).toBe(1);
    h.destroy();
  });

  it('holds Ask while there is no document, reads a function context at the moment of asking', async () => {
    let doc = '';
    const { host, h } = await ready({ context: () => doc });
    expect(part(host, 'send')[0].disabled).toBe(true);
    expect(part(host, 'reason')[0].textContent).toBe('There is no document to ask about yet.');
    expect(await h.ask('Anything?')).toBeNull();
    expect(calls.some((c) => c.op === 'complete')).toBe(false);
    doc = 'A new document.';
    h.set({ title: 'Ask the tender' });
    expect(part(host, 'send')[0].disabled).toBe(false);
    await h.ask('Now?');
    expect(calls.find((c) => c.op === 'complete')?.args.prompt).toContain('THE DOCUMENT\nA new document.');
    h.destroy();
  });

  it('says a press on an empty box, and sends on Enter', async () => {
    const { host, h } = await ready({});
    click(part(host, 'send')[0]);
    expect(part(host, 'reason')[0].textContent).toBe('Write a question first.');
    expect(part(host, 'reason')[0].hidden).toBe(false);
    const box = part(host, 'input')[0];
    type(box, 'When?');
    expect(part(host, 'reason')[0].hidden).toBe(true);
    box.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true });
    await settle();
    expect(calls.find((c) => c.op === 'complete')?.args.prompt.endsWith('THE QUESTION\nWhen?')).toBe(true);
    h.destroy();
  });

  it('says a failure in words and puts the question back in the box; a cancelled spend says nothing', async () => {
    let turns = 0;
    const { host, h } = await ready({ onTurn: () => { turns += 1; } });
    failWith = Object.assign(new Error('x'), { code: 'QUOTA_EXHAUSTED' });
    expect(await h.ask('When do bids close?')).toBeNull();
    const failure = part(host, 'failure')[0];
    expect(failure.attrs.role).toBe('alert');
    expect(failure.textContent).toBe('You used all of today\'s AI budget. It starts again tomorrow, or you can make it larger on the AI page.');
    expect(part(host, 'input')[0].value).toBe('When do bids close?');
    expect(part(host, 'turn')).toEqual([]);
    expect(turns).toBe(0);
    failWith = Object.assign(new Error('declined'), { code: 'SPEND_CANCELLED' });
    await h.ask('When do bids close?');
    expect(part(host, 'failure')[0].hidden).toBe(true);
    h.destroy();
  });

  it('empties the conversation on Start over and tells the app', async () => {
    const got: any[] = [];
    const { host, h } = await ready({ onTurn: (hist: any) => got.push(hist) });
    expect(part(host, 'clear')[0].hidden).toBe(true);
    await h.ask('When?');
    expect(part(host, 'clear')[0].hidden).toBe(false);
    click(part(host, 'clear')[0]);
    expect(got[got.length - 1]).toEqual([]);
    expect(part(host, 'turn')).toEqual([]);
    expect(part(host, 'clear')[0].hidden).toBe(true);
    h.destroy();
  });

  it('offers sign-in when nobody is signed in', async () => {
    (window as any).AIMEAT.auth = { getSession: () => null, signIn: async () => null, on: () => {}, off: () => {} };
    const { host, h } = await ready({});
    expect(part(host, 'notice')[0].textContent).toBe('Sign in to ask your AI.');
    expect(part(host, 'signIn').length).toBe(1);
    expect(part(host, 'input')).toEqual([]);
    h.destroy();
  });

  it('names every element it builds as a part', async () => {
    const { host, h } = await ready({ history: [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A', model: 'm', at: '2026-09-20T10:30:00.000Z', provenance: { record: {} } }] });
    const root = part(host, 'root')[0];
    // What AIMEAT.md, disclose() and chatNotice() draw inside a part is the library's, not the kit's.
    const foreign = new Set(['body', 'aiLabel', 'chatNotice']);
    const unnamed: string[] = [];
    const walk = (n: any) => {
      if (n.nodeType !== 1) return;
      if (!n.attrs['data-ak-part']) unnamed.push(n.tagName + '.' + (n.attrs.class || ''));
      if (foreign.has(n.attrs['data-ak-part'])) return;
      for (const c of n.children || []) walk(c);
    };
    walk(root);
    expect(unnamed).toEqual([]);
    h.destroy();
  });
});
