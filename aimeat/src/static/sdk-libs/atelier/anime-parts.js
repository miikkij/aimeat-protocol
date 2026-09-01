/**
 * @file atelier/anime-parts.js
 * @description The two parts anime.js earns its keep for: a MONTH the hand turns, and a PRICE
 *   TABLE whose figures roll when the billing period changes.
 *
 *     calendar    a month grid — ISO weeks (Monday first by default), today outlined, days
 *                 outside the month dimmed, events as tinted pips (three, then "+N"), prev and
 *                 next month under two buttons. Turning the month repaints the day cells and
 *                 anime staggers them in.
 *     priceTable  plans side by side, the chosen one lifted with an accent edge and a chip, the
 *                 features as a check list, one call to action each. Where the data carries
 *                 yearly prices a segmented month/year control appears, and switching it ROLLS
 *                 the figures to their new value; the cards themselves stay mounted.
 *
 *   anime@4 is vendored on this node (/lib/anime@4.min.js, MIT) and lazy-loaded, one shared load
 *   for whoever asks first. Nothing here depends on it for correctness: before the script lands,
 *   after it fails to land, and whenever the viewer asks for less motion, both parts render the
 *   same picture and every control does the same thing — the library only adds the travel.
 *
 *   Motion is finite and answers a hand or a change. Nothing loops and nothing idles.
 * @structure ensureAnime · withAnime · warmAnime · calendar(spec) · priceTable(spec) —
 *   each part → { el, set, destroy }
 * @usage
 *   AIMEAT.atelier.calendar({ target: host, onPick: (day, events) => open(day), data: {
 *     month: '2026-09',
 *     events: [{ id: 'e1', date: '2026-09-14', title: 'Bake day', tone: 'ok' }] } });
 *   AIMEAT.atelier.priceTable({ target: host, onPick: (plan, period) => buy(plan, period), data: {
 *     currency: '€',
 *     plans: [{ id: 'pro', name: 'Pro', price: 19, priceYearly: 190, highlight: true,
 *               features: ['Every app', 'Your own agents'], cta: 'Choose Pro' }] } });
 * @version-history
 *   v0.44.0 — 2026-09-02 — Initial: the anime.js pair (calendar, priceTable).
 */
import { el, clear, resolve, enter, reducedMotion } from './dom.js';
import { svg } from './chart-core.js';
import { NODE_URL } from '../_core/config.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

/** `window` has no declared `anime`; one cast here beats a cast at every call site. */
const W = /** @type {any} */ (window);

/** One shared load of anime@4, whoever asks first. */
let animePromise = null;
/** Set once the node would not serve the script: stop asking, the parts stand without it. */
let animeOff = false;

/**
 * Load anime@4 from this node, once.
 * @returns {Promise<any>}
 */
function ensureAnime() {
  if (W.anime && W.anime.animate) return Promise.resolve(W.anime);
  if (animePromise) return animePromise;
  animePromise = new Promise(function (ok, fail) {
    const s = document.createElement('script');
    s.src = NODE_URL + '/lib/anime@4.min.js';
    s.onload = function () { ok(W.anime); };
    s.onerror = function () { animePromise = null; fail(new Error('anime failed to load')); };
    document.head.appendChild(s);
  });
  return animePromise;
}

/**
 * Run one piece of travel when the library is there and the viewer wants movement.
 * @param {(anime: any) => void} run
 * @returns {void}
 */
function withAnime(run) {
  if (animeOff || reducedMotion()) return;
  ensureAnime().then(run, function () { animeOff = true; });
}

/** Ask for the library ahead of the change that will want it. A refusal costs only the motion. */
function warmAnime() {
  if (animeOff || reducedMotion()) return;
  ensureAnime().then(null, function () { animeOff = true; });
}

const TONES = ['ok', 'warn', 'err', 'accent'];
function toneOf(value) { return TONES.indexOf(value) >= 0 ? value : 'accent'; }

/* ── The month ──────────────────────────────────────────────────────────────────────────── */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isoDay(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isoMonth(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }

/**
 * 'YYYY-MM' (or a full 'YYYY-MM-DD') to the first of that month in local time. An unreadable
 * value lands on the current month, so a calendar always has something to draw.
 * @param {any} value
 * @returns {Date}
 */
function monthStart(value) {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(value == null ? '' : value));
  const now = new Date();
  if (!m) return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(Number(m[1]), Number(m[2]) - 1, 1);
}

/** A chevron, drawn rather than typed: the interface carries no arrow glyphs. */
function chevron(dir) {
  const node = svg('svg', { class: 'ak-calendar__chev', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' });
  node.appendChild(svg('path', {
    d: dir < 0 ? 'M9 2 L4 7 L9 12' : 'M5 2 L10 7 L5 12',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  return node;
}

/**
 * The month grid.
 * @param {{
 *   target?: string|Element, title?: string, weekStart?: number,
 *   data?: { month?: string,
 *            events?: Array<{ id?: string, date: string, title?: string, tone?: string }> }|null,
 *   onPick?: (day: string, events: any[]) => void,
 *   onMonth?: (month: string) => void,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: object|null }) => void, destroy: () => void }}
 */
export function calendar(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-calendar' });
  if (s.target) resolve(s.target).appendChild(root);
  const weekStart = s.weekStart === 0 ? 0 : 1;

  let data = s.data === undefined ? null : s.data;
  let shown = monthStart(data && data.month);
  let emptyCard = null;

  const title = el('div', { class: 'ak-calendar__title' });
  const grid = el('div', { class: 'ak-calendar__grid', role: 'grid' });
  const head = el('div', { class: 'ak-calendar__head' }, [
    el('button', {
      type: 'button', class: 'ak-calendar__nav', 'aria-label': t('previous'),
      on: { click: function () { turn(-1); } },
    }, chevron(-1)),
    title,
    el('button', {
      type: 'button', class: 'ak-calendar__nav', 'aria-label': t('next'),
      on: { click: function () { turn(1); } },
    }, chevron(1)),
  ]);

  /** Every event of the shown record, gathered under its own day. */
  function eventsByDay() {
    /** @type {Record<string, any[]>} */
    const byDay = {};
    const list = (data && Array.isArray(data.events)) ? data.events : [];
    for (const e of list) {
      if (!e || typeof e.date !== 'string') continue;
      const key = e.date.slice(0, 10);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(e);
    }
    return byDay;
  }

  /** Up to three tinted pips, then how many more the day holds. */
  function pips(events) {
    if (!events.length) return null;
    const wrap = el('span', { class: 'ak-calendar__pips', 'aria-hidden': 'true' });
    events.slice(0, 3).forEach(function (e) {
      wrap.appendChild(el('span', { class: 'ak-calendar__pip ak-calendar__pip--' + toneOf(e.tone) }));
    });
    if (events.length > 3) wrap.appendChild(el('span', { class: 'ak-calendar__more' }, '+' + (events.length - 3)));
    return wrap;
  }

  /**
   * The day cells arrive in a stagger when the library is already there or lands promptly. A LATE
   * arrival is skipped on purpose: the cells are on screen and correct by then, and fading them
   * from nothing at that point is a flash, not an entrance.
   */
  function travel(cells) {
    if (!cells.length) return;
    const asked = Date.now();
    withAnime(function (a) {
      if (Date.now() - asked > 400) return;
      a.animate(cells, { y: [10, 0], opacity: [0, 1], duration: 260, delay: a.stagger(9), ease: 'outQuad' });
    });
  }

  /** The month title and the day cells. The frame around them stays where it is. */
  function paint() {
    const year = shown.getFullYear();
    const mon = shown.getMonth();
    const label = t('m' + (mon + 1)) + ' ' + year;
    title.textContent = label;
    grid.setAttribute('aria-label', label);
    clear(grid);

    const byDay = eventsByDay();
    const today = isoDay(new Date());

    const names = el('div', { class: 'ak-calendar__row ak-calendar__row--head', role: 'row' });
    for (let i = 0; i < 7; i++) {
      names.appendChild(el('span', { class: 'ak-calendar__wd', role: 'columnheader' }, WEEKDAYS[(weekStart + i) % 7]));
    }
    grid.appendChild(names);

    const lead = (new Date(year, mon, 1).getDay() - weekStart + 7) % 7;
    const length = new Date(year, mon + 1, 0).getDate();
    const weeks = Math.ceil((lead + length) / 7);
    const cursor = new Date(year, mon, 1 - lead);
    const cells = [];
    for (let w = 0; w < weeks; w++) {
      const row = el('div', { class: 'ak-calendar__row', role: 'row' });
      for (let i = 0; i < 7; i++) {
        const day = isoDay(cursor);
        const events = byDay[day] || [];
        const outside = cursor.getMonth() !== mon;
        const hover = events.map(function (e) { return String(e.title || ''); }).filter(Boolean).join(' · ');
        const button = el('button', {
          type: 'button',
          class: 'ak-calendar__day'
            + (outside ? ' ak-calendar__day--out' : '')
            + (day === today ? ' ak-calendar__day--today' : ''),
          'aria-label': day + (events.length ? ' · ' + events.length : ''),
          'aria-current': day === today ? 'date' : null,
          title: hover || null,
          on: s.onPick ? { click: function () { s.onPick(day, events); } } : undefined,
        }, [
          el('span', { class: 'ak-calendar__num' }, String(cursor.getDate())),
          pips(events),
        ]);
        row.appendChild(el('div', { class: 'ak-calendar__cell', role: 'gridcell' }, button));
        cells.push(button);
        cursor.setDate(cursor.getDate() + 1);
      }
      grid.appendChild(row);
    }
    travel(cells);
  }

  /** One month back or forward, under the hand. */
  function turn(step) {
    shown = new Date(shown.getFullYear(), shown.getMonth() + step, 1);
    paint();
    if (s.onMonth) s.onMonth(isoMonth(shown));
  }

  function render() {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    if (!data) {
      const e = s.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || s.title || t('empty'),
        hint: e.hint || t('emptyHint'),
      });
      return;
    }
    if (s.title) root.appendChild(el('div', { class: 'ak-calendar__name' }, String(s.title)));
    root.appendChild(head);
    root.appendChild(grid);
    paint();
    enter(root);
  }

  render();
  return {
    el: root,
    set: function (patch) {
      if (!patch || !('data' in patch)) return;
      data = patch.data || null;
      shown = monthStart(data && data.month);
      render();
    },
    destroy: function () {
      if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
      root.remove();
    },
  };
}

/* ── The price table ────────────────────────────────────────────────────────────────────── */

const PERIODS = ['month', 'year'];

/** An ISO code Intl can look a currency up by, or nothing when the data carries a symbol. */
function currencyCode(value) {
  return /^[A-Z]{3}$/.test(String(value == null ? '' : value)) ? String(value) : null;
}

/**
 * Whole units, grouped the way the viewer's locale groups numbers. A three-letter code goes
 * through Intl's own currency style; a symbol like '€' is placed in front of the grouped number,
 * because Intl has nothing to look that up by.
 * @param {number} value
 * @param {string} currency
 * @returns {string}
 */
function money(value, currency) {
  const whole = Math.round(Number(value) || 0);
  const code = currencyCode(currency);
  if (typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function') {
    if (code) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(whole);
    }
    return String(currency) + new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(whole);
  }
  return String(currency) + whole;
}

/**
 * What this plan costs over the asked period. `priceYearly` is believed when it is there; without
 * it a monthly price is multiplied and a yearly one divided, and nothing is invented beyond that.
 * @param {any} plan
 * @param {string} period
 * @returns {number}
 */
function priceFor(plan, period) {
  const base = Number(plan.price) || 0;
  const own = plan.period === 'year' ? 'year' : 'month';
  if (period === 'year') {
    if (typeof plan.priceYearly === 'number') return plan.priceYearly;
    return own === 'year' ? base : base * 12;
  }
  return own === 'year' ? base / 12 : base;
}

/**
 * The price table.
 * @param {{
 *   target?: string|Element, title?: string,
 *   data?: { plans: Array<{ id: string, name?: string, price: number, period?: string,
 *                           priceYearly?: number, features?: string[], highlight?: boolean,
 *                           cta?: string, note?: string }>,
 *            currency?: string, periods?: string[] }|null,
 *   onPick?: (plan: any, period: string) => void,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: object|null }) => void, destroy: () => void }}
 */
export function priceTable(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-price' });
  if (s.target) resolve(s.target).appendChild(root);

  let data = s.data === undefined ? null : s.data;
  let period = 'month';
  let currency = '€';
  let emptyCard = null;
  /** One entry per card: the figure element, its unit line, and the number now on screen. */
  let figures = [];
  /** The segmented control's buttons, so a change moves aria-pressed without a repaint. */
  let periodButtons = [];

  /** Which periods this data offers: what it declares, else month plus year if a plan has one. */
  function periodsOf(plans) {
    const declared = (data && Array.isArray(data.periods))
      ? data.periods.filter(function (p) { return PERIODS.indexOf(p) >= 0; })
      : [];
    if (declared.length) return declared;
    const yearly = plans.some(function (p) { return typeof p.priceYearly === 'number'; });
    return yearly ? ['month', 'year'] : ['month'];
  }

  /**
   * The figures travel to their new value. When the library is not there yet the number is simply
   * written — a roll that starts from a stale figure after a delay would be a lie for its whole
   * length — and the load is asked for, so the next change rolls.
   */
  function roll() {
    const engine = (!reducedMotion() && W.anime && W.anime.animate) ? W.anime : null;
    figures.forEach(function (f) {
      f.per.textContent = '/' + period;
      const to = Math.round(priceFor(f.plan, period));
      const from = f.shown;
      f.shown = to;
      if (!engine || from === to) { f.amount.textContent = money(to, currency); return; }
      const box = { v: from };
      engine.animate(box, {
        v: to, duration: 520, ease: 'outQuad',
        onUpdate: function () { f.amount.textContent = money(box.v, currency); },
        onComplete: function () { f.amount.textContent = money(to, currency); },
      });
    });
    warmAnime();
  }

  function pick(next) {
    if (next === period) return;
    period = next;
    periodButtons.forEach(function (b) {
      b.node.setAttribute('aria-pressed', b.id === next ? 'true' : 'false');
    });
    roll();
  }

  function segments(periods) {
    periodButtons = [];
    const bar = el('div', { class: 'ak-price__periods', role: 'group', 'aria-label': 'Billing period' });
    periods.forEach(function (p) {
      const node = el('button', {
        type: 'button', class: 'ak-price__period',
        'aria-pressed': p === period ? 'true' : 'false',
        on: { click: function () { pick(p); } },
      }, p === 'year' ? 'Year' : 'Month');
      periodButtons.push({ id: p, node: node });
      bar.appendChild(node);
    });
    return bar;
  }

  function card(plan) {
    const value = Math.round(priceFor(plan, period));
    const amount = el('span', { class: 'ak-price__amount' }, money(value, currency));
    const per = el('span', { class: 'ak-price__per' }, '/' + period);
    figures.push({ plan: plan, amount: amount, per: per, shown: value });

    const features = el('ul', { class: 'ak-price__features' });
    (Array.isArray(plan.features) ? plan.features : []).forEach(function (f) {
      features.appendChild(el('li', { class: 'ak-price__feature' }, [
        el('span', { class: 'ak-price__check', 'aria-hidden': 'true' }, '✓'),
        el('span', {}, String(f)),
      ]));
    });

    return el('article', {
      class: 'ak-price__card' + (plan.highlight ? ' ak-price__card--lift' : ''),
    }, [
      plan.highlight ? el('span', { class: 'ak-price__chip' }, 'Most chosen') : null,
      el('h3', { class: 'ak-price__name' }, String(plan.name || plan.id)),
      el('div', { class: 'ak-price__figure' }, [amount, per]),
      features,
      plan.note ? el('p', { class: 'ak-price__note' }, String(plan.note)) : null,
      el('button', {
        type: 'button', class: 'ak-btn ak-btn--primary ak-price__cta',
        on: s.onPick ? { click: function () { s.onPick(plan, period); } } : undefined,
      }, String(plan.cta || 'Choose')),
    ].filter(Boolean));
  }

  function render() {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    figures = [];
    periodButtons = [];
    const plans = (data && Array.isArray(data.plans)) ? data.plans.filter(function (p) { return p && p.id; }) : [];
    if (!plans.length) {
      const e = s.empty || {};
      emptyCard = emptyState({
        target: root, tone: 'quiet',
        title: e.title || s.title || t('empty'),
        hint: e.hint || t('emptyHint'),
      });
      return;
    }
    currency = (data && data.currency) || '€';
    const periods = periodsOf(plans);
    if (periods.indexOf(period) < 0) period = periods[0];

    if (s.title) root.appendChild(el('div', { class: 'ak-price__title' }, String(s.title)));
    if (periods.length > 1) {
      root.appendChild(segments(periods));
      // The toggle is the reason this part carries a library: have it ready before it is pressed.
      warmAnime();
    }
    const cards = el('div', { class: 'ak-price__cards' });
    plans.forEach(function (plan) { cards.appendChild(card(plan)); });
    root.appendChild(cards);
    enter(root);
  }

  render();
  return {
    el: root,
    set: function (patch) {
      if (!patch || !('data' in patch)) return;
      data = patch.data || null;
      render();
    },
    destroy: function () {
      if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
      root.remove();
    },
  };
}
