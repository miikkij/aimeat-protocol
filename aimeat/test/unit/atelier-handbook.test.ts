/**
 * @file test/unit/atelier-handbook.test.ts
 * @description The Atelier kit's handbook: chapters from the app's list and from the page's
 *   data-ak-help elements merged by id, the contents grouped in order, a chapter read, the search,
 *   words per language and a redraw on a language change, "Show me" marking the place (and the
 *   app's onGo heard first), a place that is gone, the header button kept in step, the sample.
 * @version-history
 *   v1.0.0 - 2026-10-03 - Initial (wish-ohjekirja-komponentti-atelieriin-sis-llysluettelo-ohjeet-app).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let kit: any;
let i18n: any;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  kit = await import('../../src/static/sdk-libs/atelier/handbook.js');
  i18n = (await import('../../src/static/sdk-libs/atelier/i18n.js')).i18n;
});
afterAll(() => restore());
beforeEach(() => {
  for (const c of document.body.children.slice()) document.body.removeChild(c);
  i18n.setLang('en');
});

function pageControl(id: string, title: string, text: string, group?: string) {
  const b = document.createElement('button') as any;
  b.setAttribute('data-ak-help', id);
  b.setAttribute('data-ak-help-title', title);
  b.setAttribute('data-ak-help-text', text);
  if (group) b.setAttribute('data-ak-help-group', group);
  document.body.appendChild(b);
  return b;
}

describe('atelier handbook', () => {
  it('merges the app\'s chapters with the page\'s by id, groups the contents in order, and reads one', () => {
    const save = pageControl('save', 'Save', 'Keeps the board.', 'Board');
    pageControl('ask', 'Ask (page)', 'from the page');
    const book = kit.handbook({ chapters: [
      { id: 'ask', group: 'Start', title: 'Ask', body: 'Type what you want.' },
      { id: 'data', group: 'Start', title: 'Add from data', body: 'Pick a key.' },
    ] });
    expect(book.scan()).toEqual([
      { id: 'ask', title: 'Ask', group: 'Start', place: true },
      { id: 'data', title: 'Add from data', group: 'Start', place: false },
      { id: 'save', title: 'Save', group: 'Board', place: true },
    ]);
    book.open();
    expect(book.isOpen()).toBe(true);
    expect(part(book.el, 'group').map((g: any) => g.attrs['aria-label'])).toEqual(['Start', 'Board']);
    expect(part(book.el, 'entry').map((e: any) => e.textContent)).toEqual(['Ask', 'Add from data', 'Save']);
    part(book.el, 'entry')[2].click();
    expect(book.el.getAttribute('data-ak-view')).toBe('read');
    expect(part(book.el, 'heading')[0].textContent).toBe('Save');
    expect(part(book.el, 'text')[0].textContent).toBe('Keeps the board.');
    expect(part(book.el, 'go').length).toBe(1);
    expect(save).toBeTruthy();
  });

  it('opens on a chapter, searches every chapter, and says when nothing matches', async () => {
    vi.useFakeTimers();
    try {
      const book = kit.handbook({ collect: false, chapters: [
        { id: 'a', title: 'Ask', body: 'Type what you want.' },
        { id: 'b', title: 'Share', body: 'Invite people.', keywords: 'team' },
      ] });
      book.open('b');
      expect(part(book.el, 'heading')[0].textContent).toBe('Share');
      const input = part(book.el, 'search')[0].children.find((c: any) => c.tagName === 'INPUT');
      input.value = 'team';
      input.dispatchEvent({ type: 'input', bubbles: true });
      vi.advanceTimersByTime(300);
      expect(part(book.el, 'entry').map((e: any) => e.textContent)).toEqual(['Share']);
      input.value = 'nothing like it';
      input.dispatchEvent({ type: 'input', bubbles: true });
      vi.advanceTimersByTime(300);
      expect(part(book.el, 'empty')[0].textContent).toBe('Nothing in the guide matches.');
    } finally { vi.useRealTimers(); }
  });

  it('writes every word in the language in force, and draws again when the language changes', () => {
    const book = kit.handbook({ collect: false, title: { en: 'Guide', fi: 'Opas' }, chapters: [
      { id: 'a', group: { en: 'Start', fi: 'Aloitus' }, title: { en: 'Ask', fi: 'Pyydä' }, body: '{"en":"Type.","fi":"Kirjoita."}' },
    ] });
    book.open('a');
    expect(part(book.el, 'title')[0].textContent).toBe('Guide');
    expect(part(book.el, 'text')[0].textContent).toBe('Type.');
    i18n.setLang('fi');
    expect(part(book.el, 'title')[0].textContent).toBe('Opas');
    expect(part(book.el, 'heading')[0].textContent).toBe('Pyydä');
    expect(part(book.el, 'text')[0].textContent).toBe('Kirjoita.');
    expect(part(book.el, 'group')[0].attrs['aria-label']).toBe('Aloitus');
    expect(part(book.el, 'back')[0].textContent).toContain('Sisällys');
  });

  it('"Show me" lets the app bring the place on screen, then marks it; a gone place says so', () => {
    const place = document.createElement('div') as any;
    document.body.appendChild(place);
    const heard: string[] = [];
    const book = kit.handbook({ collect: false, mode: 'dialog', onGo: (c: any) => heard.push(c.id), chapters: [
      { id: 'here', title: 'Here', body: 'x', target: () => place },
      { id: 'gone', title: 'Gone', body: 'y', target: '#nowhere' },
    ] });
    book.open('here');
    part(book.el, 'go')[0].click();
    expect(heard).toEqual(['here']);
    expect(place.className).toContain('ak-handbook__mark');
    expect(book.isOpen()).toBe(false);   // a dialog steps aside
    book.open('gone');
    part(book.el, 'go')[0].click();
    expect(part(book.el, 'note')[0].hidden).toBe(false);
    expect(book.isOpen()).toBe(true);
  });

  it('keeps its header button in step, and a side book stays open on "Show me"', () => {
    const place = document.createElement('div') as any;
    document.body.appendChild(place);
    const book = kit.handbook({ collect: false, chapters: [{ id: 'p', title: 'P', target: () => place }] });
    const b = book.button();
    expect(b.getAttribute('aria-expanded')).toBe('false');
    b.click();
    expect(book.isOpen()).toBe(true);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    book.open('p');
    part(book.el, 'go')[0].click();
    expect(book.isOpen()).toBe(true);
    b.click();
    expect(book.isOpen()).toBe(false);
    book.destroy();
    expect(b.isConnected).toBe(false);
  });

  it('draws a sample with four chapters in three groups', () => {
    const book = kit.handbook({ sample: true });
    book.open();
    expect(part(book.el, 'entry').length).toBe(4);
    expect(part(book.el, 'group').length).toBe(3);
  });
});
