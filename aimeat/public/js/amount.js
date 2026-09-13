/**
 * @file public/js/amount.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The portal's copy of the one amount parser, AIMEAT.commerce.parseAmount
 *   (src/static/sdk-libs/commerce/amount.js). The portal is plain browser ESM served from public/ and
 *   cannot import a served SDK lib, which is an esbuild IIFE, so it carries this copy; the unit test
 *   test/unit/cortex-surface-parse-amount.test.ts holds it to the original on every named case and
 *   on every short string over the characters that matter. Change the original, then this.
 * @structure parseAmount(input) · groupedDigits(str, mark)
 * @usage import { parseAmount } from '/js/amount.js';  parseAmount('12,000.00') → 12000
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial. utils.js microsFromInput replaced the FIRST comma with a dot, so an
 *     owner typing an offer price of '1,500.00' set 1.50 (appdev pitfall
 *     amount-parser-reads-thousands-separator-as-decimal, the third door with that one-liner).
 */

/** Characters that only ever group digits: spaces of every width, and the Swiss apostrophes. */
var SPACE_GROUP = /[\s'’]/;
var SPACE_GROUPS = /[\s'’]+/;

/**
 * The digits of a run grouped by one mark, or null when the grouping is not a real one.
 * @param {string} str
 * @param {string} mark
 * @returns {string|null}
 */
function groupedDigits(str, mark) {
  var g = str.split(mark);
  if (!/^\d{1,3}$/.test(g[0]) || !/^\d{3}$/.test(g[g.length - 1])) return null;
  var middle = g.slice(1, -1);
  var western = middle.every(function (x) { return /^\d{3}$/.test(x); });
  var indian = middle.length > 0 && middle.every(function (x) { return /^\d{2}$/.test(x); });
  return western || indian ? g.join('') : null;
}

/**
 * Parse an amount written in any common convention into a number, or null. An ambiguous '1,000' or
 * '1.000' returns null so the person is asked again; the full rules are in the original's JSDoc.
 * @param {unknown} input  A string, or a number.
 * @returns {number|null}  The amount in whole units (not micros), or null when it cannot be read.
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (input == null) return null;
  var s = String(input).replace(/−/g, '-').trim();
  var first = s.search(/\d/);
  if (first < 0) return null;
  var last = s.length - 1;
  while (!/\d/.test(s.charAt(last))) last--;

  var prefix = s.slice(0, first);
  var body = s.slice(first, last + 1);
  var suffix = s.slice(last + 1);
  if (/(^|[\s+\-(])[.,]$/.test(prefix)) { body = prefix.slice(-1) + body; prefix = prefix.slice(0, -1); }
  if (/^[.,]/.test(suffix)) suffix = suffix.slice(1);
  var negative = prefix.indexOf('-') >= 0 || (prefix.indexOf('(') >= 0 && suffix.indexOf(')') >= 0);

  if (/[^\d.,\s'’]/.test(body)) return null;

  var t = body;
  var spaced = SPACE_GROUP.test(body);
  if (spaced) {
    var parts = body.split(SPACE_GROUPS);
    for (var i = 0; i < parts.length; i++) {
      var ok = i === 0 ? /^\d{1,3}$/.test(parts[i])
        : i < parts.length - 1 ? /^\d{3}$/.test(parts[i])
          : /^\d{3}([.,]\d*)?$/.test(parts[i]);
      if (!ok) return null;
    }
    t = parts.join('');
  }

  var commas = t.split(',').length - 1;
  var dots = t.split('.').length - 1;
  var whole;
  var fraction = '';
  if (commas + dots === 0) {
    whole = t;
  } else if (spaced) {
    var k = t.search(/[.,]/);
    whole = t.slice(0, k);
    fraction = t.slice(k + 1);
  } else if (commas > 0 && dots > 0) {
    var at = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
    var decimal = t.charAt(at);
    if (t.split(decimal).length - 1 !== 1) return null;
    whole = groupedDigits(t.slice(0, at), decimal === ',' ? '.' : ',');
    if (whole === null) return null;
    fraction = t.slice(at + 1);
  } else if (commas + dots > 1) {
    whole = groupedDigits(t, commas ? ',' : '.');
    if (whole === null) return null;
  } else {
    var m = t.search(/[.,]/);
    var before = t.slice(0, m);
    var after = t.slice(m + 1);
    if (after.length === 3 && /^[1-9]\d{0,2}$/.test(before)) return null;
    whole = before;
    fraction = after;
  }

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || (whole === '' && fraction === '')) return null;
  var value = parseFloat((whole || '0') + '.' + (fraction || '0'));
  if (!Number.isFinite(value)) return null;
  return negative && value !== 0 ? -value : value;
}
