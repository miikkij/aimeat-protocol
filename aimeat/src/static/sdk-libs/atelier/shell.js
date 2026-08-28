/**
 * @file atelier/shell.js
 * @description The Atelier app shell and its navigation pieces. `app(spec)` is the one call that
 *   eats the ceremony every app used to copy: the stylesheet, the top bar with the login-pill
 *   mount, the single scrolling main region with the bottom chrome strip reserved, the designed
 *   loading/empty/error/sign-in states, the login boot (mount + poll, because the app-origin
 *   silent login resolves async and may never call onLogin), and the language re-render hook.
 *
 *   THE SHELL RENDERS AND WIRES; IT DOES NOT FETCH. The auth library is used only when the host
 *   page loaded it (feature-detected on window.AIMEAT.auth) — the shell itself makes no network
 *   call and holds no credentials. An app that skips aimeat-auth still gets the frame and the
 *   states; it just boots with a null session when `requireLogin` is off.
 *
 *   MOBILE SAFETY IS STRUCTURAL. The main region is the only scroller, the page never scrolls
 *   horizontally, fixed bottom UI and the scroller both reserve var(--aimeat-chrome-bottom), and
 *   every interactive element the shell renders meets the touch minimum — all of it in the
 *   stylesheet, none of it the app's to remember.
 * @structure app(spec) → { el, main, set, status, t, i18n, destroy } · section(spec) ·
 *   tabs(spec) · bottomNav(spec)
 * @usage  const a = AIMEAT.atelier.app({ title: 'Errands', onReady(session) { render(a); } });
 *         a.main.appendChild(view);   // the main element is yours to fill
 * @version-history
 *   v0.3.0 — 2026-08-28 — set({ density }): the comfortable/compact preference as one class over
 *     the tokens (TARGET-074 phase 7). The touch minimum never shrinks with it.
 *   v0.2.0 — 2026-08-28 — The signed-out grace: with requireLogin on and no session, the shell used
 *     to show "Loading…" forever — the first AEB review's worst Atelier finding. Now the loading
 *     state yields to the designed sign-in state after a short grace, and the sign-in state carries
 *     a default hint pointing at the account pill.
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1).
 */
import { el, append, clear, resolve, uid, injectStyle, enter } from './dom.js';
import { t, i18n } from './i18n.js';
import { emptyState } from './state.js';

/** How often the boot poll looks for a session the silent login produced without an event. */
const BOOT_POLL_MS = 300;

/** How long the boot may say "loading" before a signed-out visitor gets the designed sign-in
 * state instead. Long enough for the app-origin silent login to resolve, short enough that a
 * signed-out first visit never reads as a hung page. */
const SIGNIN_GRACE_MS = 2500;

/**
 * @typedef {object} AppHandle
 * @property {HTMLElement} el
 * @property {HTMLElement} main
 * @property {(patch: { title?: string, look?: string }) => void} set
 * @property {(kind: 'loading'|'ready'|'empty'|'error'|'signin'|'none', opts?: { title?: string, hint?: string, onRetry?: () => void }) => void} status
 * @property {(key: string, vars?: Record<string, any>) => string} t
 * @property {typeof i18n} i18n
 * @property {() => void} destroy
 */

/**
 * The app shell.
 * @param {{
 *   target?: string|Element, title: string, look?: string, footer?: string,
 *   navItems?: Array<{ id: string, label: string, onPick?: (item: any) => void }>,
 *   requireLogin?: boolean,
 *   onReady?: (session: any) => void, onLogout?: () => void,
 * }} spec
 * @returns {AppHandle}
 */
export function app(spec) {
  injectStyle();

  const state = { title: spec.title, look: spec.look || 'vivid' };
  const titleId = uid('ak-app-title');

  const heading = el('span', { class: 'ak-app__title', id: titleId, text: state.title });
  const pill = el('span', { class: 'ak-app__pill', id: 'login' });
  const bar = el('header', { class: 'ak-app__bar' }, [heading, pill]);

  const statusHost = el('div', { class: 'ak-app__status' });
  const main = el('main', { class: 'ak-app__main ak-scroll' });
  const footer = spec.footer != null
    ? el('footer', { class: 'ak-app__foot', text: spec.footer })
    : null;

  const root = el('div', {
    class: 'ak-root ak-app',
    'data-ak-look': state.look,
    'aria-labelledby': titleId,
  }, [bar, statusHost, main, footer]);

  let nav = null;
  if (spec.navItems && spec.navItems.length) {
    nav = bottomNav({ items: spec.navItems });
    root.appendChild(nav.el);
    root.classList.add('ak-app--bottomnav');
  }

  const mount = resolve(spec.target, document.body);
  mount.appendChild(root);
  // A full-frame app owns the page: without this the browser's default body margin leaves an
  // 8px gutter around the frame (found by the first real-browser run — no preflight resets it
  // on this track, because the kit is the only stylesheet).
  const fullFrame = mount === document.body;
  if (fullFrame) document.body.classList.add('ak-body');

  /** The current status card, so `status()` swaps rather than stacks. */
  let statusCard = null;

  /**
   * Show one designed state (or clear them all with 'none'/'ready'). The states are the kit's,
   * so an Atelier app never ships a grey box or a bare "Error" string.
   * @param {'loading'|'ready'|'empty'|'error'|'signin'|'none'} kind
   * @param {{ title?: string, hint?: string, onRetry?: () => void }} [opts]
   */
  function status(kind, opts) {
    const o = opts || {};
    if (statusCard) { statusCard.destroy(); statusCard = null; }
    clear(statusHost);
    if (kind === 'none' || kind === 'ready') { statusHost.hidden = true; return; }
    statusHost.hidden = false;
    if (kind === 'loading') {
      statusHost.appendChild(el('div', { class: 'ak-loading', role: 'status', 'aria-live': 'polite' }, [
        el('span', { class: 'ak-loading__pulse', 'aria-hidden': 'true' }),
        el('span', { text: o.title || t('loading') }),
      ]));
      return;
    }
    const kinds = {
      empty: { title: o.title || t('empty'), hint: o.hint || t('emptyHint') },
      error: { title: o.title || t('loadFailed'), hint: o.hint || t('loadFailedHint') },
      signin: { title: o.title || t('signIn'), hint: o.hint != null ? o.hint : t('signInHint') },
    };
    const chosen = kinds[kind] || kinds.error;
    statusCard = emptyState({
      target: statusHost,
      tone: kind === 'error' ? 'error' : 'quiet',
      title: chosen.title,
      hint: chosen.hint,
      action: kind === 'error' && o.onRetry ? { label: t('retry'), onClick: o.onRetry } : null,
    });
  }

  // ── Login boot ─────────────────────────────────────────────────────────────────────────────
  // Mount the pill when the auth library is on the page, then poll: the app-origin silent login
  // resolves asynchronously and may never fire onLogin, so a poll is the only boot that always
  // catches the session. Booting is once; logout re-arms it.
  const requireLogin = spec.requireLogin !== false;
  let booted = false;
  let pollTimer = null;
  let graceTimer = null;

  function auth() {
    const ns = /** @type {any} */ (window).AIMEAT;
    return ns && ns.auth ? ns.auth : null;
  }

  function tryBoot() {
    if (booted) return;
    const a = auth();
    const session = a && typeof a.getSession === 'function' ? a.getSession() : null;
    if (session && session.jwt) {
      booted = true;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
      status('none');
      if (spec.onReady) spec.onReady(session);
    }
  }

  function startBoot() {
    const a = auth();
    if (a && typeof a.mountLoginButton === 'function') {
      a.mountLoginButton(pill, {
        onLogin: function () { tryBoot(); },
        onLogout: function () {
          booted = false;
          status('signin');
          if (spec.onLogout) spec.onLogout();
          armPoll();
        },
      });
    }
    if (!requireLogin) {
      booted = true;
      status('none');
      if (spec.onReady) spec.onReady(a && a.getSession ? a.getSession() : null);
      return;
    }
    status('loading');
    armPoll();
    tryBoot();
    // A signed-out visitor is a STATE, not an endless load: when the silent login has produced
    // nothing by the end of the grace, show the designed sign-in card. The poll keeps running,
    // so a login through the pill still boots the app the moment it lands.
    graceTimer = setTimeout(function () {
      graceTimer = null;
      if (!booted) status('signin');
    }, SIGNIN_GRACE_MS);
  }

  function armPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      tryBoot();
      if (booted && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }, BOOT_POLL_MS);
  }

  const stopLang = i18n.onChange(function () {
    heading.textContent = state.title;
  });

  // Deferred one tick ON PURPOSE: with requireLogin off — or a session already live when app()
  // is called — a synchronous boot would fire onReady before app() has RETURNED, and the host's
  // handle variable is still undefined inside its own onReady. The browser gate caught exactly
  // that on the first verification run.
  setTimeout(startBoot, 0);

  return {
    el: root,
    main: main,

    /** @param {{ title?: string, look?: string, density?: 'comfortable'|'compact' }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) { state.title = patch.title; heading.textContent = state.title; }
      if (patch.look != null) { state.look = patch.look; root.setAttribute('data-ak-look', state.look); }
      // Density is token-driven, so it is free: compact tightens padding and gaps while the
      // touch minimum stays untouched — a preference, never an accessibility trade.
      if (patch.density != null) root.classList.toggle('ak-app--compact', patch.density === 'compact');
    },

    status: status,
    t: t,
    i18n: i18n,

    destroy() {
      stopLang();
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
      if (statusCard) statusCard.destroy();
      if (nav) nav.destroy();
      if (fullFrame) document.body.classList.remove('ak-body');
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * A titled surface — and the ESCAPE HATCH: whatever the catalogue cannot express goes inside a
 * section as the app's own markup, so custom work stays inside a frame that still carries the
 * card surface, the measure cap and the entrance.
 * @param {{ target?: string|Element, title?: string, hint?: string, body?: any, flush?: boolean }} spec
 * @returns {{ el: HTMLElement, body: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function section(spec) {
  const s = spec || {};
  const heading = s.title != null ? el('h2', { class: 'ak-section__title', text: s.title }) : null;
  const hint = s.hint != null ? el('p', { class: 'ak-section__hint', text: s.hint }) : null;
  const body = el('div', { class: 'ak-section__body' });
  if (s.body != null) append(body, s.body);
  const root = el('section', {
    class: 'ak-root ak-section' + (s.flush ? ' ak-section--flush' : ''),
  }, [heading, hint, body]);
  if (s.target) resolve(s.target).appendChild(root);
  enter(body);
  return {
    el: root,
    body: body,
    /** @param {{ title?: string, hint?: string, body?: any }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null && heading) heading.textContent = patch.title;
      if (patch.hint != null && hint) hint.textContent = patch.hint;
      if (patch.body !== undefined) { clear(body); append(body, patch.body); }
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * A tab row. Reports the pick; the host swaps the view.
 * @param {{
 *   target?: string|Element, items: Array<{ id: string, label: string }>,
 *   value?: string, onChange?: (id: string) => void,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { value?: string, items?: any[] }) => void, destroy: () => void }}
 */
export function tabs(spec) {
  const state = { items: spec.items || [], value: spec.value || (spec.items && spec.items[0] ? spec.items[0].id : '') };
  const root = el('div', { class: 'ak-root ak-tabs', role: 'tablist' });
  if (spec.target) resolve(spec.target).appendChild(root);

  function render() {
    clear(root);
    for (const item of state.items) {
      const active = item.id === state.value;
      root.appendChild(el('button', {
        type: 'button',
        class: 'ak-tab' + (active ? ' ak-tab--active' : ''),
        role: 'tab',
        'aria-selected': active ? 'true' : 'false',
        'data-ak-noguard': true,
        on: {
          click: function () {
            if (item.id === state.value) return;
            state.value = item.id;
            render();
            if (spec.onChange) spec.onChange(item.id);
          },
        },
      }, item.label));
    }
  }
  render();

  return {
    el: root,
    /** @param {{ value?: string, items?: Array<{ id: string, label: string }> }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.items) state.items = patch.items;
      if (patch.value != null) state.value = patch.value;
      render();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * The bottom navigation bar — fixed above the node's chrome strip (the stylesheet reserves
 * var(--aimeat-chrome-bottom), so it never sits under the injected controls).
 * @param {{
 *   target?: string|Element, items: Array<{ id: string, label: string, onPick?: (item: any) => void }>,
 *   value?: string,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { value?: string, items?: any[] }) => void, destroy: () => void }}
 */
export function bottomNav(spec) {
  const state = { items: spec.items || [], value: spec.value || '' };
  const root = el('nav', { class: 'ak-root ak-bottomnav' });
  if (spec.target) resolve(spec.target).appendChild(root);

  function render() {
    clear(root);
    for (const item of state.items) {
      const active = item.id === state.value;
      root.appendChild(el('button', {
        type: 'button',
        class: 'ak-bottomnav__item' + (active ? ' ak-bottomnav__item--active' : ''),
        'aria-current': active ? 'page' : null,
        'data-ak-noguard': true,
        on: {
          click: function () {
            state.value = item.id;
            render();
            if (item.onPick) item.onPick(item);
          },
        },
      }, item.label));
    }
  }
  render();

  return {
    el: root,
    /** @param {{ value?: string, items?: any[] }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.items) state.items = patch.items;
      if (patch.value != null) state.value = patch.value;
      render();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
