/**
 * @file atelier/request-panel.js
 * @description The request panel — a terminal, not a form. A form asks to be filled and sent; a
 *   terminal is a session: one prompt line with a caret, the plan the app made from the sentence
 *   (its intent, route and risk, the steps with their state), the gate row when a step waits for
 *   the person's approval, and a console of what happened, newest at the tail. While work runs a
 *   single light sweeps the top; at idle nothing moves. From ORIGAMI 1.2.0's request panel, with
 *   the planning, routing and running left to the app: this block draws, reports a press, and
 *   never fetches.
 *
 *   THE SAMPLE STATE. `sample: true` shows a plan with one step done, one running and one
 *   waiting, three console lines and the scanner on, and changes nothing.
 * @parts requestPanel root · line · caret · input · send · scan · plan · intent · meta · step · mark · gate · row · approve · cancel · loop · console
 * @slots requestPanel plan(plan) · step(step)
 * @variants requestPanel compact
 * @tokens requestPanel --ak-request-console-h
 * @fork requestPanel Copy .ak-request* out of board.css and keep the console as AIMEAT.atelier.console; you give up the plan's states, the gate row and the scanner.
 * @structure requestPanel(spec) → { el, set, append, focus, value, destroy }
 * @usage
 *   var p = AIMEAT.atelier.requestPanel({ target: host, onAsk: plan, onApprove: run, onCancel: drop });
 *   p.set({ busy: true, plan: { intent: 'AI spend per day', route: 'local', risk: 'low', gated: false,
 *     steps: [{ id: 's1', text: 'the table', state: 'running' }] } });
 *   p.append([{ ts: Date.now(), tone: 'ok', text: 'table: 23 rows' }]);
 * @version-history
 *   v0.64.0 — 2026-10-02 — Initial (wish-origami-atelieriin-ja-laudan-osat-kitin-lohkoiksi-ja-design-).
 */
import { el, clear, resolve } from './dom.js';
import { applyVariant } from './parts-model.js';
import { konsole } from './konsole.js';
import { tb } from './board-i18n.js';

const VARIANTS = ['compact'];
const MARKS = { pending: '·', running: '→', done: '✓', failed: '✗' };
const STATES = ['pending', 'running', 'done', 'failed'];

/**
 * @typedef {{ id: string, text: string, state?: 'pending'|'running'|'done'|'failed', route?: string }} RequestStep
 * @typedef {{ intent?: string, route?: 'local'|'agent'|'tool'|'prompt', risk?: 'low'|'medium'|'high',
 *   gated?: boolean, gateWhy?: string, via?: string, steps?: RequestStep[] }} RequestPlan
 */

/** @returns {RequestPlan} */
function samplePlan() {
  /** @type {RequestPlan} */
  const plan = {
    intent: 'Show my AI spend per day, and draw a chart of the same numbers',
    route: 'local', risk: 'low', gated: false,
    steps: [
      { id: 's1', text: 'AI usage, by day: a table', state: 'done' },
      { id: 's2', text: 'the same numbers, as a chart', state: 'running' },
      { id: 's3', text: 'one line on what stands out', state: 'pending' },
    ],
  };
  return plan;
}
function sampleLines() {
  const base = Date.now() - 40000;
  return [
    { ts: base, tone: 'plain', text: 'reading ai-usage. (23 keys, fields: date, total_calls, total_tokens)' },
    { ts: base + 12000, tone: 'ok', text: 'choice: ai-usage, because the request names spend per day (high)' },
    { ts: base + 30000, tone: 'ok', text: 'table: 23 rows' },
  ];
}

/**
 * The request panel.
 * @param {{
 *   target?: string|Element, variant?: string, sample?: boolean,
 *   placeholder?: string, value?: string, plan?: RequestPlan|null, busy?: boolean,
 *   lines?: Array<{ ts?: any, tone?: string, text: string }>, cap?: number,
 *   loop?: boolean, onLoop?: (on: boolean) => void,
 *   onAsk?: (text: string) => void, onApprove?: (plan: RequestPlan) => void, onCancel?: (plan: RequestPlan) => void,
 *   parts?: { plan?: (plan: RequestPlan) => any, step?: (step: RequestStep) => any },
 * }} spec
 */
export function requestPanel(spec) {
  const sample = spec.sample === true;
  const parts = spec.parts || {};
  const root = el('div', { class: 'ak-root ak-request', 'data-ak-part': 'root' });
  applyVariant(root, spec, VARIANTS);
  if (spec.target) resolve(spec.target).appendChild(root);
  /** @type {RequestPlan|null} */
  let plan = sample ? samplePlan() : (spec.plan || null);
  let destroyed = false;

  const placeholder = spec.placeholder || tb('request.prompt');
  const input = /** @type {HTMLInputElement} */ (el('input', {
    class: 'ak-request__input', 'data-ak-part': 'input', type: 'text', autocomplete: 'off',
    placeholder: placeholder, 'aria-label': placeholder,
  }));
  input.value = sample ? samplePlan().intent : (spec.value || '');
  const send = el('button', {
    type: 'button', class: 'ak-btn ak-btn--primary ak-request__send', 'data-ak-part': 'send', 'data-ak-noguard': true,
    text: tb('request.send'), on: { click: ask },
  });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ask(); } });
  root.appendChild(el('div', { class: 'ak-request__line', 'data-ak-part': 'line' }, [
    el('span', { class: 'ak-request__caret', 'data-ak-part': 'caret', 'aria-hidden': 'true', text: '>' }), input, send,
  ]));
  const scan = el('div', { class: 'ak-request__scan', 'data-ak-part': 'scan', role: 'status', 'aria-label': tb('request.working') });
  root.appendChild(scan);
  const planHost = el('div', { class: 'ak-request__plan', 'data-ak-part': 'plan' });
  root.appendChild(planHost);
  const log = konsole({ target: root, cap: spec.cap, data: { lines: sample ? sampleLines() : (spec.lines || []) }, empty: { title: tb('request.empty'), hint: '' } });
  log.el.setAttribute('data-ak-part', 'console');
  root.style.setProperty('--ak-request-console-h', 'var(--ak-request-console-h, 160px)');

  /** @type {HTMLInputElement|null} */
  let loopBox = null;
  if (spec.loop !== undefined || sample) {
    loopBox = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', 'data-ak-noguard': true }));
    loopBox.checked = !!spec.loop;
    loopBox.addEventListener('change', function () { if (spec.onLoop) spec.onLoop(!!loopBox.checked); });
    root.appendChild(el('label', { class: 'ak-request__loop', 'data-ak-part': 'loop' }, [loopBox, el('span', { text: tb('request.loop') })]));
  }

  function ask() {
    const text = String(input.value || '').trim();
    if (!text || !spec.onAsk) return;
    spec.onAsk(text);
  }

  function setBusy(on) { scan.hidden = !on; }
  setBusy(sample ? true : !!spec.busy);

  function routeWord(route) {
    const key = 'request.route.' + route;
    const w = tb(key);
    return w === key ? String(route) : w;
  }
  function riskWord(risk) {
    const key = 'request.risk.' + risk;
    const w = tb(key);
    return w === key ? String(risk) : w;
  }

  function fillSlot(host, value) {
    clear(host);
    if (value == null || value === false) return;
    if (value instanceof Node) host.appendChild(value);
    else if (Array.isArray(value)) value.forEach(function (v) { fillSlot(host, v); });
    else host.textContent = String(value);
  }

  function renderPlan() {
    clear(planHost);
    planHost.hidden = !plan;
    if (!plan) return;
    if (parts.plan) { fillSlot(planHost, parts.plan(plan)); return; }
    planHost.appendChild(el('div', { class: 'ak-request__intent', 'data-ak-part': 'intent', text: plan.intent || '' }));
    const meta = [];
    if (plan.route) meta.push(routeWord(plan.route) + (plan.via ? ' (' + plan.via + ')' : ''));
    if (plan.risk) meta.push(riskWord(plan.risk));
    if (meta.length) planHost.appendChild(el('div', { class: 'ak-request__meta', 'data-ak-part': 'meta', text: meta.join(' · ') }));
    (plan.steps || []).forEach(function (step) {
      const state = STATES.indexOf(step.state || '') >= 0 ? step.state : 'pending';
      const row = el('div', { class: 'ak-request__step ak-request__step--' + state, 'data-ak-part': 'step', 'data-ak-id': step.id, 'data-ak-state': state });
      if (parts.step) { fillSlot(row, parts.step(step)); planHost.appendChild(row); return; }
      row.appendChild(el('span', { class: 'ak-request__mark', 'data-ak-part': 'mark', 'aria-hidden': 'true', text: MARKS[state] }));
      row.appendChild(el('span', { class: 'ak-request__text', text: step.text || '' }));
      planHost.appendChild(row);
    });
    if (plan.gated) {
      planHost.appendChild(el('div', { class: 'ak-request__gate', 'data-ak-part': 'gate', text: plan.gateWhy || tb('request.gate') }));
      planHost.appendChild(el('div', { class: 'ak-request__row', 'data-ak-part': 'row' }, [
        el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'approve', 'data-ak-noguard': true, text: tb('request.approve'),
          on: { click: function () { if (spec.onApprove && plan) spec.onApprove(plan); } } }),
        el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-part': 'cancel', 'data-ak-noguard': true, text: tb('request.cancel'),
          on: { click: function () { if (spec.onCancel && plan) spec.onCancel(plan); } } }),
      ]));
    }
  }
  renderPlan();

  return {
    el: root,
    /** @param {{ plan?: RequestPlan|null, lines?: any[], busy?: boolean, value?: string, loop?: boolean }} patch */
    set: function (patch) {
      if (destroyed || !patch) return;
      if ('plan' in patch) { plan = patch.plan || null; renderPlan(); }
      if (patch.lines) log.set({ data: { lines: patch.lines } });
      if ('busy' in patch) setBusy(!!patch.busy);
      if (typeof patch.value === 'string') input.value = patch.value;
      if ('loop' in patch && loopBox) loopBox.checked = !!patch.loop;
    },
    append: function (lines) { if (!destroyed) log.append(lines); },
    focus: function () { input.focus(); },
    value: function () { return String(input.value || ''); },
    destroy: function () { destroyed = true; log.destroy(); root.remove(); },
  };
}
