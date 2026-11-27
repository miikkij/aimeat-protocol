/**
 * @file test/unit/atelier-moments.test.ts
 * @description The Atelier kit's moments over stub platform libraries: a stop (ask) and the way out
 *   each kind finds on the page, a proposal (propose) and its three presses, a hand-off (handoff),
 *   and requires, which draws the first need that is not met and the app's content when all are.
 * @version-history
 *   v1.0.0 - 2026-11-27 - Initial (wish-atelier-contextual-templates-pyynt-lohko-ask).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let kit: any;
let req: any;
let i18n: any;
let session: any;
let handlers: Record<string, Array<() => void>>;
let signIns: number;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const text = (root: any, name: string) => { const p = part(root, name)[0]; return p ? String(p.textContent) : null; };
const press = (node: any) => node.dispatchEvent({ type: 'click', bubbles: true });
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }
function host(): any {
  const h = document.createElement('div');
  document.body.appendChild(h);
  return h;
}
function emit(name: string) { for (const f of (handlers[name] || []).slice()) f(); }

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  kit = await import('../../src/static/sdk-libs/atelier/moments.js');
  req = await import('../../src/static/sdk-libs/atelier/requires.js');
  i18n = (await import('../../src/static/sdk-libs/atelier/i18n.js')).i18n;
});
afterAll(() => restore());

beforeEach(() => {
  session = null;
  handlers = {};
  signIns = 0;
  (window as any).AIMEAT = {
    auth: {
      getSession: () => session,
      signIn: async () => { signIns += 1; },
      on: (name: string, f: () => void) => { (handlers[name] = handlers[name] || []).push(f); },
      off: (name: string, f: () => void) => { handlers[name] = (handlers[name] || []).filter((g) => g !== f); },
    },
  };
  i18n.setLang('en');
});

describe('ask', () => {
  it('draws a sign-in stop with its words and the page\'s own way out', async () => {
    const h = host();
    kit.ask({ target: h, kind: 'signIn', lead: 'Your notes are kept in your own AIMEAT.' });
    const root = part(h, 'root')[0];
    expect(root.attrs['data-ak-kind']).toBe('signIn');
    expect(text(h, 'kicker')).toBe('Sign in');
    expect(text(h, 'title')).toBe('Sign in to continue.');
    expect(text(h, 'lead')).toBe('Your notes are kept in your own AIMEAT.');
    const way = part(h, 'way');
    expect(way.length).toBe(1);
    expect(way[0].textContent).toBe('Sign in');
    press(way[0]);
    await settle();
    expect(signIns).toBe(1);
  });

  it('draws no way out when the page has no sign-in library', () => {
    (window as any).AIMEAT = {};
    const h = host();
    kit.ask({ target: h, kind: 'signIn' });
    expect(part(h, 'ways').length).toBe(0);
    expect(text(h, 'title')).toBe('Sign in to continue.');
  });

  it('links to the address a settings or a permission stop is given', () => {
    const h = host();
    kit.ask({ target: h, kind: 'settings', url: 'https://example.test/settings' });
    kit.ask({ target: h, kind: 'permission', url: 'https://example.test/allow' });
    const ways = part(h, 'way');
    expect(ways.map((w) => w.tagName)).toEqual(['A', 'A']);
    expect(ways[0].attrs.href).toBe('https://example.test/settings');
    expect(ways[1].textContent).toBe('Give permission');
    const none = host();
    kit.ask({ target: none, kind: 'settings' });
    expect(part(none, 'ways').length).toBe(0);
  });

  it('says when a refusal or a limit ends, and keeps a text that is not a date', () => {
    const h = host();
    kit.ask({ target: h, kind: 'limit', when: 'tomorrow at midnight' });
    expect(text(h, 'lead')).toBe('You can go on tomorrow at midnight.');
    expect(part(h, 'ways').length).toBe(0);
  });

  it('asks the browser for a device and says so when the browser refuses', async () => {
    const h = host();
    let granted = 0;
    let refuse = false;
    kit.ask({
      target: h, kind: 'device', what: 'microphone',
      request: async () => { if (refuse) throw new Error('NotAllowedError'); },
      onGranted: () => { granted += 1; },
    });
    expect(text(h, 'title')).toBe('This needs the microphone.');
    press(part(h, 'way')[0]);
    await settle();
    expect(granted).toBe(1);
    refuse = true;
    press(part(h, 'way')[0]);
    await settle();
    expect(granted).toBe(1);
    expect(text(h, 'lead')).toContain('The browser refused.');
  });

  it('stamps the inline variant, replaces a part and removes one', () => {
    const h = host();
    kit.ask({ target: h, kind: 'offline', variant: 'inline', parts: { title: 'No network here', lead: null } });
    expect(part(h, 'root')[0].attrs['data-ak-variant']).toBe('inline');
    expect(text(h, 'title')).toBe('No network here');
    expect(part(h, 'lead').length).toBe(0);
  });

  it('falls back to the first kind for a kind it does not have', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = host();
    kit.ask({ target: h, kind: 'nope' });
    expect(part(h, 'root')[0].attrs['data-ak-kind']).toBe('signIn');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('speaks the page\'s language and follows a change of it', () => {
    const h = host();
    kit.ask({ target: h, kind: 'signIn' });
    i18n.setLang('fi');
    expect(text(h, 'title')).toBe('Kirjaudu sisään jatkaaksesi.');
    expect(part(h, 'way')[0].textContent).toBe('Kirjaudu sisään');
  });

  it('marks a sample and does nothing when its button is pressed', async () => {
    const h = host();
    kit.ask({ target: h, kind: 'signIn', sample: true });
    expect(text(h, 'kicker')).toContain('Sample');
    press(part(h, 'way')[0]);
    await settle();
    expect(signIns).toBe(0);
  });
});

describe('propose', () => {
  it('draws a draft with its three presses and settles on accept', async () => {
    const h = host();
    let sent = 0;
    const p = kit.propose({
      target: h, kind: 'draft', title: 'Reminder of invoice 1042', body: 'Hello, invoice 1042 was due on 14 November.',
      onAccept: async () => { sent += 1; }, onEdit: () => {}, onReject: () => {},
    });
    expect(text(h, 'kicker')).toBe('Draft');
    expect(text(h, 'body')).toBe('Hello, invoice 1042 was due on 14 November.');
    expect(part(h, 'accept')[0].textContent).toBe('Send');
    expect(part(h, 'edit').length).toBe(1);
    expect(part(h, 'reject')[0].textContent).toBe('Dismiss');
    press(part(h, 'accept')[0]);
    await settle();
    expect(sent).toBe(1);
    expect(p.state()).toBe('accepted');
    expect(part(h, 'ways').length).toBe(0);
    expect(text(h, 'note')).toBe('Sent.');
    expect(part(h, 'root')[0].attrs['data-ak-state']).toBe('accepted');
  });

  it('stays open when the handler answers false, and after an edit', async () => {
    const h = host();
    const p = kit.propose({ target: h, kind: 'change', title: 'A new version', onAccept: () => false, onEdit: () => {} });
    press(part(h, 'accept')[0]);
    await settle();
    expect(p.state()).toBe('open');
    press(part(h, 'edit')[0]);
    await settle();
    expect(p.state()).toBe('open');
    expect(part(h, 'ways').length).toBe(1);
  });

  it('shows an extracted value beside its source, with a reject only when the app takes one', () => {
    const h = host();
    kit.propose({ target: h, kind: 'extract', title: 'Notice period: 3 months', source: 'Either party may terminate with three months\' notice.' });
    expect(text(h, 'source')).toBe('Source: Either party may terminate with three months\' notice.');
    expect(part(h, 'accept')[0].textContent).toBe('Approve');
    expect(part(h, 'reject').length).toBe(0);
  });

  it('lists a plan\'s steps', () => {
    const h = host();
    kit.propose({ target: h, kind: 'run', title: 'The AI will do three things.', steps: ['Read the table.', 'Add the sums.', 'Write the report.'] });
    expect(part(h, 'step').map((s) => s.textContent)).toEqual(['Read the table.', 'Add the sums.', 'Write the report.']);
    expect(part(h, 'reject')[0].textContent).toBe('Cancel');
  });

  it('asks nothing when the owner turned approval off', () => {
    const h = host();
    const p = kit.propose({ target: h, kind: 'draft', title: 'Reminder', body: 'Hello.', gate: false, onAccept: () => {} });
    expect(part(h, 'ways').length).toBe(0);
    expect(text(h, 'note')).toBe('Sent without asking, as set.');
    expect(p.state()).toBe('auto');
  });

  it('says what failed and stays open', async () => {
    const h = host();
    const p = kit.propose({ target: h, kind: 'draft', title: 'Reminder', onAccept: async () => { throw new Error('the mail server refused'); } });
    press(part(h, 'accept')[0]);
    await settle();
    expect(p.state()).toBe('open');
    expect(text(h, 'note')).toBe('That did not work: the mail server refused');
    expect(part(h, 'accept').length).toBe(1);
  });
});

describe('handoff', () => {
  it('copies one sentence for the person\'s own AI and says so', async () => {
    const copied: string[] = [];
    (window as any).AIMEAT.agentface = { copyText: async (t: string) => { copied.push(t); return true; } };
    const h = host();
    let told = '';
    kit.handoff({ target: h, kind: 'say', text: 'Make me an agent that watches my invoices.', onCopied: (t: string) => { told = t; } });
    expect(text(h, 'kicker')).toBe('For your own AI');
    expect(text(h, 'say')).toBe('Make me an agent that watches my invoices.');
    press(part(h, 'way')[0]);
    await settle();
    expect(copied).toEqual(['Make me an agent that watches my invoices.']);
    expect(told).toBe('Make me an agent that watches my invoices.');
    expect(text(h, 'note')).toBe('Copied. Paste it into your own AI.');
  });

  it('holds the prompt panel for a prompt whose answer comes back', () => {
    const h = host();
    kit.handoff({ target: h, kind: 'prompt', prompt: 'List my open invoices as JSON.', expect: 'json' });
    expect(text(h, 'kicker')).toBe('Prompt');
    expect(part(h, 'body')[0].children.length).toBeGreaterThan(0);
  });
});

describe('requires', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('waits a grace for a silent sign-in, draws the stop, then the content once', async () => {
    vi.useFakeTimers();
    const h = host();
    let drawn = 0;
    const states: string[] = [];
    const r = req.requires({ target: h, needs: ['session'], render: () => { drawn += 1; }, onState: (s: string) => states.push(s) });
    await vi.advanceTimersByTimeAsync(600);
    expect(r.state()).toBe('checking');
    expect(part(h, 'way').length).toBe(0);
    await vi.advanceTimersByTimeAsync(2600);
    expect(r.state()).toBe('signIn');
    expect(r.el.attrs['data-ak-state']).toBe('signIn');
    expect(part(h, 'way')[0].textContent).toBe('Sign in');
    session = { jwt: 'x' };
    await vi.advanceTimersByTimeAsync(700);
    expect(r.state()).toBe('ready');
    expect(drawn).toBe(1);
    expect(part(h, 'way').length).toBe(0);
    i18n.setLang('fi');
    await vi.advanceTimersByTimeAsync(50);
    expect(drawn).toBe(1);
    expect(states).toEqual(['signIn', 'ready']);
    r.destroy();
  });

  it('draws the content at once for a signed-in person and the stop after a sign-out', async () => {
    session = { jwt: 'x' };
    const h = host();
    let drawn = 0;
    const r = req.requires({ target: h, needs: ['session'], render: (el: any) => { drawn += 1; el.appendChild(document.createElement('article')); } });
    await settle();
    expect(r.state()).toBe('ready');
    expect(drawn).toBe(1);
    session = null;
    emit('logout');
    await settle();
    expect(r.state()).toBe('signIn');
    expect(all(h).filter((n) => n.tagName === 'ARTICLE').length).toBe(0);
    r.destroy();
  });

  it('draws the settings stop the node describes when the AI is off', async () => {
    session = { jwt: 'x' };
    (window as any).AIMEAT.ai = {
      capabilities: async () => ({ capabilities: { text: { on: false, fix: 'Choose a model for text in your AI settings.', settingsUrl: 'https://example.test/ai' } } }),
    };
    const h = host();
    const r = req.requires({ target: h, needs: ['session', 'ai'], app: 'alice/notes.html', render: () => {} });
    await settle();
    expect(r.state()).toBe('settings');
    expect(text(h, 'title')).toBe('The AI is off.');
    expect(text(h, 'lead')).toBe('Choose a model for text in your AI settings.');
    expect(part(h, 'way')[0].attrs.href).toBe('https://example.test/ai');
    r.destroy();
  });

  it('draws the access stop with the join request for a person who is not a member', async () => {
    session = { jwt: 'x' };
    const me = { isOwner: false, member: false, role: null, caps: [] };
    (window as any).AIMEAT.iam = { me: () => me, init: async () => me, can: () => false, request: async () => ({ recorded: true }) };
    const h = host();
    const r = req.requires({ target: h, needs: ['member:use'], app: 'alice/club.html', render: () => {} });
    await settle();
    expect(r.state()).toBe('access');
    expect(text(h, 'title')).toBe('This area is for members.');
    expect(part(h, 'body')[0].children.length).toBeGreaterThan(0);
    r.destroy();
  });

  it('says an unknown need and a missing library in words', async () => {
    const h = host();
    const a = req.requires({ target: h, needs: ['sessoin'], render: () => {} });
    await settle();
    expect(a.state()).toBe('blocked');
    expect(text(a.el, 'note')).toBe('Unknown need: sessoin.');
    (window as any).AIMEAT = {};
    const b = req.requires({ target: h, needs: ['session'], render: () => {} });
    await settle();
    expect(b.state()).toBe('blocked');
    expect(text(b.el, 'note')).toContain('aimeat-auth.js');
    a.destroy(); b.destroy();
  });

  it('draws the first need\'s stop as a sample and reads nothing', async () => {
    let read = 0;
    (window as any).AIMEAT.auth.getSession = () => { read += 1; return null; };
    const h = host();
    const r = req.requires({ target: h, needs: ['session'], sample: true, render: () => {} });
    await settle();
    expect(r.state()).toBe('signIn');
    expect(text(h, 'kicker')).toContain('Sample');
    expect(read).toBe(0);
    r.destroy();
  });

  it('draws the offline stop when the browser has no connection', async () => {
    const nav = (window as any).navigator;
    const was = nav.onLine;
    nav.onLine = false;
    const h = host();
    const r = req.requires({ target: h, needs: ['online'], render: () => {} });
    await settle();
    expect(r.state()).toBe('offline');
    expect(text(h, 'title')).toBe('The connection dropped.');
    nav.onLine = was;
    r.destroy();
  });
});
