/**
 * @file test/unit/atelier-frames.test.ts
 * @description The two frames app({ frame }) names (shell-frames.js): a stage whose surface is the
 *   handle's `main` and whose controls panel folds, a reading column, the default frame left as it
 *   was, and the side-navigation frame keeping its own answer.
 * @version-history
 *   v1.0.0 - 2026-11-27 - Initial (wish-atelier-contextual-templates-pyynt-lohko-ask).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let app: (spec: any) => any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  ({ app } = await import('../../src/static/sdk-libs/atelier/shell.js'));
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
const press = (node: any) => node.dispatchEvent({ type: 'click', bubbles: true });

describe('app({ frame })', () => {
  it('leaves an app that names no frame as it was', () => {
    const a = app({ title: 'Plain', ambient: false, motion: false });
    try {
      expect(a.el.classList.contains('ak-app--stage')).toBe(false);
      expect(a.el.classList.contains('ak-app--reading')).toBe(false);
      expect(a.el.attrs['data-ak-frame']).toBeUndefined();
      expect(a.main.classList.contains('ak-app__main')).toBe(true);
      expect(a.controls).toBeNull();
      expect(a.stage).toBeNull();
    } finally { a.destroy(); }
  });

  it('makes the surface the main region of a stage and gives one panel for the controls', () => {
    const a = app({ title: 'Terrain', frame: 'stage', controls: { title: 'Layers' }, ambient: false, motion: false });
    try {
      expect(a.el.classList.contains('ak-app--stage')).toBe(true);
      expect(a.el.attrs['data-ak-frame']).toBe('stage');
      expect(a.main.classList.contains('ak-stage__surface')).toBe(true);
      expect(find(a.el, 'ak-app__main').contains(a.main)).toBe(true);
      expect(a.controls.classList.contains('ak-stage__body')).toBe(true);
      const panel = find(a.el, 'ak-stage__panel');
      const handle = find(a.el, 'ak-stage__handle');
      expect(find(a.el, 'ak-stage__title').textContent).toBe('Layers');
      expect(panel.attrs['data-ak-open']).toBe('true');
      expect(handle.attrs['aria-controls']).toBe(a.controls.attrs.id);
      press(handle);
      expect(panel.attrs['data-ak-open']).toBe('false');
      expect(handle.attrs['aria-expanded']).toBe('false');
      a.stage.setOpen(true);
      expect(panel.attrs['data-ak-open']).toBe('true');
      a.stage.setTitle('Tasot');
      expect(find(a.el, 'ak-stage__title').textContent).toBe('Tasot');
    } finally { a.destroy(); }
  });

  it('builds no panel for a stage that asked for none, and can start one folded', () => {
    const bare = app({ title: 'Bare', frame: 'stage', ambient: false, motion: false });
    const folded = app({ title: 'Folded', frame: 'stage', controls: { open: false }, ambient: false, motion: false });
    try {
      expect(find(bare.el, 'ak-stage__panel')).toBeNull();
      expect(bare.controls).toBeNull();
      expect(find(folded.el, 'ak-stage__panel').attrs['data-ak-open']).toBe('false');
    } finally { bare.destroy(); folded.destroy(); }
  });

  it('marks a reading frame and keeps the main region', () => {
    const a = app({ title: 'Essay', frame: 'reading', ambient: false, motion: false });
    try {
      expect(a.el.classList.contains('ak-app--reading')).toBe(true);
      expect(a.main.classList.contains('ak-app__main')).toBe(true);
      expect(a.controls).toBeNull();
    } finally { a.destroy(); }
  });

  it('says an unknown frame in the console and draws the default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = app({ title: 'Typo', frame: 'stag', ambient: false, motion: false });
    try {
      expect(warn).toHaveBeenCalled();
      expect(a.el.attrs['data-ak-frame']).toBeUndefined();
    } finally { a.destroy(); warn.mockRestore(); }
  });

  it('does not read the frame for a side-navigation app', () => {
    const a = app({ title: 'Tool', nav: 'side', navItems: [{ id: 'home', label: 'Home' }], frame: 'stage', ambient: false, motion: false });
    try {
      expect(a.el.classList.contains('ak-app--sidenav')).toBe(true);
      expect(a.el.classList.contains('ak-app--stage')).toBe(false);
      expect(a.main.classList.contains('ak-app__main')).toBe(true);
    } finally { a.destroy(); }
  });
});
