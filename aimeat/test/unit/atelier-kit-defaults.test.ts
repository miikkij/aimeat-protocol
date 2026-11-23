/**
 * @file test/unit/atelier-kit-defaults.test.ts
 * @description The Atelier kit's defaults that did something other than what an app writing the
 *   obvious code expected (atelier 0.70.0), on the stub browser with motion off:
 *   - a dialog action closes its dialog (no run, or a run that does not return false);
 *   - menu() calls onPick only for an entry without its own run;
 *   - choiceCards can start with no card chosen, and keep an item's kicker on the chosen card;
 *   - listDetail.set() keeps a detail pane the person typed in;
 *   - timeline() prints a date with no time of day as a date;
 *   - a horizontal chart keeps its width and takes its height from its rows;
 *   - i18n.use(dict, { kit: false }) keeps app words out of kit components, and a plain use()
 *     that rewords a kit word says so once;
 *   - a view transition the browser skips is no unhandled rejection.
 *   Every old behaviour stays reachable through the option each section names, and each section
 *   has that case too.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-kit-defaults.test.ts
 * @version-history
 *   v1.0.1 — 2026-11-23 — The timeline cases no longer read a dotted date as a time of day: on a
 *     machine whose locale is fi-FI the kit prints 3.3.1940, which the old pattern matched, so the
 *     whole unit suite was red there. The kit's output was right; the pattern is tested by itself now.
 *   v1.0.0 — 2026-11-21 — Initial (atelier 0.70.0).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let doc: any;
let dialogMod: any;
let menuMod: any;
let wb: any;
let listMod: any;
let timelineMod: any;
let chartMod: any;
let i18nMod: any;
let motionMod: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  doc = restore.document;
  dialogMod = await import('../../src/static/sdk-libs/atelier/dialog.js');
  menuMod = await import('../../src/static/sdk-libs/atelier/menu.js');
  wb = await import('../../src/static/sdk-libs/atelier/workbench.js');
  listMod = await import('../../src/static/sdk-libs/atelier/list.js');
  timelineMod = await import('../../src/static/sdk-libs/atelier/timeline.js');
  chartMod = await import('../../src/static/sdk-libs/atelier/chart.js');
  i18nMod = await import('../../src/static/sdk-libs/atelier/i18n.js');
  motionMod = await import('../../src/static/sdk-libs/atelier/mosaic-motion.js');
});
afterEach(() => { doc.body.innerHTML = ''; });
afterAll(() => restore());

const tick = () => new Promise((r) => setTimeout(r, 0));
function host(): any {
  const node = doc.createElement('div');
  doc.body.appendChild(node);
  return node;
}
const press = (d: any, id: string) => d.el.querySelector(`[data-ak-action="${id}"]`).click();

describe('a dialog action closes its dialog', () => {
  function open(actions: any[], extra: any = {}) {
    const reasons: string[] = [];
    const d = dialogMod.dialog(Object.assign({ title: 'Rename', actions, onClose: (r: string) => reasons.push(r) }, extra));
    return { d, reasons };
  }

  it('an action without run closes the dialog with its id as the reason', () => {
    const { d, reasons } = open([{ id: 'ok', label: 'OK' }]);
    press(d, 'ok');
    expect(reasons).toEqual(['ok']);
    expect(d.el.parentNode).toBeNull();
  });

  it('a run that returns nothing closes after it ran; a run that returns false keeps it open', () => {
    const ran: string[] = [];
    const { d, reasons } = open([
      { id: 'check', label: 'Check', run: () => { ran.push('check'); return false; } },
      { id: 'save', label: 'Save', run: () => { ran.push('save'); } },
    ]);
    press(d, 'check');
    expect(reasons).toEqual([]);
    expect(d.el.open).toBe(true);
    press(d, 'save');
    expect(ran).toEqual(['check', 'save']);
    expect(reasons).toEqual(['save']);
  });

  it('a promise closes when it resolves, and a rejection or a throw keeps the dialog open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { d, reasons } = open([
      { id: 'bad', label: 'Bad', run: () => Promise.reject(new Error('the server said no')) },
      { id: 'boom', label: 'Boom', run: () => { throw new Error('boom'); } },
      { id: 'later', label: 'Later', run: () => Promise.resolve('stored') },
    ]);
    press(d, 'bad');
    await tick();
    press(d, 'boom');
    expect(reasons).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    press(d, 'later');
    expect(reasons).toEqual([]);
    await tick();
    expect(reasons).toEqual(['later']);
    warn.mockRestore();
  });

  it('keepOpen on an action, or autoClose: false on the dialog, keeps the old behaviour', () => {
    const a = open([{ id: 'stay', label: 'Stay', keepOpen: true, run: () => {} }, { id: 'go', label: 'Go' }]);
    press(a.d, 'stay');
    expect(a.reasons).toEqual([]);
    const b = open([{ id: 'go', label: 'Go' }, { id: 'run', label: 'Run', run: () => {} }], { autoClose: false });
    press(b.d, 'go');
    press(b.d, 'run');
    expect(b.reasons).toEqual([]);
    expect(b.d.el.open).toBe(true);
  });

  it('confirm() still answers what was pressed, once', async () => {
    const answer = dialogMod.confirm({ title: 'Delete?' });
    const node = doc.body.querySelector('.ak-dialog');
    node.querySelector('[data-ak-action="confirm"]').click();
    expect(await answer).toBe(true);
  });
});

describe('menu() calls onPick only for an entry without its own run', () => {
  function withMenu(extra: any = {}) {
    const btn = doc.createElement('button');
    doc.body.appendChild(btn);
    const picked: string[] = [];
    const ran: string[] = [];
    const m = menuMod.menu(Object.assign({
      anchor: btn, onPick: (id: string) => picked.push(id),
      items: [{ id: 'rename', label: 'Rename', run: () => ran.push('rename') }, { id: 'copy', label: 'Copy' }],
    }, extra));
    const pick = (id: string) => { m.open(); doc.body.querySelector(`.ak-menu__item[data-ak-id="${id}"]`).click(); };
    return { m, picked, ran, pick };
  }

  it('an entry with run runs once, and onPick does not hear it', () => {
    const { picked, ran, pick } = withMenu();
    pick('rename');
    expect(ran).toEqual(['rename']);
    expect(picked).toEqual([]);
  });

  it('an entry without run goes to onPick', () => {
    const { picked, ran, pick } = withMenu();
    pick('copy');
    expect(picked).toEqual(['copy']);
    expect(ran).toEqual([]);
  });

  it('pickAlways: true is the old behaviour, where onPick hears every pick', () => {
    const { picked, ran, pick } = withMenu({ pickAlways: true });
    pick('rename');
    expect(ran).toEqual(['rename']);
    expect(picked).toEqual(['rename']);
  });
});

describe('choiceCards: a preset choice is optional', () => {
  const ITEMS = [{ id: 'a', kicker: '62 %', title: 'First' }, { id: 'b', kicker: '38 %', title: 'Second' }];
  const cards = (c: any) => c.el.querySelectorAll('[role="radio"]');

  it('value: null draws every card unchosen, the first one reachable by Tab, and no panel', () => {
    const c = wb.choiceCards({ target: host(), items: ITEMS, value: null, renderPanel: (item: any, p: any) => { p.textContent = item.title; } });
    expect([...cards(c)].map((n: any) => n.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect([...cards(c)].map((n: any) => n.getAttribute('tabindex'))).toEqual(['0', '-1']);
    expect(c.panel.hidden).toBe(true);
    cards(c)[1].click();
    expect(cards(c)[1].getAttribute('aria-checked')).toBe('true');
    expect(c.panel.textContent).toBe('Second');
    c.set({ value: null });
    expect(cards(c)[1].getAttribute('aria-checked')).toBe('false');
  });

  it('without value the first card is chosen and set({ value: null }) changes nothing, as before', () => {
    const c = wb.choiceCards({ target: host(), items: ITEMS });
    expect(cards(c)[0].getAttribute('aria-checked')).toBe('true');
    c.set({ value: null });
    expect(cards(c)[0].getAttribute('aria-checked')).toBe('true');
  });

  it('keepKicker keeps the item\'s own kicker beside the chosen word', () => {
    const c = wb.choiceCards({ target: host(), items: ITEMS, keepKicker: true });
    expect(cards(c)[0].querySelector('.ak-choices__kicker').textContent).toBe('62 % · Chosen');
    expect(cards(c)[1].querySelector('.ak-choices__kicker').textContent).toBe('38 %');
  });
});

describe('listDetail.set() keeps a detail pane the person typed in', () => {
  const ROWS = [{ id: 'r1', title: 'One' }, { id: 'r2', title: 'Two' }];
  function make(extra: any = {}) {
    let drawn = 0;
    const ld = listMod.listDetail(Object.assign({
      target: host(), items: ROWS,
      renderDetail: (item: any, body: any) => {
        drawn++;
        const f = doc.createElement('textarea');
        f.value = item.title;
        body.appendChild(f);
      },
    }, extra));
    ld.select('r1');
    const field = () => ld.el.querySelector('.ak-listdetail__body textarea');
    return { ld, field, drawn: () => drawn };
  }

  it('text typed in the pane survives a set() that keeps its item', () => {
    const { ld, field, drawn } = make();
    const f = field();
    f.value = 'One, with my notes';
    f.dispatchEvent({ type: 'input', bubbles: true });
    ld.set({ items: [{ id: 'r1', title: 'One (renamed elsewhere)' }, ...ROWS.slice(1)] });
    expect(field()).toBe(f);
    expect(field().value).toBe('One, with my notes');
    expect(drawn()).toBe(1);
  });

  it('an untouched pane is drawn again with the new data, as before', () => {
    const { ld, field, drawn } = make();
    ld.set({ items: [{ id: 'r1', title: 'One (renamed elsewhere)' }, ...ROWS.slice(1)] });
    expect(field().value).toBe('One (renamed elsewhere)');
    expect(drawn()).toBe(2);
  });

  it('keepDetail: false draws over typed text, and a set() without the item closes the pane', () => {
    const a = make({ keepDetail: false });
    a.field().dispatchEvent({ type: 'input', bubbles: true });
    a.ld.set({ items: ROWS });
    expect(a.drawn()).toBe(2);
    const b = make();
    b.field().dispatchEvent({ type: 'input', bubbles: true });
    b.ld.set({ items: ROWS.slice(1) });
    expect(b.ld.el.classList.contains('ak-listdetail--open')).toBe(false);
  });
});

describe('timeline() adds no time of day to a date that has none', () => {
  const when = (ts: any) => {
    const tl = timelineMod.timeline({ target: host(), items: [{ id: 'e', ts, title: 'Event' }] });
    return tl.el.querySelector('.ak-timeline__when').textContent as string;
  };

  // A time of day: one or two digits, a colon or a dot (Finnish writes 10.30), two digits. A date
  // written with dots is not one (3.3.1940 on a machine whose locale is fi-FI), so the digits must
  // not sit inside a longer dotted number: no digit and no dot on either side.
  const TIME_OF_DAY = /(?<![\d.])\d{1,2}[:.]\d{2}(?![.\d])/;

  it('"3 Mar 1940" and "Sun Mar 03 1940" are printed as dates', () => {
    for (const ts of ['3 Mar 1940', 'Sun, 3 Mar 1940', 'Sun Mar 03 1940']) {
      const out = when(ts);
      expect(out, ts).toContain('1940');
      expect(out, ts).not.toMatch(TIME_OF_DAY);
    }
  });

  it('the time-of-day pattern reads a dotted date as a date, in any locale the machine has', () => {
    for (const date of ['3.3.1940', '03.03.1940', '3/3/1940', 'March 3, 1940']) expect(date, date).not.toMatch(TIME_OF_DAY);
    for (const time of ['3.3.1940 klo 10.30', '3/3/1940, 10:30 AM', '10.30']) expect(time, time).toMatch(TIME_OF_DAY);
  });

  it('a moment with a time keeps its time, and a string the kit does not read is printed as given', () => {
    expect(when('3 Mar 1940 10:30')).toMatch(TIME_OF_DAY);
    expect(when('07/09, 04:10')).toBe('07/09, 04:10');
  });
});

describe('a horizontal chart keeps its width and grows with its rows', () => {
  const viewBox = (labels: string[], horizontal: boolean) => {
    const c = chartMod.chart({ target: host(), data: { horizontal, labels, series: [{ id: 's', label: 'S', kind: 'bar', values: labels.map((_, i) => i + 1) }] } });
    const [, , w, h] = String(c.el.querySelector('svg').getAttribute('viewBox')).split(' ').map(Number);
    return { w, h };
  };

  it('three rows are a wide, short chart; twelve rows are taller', () => {
    const three = viewBox(['a', 'b', 'c'], true);
    const twelve = viewBox(Array.from({ length: 12 }, (_, i) => 'r' + i), true);
    expect(three.w).toBe(560);
    expect(three.h).toBeLessThan(three.w);
    expect(twelve.h).toBeGreaterThan(three.h);
  });

  it('a vertical chart keeps its 560 × 300 box', () => {
    expect(viewBox(['a', 'b', 'c'], false)).toEqual({ w: 560, h: 300 });
  });
});

describe('i18n: an app word does not replace a kit word', () => {
  afterEach(() => { i18nMod.i18n.use({ en: { chosen: 'Chosen' } }, { kit: true }); });
  const kicker = () => {
    const c = wb.choiceCards({ target: host(), items: [{ id: 'a', title: 'First' }] });
    return c.el.querySelector('.ak-choices__kicker').textContent;
  };

  it('use(dict, { kit: false }) is read by i18n.t() and never by a kit component', () => {
    i18nMod.i18n.use({ en: { chosen: 'Angle chosen. The texts are being written.' } }, { kit: false });
    expect(i18nMod.i18n.t('chosen')).toBe('Angle chosen. The texts are being written.');
    expect(kicker()).toBe('Chosen');
  });

  it('a plain use() still rewords the kit word, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    i18nMod.i18n.use({ en: { chosen: 'Picked' } });
    i18nMod.i18n.use({ en: { chosen: 'Picked' } });
    expect(kicker()).toBe('Picked');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"chosen"');
    expect(String(warn.mock.calls[0][0])).toContain('{ kit: false }');
    warn.mockRestore();
  });

  it('use(dict, { kit: true }) rewords on purpose without a warning; a word the kit lacks warns nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    i18nMod.i18n.use({ en: { chosen: 'Selected' } }, { kit: true });
    i18nMod.i18n.use({ en: { myOwnWord: 'Hello' } });
    expect(kicker()).toBe('Selected');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a view transition the browser skips is no unhandled rejection', () => {
  it('transition() and morph() catch ready, finished and updateCallbackDone', async () => {
    const seen: unknown[] = [];
    const onRejection = (reason: unknown) => { seen.push(reason); };
    process.on('unhandledRejection', onRejection);
    const skipped = () => Object.assign(new Error('Transition was skipped'), { name: 'AbortError' });
    const ran: string[] = [];
    doc.startViewTransition = (run: () => void) => {
      run();
      return { ready: Promise.reject(skipped()), finished: Promise.reject(skipped()), updateCallbackDone: Promise.reject(skipped()) };
    };
    doc.setMotion(null);
    try {
      motionMod.transition(() => ran.push('swap'));
      const moving = doc.createElement('div');
      motionMod.morph(moving, () => ran.push('morph'));
      await new Promise((r) => setTimeout(r, 20));
      expect(ran).toEqual(['swap', 'morph']);
      expect(moving.style.viewTransitionName).toBe('');
      expect(seen).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
      delete doc.startViewTransition;
      doc.setMotion('less');
    }
  });

  it('without View Transitions the swap runs at once', () => {
    const ran: string[] = [];
    motionMod.transition(() => ran.push('swap'));
    expect(ran).toEqual(['swap']);
  });
});
