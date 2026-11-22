/**
 * @file test/unit/atelier-tour-guided.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's guided tour (atelier/tour.js) and the aide that shows where (atelier/aide.js):
 *   a step named by a data-ak-help id takes that element's words, "Step n of m" and Back, a step
 *   without a place is a card in the middle, a step whose place is gone is passed, the page's
 *   #aimeat-tour block and named tours, a do-step that walks on when the person does the real thing,
 *   the phone's bottom sheet, the invitation once (and never when the owner switched it off), point()
 *   with its actions, the header button, the words in Finnish, and the aide lighting the places its
 *   answer names and the control of the action it proposes, with one press deciding.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-tour-guided.test.ts
 * @version-history
 *   v1.0.0 - 2026-11-22 - Initial (wish-opastettu-kierros-sovelluksiin-monikielinen-tutorial-ja-oma-).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let doc: any;
let kit: any;
let aideMod: any;
let i18n: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  doc = restore.document;
  kit = await import('../../src/static/sdk-libs/atelier/tour.js');
  aideMod = await import('../../src/static/sdk-libs/atelier/aide.js');
  i18n = (await import('../../src/static/sdk-libs/atelier/i18n.js')).i18n;
});
afterEach(() => {
  doc.body.innerHTML = '';
  for (const n of doc.head.children.slice()) doc.head.removeChild(n);
  (window as any).localStorage.clear();
  (window as any).innerWidth = 1280;
  i18n.setLang('en');
  delete (window as any).AIMEAT;
});
afterAll(() => restore());

/** A control on the page that carries help, with a place on the screen. */
function control(id: string, title: string, text: string, top = 100): any {
  const b = doc.createElement('button');
  b.setAttribute('data-ak-help', id);
  b.setAttribute('data-ak-help-title', title);
  b.setAttribute('data-ak-help-text', text);
  b.getBoundingClientRect = () => ({ x: 40, y: top, left: 40, top, width: 80, height: 30, right: 120, bottom: top + 30 });
  doc.body.appendChild(b);
  return b;
}
const card = () => doc.body.querySelector('.ak-tour__note');
const part = (name: string) => doc.body.querySelector('[data-ak-part="' + name + '"]');
const navButtons = () => Array.from(doc.body.querySelector('.ak-tour__nav')?.children || []) as any[];
const tick = () => new Promise((done) => setTimeout(done, 5));

function block(id: string, json: unknown): void {
  const s = doc.createElement('script');
  s.id = id;
  s.setAttribute('type', 'application/json');
  s.textContent = JSON.stringify(json);
  doc.head.appendChild(s);
}

describe('the guided tour', () => {
  it('takes a help id\'s words, counts the steps and offers Back from the second step', () => {
    control('add', 'Add an errand', 'Type it and press Enter.', 100);
    control('save', 'Save', 'Keeps the list.', 300);
    const tr = kit.tour({ tours: [{ id: 'first', steps: ['add', 'save'] }] });
    expect(tr.start()).toBe(true);
    expect(part('counter').textContent).toBe('Step 1 of 2');
    expect(part('title').textContent).toBe('Add an errand');
    expect(part('text').textContent).toBe('Type it and press Enter.');
    expect(navButtons().map((b) => b.textContent)).toEqual(['Next', 'Skip']);
    expect(doc.body.querySelector('.ak-tour__spot')).toBeTruthy();
    navButtons()[0].click();
    expect(part('counter').textContent).toBe('Step 2 of 2');
    expect(navButtons().map((b) => b.textContent)).toEqual(['Done', 'Back']);
    navButtons()[1].click();
    expect(part('title').textContent).toBe('Add an errand');
    tr.end();
    expect(card()).toBeNull();
  });

  it('draws a step without a place in the middle, and passes a step whose place is gone', () => {
    control('save', 'Save', 'Keeps the list.');
    const tr = kit.tour({ steps: [{ title: 'What this is', text: 'It keeps your errands.' }, 'missing', 'save'] });
    tr.start();
    expect(card().className).toContain('ak-tour__note--center');
    expect(doc.body.querySelector('.ak-tour__spot')).toBeNull();
    navButtons()[0].click();
    expect(part('title').textContent).toBe('Save');
    expect(part('counter').textContent).toBe('Step 3 of 3');
    tr.end();
  });

  it('reads the page\'s #aimeat-tour block and starts a named tour', () => {
    control('save', 'Save', 'Keeps the list.');
    block('aimeat-tour', { tours: [
      { id: 'first', title: { en: 'First tour', fi: 'Ensimmäinen kierros' }, steps: [{ title: 'Hello' }] },
      { id: 'saving', title: 'Saving', steps: ['save'] },
    ] });
    expect(kit.hasTourBlock()).toBe(true);
    const tr = kit.tour();
    expect(tr.list().map((t: any) => t.id)).toEqual(['first', 'saving']);
    expect(tr.list()[0].title).toBe('First tour');
    tr.start('saving');
    expect(part('title').textContent).toBe('Save');
    tr.end();
  });

  it('walks on by itself when the person does the real thing on a do-step', async () => {
    const save = control('save', 'Save', 'Keeps the list.');
    control('done', 'Done', 'Marks it done.', 300);
    const tr = kit.tour({ steps: [{ help: 'save', do: 'click' }, 'done'] });
    tr.start();
    expect(part('hint').textContent).toBe('Try it: press the highlighted place.');
    save.click();
    await tick();
    expect(part('title').textContent).toBe('Done');
    tr.end();
  });

  it('is a sheet at the bottom of a narrow screen', () => {
    (window as any).innerWidth = 400;
    control('save', 'Save', 'Keeps the list.');
    const tr = kit.tour({ steps: ['save'] });
    tr.start();
    expect(card().className).toContain('ak-tour__note--sheet');
    expect(card().className).not.toContain('ak-tour__note--sheet-top');
    expect(card().style.top).toBe('');
    tr.end();
  });

  it('moves the sheet to the top when the place it would cover cannot scroll clear of it', () => {
    (window as any).innerWidth = 375;
    control('save', 'Save', 'Keeps the list.', 330);   // 330–360 on a screen the sheet covers from 271
    const tr = kit.tour({ steps: ['save'] });
    tr.start();
    const c = card();
    // The sheet's place as the stylesheet would draw it: at the bottom, then at the top.
    c.getBoundingClientRect = () => (c.className.includes('--sheet-top')
      ? { top: 8, bottom: 197, height: 189, left: 8, right: 367, width: 359 }
      : { top: 271, bottom: 460, height: 189, left: 8, right: 367, width: 359 });
    window.dispatchEvent({ type: 'resize' });
    expect(c.className).toContain('ak-tour__note--sheet-top');
    tr.end();
  });

  it('shrinks the sheet to the room left when neither end of the screen clears the place', () => {
    (window as any).innerWidth = 375;
    const list = control('list', 'Your list', 'Every errand.', 176);
    list.getBoundingClientRect = () => ({ x: 16, y: 176, left: 16, top: 176, width: 343, height: 137, right: 359, bottom: 313 });
    const tr = kit.tour({ steps: ['list'] });
    tr.start();
    const c = card();
    c.getBoundingClientRect = () => (c.className.includes('--sheet-top')
      ? { top: 8, bottom: 181, height: 173, left: 8, right: 367, width: 359 }
      : { top: 279, bottom: 452, height: 173, left: 8, right: 367, width: 359 });
    window.dispatchEvent({ type: 'resize' });
    expect(c.className).toContain('ak-tour__note--sheet-top');
    // 176 (the list) − 6 (the ring) − 8 (the gap) − 8 (the sheet's own top) = 154 px of sheet.
    expect(c.style.maxHeight).toBe('154px');
    tr.end();
  });

  it('leaves the card alone when the scroll is the card\'s own', async () => {
    let at = 300;
    const b = control('save', 'Save', 'Keeps the list.');
    b.getBoundingClientRect = () => ({ x: 40, y: at, left: 40, top: at, width: 80, height: 30, right: 120, bottom: at + 30 });
    const tr = kit.tour({ steps: ['save'] });
    tr.start();
    expect(card().style.top).toBe('342px');
    at = 100;
    window.dispatchEvent({ type: 'scroll', target: part('text') });
    await tick();
    expect(card().style.top).toBe('342px');
    window.dispatchEvent({ type: 'scroll', target: doc.body });
    await tick();
    expect(card().style.top).toBe('142px');
    tr.end();
  });

  it('keeps a card beside its place clear of the window\'s scrollbar', () => {
    const root = doc.documentElement;
    const keep = Object.getOwnPropertyDescriptor(root, 'clientWidth');
    Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => 1265 });
    const b = control('save', 'Save', 'Keeps the list.');
    b.getBoundingClientRect = () => ({ x: 1200, y: 100, left: 1200, top: 100, width: 60, height: 30, right: 1260, bottom: 130 });
    const tr = kit.tour({ steps: ['save'] });
    tr.start();
    card().width = 352;
    window.dispatchEvent({ type: 'resize' });
    expect(parseFloat(card().style.left) + 352).toBeLessThanOrEqual(1265 - 8);
    tr.end();
    if (keep) Object.defineProperty(root, 'clientWidth', keep); else delete root.clientWidth;
  });

  it('invites once, and not again after "Not now"', () => {
    const tr = kit.tour({ tours: [{ id: 'first', title: 'First tour', steps: [{ title: 'Hello' }, { title: 'Bye' }] }] });
    expect(tr.invite()).toBe(true);
    const invite = part('invite');
    expect(invite.textContent).toContain('New here?');
    expect(invite.textContent).toContain('2 steps');
    const later = Array.from(invite.querySelectorAll('button')).find((b: any) => b.textContent === 'Not now') as any;
    later.click();
    expect(part('invite')).toBeNull();
    expect(kit.tour({ tours: [{ id: 'first', steps: [{ title: 'Hello' }] }] }).invite()).toBe(false);
    // A new version of the tour invites again.
    expect(kit.tour({ tours: [{ id: 'first', version: 2, steps: [{ title: 'Hello' }] }] }).invite()).toBe(true);
  });

  it('never invites when the owner switched the invitation off, or the app said invite: false', () => {
    block('aimeat-app-ref', { owner: 'alice', app_id: 'errands.html', app: 'alice/errands.html', tools: [], tour_invite: false });
    expect(kit.tour({ steps: [{ title: 'Hello' }] }).invite()).toBe(false);
    for (const n of doc.head.children.slice()) doc.head.removeChild(n);
    expect(kit.tour({ steps: [{ title: 'Hello' }], invite: false }).invite()).toBe(false);
    expect(kit.tour({ steps: [] }).invite()).toBe(false);
  });

  it('point() lights one place with its actions, runs one once and closes', () => {
    control('save', 'Save', 'Keeps the list.');
    const tr = kit.tour({ block: false });
    let runs = 0;
    const handle = tr.point('save', { title: 'Here', text: 'This saves.', actions: [{ label: 'Run it', primary: true, run: () => { runs++; } }] });
    expect(handle).toBeTruthy();
    expect(part('title').textContent).toBe('Here');
    navButtons()[0].click();
    expect(runs).toBe(1);
    expect(card()).toBeNull();
    expect(tr.point('nowhere', { text: 'x' })).toBeNull();
  });

  it('gives the header a button that starts the tour and says so in Finnish', () => {
    control('save', 'Tallenna', 'Pitää listan.');
    const tr = kit.tour({ steps: ['save'] });
    const b = tr.button();
    doc.body.appendChild(b);
    expect(b.getAttribute('aria-label')).toBe('Start the tour');
    i18n.setLang('fi');
    expect(b.getAttribute('aria-label')).toBe('Aloita kierros');
    b.click();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(part('counter').textContent).toBe('Vaihe 1/1');
    expect(navButtons()[0].textContent).toBe('Valmis');
    tr.end();
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(kit.tour({ block: false }).button()).toBeNull();
  });
});

describe('the aide shows where', () => {
  function withModel(answer: any): string[] {
    const prompts: string[] = [];
    (window as any).AIMEAT = { ai: {
      isAvailable: async () => true,
      completeJson: async (req: any) => { prompts.push(req.prompt); return { data: { parsed: answer } }; },
    } };
    return prompts;
  }
  async function ask(a: any, text: string) {
    const input = a.el.querySelector('textarea');
    input.value = text;
    a.el.querySelector('.ak-btn--primary').click();
    await tick();
  }

  it('tells the model the places on the screen and lights the ones its answer names', async () => {
    control('add', 'Add an errand', 'Type it and press Enter.', 100);
    control('save', 'Save', 'Keeps the list.', 300);
    const prompts = withModel({ reply: 'Type it, then save.', show: ['add', 'save', 'invented'] });
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const a = aideMod.aide({ target: host, appName: 'Errands' });
    await ask(a, 'How do I add one?');
    expect(prompts[0]).toContain('"add": Add an errand');
    expect(prompts[0]).toContain('"show"');
    expect(part('title').textContent).toBe('Add an errand');
    expect(part('counter').textContent).toBe('Step 1 of 2');
    const again = Array.from(a.el.querySelectorAll('button')).find((b: any) => b.textContent === 'Show me again');
    expect(again).toBeTruthy();
    // No a.destroy(): its native Event cannot pass through the test DOM's dispatch; afterEach clears the page.
  });

  it('lights the control of a proposed action, and one press in either place decides', async () => {
    control('complete', 'Mark done', 'Marks the errand done.');
    withModel({ reply: 'I can mark it done.', action: { id: 'complete', params: { id: 'e1' } } });
    let runs = 0;
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const a = aideMod.aide({ target: host, appName: 'Errands',
      actions: [{ id: 'complete', summary: 'Mark one errand done', target: 'complete', run: () => { runs++; return 'Done.'; } }] });
    await ask(a, 'Mark the first one done');
    expect(part('title').textContent).toBe('Mark one errand done');
    expect(part('text').textContent).toBe('The aide suggests this. This button does the same.');
    navButtons()[0].click();
    await tick();
    expect(runs).toBe(1);
    expect(card()).toBeNull();
    const rowRun = Array.from(a.el.querySelectorAll('.ak-aide__confirm button')).find((b: any) => b.textContent === 'Run it') as any;
    expect(rowRun).toBeUndefined();
    // No a.destroy(): its native Event cannot pass through the test DOM's dispatch; afterEach clears the page.
  });
});
