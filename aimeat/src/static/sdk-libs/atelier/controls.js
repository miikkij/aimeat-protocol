/**
 * @file atelier/controls.js
 * @description Three controls a hand works, each on a real form element so the value, the
 *   keyboard, the label and the screen reader are the browser's own, with the kit's springs on
 *   top:
 *
 *     toggle     the switch. Pressing it stretches the knob toward where it will go; letting go
 *                sends the knob there on two edges, the leading one first. The track changes
 *                colour on the same beat.
 *     segmented  two to five choices in one pill; the chosen one is marked by the ink, which
 *                travels to the next choice.
 *     slider     a range under direct manipulation: the value follows the pointer, and pulling
 *                past either end stretches the whole control a little (a rubber band that gives
 *                less the further it is pulled), which springs back on release. The filled part
 *                of the track shows the value.
 *
 *   The form uses the same two enhancers for its own `toggle` and `range` fields (switchMotion,
 *   rangeMotion), so a declared form and a hand-placed control move the same way.
 * @structure switchMotion · toggle · segmented · rangeMotion · slider
 * @parts toggle root · input · label
 * @parts segmented root · option · ink
 * @parts slider root · label · input · readout
 * @variants segmented dense
 * @tokens toggle --ak-switch-w · --ak-switch-h · --ak-switch-pad · --ak-switch-knob
 * @tokens slider --ak-range-track · --ak-range-thumb
 * @fork toggle Use a plain checkbox with class ak-toggle; you keep the switch's look and give up the knob's stretch and travel.
 * @fork segmented Build a radio group yourself; you give up the travelling ink, the arrow keys and the roving focus.
 * @fork slider Use form({ fields: [{ type: 'range' }] }) or a plain input with class ak-input--range; the stretch comes with rangeMotion(input).
 * @usage
 *   AIMEAT.atelier.toggle({ target: host, label: 'Notifications', checked: true, onChange(on) {} });
 *   AIMEAT.atelier.segmented({ target: host, label: 'Range', items: [{ id: 'd', label: 'Day' }, { id: 'w', label: 'Week' }], value: 'd', onChange(id) {} });
 *   AIMEAT.atelier.slider({ target: host, label: 'Volume', min: 0, max: 100, value: 40, unit: '%', onInput(v) {} });
 * @version-history
 *   v0.55.0 — 2026-09-28 — Initial (the ten motion parts).
 */
import { el, resolve, uid, motionOff } from './dom.js';
import { edgePair, liveSpring } from './springs.js';
import { ink } from './ink.js';
import { applyVariant } from './parts-model.js';

/** How much wider the knob grows while it is pressed, as a share of its own size. */
const KNOB_STRETCH = 0.3;

/** The furthest a slider stretches past its end, in pixels, however hard it is pulled. */
const STRETCH_MAX = 22;

/**
 * Give a checkbox the switch's travel. The checkbox must carry class `ak-toggle` (the look is a
 * stylesheet fact); this adds the knob's two edges, drawn through --ak-knob-x and --ak-knob-w.
 * @param {HTMLInputElement} input
 * @returns {{ sync: () => void, destroy: () => void }}
 */
export function switchMotion(input) {
  input.setAttribute('role', 'switch');
  let pressed = false;
  /** The knob's resting box for a state: [start, end] along the track, inside its padding. The
   *  numbers are the stylesheet's (the track's inner box and --ak-switch-pad), read, not assumed. */
  function spot(on, press) {
    let pad;
    try { pad = parseFloat(getComputedStyle(input).getPropertyValue('--ak-switch-pad')) || 3; } catch { pad = 3; }
    const w = input.clientWidth || 46;
    const h = input.clientHeight || 26;
    const knob = Math.max(0, h - pad * 2);
    const grow = press ? knob * KNOB_STRETCH : 0;
    const far = Math.max(knob, w - pad * 2);
    return on ? [far - knob - grow, far] : [0, knob + grow];
  }
  function draw(a, b) {
    input.style.setProperty('--ak-knob-x', a.toFixed(2) + 'px');
    input.style.setProperty('--ak-knob-w', Math.max(0, b - a).toFixed(2) + 'px');
  }
  const first = spot(input.checked, false);
  const edges = edgePair(draw, { el: input, start: first[0], end: first[1] });
  draw(first[0], first[1]);
  function sync() {
    const s = spot(input.checked, pressed);
    edges.set(s[0], s[1]);
  }
  const down = function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    pressed = true; sync();
  };
  const up = function () { if (pressed) { pressed = false; sync(); } };
  const keyDown = function (e) { if (e.key === ' ' && !pressed) { pressed = true; sync(); } };
  input.addEventListener('pointerdown', down);
  input.addEventListener('pointerup', up);
  input.addEventListener('pointerleave', up);
  input.addEventListener('pointercancel', up);
  input.addEventListener('keydown', keyDown);
  input.addEventListener('keyup', up);
  input.addEventListener('change', sync);
  // A switch drawn before it was in the page measured nothing; measure again once it is there.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function () { const s = spot(input.checked, false); edges.jump(s[0], s[1]); draw(s[0], s[1]); });
  }
  return {
    sync,
    destroy() {
      edges.destroy();
      input.removeEventListener('pointerdown', down);
      input.removeEventListener('pointerup', up);
      input.removeEventListener('pointerleave', up);
      input.removeEventListener('pointercancel', up);
      input.removeEventListener('keydown', keyDown);
      input.removeEventListener('keyup', up);
      input.removeEventListener('change', sync);
    },
  };
}

/**
 * The switch, standalone: a labelled checkbox with role="switch".
 * @param {{ target?: string|Element, label: string, checked?: boolean, disabled?: boolean,
 *   name?: string, id?: string, onChange?: (on: boolean) => void }} spec
 * @returns {{ el: HTMLElement, input: HTMLInputElement, value: () => boolean,
 *   set: (on: boolean) => void, destroy: () => void }}
 */
export function toggle(spec) {
  const s = spec || { label: '' };
  const id = s.id || uid('ak-sw');
  const input = /** @type {HTMLInputElement} */ (el('input', {
    type: 'checkbox', id: id, class: 'ak-toggle', 'data-ak-part': 'input', name: s.name || null,
    checked: s.checked ? true : null, disabled: s.disabled ? true : null,
  }));
  const root = el('div', { class: 'ak-root ak-switchrow', 'data-ak-part': 'root' }, [
    input,
    el('label', { class: 'ak-switchrow__label', 'data-ak-part': 'label', for: id, text: s.label }),
  ]);
  const motion = switchMotion(input);
  input.addEventListener('change', function () { if (s.onChange) s.onChange(input.checked); });
  if (s.target) resolve(s.target).appendChild(root);
  return {
    el: root,
    input,
    value() { return input.checked; },
    set(on) { input.checked = !!on; motion.sync(); },
    destroy() { motion.destroy(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * Two to five choices in one pill, the chosen one marked by the travelling ink. A radio group to
 * assistive technology: the arrow keys move the choice, Home and End jump to the ends.
 * @param {{ target?: string|Element, label: string, items: Array<{ id: string, label: string }>,
 *   value?: string, variant?: 'dense', onChange?: (id: string) => void }} spec
 * @returns {{ el: HTMLElement, value: () => string, set: (patch: { value?: string, items?: Array<{ id: string, label: string }> }) => void,
 *   destroy: () => void }}
 */
export function segmented(spec) {
  const s = spec || { label: '', items: [] };
  const state = { items: s.items || [], value: s.value || (s.items && s.items[0] ? s.items[0].id : '') };
  const root = el('div', { class: 'ak-root ak-segmented', role: 'radiogroup', 'aria-label': s.label, 'data-ak-part': 'root' });
  applyVariant(root, s, ['dense']);
  const mark = ink(root, { active: '[aria-checked="true"]' });

  function pick(id, focus) {
    if (id === state.value) return;
    state.value = id;
    paint();
    mark.sync();
    if (focus) {
      const btn = Array.prototype.slice.call(root.querySelectorAll('.ak-segmented__option'))
        .find(function (b) { return b.getAttribute('data-ak-id') === id; });
      if (btn) btn.focus();
    }
    if (s.onChange) s.onChange(id);
  }
  function move(delta, to) {
    const i = state.items.findIndex(function (it) { return it.id === state.value; });
    const n = state.items.length;
    if (!n) return;
    const next = to === 'first' ? 0 : to === 'last' ? n - 1 : (i + delta + n) % n;
    pick(state.items[next].id, true);
  }
  function paint() {
    const kids = Array.prototype.slice.call(root.querySelectorAll('.ak-segmented__option'));
    kids.forEach(function (b) {
      const on = b.getAttribute('data-ak-id') === state.value;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
  }
  function build() {
    Array.prototype.slice.call(root.querySelectorAll('.ak-segmented__option')).forEach(function (b) { root.removeChild(b); });
    state.items.forEach(function (it) {
      root.insertBefore(el('button', {
        type: 'button', role: 'radio', class: 'ak-segmented__option', 'data-ak-part': 'option', 'data-ak-id': it.id,
        'data-ak-noguard': true,
        on: {
          click: function () { pick(it.id, false); },
          keydown: function (e) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Home') { e.preventDefault(); move(0, 'first'); }
            else if (e.key === 'End') { e.preventDefault(); move(0, 'last'); }
          },
        },
      }, it.label), mark.el);
    });
    paint();
  }
  build();
  if (s.target) resolve(s.target).appendChild(root);
  mark.jump();
  return {
    el: root,
    value() { return state.value; },
    set(patch) {
      if (!patch) return;
      if (patch.items) { state.items = patch.items; build(); }
      if (patch.value != null && patch.value !== state.value) { state.value = patch.value; paint(); mark.sync(); return; }
      if (patch.items) mark.jump();
    },
    destroy() { mark.destroy(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/** A pull past the end, in pixels, turned into how far the control gives: less and less. */
function rubber(over) {
  const sign = over < 0 ? -1 : 1;
  return sign * STRETCH_MAX * (1 - Math.exp(-Math.abs(over) / (STRETCH_MAX * 2.5)));
}

/**
 * Give a range input the fill and the stretch. The input must carry class `ak-input--range`.
 * The filled share of the track is written to --ak-range-fill on every change, and a pull past
 * either end stretches the control through its transform, from the opposite end, and springs it
 * back on release. The arrow key that meets the end gives a small bump the same way.
 * @param {HTMLInputElement} input
 * @returns {{ sync: () => void, destroy: () => void }}
 */
export function rangeMotion(input) {
  let stretch = 0;
  function num(name, fallback) { const v = parseFloat(input.getAttribute(name) || ''); return isFinite(v) ? v : fallback; }
  function fill() {
    const lo = num('min', 0);
    const hi = num('max', 100);
    const v = parseFloat(input.value);
    const pct = hi > lo && isFinite(v) ? ((v - lo) / (hi - lo)) * 100 : 0;
    input.style.setProperty('--ak-range-fill', Math.max(0, Math.min(100, pct)).toFixed(2) + '%');
  }
  function draw(x) {
    stretch = x;
    const w = input.offsetWidth || 200;
    if (Math.abs(x) < 0.05) { input.style.removeProperty('transform'); input.style.removeProperty('transform-origin'); return; }
    const k = Math.abs(x) / w;
    input.style.transformOrigin = x > 0 ? 'left center' : 'right center';
    input.style.transform = 'scale(' + (1 + k).toFixed(4) + ', ' + (1 - k * 0.6).toFixed(4) + ')';
  }
  const spring = liveSpring(draw, { el: input, value: 0, precision: 0.05 });
  let held = null;
  const onMove = function (e) {
    if (!held || e.pointerId !== held) return;
    const r = input.getBoundingClientRect();
    const over = e.clientX > r.right ? e.clientX - r.right : e.clientX < r.left ? e.clientX - r.left : 0;
    // The stretch is under the hand, so it runs under reduced motion too; only the return is skipped.
    spring.jump(over ? rubber(over) : 0);
  };
  const onUp = function (e) {
    if (!held || (e && e.pointerId !== held)) return;
    held = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    spring.set(0);
  };
  const onDown = function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    held = e.pointerId;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const onKey = function (e) {
    if (motionOff(input)) return;
    const v = parseFloat(input.value);
    const atMax = v >= num('max', 100);
    const atMin = v <= num('min', 0);
    const up = e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'End';
    const down = e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'Home';
    if ((up && atMax) || (down && atMin)) spring.set(0, { velocity: (up ? 1 : -1) * 160 });
  };
  input.addEventListener('pointerdown', onDown);
  input.addEventListener('input', fill);
  input.addEventListener('change', fill);
  input.addEventListener('keydown', onKey);
  fill();
  return {
    sync: fill,
    destroy() {
      onUp();
      spring.destroy();
      input.removeEventListener('pointerdown', onDown);
      input.removeEventListener('input', fill);
      input.removeEventListener('change', fill);
      input.removeEventListener('keydown', onKey);
      if (stretch) draw(0);
    },
  };
}

/**
 * The slider, standalone: a labelled range with its reading beside the track, the fill and the
 * stretch. `onInput` hears every move as a number, `onChange` hears the release.
 * @param {{ target?: string|Element, label: string, min?: number, max?: number, step?: number,
 *   value?: number, unit?: string, onInput?: (v: number) => void, onChange?: (v: number) => void }} spec
 * @returns {{ el: HTMLElement, input: HTMLInputElement, value: () => number, set: (v: number) => void,
 *   destroy: () => void }}
 */
export function slider(spec) {
  const s = spec || { label: '' };
  const id = uid('ak-sl');
  const input = /** @type {HTMLInputElement} */ (el('input', {
    type: 'range', id: id, class: 'ak-input ak-input--range', 'data-ak-part': 'input',
    min: String(s.min != null ? s.min : 0), max: String(s.max != null ? s.max : 100), step: s.step != null ? String(s.step) : null,
  }));
  input.value = String(s.value != null ? s.value : (s.min || 0));
  const readout = el('output', { class: 'ak-form__readout', 'data-ak-part': 'readout', for: id });
  const root = el('div', { class: 'ak-root ak-slider', 'data-ak-part': 'root' }, [
    el('label', { class: 'ak-form__label', 'data-ak-part': 'label', for: id, text: s.label }),
    el('div', { class: 'ak-form__range' }, [input, readout]),
  ]);
  function say() {
    const words = input.value + (s.unit ? ' ' + s.unit : '');
    readout.textContent = words;
    input.setAttribute('aria-valuetext', words);
  }
  const motion = rangeMotion(input);
  input.addEventListener('input', function () { say(); if (s.onInput) s.onInput(Number(input.value)); });
  input.addEventListener('change', function () { say(); if (s.onChange) s.onChange(Number(input.value)); });
  say();
  if (s.target) resolve(s.target).appendChild(root);
  return {
    el: root,
    input,
    value() { return Number(input.value); },
    set(v) { input.value = String(v); say(); motion.sync(); },
    destroy() { motion.destroy(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
