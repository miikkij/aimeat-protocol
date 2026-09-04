/**
 * @file science/controls.js
 * @description The inputs a person moves: a slider, a field, a stepper. Each one REPORTS and does
 *   nothing else — it hands the new number to whoever mounted it and never touches the sheet, the
 *   node or another cell. What happens next is the sheet's business, which is what keeps a control
 *   usable in a worksheet, a mosaic block and an MCP App frame without three versions of it.
 *
 *   The value is written beside the control, always, because a slider with no figure beside it is a
 *   guess. Bounds come from the cell; a cell with none gets a field rather than a slider, since a
 *   slider between nothing and nothing is a decoration.
 * @structure controlEl · sliderEl · fieldEl · stepperEl
 * @usage
 *   import { controlEl } from './controls.js';
 *   row.append(controlEl(cell, answer, { onInput: v => sheet.setInput(cell.id, v) }));
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 2).
 */

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

const UNIT_WORDS = { degC: '°C', degF: '°F', degK: 'K', R: '°R', percent: '%' };
const unitWord = (unit) => (unit ? UNIT_WORDS[unit] || unit : '');

/**
 * One input cell as a control.
 * @param {object} cell the worksheet cell (kind 'input')
 * @param {object} [answer] its evaluated answer, for the figure beside the control
 * @param {{ onInput?: (value:number)=>void, readOnly?: boolean }} [opts]
 */
export function controlEl(cell, answer, opts) {
  const o = opts || {};
  const bounded = Number.isFinite(cell.min) && Number.isFinite(cell.max);
  const shape = cell.as === 'field' || cell.as === 'stepper' ? cell.as : (bounded ? 'slider' : 'field');
  const box = el('div', 'sci-control sci-control--' + shape);

  const label = el('label', 'sci-q-label', cell.label || cell.id);
  const id = 'sci-' + cell.id;
  label.htmlFor = id;
  box.append(label);

  const shown = el('b', 'sci-control-value', answer?.formatted ?? withUnit(cell.value, cell.unit));
  const report = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    shown.textContent = withUnit(n, cell.unit);
    if (typeof o.onInput === 'function') o.onInput(n);
  };

  const input = shape === 'slider' ? sliderEl(cell) : fieldEl(cell);
  input.id = id;
  input.disabled = !!o.readOnly;
  input.addEventListener('input', () => report(input.value));

  const row = el('div', 'sci-control-row');
  if (shape === 'stepper') {
    row.append(stepButton('−', () => report(clamp(Number(input.value) - step(cell), cell)), o.readOnly));
    row.append(input);
    row.append(stepButton('+', () => report(clamp(Number(input.value) + step(cell), cell)), o.readOnly));
  } else {
    row.append(input);
  }
  row.append(shown);
  box.append(row);

  if (Number.isFinite(cell.min) && Number.isFinite(cell.max)) {
    box.append(el('small', 'sci-control-bounds', `${withUnit(cell.min, cell.unit)} – ${withUnit(cell.max, cell.unit)}`));
  }
  return box;
}

/** A slider between the cell's own bounds. */
export function sliderEl(cell) {
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'sci-slider';
  input.min = String(cell.min);
  input.max = String(cell.max);
  input.step = String(step(cell));
  input.value = String(cell.value);
  input.setAttribute('aria-label', cell.label || cell.id);
  return input;
}

/** A number a person types. */
export function fieldEl(cell) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'sci-field og-input';
  if (Number.isFinite(cell.min)) input.min = String(cell.min);
  if (Number.isFinite(cell.max)) input.max = String(cell.max);
  input.step = String(step(cell));
  input.value = String(cell.value);
  input.setAttribute('aria-label', cell.label || cell.id);
  return input;
}

function stepButton(sign, onClick, disabled) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sci-step og-door';
  button.textContent = sign;
  button.disabled = !!disabled;
  button.addEventListener('click', onClick);
  return button;
}

/** A step the cell declared, or one that divides the range into a hundred places. */
function step(cell) {
  if (Number.isFinite(cell.step) && cell.step > 0) return cell.step;
  if (Number.isFinite(cell.min) && Number.isFinite(cell.max)) {
    const span = Math.abs(cell.max - cell.min);
    if (span > 0) return Number((span / 100).toPrecision(1));
  }
  return 1;
}

function clamp(value, cell) {
  let n = value;
  if (Number.isFinite(cell.min)) n = Math.max(cell.min, n);
  if (Number.isFinite(cell.max)) n = Math.min(cell.max, n);
  return n;
}

function withUnit(value, unit) {
  if (!Number.isFinite(value)) return '—';
  const word = unitWord(unit);
  return word ? `${value} ${word}` : String(value);
}
