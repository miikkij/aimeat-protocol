/**
 * @file test/unit/atelier-workflow-input.test.ts
 * @description The Atelier kit's workflow answer component over a stub AIMEAT.workflows: the
 *   sample that sends nothing, no library on the page, signed out, nothing waiting, one pick sent
 *   as picks, several picks, an own answer, a missing choice refused before anything leaves, the
 *   409 of a step that stopped waiting, any other refusal on its step, a `run` filter, a redraw on
 *   the live 'workflows' domain that keeps what was chosen, and the three languages at key parity.
 * @version-history
 *   v1.0.0 - 2026-10-01 - Initial (the workflowInput block).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let kit: any;
let words: any;
let calls: Array<{ op: string; args: any }>;
let pending: any[];
let answerWith: (args: any) => Promise<any>;
let session: any;
let liveFns: Array<() => void>;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const marks = (root: any) => part(root, 'mark');
const click = (n: any) => n.dispatchEvent({ type: 'click', bubbles: true });
const submit = (step: any) => part(step, 'form')[0].dispatchEvent({ type: 'submit' });
function check(input: any, on = true) { input.checked = on; input.dispatchEvent({ type: 'change' }); }
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }

const SINGLE = {
  workflowId: 'newsletter', runId: 'run-aaaa1111bbbb', stepId: 'review', workflowTitle: { en_US: 'Weekly letter', fi_FI: 'Viikkokirje' },
  mode: 'full-live', askedAt: '2026-10-01T08:00:00Z', deadline: '2099-10-02T08:00:00Z',
  question: { header: 'Review', prompt: 'Can it go out?', allowOther: false, options: [{ id: 'approve', label: 'Send it' }, { id: 'reject', label: 'Do not send' }] },
};
const MULTI = {
  workflowId: 'suppliers', runId: 'run-cccc2222dddd', stepId: 'pick', workflowTitle: 'Supplier check',
  mode: 'full-sandbox', askedAt: '2026-10-01T08:00:00Z', deadline: '2026-10-01T09:00:00Z',
  question: { prompt: 'Which suppliers?', multiSelect: true, options: [{ id: 'mill', label: 'Mill' }, { id: 'bakery', label: 'Bakery' }, { id: 'harbour', label: 'Harbour' }] },
};

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {
    auth: { getSession: () => session, on: () => {}, off: () => {} },
    live: {
      subscribe: (_domains: string[], fn: () => void) => { liveFns.push(fn); return () => { liveFns = liveFns.filter((f) => f !== fn); }; },
    },
    workflows: {
      pendingInputs: async () => { calls.push({ op: 'pendingInputs', args: null }); return { inputs: pending.slice(), count: pending.length }; },
      answer: async (id: string, runId: string, stepId: string, answer: any) => {
        calls.push({ op: 'answer', args: { id, runId, stepId, answer } });
        return answerWith({ id, runId, stepId, answer });
      },
    },
  };
  kit = await import('../../src/static/sdk-libs/atelier/workflow-input.js');
  words = await import('../../src/static/sdk-libs/atelier/workflow-i18n.js');
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  liveFns = [];
  session = { token: 't' };
  pending = [SINGLE, MULTI];
  answerWith = async (a: any) => {
    pending = pending.filter((p) => !(p.runId === a.runId && p.stepId === a.stepId));
    return { answered: a.stepId, runId: a.runId };
  };
});

describe('workflowInput', () => {
  it('draws the sample for a placeholder run, marked as such, and sends nothing', async () => {
    const host = document.createElement('div');
    kit.workflowInput({ target: host, run: '<run id>' });
    await settle();
    expect(host.textContent).toContain('Sample content');
    expect(host.textContent).toContain('Weekly newsletter');
    expect(part(host, 'step').length).toBe(2);
    for (const step of part(host, 'step')) {
      check(marks(step)[0]);
      submit(step);
      click(part(step, 'answer')[0]);
    }
    await settle();
    expect(calls).toEqual([]);
    expect(part(host, 'answer').every((b) => b.disabled)).toBe(true);
  });

  it('says which library is missing when aimeat-workflows.js is not on the page', async () => {
    const saved = (window as any).AIMEAT.workflows;
    delete (window as any).AIMEAT.workflows;
    const host = document.createElement('div');
    kit.workflowInput({ target: host });
    await settle();
    (window as any).AIMEAT.workflows = saved;
    expect(part(host, 'none')[0].textContent).toBe('This block needs aimeat-workflows.js on the page.');
    expect(part(host, 'step').length).toBe(0);
  });

  it('asks a signed-out person to sign in and reads nothing', async () => {
    session = null;
    const host = document.createElement('div');
    kit.workflowInput({ target: host });
    await settle();
    expect(part(host, 'none')[0].textContent).toContain('Sign in');
    expect(calls).toEqual([]);
  });

  it('says nothing is waiting when the list is empty', async () => {
    pending = [];
    const host = document.createElement('div');
    kit.workflowInput({ target: host });
    await settle();
    expect(part(host, 'none')[0].textContent).toBe('Nothing is waiting for your answer.');
    expect(part(host, 'list').length).toBe(0);
  });

  it('draws each step with its workflow, run, question, choices and due time', async () => {
    const host = document.createElement('div');
    kit.workflowInput({ target: host });
    await settle();
    const [one, many] = part(host, 'step');
    expect(part(one, 'workflow')[0].textContent).toBe('Weekly letter');
    expect(part(one, 'run')[0].textContent).toBe('run run-aaaa');
    expect(part(one, 'header')[0].textContent).toBe('Review');
    expect(part(one, 'choices')[0].tagName).toBe('FIELDSET');
    expect(part(one, 'question')[0].tagName).toBe('LEGEND');
    expect(part(one, 'question')[0].textContent).toBe('Can it go out?');
    expect(marks(one).map((m) => m.attrs.type)).toEqual(['radio', 'radio']);
    expect(part(one, 'other').length).toBe(0);
    expect(part(one, 'deadline')[0].textContent).toContain('Answer by');
    expect(marks(many).map((m) => m.attrs.type)).toEqual(['checkbox', 'checkbox', 'checkbox']);
    expect(part(many, 'run')[0].textContent).toContain('test run');
    expect(part(many, 'other').length).toBe(1);
    expect(part(many, 'deadline')[0].textContent).toContain('The time to answer ended');
    expect(part(host, 'notice')[0].attrs.role).toBe('status');
    expect(part(host, 'failure')[0].attrs.role).toBe('alert');
  });

  it('sends a single pick as picks, removes the step with a notice and calls onAnswered', async () => {
    const host = document.createElement('div');
    let seen: any = null;
    kit.workflowInput({ target: host, onAnswered: (input: any, answer: any) => { seen = { input, answer }; } });
    await settle();
    const one = part(host, 'step')[0];
    check(marks(one)[0]);
    check(marks(one)[1]);
    submit(one);
    await settle();
    expect(calls.find((c) => c.op === 'answer')?.args).toEqual({ id: 'newsletter', runId: 'run-aaaa1111bbbb', stepId: 'review', answer: { picks: ['reject'] } });
    expect(seen.input.stepId).toBe('review');
    expect(seen.answer).toEqual({ picks: ['reject'] });
    expect(part(host, 'step').length).toBe(1);
    expect(part(host, 'notice')[0].textContent).toBe('Weekly letter has your answer. The run goes on.');
  });

  it('sends several picks, and the own answer only when it was written', async () => {
    const host = document.createElement('div');
    kit.workflowInput({ target: host });
    await settle();
    let many = part(host, 'step')[1];
    check(marks(many)[0]);
    check(marks(many)[2]);
    submit(many);
    await settle();
    expect(calls.filter((c) => c.op === 'answer').pop()?.args.answer).toEqual({ picks: ['mill', 'harbour'] });

    pending = [MULTI];
    const host2 = document.createElement('div');
    kit.workflowInput({ target: host2 });
    await settle();
    many = part(host2, 'step')[0];
    const area = all(part(many, 'other')[0]).find((n) => n.tagName === 'TEXTAREA');
    area.value = '  Only the ones in town  ';
    area.dispatchEvent({ type: 'input' });
    submit(many);
    await settle();
    expect(calls.filter((c) => c.op === 'answer').pop()?.args.answer).toEqual({ picks: [], other: 'Only the ones in town' });
  });

  it('refuses an empty answer on its step and sends nothing', async () => {
    const host = document.createElement('div');
    kit.workflowInput({ target: host });
    await settle();
    const [one, many] = part(host, 'step');
    submit(one);
    submit(many);
    await settle();
    expect(calls.filter((c) => c.op === 'answer')).toEqual([]);
    expect(part(one, 'error')[0].textContent).toBe('Choose an answer first.');
    expect(part(one, 'error')[0].attrs.role).toBe('alert');
    expect(part(many, 'error')[0].textContent).toBe('Choose an answer or write your own first.');
  });

  it('says a step stopped waiting on a 409 and reads the list again', async () => {
    answerWith = async () => {
      pending = [MULTI];
      throw Object.assign(new Error('step "review" is not waiting for human input'), { code: 'WORKFLOW_STEP_NOT_WAITING' });
    };
    const host = document.createElement('div');
    kit.workflowInput({ target: host });
    await settle();
    const reads = calls.filter((c) => c.op === 'pendingInputs').length;
    const one = part(host, 'step')[0];
    check(marks(one)[0]);
    submit(one);
    await settle();
    expect(part(host, 'failure')[0].textContent).toContain('no longer waits for an answer');
    expect(calls.filter((c) => c.op === 'pendingInputs').length).toBe(reads + 1);
    expect(part(host, 'step').map((s) => part(s, 'workflow')[0].textContent)).toEqual(['Supplier check']);
  });

  it('shows any other refusal on its step and keeps the choice', async () => {
    answerWith = async () => { throw Object.assign(new Error('unknown option id "x"'), { code: 'BAD_ANSWER' }); };
    const host = document.createElement('div');
    kit.workflowInput({ target: host });
    await settle();
    const one = part(host, 'step')[0];
    check(marks(one)[1]);
    submit(one);
    await settle();
    const again = part(host, 'step')[0];
    expect(part(again, 'error')[0].textContent).toBe('Your answer did not go through: unknown option id "x"');
    expect(marks(again)[1].checked).toBe(true);
    expect(part(host, 'failure')[0].textContent).toBe('');
  });

  it('keeps to one run with `run`, and says when that run waits for nothing', async () => {
    const host = document.createElement('div');
    kit.workflowInput({ target: host, run: 'run-cccc2222dddd' });
    await settle();
    expect(part(host, 'step').length).toBe(1);
    expect(part(host, 'workflow')[0].textContent).toBe('Supplier check');
    const host2 = document.createElement('div');
    kit.workflowInput({ target: host2, run: 'run-none' });
    await settle();
    expect(part(host2, 'none')[0].textContent).toBe('Nothing in this run is waiting for your answer.');
  });

  it('reads again on the live workflows domain and keeps what was chosen', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const block = kit.workflowInput({ target: host });
    await settle();
    check(marks(part(host, 'step')[0])[1]);
    pending = [SINGLE, MULTI, { ...MULTI, runId: 'run-eeee3333', stepId: 'pick2' }];
    expect(liveFns.length).toBe(1);
    liveFns[0]();
    await settle();
    expect(part(host, 'step').length).toBe(3);
    expect(marks(part(host, 'step')[0])[1].checked).toBe(true);
    block.destroy();
    expect(liveFns.length).toBe(0);
    expect(host.children.length).toBe(0);
    host.remove();
  });

  it('carries the same keys in English, Finnish and Spanish', () => {
    const k = words.workflowKeys();
    expect(k.fi.slice().sort()).toEqual(k.en.slice().sort());
    expect(k.es.slice().sort()).toEqual(k.en.slice().sort());
  });
});
