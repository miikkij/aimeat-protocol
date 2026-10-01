/**
 * @file atelier/lenis-parts.js
 * @description The two parts whose whole point is a scroller with a hand on it, riding Lenis
 *   1.3.26 (vendored on this node at /lib/lenis@1.min.js, MIT):
 *     thread    a discussion: a fixed-height well of bubbles grouped by day, mine on the right in
 *               the accent tint, others on the left, an agent's bubble squared the way the crew
 *               stack squares an agent's face, and a composer where Enter sends and Shift+Enter
 *               makes a new line. New messages arrive on the kit's stagger and the well travels
 *               to the newest one.
 *     checkout  ONE long page in four sections (Your order, Details, Delivery, Review) with a step
 *               rail beside it that carries the eye to a section and marks the section in view.
 *
 *   LENIS IS THE SMOOTHNESS AND NEVER THE CORRECTNESS. Script and stylesheet are lazy-loaded from
 *   this node behind one shared promise, the way map.js loads Leaflet. Until they land, and under
 *   reduced motion where they are never asked for at all, both parts scroll with the browser's own
 *   scrollTop and behave the same in every other respect. One instance per component, torn down in
 *   destroy(), so a page that mounts and drops these leaves nothing running.
 *
 *   NO PAYMENT SECRET IS COLLECTED HERE. The checkout REPORTS an order (lines, delivery, contact,
 *   note) and the node's own rails take the money. There is no card number, expiry or security-code
 *   field in this file, and none may be added: a component that renders one turns every app that
 *   embeds it into a place people type card numbers.
 * @structure ensureLenis · wellScroller · thread(spec) → { el, set, destroy } ·
 *   checkout(spec) → { el, set, destroy }
 * @usage
 *   AIMEAT.atelier.thread({ target: host, data: { messages: [
 *     { id: 'm1', who: 'jouni', label: 'Jouni', text: 'Where are we?', at: '2026-09-02T08:10:00Z' },
 *     { id: 'm2', who: 'scout', label: 'Scout', agent: true, text: 'Two left.', at: '…' } ] },
 *     onSend(text) { post(text); } });
 *   AIMEAT.atelier.checkout({ target: host, data: {
 *     lines: [{ id: 'l1', title: 'Filter coffee, 1 kg', price: 18.9, qty: 2 }],
 *     shipping: [{ id: 'std', label: 'Posti, 2 to 4 days', price: 5.9 }] },
 *     onSubmit(order) { place(order); } });
 *   Amounts straight from AIMEAT.commerce (6-decimal micro-units): `unit: 'micros'` on the data,
 *   or `priceMicros` on a line or a delivery option. Currency 'morsels' shows a morsel count.
 * @version-history
 *   v0.62.1 — 2026-10-01 — The words of thread and checkout come from the kit dictionary
 *     (./i18n.js, en/fi/es, overridable with i18n.use()): section names, field labels and hints,
 *     buttons, totals, refusals, statuses and the day headings. The field list and the step names
 *     are built at mount, so they follow the language in force. The English text is unchanged.
 *   v0.62.0 — 2026-10-01 — checkout reads commerce amounts: `unit: 'micros'` and `priceMicros` on
 *     lines and shipping (decimals kept, up to six when sub-cent), and currency 'morsels' (an
 *     integer and the kit's word, never money), through ./money-units.js. Plain numbers unchanged.
 *   v0.44.0 — 2026-09-02 — Initial (wish-atelier-motion-libraries-and-parts, the Lenis pair).
 */
import { el, clear, resolve, reducedMotion, attention, uid } from './dom.js';
import { NODE_URL } from '../_core/config.js';
import { num, money as fmtMoney, date, time } from '../_core/format.js';
import { emptyState } from './state.js';
import { form } from './form.js';
import { stagger } from './motion.js';
import { t } from './i18n.js';
import { isMorsels, speaksMicros, readAmount, roundMicros, fractionDigits, morselText } from './money-units.js';

/** One shared load of Lenis (script + stylesheet), whoever asks first. */
let lenisPromise = null;
function ensureLenis() {
  const w = /** @type {any} */ (window);
  if (w.Lenis) return Promise.resolve(w.Lenis);
  if (lenisPromise) return lenisPromise;
  lenisPromise = new Promise(function (ok, fail) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = NODE_URL + '/lib/lenis@1.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = NODE_URL + '/lib/lenis@1.min.js';
    s.onload = function () { ok(w.Lenis); };
    s.onerror = function () { lenisPromise = null; fail(new Error('lenis failed to load')); };
    document.head.appendChild(s);
  });
  return lenisPromise;
}

/**
 * The travel over one scrolling well. Lenis drives it once the pack lands; until then, and under
 * reduced motion, the browser's own scrolling does the same job. Every method behaves the same
 * either way, so nothing a caller does depends on which one is in charge.
 * @param {HTMLElement} well     the element that scrolls
 * @param {HTMLElement} content  the element inside it
 * @returns {{ to: (node: HTMLElement, offset?: number) => void,
 *   toBottom: (node?: HTMLElement|null) => void, destroy: () => void }}
 */
function wellScroller(well, content) {
  /** @type {any} */
  let engine = null;
  let dead = false;

  if (!reducedMotion()) {
    ensureLenis().then(function (Lenis) {
      if (dead) return;
      engine = new Lenis({ wrapper: well, content: content, autoRaf: true });
    }, function (err) {
      // Said out loud rather than swallowed: the well still scrolls, it just does not glide.
      console.warn('aimeat-atelier: lenis did not load, the browser scrolls this well', err);
    });
  }

  /** @param {number} top */
  function plain(top) {
    const to = Math.max(0, top);
    if (typeof well.scrollTo === 'function') {
      well.scrollTo({ top: to, behavior: reducedMotion() ? 'auto' : 'smooth' });
    } else {
      well.scrollTop = to;
    }
  }

  /** Where a node sits inside the well, whatever the positioning around it. */
  function topOf(node) {
    return well.scrollTop + (node.getBoundingClientRect().top - well.getBoundingClientRect().top);
  }

  return {
    to(node, offset) {
      if (!node) return;
      const pad = offset || 0;
      if (engine) { engine.scrollTo(node, { offset: pad, duration: 0.7 }); return; }
      plain(topOf(node) + pad);
    },
    toBottom(node) {
      if (engine && node) {
        // Bottom-align the newest: pull it up by everything above it in the well.
        engine.scrollTo(node, { offset: -Math.max(0, well.clientHeight - node.offsetHeight - 12), duration: 0.7 });
        return;
      }
      plain(well.scrollHeight);
    },
    destroy() {
      dead = true;
      if (engine) { engine.destroy(); engine = null; }
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   thread — the discussion
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** The dictionary key for each message status the bubble names. */
const STATUS_KEYS = { sent: 'threadSent', read: 'threadRead', failed: 'threadFailed' };

/** @param {string|number|Date|undefined} at @returns {Date|null} */
function dateOf(at) {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The day a message belongs to, as a key that sorts and compares. */
function dayKeyOf(at) {
  const d = dateOf(at);
  if (!d) return 'unknown';
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/** Today, Yesterday, or the date itself. */
function dayLabelOf(at) {
  const d = dateOf(at);
  if (!d) return t('earlier');
  const now = new Date();
  const key = dayKeyOf(at);
  if (key === dayKeyOf(now)) return t('today');
  const back = new Date(now.getTime() - 86400000);
  if (key === dayKeyOf(back)) return t('yesterday');
  if (typeof Intl === 'object' && Intl.DateTimeFormat) {
    return date(d, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  return d.toDateString();
}

/** The clock time on a bubble. */
function timeLabelOf(at) {
  const d = dateOf(at);
  if (!d) return '';
  if (typeof Intl === 'object' && Intl.DateTimeFormat) {
    return time(d, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toTimeString().slice(0, 5);
}

/** At most two letters for the small face beside a bubble. */
function initialsOf(who) {
  return String(who || '?').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
}

/** The messages out of whatever the caller (or a bound source) handed over. */
function messagesOf(d) {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.messages)) return d.messages;
  return [];
}

/**
 * The discussion thread.
 * @param {{
 *   target?: string|Element, title?: string, placeholder?: string,
 *   data?: { messages?: Array<{ id: string, who: string, label?: string, text: string, at: string,
 *     mine?: boolean, agent?: boolean, status?: 'sent'|'read'|'failed' }> }|Array<any>|null,
 *   onSend?: (text: string) => void, empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: any }) => void, destroy: () => void }}
 */
export function thread(spec) {
  const s = spec || {};
  const stream = el('div', { class: 'ak-thread__stream' });
  const well = el('div', {
    class: 'ak-thread__well', role: 'log', 'aria-live': 'polite', tabindex: '0',
    'aria-label': s.title || t('threadLabel'),
  }, [stream]);
  const root = el('section', { class: 'ak-root ak-thread' }, [
    s.title ? el('h2', { class: 'ak-section__title ak-thread__title' }, String(s.title)) : null,
    well,
  ].filter(Boolean));
  if (s.target) resolve(s.target).appendChild(root);

  const view = wellScroller(well, stream);
  /** @type {Map<string, HTMLElement>} */
  const shown = new Map();
  /** @type {Map<string, HTMLElement>} */
  const dayRows = new Map();
  /** @type {{ destroy: () => void }|null} */
  let blank = null;

  /** @param {any} m */
  function bubbleFor(m) {
    const who = String(m.label || m.who || '');
    const word = STATUS_KEYS[m.status] ? t(STATUS_KEYS[m.status]) : '';
    const meta = el('div', { class: 'ak-thread__meta' }, [
      el('time', { class: 'ak-thread__time', datetime: m.at || null }, timeLabelOf(m.at)),
      word ? el('span', { class: 'ak-thread__status ak-thread__status--' + m.status }, word) : null,
    ].filter(Boolean));
    const bubble = el('div', { class: 'ak-thread__bubble' }, [
      m.mine ? null : el('div', { class: 'ak-thread__who' }, who),
      el('p', { class: 'ak-thread__text' }, String(m.text == null ? '' : m.text)),
      meta,
    ].filter(Boolean));
    return el('article', {
      class: 'ak-thread__msg' + (m.mine ? ' ak-thread__msg--mine' : '') + (m.agent ? ' ak-thread__msg--agent' : ''),
      'data-ak-msg': String(m.id),
    }, [
      el('span', { class: 'ak-thread__avatar', 'aria-hidden': 'true', title: who }, initialsOf(who)),
      bubble,
    ]);
  }

  /** @param {any[]} list */
  function render(list) {
    const msgs = Array.isArray(list) ? list : [];
    if (!msgs.length) {
      shown.clear();
      dayRows.clear();
      clear(stream);
      const e = s.empty || {};
      blank = emptyState({
        target: stream, tone: 'quiet',
        title: e.title || t('threadEmpty'),
        hint: e.hint || (s.onSend ? t('threadEmptyHint') : undefined),
      });
      return;
    }
    if (blank) { blank.destroy(); blank = null; }

    const seen = new Set();
    const liveDays = new Set();
    /** @type {HTMLElement[]} */
    const fresh = [];
    msgs.forEach(function (m) {
      const id = String(m.id);
      const key = dayKeyOf(m.at);
      seen.add(id);
      liveDays.add(key);
      if (!dayRows.has(key)) {
        const row = el('div', { class: 'ak-thread__day' }, [el('span', {}, dayLabelOf(m.at))]);
        dayRows.set(key, row);
        stream.appendChild(row);
      }
      // Diff by id: a bubble already on screen is left exactly where it is, so the well never
      // re-mounts a conversation to add one line to the end of it.
      if (shown.has(id)) return;
      const node = bubbleFor(m);
      shown.set(id, node);
      stream.appendChild(node);
      fresh.push(node);
    });

    Array.from(shown.keys()).forEach(function (id) {
      if (seen.has(id)) return;
      const node = shown.get(id);
      if (node && node.parentNode) node.parentNode.removeChild(node);
      shown.delete(id);
    });
    Array.from(dayRows.keys()).forEach(function (key) {
      if (liveDays.has(key)) return;
      const row = dayRows.get(key);
      if (row && row.parentNode) row.parentNode.removeChild(row);
      dayRows.delete(key);
    });

    if (!fresh.length) return;
    stagger(fresh, { from: 'up' });
    const last = fresh[fresh.length - 1];
    // One frame later: a bubble appended this tick has no measured height yet.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { view.toBottom(last); });
    else view.toBottom(last);
  }

  if (s.onSend) {
    const hint = s.placeholder || t('threadPlaceholder');
    const input = /** @type {HTMLTextAreaElement} */ (el('textarea', {
      class: 'ak-input ak-input--area ak-thread__input', rows: 2,
      placeholder: hint, 'aria-label': hint,
    }));
    const send = function () {
      const text = input.value.trim();
      if (!text) { attention(input, 'shake'); return; }
      input.value = '';
      s.onSend(text);
    };
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
    });
    root.appendChild(el('div', { class: 'ak-thread__composer' }, [
      input,
      el('button', { type: 'button', class: 'ak-btn ak-btn--primary', on: { click: send } }, t('send')),
    ]));
  }

  render(messagesOf(s.data));

  return {
    el: root,
    set(patch) {
      if (!patch || !('data' in patch)) return;
      render(messagesOf(patch.data));
    },
    destroy() {
      view.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   checkout — one long page, four sections, a rail beside it
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** The four section names, in the kit's language. @returns {string[]} */
function stepNames() {
  return [t('coOrder'), t('coDetails'), t('coDelivery'), t('coReview')];
}

/**
 * The contact fields. Name, reach and address, and nothing else: the money is the node's business,
 * so a card number has no field here and never will. Labels in the kit's language at mount time.
 * @returns {import('./form.js').FormField[]}
 */
function detailFields() {
  return [
    { name: 'name', label: t('coName'), type: 'text', required: true },
    { name: 'email', label: t('coEmail'), type: 'text', required: true, hint: t('coEmailHint') },
    { name: 'address', label: t('coAddress'), type: 'text', required: true },
    { name: 'postcode', label: t('coPostcode'), type: 'text', required: true },
    { name: 'city', label: t('coCity'), type: 'text', required: true },
    { name: 'country', label: t('coCountry'), type: 'text' },
  ];
}

/**
 * Money in the reader's own number habits; the symbol or code is the caller's. A figure from
 * micro-units keeps two decimals, up to six when sub-cent; a morsel count is an integer with the
 * kit's word and never money.
 * @param {number} value  whole currency units, or a morsel count
 * @param {string} [currency]
 * @param {boolean} [micros]  the figure came from micro-units
 * @returns {string}
 */
function money(value, currency, micros) {
  if (isMorsels(currency)) return morselText(value);
  const v = micros ? roundMicros(value) : Math.round((Number(value) || 0) * 100) / 100;
  const d = micros ? fractionDigits(v) : 2;
  const cur = currency || '€';
  if (typeof Intl === 'object' && Intl.NumberFormat) {
    if (/^[A-Za-z]{3}$/.test(cur)) {
      try {
        return fmtMoney(v, cur, { minimumFractionDigits: d, maximumFractionDigits: d });
      } catch {
        // An unknown code: fall through and show the number with the code beside it.
      }
    }
    return num(v, { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ' + cur;
  }
  return v.toFixed(d) + ' ' + cur;
}

/**
 * The checkout. Component-only: it is a whole page rather than a block, so it is not in the mosaic
 * vocabulary, the same rule the dialog family follows.
 * @param {{
 *   target?: string|Element,
 *   data: { lines: Array<{ id: string, title: string, sub?: string, price?: number,
 *       priceMicros?: number, qty: number }>,
 *     currency?: string, unit?: 'micros',
 *     shipping?: Array<{ id: string, label: string, price?: number, priceMicros?: number }>,
 *     steps?: string[] },
 *   onSubmit?: (order: { lines: any[], shipping: any, contact: Record<string, any>, note: string }) => void,
 *   onBack?: () => void,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: any }) => void, destroy: () => void }}
 */
export function checkout(spec) {
  const s = spec || /** @type {any} */ ({});
  let data = s.data || { lines: [] };
  let shipId = null;
  let placed = false;

  const names = (data.steps && data.steps.length === 4) ? data.steps : stepNames();
  const fields = detailFields();
  const ids = names.map(function () { return uid('ak-co'); });

  const lineList = el('ol', { class: 'ak-checkout__lines' });
  const itemsSum = el('div', { class: 'ak-checkout__sum' });
  const shipList = el('div', { class: 'ak-checkout__ships' });
  const totals = el('div', { class: 'ak-checkout__totals' });
  const noteInput = /** @type {HTMLTextAreaElement} */ (el('textarea', {
    id: uid('ak-note'), class: 'ak-input ak-input--area', rows: 2,
    placeholder: t('coNotePlaceholder'), 'aria-label': t('coNote'),
  }));
  const refusal = el('p', { class: 'ak-checkout__refusal', role: 'alert', hidden: true });
  const settled = el('p', { class: 'ak-checkout__settled', role: 'status', hidden: true },
    '✓ ' + t('coPlaced'));
  const placeBtn = el('button', { type: 'button', class: 'ak-btn ak-btn--primary ak-checkout__place' }, t('coPlace'));

  const details = form({
    fields: fields,
    submitLabel: t('coContinue'),
    onSubmit() { goTo(2); },
  });

  /** @param {number} i @param {any[]} kids */
  function section(i, kids) {
    return el('section', { class: 'ak-checkout__section', 'aria-labelledby': ids[i] }, [
      el('h3', { class: 'ak-checkout__heading', id: ids[i] }, names[i]),
    ].concat(kids));
  }

  const sections = [
    section(0, [lineList, itemsSum]),
    section(1, [details.el]),
    section(2, [shipList]),
    section(3, [
      totals,
      el('label', { class: 'ak-form__label', for: noteInput.id }, t('coNote')),
      noteInput, refusal, placeBtn, settled,
    ]),
  ];

  const page = el('div', { class: 'ak-checkout__page' }, sections);
  const well = el('div', { class: 'ak-checkout__well' }, [page]);

  const railBtns = names.map(function (name, i) {
    return el('button', {
      type: 'button', class: 'ak-checkout__step',
      on: { click: function () { goTo(i); } },
    }, [el('span', { class: 'ak-checkout__step-n' }, String(i + 1)), el('span', {}, name)]);
  });
  const rail = el('nav', { class: 'ak-checkout__rail', 'aria-label': t('coSteps') }, [
    s.onBack ? el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost ak-checkout__back',
      on: { click: function () { if (s.onBack) s.onBack(); } },
    }, '↩ ' + t('back')) : null,
  ].filter(Boolean).concat(railBtns));

  const root = el('section', { class: 'ak-root ak-checkout' }, [rail, well]);
  if (s.target) resolve(s.target).appendChild(root);

  const view = wellScroller(well, page);

  /** @param {number} i */
  function goTo(i) {
    view.to(sections[i], -12);
    markCurrent(i);
  }

  /** @param {number} i */
  function markCurrent(i) {
    railBtns.forEach(function (b, n) {
      if (n === i) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('is-current', n === i);
    });
  }

  /** The section in view owns the rail: the topmost one still on screen. */
  let io = null;
  if (typeof IntersectionObserver === 'function') {
    const visible = new Set();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const i = sections.indexOf(/** @type {HTMLElement} */ (entry.target));
        if (i < 0) return;
        if (entry.isIntersecting) visible.add(i); else visible.delete(i);
      });
      const open = Array.from(visible).sort(function (a, b) { return a - b; });
      if (open.length) markCurrent(open[0]);
    }, { root: well, threshold: 0.2 });
    sections.forEach(function (sec) { io.observe(sec); });
  }
  markCurrent(0);

  function chosenShip() {
    const options = Array.isArray(data.shipping) ? data.shipping : [];
    return options.find(function (o) { return o.id === shipId; }) || null;
  }

  /** The order speaks micro-units: `unit: 'micros'`, or a line or delivery with `priceMicros`. */
  function inMicros() {
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const options = Array.isArray(data.shipping) ? data.shipping : [];
    return speaksMicros(data, lines.concat(options), ['price']);
  }

  /** One line's sum, in whole currency units. */
  function lineSum(l) {
    return readAmount(l, 'price', data) * (Number(l.qty) || 0);
  }

  function itemsTotal() {
    return (Array.isArray(data.lines) ? data.lines : []).reduce(function (n, l) {
      return n + lineSum(l);
    }, 0);
  }

  function renderTotals() {
    const cur = data.currency;
    const mu = inMicros();
    const ship = chosenShip();
    const items = itemsTotal();
    const carriage = ship ? readAmount(ship, 'price', data) : 0;
    clear(itemsSum);
    itemsSum.appendChild(el('span', {}, t('coItems')));
    itemsSum.appendChild(el('span', { class: 'ak-checkout__figure' }, money(items, cur, mu)));
    clear(totals);
    [
      [t('coItems'), money(items, cur, mu), ''],
      [t('coDelivery'), ship ? money(carriage, cur, mu) : t('coShipLater'), ''],
      [t('total'), money(items + carriage, cur, mu), ' ak-checkout__total--grand'],
    ].forEach(function (row) {
      totals.appendChild(el('div', { class: 'ak-checkout__total' + row[2] }, [
        el('span', {}, row[0]),
        el('span', { class: 'ak-checkout__figure' }, row[1]),
      ]));
    });
  }

  function renderLines() {
    const cur = data.currency;
    const mu = inMicros();
    const lines = Array.isArray(data.lines) ? data.lines : [];
    clear(lineList);
    if (!lines.length) {
      emptyState({ target: lineList, tone: 'quiet', title: t('coEmpty'), hint: t('coEmptyHint') });
      return;
    }
    lines.forEach(function (l) {
      lineList.appendChild(el('li', { class: 'ak-checkout__line' }, [
        el('div', { class: 'ak-checkout__line-main' }, [
          el('span', { class: 'ak-checkout__line-title' }, String(l.title || l.id)),
          l.sub ? el('span', { class: 'ak-checkout__line-sub' }, String(l.sub)) : null,
        ].filter(Boolean)),
        el('span', { class: 'ak-checkout__qty' }, String(Number(l.qty) || 0) + ' ×'),
        el('span', { class: 'ak-checkout__figure' }, money(lineSum(l), cur, mu)),
      ]));
    });
    stagger(Array.prototype.slice.call(lineList.children), { from: 'up' });
  }

  function renderShipping() {
    const cur = data.currency;
    const mu = inMicros();
    const options = Array.isArray(data.shipping) ? data.shipping : [];
    const group = uid('ak-ship');
    clear(shipList);
    if (!options.length) {
      shipId = null;
      shipList.appendChild(el('p', { class: 'ak-checkout__quiet' }, t('coNoShipping')));
      return;
    }
    if (!options.some(function (o) { return o.id === shipId; })) shipId = options[0].id;
    options.forEach(function (o) {
      const radio = /** @type {HTMLInputElement} */ (el('input', {
        type: 'radio', name: group, value: String(o.id), class: 'ak-checkout__radio',
        checked: o.id === shipId ? true : null,
        on: { change: function () { shipId = o.id; renderTotals(); } },
      }));
      shipList.appendChild(el('label', { class: 'ak-checkout__ship' }, [
        radio,
        el('span', { class: 'ak-checkout__ship-label' }, String(o.label || o.id)),
        el('span', { class: 'ak-checkout__figure' }, money(readAmount(o, 'price', data), cur, mu)),
      ]));
    });
  }

  function place() {
    if (placed) return;
    // Refuse before reporting: every named problem is said next to its own field, and the rail
    // takes the eye back to the section that holds it.
    const contact = details.values();
    details.clearErrors();
    const missing = fields.filter(function (f) {
      return f.required && !String(contact[f.name] == null ? '' : contact[f.name]).trim();
    });
    if (missing.length) {
      missing.forEach(function (f) { details.setError(f.name, t('coNeeded', { field: f.label })); });
      goTo(1);
      return;
    }
    if (String(contact.email).indexOf('@') < 0) {
      details.setError('email', t('coEmailAt'));
      goTo(1);
      return;
    }
    refusal.hidden = true;
    const order = {
      lines: Array.isArray(data.lines) ? data.lines.slice() : [],
      shipping: chosenShip(),
      contact: contact,
      note: noteInput.value.trim(),
    };
    if (s.onSubmit) {
      try {
        s.onSubmit(order);
      } catch (err) {
        refusal.textContent = (err && err.message) || t('coFailed');
        refusal.hidden = false;
        attention(refusal, 'shake');
        return;
      }
    }
    placed = true;
    placeBtn.hidden = true;
    settled.hidden = false;
    attention(settled, 'rise');
  }
  placeBtn.addEventListener('click', place);

  renderLines();
  renderShipping();
  renderTotals();
  stagger(sections, { from: 'up' });

  return {
    el: root,
    set(patch) {
      if (!patch || !('data' in patch) || !patch.data) return;
      data = patch.data;
      renderLines();
      renderShipping();
      renderTotals();
    },
    destroy() {
      if (io) { io.disconnect(); io = null; }
      view.destroy();
      details.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
