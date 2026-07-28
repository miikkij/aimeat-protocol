/**
 * @file game/score.js
 * @description The score breakdown — the component this kit exists for. A score shown as one
 *   number tells a player they are losing; a score shown as its PARTS tells them what to do next.
 *   Each row is a category with its points, its maximum and a one-line reason, and every row is a
 *   button that reports which part was picked, so the host can jump straight to fixing it.
 *
 *   That is the whole trick that makes any scored experience playable: the number becomes a
 *   to-do list. A quiz uses it for topics missed, an onboarding for steps skipped, a training
 *   tracker for muscle groups, a business simulation for the parts of a listing that are thin.
 *
 *   The row colour is derived, never passed: full marks read as done, partial as in progress,
 *   zero as untouched. A host that wants a different reading passes `tone` explicitly.
 * @structure scoreBreakdown(spec) → handle { el, set, destroy }
 * @usage  AIMEAT.game.scoreBreakdown({ rows, onPick(row) { openFix(row.id); } });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */
import { el, clear } from './dom.js';
import { t, i18n } from './i18n.js';
import { meter } from './progress.js';

/**
 * @typedef {object} ScoreRow
 * @property {string} id
 * @property {string} label
 * @property {number} points
 * @property {number} max
 * @property {string} [reason]   One line: why these points, or what is missing.
 * @property {'full'|'part'|'zero'} [tone]
 */

/**
 * A score, broken into the parts a player can act on.
 * @param {{
 *   title?: string, rows: ScoreRow[], onPick?: (row: ScoreRow) => void,
 *   total?: { points: number, max: number }, totalLabel?: string, showTotal?: boolean,
 *   threshold?: number
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function scoreBreakdown(spec) {
  const state = {
    title: spec.title,
    rows: spec.rows || [],
    total: spec.total,
    threshold: spec.threshold,
  };

  const big = el('span', { class: 'ag-score__big ag-num' });
  const bar = meter({
    label: spec.totalLabel || t('total'),
    value: 0,
    threshold: spec.threshold,
  });
  const totalBox = el('div', { class: 'ag-score__total' }, [big, bar.el]);
  const rows = el('div', { class: 'ag-score__rows' });
  const heading = el('h3', { class: 'ag-title' });
  const root = el('div', { class: 'ag-root ag-score' }, [heading, totalBox, rows]);

  /** The summed total, unless the host gave one. */
  function totals() {
    if (state.total) return state.total;
    let points = 0;
    let max = 0;
    for (const r of state.rows) { points += Number(r.points) || 0; max += Number(r.max) || 0; }
    return { points: points, max: max };
  }

  /** @param {ScoreRow} row @returns {string} */
  function toneOf(row) {
    if (row.tone) return row.tone;
    const p = Number(row.points) || 0;
    const m = Number(row.max) || 0;
    if (m > 0 && p >= m) return 'full';
    return p > 0 ? 'part' : 'zero';
  }

  function render() {
    heading.textContent = state.title || '';
    heading.hidden = !state.title;

    const sum = totals();
    const share = sum.max > 0 ? (sum.points / sum.max) * 100 : 0;
    big.textContent = String(Math.round(sum.points));
    bar.set({
      value: share,
      label: (spec.totalLabel || t('total')) + ' · ' + t('points', { a: Math.round(sum.points), b: Math.round(sum.max) }),
    });
    totalBox.hidden = spec.showTotal === false;

    clear(rows);
    if (!state.rows.length) {
      rows.appendChild(el('p', { class: 'ag-empty', text: t('empty') }));
      return;
    }
    for (const row of state.rows) {
      const tone = toneOf(row);
      rows.appendChild(el('button', {
        type: 'button',
        class: 'ag-score__row ag-score__row--' + tone,
        'data-ag-id': row.id,
        'aria-label': row.label + ' — ' + t('points', { a: row.points, b: row.max }),
        on: { click: function () { if (spec.onPick) spec.onPick(row); } },
      }, [
        el('span', {}, [
          el('span', { class: 'ag-score__name', text: row.label }),
          row.reason ? el('span', { class: 'ag-score__why', text: row.reason }) : null,
        ]),
        el('span', { class: 'ag-score__pts' }, [
          el('span', { text: t('points', { a: row.points, b: row.max }) }),
          el('span', { class: 'ag-score__go', text: '→', 'aria-hidden': 'true' }),
        ]),
      ]));
    }
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {{ rows?: ScoreRow[], total?: any, title?: string, threshold?: number }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.rows) state.rows = patch.rows;
      if (patch.total !== undefined) state.total = patch.total;
      if (patch.title !== undefined) state.title = patch.title;
      if (patch.threshold !== undefined) { state.threshold = patch.threshold; bar.set({ threshold: patch.threshold }); }
      render();
    },
    destroy() { stopLang(); bar.destroy(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
