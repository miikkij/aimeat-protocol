/**
 * @file series-colors.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The colour of a chart's data series: a fixed palette of twelve, and past it a colour
 *   no earlier series has, so a series never wears another's colour.
 *
 *   WHY IT DOES NOT CYCLE. `colorForIndex` was `APP_PALETTE[i % 12]`, and the admin Usage page fed it
 *   one series per model: on a node with eighteen models six of them wore a colour another model
 *   already had, inside a STACKED bar, where two segments of one colour cannot be told apart. The
 *   legend named eighteen and the eye could separate twelve. Past the palette
 *   the hue turns by the golden angle, so each new series lands between the ones before it, and the
 *   string carries the hue to three decimals, so no two indexes give the same colour. A chart with
 *   that many series is better folded into "Other" or drawn as rows; this keeps the ones that are not
 *   from lying.
 * @structure SERIES_PALETTE · seriesColor(i)
 * @usage import { seriesColor } from '/js/series-colors.js'; backgroundColor: seriesColor(i)
 *   (components/UsageChart.js re-exports it as colorForIndex, with SERIES_PALETTE as APP_PALETTE).
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial: moved out of components/UsageChart.js, and no longer cycles
 *     (retires docs/pitfalls.md §76; check:single-entry rule palette-cycle holds it).
 */

/** Distinct DATA-SERIES colours (not UI chrome): Chart.js needs concrete strings. */
export const SERIES_PALETTE = [
  '#E8564A', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4',
  '#ec4899', '#84cc16', '#eab308', '#14b8a6', '#f97316', '#a78bfa',
];

const GOLDEN_ANGLE = 137.50776405003785;

/**
 * The colour of series `i`. 0–11 are the palette; from 12 on, a hue no earlier index has. A negative
 * or non-numeric index (an `indexOf` that found nothing) gets the palette's last colour, as it did.
 */
export function seriesColor(i) {
  if (!(i >= 0)) return SERIES_PALETTE[SERIES_PALETTE.length - 1];
  const n = Math.floor(i);
  if (n < SERIES_PALETTE.length) return SERIES_PALETTE[n];
  const k = n - SERIES_PALETTE.length;
  const hue = (k * GOLDEN_ANGLE + 20) % 360;
  // Three lightness steps, so neighbours on the wheel also differ in brightness.
  const light = [52, 42, 62][k % 3];
  return `hsl(${hue.toFixed(3)}, 70%, ${light}%)`;
}
