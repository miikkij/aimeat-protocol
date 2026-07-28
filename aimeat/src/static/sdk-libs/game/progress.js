/**
 * @file game/progress.js
 * @description Progression components: the step rail, the labelled meter, the counting number and
 *   the streak tracker. Each takes a spec, returns a handle with `set()` / `destroy()`, and holds
 *   no state of its own beyond what it was last told.
 *
 *   ONE SIZING EVERYWHERE. The rail and the meter read their size from the theming contract
 *   (`--ag-rail-dot`, `--ag-meter-h`), never from the spec — so two rails on one page always
 *   match, and a skin can make every rail in an app denser in one line.
 *
 *   REDUCED MOTION. The counter checks the viewer's preference and lands on the final value
 *   immediately; the CSS transitions collapse for the same reason. An animation is a nicety, and
 *   a nicety that ignores an accessibility preference is a defect.
 * @structure rail(spec) · meter(spec) · counter(spec) · streak(spec)
 * @usage  const m = AIMEAT.game.meter({ label: 'Readiness', value: 62, threshold: 70 });
 *         m.set({ value: 71 });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */
import { el, clear, reducedMotion } from './dom.js';
import { t, i18n } from './i18n.js';

/** Clamp to the 0..100 the meter and the rail both speak. */
function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * @typedef {object} RailStep
 * @property {string} id
 * @property {string} label
 * @property {'future'|'current'|'done'} [state]
 */

/**
 * A horizontal step rail: where the player is, what is behind them, what is left.
 * @param {RailStep[]|{ steps: RailStep[], onPick?: (step: RailStep, index: number) => void }} spec
 * @returns {{ el: HTMLElement, set: (steps: RailStep[]) => void, destroy: () => void }}
 */
export function rail(spec) {
  const cfg = Array.isArray(spec) ? { steps: spec } : (spec || { steps: [] });
  let steps = cfg.steps || [];
  const root = el('div', { class: 'ag-root ag-rail', role: 'list' });

  function render() {
    clear(root);
    steps.forEach(function (step, i) {
      const st = step.state || 'future';
      const mark = st === 'done' ? '✓' : String(i + 1);
      const kids = [
        el('span', { class: 'ag-rail__dot', 'aria-hidden': 'true', text: mark }),
        el('span', { class: 'ag-rail__name', text: step.label }),
      ];
      const attrs = {
        class: 'ag-rail__step ag-rail__step--' + st,
        role: 'listitem',
        'data-ag-id': step.id,
        'aria-current': st === 'current' ? 'step' : null,
        'aria-label': step.label + ' — ' + t(st === 'done' ? 'done' : st === 'current' ? 'now' : 'later'),
      };
      if (cfg.onPick) {
        root.appendChild(el('button', Object.assign({ type: 'button' }, attrs, {
          on: { click: function () { if (cfg.onPick) cfg.onPick(step, i); } },
        }), kids));
      } else {
        root.appendChild(el('div', attrs, kids));
      }
    });
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {RailStep[]} next */
    set(next) { if (next) steps = next; render(); },
    destroy() { stopLang(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * A labelled 0..100 meter with an optional threshold marker ("you need 70 to list this").
 * @param {{
 *   label: string, value: number, threshold?: number, hint?: string,
 *   tone?: 'accent'|'ok'|'warn'|'err', suffix?: string
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function meter(spec) {
  const state = {
    label: spec.label,
    value: pct(spec.value),
    threshold: spec.threshold,
    hint: spec.hint,
    tone: spec.tone || 'accent',
    suffix: spec.suffix != null ? spec.suffix : '%',
  };

  const name = el('span', { class: 'ag-label' });
  const value = el('span', { class: 'ag-meter__value ag-num' });
  const top = el('div', { class: 'ag-meter__top' }, [name, value]);
  const fill = el('div', { class: 'ag-meter__fill' });
  const track = el('div', {
    class: 'ag-meter__track', role: 'progressbar',
    'aria-valuemin': '0', 'aria-valuemax': '100',
  }, fill);
  const hint = el('p', { class: 'ag-meter__hint' });
  const root = el('div', { class: 'ag-root ag-meter' }, [top, track, hint]);

  function render() {
    root.className = 'ag-root ag-meter ag-meter--' + state.tone;
    name.textContent = state.label;
    value.textContent = Math.round(state.value) + state.suffix;
    // The percentage is data: it goes in as a custom property the stylesheet consumes.
    fill.style.setProperty('--ag-fill', state.value + '%');
    track.setAttribute('aria-valuenow', String(Math.round(state.value)));
    track.setAttribute('aria-label', state.label);

    const existing = track.querySelector('.ag-meter__mark');
    if (existing) track.removeChild(existing);
    if (state.threshold != null) {
      track.appendChild(el('div', {
        class: 'ag-meter__mark', 'aria-hidden': 'true',
        vars: { '--ag-at': pct(state.threshold) + '%' },
      }));
    }

    const text = state.hint || (state.threshold != null ? t('target', { n: Math.round(pct(state.threshold)) + state.suffix }) : '');
    hint.textContent = text;
    hint.hidden = !text;
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {{ value?: number, label?: string, threshold?: number, hint?: string, tone?: 'accent'|'ok'|'warn'|'err' }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.value != null) state.value = pct(patch.value);
      if (patch.label != null) state.label = patch.label;
      if (patch.threshold !== undefined) state.threshold = patch.threshold;
      if (patch.hint !== undefined) state.hint = patch.hint;
      if (patch.tone) state.tone = patch.tone;
      render();
    },
    destroy() { stopLang(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * A large number that counts to its target — and simply IS its target when the viewer prefers
 * reduced motion.
 * @param {{
 *   value: number, label?: string, from?: number, durationMs?: number,
 *   format?: (n: number) => string
 * }} spec
 * @returns {{ el: HTMLElement, set: (value: number|{ value?: number, label?: string }) => void, destroy: () => void }}
 */
export function counter(spec) {
  const format = spec.format || function (n) { return String(Math.round(n)); };
  const duration = spec.durationMs || 900;
  let shown = spec.from != null ? spec.from : 0;
  let target = Number(spec.value) || 0;
  let frame = 0;

  const num = el('span', { class: 'ag-counter__n ag-num' });
  const label = el('span', { class: 'ag-label' });
  const root = el('div', { class: 'ag-root ag-counter' }, [num, label]);

  function paintLabel() {
    label.textContent = spec.label || '';
    label.hidden = !spec.label;
  }

  /** @param {number} to */
  function animate(to) {
    if (frame) cancelAnimationFrame(frame);
    if (reducedMotion() || duration <= 0) {
      shown = to;
      num.textContent = format(shown);
      return;
    }
    const from = shown;
    const started = performance.now();
    const step = function (now) {
      const p = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      shown = from + (to - from) * eased;
      num.textContent = format(shown);
      if (p < 1) frame = requestAnimationFrame(step);
      else { frame = 0; shown = to; num.textContent = format(shown); }
    };
    frame = requestAnimationFrame(step);
  }

  paintLabel();
  num.textContent = format(shown);
  animate(target);

  return {
    el: root,
    /** @param {number|{ value?: number, label?: string }} next */
    set(next) {
      if (typeof next === 'number') { target = next; animate(target); return; }
      if (!next) return;
      if (next.label !== undefined) { spec.label = next.label; paintLabel(); }
      if (next.value != null) { target = next.value; animate(target); }
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * A consecutive-period tracker — for any app whose loop is a habit. The period is the caller's
 * word ("day", "week", "session"), never the component's.
 * @param {{
 *   count: number, periods?: Array<{ label: string, done: boolean }>, best?: number,
 *   unitLabel?: string
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function streak(spec) {
  const state = {
    count: Number(spec.count) || 0,
    periods: spec.periods || [],
    best: spec.best,
    unitLabel: spec.unitLabel,
  };

  const count = el('span', { class: 'ag-streak__count ag-num' });
  const unit = el('span', { class: 'ag-label' });
  const best = el('span', { class: 'ag-dim' });
  const top = el('div', { class: 'ag-streak__top' }, [count, unit, best]);
  const cells = el('div', { class: 'ag-streak__cells' });
  const root = el('div', { class: 'ag-root ag-streak' }, [top, cells]);

  function render() {
    count.textContent = t('inARow', { n: state.count });
    unit.textContent = state.unitLabel || '';
    unit.hidden = !state.unitLabel;
    best.textContent = state.best != null ? t('best', { n: state.best }) : '';
    best.hidden = state.best == null;

    clear(cells);
    for (const p of state.periods) {
      cells.appendChild(el('div', {
        class: 'ag-streak__cell' + (p.done ? ' ag-streak__cell--done' : ''),
        title: p.label,
      }, [
        el('span', { class: 'ag-streak__box', 'aria-hidden': 'true', text: p.done ? '✓' : '' }),
        el('span', { class: 'ag-streak__tick', text: p.label }),
      ]));
    }
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {{ count?: number, periods?: any[], best?: number, unitLabel?: string }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.count != null) state.count = patch.count;
      if (patch.periods) state.periods = patch.periods;
      if (patch.best !== undefined) state.best = patch.best;
      if (patch.unitLabel !== undefined) state.unitLabel = patch.unitLabel;
      render();
    },
    destroy() { stopLang(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
