/**
 * @file living/formula-view.js
 * @description THE FORMULA, SET, WITH ITS ANSWER UNDER IT. One node, two readings: the expression
 *   as mathematics and the number it currently comes to. Both are printed from the same tree, so
 *   they cannot disagree, and the number moves when the graph does.
 *
 *   THE ANSWER DOES NOT WAIT FOR THE TYPESETTER. The plain expression and the value are written
 *   into the DOM synchronously; KaTeX is fetched afterwards, from THIS NODE (never a CDN — the
 *   app CSP refuses one and this node serves the fonts), and swaps the plain line for the set one
 *   when it arrives. A page where KaTeX never loads still says what the formula is and what it
 *   worked out to, which is the part that matters.
 *
 *   IT IS FETCHED ONCE PER PAGE AND ONLY WHEN A FORMULA IS ACTUALLY PRINTED — a document with no
 *   printed formula pays nothing for the six hundred kilobytes it did not use.
 * @structure formulaView(host, spec) → { el, update } · loadKatex()
 * @usage  import { formulaView } from './formula-view.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { APEX_URL } from '../_core/config.js';
import { el, countTo } from './dom.js';
import { isError, isQuantity, trimNumber, asText } from './formula-eval.js';
import { unitLabel } from './units.js';

/** One promise per page: the first printed formula fetches KaTeX, the rest wait on the same one. */
let katexPromise = null;

/**
 * Fetch KaTeX from this node. Resolves to window.katex, or to null when it will not load — in
 * which case every formula stays as its plain expression, which is a readable answer.
 * @returns {Promise<any>}
 */
export function loadKatex() {
  if (katexPromise) return katexPromise;
  const ns = /** @type {any} */ (window);
  if (ns.katex) { katexPromise = Promise.resolve(ns.katex); return katexPromise; }
  const base = (APEX_URL || '').replace(/\/+$/, '');
  katexPromise = new Promise(function (done) {
    if (!document.querySelector('link[data-aimeat-katex]')) {
      const link = el('link', { rel: 'stylesheet', href: base + '/lib/katex@0/katex.min.css', 'data-aimeat-katex': 'css' });
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = base + '/lib/katex@0/katex.min.js';
    script.setAttribute('data-aimeat-katex', 'js');
    script.onload = function () { done(ns.katex || null); };
    script.onerror = function () { done(null); };
    document.head.appendChild(script);
  });
  return katexPromise;
}

/**
 * The printed formula.
 * @param {HTMLElement} host
 * @param {{ id: string, label?: string, tex: string, plain: string, value?: any }} spec
 * @returns {{ el: HTMLElement, update: (value: any, tex: string) => void }}
 */
export function formulaView(host, spec) {
  const plain = el('div', { class: 'ak-living__plain', text: spec.plain });
  const set = el('div', { class: 'ak-living__tex' });
  const answerValue = el('span', { class: 'ak-living__answer-value', text: '—' });
  const answerUnit = el('span', { class: 'ak-living__answer-unit' });
  const answer = el('div', { class: 'ak-living__answer' }, [
    el('span', { class: 'ak-living__answer-eq', 'aria-hidden': 'true', text: '=' }),
    answerValue, answerUnit,
  ]);
  const root = el('figure', { class: 'ak-living__formula', 'data-living-node': spec.id }, [
    spec.label ? el('figcaption', { class: 'ak-living__formula-label', text: spec.label }) : null,
    plain, set, answer,
  ]);
  host.appendChild(root);

  let lastTex = '';
  let lastNumber = NaN;

  /** Swap the plain line for the set one, once and only when KaTeX is really there. */
  function typeset(tex) {
    if (!tex) return;
    lastTex = tex;
    loadKatex().then(function (katex) {
      if (!katex || lastTex !== tex || !root.isConnected) return;
      try {
        katex.render(tex, set, { throwOnError: false, displayMode: false });
        plain.hidden = true;
        root.setAttribute('data-living-set', 'yes');
      } catch { /* the plain line stands */ }
    });
  }

  /**
   * @param {any} value @param {string} tex
   */
  function update(value, tex) {
    if (tex && tex !== lastTex) typeset(tex);
    if (isError(value)) {
      answerValue.textContent = value.error;
      answerUnit.textContent = '';
      root.setAttribute('data-living-state', 'refused');
      lastNumber = NaN;
      return;
    }
    root.removeAttribute('data-living-state');
    if (isQuantity(value) || typeof value === 'number') {
      const n = isQuantity(value) ? value.n : value;
      countTo(answerValue, Number.isFinite(lastNumber) ? lastNumber : n, n, trimNumber);
      lastNumber = n;
      answerUnit.textContent = isQuantity(value) ? unitLabel(value.u) : '';
      return;
    }
    answerValue.textContent = asText(value);
    answerUnit.textContent = '';
    lastNumber = NaN;
  }

  typeset(spec.tex);
  // The answer is written on the FIRST paint, not only on the first change. Without this the
  // formula sat at its placeholder until somebody touched a control, which the browser proof
  // caught and no unit test could have: the value was right in the graph the whole time.
  if ('value' in spec) update(spec.value, spec.tex);
  return { el: root, update: update };
}
