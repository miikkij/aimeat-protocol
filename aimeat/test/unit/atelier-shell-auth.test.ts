/**
 * @file test/unit/atelier-shell-auth.test.ts
 * @description Exercise the Atelier shell's public and private session transitions.
 * @version-history
 *   v1.0.0 - 2026-09-09 - Cover stale-session logout, explicit logout and private re-login.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let app: (spec: any) => any;
let handle: any;
let session: any;
let callbacks: { onLogin: () => void; onLogout: () => void };

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  ({ app } = await import('../../src/static/sdk-libs/atelier/shell.js'));
});

beforeEach(() => {
  vi.useFakeTimers();
  session = null;
  (window as any).AIMEAT = { auth: {
    getSession: () => session,
    mountLoginButton: (_pill: any, handlers: typeof callbacks) => { callbacks = handlers; },
  } };
});

afterEach(() => {
  handle?.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
});
afterAll(() => restore());

function mount(requireLogin?: boolean) {
  const onReady = vi.fn();
  const onLogout = vi.fn();
  handle = app({ title: 'Session example', requireLogin, ambient: false, motion: false, onReady, onLogout });
  vi.advanceTimersByTime(1);
  return { onReady, onLogout };
}

describe('Atelier shell session transitions', () => {
  it.each(['stale stored session', 'explicit logout'])('keeps a public app open after %s', (reason) => {
    if (reason === 'explicit logout') session = { jwt: 'test-session' };
    const { onReady, onLogout } = mount(false);
    const content = document.createElement('button');
    content.textContent = 'Browse public content';
    handle.main.appendChild(content);
    session = null;
    callbacks.onLogout();
    vi.advanceTimersByTime(3000);
    expect(handle.el.classList.contains('ak-app--gate')).toBe(false);
    expect(handle.el.querySelector('.ak-app__status').hidden).toBe(true);
    expect(handle.main.contains(content)).toBe(true);
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, undefined])('gates a private app and boots again after login (requireLogin=%s)', (required) => {
    session = { jwt: 'first-session' };
    const { onReady, onLogout } = mount(required);
    expect(handle.el.classList.contains('ak-app--gate')).toBe(false);
    session = null;
    callbacks.onLogout();
    expect(handle.el.classList.contains('ak-app--gate')).toBe(true);
    expect(handle.el.querySelector('.ak-app__status').hidden).toBe(false);
    expect(onLogout).toHaveBeenCalledTimes(1);
    session = { jwt: 'second-session' };
    callbacks.onLogin();
    expect(handle.el.classList.contains('ak-app--gate')).toBe(false);
    expect(handle.el.querySelector('.ak-app__status').hidden).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenLastCalledWith(session);
  });
});
