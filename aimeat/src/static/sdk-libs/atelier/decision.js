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
 *   QUESTIONS BUILT PER RUN, AND A CHAIN. An app that builds its questions from the input of each run
 *   passes them to ask(state, questions) or set({ questions }); `names` (names to take out of the
 *   text before sending) goes to every call. onAnswered(result, round) may return the next question
 *   set, built from the answers so far: the block asks it with the same state, up to MAX_ROUNDS
 *   calls, and draws every round in order, each with its own answers and facts. ask() resolves with
 *   the last round's answer, plus `steps` (each round's answer) when more than one round ran.
 *   Measured 2026-10-02: PÄÄTÖSPAJA builds its questions per run and asks a second time from the
 *   first answers.
 *
 *   THE APP'S VERDICT. verdict(result) returns the app's own word for the answers (a string or a
 *   Node), drawn as the block's verdict part above the answers; the per-answer threshold words are
 *   then left out, while the numbers, bars and threshold marks stay. Without it the threshold words
 *   stay as they were.
 *
 *   A STORED DECISION. decisionId draws a decision recorded earlier (AIMEAT.decide.decisions({ id }))
 *   with its record: when it was made, what it was about, what it decides, the rule that ran, and any
 *   earlier review. It never asks; Confirm and Override are offered at any time and recorded with
 *   review(). PÄÄTÖSPAJA reads its decisions back by id, POSTINJALOSTAMO reviews what its batch run
 *   decided.
 *
 *   THE STATES (data-ak-state on the root). sample (a built-in answer marked as such; nothing is
 *   asked or recorded); signed-out; no-library; unavailable (the node's reason, and a link to the
 *   AI settings); empty (no state yet); ready (a state, not yet asked); asking; answered, which
 *   under the threshold asks the person and then says what was recorded; failed, in the kit's
 *   words for decide's error codes; loading and stored, for a stored decision.
 *
 *   SHARED WITH THE LIVING DOCUMENT. The "taken out before sending" sentence and the two-decimal
 *   number come from decide/removed-line.js, which living/render-decide.js uses too. The rest of
 *   living's decide row is drawn over a living graph and a state machine (its buttons send machine
 *   events, its words are living's own two languages), so it is not this block's shape and is not
 *   imported: the kit bundling it would also carry living's graph and machine code.
 * @parts decision root · title · status · body · intro · signIn · failure · settings · empty · ready · ask · provider · providerNote · outcome · answers · answer · question · value · verdict · bar · threshold · options · removed · cost · who · step · stepTitle · loading · stored · decidedAt · subject · gates · ruleRun · reviewed · askPerson · person · note · confirm · override · overridePanel · overridePick · record · cancel · recorded · again · retry · reviewOnNode · reviewLink
 * @slots decision onOutcome(result) · onAnswered(result, round) · verdict(result) · labels{ questionId: words }
 * @tokens decision --ak-decision-width
 * @fork decision Copying it out means calling AIMEAT.decide's isAvailable(), unavailableReason(), providers(), ask() or gate() or rule(id).ask(), decisions({ id }) and review() yourself, drawing every answer with its number, threshold, removed data, cost and provider, every round of a chained ask, a stored decision with its record, and recording the person's verdict only when they press.
 * @structure decision(spec) (helpers: decideOf · signedOut · settingsHref · noState · errorWords ·
 *   needsPerson · money · SAMPLE; one answer's drawing and the stored-row helpers are in
 *   decision-answer.js)
 * @usage
 *   const d = AIMEAT.atelier.decision({ target: '#triage', appId: 'mail-sorter', rule: 'urgent-mail' });
 *   d.ask(mail.body).then((r) => { if (r && r.outcome === 'act') file(mail); });
 *   AIMEAT.atelier.decision({ target: row, appId: 'mail-sorter', decisionId: item.decisionId });
 * @version-history
 *   v0.63.0 — 2026-10-02 — Questions per run (ask(state, questions), set()), names, a chain of
 *     asks through onAnswered, the app's verdict(result), and a stored decision by decisionId with
 *     its record and the review. INSIDE AN APP the review happens on the node's own page (Jouni,
 *     2026-10-02): the node refuses a review by the principal that asked (OWN_DECISION), so Confirm
 *     and Override become one link to AIMEAT.decide.settingsUrl() in a new tab, and the decision
 *     is read again with its review when the window gets the focus back. `via: 'node'` forces it,
 *     and an OWN_DECISION refusal switches to it.
 *   v0.62.0 — 2026-10-01 — Initial.
 */
import { el, clear, resolve, whileBusy, uid } from './dom.js';
import { emptyState } from './state.js';
import { td, hasWords } from './decision-i18n.js';
import { isPlaceholder, sampleBadge, watch, refusal, day, appSession } from './members-shared.js';
import { removedLine } from '../decide/removed-line.js';
import { drawAnswer, firstUnder, overrideChoices, fromRow, reviewedWords } from './decision-answer.js';

/** The most calls one ask() makes through onAnswered: each call spends the owner's AI budget. */
const MAX_ROUNDS = 5;

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

/**
 * One question set put to the decision model, with the whole answer and the person's verdict.
 * @param {{ target?: string|Element, appId: string, state?: any, questions?: Record<string, any>,
 *   rule?: string, thresholds?: Record<string, number>, gates?: string, subject?: string,
 *   provider?: string, review?: boolean, title?: string, sample?: boolean,
 *   labels?: Record<string, string>, onOutcome?: (r: any) => void, names?: string[],
 *   onAnswered?: (r: any, round: number) => (Record<string, any> | null | Promise<Record<string, any> | null>),
 *   verdict?: (r: any) => (string | Node | null), decisionId?: string, via?: 'node' }} spec
 * @returns {{ el: HTMLElement,
 *   ask: (state?: any, questions?: Record<string, any>, more?: { names?: string[] }) => Promise<any>,
 *   set: (patch: { questions?: Record<string, any>, state?: any, names?: string[], decisionId?: string }) => Promise<void>,
 *   refresh: () => Promise<void>, destroy: () => void }}
 */
export function decision(spec) {
  const s = spec || /** @type {any} */ ({});
  // A stored decision needs no app id to be read; its own placeholder id asks for the sample.
  const sample = s.sample === true || isPlaceholder(s.appId) || (s.decisionId ? isPlaceholder(s.decisionId) : !s.appId);
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
  let questions = s.questions;
  /** @type {string[] | null} */ let names = Array.isArray(s.names) ? s.names : null;
  /** The stored decision this block draws, or '' when it asks. */
  let storedId = s.decisionId ? String(s.decisionId) : '';
  /** @type {any} */ let stored = null;
  /** @type {Promise<{ row?: any, err?: any }> | null} */ let storedLoad = null;
  /** @type {Record<string, number>} */ let storedThresholds = {};
  /** The node refused this page's review (OWN_DECISION), so the owner reviews on the node's page. */
  let forcedNode = false;
  /** The person went to the node's page to review; the next focus reads the decision again. */
  let away = false;

  /**
   * Whether the review happens on the node's own page. Inside an app (its own origin or the node's
   * isolated frame) the app asked for the decision, and the node refuses a review by the principal
   * that asked; `via: 'node'` forces it, and so does an OWN_DECISION refusal. It needs the decide
   * library's settingsUrl(), the owner's AI settings at the decision card, where every recent
   * decision has Confirm and Override.
   */
  function onNodePage() {
    return !sample && !!settingsHref(decideOf()) && (forcedNode || s.via === 'node' || appSession());
  }

  /** The line and the link that send the person to review on the node's page, in a new tab. */
  function reviewOnNode(lib) {
    return el('div', { class: 'ak-dec__on-node', 'data-ak-part': 'reviewOnNode' }, [
      el('p', { class: 'ak-dec__fine' }, td('decision.reviewOnNode')),
      el('div', { class: 'ak-dec__acts' }, [el('a', {
        class: 'ak-btn ak-btn--primary', 'data-ak-part': 'reviewLink', href: settingsHref(lib), target: '_blank', rel: 'noopener',
        on: { click: function () { away = true; } },
      }, [td('decision.reviewOnNodeAction'), el('span', { class: 'ak-sr-only' }, ' ' + td('decision.newTab'))])]),
    ]);
  }

  /** Back from the node's page: the decision is read again, with the review the person recorded. */
  function onFocus() {
    if (!away || destroyed) return;
    away = false;
    const t = storedId ? null : personTarget();
    if (storedId) api.refresh();
    else if (t && t.decision_id) api.set({ decisionId: String(t.decision_id) });
  }
  window.addEventListener('focus', onFocus);
  /** @type {'idle'|'asking'|'answered'|'failed'} */
  let phase = 'idle';
  /** @type {any} */ let result = null;
  /** Each round's answer, in order: one for a plain ask, more through onAnswered. */
  /** @type {any[]} */ let steps = [];
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
    if (storedId) return storedThresholds;
    return s.rule ? ruleThresholds : (s.thresholds || {});
  }

  /** The answer a person reviews: the latest round that waits for one, else the answer shown. */
  function personTarget() {
    for (let i = steps.length - 1; i >= 0; i--) if (needsPerson(steps[i])) return steps[i];
    return result;
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
      const where = td(r.provider.kind === 'local' ? 'decision.where.local' : 'decision.where.hosted');
      // A stored decision does not record who chose the provider, so that part is left out.
      const who = r.provider.chosen_by ? td('decision.who', {
        provider: providerName(r.provider.id),
        where: where,
        chosen: hasWords(chosen) ? td(chosen) : String(r.provider.chosen_by || ''),
      }) : td('decision.whoPlain', { provider: providerName(r.provider.id), where: where });
      out.push(fine('who', r.model ? who + ' ' + td('decision.model', { model: r.model }) : who));
    }
    return out;
  }

  /**
   * The person's verdict: under the threshold, or at any time on a stored decision. Null when a
   * stored decision has no earlier review and cannot be reviewed from here.
   * @returns {HTMLElement|null}
   */
  function drawPerson() {
    const lib = decideOf();
    const target = personTarget();
    const canRecord = s.review !== false && !!(target && target.decision_id) && (sample || !!(lib && typeof lib.review === 'function'));
    const box = el('div', { class: 'ak-dec__person', 'data-ak-part': 'person' });
    if (verdict) {
      box.appendChild(el('p', { class: 'ak-dec__recorded', 'data-ak-part': 'recorded' }, verdict.outcome === 'confirmed'
        ? td('decision.recorded.confirmed') : td('decision.recorded.overridden', { v: verdict.shown })));
      return box;
    }
    if (storedId) {
      const prev = stored && stored.record && stored.record.review;
      if (prev) box.appendChild(el('p', { class: 'ak-dec__recorded', 'data-ak-part': 'reviewed' }, reviewedWords(prev)));
      if (!canRecord) return prev ? box : null;
      box.appendChild(el('p', { class: 'ak-dec__ask-person', 'data-ak-part': 'askPerson' }, td(prev ? 'decision.reviewAgain' : 'decision.reviewStored')));
    } else {
      box.appendChild(el('p', { class: 'ak-dec__ask-person' }, td(canRecord ? 'decision.youDecide' : 'decision.personDecides')));
      if (!canRecord) return box;
    }
    if (onNodePage()) { box.appendChild(reviewOnNode(lib)); return box; }
    const under = firstUnder(target);
    const choices = overrideChoices(target, under);
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
      return whileBusy(btn, decideOf().review(target.decision_id, outcome, extra)).then(function () {
        if (destroyed) return;
        verdict = { outcome: outcome, shown: shown };
        say(outcome === 'confirmed' ? td('decision.recorded.confirmed') : td('decision.recorded.overridden', { v: shown }));
        if (typeof s.onOutcome === 'function') {
          try { s.onOutcome(Object.assign({}, result, { needsPerson: true, review: Object.assign({ outcome: outcome }, extra) })); } catch (e) { console.warn('aimeat-atelier: decision onOutcome threw', e); }
        }
        draw();
      }, function (e) {
        if (destroyed) return;
        // The node refuses the review from the principal that asked; the owner reviews it on the
        // node's own page instead, and the block says so rather than failing the press again.
        if (e && /** @type {any} */ (e).code === 'OWN_DECISION' && settingsHref(decideOf())) { forcedNode = true; draw(); return; }
        failSlot.appendChild(failLine(td('decision.reviewFailed', { why: errorWords(e) })));
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
      const a = target.answers && target.answers[under];
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

  /**
   * The app's own word for the answers, from its verdict(result) slot. False when there is no slot
   * or it threw (the threshold words are drawn then); null when it had nothing to say.
   * @returns {HTMLElement|null|false}
   */
  function appVerdict() {
    if (typeof s.verdict !== 'function') return false;
    let v;
    try { v = s.verdict(result); } catch (e) { console.warn('aimeat-atelier: decision verdict threw', e); return false; }
    if (v == null || v === '') return null;
    return el('div', { class: 'ak-dec__stamp', 'data-ak-part': 'verdict' }, typeof v === 'object' ? v : String(v));
  }

  /** One round's answers. A round after a rule's first is held to the spec's own thresholds. */
  function answerList(r, round, ownWord) {
    const list = el('ul', { class: 'ak-dec__answers', 'data-ak-part': 'answers' });
    const ts = round > 0 && s.rule && !storedId ? (s.thresholds || {}) : thresholdsNow();
    for (const q of Object.keys(r.answers || {})) {
      list.appendChild(drawAnswer(q, r.answers[q], ts[q], r.passed ? r.passed[q] : undefined, labelOf(q), ownWord));
    }
    return list;
  }

  /** What a stored decision's record says about it: when, about what, what it decides, which rule. */
  function storedLines(row) {
    const rec = row.record || {};
    const box = el('div', { class: 'ak-dec__stored', 'data-ak-part': 'stored' });
    if (row.createdAt) box.appendChild(fine('decidedAt', td('decision.decidedAt', { at: day(row.createdAt) })));
    const subject = rec.subject || row.subject;
    if (subject) box.appendChild(fine('subject', td('decision.subject', { subject: subject })));
    if (rec.gates) box.appendChild(fine('gates', td('decision.gates', { gates: rec.gates })));
    if (row.rule) {
      const rule = String(row.rule).replace(/^decide\.rules\./, '');
      box.appendChild(fine('ruleRun', row.ruleVersion != null
        ? td('decision.ruleRun', { rule: rule, version: row.ruleVersion }) : td('decision.ruleRunBare', { rule: rule })));
    }
    return box;
  }

  function drawAnswered() {
    if (storedId && stored) body.appendChild(storedLines(stored));
    const stamp = appVerdict();
    if (stamp) body.appendChild(stamp);
    if (result.outcome && hasWords('decision.outcome.' + result.outcome)) {
      body.appendChild(el('p', { class: 'ak-dec__outcome', 'data-ak-part': 'outcome', 'data-outcome': result.outcome },
        td('decision.outcome.' + result.outcome)));
    }
    const ownWord = stamp !== false;
    const rounds = steps.length > 1;
    if (rounds) {
      steps.forEach(function (r, i) {
        const box = el('div', { class: 'ak-dec__step', 'data-ak-part': 'step', 'data-step': String(i + 1) });
        box.appendChild(el('p', { class: 'ak-dec__step-title', 'data-ak-part': 'stepTitle' }, td('decision.round', { n: i + 1 })));
        box.appendChild(answerList(r, i, ownWord));
        for (const line of facts(r)) box.appendChild(line);
        body.appendChild(box);
      });
    } else body.appendChild(answerList(result, 0, ownWord));
    if (storedId) { const p = drawPerson(); if (p) body.appendChild(p); }
    else if (needsPerson(personTarget())) body.appendChild(/** @type {HTMLElement} */ (drawPerson()));
    if (!rounds) for (const line of facts(result)) body.appendChild(line);
    if (!sample && !storedId && !noState(state)) {
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
    if (storedId) { await drawStored(lib, mine); return; }
    if (!s.rule && !questions) { root.setAttribute('data-ak-state', 'failed'); body.appendChild(failLine(td('decision.noQuestions'))); return; }
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

  /**
   * A stored decision: read once through AIMEAT.decide.decisions({ id }), then drawn with its record
   * and the review. Nothing is asked. A redraw while the read is out waits for the same read.
   * @param {any} lib @param {number} mine
   */
  async function drawStored(lib, mine) {
    if (typeof lib.decisions !== 'function') {
      root.setAttribute('data-ak-state', 'no-library');
      body.appendChild(failLine(td('decision.noLib')));
      return;
    }
    if (!storedLoad) {
      const id = storedId;
      storedLoad = Promise.resolve().then(function () { return lib.decisions({ id: id }); })
        .then(function (row) { return { row: row }; }, function (err) { return { err: err }; });
    }
    root.setAttribute('data-ak-state', 'loading');
    root.setAttribute('aria-busy', 'true');
    body.appendChild(fine('loading', td('decision.loading')));
    const got = await storedLoad;
    if (mine !== drawn || destroyed) return;
    root.removeAttribute('aria-busy');
    clear(body);
    const row = got.row;
    if (!row || typeof row !== 'object' || !row.record) {
      const err = got.err;
      root.setAttribute('data-ak-state', 'failed');
      body.appendChild(failLine(!err || err.code === 'NOT_FOUND' ? td('decision.storedMissing')
        : td('decision.storedFailed', { why: errorWords(err) })));
      const retry = el('button', { type: 'button', class: 'ak-btn', 'data-ak-part': 'retry' }, td('decision.retry'));
      retry.addEventListener('click', function () { whileBusy(retry, api.refresh()); });
      body.appendChild(el('div', { class: 'ak-dec__acts' }, [retry]));
      return;
    }
    stored = row;
    const read = fromRow(row);
    result = read.result;
    storedThresholds = read.thresholds;
    steps = [result];
    root.setAttribute('data-ak-state', 'stored');
    drawAnswered();
  }

  /** The rule's handle, read once: its fields and its ask(). A failed read is tried again next time. */
  function ruleOf(lib) {
    if (!ruleHandle) {
      ruleHandle = Promise.resolve(lib.rule(s.rule));
      ruleHandle.catch(function () { ruleHandle = null; });
    }
    return ruleHandle;
  }

  /**
   * Put one round to the model, the one way the spec names. The first round of a rule runs the rule;
   * every other round asks `qs`.
   * @param {any} lib @param {any} qs @param {number} round
   */
  async function put(lib, qs, round) {
    /** @type {Record<string, any>} */
    const opts = { app_id: s.appId };
    if (s.subject) opts.subject = s.subject;
    const chosen = s.provider === 'pick' ? pick : s.provider;
    if (chosen) opts.provider = chosen;
    if (names) opts.names = names;
    if (s.rule && round === 0) {
      const handle = await ruleOf(lib);
      ruleThresholds = (handle && handle.thresholds) || {};
      return handle.ask(state, opts);
    }
    if (s.gates) opts.gates = s.gates;
    if (s.thresholds && typeof lib.gate === 'function') return lib.gate(state, qs, s.thresholds, opts);
    return lib.ask(state, qs, opts);
  }

  /**
   * Every round of one ask: the first, then each set onAnswered returns, up to MAX_ROUNDS. Stops
   * when the hook returns nothing, or when a newer ask or a destroy makes the answers stale.
   * @param {any} lib @param {number} mine @returns {Promise<any[]>}
   */
  async function rounds(lib, mine) {
    const done = [await put(lib, questions, 0)];
    while (typeof s.onAnswered === 'function' && done.length < MAX_ROUNDS && !destroyed && mine === asked) {
      const nextSet = await s.onAnswered(done[done.length - 1], done.length - 1);
      if (!nextSet || typeof nextSet !== 'object' || !Object.keys(nextSet).length || destroyed || mine !== asked) break;
      say(td('decision.askingRound', { n: done.length + 1 }));
      done.push(await put(lib, nextSet, done.length));
    }
    return done;
  }

  const api = {
    el: root,
    /**
     * Ask about `state` (or the state already given), with `qs` as the question set from now on when
     * given, and `more.names` as the names to take out. Resolves with the decide result (the last
     * round's, plus `steps` when onAnswered asked more than one round), or null when nothing was
     * asked or the question failed; the block shows why. A stored decision is never asked: null.
     * @param {any} [next] @param {Record<string, any>} [qs] @param {{ names?: string[] }} [more]
     * @returns {Promise<any>}
     */
    async ask(next, qs, more) {
      if (destroyed) return null;
      if (next !== undefined) state = next;
      if (qs != null) questions = qs;
      if (more && Array.isArray(more.names)) names = more.names;
      if (sample) { result = Object.assign({}, SAMPLE); await draw(); return result; }
      if (storedId) return null;
      const lib = decideOf();
      if (!lib || signedOut() || (!s.rule && !questions) || noState(state)) {
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
      /** @type {any[]} */ let done = [];
      let err = null;
      try { done = await rounds(lib, mine); } catch (e) { err = e; }
      const last = done[done.length - 1];
      const r = done.length > 1 ? Object.assign({}, last, { steps: done.slice() }) : last;
      // A newer ask or a destroy while this one was out: its answer describes nothing on screen.
      if (destroyed || mine !== asked) return err ? null : r;
      root.removeAttribute('aria-busy');
      if (err) {
        phase = 'failed';
        failure = errorWords(err);
        result = null;
        steps = [];
        say('');
        await draw();
        return null;
      }
      phase = 'answered';
      result = r;
      steps = done;
      say(td('decision.answered'));
      if (typeof s.onOutcome === 'function') {
        try { s.onOutcome(Object.assign({}, r, { needsPerson: done.some(needsPerson) })); } catch (e) { console.warn('aimeat-atelier: decision onOutcome threw', e); }
      }
      await draw();
      return r;
    },
    /**
     * Change what is asked, or which stored decision is drawn, and draw again; nothing is asked. A new
     * state, question set or decision id clears the answer on screen, which described the old one.
     * @param {{ questions?: Record<string, any>, state?: any, names?: string[], decisionId?: string }} patch
     * @returns {Promise<void>}
     */
    async set(patch) {
      if (!patch || destroyed) return;
      if (patch.names !== undefined) names = Array.isArray(patch.names) ? patch.names : null;
      const fresh = patch.questions !== undefined || patch.state !== undefined || patch.decisionId !== undefined;
      if (patch.questions !== undefined) questions = patch.questions;
      if (patch.state !== undefined) state = patch.state;
      if (patch.decisionId !== undefined) {
        storedId = patch.decisionId ? String(patch.decisionId) : '';
        stored = null;
        storedLoad = null;
        storedThresholds = {};
      }
      if (fresh) {
        asked++;
        phase = 'idle';
        result = null;
        steps = [];
        verdict = null;
        root.removeAttribute('aria-busy');
        say('');
      }
      await draw();
    },
    /** Read availability, the providers and a stored decision again, and draw. */
    async refresh() {
      providerList = null;
      providerError = '';
      if (storedId) { stored = null; storedLoad = null; verdict = null; }
      await draw();
    },
    destroy() {
      destroyed = true;
      drawn++;
      asked++;
      stop();
      window.removeEventListener('focus', onFocus);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

  draw();
  const stop = watch(function () { draw(); }, root);
  return api;
}
