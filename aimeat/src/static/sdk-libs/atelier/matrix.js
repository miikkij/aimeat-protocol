/**
 * @file atelier/matrix.js
 * @description The matrix — labelled rows against labelled columns, every cell a TONED word:
 *   the comparison grid suunta proved (capabilities × competitors: ours, theirs, ahead,
 *   behind), equally the status board any coverage / readiness / rollout view needs. DATA IN,
 *   GRID OUT: the component owns the sticky row labels, the scroll box and the tone colours
 *   (from the theme's own status hues), so an app never hand-rolls a comparison table and the
 *   Book can carry matrix-bearing arrangements as data.
 *
 *   The bound source resolves to ONE record: { cols: [{ id, label }], rows: [{ id, label,
 *   badge?, tone?, cells: [{ col, tone, label? }] }] }. A cell's tone is one of
 *   ok | warn | err | accent | plain; its optional label is the word shown in the cell.
 * @structure matrix(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.matrix({ target: host, data: { cols: [{ id: 'us', label: 'Us' }],
 *           rows: [{ id: 'r1', label: 'Search', cells: [{ col: 'us', tone: 'ok', label: 'live' }] }] } });
 * @version-history
 *   v0.20.0 — 2026-08-28 — Initial (TARGET-074, the harvest: suunta's comparison matrix becomes
 *     a kit component).
 */
import { el, clear, resolve, enter } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

/**
 * @typedef {object} MatrixCell
 * @property {string} col
 * @property {'ok'|'warn'|'err'|'accent'|'plain'} [tone]
 * @property {string} [label]
 */
/**
 * @typedef {object} MatrixRow
 * @property {string} id
 * @property {string} label
 * @property {string} [badge]
 * @property {'ok'|'warn'|'err'|'accent'|'plain'} [tone]
 * @property {MatrixCell[]} cells
 */
/**
 * @typedef {object} MatrixData
 * @property {Array<{ id: string, label: string }>} cols
 * @property {MatrixRow[]} rows
 */

const TONES = ['ok', 'warn', 'err', 'accent', 'plain'];

/**
 * The matrix.
 * @param {{
 *   target?: string|Element, data?: MatrixData|null,
 *   onPick?: (row: MatrixRow) => void,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: MatrixData|null }) => void, destroy: () => void }}
 */
export function matrix(spec) {
  const root = el('div', { class: 'ak-root ak-matrix' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  /** @param {MatrixData|null|undefined} data */
  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const cols = data && Array.isArray(data.cols) ? data.cols : [];
    const rows = data && Array.isArray(data.rows) ? data.rows : [];
    if (!cols.length || !rows.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }

    const table = el('table', { class: 'ak-matrix__table' });
    const head = el('tr', {}, [el('th', { class: 'ak-matrix__corner', scope: 'col' })]);
    for (const col of cols) {
      head.appendChild(el('th', { class: 'ak-matrix__col', scope: 'col', text: col.label }));
    }
    table.appendChild(el('thead', {}, [head]));

    const body = el('tbody', {});
    for (const row of rows) {
      const cellsByCol = new Map((row.cells || []).map((c) => [c.col, c]));
      const tr = el('tr', {
        class: 'ak-matrix__row',
        ...(spec.onPick ? { tabindex: '0', role: 'button' } : {}),
      });
      const label = el('th', { class: 'ak-matrix__label', scope: 'row' }, [
        el('span', { text: row.label }),
        row.badge != null
          ? el('span', { class: 'ak-badge ak-matrix__badge' + (row.tone ? ' ak-matrix__cell--' + row.tone : ''), text: row.badge })
          : null,
      ]);
      tr.appendChild(label);
      for (const col of cols) {
        const cell = cellsByCol.get(col.id);
        const tone = cell && TONES.includes(cell.tone || '') ? cell.tone : (cell ? 'plain' : null);
        tr.appendChild(el('td', { class: 'ak-matrix__cell' }, [
          tone === null ? null : el('span', {
            class: 'ak-matrix__chip ak-matrix__cell--' + tone,
            text: cell && cell.label != null ? cell.label : '●',
            ...(cell && cell.label == null ? { 'aria-label': tone } : {}),
          }),
        ]));
      }
      if (spec.onPick) {
        const pick = () => spec.onPick(row);
        tr.addEventListener('click', pick);
        tr.addEventListener('keydown', (ev) => {
          if (/** @type {KeyboardEvent} */ (ev).key === 'Enter' || /** @type {KeyboardEvent} */ (ev).key === ' ') {
            ev.preventDefault();
            pick();
          }
        });
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    // The grid scrolls inside its own box — wide comparisons never widen the page.
    root.appendChild(el('div', { class: 'ak-matrix__scroll' }, [table]));
    enter(root);
  }

  render(spec.data);

  return {
    el: root,
    /** @param {{ data: MatrixData|null }} patch */
    set(patch) {
      if (!patch) return;
      render(patch.data);
    },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
