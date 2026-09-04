/**
 * @file science/formula.js
 * @description A formula on the page: the expression set as maths, the answer under it, and the
 *   workings behind a fold when the cell asks for them. KaTeX does the setting, loaded from this node
 *   and only when a page actually holds a formula — the node serves no font or script from a CDN and
 *   the app CSP refuses one.
 *
 *   THE ANSWER DOES NOT WAIT FOR THE TYPESETTING. The number and its unit are written as text the
 *   moment they arrive; KaTeX replaces the expression when it has loaded, and a page where it never
 *   loads still says what the formula worked out to. That is why the LaTeX sits in a `<code>` first.
 * @structure formulaEl · typesetInto · ensureKatex
 * @usage
 *   import { formulaEl, typesetInto } from './formula.js';
 *   row.append(formulaEl(cell, answer)); typesetInto(root);
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 2).
 */
import { NODE_URL } from '../_core/config.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

/**
 * One formula cell: what it says, what it works out to, and what it is waiting on.
 * @param {object} cell the worksheet cell
 * @param {object} [answer] the evaluated cell from POST /v1/worksheet/evaluate
 */
export function formulaEl(cell, answer) {
  const box = el('div', 'sci-formula');
  if (cell.label) box.append(el('span', 'sci-q-label', cell.label));

  const latex = answer?.latex || cell.latex || '';
  if (latex) {
    const math = el('code', 'sci-math', latex);
    math.dataset.latex = latex;
    box.append(math);
  }

  if (answer && answer.ok) {
    const line = el('div', 'sci-formula-answer');
    line.append(el('span', 'sci-eq', '='));
    line.append(el('b', null, answer.formatted ?? String(answer.value)));
    box.append(line);
    if (cell.showWork && answer.workLatex) {
      const work = el('details', 'sci-work');
      work.append(el('summary', null, 'the workings'));
      const shown = el('code', 'sci-math', answer.workLatex);
      shown.dataset.latex = answer.workLatex;
      work.append(shown);
      box.append(work);
    }
  } else if (answer && answer.error) {
    box.append(el('div', 'sci-formula-error', answer.error.message));
  }
  return box;
}

/* ── KaTeX ────────────────────────────────────────────────────────────────────────────────────── */

let katexPromise = null;

/**
 * KaTeX from this node, once per page. A page with no formula never loads it; a page whose load
 * fails keeps every answer and shows the expression as the LaTeX a person wrote.
 */
export function ensureKatex() {
  if (katexPromise) return katexPromise;
  if (typeof window !== 'undefined' && window.katex) return (katexPromise = Promise.resolve(window.katex));
  katexPromise = new Promise((resolve) => {
    const base = NODE_URL;
    if (!document.querySelector('link[data-katex]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = base + '/lib/katex@0/katex.min.css';
      css.dataset.katex = '1';
      document.head.append(css);
    }
    const script = document.createElement('script');
    script.src = base + '/lib/katex@0/katex.min.js';
    script.async = true;
    script.onload = () => resolve(window.katex || null);
    // A page that cannot load the setter still shows every answer and every expression, so this
    // resolves rather than rejecting: there is nothing for a caller to handle.
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return katexPromise;
}

/** Set every expression under this element as maths, once KaTeX is here. */
export function typesetInto(root) {
  const nodes = root ? root.querySelectorAll('code.sci-math[data-latex]') : [];
  if (!nodes.length) return Promise.resolve(false);
  return ensureKatex().then((katex) => {
    if (!katex) return false;
    for (const node of nodes) {
      const latex = node.dataset.latex;
      if (!latex || node.dataset.set === '1') continue;
      try {
        katex.render(latex, node, { throwOnError: false, displayMode: false, output: 'html' });
        node.dataset.set = '1';
      } catch {
        // An expression KaTeX will not set stays as the LaTeX it already holds, which is readable
        // and is what a person typed. There is nothing here to report.
        node.dataset.set = '1';
      }
    }
    return true;
  });
}
