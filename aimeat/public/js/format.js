/**
 * @file format.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical display formatters shared across the frontend: dates, times, numbers,
 *   money, morsels, byte counts and uptime. Every one of them writes the way THIS READER writes,
 *   and reads the clock THIS READER keeps.
 *
 *   THE FORMAT IS NOT THE LANGUAGE. The pill at the top of the page decides which words appear; it
 *   does not decide whether a date is 9/12/2026 or 12.9.2026, and it does not decide which clock
 *   the reader is looking at. Those two come from the profile, and when the profile says nothing
 *   they come from the browser — which is what every surface did before, so an account that never
 *   opened the settings sees no change at all. → /js/display-prefs.js, and the decision
 *   "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta" (2026-09-12).
 *
 *   WHAT THIS REPLACED. `dt()` called `toLocaleString()` with no arguments, so a Finnish page
 *   printed 9/12/2026, 3:11 PM to anyone whose browser was English. Six files under
 *   public/views/profile carried their own copy of
 *     const localeTag = () => (getLocale() === 'fi' ? 'fi-FI' : ... : 'en-GB');
 *   which derived the format from the LANGUAGE — the thing that was just ruled against — and the
 *   copies had already drifted apart: five gave en-GB, the money one gave en-US.
 *
 *   MORSELS ARE NOT MONEY, AND `money()` REFUSES THEM. A morsel is a pacer: it paces what agents
 *   may push into the store, it accrues on its own, and it buys nothing. Money is a separate matter
 *   with its own rails. A formatter that accepted both would print "625 €" over a morsel balance
 *   inside a month, because the two are numbers of the same size sitting next to each other on the
 *   same pages. `morsels()` is the one that formats them, and it never attaches a currency symbol.
 * @structure num · dt · date · time · dateTime · relative · money · morsels · fmtUp · fmtBytes
 * @usage import { num, dt, money, morsels } from '/js/format.js';
 *   num(1234)                    → "1 234"      in the reader's own format
 *   dt('2026-01-02T…')           → date and time, in the reader's own clock
 *   money(12.5, 'EUR')           → "12,50 €"
 *   morsels(625)                 → "625 morsels" — never a currency symbol
 * @version-history
 *   v2.3.0 — 2026-09-12 — calendar(): a DATE rather than a moment, pinned so no zone can slide it.
 *     A heat-map square, a month rail and a usage day are days on a calendar, not instants, and
 *     re-reading them in the reader's clock had them label themselves as the day before.
 *   v2.2.0 — 2026-09-12 — dayKey() and sameDay(): which calendar day an instant falls on IN THE
 *     READER'S ZONE. Four surfaces asked `toDateString()`, which answers for the BROWSER's zone, so
 *     a reader on another clock could see a row's time under a day heading it did not belong to.
 *   v2.1.0 — 2026-09-12 — A caller that names a `timeZone` keeps it. Without this a calendar-day
 *     bucket (a usage row keyed by the UTC day) was re-read in the reader's own zone and could show
 *     the previous day to anyone west of the node, which is a wrong number rather than a wrong
 *     format. A moment still passes no zone and still gets the reader's.
 *   v2.0.0 — 2026-09-12 — Every formatter follows the reader's own region and time zone, from the
 *     profile, falling back to the browser. Adds date/time/dateTime/relative/money/morsels/compare,
 *     which is what the twenty hand-rolled language-to-format helpers were each doing their own way.
 *     Supersedes v1.1.0 below, which was reaching for the same thing one step short: the page's
 *     language is a better guess than the browser's, and the reader's own answer beats both. `day`
 *     from that round is kept, because admin/shared.js re-exports it.
 *   v1.1.0 — 2026-09-12 — The page's language decides the format, not the browser's (another
 *     session, same day): a Finnish page printed "9/12/2026, 2:25:42 PM" inside an otherwise
 *     Finnish sentence. `day()` arrived here because two pages had written their own.
 *   v1.0.0 — 2026-06-02 — Component unification (#12): promote admin's num/dt/fmtUp/
 *     fmtBytes to a shared module; admin/shared.js now re-exports from here.
 */
import { getRegion, getTimeZone } from '/js/display-prefs.js';
import { swallowed } from '/js/swallowed.js';

/** The tag to format with: the reader's own, or undefined, which IS the browser default. */
function tag() {
  return getRegion() || undefined;
}

/**
 * Merge the reader's clock into a format option bag. No zone stored: the browser's own applies.
 *
 * A CALLER THAT NAMES A ZONE WINS, and the case that needs it is a calendar day rather than a
 * moment: a usage row bucketed by the UTC day means the same day to everybody, and re-reading it
 * in the reader's own zone slides it backwards for anyone west of the node. Such a caller passes
 * `timeZone: 'UTC'` and means it. Everything that is a real instant passes no zone and gets theirs.
 */
function withZone(opts) {
  if (opts && opts.timeZone) return opts;
  const tz = getTimeZone();
  return tz ? { ...opts, timeZone: tz } : opts;
}

/**
 * Format a number the way this reader writes numbers. Non-numbers pass through (nullish → em dash).
 *
 * A thousands separator is a space in Finnish, a comma in English and a full stop in German, and
 * getting it wrong is the kind of thing a person notices without being able to say why.
 */
export function num(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n ?? '—');
  try { return n.toLocaleString(tag()); } catch { return String(n); }
}

/** A date alone: no clock, so no zone label is ever needed. */
export function date(s, opts) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return String(s);
  try { return d.toLocaleDateString(tag(), withZone(opts)); } catch { return String(s); }
}

/** A time alone, in the reader's clock. */
export function time(s, opts) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return String(s);
  try { return d.toLocaleTimeString(tag(), withZone(opts)); } catch { return String(s); }
}

/** A date and a time together, in the reader's own format and clock. */
export function dateTime(s, opts) {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return String(s);
  try { return d.toLocaleString(tag(), withZone(opts)); } catch { return String(s); }
}

/**
 * A CALENDAR DATE — a square on a grid, a day a usage row was counted into, a birthday — rather
 * than a moment. Written in the reader's own format, and pinned so that no zone can move it.
 *
 * `date()` is for an instant and rightly re-reads it in the reader's clock. Do that to a calendar
 * square and it slides: a cell built as local midnight, redrawn in a zone two hours west, labels
 * itself the previous day, and a month rail can then start a month early. Pass a `YYYY-MM-DD`
 * string or a Date whose LOCAL year-month-day is the day you mean.
 */
export function calendar(value, opts) {
  if (!value) return '—';
  let y, m, d;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return String(value);
    [y, m, d] = [value.getFullYear(), value.getMonth(), value.getDate()];
  } else {
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!parts) return String(value);
    [y, m, d] = [Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])];
  }
  // Noon UTC, formatted in UTC: the day is then the day, whatever the reader's clock says.
  const at = new Date(Date.UTC(y, m, d, 12));
  try { return at.toLocaleDateString(tag(), { ...opts, timeZone: 'UTC' }); } catch { return String(value); }
}

/**
 * The calendar day an instant falls on IN THE READER'S ZONE, as a sortable `YYYY-MM-DD` key.
 *
 * For "is this today", "is this yesterday" and for grouping a list under day headings. The obvious
 * way — `new Date(s).toDateString()` — asks the BROWSER's zone, so a reader who set a different one
 * saw a row stamped with a clock under a heading a day away from it, on the same screen. This is a
 * key rather than a display, so the tag is fixed: `en-CA` is the one that writes a plain ISO day.
 */
export function dayKey(s) {
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return d.toLocaleDateString('en-CA', withZone(undefined));
  } catch (err) {
    // A stored zone the runtime refuses. Say so once and answer with the browser's own day, which
    // is what every caller here did before there was a setting at all.
    swallowed('format: dayKey fell back to the browser day', err);
    return d.toLocaleDateString('en-CA');
  }
}

/** Whether two instants fall on the same calendar day in the reader's own zone. */
export function sameDay(a, b) {
  const ka = dayKey(a);
  return !!ka && ka === dayKey(b);
}

/** The name this module has always had for a date-and-time. Kept, because 161 places call it. */
export const dt = dateTime;

/** The date alone, for a line that has no use for the clock. The name admin/shared.js imports. */
export const day = date;

/**
 * "3 days ago", "in 2 hours" — in the reader's language for the words and their format for the number.
 *
 * The one formatter here that IS language-shaped, because its output is words. It takes the tag
 * anyway: a reader whose words are Finnish and whose format is en-GB gets the English phrasing, and
 * that is the consistent answer rather than a special case, because every other number on the same
 * row is written in that same format.
 */
export function relative(s) {
  if (!s) return '—';
  const then = new Date(s).getTime();
  if (!Number.isFinite(then)) return String(s);
  /** @type {Intl.RelativeTimeFormatUnit[]} */
  const units = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'];
  const spans = [60, 60, 24, 7, 4.345, 12, Infinity];
  let value = Math.round((then - Date.now()) / 1000);
  let unit = units[0];
  for (let i = 0; i < units.length; i++) {
    unit = units[i];
    if (Math.abs(value) < spans[i]) break;
    value = Math.round(value / spans[i]);
  }
  try {
    return new Intl.RelativeTimeFormat(tag(), { numeric: 'auto' }).format(value, unit);
  } catch {
    return String(s);
  }
}

/**
 * Compare two strings the way this reader's alphabet orders them.
 *
 * Sorting is the same question as formatting, not the same question as words: ä comes after z in
 * Finnish and next to a in English, and which one a reader expects follows the format they chose
 * rather than the language the buttons are in. A named function rather than an exported tag,
 * because an exported tag is exactly the escape hatch that produced twenty copies of `localeTag()`.
 */
export function compare(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), tag());
}

/**
 * An amount of MONEY, in the reader's own format.
 *
 * REFUSES MORSELS, deliberately and loudly. A morsel is a pacer rather than a currency: it paces
 * what agents may push into the store, it accrues while the owner is idle, and it buys nothing.
 * Money has its own rails (Stripe, x402, ACP, UCP) and sits beside morsels rather than counting
 * them. The two are numbers of similar size on the same pages, so a formatter that accepted both
 * would eventually print a euro sign over somebody's pacing meter — which would tell every reader
 * something false about what this platform is. Use `morsels()`.
 */
export function money(n, currency = 'USD', opts) {
  const code = String(currency || '').toUpperCase();
  if (code === 'MORSEL' || code === 'MORSELS' || code === 'MRSL') {
    throw new TypeError(
      'money() will not format morsels: a morsel is a pacer, not a currency, and it buys nothing. Use morsels().');
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  // Below a cent the ordinary two decimals round every small figure to 0.00, and most AI costs on
  // this platform are small figures.
  const digits = Math.abs(n) > 0 && Math.abs(n) < 0.01 ? 4 : 2;
  try {
    return new Intl.NumberFormat(tag(), {
      style: 'currency', currency: code || 'USD',
      minimumFractionDigits: digits, maximumFractionDigits: digits, ...opts,
    }).format(n);
  } catch {
    return `${num(n)} ${code}`;
  }
}

/**
 * A morsel count, which is a count and never an amount.
 *
 * No currency symbol, ever. The word travels with the number so that nobody reading a row of
 * figures has to work out which of them is money.
 */
export function morsels(n, word = 'morsels') {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `${num(n)} ${word}`;
}

/** Format uptime seconds as a human-readable "Nd Nh Nm" (sub-minute → "<1m"). */
export function fmtUp(s) {
  const d = Math.floor(s / 86400);
  const hr = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (d ? d + 'd ' : '') + (hr ? hr + 'h ' : '') + (m ? m + 'm' : '<1m');
}

/** Format a byte count as B / KB / MB, with the reader's own decimal mark. */
export function fmtBytes(b) {
  if (typeof b !== 'number' || !Number.isFinite(b)) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toLocaleString(tag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' KB';
  return (b / 1048576).toLocaleString(tag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB';
}
