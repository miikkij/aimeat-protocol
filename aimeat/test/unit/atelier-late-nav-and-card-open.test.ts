/**
 * @file test/unit/atelier-late-nav-and-card-open.test.ts
 * @description Two Atelier kit traps from the migrations onto the kit (appdev pitfall
 *   atelier/atelier-kit-migration-traps):
 *   (1) app({ nav: 'side' }) made with no entries yet had a null `nav`, so the side column could
 *       never be built later. Its first nav.set({ items }) builds the column and the phone bar now.
 *   (4) kanban had no card-open callback, and cards were focusable only with onMove. onOpen(card)
 *       runs on a click, Enter or Space, and makes the card a focusable button.
 *
 *   FIRST FAIL: against kit 0.70.0 `nav` is null and a card has no tabindex and opens nothing.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let app: (spec: any) => any;
let kanban: (spec: any) => any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  ({ app } = await import('../../src/static/sdk-libs/atelier/shell.js'));
  ({ kanban } = await import('../../src/static/sdk-libs/atelier/planner.js'));
});
afterAll(() => restore());
beforeEach(() => {
  vi.useFakeTimers();
  (window as any).AIMEAT = { auth: { getSession: () => null, mountLoginButton: () => {} } };
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const find = (root: any, cls: string) => root.querySelector('.' + cls);

describe('a side-navigation app made before its entries exist', () => {
  it('builds the side column and the bar on the first nav.set({ items })', () => {
    const a = app({ title: 'Late nav', nav: 'side', navItems: [], ambient: false, motion: false });
    try {
      expect(a.nav).not.toBeNull();
      expect(find(a.el, 'ak-app__side')).toBeNull();
      a.nav.set({ items: [{ id: 'home', label: 'Home' }, { id: 'list', label: 'List' }], value: 'list' });
      expect(find(a.el, 'ak-app__side')).not.toBeNull();
      expect(a.el.classList.contains('ak-app--sidenav')).toBe(true);
      expect(find(a.el, 'ak-app__frame').contains(a.main)).toBe(true);
      expect(a.el.classList.contains('ak-app--bottomnav')).toBe(true);
      // A later set changes the mark, as on an app made with its entries.
      a.nav.set({ value: 'home' });
    } finally { a.destroy(); }
  });

  it('ignores a set with no entries and keeps the page as it was', () => {
    const a = app({ title: 'Late nav', nav: 'side', ambient: false, motion: false });
    try {
      a.nav.set({ value: 'x' });
      expect(find(a.el, 'ak-app__side')).toBeNull();
    } finally { a.destroy(); }
  });

  it('keeps nav null for an app without side navigation and without entries, as before', () => {
    const a = app({ title: 'No nav', ambient: false, motion: false });
    try { expect(a.nav).toBeNull(); } finally { a.destroy(); }
  });
});

describe('kanban onOpen', () => {
  const data = { columns: [{ id: 'todo', label: 'To do' }], cards: [{ id: 'c1', column: 'todo', title: 'Order flour' }] };

  it('opens a card on a click and on Enter, and makes it a focusable button without onMove', () => {
    const onOpen = vi.fn();
    const host = document.createElement('div');
    const k = kanban({ target: host, data, onOpen });
    const card = k.el.querySelector('[data-card="c1"]');
    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.getAttribute('role')).toBe('button');
    card.click();
    card.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ id: 'c1' });
    k.destroy();
  });

  it('leaves a board without onOpen and onMove unfocusable, as before', () => {
    const host = document.createElement('div');
    const k = kanban({ target: host, data });
    expect(k.el.querySelector('[data-card="c1"]').getAttribute('tabindex')).toBeNull();
    k.destroy();
  });
});
