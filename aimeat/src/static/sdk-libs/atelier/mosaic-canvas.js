/**
 * @file atelier/mosaic-canvas.js
 * @description The canvas projection, extracted whole from mosaic.js when that file crossed the
 *   size cap (pure extraction — same code, new home). Units as live tiles on a pan-and-zoom
 *   field. Zoomed out the app is its own map; a tile expands to full view on pick with a
 *   shared-element morph and collapses on back — the semantic-zoom promise, sized for v1.
 *   Buttons carry the zoom for keyboards and touch alike; drag pans; wheel zooms at the cursor.
 *   Nothing animates at idle — motion happens on input only.
 * @structure projectCanvas(units, morph) → HTMLElement
 * @usage internal to the kit: mosaic.js calls projectCanvas(units, morph)
 * @version-history
 *   v0.13.0 — 2026-08-28 — Extracted from mosaic.js (pure move; the morph arrived in 0.12.0).
 */
import { el, clear, enter } from './dom.js';
import { t } from './i18n.js';

const CANVAS_MIN = 0.35;
const CANVAS_MAX = 1.6;
const CANVAS_STEP = 1.18;

/**
 * @param {Array<{ el: HTMLElement, label: string, tile?: HTMLElement }>} units
 * @param {(moving: HTMLElement, run: () => void) => void} morph
 * @returns {HTMLElement}
 */
export function projectCanvas(units, morph) {
  const field = el('div', { class: 'ak-mosaic__field' });
  const cam = { x: 0, y: 0, scale: 0.6 };
  let focused = null;

  function apply() {
    field.style.transform = 'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.scale + ')';
  }

  const viewport = el('div', { class: 'ak-mosaic__canvas' }, field);

  units.forEach(function (u) {
    const cover = el('button', {
      type: 'button', class: 'ak-mosaic__tilecover', 'data-ak-noguard': true,
      'aria-label': t('open') + ': ' + u.label,
      on: { click: function () { focus(u); } },
    });
    u.tile = el('div', { class: 'ak-mosaic__tile' }, [
      el('span', { class: 'ak-mosaic__tilelabel', text: u.label }),
      u.el, cover,
    ]);
    field.appendChild(u.tile);
  });

  const focusHost = el('div', { class: 'ak-mosaic__focus', hidden: true });
  const backBtn = el('button', {
    type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
    on: { click: function () { unfocus(); } },
  }, '↩ ' + t('back'));

  function focus(u) {
    morph(u.el, function () {
      focused = u;
      focusHost.hidden = false;
      viewport.hidden = true;
      zoombar.hidden = true;
      clear(focusHost);
      focusHost.appendChild(backBtn);
      focusHost.appendChild(u.el);
      enter(focusHost);
    });
  }
  function unfocus() {
    if (!focused) return;
    const u = focused;
    morph(u.el, function () {
      focused = null;
      u.tile.insertBefore(u.el, u.tile.lastChild);
      focusHost.hidden = true;
      viewport.hidden = false;
      zoombar.hidden = false;
    });
  }

  // Pan by pointer drag; zoom at the cursor by wheel; buttons as the keyboard-reachable twin.
  let drag = null;
  viewport.addEventListener('pointerdown', function (ev) {
    const at = /** @type {Element|null} */ (ev.target instanceof Element ? ev.target : null);
    if (at && at.closest('.ak-mosaic__tilecover')) return;
    drag = { x: ev.clientX, y: ev.clientY };
    viewport.setPointerCapture(ev.pointerId);
  });
  viewport.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    cam.x += ev.clientX - drag.x;
    cam.y += ev.clientY - drag.y;
    drag = { x: ev.clientX, y: ev.clientY };
    apply();
  });
  viewport.addEventListener('pointerup', function () { drag = null; });
  viewport.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? CANVAS_STEP : 1 / CANVAS_STEP;
    const next = Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, cam.scale * factor));
    const rect = viewport.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    cam.x = px - (px - cam.x) * (next / cam.scale);
    cam.y = py - (py - cam.y) * (next / cam.scale);
    cam.scale = next;
    apply();
  }, { passive: false });

  function zoomBtn(label, aria, factor) {
    return el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost', 'aria-label': aria, 'data-ak-noguard': true,
      on: {
        click: function () {
          cam.scale = factor === 0 ? 0.6 : Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, cam.scale * factor));
          if (factor === 0) { cam.x = 0; cam.y = 0; }
          apply();
        },
      },
    }, label);
  }
  const zoombar = el('div', { class: 'ak-mosaic__zoombar' }, [
    zoomBtn('−', t('zoomOut'), 1 / CANVAS_STEP),
    zoomBtn('⤢', t('fitView'), 0),
    zoomBtn('+', t('zoomIn'), CANVAS_STEP),
  ]);

  apply();
  return el('div', { class: 'ak-mosaic__canvaswrap' }, [viewport, zoombar, focusHost]);
}
