/**
 * @file test/unit/atelier-workbench.test.ts
 * @description The workbench pieces (atelier/workbench.js) and the shell's workbench frame: the
 *   logo and the side navigation leave the login pill as it was, the side column groups and
 *   counts its entries and folds the top-level ones into the phone's bottom bar, and each piece
 *   renders the parts and the accessible names it promises.
 * @version-history
 *   v1.0.0 - 2026-09-28 - Initial.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let shell: any;
let wb: any;
let formMod: any;
let handle: any;
let pillSeen: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  shell = await import('../../src/static/sdk-libs/atelier/shell.js');
  wb = await import('../../src/static/sdk-libs/atelier/workbench.js');
  formMod = await import('../../src/static/sdk-libs/atelier/form.js');
});

beforeEach(() => {
  vi.useFakeTimers();
  pillSeen = null;
  (window as any).AIMEAT = { auth: {
    getSession: () => ({ jwt: 'session' }),
    mountLoginButton: (pill: any) => { pillSeen = pill; },
  } };
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  document.body.innerHTML = '';
  vi.clearAllTimers();
  vi.useRealTimers();
});
afterAll(() => restore());

const LOGO = 'https://example.org/mark.png';

function mountApp(extra: any) {
  handle = shell.app(Object.assign({ title: 'Mail', ambient: false, motion: false }, extra));
  vi.advanceTimersByTime(1);
  return handle;
}

describe('the workbench frame', () => {
  it('puts the logo before the title and leaves the login pill as the bar\'s own last element', () => {
    const a = mountApp({ logo: LOGO, nav: 'side', navItems: [{ id: 'one', label: 'One' }] });
    const bar = a.el.querySelector('.ak-app__bar');
    const img = bar.querySelector('.ak-app__brand > img.ak-app__logo');
    expect(img.getAttribute('src')).toBe(LOGO);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.nextElementSibling.classList.contains('ak-app__title')).toBe(true);
    // The pill: the same element auth mounted into, the id auth looks for, the last in the bar.
    expect(pillSeen).toBe(bar.lastElementChild);
    expect(pillSeen.id).toBe('login');
    expect(pillSeen.className).toBe('ak-app__pill');
  });

  it('keeps the bar exactly as it was when no logo is given', () => {
    const a = mountApp({});
    const bar = a.el.querySelector('.ak-app__bar');
    expect(bar.querySelector('.ak-app__brand')).toBeNull();
    expect(bar.firstElementChild.classList.contains('ak-app__title')).toBe(true);
    expect(pillSeen).toBe(bar.lastElementChild);
  });

  it('refuses a data: logo and draws no image', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = mountApp({ logo: 'data:image/png;base64,AAAA' });
    expect(a.el.querySelector('.ak-app__logo')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('groups the side column, counts it, and gives the bottom bar the top-level pages', () => {
    const picked: string[] = [];
    const a = mountApp({ nav: 'side', navItems: [
      { id: 'setup', label: 'Setup', count: '5/5', tone: 'ok', onPick: () => picked.push('setup') },
      { id: 'run', label: 'Processing', onPick: () => picked.push('run') },
      { id: 'clear', label: 'Clear', count: 4, tone: 'ok', group: 'Waiting', onPick: () => picked.push('clear') },
      { id: 'unclear', label: 'Unclear', count: 1, tone: 'warn', group: 'Waiting', bottom: true, onPick: () => picked.push('unclear') },
    ] });
    expect(a.el.classList.contains('ak-app--sidenav')).toBe(true);
    const side = a.el.querySelector('.ak-app__frame > .ak-app__side .ak-sidenav');
    const groups = side.querySelectorAll('.ak-sidenav__group');
    expect(groups.length).toBe(2);
    expect(groups[1].getAttribute('aria-label')).toBe('Waiting');
    expect(side.querySelector('[data-ak-id="clear"] .ak-sidenav__count').textContent).toBe('4');
    expect(side.querySelector('[data-ak-id="setup"]').getAttribute('aria-current')).toBe('page');
    const bottom = [...a.el.querySelectorAll('.ak-bottomnav__item')].map((b: any) => b.getAttribute('data-ak-id'));
    expect(bottom).toEqual(['setup', 'run', 'unclear']);

    side.querySelector('[data-ak-id="clear"]').click();
    expect(picked).toEqual(['clear']);
    expect(a.el.querySelector('.ak-sidenav [data-ak-id="clear"]').getAttribute('aria-current')).toBe('page');

    a.nav.set({ value: 'run', items: [{ id: 'setup', label: 'Setup' }, { id: 'run', label: 'Processing' }, { id: 'clear', label: 'Clear', count: 9, group: 'Waiting' }] });
    expect(a.el.querySelector('.ak-sidenav [data-ak-id="clear"] .ak-sidenav__count').textContent).toBe('9');
    expect(a.el.querySelector('.ak-bottomnav__item[data-ak-id="run"]').getAttribute('aria-current')).toBe('page');
  });
});

describe('the workbench pieces', () => {
  it('statusBand: title, sentence, a progress bar that says "5 of 5", and a body for the tiles', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const b = wb.statusBand({ target: host, title: 'Ready', text: 'All set.', progress: { value: 5, total: 5 }, action: { label: 'Run', onClick: () => {} } });
    expect(b.el.querySelector('h1.ak-band__title').textContent).toBe('Ready');
    const bar = b.el.querySelector('[role="progressbar"]');
    expect(bar.getAttribute('aria-valuenow')).toBe('5');
    expect(bar.getAttribute('aria-valuetext')).toBe('5 of 5');
    expect(b.el.querySelector('.ak-btn--primary').textContent).toBe('Run');
    wb.checkGrid({ target: b.body, items: [
      { id: 'a', state: 'ok', title: 'Mailbox', sub: 'Gmail' },
      { id: 'b', state: 'todo', title: 'Model' },
    ] });
    const tiles = b.body.querySelectorAll('.ak-checkgrid__tile');
    expect(tiles.length).toBe(2);
    expect(tiles[0].querySelector('.ak-sr-only').textContent).toBe('Done: ');
    expect(tiles[0].querySelector('[data-ak-part="sub"]').textContent).toBe('Gmail');
    expect(tiles[1].querySelector('[data-ak-part="sub"]')).toBeNull();
  });

  it('choiceCards: a radio group, the chosen card says so, arrows move the choice and refill the panel', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const seen: string[] = [];
    const c = wb.choiceCards({ target: host, items: [
      { id: 'a', kicker: 'One', title: 'First' }, { id: 'b', kicker: 'Two', title: 'Second' },
    ], renderPanel: (item: any, panel: any) => { seen.push(item.id); panel.textContent = item.title; } });
    const cards = () => c.el.querySelectorAll('[role="radio"]');
    expect(c.el.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(cards()[0].getAttribute('aria-checked')).toBe('true');
    expect(cards()[0].querySelector('.ak-choices__kicker').textContent).toBe('Chosen');
    // The stub DOM has no KeyboardEvent; the handler reads only `key` and preventDefault.
    cards()[0].dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault() {} } as any);
    expect(cards()[1].getAttribute('aria-checked')).toBe('true');
    expect(c.panel.textContent).toBe('Second');
    expect(seen).toEqual(['a', 'b']);
  });

  it('settingsGroup and the form\'s width: help and controls in one grid, each control capped by its class', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const g = wb.settingsGroup({ target: host, title: 'Batch', hint: 'How much one run reads.' });
    expect(g.el.querySelector('.ak-setgroup__grid > .ak-setgroup__help > h2').textContent).toBe('Batch');
    formMod.form({ target: g.body, submit: false, fields: [
      { name: 'n', label: 'Size', type: 'number', width: 'short' },
      { name: 'q', label: 'Search', width: 'wide-as-a-house' },
    ] });
    const fields = g.body.querySelectorAll('.ak-form__field');
    expect(fields[0].classList.contains('ak-form__field--w-short')).toBe(true);
    expect(fields[1].className).not.toContain('ak-form__field--w-');
  });

  it('progressFigure: the count, the steps and the tallies, and set() moves them', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const p = wb.progressFigure({ target: host, label: 'Processing', value: 3, total: 10, now: 'Receipt',
      steps: [{ label: 'read', state: 'done' }, { label: 'extract', state: 'now' }],
      counts: [{ id: 'ok', label: 'Clear', value: 2, tone: 'ok' }] });
    expect(p.el.querySelector('.ak-progress__figure').textContent).toBe('3');
    expect(p.el.querySelector('.ak-progress__total').textContent).toBe(' / 10');
    expect(p.el.querySelector('[aria-current="step"]').textContent).toBe('extract');
    p.set({ value: 10, counts: [{ id: 'ok', label: 'Clear', value: 9, tone: 'ok' }] });
    expect(p.el.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('10');
    expect(p.el.querySelector('.ak-progress__line').getAttribute('aria-label')).toBe('10 of 10');
  });

  it('parseAnswer finds the JSON object in a pasted chat answer, fenced or not, and says null otherwise', async () => {
    const { parseAnswer } = await import('../../src/static/sdk-libs/atelier/workbench-parts.js');
    expect(parseAnswer('Here you go:\n```json\n{ "batchSize": 10 }\n```\nAnything else?')).toEqual({ batchSize: 10 });
    expect(parseAnswer('{"a":{"b":1}}')).toEqual({ a: { b: 1 } });
    expect(parseAnswer('no object here')).toBeNull();
    expect(parseAnswer('{ broken')).toBeNull();
  });

  it('promptPanel: two steps when an answer is expected, one when it is not, and a short preview', async () => {
    const { promptPanel } = await import('../../src/static/sdk-libs/atelier/workbench-parts.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const text = 'You are an expert assistant.\nline two\nline three';
    const two = promptPanel({ target: host, prompt: () => text, expect: 'json', onResult: () => {} });
    expect(two.el.querySelectorAll('[data-ak-part="col"]').length).toBe(2);
    expect(two.el.querySelector('[data-ak-part="preview"]').textContent).toBe('You are an expert assistant.… (3 lines)');
    expect(two.el.querySelector('textarea[data-ak-part="answer"]')).not.toBeNull();
    const one = promptPanel({ target: host, prompt: text });
    expect(one.el.querySelectorAll('[data-ak-part="col"]').length).toBe(1);
    expect(one.el.className).toContain('ak-promptpanel--one');
  });

  it('queueRow: who and when, the subject, the chip and the note in its tone', async () => {
    const { queueRow } = await import('../../src/static/sdk-libs/atelier/workbench-parts.js');
    const row = queueRow({ who: 'Context7', when: '2026-09-27T17:32:00', title: 'Refreshed', chips: [{ text: 'System notice' }], note: { text: 'Extraction failed', tone: 'warn' } });
    expect(row.querySelector('[data-ak-part="who"]').textContent).toBe('Context7');
    expect(row.querySelector('[data-ak-part="when"]').textContent).toBe('27.9. 17.32');
    expect(row.querySelector('[data-ak-part="title"]').textContent).toBe('Refreshed');
    expect(row.querySelector('[data-ak-part="chip"]').textContent).toBe('System notice');
    expect(row.querySelector('[data-ak-part="note"]').className).toContain('ak-tone-text--warn');
    expect(queueRow({ title: 'Bare' }).querySelector('[data-ak-part="chips"]')).toBeNull();
  });

  it('callout: err is an alert, the rest are a status, and the tone is a class', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const c = wb.callout({ target: host, tone: 'warn', title: 'Why', text: 'Rate limit.' });
    expect(c.el.getAttribute('role')).toBe('status');
    expect(c.el.classList.contains('ak-callout--warn')).toBe(true);
    c.set({ tone: 'err' });
    expect(c.el.getAttribute('role')).toBe('alert');
    expect(c.el.querySelector('.ak-callout__text').textContent).toBe('Rate limit.');
  });
});
