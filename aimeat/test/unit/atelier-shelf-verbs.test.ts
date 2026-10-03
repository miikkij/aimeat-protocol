/**
 * @file test/unit/atelier-shelf-verbs.test.ts
 * @description The Atelier kit's request panel (the prompt, the plan's states, the gate row, the
 *   scanner, the console), the shelf (tabs, search, the actions, the keyed grid, the empty
 *   state) and the card verbs (both attribute spellings, the local verbs, read on sight with a
 *   timer, save and ai behind the sign-in, submit with no session, offer and tool through
 *   adapters, a refused verb's words).
 * @version-history
 *   v1.0.1 - 2026-10-03 - submit sends no cookie: the call carries credentials 'omit'.
 *   v1.0.0 - 2026-10-02 - Initial (wish-origami-atelieriin-ja-laudan-osat-kitin-lohkoiksi-ja-design-).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let panelKit: any;
let shelfKit: any;
let verbsKit: any;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }

/** A card: a host with the elements a verb names, built from attribute maps. */
function card(nodes: Array<{ tag: string; attrs: Record<string, string>; text?: string; value?: string }>) {
  const host = document.createElement('div');
  const made: any[] = [];
  for (const n of nodes) {
    const e = document.createElement(n.tag) as any;
    for (const k in n.attrs) e.setAttribute(k, n.attrs[k]);
    if (n.text) e.textContent = n.text;
    if (n.value !== undefined) e.value = n.value;
    host.appendChild(e);
    made.push(e);
  }
  document.body.appendChild(host);
  return { host, made };
}

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  panelKit = await import('../../src/static/sdk-libs/atelier/request-panel.js');
  shelfKit = await import('../../src/static/sdk-libs/atelier/shelf.js');
  verbsKit = await import('../../src/static/sdk-libs/atelier/verbs.js');
});
afterAll(() => restore());
beforeEach(() => { (window as any).AIMEAT = {}; });

describe('requestPanel', () => {
  it('asks on Enter and on the button, with the trimmed line', () => {
    const asked: string[] = [];
    const host = document.createElement('div');
    const p = panelKit.requestPanel({ target: host, onAsk: (t: string) => asked.push(t) });
    const input = part(p.el, 'input')[0];
    input.value = '  my AI spend per day ';
    input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    part(p.el, 'send')[0].click();
    expect(asked).toEqual(['my AI spend per day', 'my AI spend per day']);
    expect(p.value()).toBe('  my AI spend per day ');
  });

  it('draws the plan with a mark per state, the route and the risk, and the gate row only when gated', () => {
    const host = document.createElement('div');
    const approved: any[] = [];
    const p = panelKit.requestPanel({ target: host, onApprove: (plan: any) => approved.push(plan.intent), onCancel: () => approved.push('cancel') });
    expect(part(p.el, 'plan')[0].hidden).toBe(true);
    p.set({ plan: { intent: 'the table', route: 'agent', risk: 'medium', gated: true, steps: [
      { id: 's1', text: 'read', state: 'done' }, { id: 's2', text: 'draw', state: 'running' }, { id: 's3', text: 'say', state: 'bogus' }] } });
    expect(part(p.el, 'intent')[0].textContent).toBe('the table');
    expect(part(p.el, 'meta')[0].textContent).toBe('your agent · medium risk');
    const steps = part(p.el, 'step');
    expect(steps.map((s) => s.attrs['data-ak-state'])).toEqual(['done', 'running', 'pending']);
    expect(part(p.el, 'mark').map((m) => m.textContent)).toEqual(['✓', '→', '·']);
    expect(part(p.el, 'gate').length).toBe(1);
    part(p.el, 'approve')[0].click();
    part(p.el, 'cancel')[0].click();
    expect(approved).toEqual(['the table', 'cancel']);
    p.set({ plan: { intent: 'x', gated: false, steps: [] } });
    expect(part(p.el, 'gate').length).toBe(0);
    p.set({ plan: null });
    expect(part(p.el, 'plan')[0].hidden).toBe(true);
  });

  it('shows the scanner only while busy, appends console lines and reports the loop switch', () => {
    const host = document.createElement('div');
    const loops: boolean[] = [];
    const p = panelKit.requestPanel({ target: host, loop: false, onLoop: (on: boolean) => loops.push(on) });
    const scan = part(p.el, 'scan')[0];
    expect(scan.hidden).toBe(true);
    p.set({ busy: true });
    expect(scan.hidden).toBe(false);
    p.append([{ tone: 'ok', text: 'table: 23 rows' }]);
    expect(part(p.el, 'console')[0].textContent).toContain('table: 23 rows');
    const box = part(p.el, 'loop')[0].children[0];
    box.checked = true;
    box.dispatchEvent({ type: 'change' });
    expect(loops).toEqual([true]);
  });

  it('draws the sample: a plan with three states, lines and the scanner on', () => {
    const host = document.createElement('div');
    const p = panelKit.requestPanel({ target: host, sample: true });
    expect(part(p.el, 'step').length).toBe(3);
    expect(part(p.el, 'scan')[0].hidden).toBe(false);
    expect(part(p.el, 'console')[0].textContent).toContain('23 rows');
  });
});

describe('shelf', () => {
  it('shows one tab at a time, keeps a card across set(), and reports the action with the item', () => {
    const host = document.createElement('div');
    const used: Array<[string, string]> = [];
    const items = [
      { id: 'l1', tab: 'library', title: 'RSVP form', kind: 'form' },
      { id: 'm1', tab: 'made', title: 'AI usage', sub: '23 rows', kind: 'table' },
    ];
    const s = shelfKit.shelf({ target: host, items, onUse: (item: any, action: string) => used.push([item.id, action]) });
    expect(part(s.el, 'item').map((n) => n.attrs['data-ak-id'])).toEqual(['l1']);
    expect(part(s.el, 'monogram')[0].textContent).toBe('RF');
    const first = part(s.el, 'item')[0];
    s.set({ value: 'made' });
    expect(part(s.el, 'item').map((n) => n.attrs['data-ak-id'])).toEqual(['m1']);
    expect(part(s.el, 'sub')[0].textContent).toBe('23 rows');
    s.set({ value: 'library' });
    expect(part(s.el, 'item')[0]).toBe(first);
    part(first, 'act')[1].click();
    expect(used).toEqual([['l1', 'board']]);
    s.set({ items: [{ id: 'l1', tab: 'library', title: 'RSVP form', kind: 'form' }] });
    expect(part(s.el, 'item')[0]).not.toBe(first);
    s.set({ items: [] });
    expect(part(s.el, 'empty').length).toBe(1);
  });

  it('draws the sample with six pieces over two tabs', () => {
    const host = document.createElement('div');
    const s = shelfKit.shelf({ target: host, sample: true });
    expect(part(s.el, 'item').length).toBe(3);
    s.set({ value: 'made' });
    expect(part(s.el, 'item').length).toBe(3);
    expect(s.value()).toBe('made');
  });
});

describe('verbs', () => {
  it('runs the local verbs, in both spellings, and writes into the named output', async () => {
    const { host, made } = card([
      { tag: 'span', attrs: { 'data-ak-el': 'n' }, text: '4' },
      { tag: 'button', attrs: { 'data-ak-do': 'count', 'data-ak-step': '3', 'data-ak-out': '#n' } },
      { tag: 'span', attrs: { 'data-og-el': 'when' } },
      { tag: 'button', attrs: { 'data-og-do': 'now', 'data-og-format': 'date', 'data-og-out': '#when' } },
      { tag: 'span', attrs: { 'data-ak-el': 'dice' } },
      { tag: 'button', attrs: { 'data-ak-do': 'random', 'data-ak-count': '3', 'data-ak-min': '2', 'data-ak-max': '2', 'data-ak-out': '#dice' } },
    ]);
    const v = verbsKit.verbs({ root: host });
    made[1].click();
    await settle();
    expect(made[0].textContent).toBe('7');
    made[3].click();
    await settle();
    expect(made[2].textContent.length).toBeGreaterThan(5);
    await v.run(made[5]);
    expect(made[4].textContent).toBe('2, 2, 2');
    v.destroy();
  });

  it('reads a public value on sight, picks the path, and reads again on its timer', async () => {
    vi.useFakeTimers();
    const reads: any[] = [];
    (window as any).AIMEAT = { data: { getPublic: async (g: string, k: string) => { reads.push(g + '/' + k); return { counts: { today: 3 + reads.length } }; } } };
    const { host, made } = card([
      { tag: 'span', attrs: { 'data-ak-el': 'seats' } },
      { tag: 'span', attrs: { 'data-ak-do': 'read', 'data-ak-target': 'alice@node/origami.live.rsvp', 'data-ak-pick': 'counts.today', 'data-ak-every': '1', 'data-ak-out': '#seats' } },
    ]);
    const v = verbsKit.verbs({ root: host, owner: 'me@node' });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(reads).toEqual(['alice@node/origami.live.rsvp']);
    expect(made[0].textContent).toBe('4');
    // data-ak-every="1" is below the floor: the timer runs every 5 s, not every second.
    await vi.advanceTimersByTimeAsync(4000);
    expect(reads.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads.length).toBe(2);
    expect(made[0].textContent).toBe('5');
    v.destroy();
    vi.useRealTimers();
  });

  it('submits with no session through fetch and clears the inputs; save and ai wait for a sign-in', async () => {
    const posts: any[] = [];
    (globalThis as any).fetch = async (url: string, init: any) => { posts.push({ url, body: JSON.parse(init.body), creds: init.credentials }); return { ok: true, json: async () => ({ ok: true, id: 'x' }) }; };
    const { host, made } = card([
      { tag: 'input', attrs: { 'data-ak-el': 'first' }, value: 'Anna' },
      { tag: 'input', attrs: { 'data-ak-el': 'mail' }, value: 'anna@example.test' },
      { tag: 'div', attrs: { 'data-ak-el': 'said' } },
      { tag: 'button', attrs: { 'data-ak-do': 'submit', 'data-ak-target': '/v1/intake/o/w/f', 'data-ak-in': 'etunimi=#first, email=#mail, lahde=card', 'data-ak-out': '#said' } },
      { tag: 'button', attrs: { 'data-ak-do': 'save', 'data-ak-target': 'origami.rsvp.', 'data-ak-in': 'etunimi=#first', 'data-ak-out': '#said' } },
      { tag: 'button', attrs: { 'data-ak-do': 'ai', 'data-ak-prompt': 'Say hi', 'data-ak-out': '#said' } },
    ]);
    const v = verbsKit.verbs({ root: host, signedIn: () => false });
    await v.run(made[3]);
    expect(posts).toEqual([{ url: '/v1/intake/o/w/f', body: { etunimi: 'Anna', email: 'anna@example.test', lahde: 'card' }, creds: 'omit' }]);
    expect(made[2].textContent).toBe('Thank you, that is sent.');
    expect(made[0].value).toBe('');
    await v.run(made[4]);
    expect(made[2].textContent).toBe('sign in first');
    await v.run(made[5]);
    expect(made[2].textContent).toBe('sign in first');
    v.destroy();
  });

  it('saves and asks the AI through the platform libraries once signed in, and shows a picture URL as a picture', async () => {
    const saved: any[] = [];
    (window as any).AIMEAT = {
      data: { set: async (k: string, body: any) => { saved.push({ k, body }); } },
      ai: { complete: async (o: any) => ({ text: o.prompt.indexOf('Finnish') > 0 ? 'https://aimeat.io/v1/pub/x/pic.png' : 'no' }) },
    };
    const { host, made } = card([
      { tag: 'input', attrs: { 'data-ak-el': 'q' }, value: 'What is this?' },
      { tag: 'div', attrs: { 'data-ak-el': 'out' } },
      { tag: 'button', attrs: { 'data-ak-do': 'save', 'data-ak-target': 'origami.rsvp.', 'data-ak-in': 'question=#q', 'data-ak-out': '#out' } },
      { tag: 'button', attrs: { 'data-ak-do': 'ai', 'data-ak-prompt': 'Answer', 'data-ak-in': 'question=#q', 'data-ak-out': '#out' } },
    ]);
    const v = verbsKit.verbs({ root: host, signedIn: () => true, lang: 'fi' });
    await v.run(made[2]);
    expect(saved[0].k.indexOf('origami.rsvp.')).toBe(0);
    expect(saved[0].body.question).toBe('What is this?');
    expect(saved[0].body.at).toBeTruthy();
    made[0].value = 'again';
    await v.run(made[3]);
    expect(made[1].children[0].tagName).toBe('IMG');
    expect(made[1].children[0].attrs.src).toBe('https://aimeat.io/v1/pub/x/pic.png');
    v.destroy();
  });

  it('hands offer and tool to the app adapters with the input and a reporter, and refuses without one', async () => {
    const calls: any[] = [];
    const { host, made } = card([
      { tag: 'input', attrs: { 'data-ak-el': 'what' }, value: 'a lighthouse' },
      { tag: 'div', attrs: { 'data-ak-el': 'out' } },
      { tag: 'button', attrs: { 'data-ak-do': 'offer', 'data-ak-target': 'painter/draw', 'data-ak-in': 'subject=#what', 'data-ak-out': '#out' } },
      { tag: 'button', attrs: { 'data-ak-do': 'tool', 'data-ak-target': 'off-1', 'data-ak-in': 'subject=#what', 'data-ak-out': '#out' } },
    ]);
    const v = verbsKit.verbs({ root: host, signedIn: () => true, adapters: {
      offer: async (target: string, input: any, report: any) => { calls.push(['offer', target, input]); report('3 min'); return undefined; },
    } });
    await v.run(made[2]);
    expect(calls).toEqual([['offer', 'painter/draw', { subject: 'a lighthouse' }]]);
    expect(made[1].textContent).toBe('3 min');
    await v.run(made[3]);
    expect(made[1].textContent).toBe('this is not available here');
    expect(made[1].className).toContain('ak-verbs__bad');
    v.destroy();
  });
});
