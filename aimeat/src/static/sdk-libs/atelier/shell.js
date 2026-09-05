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
 *
 *   THE BAR IS WHERE THE KIT MEETS THE TWO PRESENTATION DECISIONS. Light/dark belongs to the
 *   account pill (aimeat-auth's mode switch travels with it), so the shell does not draw that
 *   control: it catches its click on the way down and lets the new theme open from the button
 *   as an iris. Motion is the shell's own switch, beside it. Both write on the root element, so
 *   both reach every component without one of them being told.
 * @structure app(spec) → { el, main, set, status, t, i18n, destroy } · section(spec) ·
 *   tabs(spec) · bottomNav(spec)
 * @usage  const a = AIMEAT.atelier.app({ title: 'Errands', onReady(session) { render(a); } });
 *         a.main.appendChild(view);   // the main element is yours to fill
 * @version-history
 *   v0.47.0 — 2026-09-05 — THE AMBIENT behind the frame (wish-atelier-ambient-visuals): app()
 *     mounts the one layer allowed to move at idle, the look deciding unless `ambient` names a
 *     preset (a string, or { preset, alpha, speed, fps, gl }) and `ambient: false` opting out;
 *     set({ ambient }) changes it later. The WEATHER switch (Off, Calm, Full) stands before the
 *     motion switch while a preset is in force and hides when the look runs none. The handle
 *     carries both as `ambient` and `weather`.
 *   v0.46.0 — 2026-09-02 — The bar carries the kit's transitions: the theme flip opens as an
 *     IRIS from the mode button's own centre (the click is caught in the bar's capture phase and
 *     replayed inside the transition, because the control flips the root the moment it is let
 *     through), set({ look }) changes the look behind a CURTAIN unless the call says
 *     `quiet: true`, and a LESS-MOTION switch stands beside the account pill.
 *   v0.4.0 — 2026-08-28 — The boot gate presents the APP: while login resolves, the status card
 *     is the whole page (centered, main hidden — .ak-app--gate), and the sign-in card carries the
 *     app's own name and its `tagline` before the how-to. The second AEB review met a bare system
 *     sentence floating over 700px of nothing; a first visit is a designed screen now.
 *   v0.3.0 — 2026-08-28 — set({ density }): the comfortable/compact preference as one class over
 *     the tokens (TARGET-074 phase 7). The touch minimum never shrinks with it.
 *   v0.2.0 — 2026-08-28 — The signed-out grace: with requireLogin on and no session, the shell used
 *     to show "Loading…" forever — the first AEB review's worst Atelier finding. Now the loading
 *     state yields to the designed sign-in state after a short grace, and the sign-in state carries
 *     a default hint pointing at the account pill.
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1).
 */
import { el, append, clear, resolve, uid, injectStyle, enter, setMotion, setMotionDefaults } from './dom.js';
import { viewSwap } from './arrive.js';
import { t, i18n } from './i18n.js';
import { emptyState } from './state.js';
import { screenTransition, curtain } from './transitions.js';
import { ambient } from './ambient.js';
import { weather } from './ambient-parts.js';

/** How often the boot poll looks for a session the silent login produced without an event. */
const BOOT_POLL_MS = 300;

/** How long the boot may say "loading" before a signed-out visitor gets the designed sign-in
 * state instead. Long enough for the app-origin silent login to resolve, short enough that a
 * signed-out first visit never reads as a hung page. */
const SIGNIN_GRACE_MS = 2500;

/** The namespace SVG is drawn in: an icon is a shape, never a character from a font. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The mark on the root that says the viewer asked for less motion (dom.js writes it). */
const MOTION_ATTR = 'data-ak-motion';

/** The account pill's own light/dark control, which the shell wraps in an iris. */
const MODE_BUTTON = '#aimeat-mode-switch button[data-mode]';

/**
 * The less-motion switch's words. The kit's dictionary has no key of its own for this yet, so a
 * host that supplies one wins and English is the floor, never the bare key on screen.
 * @returns {string}
 */
function motionLabel() {
  const said = t('lessMotion');
  return said === 'lessMotion' ? 'Less motion' : said;
}

/**
 * The switch's mark: three speed lines, and a stroke through them the stylesheet reveals when
 * the switch is pressed. Drawn in currentColor, so it is the bar's own ink in every look.
 * @returns {SVGElement}
 */
function motionIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const lines = document.createElementNS(SVG_NS, 'path');
  lines.setAttribute('class', 'ak-app__motion-lines');
  lines.setAttribute('d', 'M4 7h15M4 12h11M4 17h7');
  const slash = document.createElementNS(SVG_NS, 'path');
  slash.setAttribute('class', 'ak-app__motion-slash');
  slash.setAttribute('d', 'M20 4 5 20');
  svg.appendChild(lines);
  svg.appendChild(slash);
  return svg;
}

/** Is the kit's own less-motion switch on right now? (The OS setting is a separate voice, and
 *  the switch reports itself, not the operating system.) @returns {boolean} */
function motionIsLess() {
  return document.documentElement.getAttribute(MOTION_ATTR) === 'less';
}

/**
 * @typedef {object} AppHandle
 * @property {HTMLElement} el
 * @property {HTMLElement} main
 * @property {(patch: { title?: string, look?: string, density?: 'comfortable'|'compact',
 *   quiet?: boolean, ambient?: AmbientWish }) => void} set
 * @property {(kind: 'loading'|'ready'|'empty'|'error'|'signin'|'none', opts?: { title?: string, hint?: string, onRetry?: () => void }) => void} status
 * @property {(key: string, vars?: Record<string, any>) => string} t
 * @property {typeof i18n} i18n
 * @property {import('./ambient.js').AmbientHandle|null} ambient  the layer behind the frame (null after `ambient: false`)
 * @property {{ el: HTMLElement }|null} weather  the bar's weather switch
 * @property {() => void} destroy
 */

/**
 * What an app may say about its ambient: a preset id or 'none', false for no layer at all,
 * null or undefined for "the look decides", or the full wish.
 * @typedef {string|false|null|undefined|{ preset?: string|null, alpha?: number, speed?: number,
 *   fps?: number, gl?: boolean, post?: any }} AmbientWish
 */

/**
 * The layer's spec from an app's wish. A string names the preset; an object carries the
 * numbers and the post chain (effects run over the layer's own field); anything else hands
 * the decision to the look.
 * @param {AmbientWish} want
 */
function ambientSpec(want) {
  if (typeof want === 'string') return { preset: want };
  if (want && typeof want === 'object') {
    return {
      preset: want.preset == null ? null : want.preset,
      alpha: want.alpha, speed: want.speed, fps: want.fps, gl: want.gl, post: want.post,
    };
  }
  return { preset: null };
}

/**
 * The app shell.
 * @param {{
 *   target?: string|Element, title: string, tagline?: string, look?: string, footer?: string,
 *   navItems?: Array<{ id: string, label: string, onPick?: (item: any) => void }>,
 *   requireLogin?: boolean, ambient?: AmbientWish, motion?: boolean,
 *   onReady?: (session: any) => void, onLogout?: () => void,
 * }} spec
 *   `motion: false` is the WHOLE opt-out from the kit's default motion for this app: no
 *   entrances, no enter/exit/move on a change, no count-up, no transition between views.
 *   Everything still renders and still works; nothing travels. It is one option because the
 *   alternative — an app remembering to switch off each move — is how a screen ends up half
 *   still. A single block opts out on its own with `motion: false` in its props, and the
 *   viewer's Less-motion switch and the operating system's reduced motion always win over both.
 * @returns {AppHandle}
 */
export function app(spec) {
  injectStyle();

  const state = { title: spec.title, look: spec.look || 'vivid' };
  const titleId = uid('ak-app-title');

  const heading = el('span', { class: 'ak-app__title', id: titleId, text: state.title });
  const pill = el('span', { class: 'ak-app__pill', id: 'login' });

  // The LESS-MOTION switch, beside the account pill's own theme control: one small button, its
  // state in aria-pressed, its words in the title. Everything downstream already asks
  // reducedMotion(), so this one click quiets the whole kit.
  const motionBtn = el('button', {
    type: 'button',
    class: 'ak-app__motion',
    'data-ak-noguard': true,
    'aria-pressed': motionIsLess() ? 'true' : 'false',
    title: motionLabel(),
    'aria-label': motionLabel(),
    on: {
      click: function () { setMotion(motionIsLess() ? 'auto' : 'less'); },
    },
  }, motionIcon());
  // The switch follows the choice rather than owning it: a second control, or the app's own
  // call to setMotion, moves this one too.
  const syncMotion = function () {
    motionBtn.setAttribute('aria-pressed', motionIsLess() ? 'true' : 'false');
  };
  window.addEventListener('ak-motion', syncMotion);

  const bar = el('header', { class: 'ak-app__bar' }, [heading, motionBtn, pill]);

  // THE THEME OPENS AS AN IRIS. The light/dark control is not the shell's: it travels inside
  // the account pill and flips <html data-theme> the instant it is clicked, which is one frame
  // too early for anything to photograph the old screen. So the click is caught here on the way
  // DOWN, held, and replayed inside a screen transition opening from the button's own centre:
  // the control still does the flip, in its own code, one beat later. Under reduced motion
  // screenTransition just runs, and the replay is the plain flip it always was.
  let replaying = false;
  const onBarClick = function (ev) {
    if (replaying) return;
    const start = /** @type {Element|null} */ (ev.target);
    if (!start || typeof start.closest !== 'function') return;
    const btn = /** @type {HTMLElement|null} */ (start.closest(MODE_BUTTON));
    if (!btn || !bar.contains(btn) || btn.getAttribute('aria-pressed') === 'true') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    // The kit's double-click guard has nothing to protect on an instant toggle, and it would
    // read the replay as the repeat it swallows. This is the guard's own opt-out, set on the
    // control the first time it is used.
    btn.setAttribute('data-ak-noguard', '');
    const box = btn.getBoundingClientRect();
    screenTransition('iris', function () {
      replaying = true;
      try { btn.click(); } finally { replaying = false; }
    }, { from: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
  };
  bar.addEventListener('click', onBarClick, true);

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

  // The app's own answer about motion, stamped on the frame rather than kept in a closure: every
  // part built inside it — now or later, by the app or by the mosaic — reads the same mark, and
  // so does the stylesheet.
  if (spec.motion === false) setMotionDefaults(root, false);

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

  // THE AMBIENT: the one layer allowed to move at idle, behind the frame. The look decides (the
  // layer reads the look's tokens) unless the spec names a preset, and `ambient: false` opts
  // the app out. The weather switch stands beside the motion switch only while a preset is in
  // force, so an app whose look runs none shows no control for it.
  let sky = null;
  let weatherCtl = null;
  function syncWeather() {
    if (weatherCtl) weatherCtl.el.hidden = !sky || sky.preset() === 'none';
  }
  /** @param {AmbientWish} want */
  function ensureSky(want) {
    if (!sky) {
      sky = ambient(Object.assign({ target: root }, ambientSpec(want)));
      weatherCtl = weather({ kind: 'cycle' });
      weatherCtl.el.classList.add('ak-app__weather');
      bar.insertBefore(weatherCtl.el, motionBtn);
    } else {
      sky.set(Object.assign({ preset: null, alpha: null, speed: null, post: null }, ambientSpec(want)));
    }
    syncWeather();
  }
  root.addEventListener('ak-ambient-preset', syncWeather);
  if (spec.ambient !== false) ensureSky(spec.ambient);

  /** The current status card, so `status()` swaps rather than stacks. */
  let statusCard = null;
  /** Which designed state is showing, so leaving one for the content is a move rather than a
   *  replacement (a skeleton or a loading line giving way to the real screen). */
  let shownState = null;

  /**
   * Show one designed state (or clear them all with 'none'/'ready'). The states are the kit's,
   * so an Atelier app never ships a grey box or a bare "Error" string.
   * @param {'loading'|'ready'|'empty'|'error'|'signin'|'none'} kind
   * @param {{ title?: string, hint?: string, onRetry?: () => void }} [opts]
   */
  function status(kind, opts) {
    const o = opts || {};
    const leaving = shownState;
    shownState = kind;
    if (statusCard) { statusCard.destroy(); statusCard = null; }
    clear(statusHost);
    if (kind === 'none' || kind === 'ready') {
      statusHost.hidden = true;
      // SKELETON TO CONTENT IS A MOVE, not a replacement. The app fills `main` right after this
      // call returns (status('ready') then render is the shape every Atelier app is written in),
      // so the entrance is queued for the next frame, when what it is choreographing exists.
      if (leaving && leaving !== 'ready' && leaving !== 'none' && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () { enter(main); });
      }
      return;
    }
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
      // The sign-in card PRESENTS THE APP: its own name as the title and, when the app gave one,
      // its tagline before the how-to — a first visitor learns what this is, not only that a
      // login exists. (The second AEB review met a bare system sentence on an empty page.)
      signin: {
        title: o.title || state.title,
        hint: o.hint != null ? o.hint
          : (spec.tagline ? spec.tagline + ' ' : '') + t('signIn') + ' ' + t('signInHint'),
      },
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
      root.classList.remove('ak-app--gate');
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
          root.classList.add('ak-app--gate');
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
    // While the boot gate is up the status card IS the page: centered, with the empty main
    // hidden, so a signed-out first visit is a designed screen rather than a card floating over
    // 700px of nothing (the second AEB review's words).
    root.classList.add('ak-app--gate');
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
    motionBtn.setAttribute('title', motionLabel());
    motionBtn.setAttribute('aria-label', motionLabel());
  });

  // Deferred one tick ON PURPOSE: with requireLogin off — or a session already live when app()
  // is called — a synchronous boot would fire onReady before app() has RETURNED, and the host's
  // handle variable is still undefined inside its own onReady. The browser gate caught exactly
  // that on the first verification run.
  setTimeout(startBoot, 0);

  return {
    el: root,
    main: main,

    /** @param {{ title?: string, look?: string, density?: 'comfortable'|'compact',
     *    quiet?: boolean, ambient?: AmbientWish }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) { state.title = patch.title; heading.textContent = state.title; }
      // The ambient follows the same door as the constructor: false switches the layer to
      // none, a preset or a wish overrides the look, null hands the decision back to it.
      if ('ambient' in patch) {
        if (patch.ambient === false) { if (sky) { sky.set({ preset: 'none' }); syncWeather(); } }
        else ensureSky(patch.ambient);
      }
      if (patch.look != null && patch.look !== state.look) {
        state.look = patch.look;
        const dress = function () { root.setAttribute('data-ak-look', state.look); };
        // A LOOK is the whole surface changing its mind at once: face, colours, corners and
        // pace. Seen half-done it reads as a page breaking, so the halves close over it, the
        // attribute changes behind them, and they part on the new look. `quiet: true` is the way
        // out for an app changing the look while nobody is looking at the result.
        if (patch.quiet) { dress(); } else {
          const cover = curtain({ kind: 'halves', colour: 'accent' });
          cover.cover()
            .then(dress)
            .then(function () { return cover.uncover(); })
            .then(function () { cover.destroy(); }, function (err) { cover.destroy(); throw err; });
        }
      }
      // Density is token-driven, so it is free: compact tightens padding and gaps while the
      // touch minimum stays untouched — a preference, never an accessibility trade.
      if (patch.density != null) root.classList.toggle('ak-app--compact', patch.density === 'compact');
    },

    status: status,
    t: t,
    i18n: i18n,
    get ambient() { return sky; },
    get weather() { return weatherCtl; },

    destroy() {
      stopLang();
      window.removeEventListener('ak-motion', syncMotion);
      root.removeEventListener('ak-ambient-preset', syncWeather);
      if (sky) sky.destroy();
      if (weatherCtl) weatherCtl.destroy();
      bar.removeEventListener('click', onBarClick, true);
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
 * A tab row. Reports the pick; the host swaps the view — inside the kit's screen transition, so
 * the swap is SEEN as a change without the host asking for it. `transition` names another move
 * (slide, wipe, zoom, iris, curtain); the app's `motion: false` and reduced motion collapse it.
 * @param {{
 *   target?: string|Element, items: Array<{ id: string, label: string }>,
 *   value?: string, onChange?: (id: string) => void,
 *   transition?: 'fade'|'wipe'|'curtain'|'zoom'|'iris'|'slide',
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
            // A TAB CHANGE IS A SCREEN CHANGE, and the kit makes it look like one without being
            // asked. The host's onChange is what swaps the view, so it runs INSIDE the
            // transition: the browser crosses the old screen into the new one where it has View
            // Transitions, the kit's curtain does it where it does not, and under reduced motion
            // or an opt-out it is the plain swap it always was.
            viewSwap(function () {
              state.value = item.id;
              render();
              if (spec.onChange) spec.onChange(item.id);
            }, { kind: spec.transition, node: root });
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
 * var(--aimeat-chrome-bottom), so it never sits under the injected controls). A pick runs inside
 * the kit's screen transition, the same as a tab.
 * @param {{
 *   target?: string|Element, items: Array<{ id: string, label: string, onPick?: (item: any) => void }>,
 *   value?: string, transition?: 'fade'|'wipe'|'curtain'|'zoom'|'iris'|'slide',
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
            if (item.id === state.value) { if (item.onPick) item.onPick(item); return; }
            // The bottom bar changes the screen exactly as the tabs do, and gets the same move.
            viewSwap(function () {
              state.value = item.id;
              render();
              if (item.onPick) item.onPick(item);
            }, { kind: spec.transition, node: root });
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
