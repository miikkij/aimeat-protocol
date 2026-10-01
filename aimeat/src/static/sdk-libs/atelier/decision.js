/**
 * @file atelier/decision.js
 * @description decision(): one question set put to the decision model (AIMEAT.decide), with the
 *   whole answer on the screen: each answer with its probability or confidence as a bar and as a
 *   number, the threshold it is held to, what personal data was taken out before the text left,
 *   what the answer cost and who answered. Under the threshold the block asks the person, and their
 *   Confirm or Override is recorded on the decision with AIMEAT.decide.review(). Measured
 *   2026-10-01: two apps drew all of this by hand (availability with a fix, the answers, the
 *   removed data, the cost, the provider choice, the review).
 *
 *   WHAT IT ASKS. `rule` runs one of the owner's decision rules by id (AIMEAT.decide.rule(id).ask):
 *   the node takes the questions and thresholds from the owner's record. Otherwise `questions`
 *   (built with AIMEAT.decide.yesNo, pickOne, scale) go to ask(), or to gate() when `thresholds` are
 *   given, which records the thresholds with the decision. The block never asks on its own: asking
 *   spends the owner's AI budget, so the app calls ask(state), or the person presses Ask.
 *
 *   THE STATES (data-ak-state on the root). sample (a built-in answer marked as such; nothing is
 *   asked or recorded); signed-out; no-library; unavailable (the node's reason, and a link to the
 *   AI settings); empty (no state yet); ready (a state, not yet asked); asking; answered, which
 *   under the threshold asks the person and then says what was recorded; failed, in the kit's
 *   words for decide's error codes.
 *
 *   SHARED WITH THE LIVING DOCUMENT. The "taken out before sending" sentence and the two-decimal
 *   number come from decide/removed-line.js, which living/render-decide.js uses too. The rest of
 *   living's decide row is drawn over a living graph and a state machine (its buttons send machine
 *   events, its words are living's own two languages), so it is not this block's shape and is not
 *   imported: the kit bundling it would also carry living's graph and machine code.
 * @parts decision root · title · status · body · intro · signIn · failure · settings · empty · ready · ask · provider · providerNote · outcome · answers · answer · question · value · verdict · bar · threshold · options · removed · cost · who · person · note · confirm · override · overridePanel · overridePick · record · cancel · recorded · again · retry
 * @slots decision onOutcome(result) · labels{ questionId: words }
 * @tokens decision --ak-decision-width
 * @fork decision Copying it out means calling AIMEAT.decide's isAvailable(), unavailableReason(), providers(), ask() or gate() or rule(id).ask(), and review() yourself, drawing every answer with its number, threshold, removed data, cost and provider, and recording the person's verdict only when they press.
 * @structure decision(spec) (helpers: decideOf · signedOut · settingsHref · noState · errorWords ·
 *   needsPerson · money · answerText · bar · drawAnswer · firstUnder · overrideChoices · SAMPLE)
 * @usage
 *   const d = AIMEAT.atelier.decision({ target: '#triage', appId: 'mail-sorter', rule: 'urgent-mail' });
 *   d.ask(mail.body).then((r) => { if (r && r.outcome === 'act') file(mail); });
 * @version-history
 *   v0.62.0 — 2026-10-01 — Initial.
 */
import { el, clear, resolve, whileBusy, uid } from './dom.js';
import { emptyState } from './state.js';
import { td, hasWords } from './decision-i18n.js';
import { isPlaceholder, sampleBadge, watch, refusal } from './members-shared.js';
import { removedLine, twoDecimals } from '../decide/removed-line.js';

/** How many of a choice's options are drawn as bars, most likely first. */
const OPTIONS_SHOWN = 6;

/** The answer the sample state draws: one question passes, one waits for a person. */
const SAMPLE = {
  decision_id: 'sample',
  model: 'jev-1',
  cached: false,
  answers: {
    urgent: { type: 'noul', value: 0.86 },
    topic: { type: 'choice', value: 'invoice', probabilities: { invoice: 0.58, meeting: 0.31, other: 0.11 }, confidence: 0.58 },
  },
  passed: { urgent: true, topic: false },
  scrub: { removed: { person: 1, email: 1 }, total: 2, skipped: false },
  usage: { input_tokens: 412, cost_usd: 0.0004 },
  key_source: 'own',
  provider: { id: 'typesafe', kind: 'hosted', chosen_by: 'owner' },
};
const SAMPLE_THRESHOLDS = { urgent: 0.8, topic: 0.7 };

/** The page's AIMEAT.decide, or null. */
function decideOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.decide && typeof ns.decide.ask === 'function' ? ns.decide : null;
}

/** True when the page knows for certain that nobody is signed in. */
function signedOut() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const auth = ns && ns.auth;
  return !!(auth && typeof auth.getSession === 'function' && !auth.getSession());
}

/**
 * The owner's AI settings at the decision model card, as the decide library names it; null with an
 * older library, and then no link is drawn. The kit names no node path of its own.
 * @param {any} lib
 */
function settingsHref(lib) {
  return lib && typeof lib.settingsUrl === 'function' ? lib.settingsUrl() : null;
}

/** Whether a state is missing or blank. */
function noState(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/** decide's error, in the kit's words for its code, else the node's own sentence. */
function errorWords(e) {
  const code = e && /** @type {any} */ (e).code;
  if (code && hasWords('decision.err.' + code)) return td('decision.err.' + code);
  return refusal(e) || String(e);
}

/** Whether the answer waits for a person: the rule said "ask", or a thresholded answer fell short. */
function needsPerson(r) {
  if (!r) return false;
  if (r.outcome) return r.outcome === 'ask';
  const passed = r.passed || {};
  return Object.keys(passed).some(function (q) { return passed[q] === false; });
}

/** Dollars as a person reads a small sum: four decimals under a cent. */
function money(usd) {
  const n = Number(usd) || 0;
  return '$' + (n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2));
}

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
 * One answer: the question, the answer, whether it reaches its threshold, and its bars.
 * @param {string} q @param {any} a @param {any} t @param {boolean|undefined} passed @param {string} label
 */
function drawAnswer(q, a, t, passed, label) {
  const hasT = typeof t === 'number' && Number.isFinite(t);
  const li = el('li', {
    class: 'ak-dec__answer' + (passed === false ? ' ak-dec__answer--under' : ''),
    'data-ak-part': 'answer', 'data-question': q,
  });
  li.appendChild(el('div', { class: 'ak-dec__qhead' }, [
    el('span', { class: 'ak-dec__q', 'data-ak-part': 'question' }, label),
    el('span', { class: 'ak-dec__value', 'data-ak-part': 'value' }, answerText(a)),
    passed === undefined ? null
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
function firstUnder(r) {
  const answers = (r && r.answers) || {};
  const passed = (r && r.passed) || {};
  const ids = Object.keys(answers);
  for (const q of ids) if (passed[q] === false) return q;
  return ids[0] || '';
}

/** What a person may answer instead, for one question: yes or no, or the options it had. */
function overrideChoices(r, q) {
  const a = r && r.answers && r.answers[q];
  if (!a) return [];
  if (a.type === 'noul') return [{ value: 'true', label: td('decision.yes') }, { value: 'false', label: td('decision.no') }];
  return Object.keys(a.probabilities || {}).map(function (k) {
    return { value: k, label: a.type === 'score' ? levelWords(a, k) : k };
  });
}

/**
 * One question set put to the decision model, with the whole answer and the person's verdict.
 * @param {{ target?: string|Element, appId: string, state?: any, questions?: Record<string, any>,
 *   rule?: string, thresholds?: Record<string, number>, gates?: string, subject?: string,
 *   provider?: string, review?: boolean, title?: string, sample?: boolean,
 *   labels?: Record<string, string>, onOutcome?: (r: any) => void }} spec
 * @returns {{ el: HTMLElement, ask: (state?: any) => Promise<any>, refresh: () => Promise<void>,
 *   destroy: () => void }}
 */
export function decision(spec) {
  const s = spec || /** @type {any} */ ({});
  const sample = s.sample === true || !s.appId || isPlaceholder(s.appId);
  const root = el('section', { class: 'ak-root ak-dec', 'data-ak-part': 'root' });
  const head = el('h3', { class: 'ak-dec__title', 'data-ak-part': 'title' });
  // One live region for the whole life of the block: a region drawn anew is not announced.
  const status = el('p', { class: 'ak-dec__status', 'data-ak-part': 'status', role: 'status', 'aria-live': 'polite' });
  const body = el('div', { class: 'ak-dec__body', 'data-ak-part': 'body' });
  root.appendChild(head);
  root.appendChild(status);
  root.appendChild(body);
  if (s.target) resolve(s.target).appendChild(root);

  let state = s.state;
  /** @type {'idle'|'asking'|'answered'|'failed'} */
  let phase = 'idle';
  /** @type {any} */ let result = null;
  /** The thresholds of the rule that answered, read from its record. */
  /** @type {Record<string, number>} */ let ruleThresholds = {};
  let failure = '';
  /** @type {{ outcome: string, shown: string } | null} */ let verdict = null;
  /** @type {any} */ let providerList = null;
  let providerError = '';
  let pick = '';
  /** @type {Promise<any> | null} */ let ruleHandle = null;
  let drawn = 0;
  let asked = 0;
  let destroyed = false;

  function say(words) { if (status.textContent !== words) status.textContent = words; }

  function heading() {
    clear(head);
    head.appendChild(document.createTextNode(s.title || td('decision.title')));
    if (sample) head.appendChild(sampleBadge());
  }

  /** A line that is a refusal or a failure: announced as an alert. */
  function failLine(words) {
    return el('p', { class: 'ak-dec__failure', 'data-ak-part': 'failure', role: 'alert' }, words);
  }

  function fine(part, words) {
    return el('p', { class: 'ak-dec__fine', 'data-ak-part': part }, words);
  }

  /** The question's words: the app's label, else its id. */
  function labelOf(q) { return (s.labels && s.labels[q]) || q || ''; }

  /** The thresholds this answer was held to: the app's, or the rule's from its record. */
  function thresholdsNow() {
    if (sample) return SAMPLE_THRESHOLDS;
    return s.rule ? ruleThresholds : (s.thresholds || {});
  }

  /** The provider's name as the provider list gives it, else its id. */
  function providerName(id) {
    const list = (providerList && providerList.providers) || [];
    const p = list.find(function (x) { return x.id === id; });
    return (p && p.title) || id;
  }

  /** What was taken out before sending, what it cost, and who answered. */
  function facts(r) {
    const out = [];
    if (r.scrub && typeof r.scrub === 'object') {
      const removed = r.scrub.removed || {};
      out.push(fine('removed', r.scrub.skipped ? td('decision.scrubSkipped')
        : removedLine(function (kind) { return removed[kind]; }, function (key) { return td('decision.' + key); })));
    }
    if (r.cached) out.push(fine('cost', td('decision.cached')));
    else if (r.usage && typeof r.usage.cost_usd === 'number') {
      const key = 'decision.key.' + String(r.key_source || '');
      out.push(fine('cost', hasWords(key)
        ? td('decision.cost', { cost: money(r.usage.cost_usd), paid: td(key) })
        : td('decision.costOnly', { cost: money(r.usage.cost_usd) })));
    }
    if (r.provider && r.provider.id) {
      const chosen = 'decision.chosen.' + String(r.provider.chosen_by || '');
      const who = td('decision.who', {
        provider: providerName(r.provider.id),
        where: td(r.provider.kind === 'local' ? 'decision.where.local' : 'decision.where.hosted'),
        chosen: hasWords(chosen) ? td(chosen) : String(r.provider.chosen_by || ''),
      });
      out.push(fine('who', r.model ? who + ' ' + td('decision.model', { model: r.model }) : who));
    }
    return out;
  }

  /** The person's verdict, under the threshold. */
  function drawPerson() {
    const lib = decideOf();
    const canRecord = s.review !== false && !!(result && result.decision_id) && (sample || !!(lib && typeof lib.review === 'function'));
    const box = el('div', { class: 'ak-dec__person', 'data-ak-part': 'person' });
    if (verdict) {
      box.appendChild(el('p', { class: 'ak-dec__recorded', 'data-ak-part': 'recorded' }, verdict.outcome === 'confirmed'
        ? td('decision.recorded.confirmed') : td('decision.recorded.overridden', { v: verdict.shown })));
      return box;
    }
    box.appendChild(el('p', { class: 'ak-dec__ask-person' }, td(canRecord ? 'decision.youDecide' : 'decision.personDecides')));
    if (!canRecord) return box;
    const under = firstUnder(result);
    const choices = overrideChoices(result, under);
    const noteId = uid('ak-dec-note');
    const pickId = uid('ak-dec-pick');
    const note = /** @type {HTMLInputElement} */ (el('input', {
      type: 'text', id: noteId, class: 'ak-input ak-dec__note', 'data-ak-part': 'note', maxlength: 500,
    }));
    const select = /** @type {HTMLSelectElement} */ (el('select', { id: pickId, class: 'ak-input ak-dec__pick', 'data-ak-part': 'overridePick' },
      choices.map(function (c) { return el('option', { value: c.value }, c.label); })));
    const failSlot = el('div', { class: 'ak-dec__fail-slot' });
    const confirm = el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'confirm' }, td('decision.confirm'));
    const override = el('button', { type: 'button', class: 'ak-btn', 'data-ak-part': 'override', 'aria-expanded': 'false' }, td('decision.override'));
    const save = el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'record' }, td('decision.record'));
    const cancel = el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-part': 'cancel' }, td('decision.cancel'));
    const panel = el('div', { class: 'ak-dec__override', 'data-ak-part': 'overridePanel', hidden: true }, [
      el('label', { class: 'ak-form__label', for: pickId }, td('decision.overrideWith', { q: labelOf(under) })),
      select,
      el('div', { class: 'ak-dec__acts' }, [save, cancel]),
    ]);

    /** Record the verdict; only a press does this, never the block on its own. */
    function record(btn, outcome, extra, shown) {
      clear(failSlot);
      if (sample) { say(td('decision.sampleReview')); return Promise.resolve(); }
      const n = note.value.trim();
      if (n) extra.note = n;
      return whileBusy(btn, decideOf().review(result.decision_id, outcome, extra)).then(function () {
        if (destroyed) return;
        verdict = { outcome: outcome, shown: shown };
        say(outcome === 'confirmed' ? td('decision.recorded.confirmed') : td('decision.recorded.overridden', { v: shown }));
        if (typeof s.onOutcome === 'function') {
          try { s.onOutcome(Object.assign({}, result, { needsPerson: true, review: Object.assign({ outcome: outcome }, extra) })); } catch (e) { console.warn('aimeat-atelier: decision onOutcome threw', e); }
        }
        draw();
      }, function (e) {
        if (!destroyed) failSlot.appendChild(failLine(td('decision.reviewFailed', { why: errorWords(e) })));
      });
    }

    confirm.addEventListener('click', function () { record(confirm, 'confirmed', {}, ''); });
    override.addEventListener('click', function () {
      panel.hidden = false;
      override.setAttribute('aria-expanded', 'true');
      select.focus();
    });
    cancel.addEventListener('click', function () {
      panel.hidden = true;
      override.setAttribute('aria-expanded', 'false');
      override.focus();
    });
    save.addEventListener('click', function () {
      const a = result.answers && result.answers[under];
      const value = a && a.type === 'noul' ? select.value === 'true' : select.value;
      const opt = choices.find(function (c) { return c.value === select.value; });
      record(save, 'overridden', { override: value }, opt ? opt.label : select.value);
    });
    box.appendChild(el('div', { class: 'ak-form__field ak-dec__field' }, [
      el('label', { class: 'ak-form__label', for: noteId }, td('decision.note')), note,
    ]));
    box.appendChild(el('div', { class: 'ak-dec__acts' }, [confirm, override]));
    box.appendChild(panel);
    box.appendChild(failSlot);
    return box;
  }

  function drawAnswered() {
    if (result.outcome && hasWords('decision.outcome.' + result.outcome)) {
      body.appendChild(el('p', { class: 'ak-dec__outcome', 'data-ak-part': 'outcome', 'data-outcome': result.outcome },
        td('decision.outcome.' + result.outcome)));
    }
    const list = el('ul', { class: 'ak-dec__answers', 'data-ak-part': 'answers' });
    const ts = thresholdsNow();
    for (const q of Object.keys(result.answers || {})) {
      list.appendChild(drawAnswer(q, result.answers[q], ts[q], result.passed ? result.passed[q] : undefined, labelOf(q)));
    }
    body.appendChild(list);
    if (needsPerson(result)) body.appendChild(drawPerson());
    for (const line of facts(result)) body.appendChild(line);
    if (!sample && !noState(state)) {
      const again = el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-part': 'again' }, td('decision.again'));
      again.addEventListener('click', function () { whileBusy(again, api.ask()); });
      body.appendChild(el('div', { class: 'ak-dec__acts' }, [again]));
    }
  }

  /** The provider choice, when the spec says provider: 'pick'. */
  function drawPicker() {
    if (providerError) { body.appendChild(failLine(td('decision.providersFailed', { why: providerError }))); return; }
    const list = (providerList && providerList.providers) || [];
    if (!list.length) return;
    if (!pick) pick = String(providerList.default || providerList.node_default || list[0].id);
    const id = uid('ak-dec-prov');
    const note = el('p', { class: 'ak-dec__fine', 'data-ak-part': 'providerNote' });
    const select = /** @type {HTMLSelectElement} */ (el('select', { id: id, class: 'ak-input ak-dec__provider', 'data-ak-part': 'provider' },
      list.map(function (p) {
        const words = String(p.title || p.id) + (p.kind === 'local' ? ' · ' + td('decision.where.local') : '');
        return el('option', { value: p.id, selected: p.id === pick ? true : null },
          p.id === providerList.default ? td('decision.providerDefault', { title: words }) : words);
      })));
    select.value = pick;
    // Where the person picks, the provider's own statement says where their text goes.
    function statement() {
      const p = list.find(function (x) { return x.id === pick; });
      note.textContent = (p && p.data_statement) || '';
      note.hidden = !note.textContent;
    }
    select.addEventListener('change', function () { pick = select.value; statement(); });
    statement();
    body.appendChild(el('div', { class: 'ak-form__field ak-dec__field' }, [
      el('label', { class: 'ak-form__label', for: id }, td('decision.provider')), select, note,
    ]));
  }

  async function draw() {
    const mine = ++drawn;
    heading();
    clear(body);
    if (sample) {
      root.setAttribute('data-ak-state', 'sample');
      body.appendChild(fine('intro', td('decision.sampleNote')));
      result = result || Object.assign({}, SAMPLE);
      drawAnswered();
      return;
    }
    const lib = decideOf();
    if (!lib) { root.setAttribute('data-ak-state', 'no-library'); body.appendChild(failLine(td('decision.noLib'))); return; }
    if (signedOut()) { root.setAttribute('data-ak-state', 'signed-out'); body.appendChild(fine('signIn', td('decision.signIn'))); return; }
    if (!s.rule && !s.questions) { root.setAttribute('data-ak-state', 'failed'); body.appendChild(failLine(td('decision.noQuestions'))); return; }
    let available = true;
    if (typeof lib.isAvailable === 'function') {
      try { available = !!(await lib.isAvailable()); } catch { available = false; }
    }
    if (mine !== drawn || destroyed) return;
    if (!available) {
      root.setAttribute('data-ak-state', 'unavailable');
      const why = typeof lib.unavailableReason === 'function' ? lib.unavailableReason() : null;
      body.appendChild(el('p', { class: 'ak-dec__failure', 'data-ak-part': 'failure', role: 'status' }, [
        td('decision.unavailable'), why ? el('span', { class: 'ak-dec__why' }, ' ' + String(why)) : null,
      ]));
      const href = settingsHref(lib);
      if (href) body.appendChild(el('a', { class: 'ak-btn', 'data-ak-part': 'settings', href: href, target: '_blank', rel: 'noopener' }, td('decision.settings')));
      return;
    }
    if (s.provider === 'pick' && phase !== 'asking') {
      if (!providerList && !providerError && typeof lib.providers === 'function') {
        try { providerList = await lib.providers(); } catch (e) { providerError = errorWords(e); }
        if (mine !== drawn || destroyed) return;
      }
      drawPicker();
    }
    root.setAttribute('data-ak-state', phase === 'idle' ? (noState(state) ? 'empty' : 'ready') : phase);
    if (phase === 'asking') return;
    if (phase === 'failed') {
      body.appendChild(failLine(td('decision.failed', { why: failure })));
      if (!noState(state)) {
        const retry = el('button', { type: 'button', class: 'ak-btn', 'data-ak-part': 'retry' }, td('decision.retry'));
        retry.addEventListener('click', function () { whileBusy(retry, api.ask()); });
        body.appendChild(el('div', { class: 'ak-dec__acts' }, [retry]));
      }
      return;
    }
    if (phase === 'answered' && result) { drawAnswered(); return; }
    if (noState(state)) {
      const card = emptyState({ title: td('decision.empty.title'), hint: td('decision.empty.hint') });
      card.el.setAttribute('data-ak-part', 'empty');
      body.appendChild(card.el);
      return;
    }
    const go = el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'ask' }, td('decision.ask'));
    go.addEventListener('click', function () { whileBusy(go, api.ask()); });
    body.appendChild(el('div', { class: 'ak-dec__ready', 'data-ak-part': 'ready' }, [
      el('p', { class: 'ak-dec__fine' }, td('decision.ready')), el('div', { class: 'ak-dec__acts' }, [go]),
    ]));
  }

  /** The rule's handle, read once: its fields and its ask(). A failed read is tried again next time. */
  function ruleOf(lib) {
    if (!ruleHandle) {
      ruleHandle = Promise.resolve(lib.rule(s.rule));
      ruleHandle.catch(function () { ruleHandle = null; });
    }
    return ruleHandle;
  }

  /** Put the question to the model, the one way the spec names. */
  async function put(lib) {
    /** @type {Record<string, any>} */
    const opts = { app_id: s.appId };
    if (s.subject) opts.subject = s.subject;
    const chosen = s.provider === 'pick' ? pick : s.provider;
    if (chosen) opts.provider = chosen;
    if (s.rule) {
      const handle = await ruleOf(lib);
      ruleThresholds = (handle && handle.thresholds) || {};
      return handle.ask(state, opts);
    }
    if (s.gates) opts.gates = s.gates;
    if (s.thresholds && typeof lib.gate === 'function') return lib.gate(state, s.questions, s.thresholds, opts);
    return lib.ask(state, s.questions, opts);
  }

  const api = {
    el: root,
    /**
     * Ask about `state` (or the state already given). Resolves with the decide result, or null when
     * nothing was asked or the question failed; the block shows why.
     * @param {any} [next]
     * @returns {Promise<any>}
     */
    async ask(next) {
      if (destroyed) return null;
      if (next !== undefined) state = next;
      if (sample) { result = Object.assign({}, SAMPLE); await draw(); return result; }
      const lib = decideOf();
      if (!lib || signedOut() || (!s.rule && !s.questions) || noState(state)) {
        phase = 'idle'; result = null; await draw(); return null;
      }
      if (typeof lib.isAvailable === 'function') {
        let ok;
        try { ok = !!(await lib.isAvailable()); } catch { ok = false; }
        if (!ok) { await draw(); return null; }
      }
      const mine = ++asked;
      phase = 'asking';
      verdict = null;
      root.setAttribute('aria-busy', 'true');
      say(td('decision.asking'));
      await draw();
      let r = null;
      let err = null;
      try { r = await put(lib); } catch (e) { err = e; }
      // A newer ask or a destroy while this one was out: its answer describes nothing on screen.
      if (destroyed || mine !== asked) return err ? null : r;
      root.removeAttribute('aria-busy');
      if (err) {
        phase = 'failed';
        failure = errorWords(err);
        result = null;
        say('');
        await draw();
        return null;
      }
      phase = 'answered';
      result = r;
      say(td('decision.answered'));
      if (typeof s.onOutcome === 'function') {
        try { s.onOutcome(Object.assign({}, r, { needsPerson: needsPerson(r) })); } catch (e) { console.warn('aimeat-atelier: decision onOutcome threw', e); }
      }
      await draw();
      return r;
    },
    /** Read availability and the providers again, and draw. */
    async refresh() {
      providerList = null;
      providerError = '';
      await draw();
    },
    destroy() {
      destroyed = true;
      drawn++;
      asked++;
      stop();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

  draw();
  const stop = watch(function () { draw(); }, root);
  return api;
}
