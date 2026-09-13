/**
 * @file commerce/amount.js
 * @description The one amount parser: reads a money amount a person typed, a spreadsheet cell or a
 *   CSV exported the way its writer meant it, and refuses the one shape nobody can read. Exposed as
 *   AIMEAT.commerce.parseAmount and used by microsFromInput. The aimeat-surface cortex pack carries a
 *   copy of parseAmount, because a cortex IIFE cannot import a served lib; the unit test
 *   test/unit/cortex-surface-parse-amount.test.ts holds the two to the same answers.
 * @structure parseAmount(input) · groupedDigits(str, mark)
 * @usage import { parseAmount } from './amount.js';  parseAmount('12,000.00') → 12000
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial. microsFromInput was `parseFloat(String(str).replace(',', '.'))`, a
 *     string replace of the FIRST comma, so '1,500.00' became 1.5 and '12,000.00' became 12 with no
 *     warning (appdev pitfall amount-parser-reads-thousands-separator-as-decimal).
 */

/** Characters that only ever group digits: spaces of every width, and the Swiss apostrophes. */
var SPACE_GROUP = /[\s'’]/;
var SPACE_GROUPS = /[\s'’]+/;

/**
 * The digits of a run grouped by one mark, or null when the grouping is not a real one. The first
 * group has one to three digits and the last exactly three; the groups between are all three digits
 * (1,234,567) or all two (the Indian 12,34,56,789).
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
 * Parse an amount written in any common convention into a number, or null.
 *
 * The decimal mark is decided BEFORE anything is stripped, by these rules in order:
 *   - Spaces and apostrophes only ever group: '1 500 000', "1'234.50". Each group after the first
 *     must be three digits, and a single mark after them is the decimal mark: '1 234,56' → 1234.56.
 *   - Both ',' and '.' present: the LAST one is the decimal mark and the other one groups:
 *     '12,000.00' → 12000, '1.234,56' → 1234.56. The decimal mark may appear only once.
 *   - One mark repeated: it groups. '1,000,000' → 1000000, '12,34,56,789' → 123456789.
 *   - One mark once: a decimal mark when one or two digits follow it ('1,5', '1.50'), when four or
 *     more follow it ('1,2345'), when the part before it cannot be a thousands group (a leading zero
 *     as in '0,002', nothing as in '.5', four or more digits as in '1234,567').
 *   - AMBIGUOUS, returns null: one mark followed by exactly three digits, with one to three digits
 *     before it that do not start with 0. '1,000' is one thousand to an English writer and one to a
 *     Finnish one, and '1.000' the other way round. On money a guess is wrong by a factor of a
 *     thousand in one direction or the other, so the caller gets null and asks the person again.
 *
 * Around the number, currency symbols and codes are ignored ('€12', 'USD 1,234.56', '12 EUR'). A
 * leading '-' or '−', or the accounting parentheses '(1,234.00)', make it negative. Anything else
 * inside the number (a second number, a range like '12-15', letters) returns null. A finite number is
 * returned as it is.
 *
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
  // A mark directly before the first digit belongs to the number ('.5', '-,5'), unless a word ends
  // in it ('Rs.1,00,000'). A mark directly after the last digit ends it with no fraction ('5.').
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
    // The group check above allows one mark, in the last group only: it is the decimal mark.
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
