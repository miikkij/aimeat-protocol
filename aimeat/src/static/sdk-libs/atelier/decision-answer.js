/**
 * @file atelier/decision-answer.js
 * @description How the decision block (atelier/decision.js) draws one answer, and the pure helpers
 *   around it: the answer as words, its bars with their numbers and threshold mark, which question a
 *   person overrides and with what choices, a stored decision row turned into the shape ask()
 *   answers with, and an earlier review in words. Extracted from decision.js on 2026-10-02 when the
 *   chained ask and the stored decision took it past the 800-line limit; nothing changed in the move.
 * @structure drawAnswer · firstUnder · overrideChoices · fromRow · reviewedWords (helpers:
 *   levelWords · answerText · bar · OPTIONS_SHOWN)
 * @usage
 *   import { drawAnswer, fromRow } from './decision-answer.js';
 * @version-history
 *   v0.63.0 — 2026-10-02 — Extracted from decision.js.
 */
import { el } from './dom.js';
import { td } from './decision-i18n.js';
import { day } from './members-shared.js';
import { twoDecimals } from '../decide/removed-line.js';

/** How many of a choice's options are drawn as bars, most likely first. */
const OPTIONS_SHOWN = 6;

/** A scale level in the words the answer's legend gives it, else the number. */
function levelWords(a, level) {
  const words = a.legend && a.legend[String(level)];
  return typeof words === 'string' ? words : String(level);
}

/** The answer itself as words: a probability, an option name, or a scale level. */
function answerText(a) {
  if (a.type === 'noul') return twoDecimals(Number(a.value));
  if (a.type === 'score') {
    const words = a.legend && a.legend[String(Math.round(Number(a.value)))];
    return typeof words === 'string' ? words : Number(a.value).toFixed(1);
  }
  return String(a.value == null ? '' : a.value);
}

/**
 * One bar with its number beside it, so the value never rests on colour or length alone. The
 * threshold, when there is one, is a mark on the track and part of the spoken value.
 * @param {string} label @param {number} v @param {number|null} t @param {string} [extra]
 */
function bar(label, v, t, extra) {
  const val = Math.max(0, Math.min(1, Number(v) || 0));
  const text = twoDecimals(Number(v)) || '0.00';
  /** @type {Record<string, string>} */
  const vars = { '--ak-dec-v': String(val) };
  if (t != null) vars['--ak-dec-t'] = String(Math.max(0, Math.min(1, t)));
  return el('div', {
    class: 'ak-dec__meter' + (extra ? ' ' + extra : ''), 'data-ak-part': 'bar', role: 'meter',
    'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '1', 'aria-valuenow': String(val),
    'aria-valuetext': text + (t != null ? ', ' + td('decision.threshold', { t: twoDecimals(t) }) : ''),
    vars: vars,
  }, [
    el('span', { class: 'ak-dec__meter-label', 'aria-hidden': 'true' }, label),
    el('span', { class: 'ak-dec__track', 'aria-hidden': 'true' }, [
      el('span', { class: 'ak-dec__fill' }),
      t != null ? el('span', { class: 'ak-dec__mark' }) : null,
    ]),
    el('span', { class: 'ak-dec__num', 'aria-hidden': 'true' }, text),
  ]);
}

/**
 * One answer: the question, the answer, whether it reaches its threshold, and its bars. `ownWord`
 * leaves out the threshold words, because the app's verdict says what the answers mean.
 * @param {string} q @param {any} a @param {any} t @param {boolean|undefined} passed @param {string} label
 * @param {boolean} [ownWord]
 */
export function drawAnswer(q, a, t, passed, label, ownWord) {
  const hasT = typeof t === 'number' && Number.isFinite(t);
  const li = el('li', {
    class: 'ak-dec__answer' + (passed === false ? ' ak-dec__answer--under' : ''),
    'data-ak-part': 'answer', 'data-question': q,
  });
  li.appendChild(el('div', { class: 'ak-dec__qhead' }, [
    el('span', { class: 'ak-dec__q', 'data-ak-part': 'question' }, label),
    el('span', { class: 'ak-dec__value', 'data-ak-part': 'value' }, answerText(a)),
    passed === undefined || ownWord ? null
      : el('span', { class: 'ak-dec__verdict', 'data-ak-part': 'verdict' }, td(passed ? 'decision.passed' : 'decision.under')),
  ]));
  // A yes/no answer's value is the probability; a choice is held to its confidence; a scale's
  // threshold is a level, so it is said in words rather than marked on the confidence bar.
  if (a.type === 'noul') li.appendChild(bar(td('decision.probability'), Number(a.value), hasT ? t : null));
  else if (typeof a.confidence === 'number') li.appendChild(bar(td('decision.confidence'), a.confidence, hasT && a.type === 'choice' ? t : null));
  if (hasT) li.appendChild(el('p', { class: 'ak-dec__fine', 'data-ak-part': 'threshold' }, td('decision.threshold', { t: twoDecimals(t) })));
  const probs = a.type !== 'noul' && a.probabilities && typeof a.probabilities === 'object' ? a.probabilities : null;
  if (probs) {
    const rows = Object.keys(probs).sort(function (x, y) { return Number(probs[y]) - Number(probs[x]); }).slice(0, OPTIONS_SHOWN);
    const list = el('div', { class: 'ak-dec__options', 'data-ak-part': 'options' });
    for (const k of rows) list.appendChild(bar(a.type === 'score' ? levelWords(a, k) : k, Number(probs[k]), null, 'ak-dec__meter--option'));
    li.appendChild(list);
  }
  return li;
}

/** The first question whose answer fell short of its threshold, else the first answer. */
export function firstUnder(r) {
  const answers = (r && r.answers) || {};
  const passed = (r && r.passed) || {};
  const ids = Object.keys(answers);
  for (const q of ids) if (passed[q] === false) return q;
  return ids[0] || '';
}

/** What a person may answer instead, for one question: yes or no, or the options it had. */
export function overrideChoices(r, q) {
  const a = r && r.answers && r.answers[q];
  if (!a) return [];
  if (a.type === 'noul') return [{ value: 'true', label: td('decision.yes') }, { value: 'false', label: td('decision.no') }];
  return Object.keys(a.probabilities || {}).map(function (k) {
    return { value: k, label: a.type === 'score' ? levelWords(a, k) : k };
  });
}

/**
 * A stored decision row (AIMEAT.decide.decisions({ id })) in the shape ask() answers with, so one
 * drawing serves both. `passed` is worked out from the thresholds recorded with it, compared the way
 * AIMEAT.decide.gate() compares: a choice by its confidence, anything else by its value.
 * @param {any} row
 * @returns {{ result: any, thresholds: Record<string, number> }}
 */
export function fromRow(row) {
  const rec = (row && row.record) || {};
  const answers = rec.answers || {};
  /** @type {Record<string, number>} */ const thresholds = {};
  /** @type {Record<string, boolean>} */ const passed = {};
  for (const q of Object.keys(rec.thresholds || {})) {
    const t = Number(rec.thresholds[q]);
    const a = answers[q];
    if (!a || !Number.isFinite(t)) continue;
    thresholds[q] = t;
    passed[q] = (a.type === 'choice' ? Number(a.confidence || 0) : Number(a.value)) >= t;
  }
  /** @type {Record<string, any>} */
  const result = {
    decision_id: row.id, model: rec.model || row.model, cached: !!rec.cachedFrom, answers: answers,
    scrub: rec.scrub, key_source: rec.keyScope || row.keyScope,
    provider: { id: row.provider || rec.provider, kind: row.providerKind || rec.providerKind || 'hosted' },
  };
  if (Object.keys(passed).length) result.passed = passed;
  if (row.outcome) result.outcome = row.outcome;
  if (rec.usage && typeof rec.usage.costUsd === 'number') result.usage = { input_tokens: rec.usage.inputTokens, cost_usd: rec.usage.costUsd };
  return { result: result, thresholds: thresholds };
}

/** An earlier review of a stored decision, in words: when, which way, to what, and its note. */
export function reviewedWords(rev) {
  const at = day(rev.at);
  let words;
  if (rev.outcome === 'confirmed') words = td('decision.reviewed.confirmed', { at: at });
  else if (rev.override === undefined || rev.override === null) words = td('decision.reviewed.overridden', { at: at });
  else {
    const v = rev.override === true ? td('decision.yes') : rev.override === false ? td('decision.no') : String(rev.override);
    words = td('decision.reviewed.overriddenTo', { at: at, v: v });
  }
  return rev.note ? words + ' ' + td('decision.reviewed.note', { note: rev.note }) : words;
}
