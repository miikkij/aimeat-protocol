/**
 * @file atelier/workflow-input.js
 * @description workflowInput(): the screen that answers a workflow step waiting for a person. The
 *   node parks a run at a human-input step until somebody answers; this lists every such step across
 *   the owner's active runs (or one run's, with `run`), each with the workflow and the run, the
 *   question, its options as radio buttons (one pick) or checkboxes (several), a field for an own
 *   answer when the step accepts one, the time the answer is due, and an Answer button.
 *
 *   WHAT FETCHES AND WHY. Nothing here fetches. The list is AIMEAT.workflows.pendingInputs() and an
 *   answer is AIMEAT.workflows.answer(workflowId, runId, stepId, { picks, other? }); the page loads
 *   aimeat-workflows.js with aimeat-auth.js, and this component never holds a token. Without the
 *   library it says which one is missing.
 *
 *   AFTER AN ANSWER the step leaves the list and a notice names the workflow. A step that stopped
 *   waiting before the answer arrived (the node answers 409, WORKFLOW_STEP_NOT_WAITING: answered
 *   elsewhere, or its time ran out) says so and the list is read again. Any other refusal shows the
 *   node's own sentence on the step and keeps what was chosen and typed.
 *
 *   WHEN IT DRAWS AGAIN. On a sign-in, a sign-out and a language change (watch() in
 *   members-shared.js), and on every change the node reports in the live 'workflows' domain when
 *   aimeat-live.js is on the page; without it the host calls refresh(). A redraw keeps the choices,
 *   the typed text and the focus, so a run that moves elsewhere does not wipe a half-written answer,
 *   and a read that changed nothing draws nothing.
 *
 *   THE SAMPLE STATE. `sample: true`, or a `run` that is still a fill's <placeholder>, draws two
 *   sample steps marked as sample content; Answer sends nothing.
 * @parts workflowInput root · title · intro · failure · notice · body · none · list · step · head · header · workflow · run · form · choices · question · how · choice · mark · other · error · bar · deadline · answer
 * @slots workflowInput onAnswered(input, answer)
 * @variants workflowInput dense
 * @tokens workflowInput --ak-wf-width
 * @fork workflowInput Copying it out means calling AIMEAT.workflows.pendingInputs() and answer() yourself, sending picks as option ids with other only when the step accepts it, treating WORKFLOW_STEP_NOT_WAITING as a step that is gone, and reading the list again when the live 'workflows' domain changes.
 * @structure workflowInput(spec) (helpers: workflowsOf · signedOut · listOf · local · when ·
 *   keyOf · isGone · sampleInputs)
 * @usage
 *   AIMEAT.atelier.workflowInput({ target: '#waiting' });
 *   AIMEAT.atelier.workflowInput({ target: '#step', run: runId, variant: 'dense', onAnswered: (input, answer) => next() });
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial: the answer screen that missions and kansi each wrote by hand.
 */
import { el, clear, resolve, uid, enter } from './dom.js';
import { i18n } from './i18n.js';
import { twf } from './workflow-i18n.js';
import { isPlaceholder, sampleBadge, watch, refusal } from './members-shared.js';
import { dateTime } from '../_core/format.js';

/** The node's code for a step that no longer waits (routes/workflows.ts, the answer route's 409). */
const NOT_WAITING = 'WORKFLOW_STEP_NOT_WAITING';

/**
 * One step waiting for a person, as GET /v1/workflows/pending-inputs lists it
 * (services/workflow/lifecycle.ts PendingHumanInput).
 * @typedef {{ workflowId: string, runId: string, stepId: string,
 *   workflowTitle?: string|Record<string, string>, mode?: 'full-live'|'full-sandbox'|'signals-only',
 *   question: { header?: string, prompt: string, options: Array<{ id: string, label: string }>,
 *     multiSelect?: boolean, allowOther?: boolean },
 *   askedAt?: string, deadline?: string }} PendingInput
 */

/**
 * What an answer sends: option ids, and the person's own words when the step accepts them.
 * @typedef {{ picks: string[], other?: string }} WorkflowAnswer
 */

/** The page's AIMEAT.workflows, or null. */
function workflowsOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const wf = ns && ns.workflows;
  return wf && typeof wf.pendingInputs === 'function' && typeof wf.answer === 'function' ? wf : null;
}

/** True when the auth library is on the page and nobody is signed in. */
function signedOut() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const auth = ns && ns.auth;
  return !!(auth && typeof auth.getSession === 'function' && !auth.getSession());
}

/** The list out of what pendingInputs() answered: { inputs, count }, or a bare array. */
function listOf(r) {
  if (Array.isArray(r)) return r;
  const list = r && (r.inputs || r.items);
  return Array.isArray(list) ? list : [];
}

/**
 * A workflow title in the kit's language: a plain string, or a { locale: text } map such as
 * { en_US: '…', fi_FI: '…' }; English, then the first entry, when the language has none.
 * @param {any} v
 */
function local(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  const keys = Object.keys(v);
  const base = function (k) { return k.toLowerCase().split(/[-_]/)[0]; };
  const lang = i18n.lang();
  const hit = keys.find(function (k) { return base(k) === lang; })
    || keys.find(function (k) { return base(k) === 'en'; }) || keys[0];
  return hit ? String(v[hit]) : '';
}

/**
 * A moment as the person reads it, date and time, in their own regional format and zone
 * (_core/format.js, which asks AIMEAT.fmt when it is on the page); a value that is not a date is
 * shown as itself.
 */
function when(iso) {
  if (!iso) return '';
  return dateTime(iso, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One step's identity across reads. @param {PendingInput} p */
function keyOf(p) {
  return p.workflowId + '/' + p.runId + '/' + p.stepId;
}

/** Whether a refusal means the step no longer waits (answered elsewhere, or timed out). */
function isGone(e) {
  return !!e && (e.code === NOT_WAITING || e.status === 409);
}

/**
 * Two sample steps: one pick with a header, and several picks with an own answer in a test run.
 * @returns {PendingInput[]}
 */
function sampleInputs() {
  const now = Date.now();
  const at = function (hours) { return new Date(now + hours * 3600000).toISOString(); };
  return [
    {
      workflowId: 'sample-newsletter', runId: 'run-7f3a91c2', stepId: 'review', mode: 'full-live',
      workflowTitle: twf('wf.sample.wf1'), askedAt: at(-2), deadline: at(22),
      question: {
        header: twf('wf.sample.header1'), prompt: twf('wf.sample.q1'), allowOther: false,
        options: [
          { id: 'send', label: twf('wf.sample.send') },
          { id: 'hold', label: twf('wf.sample.hold') },
          { id: 'stop', label: twf('wf.sample.stop') },
        ],
      },
    },
    {
      workflowId: 'sample-suppliers', runId: 'run-0b6d44e8', stepId: 'pick-suppliers', mode: 'full-sandbox',
      workflowTitle: twf('wf.sample.wf2'), askedAt: at(-20), deadline: at(52),
      question: {
        prompt: twf('wf.sample.q2'), multiSelect: true,
        options: [
          { id: 'mill', label: twf('wf.sample.s1') },
          { id: 'bakery', label: twf('wf.sample.s2') },
          { id: 'harbour', label: twf('wf.sample.s3') },
        ],
      },
    },
  ];
}

/**
 * The steps a workflow waits on a person for, each answerable in place.
 * @param {{ target?: string|Element, title?: string, sample?: boolean, run?: string,
 *   variant?: 'dense', onAnswered?: (input: PendingInput, answer: WorkflowAnswer) => any }} [spec]
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function workflowInput(spec) {
  const s = spec || {};
  const sample = s.sample === true || (s.run != null && isPlaceholder(s.run));
  const variant = s.variant === 'dense' ? 'dense' : 'default';
  const root = el('section', {
    class: 'ak-root ak-wf' + (variant === 'dense' ? ' ak-wf--dense' : ''), 'data-ak-part': 'root', 'data-ak-variant': variant,
  });
  if (s.target) resolve(s.target).appendChild(root);

  // The lines that stay in place across draws, so a screen reader hears what lands in them.
  const titleEl = el('h3', { class: 'ak-wf__title', 'data-ak-part': 'title' });
  const introEl = el('p', { class: 'ak-wf__intro', 'data-ak-part': 'intro' });
  const failureEl = el('p', { class: 'ak-wf__failure', role: 'alert', tabindex: '-1', 'data-ak-part': 'failure' });
  const noticeEl = el('p', { class: 'ak-wf__notice', role: 'status', tabindex: '-1', 'data-ak-part': 'notice' });
  const body = el('div', { class: 'ak-wf__body', 'data-ak-part': 'body' });
  root.appendChild(titleEl);
  root.appendChild(introEl);
  root.appendChild(failureEl);
  root.appendChild(noticeEl);
  root.appendChild(body);

  /** @type {PendingInput[]} */
  let items = [];
  let loaded = false;
  let stop = '';
  let failure = '';
  let notice = '';
  let drawn = '';
  let seq = 0;
  let destroyed = false;
  /** @type {Map<string, { picks: string[], other: string }>} */
  const drafts = new Map();
  /** @type {Map<string, string>} */
  const stepErrors = new Map();
  /** @type {Set<string>} */
  const answered = new Set();
  /** @type {Set<string>} */
  const sending = new Set();

  function draftOf(key) {
    let d = drafts.get(key);
    if (!d) { d = { picks: [], other: '' }; drafts.set(key, d); }
    return d;
  }

  /** Read the waiting steps. Answers false when a later read overtook this one. */
  async function load() {
    const mine = ++seq;
    /** @type {PendingInput[]} */
    let next = [];
    let nextStop = '';
    let readFailure = '';
    if (sample) {
      next = sampleInputs();
    } else {
      const wf = workflowsOf();
      if (!wf) nextStop = twf('wf.noLib');
      else if (signedOut()) nextStop = twf('wf.signIn');
      else {
        try { next = listOf(await wf.pendingInputs()); } catch (e) { readFailure = refusal(e) || String(e); }
      }
    }
    if (mine !== seq || destroyed) return false;
    stop = nextStop;
    loaded = true;
    if (readFailure) failure = twf('wf.loadFailed', { why: readFailure });
    items = next.filter(function (p) {
      return p && p.question && (sample || !s.run || p.runId === s.run) && !answered.has(keyOf(p));
    });
    // What a person chose for a step that is gone is dropped with it.
    const live = new Set(items.map(keyOf));
    drafts.forEach(function (_v, k) { if (!live.has(k)) drafts.delete(k); });
    stepErrors.forEach(function (_v, k) { if (!live.has(k)) stepErrors.delete(k); });
    return true;
  }

  /** What the focused control is, so a redraw can put the focus back on its twin. */
  function focusMark() {
    const a = /** @type {any} */ (document.activeElement);
    if (!a || !root.contains(a) || typeof a.getAttribute !== 'function') return null;
    const id = a.getAttribute('data-ak-wf-focus');
    return id ? { id: id, start: a.selectionStart, end: a.selectionEnd } : null;
  }

  function restoreFocus(mark) {
    if (!mark) return;
    const twin = /** @type {any} */ (root.querySelector('[data-ak-wf-focus="' + mark.id.replace(/"/g, '') + '"]'));
    if (!twin || typeof twin.focus !== 'function') return;
    twin.focus();
    if (typeof mark.start === 'number' && typeof twin.setSelectionRange === 'function') {
      try { twin.setSelectionRange(mark.start, mark.end); } catch { /* not a text control */ }
    }
  }

  /** Draw from the state. Skips the body when nothing a person sees has changed. */
  function draw(force) {
    const sig = JSON.stringify([i18n.lang(), stop, loaded, failure, notice, Array.from(stepErrors), Array.from(sending),
      items.map(function (p) { return [keyOf(p), p.deadline, p.question, p.workflowTitle, p.mode]; })]);
    if (!force && sig === drawn) return;
    drawn = sig;
    const mark = focusMark();
    clear(titleEl);
    titleEl.appendChild(document.createTextNode(s.title || twf('wf.title')));
    if (sample) titleEl.appendChild(sampleBadge());
    introEl.textContent = sample ? twf('wf.sampleNote') : twf('wf.intro');
    failureEl.textContent = failure;
    noticeEl.textContent = notice;
    clear(body);
    if (stop) { body.appendChild(el('p', { class: 'ak-wf__none', 'data-ak-part': 'none' }, stop)); return; }
    if (!loaded) { body.appendChild(el('p', { class: 'ak-wf__none', 'data-ak-part': 'none' }, twf('wf.loading'))); return; }
    if (!items.length) {
      body.appendChild(el('p', { class: 'ak-wf__none', 'data-ak-part': 'none' }, s.run && !sample ? twf('wf.noneRun') : twf('wf.none')));
      return;
    }
    body.appendChild(el('ul', { class: 'ak-wf__list', 'data-ak-part': 'list' }, items.map(step)));
    restoreFocus(mark);
  }

  function titleOf(p) {
    return local(p.workflowTitle) || p.workflowId || twf('wf.untitled');
  }

  /** One waiting step. @param {PendingInput} p */
  function step(p) {
    const key = keyOf(p);
    const q = p.question || { prompt: '', options: [] };
    const options = Array.isArray(q.options) ? q.options : [];
    const many = !!q.multiSelect;
    const allowOther = q.allowOther !== false;
    const d = draftOf(key);
    const busyNow = sending.has(key);
    const group = uid('ak-wf-g');
    const howId = uid('ak-wf-how');
    const errId = uid('ak-wf-err');
    const errorEl = el('p', { class: 'ak-wf__error', id: errId, role: 'alert', 'data-ak-part': 'error' }, stepErrors.get(key) || '');

    const choices = options.map(function (o) {
      const id = uid('ak-wf-o');
      const input = /** @type {HTMLInputElement} */ (el('input', {
        type: many ? 'checkbox' : 'radio', id: id, name: group, value: o.id, class: 'ak-wf__mark', 'data-ak-part': 'mark',
        'data-ak-wf-focus': key + '|o|' + o.id, checked: d.picks.indexOf(o.id) !== -1 ? true : null, disabled: busyNow ? true : null,
      }));
      input.addEventListener('change', function () {
        if (many) {
          d.picks = d.picks.filter(function (x) { return x !== o.id; });
          if (input.checked) d.picks.push(o.id);
        } else if (input.checked) {
          d.picks = [o.id];
        }
        if (stepErrors.has(key)) { stepErrors.delete(key); errorEl.textContent = ''; }
      });
      return el('label', { class: 'ak-wf__choice', 'data-ak-part': 'choice', for: id }, [input, el('span', {}, o.label || o.id)]);
    });

    let otherField = null;
    if (allowOther) {
      const otherId = uid('ak-wf-x');
      const area = /** @type {HTMLTextAreaElement} */ (el('textarea', {
        id: otherId, class: 'ak-input ak-wf__text', rows: 2, maxlength: 2000, 'data-ak-wf-focus': key + '|other',
        disabled: busyNow ? true : null,
      }));
      area.value = d.other;
      area.addEventListener('input', function () {
        d.other = area.value;
        if (stepErrors.has(key)) { stepErrors.delete(key); errorEl.textContent = ''; }
      });
      otherField = el('div', { class: 'ak-wf__other', 'data-ak-part': 'other' }, [
        el('label', { class: 'ak-wf__other-label', for: otherId }, options.length ? twf('wf.other') : twf('wf.otherOnly')),
        area,
      ]);
    }

    const fieldset = el('fieldset', {
      class: 'ak-wf__choices', 'data-ak-part': 'choices', 'aria-describedby': (options.length ? howId + ' ' : '') + errId,
    }, [
      el('legend', { class: 'ak-wf__question', 'data-ak-part': 'question' }, q.prompt || ''),
      options.length ? el('p', { class: 'ak-wf__how', id: howId, 'data-ak-part': 'how' }, many ? twf('wf.pickMany') : twf('wf.pickOne')) : null,
      options.length ? el('div', { class: 'ak-wf__options' }, choices) : null,
      otherField,
    ]);

    const late = p.deadline && new Date(p.deadline).getTime() < Date.now();
    const due = [
      p.askedAt ? twf('wf.asked', { when: when(p.askedAt) }) : '',
      p.deadline ? twf(late ? 'wf.late' : 'wf.deadline', { when: when(p.deadline) }) : '',
    ].filter(Boolean).join(' · ');
    const answerBtn = el('button', {
      type: 'submit', class: 'ak-btn ak-btn--primary ak-wf__answer', 'data-ak-part': 'answer', 'data-ak-wf-focus': key + '|answer',
      disabled: sample || busyNow ? true : null, 'aria-busy': busyNow ? 'true' : null,
    }, twf('wf.answer'));

    const form = el('form', { class: 'ak-wf__form', 'data-ak-part': 'form', novalidate: true }, [
      fieldset,
      errorEl,
      el('div', { class: 'ak-wf__bar', 'data-ak-part': 'bar' }, [
        due ? el('p', { class: 'ak-wf__deadline' + (late ? ' is-late' : ''), 'data-ak-part': 'deadline' }, due) : null,
        answerBtn,
      ]),
    ]);
    form.addEventListener('submit', function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      send(p, errorEl, fieldset);
    });

    const runWords = [twf('wf.run', { id: String(p.runId || '').slice(0, 8) })];
    if (p.mode === 'full-sandbox') runWords.push(twf('wf.testRun'));
    return el('li', { class: 'ak-wf__step', 'data-ak-part': 'step', 'data-ak-wf-step': key }, [
      el('div', { class: 'ak-wf__head', 'data-ak-part': 'head' }, [
        q.header ? el('span', { class: 'ak-wf__header', 'data-ak-part': 'header' }, q.header) : null,
        el('span', { class: 'ak-wf__workflow', 'data-ak-part': 'workflow' }, titleOf(p)),
        el('span', { class: 'ak-wf__run', 'data-ak-part': 'run', title: p.runId || null }, runWords.join(' · ')),
      ]),
      form,
    ]);
  }

  /**
   * Send one step's answer. A missing choice is said on the step and nothing leaves.
   * @param {PendingInput} p
   * @param {HTMLElement} errorEl
   * @param {HTMLElement} fieldset
   */
  async function send(p, errorEl, fieldset) {
    const key = keyOf(p);
    if (sample || sending.has(key)) return;
    const wf = workflowsOf();
    if (!wf) return;
    const q = p.question || { prompt: '', options: [] };
    const ids = (Array.isArray(q.options) ? q.options : []).map(function (o) { return o.id; });
    const allowOther = q.allowOther !== false;
    const d = draftOf(key);
    const picks = d.picks.filter(function (id) { return ids.indexOf(id) !== -1; });
    const other = allowOther ? d.other.trim() : '';
    if (!picks.length && !other) {
      const why = allowOther ? twf('wf.needPickOrText') : twf('wf.needPick');
      stepErrors.set(key, why);
      errorEl.textContent = why;
      const first = /** @type {any} */ (fieldset.querySelector('input, textarea'));
      if (first && typeof first.focus === 'function') first.focus();
      return;
    }
    /** @type {WorkflowAnswer} */
    const answer = { picks: q.multiSelect ? picks : picks.slice(0, 1) };
    if (other) answer.other = other;
    failure = '';
    notice = '';
    stepErrors.delete(key);
    sending.add(key);
    draw();
    let gone = false;
    try {
      await wf.answer(p.workflowId, p.runId, p.stepId, answer);
      answered.add(key);
      drafts.delete(key);
      notice = twf('wf.answered', { workflow: titleOf(p) });
      if (typeof s.onAnswered === 'function') {
        try { s.onAnswered(p, answer); } catch (e) { console.debug('aimeat-atelier: onAnswered threw', e); }
      }
    } catch (e) {
      if (isGone(e)) { gone = true; failure = twf('wf.gone'); drafts.delete(key); }
      else stepErrors.set(key, twf('wf.failed', { why: refusal(e) || String(e) }));
    }
    sending.delete(key);
    if (destroyed) return;
    const focusWasHere = !document.activeElement || document.activeElement === document.body || root.contains(document.activeElement);
    if (answered.has(key) || gone) items = items.filter(function (x) { return keyOf(x) !== key; });
    draw();
    if (focusWasHere) {
      const twin = /** @type {any} */ (root.querySelector('[data-ak-wf-focus="' + key + '|answer"]'));
      const target = twin || (gone ? failureEl : noticeEl);
      if (typeof target.focus === 'function') target.focus();
    }
    await render();
  }

  /** Read and draw. `force` draws even when nothing changed (a language or a host's words). */
  async function render(force) {
    if (destroyed) return;
    if (!loaded) draw(true);
    if (await load()) draw(force);
  }

  // The live 'workflows' domain, when aimeat-live.js is on the page: a run that parks a step or
  // moves past one is read again. A block taken off the page without destroy() stops listening.
  let unsubLive = null;
  const live = /** @type {any} */ (window).AIMEAT && /** @type {any} */ (window).AIMEAT.live;
  if (!sample && live && typeof live.subscribe === 'function') {
    unsubLive = live.subscribe(['workflows'], function () {
      if (destroyed) return;
      if (!root.isConnected) { stopAll(); return; }
      render();
    });
  }

  const ready0 = render(true).then(function () { enter(root); });
  const stopWatch = watch(function () { failure = ''; notice = ''; render(true); }, root);

  function stopAll() {
    stopWatch();
    if (typeof unsubLive === 'function') { try { unsubLive(); } catch { /* already gone */ } }
    unsubLive = null;
  }

  return {
    el: root,
    refresh: function () { return ready0.then(function () { return render(); }); },
    destroy: function () {
      destroyed = true;
      stopAll();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
