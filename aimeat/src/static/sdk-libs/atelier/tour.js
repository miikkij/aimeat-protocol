/**
 * @file atelier/tour.js
 * @description The tour: a guided walk through an app over its real screen. Each step lights one
 *   place (a spotlight on a dimmed page), says what it is beside it, and the person walks on with
 *   Next, back with Back, and out with Escape, Skip or the close button. A step without a place is
 *   a card in the middle of the screen: the first step tells what the app is for.
 *
 *   WHERE THE STEPS COME FROM. Three places, in this order: the app's `tours` (or the one-tour
 *   `steps` the kit has always taken), else the page's own declaration
 *   `<script type="application/json" id="aimeat-tour">`, which is also what the node reads at
 *   publish (services/app/tour.ts): the owner's switch for the invitation shows only for an app that
 *   has one, and the person's own AI reads the same steps through the app's record. A step names its
 *   place with `help: "<id>"` (the element carrying `data-ak-help="<id>"`, whose
 *   `data-ak-help-title` and `data-ak-help-text` are then the step's words unless it has its own),
 *   with `target` (a selector, an element or a function), or with nothing. A bare string is a help id.
 *
 *   EVERY WORD IN EVERY LANGUAGE. A title or a text is a string or an object per language
 *   ({ en, fi, es }), read in the kit's language each time a step draws.
 *
 *   NOT MODAL. The dim layer takes no clicks: the page stays usable under it, so a step with
 *   `do: "click"` (or "input", "change") waits for the person to do the real thing on the lit place
 *   and then walks on by itself. The card is a non-modal dialog: it takes the keyboard focus for its
 *   step, says "Step 2 of 5" to a screen reader, and the focus returns where it was at the end.
 *
 *   PHONE AND DESKTOP. From 640 px of window the card stands beside its place (below it, above it
 *   when there is no room) and follows it while the page scrolls. Narrower, the card is a sheet at
 *   the bottom of the screen and the place is scrolled into the part above it, so the card never
 *   covers what it talks about. Reduced motion takes the travel away; nothing else changes.
 *
 *   THE INVITATION, ONCE. invite() puts a small card in a corner the first time a person opens the
 *   app (per tour and version, remembered in this browser): start the tour, or not now. It shows
 *   only when the app has a tour, the app did not say `invite: false`, and the owner has not
 *   switched it off for the app (the node writes that into the app's `#aimeat-app-ref` block).
 *
 *   POINT. point(place, { title, text, actions }) lights one place with one card, for anything that
 *   wants to say "here": the in-app aide uses it for the place it tells the person to press, and for
 *   the button that does what it proposes to do.
 * @parts tour card · counter · title · text · hint · close · spot · invite · button
 * @fork tour Write the steps into a dialog of your own; you give up the spotlight, the phone's bottom sheet, the page's #aimeat-tour block (which the node reads too), the languages, the invitation and the owner's switch for it.
 * @use tour explain
 * @structure tour(spec) → { start, end, next, back, point, invite, button, list, places, set, isRunning, destroy }
 *   · readTourBlock(doc) · tourSeen/markTourSeen
 * @usage
 *   const tr = AIMEAT.atelier.tour({ tours: [{ id: 'first', title: { en: 'First tour', fi: 'Ensimmäinen kierros' },
 *     steps: [{ title: 'What this is', text: 'Keeps your errands.' }, 'add', { target: '#save', text: 'Save it.', do: 'click' }] }] });
 *   AIMEAT.atelier.app({ title: 'Errands', tour: tr });   // its own button in the header, and the invitation
 *   AIMEAT.atelier.tour({ steps: [{ target: '#a', text: 'Here' }] }).start();   // the form the kit has always taken
 * @version-history
 *   v0.72.0 — 2026-11-22 — Its own module, out of parts-ui.js, and grown into the app's tour
 *     (wish-opastettu-kierros-sovelluksiin-monikielinen-tutorial-ja-oma-): named tours, the page's
 *     `#aimeat-tour` block, steps by help id, a step without a place, Back and "Step n of m", the
 *     spotlight, the phone's bottom sheet, `do` steps, onStep, the header button, the one-time
 *     invitation with the owner's switch, and point(). `tour({ steps })` → `{ start, end }` works as
 *     before, with the same class names; the note is now a card in the kit's surface colours.
 */
import { el, reducedMotion, wearLook, uid } from './dom.js';
import { i18n, t } from './i18n.js';
import { wordsOf } from './handbook.js';
import { appRef } from '../_core/app-ref.js';

/** Below this window width the card is a bottom sheet. */
const NARROW_PX = 640;
/** Room between the place and its card, and from the screen's edge. */
const GAP = 12;
const EDGE = 8;
/** The spotlight's margin round the place. */
const SPOT_PAD = 6;
const SEEN_KEY = 'ak-tour-seen:';
const DO_EVENTS = ['click', 'input', 'change'];

const STRINGS = {
  en: {
    button: 'Tour', open: 'Start the tour', choose: 'Pick a tour', close: 'Close',
    step: 'Step {n} of {total}', tryIt: 'Try it: press the highlighted place.', gotIt: 'Got it',
    inviteTitle: 'New here?', inviteText: 'Take a short tour of this app: {n} steps.',
    inviteStart: 'Start the tour', inviteLater: 'Not now',
  },
  fi: {
    button: 'Kierros', open: 'Aloita kierros', choose: 'Valitse kierros', close: 'Sulje',
    step: 'Vaihe {n}/{total}', tryIt: 'Kokeile: paina korostettua kohtaa.', gotIt: 'Selvä',
    inviteTitle: 'Uusi täällä?', inviteText: 'Katso lyhyt kierros tässä sovelluksessa: {n} vaihetta.',
    inviteStart: 'Aloita kierros', inviteLater: 'Ei nyt',
  },
  es: {
    button: 'Recorrido', open: 'Empezar el recorrido', choose: 'Elige un recorrido', close: 'Cerrar',
    step: 'Paso {n} de {total}', tryIt: 'Pruébalo: pulsa el lugar resaltado.', gotIt: 'Entendido',
    inviteTitle: '¿Eres nuevo aquí?', inviteText: 'Haz un recorrido corto por esta aplicación: {n} pasos.',
    inviteStart: 'Empezar el recorrido', inviteLater: 'Ahora no',
  },
};

/** A word of the tour: the host's own `tour.<key>` first, then the kit's language. */
function tw(key, vars) {
  const hosted = i18n.t('tour.' + key, vars);
  if (hosted !== 'tour.' + key) return hosted;
  const table = /** @type {Record<string, string>} */ (STRINGS[/** @type {'en'|'fi'|'es'} */ (i18n.lang())] || STRINGS.en);
  let s = table[key] || STRINGS.en[key] || key;
  for (const k in vars || {}) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

/**
 * @typedef {{ id?: string, help?: string, target?: string|Element|(() => Element|null),
 *   title?: any, text?: any, body?: any, do?: string|boolean, data?: any }} Step
 * @typedef {{ id: string, title?: any, version?: number, steps: Array<Step|string> }} TourDef
 */

/**
 * The page's own declaration, `<script type="application/json" id="aimeat-tour">`: `{ tours: [...] }`
 * or `{ steps: [...] }` for one tour. An empty list when the page has none or it does not parse;
 * the node refuses a broken one at publish, so a served app never meets one.
 * @param {Document} [doc]
 * @returns {TourDef[]}
 */
export function readTourBlock(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const node = d && typeof d.getElementById === 'function' ? d.getElementById('aimeat-tour') : null;
  if (!node) return [];
  try {
    const parsed = JSON.parse(node.textContent || '');
    return normalTours(parsed);
  } catch (err) {
    console.warn('aimeat-atelier: the #aimeat-tour block is not JSON, so the app has no tour.', err);
    return [];
  }
}

/** @returns {TourDef[]} */
function normalTours(v) {
  if (!v || typeof v !== 'object') return [];
  const list = Array.isArray(v.tours) ? v.tours : (Array.isArray(v.steps) ? [{ id: 'main', steps: v.steps }] : []);
  return list.filter(function (x) { return x && Array.isArray(x.steps) && x.steps.length; }).map(function (x, i) {
    return { id: String(x.id || ('tour-' + (i + 1))), title: x.title, version: Number(x.version) || 1, steps: x.steps.slice() };
  });
}

/** This browser's memory of the tours a person has walked or declined, per app. */
function seenKey() {
  const ref = appRef();
  return SEEN_KEY + (ref ? ref.owner + '/' + ref.filename : (typeof location !== 'undefined' ? location.pathname : ''));
}
/** @param {TourDef} def */
export function tourSeen(def) {
  try {
    const map = JSON.parse(localStorage.getItem(seenKey()) || '{}');
    return Number(map[def.id] || 0) >= (def.version || 1);
  } catch (err) {
    // Storage blocked or the entry unreadable: read as not seen, so the worst case is one more invitation.
    console.warn('aimeat-atelier: the tour could not read what this browser has seen', err);
    return false;
  }
}
/** @param {TourDef} def */
export function markTourSeen(def) {
  try {
    const map = JSON.parse(localStorage.getItem(seenKey()) || '{}');
    map[def.id] = def.version || 1;
    localStorage.setItem(seenKey(), JSON.stringify(map));
  } catch (err) {
    console.warn('aimeat-atelier: the tour could not remember it was seen; the invitation may come again', err);
  }
}

/** The owner's switch for the invitation, as the node wrote it into #aimeat-app-ref. */
function ownerAllowsInvite() {
  const ref = /** @type {any} */ (appRef());
  return !(ref && ref.tourInvite === false);
}

/** The element a selector names; null, said in the console, when the selector is not valid CSS. */
function findPlace(selector) {
  try { return document.querySelector(selector); } catch (err) {
    console.warn('aimeat-atelier: a tour step names "' + selector + '", which is not a CSS selector; the step is passed', err);
    return null;
  }
}

/** The element an app's place function answers; null, said in the console, when it throws. */
function callPlace(fn) {
  try { return fn(); } catch (err) {
    console.warn('aimeat-atelier: a tour step\'s place function failed; the step is passed', err);
    return null;
  }
}

/** A step as the tour uses it: a help id resolved to its element and that element's words. */
function resolveStep(raw) {
  /** @type {Step} */
  const st = typeof raw === 'string' ? { help: raw } : Object.assign({}, raw || {});
  let place = null;
  let t0 = st.target;
  if (typeof t0 === 'function') t0 = callPlace(t0);
  if (typeof t0 === 'string') t0 = findPlace(t0);
  if (t0 && typeof t0 === 'object') place = /** @type {Element} */ (t0);
  if (!place && st.help) {
    const all = document.querySelectorAll('[data-ak-help]');
    for (let i = 0; i < all.length; i++) if (all[i].getAttribute('data-ak-help') === st.help) { place = all[i]; break; }
  }
  const title = st.title != null ? st.title : (place && st.help ? place.getAttribute('data-ak-help-title') : null);
  const text = st.text != null ? st.text : (st.body != null ? st.body : (place && st.help ? place.getAttribute('data-ak-help-text') : null));
  const named = !!(st.target || st.help);
  return { step: st, place: place, named: named, title: wordsOf(title), text: wordsOf(text) };
}

/** Shown on the screen now: connected and laid out. */
function visible(node) {
  if (!node || !node.isConnected) return false;
  const r = node.getBoundingClientRect();
  return !!r && (r.width > 0 || r.height > 0 || /** @type {HTMLElement} */ (node).offsetParent !== null);
}

/**
 * The tour.
 * @param {{
 *   steps?: Array<Step|string>, tours?: TourDef[], block?: boolean,
 *   invite?: boolean, onDone?: (tourId: string, finished: boolean) => void,
 *   onStep?: (step: Step, index: number, place: Element|null) => void,
 *   labels?: { next?: string, done?: string, skip?: string, back?: string },
 * }} [spec]
 */
export function tour(spec) {
  const s = spec || {};
  /** @type {TourDef[]} */
  // A tour with no steps is no tour: it gets no button and no invitation.
  let tours = s.tours ? normalTours({ tours: s.tours })
    : (s.steps ? normalTours({ steps: s.steps }) : (s.block === false ? [] : readTourBlock()));
  /** @type {TourDef|null} */
  let current = null;
  let i = -1;
  let card = null;
  let spot = null;
  let marked = null;
  let frame = 0;
  let before = null;
  let doOff = null;
  let inviteCard = null;
  let destroyed = false;
  let pointing = null;
  /** @type {HTMLElement[]} */
  const buttons = [];

  function L() {
    return Object.assign({ next: t('next'), done: t('done'), skip: t('tourSkip'), back: t('back') }, s.labels || {});
  }
  function narrow() { return (window.innerWidth || 1024) < NARROW_PX; }

  // Once per frame however many scroll events arrive; capture, so a scrolling container counts.
  // The card's own scroll is not the page moving: placing again would undo it.
  function follow(e) {
    if (frame) return;
    if (e && card && e.target && typeof card.contains === 'function' && card.contains(e.target)) return;
    frame = requestAnimationFrame(function () { frame = 0; place(); });
  }

  /**
   * The card beside its place (wide) or as the bottom sheet (narrow); the spotlight on the place.
   * Widths are the page's own (clientWidth), so a card never stands under the window's scrollbar.
   */
  function place() {
    if (!card) return;
    const root = document.documentElement;
    const vw = (root && root.clientWidth) || window.innerWidth;
    const vh = (root && root.clientHeight) || window.innerHeight;
    if (narrow() || !marked) {
      card.style.top = ''; card.style.left = '';
      card.classList.toggle('ak-tour__note--sheet', narrow());
      card.classList.toggle('ak-tour__note--center', !narrow() && !marked);
      card.classList.remove('ak-tour__note--sheet-top');
      card.style.maxHeight = '';
      // A place near the end of a short screen cannot scroll above the sheet: the sheet moves to
      // the top instead, unless the place covers that end more. When neither end leaves the place
      // clear, the sheet shrinks to the room on its side and scrolls inside.
      if (narrow() && marked) {
        const r = marked.getBoundingClientRect();
        const below = card.getBoundingClientRect();
        if (below.height && r.bottom + SPOT_PAD > below.top) {
          card.classList.add('ak-tour__note--sheet-top');
          let at = card.getBoundingClientRect();
          if (r.top - SPOT_PAD < at.bottom && at.bottom - r.top > r.bottom - below.top) {
            card.classList.remove('ak-tour__note--sheet-top');
            at = below;
            const room = below.bottom - (r.bottom + SPOT_PAD + EDGE);
            if (room > 0 && room < at.height) card.style.maxHeight = room + 'px';
          } else if (r.top - SPOT_PAD < at.bottom) {
            const room = (r.top - SPOT_PAD - EDGE) - at.top;
            if (room > 0 && room < at.height) card.style.maxHeight = room + 'px';
          }
        }
      }
    } else {
      card.classList.remove('ak-tour__note--sheet', 'ak-tour__note--sheet-top', 'ak-tour__note--center');
      const r = marked.getBoundingClientRect();
      const w = card.offsetWidth || 300;
      const h = card.offsetHeight || 0;
      const top = r.bottom + GAP;
      const left = Math.max(EDGE, Math.min(r.left, vw - w - EDGE));
      card.style.top = (top + h > vh ? Math.max(EDGE, r.top - h - GAP) : top) + 'px';
      card.style.left = left + 'px';
    }
    if (spot) {
      if (!marked) { spot.hidden = true; return; }
      const r = marked.getBoundingClientRect();
      spot.hidden = false;
      spot.style.top = (r.top - SPOT_PAD) + 'px';
      spot.style.left = (r.left - SPOT_PAD) + 'px';
      spot.style.width = (r.width + 2 * SPOT_PAD) + 'px';
      spot.style.height = (r.height + 2 * SPOT_PAD) + 'px';
    }
  }

  function listen() {
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', follow, { capture: true, passive: true });
  }
  function unlisten() {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', follow, true);
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
  }

  /** Bring the place into view: centred when wide, above the bottom sheet when narrow. */
  function bring(node) {
    if (typeof node.scrollIntoView !== 'function') return;
    const behavior = reducedMotion() ? 'auto' : 'smooth';
    if (narrow() && card) {
      const hn = /** @type {HTMLElement} */ (node);
      const keepTop = hn.style.scrollMarginTop, keepBottom = hn.style.scrollMarginBottom;
      hn.style.scrollMarginTop = (EDGE * 2) + 'px';
      hn.style.scrollMarginBottom = ((card.offsetHeight || 200) + GAP * 2) + 'px';
      node.scrollIntoView({ block: 'nearest', behavior: behavior });
      hn.style.scrollMarginTop = keepTop; hn.style.scrollMarginBottom = keepBottom;
    } else {
      node.scrollIntoView({ block: 'center', behavior: behavior });
    }
  }

  /** Build the card for one step or one point; `nav` is its row of buttons. */
  function drawCard(opts) {
    const titleId = uid('ak-tour-title');
    const kids = [];
    if (opts.counter) kids.push(el('span', { class: 'ak-tour__step', 'data-ak-part': 'counter' }, opts.counter));
    if (opts.title) kids.push(el('h2', { class: 'ak-tour__title', id: titleId, 'data-ak-part': 'title', text: opts.title }));
    const textBox = el('div', { class: 'ak-tour__text', 'data-ak-part': 'text' });
    if (opts.text) String(opts.text).split(/\n{2,}/).forEach(function (para) { if (para.trim()) textBox.appendChild(el('p', { text: para.trim() })); });
    if (opts.hint) textBox.appendChild(el('p', { class: 'ak-tour__hint', 'data-ak-part': 'hint', text: opts.hint }));
    kids.push(textBox);
    const close = el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost ak-tour__close', 'data-ak-part': 'close', 'data-ak-noguard': true,
      'aria-label': tw('close'), title: tw('close'), on: { click: opts.onClose },
    }, '✕');
    const node = el('div', {
      class: 'ak-root ak-tour__note', role: 'dialog', 'aria-modal': 'false', 'data-ak-part': 'card',
      'aria-labelledby': opts.title ? titleId : null, 'aria-label': opts.title ? null : (opts.label || tw('button')),
    }, [close, el('div', { class: 'ak-tour__body', 'aria-live': 'polite' }, kids), opts.nav]);
    return node;
  }

  function clearStep() {
    if (doOff) { doOff(); doOff = null; }
    if (marked) marked.classList.remove('ak-tour__mark');
    if (card && card.parentNode) card.parentNode.removeChild(card);
    if (spot && spot.parentNode) spot.parentNode.removeChild(spot);
    marked = null; card = null; spot = null; pointing = null;
  }

  /** Show step n of the current tour; a step whose named place is not on the screen is passed. */
  function show(n, dir) {
    clearStep();
    const steps = current ? current.steps : [];
    const raw = steps[n];
    if (raw === undefined) { finish(n >= steps.length); return; }
    let r = resolveStep(raw);
    if (s.onStep) {
      // The app's hook failing must not stop the tour; it is said in the console.
      try { s.onStep(r.step, n, r.place); } catch (err) { console.warn('aimeat-atelier: the app\'s onStep failed at step ' + (n + 1), err); }
      r = resolveStep(raw);
    }
    if (r.named && !visible(r.place)) { show(n + (dir || 1), dir || 1); return; }
    i = n;
    const total = steps.length;
    const last = n === total - 1;
    const words = L();
    const nav = el('div', { class: 'ak-tour__nav' }, [
      el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-noguard': true,
        on: { click: function () { if (last) finish(true); else show(n + 1, 1); } } }, last ? words.done : words.next),
      n > 0 ? el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
        on: { click: function () { show(n - 1, -1); } } }, words.back) : null,
      last ? null : el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
        on: { click: function () { finish(false); } } }, words.skip),
    ].filter(Boolean));
    const doKind = r.step.do === true ? 'click' : (DO_EVENTS.indexOf(String(r.step.do)) >= 0 ? String(r.step.do) : '');
    card = drawCard({
      counter: tw('step', { n: n + 1, total: total }) ,
      title: r.title, text: r.text, hint: doKind && r.place ? tw('tryIt') : '',
      nav: nav, onClose: function () { finish(false); },
    });
    open(r.place);
    if (doKind && r.place) {
      const onDo = function () { setTimeout(function () { if (current && i === n) show(n + 1, 1); }, 0); };
      r.place.addEventListener(doKind, onDo);
      const at = r.place;
      doOff = function () { at.removeEventListener(doKind, onDo); };
    }
    // The step's own first button holds the focus, so Enter walks on and a screen reader is in the card.
    const first = nav.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  /** Put the card (already built) on the page, with the spotlight on its place when it has one. */
  function open(node) {
    marked = node ? /** @type {HTMLElement} */ (node) : null;
    if (marked) {
      marked.classList.add('ak-tour__mark');
      spot = el('div', { class: 'ak-root ak-tour__spot', 'data-ak-part': 'spot', 'aria-hidden': 'true' });
      document.body.appendChild(wearLook(spot, marked));
    }
    document.body.appendChild(wearLook(card, marked || document.activeElement));
    if (marked) bring(marked);
    place();
  }

  function onKey(e) {
    if (e.key === 'Escape') { if (current) finish(false); else if (pointing) pointing.close(); return; }
    if (!current || !card || !card.contains(document.activeElement)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1, 1); }
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); show(i - 1, -1); }
  }

  /** The end of a tour: walked to the end (finished) or left on the way. Either way it is seen. */
  function finish(finished) {
    const def = current;
    clearStep();
    unlisten();
    if (before && before.isConnected && typeof before.focus === 'function') before.focus({ preventScroll: true });
    before = null;
    current = null;
    const wasAt = i;
    i = -1;
    buttons.forEach(paintButton);
    if (def) {
      if (def.id !== '__adhoc') markTourSeen(def);
      if (wasAt >= 0 && s.onDone) s.onDone(def.id, !!finished);
    }
  }

  /**
   * Start a tour: by id, by position, or an object { id?, steps } made on the spot (not remembered
   * as seen). With nothing, the first tour.
   * @param {string|number|TourDef} [which]
   */
  function start(which) {
    if (destroyed) return false;
    /** @type {TourDef|null} */
    const def = which && typeof which === 'object'
      ? { id: String(which.id || '__adhoc'), title: which.title, version: 1, steps: (which.steps || []).slice() }
      : typeof which === 'number' ? (tours[which] || null)
        : typeof which === 'string' ? (tours.filter(function (x) { return x.id === which; })[0] || null)
          : (tours[0] || null);
    if (!def || !def.steps.length) return false;
    if (current) finish(false); else if (pointing) pointing.close();
    closeInvite();
    // Seen once started, so a reload in the middle does not invite again.
    if (def.id !== '__adhoc') markTourSeen(def);
    current = def;
    before = document.activeElement;
    listen();
    buttons.forEach(paintButton);
    show(0, 1);
    return true;
  }

  /**
   * Light one place with one card. `actions` are buttons on the card ({ label, run, primary });
   * without any, the card has "Got it". Null when the place is not on the screen now.
   * @param {string|Element} target a help id, a selector or an element
   * @param {{ title?: any, text?: any, actions?: Array<{ label: string, run?: () => any, primary?: boolean }>, onClose?: () => void }} [opts]
   */
  function point(target, opts) {
    if (destroyed) return null;
    const o = opts || {};
    let node = null;
    if (target && typeof target === 'object') node = /** @type {Element} */ (target);
    else if (typeof target === 'string') {
      node = resolveStep({ help: target }).place;
      if (!node) node = findPlace(target);
    }
    if (!visible(node)) return null;
    if (current) finish(false);
    clearStep();
    let closed = false;
    const handle = {
      close: function () {
        if (closed) return;
        closed = true;
        if (pointing === handle) { clearStep(); unlisten(); }
        if (o.onClose) o.onClose();
      },
    };
    const acts = (o.actions && o.actions.length ? o.actions : [{ label: tw('gotIt'), primary: true }]).map(function (a) {
      return el('button', { type: 'button', class: 'ak-btn ' + (a.primary ? 'ak-btn--primary' : 'ak-btn--ghost'), 'data-ak-noguard': true,
        on: { click: function () { handle.close(); if (a.run) a.run(); } } }, a.label);
    });
    card = drawCard({ title: wordsOf(o.title), text: wordsOf(o.text), nav: el('div', { class: 'ak-tour__nav' }, acts), onClose: handle.close });
    pointing = handle;
    listen();
    open(node);
    return handle;
  }

  function closeInvite() {
    if (inviteCard && inviteCard.parentNode) inviteCard.parentNode.removeChild(inviteCard);
    inviteCard = null;
  }

  /**
   * The invitation: once per tour version in this browser, only when the app has a tour, the app
   * allows it and the owner has not switched it off. True when it showed.
   */
  function invite() {
    const def = tours[0];
    if (destroyed || !def || current || inviteCard || s.invite === false || !ownerAllowsInvite() || tourSeen(def)) return false;
    const later = el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
      on: { click: function () { markTourSeen(def); closeInvite(); } } }, tw('inviteLater'));
    const go = el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-noguard': true,
      on: { click: function () { start(def.id); } } }, tw('inviteStart'));
    const titleId = uid('ak-tour-invite');
    inviteCard = el('div', { class: 'ak-root ak-tour__invite', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-ak-part': 'invite' }, [
      el('h2', { class: 'ak-tour__title', id: titleId, text: tw('inviteTitle') }),
      el('p', { class: 'ak-tour__text', text: (wordsOf(def.title) ? wordsOf(def.title) + '. ' : '') + tw('inviteText', { n: def.steps.length }) }),
      el('div', { class: 'ak-tour__nav ak-tour__nav--invite' }, [go, later]),
    ]);
    document.body.appendChild(wearLook(inviteCard, document.querySelector('.ak-app') || document.body));
    return true;
  }

  function paintButton(b) {
    b.setAttribute('aria-label', tw('open'));
    b.setAttribute('title', tw('open'));
    b.setAttribute('aria-pressed', current ? 'true' : 'false');
    const label = b.querySelector('.ak-tour__buttonword');
    if (label) label.textContent = tw('button');
  }

  /** With several tours, the button asks which one: a small card of their names. */
  function choose(from) {
    const list = el('div', { class: 'ak-tour__nav ak-tour__nav--list' }, tours.map(function (def) {
      return el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
        on: { click: function () { start(def.id); } } }, wordsOf(def.title) || def.id);
    }));
    clearStep();
    card = drawCard({ title: tw('choose'), nav: list, onClose: function () { clearStep(); unlisten(); }, label: tw('choose') });
    pointing = { close: function () { clearStep(); unlisten(); } };
    listen();
    open(null);
    const first = list.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    before = from;
  }

  /** The header's button: one per call, all kept in step with the tour. Null without a tour. */
  function button() {
    if (!tours.length) return null;
    const icon = el('span', { class: 'ak-tour__icon', 'aria-hidden': 'true' }, [compassIcon()]);
    const b = el('button', {
      type: 'button', class: 'ak-tour__button', 'data-ak-part': 'button', 'data-ak-noguard': true,
      on: { click: function () { if (current) { finish(false); return; } if (tours.length > 1) choose(b); else start(0); } },
    }, [icon, el('span', { class: 'ak-tour__buttonword' })]);
    buttons.push(b);
    paintButton(b);
    return b;
  }

  const stopLang = i18n.onChange(function () {
    buttons.forEach(paintButton);
    if (current && i >= 0) show(i, 1);
  });

  return {
    start: start,
    end: function () { if (current) finish(false); else if (pointing) pointing.close(); },
    next: function () { if (current) show(i + 1, 1); },
    back: function () { if (current && i > 0) show(i - 1, -1); },
    point: point,
    invite: invite,
    button: button,
    /** The tours this handle holds, in the language in force: for the aide, an agent or a test. */
    list: function () {
      return tours.map(function (def) {
        return { id: def.id, title: wordsOf(def.title), version: def.version || 1, steps: def.steps.length, seen: tourSeen(def) };
      });
    },
    /** Every place a step of any tour names, with its words: what the aide may point at. */
    places: function () {
      const out = [];
      tours.forEach(function (def) {
        def.steps.forEach(function (raw) {
          const r = resolveStep(raw);
          if (r.step.help && r.place) out.push({ id: r.step.help, title: r.title, text: r.text });
        });
      });
      return out;
    },
    /** @param {{ tours?: TourDef[], steps?: Array<Step|string> }} patch */
    set: function (patch) {
      if (!patch || destroyed) return;
      if (patch.tours) tours = normalTours({ tours: patch.tours });
      else if (patch.steps) tours = normalTours({ steps: patch.steps });
      buttons.forEach(function (b) { b.hidden = !tours.length; });
    },
    isRunning: function () { return !!current; },
    destroy: function () {
      destroyed = true;
      if (current) finish(false);
      clearStep();
      unlisten();
      closeInvite();
      if (typeof stopLang === 'function') stopLang();
      buttons.forEach(function (b) { b.remove(); });
    },
  };
}

/** For a caller that needs to know whether a page declares a tour without building one. */
export function hasTourBlock(doc) { return readTourBlock(doc).length > 0; }

/** The button's mark: a compass, drawn as the shell draws its own icons (no markup strings). */
function compassIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  [['viewBox', '0 0 24 24'], ['width', '18'], ['height', '18'], ['fill', 'none'], ['stroke', 'currentColor'],
    ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]
    .forEach(function (a) { svg.setAttribute(a[0], a[1]); });
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', '12'); ring.setAttribute('cy', '12'); ring.setAttribute('r', '9');
  const needle = document.createElementNS(ns, 'path');
  needle.setAttribute('d', 'M15.5 8.5l-2 5-5 2 2-5z');
  svg.appendChild(ring);
  svg.appendChild(needle);
  return svg;
}
