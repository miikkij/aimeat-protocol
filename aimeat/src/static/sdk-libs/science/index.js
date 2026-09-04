/**
 * @file science/index.js
 * @description The aimeat-science library: AIMEAT.science — a worksheet on a page, and the pieces it
 *   is made of used on their own. A worksheet is a record of cells where a formula is MathJSON
 *   standing on other cells by name, so editing an earlier cell recomputes exactly what stands on it
 *   and nothing runs any code. The maths itself is the node's (POST /v1/worksheet/evaluate), because
 *   the unit rules are the part that is quietly easy to get wrong twice.
 *
 *   THE PIECES ARE USABLE ALONE. quantity() draws one reading five ways, series() draws a history,
 *   control() offers a number to move, formula() sets an expression. An app that wants a meter and
 *   nothing else takes the meter.
 * @structure attach('science', { mount, read, save, evaluate, quantity, series, control, formula,
 *   typeset, follow, numberIn, FACES })
 * @usage
 *   <script src="/v1/libs/aimeat-auth.js"></script>
 *   <script src="/v1/libs/aimeat-science.js"></script>
 *   const sheet = await AIMEAT.science.mount(document.querySelector('#sheet'), { key: 'science.sheet.heating' });
 *   el.append(AIMEAT.science.quantity({ value: 21, unit: 'degC', formatted: '21 °C', ok: true }, { as: 'gauge', min: -30, max: 40 }));
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 2).
 */
import { attach } from '../_core/namespace.js';
import { mount, read, save, evaluateSheet } from './sheet.js';
import { quantityEl, FACES } from './quantity.js';
import { seriesEl, rowsToPoints } from './series.js';
import { controlEl } from './controls.js';
import { formulaEl, typesetInto, ensureKatex } from './formula.js';
import { followKeys, numberIn } from './live.js';

attach('science', {
  /** Put a worksheet on the page and keep it worked out. */
  mount,
  /** A worksheet from a memory key. */
  read,
  /** Keep a worksheet under a memory key. */
  save,
  /** Work a sheet out once, without drawing it. */
  evaluate: evaluateSheet,

  /** One reading, drawn as a figure, chip, gauge, sparkline or thermometer. */
  quantity: quantityEl,
  /** The faces a reading can wear. */
  FACES,
  /** A reading over time as one line. */
  series: seriesEl,
  /** Rows of readings as points, windowed. */
  points: rowsToPoints,
  /** A number a person can move: slider, field or stepper. It reports and does nothing else. */
  control: controlEl,
  /** An expression set as maths, with its answer under it. */
  formula: formulaEl,
  /** Set every expression under an element, once KaTeX has loaded from this node. */
  typeset: typesetInto,
  /** Load KaTeX now, for a page that means to set maths in a moment. */
  ensureKatex,

  /** Follow memory keys and report each reading as it changes. */
  follow: followKeys,
  /** The number a record holds, wherever a device happened to put it. */
  numberIn,
});
