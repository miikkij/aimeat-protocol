/**
 * @file format.js
 * @description Shared SDK-libs core — the one place a served browser library writes a number, a
 *   date or a time for a person to read.
 *
 *   THREE SETTINGS, NOT ONE. Which words a person reads, how their numbers and dates are WRITTEN,
 *   and which clock they keep are three separate things, and they mix them freely the way an
 *   operating system lets them. Twelve of these libraries decided it themselves: some took the
 *   browser's default, some took the app's LANGUAGE and turned it into a format tag, and the
 *   copies disagreed with each other about what English meant.
 *   → decision "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta", 2026-09-12
 *
 *   HOW IT ANSWERS. `AIMEAT.fmt` (cortex aimeat-i18n, 1.2.0 and after) holds the person's own
 *   region and zone, read from their profile. An app that has installed that pack gets their
 *   settings; an app that has not gets the browser's, which is what every reader had here before
 *   any of this existed. Nothing is ever derived from the language.
 *
 *   A DATE IS NOT ALWAYS A MOMENT. A calendar square — a chart's day column, a heat map, the day a
 *   row was counted into — must not be re-read in the reader's zone, or it labels itself the day
 *   before for anyone west of the node. `calendar()` pins those.
 * @structure fmt() · num · money · duration · relative · date · time · dateTime · calendar
 * @usage import { num, dateTime } from '../_core/format.js';
 * @version-history
 *   v1.1.0 — 2026-09-13 — duration() and relative(): a LENGTH of time and a POINT in the past, both
 *     in the reader's words. Four surfaces built the first by hand out of 'd', 'h' and 'min', which
 *     is plain English hardcoded into a page that may be Finnish.
 *   v1.0.0 — 2026-09-12 — Initial, with the sweep that gave the SDK one formatter instead of twelve.
 */

/**
 * The person's formatter, when the app installed aimeat-i18n. Null otherwise.
 *
 * Read off `window.AIMEAT`, which is the namespace every served library attaches to and the one
 * the cortex packs write into. It is deliberately not assumed to exist: an app may install none of
 * them, and then every formatter below falls through to the browser.
 */
function fmt() {
  const ns = typeof window !== 'undefined' ? window.AIMEAT : null;
  return ns && ns.fmt ? ns.fmt : null;
}

/** A number, written the way this reader writes numbers. Non-numbers pass through. */
export function num(n, opts) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n == null ? '' : n);
  const f = fmt();
  if (f && typeof f.num === 'function') return f.num(n, opts);
  try { return n.toLocaleString(undefined, opts); } catch { return String(n); }
}

/**
 * AN AMOUNT OF MONEY, and it refuses morsels when AIMEAT.fmt is there to refuse them.
 *
 * A morsel is a pacer: it paces what agents may push into a person's store, it accrues while they
 * are idle, and it buys nothing. Money is a separate matter with its own rails and sits beside it.
 * A formatter that took both would print "625 €" over a morsel balance, because the two are
 * numbers of the same size on the same screens.
 */
export function money(n, currency, opts) {
  const f = fmt();
  if (f && typeof f.money === 'function') return f.money(n, currency, opts);
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n == null ? '' : n);
  const code = String(currency || 'USD').toUpperCase();
  const digits = (n !== 0 && Math.abs(n) < 0.01) ? 4 : 2;
  const o = Object.assign(
    { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits },
    opts,
  );
  try { return n.toLocaleString(undefined, o); } catch { return num(n) + ' ' + code; }
}

/** A date alone. */
export function date(v, opts) {
  const f = fmt();
  if (f && typeof f.date === 'function') return f.date(v, opts);
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return String(v == null ? '' : v);
  try { return d.toLocaleDateString(undefined, opts); } catch { return String(v); }
}

/** A time alone, on the reader's clock. */
export function time(v, opts) {
  const f = fmt();
  if (f && typeof f.time === 'function') return f.time(v, opts);
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return String(v == null ? '' : v);
  try { return d.toLocaleTimeString(undefined, opts); } catch { return String(v); }
}

/** A date and a time together. */
export function dateTime(v, opts) {
  const f = fmt();
  if (f && typeof f.dateTime === 'function') return f.dateTime(v, opts);
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return String(v == null ? '' : v);
  try { return d.toLocaleString(undefined, opts); } catch { return String(v); }
}

/**
 * The units a span is broken into, biggest first, with how many milliseconds each holds.
 * @type {Array<[keyof Intl.DurationInput, number]>}
 */
const SPAN_UNITS = [['days', 86400000], ['hours', 3600000], ['minutes', 60000], ['seconds', 1000]];

/**
 * A LENGTH OF TIME — "1pv 23t 26min" — in the reader's own language and their own shorthand.
 *
 * A different question from `relative()`, which says how long AGO something was. This is a span.
 *
 * NOT A TRANSLATION KEY, and the reason is worth carrying into every app: `{n} pv` survives Finnish
 * only because `pv` does not inflect, one `{n}` cannot carry a language whose noun changes with the
 * number, and no key can produce "eilen". CLDR holds those rules already.
 *
 * @param {number} ms how long, in milliseconds; a negative span is read as its length
 * @param {Object} [opts] `max` is how many units may appear (default 3); the rest goes to Intl.
 */
export function duration(ms, opts) {
  const n = Math.abs(Number(ms));
  if (!Number.isFinite(n)) return '—';
  const f = fmt();
  if (f && typeof f.duration === 'function') return f.duration(ms, opts);
  const { max = 3, ...rest } = opts || {};
  const parts = {};
  let left = Math.round(n / 1000) * 1000;
  let used = 0;
  for (const [unit, size] of SPAN_UNITS) {
    const v = Math.floor(left / size);
    if (v > 0 || used > 0) {
      if (v > 0) { parts[unit] = v; used++; }
      if (used >= max) break;
    }
    left -= v * size;
  }
  const zero = used === 0;
  if (zero) parts.seconds = 0;
  try {
    return new Intl.DurationFormat(wordTag(), {
      style: 'narrow', ...(zero ? { secondsDisplay: 'always' } : {}), ...rest,
    }).format(parts);
  } catch {
    // Intl.DurationFormat is Baseline since March 2025; an older browser lands here.
    return Object.entries(parts).map(([u, v]) => `${v}${u[0]}`).join(' ');
  }
}

/**
 * The tag to write WORDS with: the page's language, off `<html lang>`.
 *
 * A relative phrase and a duration's unit names are words, and words follow the language a person
 * chose to read rather than the regional format they chose to see numbers in. When aimeat-i18n is
 * installed this never runs — the pack answers from its own locale state — so this is the fallback
 * for an app that has no i18n pack and only the document to ask.
 */
function wordTag() {
  try {
    return (typeof document !== 'undefined' && document.documentElement.getAttribute('lang')) || undefined;
  } catch { return undefined; }
}

/** How long ago, in words. "3 days ago", "eilen" — never a hand-built "3d". */
export function relative(v) {
  const f = fmt();
  if (f && typeof f.relative === 'function') return f.relative(v);
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return String(v == null ? '' : v);
  let value = Math.round((d.getTime() - Date.now()) / 1000);
  /** @type {Array<[Intl.RelativeTimeFormatUnit, number]>} */
  const steps = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.345], ['month', 12], ['year', Infinity]];
  let unit = steps[0][0];
  for (const [u, span] of steps) {
    unit = u;
    if (Math.abs(value) < span) break;
    value = Math.round(value / span);
  }
  try {
    return new Intl.RelativeTimeFormat(wordTag(), { numeric: 'auto' }).format(value, unit);
  } catch {
    return dateTime(d);
  }
}

/**
 * A CALENDAR DATE rather than a moment: pinned to noon UTC so no zone can move the day.
 * Takes a `YYYY-MM-DD` string or a Date whose LOCAL year-month-day is the day meant.
 */
export function calendar(v, opts) {
  if (v == null || v === '') return '';
  let y, m, d;
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return String(v);
    [y, m, d] = [v.getFullYear(), v.getMonth(), v.getDate()];
  } else {
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (!parts) return String(v);
    [y, m, d] = [Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])];
  }
  const at = new Date(Date.UTC(y, m, d, 12));
  const f = fmt();
  const withUtc = Object.assign({}, opts, { timeZone: 'UTC' });
  if (f && typeof f.date === 'function') return f.date(at, withUtc);
  try { return at.toLocaleDateString(undefined, withUtc); } catch { return String(v); }
}
