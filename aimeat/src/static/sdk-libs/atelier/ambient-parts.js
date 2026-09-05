/**
 * @file atelier/ambient-parts.js
 * @description The three things an app puts on a page around the ambient layer:
 *
 *     ambientStage  a section that carries its own ambient behind its content — a hero, one
 *                   band, a card that wants weather without the whole page having it;
 *     weather       the visible control: Off, Calm, Full. One bar button that cycles (the
 *                   shell puts it beside the Less-motion switch) or a three-way radio group
 *                   for a settings screen. Both call setWeather() and follow 'ak-ambient', so
 *                   two controls on one page agree;
 *     attract       the mode a console falls into when nobody touches it: after a while without
 *                   a hand the working surface dims and the ambient rises; the first pointer,
 *                   key, wheel, touch or scroll brings it back. Never armed under reduced
 *                   motion, because a screen that changes on its own is what that setting asks
 *                   not to have.
 *
 *   Every colour, size and duration is the contract's (ambient.css reads the tokens); the
 *   words are the kit's own strings in en/fi/es (i18n.js).
 * @structure ambientStage(spec) · weather(spec) · attract(spec)
 * @usage
 *   const band = AIMEAT.atelier.ambientStage({ target: main, preset: 'ink', body: heroEl });
 *   const sw = AIMEAT.atelier.weather({ target: bar, kind: 'cycle' });
 *   const idle = AIMEAT.atelier.attract({ app: a, after: 60000 });
 * @version-history
 *   v0.48.0 — 2026-09-05 — A stage carries a `post` chain to its layer, in the spec and in
 *     set() (wish-atelier-post-process-effects, stage 3).
 *   v0.47.0 — 2026-09-05 — Initial (wish-atelier-ambient-visuals, stage 3).
 */
import { el, append, resolve, reducedMotion, injectStyle, enter } from './dom.js';
import { i18n, t } from './i18n.js';
import { ambient, setWeather, weatherLevel } from './ambient.js';

const LEVELS = ['off', 'calm', 'full'];
const WORDS = { off: 'ambientOff', calm: 'ambientCalm', full: 'ambientFull' };
const SVG_NS = 'http://www.w3.org/2000/svg';

// ── The stage ────────────────────────────────────────────────────────────────────────────────

/**
 * A section with its own ambient behind its content. With no preset the stage's look (its
 * own `look`, or the enclosing one) decides, exactly as the app frame does.
 * @param {{ target?: string|Element, preset?: string|null, alpha?: number, speed?: number,
 *   gl?: boolean, post?: any, look?: string, minHeight?: string, body?: any }} spec
 * @returns {{ el: HTMLElement, body: HTMLElement, ambient: import('./ambient.js').AmbientHandle,
 *   set: (patch: any) => void, destroy: () => void }}
 */
export function ambientStage(spec) {
  const s = spec || {};
  injectStyle();
  const body = el('div', { class: 'ak-ambient-stage__body' });
  if (s.body != null) append(body, s.body);
  const root = el('section', {
    class: 'ak-root ak-ambient-stage',
    'data-ak-look': s.look || null,
    vars: s.minHeight ? { '--ak-ambient-stage-min': s.minHeight } : null,
  }, [body]);
  const host = resolve(s.target, document.body);
  host.appendChild(root);
  const sky = ambient({
    target: root, preset: s.preset == null ? null : s.preset,
    alpha: s.alpha, speed: s.speed, gl: s.gl, post: s.post,
  });
  enter(body);
  return {
    el: root,
    body,
    ambient: sky,
    /** @param {{ preset?: string|null, alpha?: number|null, speed?: number|null, post?: any, look?: string }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.look != null) root.setAttribute('data-ak-look', patch.look);
      if ('preset' in patch || 'alpha' in patch || 'speed' in patch || 'post' in patch) sky.set(patch);
    },
    destroy() {
      sky.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

// ── The weather switch ───────────────────────────────────────────────────────────────────────

/** The three-wave mark; the level lights one, all, or none of them (ambient.css). */
function waveIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'ak-weather__icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const y of [5, 10, 15]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('class', 'ak-weather__wave');
    p.setAttribute('d', 'M2 ' + y + ' c2 -2.4 4 -2.4 6 0 s4 2.4 6 0 s2 -1.6 4 -1.4');
    svg.appendChild(p);
  }
  return svg;
}

/** @param {string} level */
function levelLabel(level) {
  return t('ambient') + ': ' + t(WORDS[level] || WORDS.full);
}

/**
 * The visible weather control.
 * @param {{ target?: string|Element, kind?: 'cycle'|'segments' }} [spec]
 * @returns {{ el: HTMLElement, level: () => string, set: (level: string) => void, destroy: () => void }}
 */
export function weather(spec) {
  const s = spec || {};
  injectStyle();
  const kind = s.kind === 'segments' ? 'segments' : 'cycle';
  let root;
  /** @type {HTMLElement[]} */
  const segs = [];
  let word = null;

  function paint() {
    const level = weatherLevel();
    root.setAttribute('data-ak-level', level);
    if (kind === 'cycle') {
      root.setAttribute('aria-label', levelLabel(level));
      root.setAttribute('title', levelLabel(level));
      if (word) word.textContent = t(WORDS[level]);
    } else {
      root.setAttribute('aria-label', t('ambient'));
      segs.forEach(function (b, i) {
        b.setAttribute('aria-checked', LEVELS[i] === level ? 'true' : 'false');
        b.setAttribute('tabindex', LEVELS[i] === level ? '0' : '-1');
        b.textContent = t(WORDS[LEVELS[i]]);
      });
    }
  }

  if (kind === 'cycle') {
    word = el('span', { class: 'ak-weather__word' });
    root = el('button', {
      type: 'button',
      class: 'ak-weather ak-weather--cycle',
      'data-ak-noguard': true,
      on: {
        click: function () {
          const i = LEVELS.indexOf(weatherLevel());
          setWeather(/** @type {any} */ (LEVELS[(i + 1) % LEVELS.length]));
        },
      },
    }, [waveIcon(), word]);
  } else {
    root = el('div', { class: 'ak-weather ak-weather--segments', role: 'radiogroup' });
    for (const level of LEVELS) {
      const b = el('button', {
        type: 'button', role: 'radio', class: 'ak-weather__seg', 'data-ak-noguard': true,
        on: {
          click: function () { setWeather(/** @type {any} */ (level)); },
          keydown: function (ev) {
            const i = LEVELS.indexOf(level);
            if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { setWeather(/** @type {any} */ (LEVELS[(i + 1) % 3])); segs[(i + 1) % 3].focus(); ev.preventDefault(); }
            if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { setWeather(/** @type {any} */ (LEVELS[(i + 2) % 3])); segs[(i + 2) % 3].focus(); ev.preventDefault(); }
          },
        },
      });
      segs.push(b);
      root.appendChild(b);
    }
  }
  paint();
  const stopLang = i18n.onChange(paint);
  window.addEventListener('ak-ambient', paint);
  if (s.target) resolve(s.target, document.body).appendChild(root);

  return {
    el: root,
    level: weatherLevel,
    /** @param {string} level */
    set(level) { setWeather(/** @type {any} */ (level)); },
    destroy() {
      stopLang();
      window.removeEventListener('ak-ambient', paint);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

// ── Attract mode ─────────────────────────────────────────────────────────────────────────────

const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

/**
 * After `after` ms without input the app dims its working surface and lets the ambient rise;
 * any input restores it and re-arms the timer. Does nothing under reduced motion.
 * @param {{ app: { el: HTMLElement, main?: HTMLElement, ambient?: import('./ambient.js').AmbientHandle },
 *   after?: number, dim?: number, rise?: number }} spec
 * @returns {{ arm: () => void, disarm: () => void, active: () => boolean, destroy: () => void }}
 */
export function attract(spec) {
  const s = spec || /** @type {any} */ ({});
  const app = s.app;
  if (!app || !app.el) throw new Error('attract needs the app handle (the frame it dims)');
  const after = s.after > 0 ? s.after : 60000;
  const dim = s.dim != null ? Math.min(1, Math.max(0, s.dim)) : 0.35;
  const rise = s.rise != null ? Math.min(1, Math.max(0, s.rise)) : 1;
  let timer = 0;
  let on = false;
  let lastInput = 0;
  /** The alpha the app had chosen itself, so leaving attract puts it back; null = the look's. */
  let saved = null;
  let destroyed = false;

  function engage() {
    timer = 0;
    if (on || destroyed || reducedMotion()) return;
    on = true;
    app.el.setAttribute('data-ak-attract', 'on');
    app.el.style.setProperty('--ak-attract-dim', String(dim));
    const sky = app.ambient;
    if (sky && sky.set && sky.stats) {
      const st = sky.stats();
      saved = st.alphaSource === 'option' ? st.alpha : null;
      sky.set({ alpha: rise });
    }
  }

  function disengage() {
    if (!on) return;
    on = false;
    app.el.removeAttribute('data-ak-attract');
    const sky = app.ambient;
    if (sky && sky.set) sky.set({ alpha: saved });
    saved = null;
  }

  function arm() {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (destroyed || reducedMotion()) return;
    timer = setTimeout(engage, after);
  }

  function onInput() {
    const now = Date.now();
    if (!on && now - lastInput < 250) return;
    lastInput = now;
    if (on) disengage();
    arm();
  }

  const onMotion = function () {
    if (reducedMotion()) { if (timer) clearTimeout(timer); timer = 0; disengage(); } else arm();
  };

  for (const type of INPUTS) window.addEventListener(type, onInput, { capture: true, passive: true });
  const scroller = app.main || null;
  if (scroller) scroller.addEventListener('scroll', onInput, { passive: true });
  window.addEventListener('ak-motion', onMotion);
  arm();

  return {
    arm,
    disarm() { if (timer) clearTimeout(timer); timer = 0; disengage(); },
    active() { return on; },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      timer = 0;
      disengage();
      for (const type of INPUTS) window.removeEventListener(type, onInput, { capture: true });
      if (scroller) scroller.removeEventListener('scroll', onInput);
      window.removeEventListener('ak-motion', onMotion);
    },
  };
}
