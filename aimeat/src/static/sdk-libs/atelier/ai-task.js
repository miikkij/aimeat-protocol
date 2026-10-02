/**
 * @file atelier/ai-task.js
 * @description aiTask: ask the person's own AI once and show the answer. Twelve published apps wrote
 *   their own "is AI available?" check and their own no-AI line, six wrote a prompt box with a run
 *   button and a busy state, seven drew the answer with the EU AI label, five wrote a cost line and
 *   five wrote their own words per error code. This block is that whole screen, over AIMEAT.ai.
 *
 *   THE STATES, in the order the block decides them:
 *     sample      `sample: true`, or an appId that is missing or still a fill's <placeholder>: a
 *                 marked sample answer, and nothing is sent
 *     no library  AIMEAT.ai is not on the page: with `copyPrompt` the copy route only, said in
 *                 words; without it one sentence that names aimeat-ai.js
 *     signed out  a Sign in button through AIMEAT.auth.signIn() when the page has it
 *     unavailable capabilities({ app_id }).capabilities.text.on is false (isAvailable() on a node
 *                 that does not answer capabilities): the node's `fix` sentence for the person,
 *                 and an Open AI settings button to its `settingsUrl`
 *     ready       the box and the run button; an empty box, or one under `minChars`, keeps the
 *                 button off and says why under it
 *     busy        the button is held busy and a status line says the AI is working
 *     answered    the answer (markdown through AIMEAT.md when it is loaded, else text), the visible
 *                 AI label through AIMEAT.ai.disclose(), the model, the date and time it was made,
 *                 a cost line from r.budget, and a note when the answer was cut at the length limit
 *     stored      a result the app kept (spec `result`, or show(result)) is drawn the same way,
 *                 with its own provenance, model and date, and no AI call; the cost line is left
 *                 out, because "today" in a stored budget is the day the answer was made
 *     error       words for each code the library throws; SPEND_CANCELLED says nothing
 *
 *   A STRUCTURED ANSWER. With `schema` the call goes through completeJson() and the result carries
 *   `parsed`. With `render` a function, the block calls render(result, host) for a fresh answer and
 *   for a stored one alike, and the app draws its own cards from result.parsed into host; without
 *   it the object is shown as JSON. A fresh result gets `at` (an ISO time) before onResult sees it,
 *   so the record the app keeps can be shown again with its date.
 *
 *   WHAT FETCHES. Nothing here fetches and nothing here writes memory: every call goes through
 *   AIMEAT.ai, which spends the signed-in person's own budget on their own provider, and the app
 *   keeps the results itself. The block redraws on a sign-in, a sign-out and a language change
 *   (members-shared watch()).
 *
 *   THE SECOND ROUTE. With `copyPrompt: true` the kit's promptPanel sits under the block: copy the
 *   prompt into any AI chat and paste the answer back, for a person whose AI is not connected here.
 *   A pasted answer is drawn like a model answer, says where it came from, and reaches onResult with
 *   `pasted: true` and no provenance record.
 * @parts aiTask root · title · sample · hint · notice · signIn · settings · field · label · input · reason · bar · run · status · failure · result · aiLabel · body · meta · model · made · cost · truncated · copyRoute · copyTitle
 * @variants aiTask compact
 * @tokens aiTask --ak-ai-width
 * @fork aiTask Copying it out means calling AIMEAT.ai.capabilities(), complete() or completeJson(), disclose() and AIMEAT.md.render() yourself, writing the no-AI, signed-out and error words in three languages, holding the button busy, and drawing a stored answer again with its label and date.
 * @structure exported helpers, shared with ai-chat.js (aiOf · authOf · signedOut · unset · money ·
 *   errorWords · errorOf · paintFailure · settingsLink · probeAi · aiNotice · sampleMark · aiLabelInto ·
 *   drawText · madeWhen) · aiTask(spec)
 * @usage
 *   AIMEAT.atelier.aiTask({ target: '#ask', appId: 'my-app', title: 'Read my situation',
 *     input: { placeholder: 'Describe it in your own words', minChars: 10 },
 *     prompt: (text) => 'Analyse this situation:\n' + text, copyPrompt: true,
 *     onResult: (r) => save(r.content, r.provenance) });
 *   // A structured answer the app keeps, drawn again later from its archive:
 *   const task = AIMEAT.atelier.aiTask({ target: '#go', appId: 'my-app', schema: SHAPE,
 *     prompt: (text) => buildPrompt(text), render: (r, host) => drawCards(r.parsed, host),
 *     onResult: (r) => AIMEAT.data.set('my-app.analyses.' + id, r) });
 *   task.show(await AIMEAT.data.get('my-app.analyses.' + id));
 * @version-history
 *   v0.64.0 — 2026-10-02 — The way to the fix: with the AI off, the notice carries an Open AI
 *     settings button (part `settings`) to the node's `settingsUrl`, which opens the person's AI
 *     settings at the provider to fix; a refused call's failure line says the node's sentence for the
 *     person (`fix`) and carries the same button. errorOf, paintFailure and settingsLink are exported
 *     for aiChat.
 *   v0.63.0 — 2026-10-02 — A stored result: `result` in the spec and show(result) on the handle draw
 *     an answer the app kept, with its AI label, model and date, without calling the AI. A fresh
 *     result gets `at`. render(result, host) draws both. The meta line has the date (part `made`).
 *     The shared helpers are exported for aiChat (ai-chat.js).
 *   v0.62.1 — 2026-10-01 — The cost line's amounts go through _core/format.js money() in the
 *     currency the budget names (default USD), not a hand-made "$0.00", so a Finnish reader sees
 *     their own number format.
 *   v0.62.0 — 2026-10-01 — Initial.
 */
import { el, clear, resolve, uid, enter, attention } from './dom.js';
import { money as fmtMoney, dateTime } from '../_core/format.js';
import { t } from './i18n.js';
import { tai } from './ai-task-i18n.js';
import { isPlaceholder, sampleBadge, watch } from './members-shared.js';
import { promptPanel } from './workbench-parts.js';
import { applyVariant } from './parts-model.js';

/** The page's AIMEAT.ai, or null. @returns {any} */
export function aiOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.ai ? ns.ai : null;
}

/** The page's AIMEAT.auth, or null. @returns {any} */
export function authOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.auth ? ns.auth : null;
}

/** True when the page knows for certain that nobody is signed in. @returns {boolean} */
export function signedOut() {
  const auth = authOf();
  return !!(auth && typeof auth.getSession === 'function' && !auth.getSession());
}

/** Whether a prop is missing or still a fill's placeholder. @param {any} v @returns {boolean} */
export function unset(v) {
  return !v || isPlaceholder(v);
}

/**
 * Which AI route this page has, for one app id. Spends nothing: capabilities() plans the call
 * without making it.
 * @param {string} appId
 * @param {boolean} sample  the block is a sample, so nothing is asked
 * @returns {Promise<{ avail: 'sample'|'nolib'|'signedout'|'off'|'on', fix: string, settingsUrl?: string }>}
 */
export async function probeAi(appId, sample) {
  if (sample) return { avail: 'sample', fix: '' };
  const lib = aiOf();
  if (!lib) return { avail: 'nolib', fix: '' };
  if (signedOut()) return { avail: 'signedout', fix: '' };
  if (typeof lib.capabilities === 'function') {
    try {
      const caps = await lib.capabilities({ app_id: appId });
      const text = caps && caps.capabilities && caps.capabilities.text;
      if (text && text.on === false) return { avail: 'off', fix: String(text.fix || text.message || text.reason || ''), settingsUrl: String(text.settingsUrl || '') };
      if (text && text.on === true) return { avail: 'on', fix: '' };
    } catch (e) {
      // A node without GET /v1/ai/capabilities: isAvailable() below answers instead.
      console.debug('aimeat-atelier: AI capabilities not read', e);
    }
  }
  if (typeof lib.isAvailable === 'function') {
    const ok = await Promise.resolve(lib.isAvailable()).catch(function () { return false; });
    return ok ? { avail: 'on', fix: '' } : { avail: 'off', fix: '' };
  }
  return { avail: 'on', fix: '' };
}

/**
 * The line that says why the AI route is not here and what to do, with a Sign in button through
 * AIMEAT.auth.signIn() when nobody is signed in and the page has the library. Empty when the
 * route is here.
 * With the AI off and the node's `settingsUrl`, an Open AI settings button that opens the person's
 * AI settings at the provider to fix, with its test chosen when a test is the fix.
 * @param {string} block  the BEM block of the caller, e.g. 'aitask' or 'aichat'
 * @param {{ avail: string, fix: string, settingsUrl?: string }} st
 * @param {boolean} [copy]  the block offers the copy-the-prompt route
 * @returns {HTMLElement[]}
 */
export function aiNotice(block, st, copy) {
  let words = '';
  if (st.avail === 'sample') words = tai('aiTask.sampleNote');
  else if (st.avail === 'nolib') words = copy ? tai('aiTask.noLibCopy') : tai('aiTask.noLib');
  else if (st.avail === 'signedout') words = tai('aiTask.signIn');
  else if (st.avail === 'off') words = st.fix || tai('aiTask.off');
  if (!words) return [];
  const out = [el('p', { class: 'ak-' + block + '__notice', 'data-ak-part': 'notice' }, words)];
  const auth = authOf();
  if (st.avail === 'signedout' && auth && typeof auth.signIn === 'function') {
    const b = el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'signIn', 'data-ak-noguard': true }, tai('aiTask.signInBtn'));
    b.addEventListener('click', function () {
      // The click is the user gesture that opens the sign-in window; the login event redraws.
      Promise.resolve(auth.signIn()).catch(function (e) { console.debug('aimeat-atelier: sign-in closed', e); });
    });
    out.push(el('div', { class: 'ak-' + block + '__bar', 'data-ak-part': 'bar' }, [b]));
  }
  if (st.avail === 'off' && st.settingsUrl) {
    out.push(el('div', { class: 'ak-' + block + '__bar', 'data-ak-part': 'bar' }, [settingsLink(st.settingsUrl)]));
  }
  return out;
}

/**
 * The button that opens the person's AI settings where the node says the fix is (the `settingsUrl`
 * of a capability that is off, or of a refused call). A new tab, so the app stays where it was.
 * @param {string} url
 * @returns {HTMLElement}
 */
export function settingsLink(url) {
  return el('a', { class: 'ak-btn ak-btn--primary', href: url, target: '_blank', rel: 'noopener', 'data-ak-part': 'settings' }, tai('aiTask.openSettings'));
}

/**
 * What a failed call leaves for the failure line: the code and message, and the node's sentence for
 * the person and its settings link when the refusal carries them (AIMEAT.ai errors lift both).
 * @param {any} e
 * @returns {{ code?: string, message: string, fix?: string, settingsUrl?: string }}
 */
export function errorOf(e) {
  return {
    code: e && e.code, message: e && e.message ? e.message : String(e || ''),
    ...(e && e.fix ? { fix: String(e.fix) } : {}), ...(e && e.settingsUrl ? { settingsUrl: String(e.settingsUrl) } : {}),
  };
}

/**
 * The failure line: the words for the error, and the Open AI settings button when the node named
 * where the fix is.
 * @param {HTMLElement} p
 * @param {{ code?: string, message?: string, fix?: string, settingsUrl?: string }|null} err
 */
export function paintFailure(p, err) {
  p.textContent = err ? errorWords(err) : '';
  if (err && err.settingsUrl) p.append(' ', settingsLink(err.settingsUrl));
  p.hidden = !err;
}

/** The kit's sample badge, named as a part of the AI blocks. @returns {HTMLElement} */
export function sampleMark() {
  const b = sampleBadge();
  b.setAttribute('data-ak-part', 'sample');
  return b;
}

/**
 * The visible AI label from a provenance record, through AIMEAT.ai.disclose(), which draws nothing
 * when no label is owed. A stored record works the same as a fresh one.
 * @param {HTMLElement} host
 * @param {any} provenance
 * @returns {void}
 */
export function aiLabelInto(host, provenance) {
  const lib = aiOf();
  if (!provenance || !lib || typeof lib.disclose !== 'function') return;
  try { lib.disclose(provenance, { target: host }); } catch (e) { console.debug('aimeat-atelier: AI label not drawn', e); }
}

/**
 * A text as markdown through AIMEAT.md when it is loaded and `mode` is not 'text', else as text.
 * @param {string} text
 * @param {HTMLElement} host
 * @param {string} [mode]  'text' draws plain text
 * @param {string} [cls]  the class of the plain-text box
 * @returns {void}
 */
export function drawText(text, host, mode, cls) {
  const ns = /** @type {any} */ (window).AIMEAT;
  const md = ns && ns.md;
  if (mode !== 'text' && md && typeof md.render === 'function') {
    try { md.render(text, host); return; } catch (e) { console.debug('aimeat-atelier: markdown not drawn', e); }
  }
  host.appendChild(el('div', { class: cls || 'ak-aitask__text' }, text));
}

/**
 * When a result was made, in the reader's own date and time format, or '' when `at` is not a time.
 * @param {any} at  an ISO time or a millisecond count
 * @returns {string}
 */
export function madeWhen(at) {
  if (at == null || at === '') return '';
  const d = new Date(at);
  if (!isFinite(d.getTime())) return '';
  return dateTime(d.toISOString(), { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * An amount on the budget line, through the SDK's one money formatter (_core/format.js): the
 * reader's own number format, four decimals under a cent and two above. The currency is the one
 * the budget answer names, else US dollars, which is what the node's `..._usd` fields hold.
 * @param {number} v
 * @param {string} [currency]  a three-letter code
 * @returns {string}
 */
export function money(v, currency) {
  if (typeof v !== 'number' || !isFinite(v)) return '';
  const code = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'USD';
  return fmtMoney(v, code);
}

/** The codes that have their own sentence; JSON_PARSE_FAILED shares the shape mismatch's. */
const CODES = ['NO_API_KEY', 'INVALID_API_KEY', 'QUOTA_EXHAUSTED', 'APP_QUOTA_EXHAUSTED', 'RATE_LIMITED', 'JSON_SCHEMA_MISMATCH'];

/**
 * The words for a failed call, in the current language: the kit's own for the codes it knows, else
 * the node's sentence for the person (`fix`), else the message.
 * @param {{ code?: string, message?: string, fix?: string }} e
 * @returns {string}
 */
export function errorWords(e) {
  const code = e && e.code === 'JSON_PARSE_FAILED' ? 'JSON_SCHEMA_MISMATCH' : (e && e.code);
  if (code && CODES.indexOf(code) >= 0) return tai('aiTask.err.' + code);
  // The node's own sentence for the person (an AI that is off, and what turns it on).
  if (e && e.fix) return String(e.fix);
  const why = e && e.message ? String(e.message) : '';
  return why ? tai('aiTask.err.generic', { why: why }) : tai('aiTask.err.noReason');
}

/**
 * @typedef {object} AiTaskSpec
 * @property {string|Element} [target]
 * @property {string} appId  the app_id the call is made under (and the person's allowlist reads)
 * @property {string} [title]
 * @property {string} [hint]  one line under the title
 * @property {{ placeholder?: string, minChars?: number, multiline?: boolean, label?: string }|null} [input]
 *   the prompt box; null draws a run button only, and prompt() gets ''
 * @property {(text: string) => string} prompt  the full prompt from what the person wrote
 * @property {string} [systemPrompt]
 * @property {any} [schema]  ask for JSON through completeJson(); the answer's object is `parsed`
 * @property {'markdown'|'text'|((result: any, host: HTMLElement) => void)} [render]  'markdown' by
 *   default; a function draws the answer itself from result.parsed (or result.content) into host,
 *   for a fresh answer and a stored one alike
 * @property {AiResult|null} [result]  a result the app kept, drawn without calling the AI
 * @property {string} [runLabel]
 * @property {boolean} [copyPrompt]  add the copy-the-prompt, paste-the-answer route under the block
 * @property {boolean} [sample]
 * @property {Record<string, any>} [options]  more fields for the call: model, temperature,
 *   max_tokens, confirm, role
 * @property {'compact'} [variant]
 * @property {(result: AiResult) => void} [onResult]  the result, with `provenance` (or `pasted:
 *   true`) and `at`; the app keeps it where it wants, and show() draws it again
 */

/**
 * What a call gave, and what the app keeps and hands back to show().
 * @typedef {object} AiResult
 * @property {string} [content]  the answer's text (the raw JSON text for a schema call)
 * @property {any} [parsed]  the object of a schema call
 * @property {string} [model]
 * @property {{ spent_today_usd?: number, daily_budget_usd?: number, currency?: string }} [budget]
 * @property {any} [provenance]  the node's provenance record, which the AI label is drawn from
 * @property {string} [at]  when the answer was made, an ISO time
 * @property {boolean} [truncated]
 * @property {boolean} [pasted]  pasted back from the person's own AI chat
 */

/**
 * Ask the AI once and show the answer.
 * @param {AiTaskSpec} spec
 * @returns {{ el: HTMLElement, run: (text?: string) => Promise<any>,
 *   show: (result: AiResult|null) => void,
 *   set: (patch: Partial<AiTaskSpec>) => void, destroy: () => void }}
 */
export function aiTask(spec) {
  /** @type {AiTaskSpec} */
  const s = Object.assign({}, spec);
  const root = el('section', { class: 'ak-root ak-aitask', 'data-ak-part': 'root' });
  applyVariant(root, s, ['compact']);
  if (s.target) resolve(s.target).appendChild(root);

  /**
   * What the block knows between draws. `avail` is the route: checking, sample, nolib, signedout,
   * off or on. `answer` is what is shown: a model's result, a pasted one, a stored one, or the
   * sample; `stored` says it came from the app (spec `result` or show()), not from a call.
   */
  const state = {
    avail: 'checking',
    fix: '',
    settingsUrl: '',
    text: '',
    busy: false,
    /** @type {any} */
    answer: s.result || null,
    stored: !!s.result,
    /** @type {any} */
    error: null,
    session: !signedOut(),
  };
  let gen = 0;
  let dead = false;
  /** @type {Promise<any>|null} */
  let inFlight = null;
  /** @type {{ destroy: () => void }|null} */
  let panel = null;
  /** The live parts of the current draw; build() replaces them. */
  /** @type {Record<string, any>} */
  let parts = {};

  const isSample = function () { return s.sample === true || unset(s.appId); };
  const hasBox = function () { return s.input !== null; };
  const minChars = function () {
    const n = s.input && typeof s.input.minChars === 'number' ? s.input.minChars : 1;
    return Math.max(1, Math.floor(n));
  };
  const promptText = function () {
    return typeof s.prompt === 'function' ? String(s.prompt(hasBox() ? state.text : '') || '') : '';
  };

  async function refresh() {
    const mine = ++gen;
    state.avail = 'checking';
    build();
    const r = await probeAi(s.appId, isSample());
    if (mine !== gen || dead) return;
    state.avail = r.avail;
    state.fix = r.fix;
    state.settingsUrl = r.settingsUrl || '';
    build();
  }

  function sampleAnswer() {
    return { content: tai('aiTask.sampleAnswer'), model: 'sample-model', budget: { spent_today_usd: 0.02, daily_budget_usd: 1 }, sample: true };
  }

  /** Why the run button is off, or '' when it may run. */
  function reason() {
    if (!hasBox()) return '';
    const n = state.text.trim().length;
    if (n === 0) return tai('aiTask.needText');
    if (n < minChars()) return tai('aiTask.needChars', { n: minChars(), m: n });
    return '';
  }

  const canAsk = function () { return state.avail === 'on' || state.avail === 'sample'; };

  /** The whole block from `state`. */
  function build() {
    if (panel) { panel.destroy(); panel = null; }
    clear(root);
    parts = {};
    // The sample answer is drawn in the current language, so a language change redraws it too. A
    // stored result the app handed in stays: showing it calls nothing.
    if (state.avail === 'sample' && !state.stored) state.answer = sampleAnswer();
    root.appendChild(el('h3', { class: 'ak-aitask__title', 'data-ak-part': 'title' },
      [s.title || tai('aiTask.title'), state.avail === 'sample' ? sampleMark() : null].filter(Boolean)));
    if (s.hint) root.appendChild(el('p', { class: 'ak-aitask__hint', 'data-ak-part': 'hint' }, s.hint));
    for (const n of aiNotice('aitask', state, !!s.copyPrompt)) root.appendChild(n);
    // The box is also the copy route's input: without it a pasted-answer route would build the
    // prompt from an empty text.
    const live = canAsk() || state.avail === 'checking';
    if (live || s.copyPrompt) ask(live);
    parts.failure = el('p', { class: 'ak-aitask__failure', role: 'alert', 'data-ak-part': 'failure', hidden: true });
    root.appendChild(parts.failure);
    parts.answer = el('div', { class: 'ak-aitask__answer', 'data-ak-part': 'result', role: 'region', 'aria-label': tai('aiTask.answer'), hidden: true });
    root.appendChild(parts.answer);
    if (s.copyPrompt) copyRoute();
    paint();
    drawAnswer(parts.answer);
  }

  /**
   * The box and the reason line, and with `live` the run button and the busy line.
   * @param {boolean} live  the AI route is here (or is being checked)
   */
  function ask(live) {
    const id = uid('ak-aitask');
    const reasonId = id + '-why';
    if (hasBox()) {
      const cfg = s.input || {};
      const multi = cfg.multiline !== false;
      const box = /** @type {HTMLTextAreaElement} */ (el(multi ? 'textarea' : 'input', {
        id: id, class: 'ak-input' + (multi ? ' ak-input--area' : ''), 'data-ak-part': 'input',
        type: multi ? null : 'text', rows: multi ? (s.variant === 'compact' ? 2 : 4) : null,
        placeholder: cfg.placeholder || null, 'aria-describedby': reasonId, autocomplete: 'off',
      }));
      box.value = state.text;
      box.addEventListener('input', function () { state.text = box.value; paint(); });
      root.appendChild(el('div', { class: 'ak-form__field ak-aitask__field', 'data-ak-part': 'field' }, [
        el('label', { class: 'ak-form__label', 'data-ak-part': 'label', for: id }, cfg.label || tai('aiTask.inputLabel')),
        box,
      ]));
      parts.box = box;
    }
    parts.reason = el('p', { class: 'ak-aitask__reason', 'data-ak-part': 'reason', id: reasonId, hidden: true });
    root.appendChild(parts.reason);
    if (!live) return;
    const run = el('button', {
      type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'run', 'data-ak-noguard': true,
      'aria-describedby': reasonId,
    }, s.runLabel || tai('aiTask.run'));
    run.addEventListener('click', function () { go(); });
    parts.run = run;
    parts.status = el('p', { class: 'ak-aitask__status', role: 'status', 'data-ak-part': 'status' });
    root.appendChild(el('div', { class: 'ak-aitask__bar', 'data-ak-part': 'bar' }, [run, parts.status]));
  }

  /** The kit's prompt panel as the second route. */
  function copyRoute() {
    const host = el('div', { class: 'ak-aitask__copy', 'data-ak-part': 'copyRoute' }, [
      el('h4', { class: 'ak-aitask__copy-title', 'data-ak-part': 'copyTitle' }, tai('aiTask.copyTitle')),
    ]);
    root.appendChild(host);
    panel = promptPanel({
      target: host,
      prompt: promptText,
      expect: s.schema ? 'json' : 'text',
      onResult: function (value, raw) {
        /** @type {any} */
        const r = { content: raw, pasted: true, provenance: null, at: new Date().toISOString() };
        if (s.schema) r.parsed = value;
        state.answer = r;
        state.stored = false;
        state.error = null;
        paint();
        drawAnswer(parts.answer);
        if (typeof s.onResult === 'function') s.onResult(r);
      },
    });
  }

  /**
   * The parts that change as the person types or a call runs: the reason, the run button, the
   * busy line, the copy route's preview and copy button, and the error. Not the answer: that is
   * drawn when it changes, never on a keystroke.
   */
  function paint() {
    const why = reason();
    if (parts.reason) {
      parts.reason.textContent = state.avail === 'checking' ? tai('aiTask.checking') : why;
      parts.reason.hidden = !(why || state.avail === 'checking');
    }
    const run = /** @type {HTMLButtonElement|undefined} */ (parts.run);
    if (run) {
      // The busy mark is drawn from state, so a redraw in the middle of a call keeps it.
      run.disabled = state.busy || !!why || !canAsk();
      run.classList.toggle('ak-busy', state.busy);
      if (state.busy) run.setAttribute('aria-busy', 'true'); else run.removeAttribute('aria-busy');
    }
    if (parts.status) {
      parts.status.textContent = state.busy ? tai('aiTask.running') : (state.answer && !state.answer.sample ? tai('aiTask.ready') : '');
      parts.status.classList.toggle('ak-sr-only', !state.busy);
    }
    paintCopy(why);
    if (parts.failure) paintFailure(parts.failure, state.error);
  }

  /**
   * The copy route follows the box: its preview shows the prompt as it is now (the panel reads the
   * prompt fresh on Copy anyway), and Copy is off while the box says why the AI would not run.
   * @param {string} why
   */
  function paintCopy(why) {
    const host = panel ? /** @type {any} */ (panel).el : null;
    if (!host) return;
    const preview = host.querySelector('[data-ak-part="preview"]');
    if (preview && !preview.classList.contains('ak-promptpanel__preview--full')) {
      const lines = promptText().split('\n');
      preview.textContent = lines[0].slice(0, 120) + '… (' + (lines.length === 1 ? t('promptLine1') : t('promptLines', { n: lines.length })) + ')';
    }
    const copy = host.querySelector('[data-ak-part="copy"]');
    if (copy) copy.disabled = !!why;
  }

  /** @param {HTMLElement} host */
  function drawAnswer(host) {
    if (!host) return;
    clear(host);
    const r = state.answer;
    host.hidden = !r;
    if (!r) return;
    const label = el('div', { class: 'ak-aitask__label', 'data-ak-part': 'aiLabel' });
    host.appendChild(label);
    aiLabelInto(label, r.provenance);
    const body = el('div', { class: 'ak-aitask__body', 'data-ak-part': 'body' });
    host.appendChild(body);
    drawBody(r, body);
    const meta = [];
    if (r.pasted) meta.push(el('span', { class: 'ak-aitask__model', 'data-ak-part': 'model' }, tai('aiTask.pasted')));
    if (r.model) meta.push(el('span', { class: 'ak-aitask__model', 'data-ak-part': 'model' }, tai('aiTask.model', { model: r.model })));
    const when = r.sample ? '' : madeWhen(r.at);
    if (when) meta.push(el('time', { class: 'ak-aitask__made', 'data-ak-part': 'made', datetime: new Date(r.at).toISOString() }, tai('aiTask.made', { when: when })));
    // A stored budget says what was spent on the day the answer was made, not today.
    const b = state.stored ? null : r.budget;
    if (b && typeof b.spent_today_usd === 'number') {
      const cap = typeof b.daily_budget_usd === 'number' && b.daily_budget_usd > 0;
      meta.push(el('span', { class: 'ak-aitask__cost', 'data-ak-part': 'cost' }, cap
        ? tai('aiTask.cost', { spent: money(b.spent_today_usd, b.currency), budget: money(b.daily_budget_usd, b.currency) })
        : tai('aiTask.costNoCap', { spent: money(b.spent_today_usd, b.currency) })));
    }
    if (meta.length) host.appendChild(el('p', { class: 'ak-aitask__meta', 'data-ak-part': 'meta' }, meta));
    if (r.truncated) host.appendChild(el('p', { class: 'ak-aitask__truncated', 'data-ak-part': 'truncated' }, tai('aiTask.truncated')));
  }

  /**
   * The answer itself: the app's own render, markdown, or text. The app's render gets the whole
   * result, so a structured answer is result.parsed and a stored one is drawn by the same code.
   * @param {any} r
   * @param {HTMLElement} body
   */
  function drawBody(r, body) {
    const json = r.parsed !== undefined && (!r.pasted || r.content == null)
      ? JSON.stringify(r.parsed, null, 2)
      : String(r.content == null ? '' : r.content);
    if (typeof s.render === 'function') {
      try { s.render(r, body); } catch (e) { clear(body); body.textContent = json; console.debug('aimeat-atelier: aiTask render failed', e); }
      return;
    }
    if (s.schema || (r.parsed !== undefined && r.content == null)) { body.appendChild(el('pre', { class: 'ak-aitask__json' }, json)); return; }
    drawText(json, body, s.render, 'ak-aitask__text');
  }

  /** One run from the button or from run(). Resolves to the result, or null when nothing ran. */
  function go() {
    if (inFlight) return inFlight;
    if (!canAsk() || reason()) return Promise.resolve(null);
    state.error = null;
    state.stored = false;
    if (state.avail === 'sample') {
      state.answer = sampleAnswer();
      paint();
      drawAnswer(parts.answer);
      return Promise.resolve(null);
    }
    const lib = aiOf();
    if (!lib) return Promise.resolve(null);
    /** @type {Record<string, any>} */
    const opts = Object.assign({}, s.options || {}, { app_id: s.appId, prompt: promptText() });
    if (s.systemPrompt) opts.systemPrompt = s.systemPrompt;
    if (s.schema) opts.schema = s.schema;
    state.busy = true;
    state.answer = null;
    paint();
    drawAnswer(parts.answer);
    // A library that throws before it returns a promise is a failed call like any other.
    const call = new Promise(function (ok) { ok(s.schema ? lib.completeJson(opts) : lib.complete(opts)); });
    inFlight = call.then(function (got) {
      // The time it was made rides on the result, so the record the app keeps can say it later.
      // A copy: the library's own object stays as the library made it.
      const r = got && typeof got === 'object' ? Object.assign({}, got, { at: got.at || new Date().toISOString() }) : got;
      state.answer = r;
      return r;
    }, function (e) {
      // A cancelled spend confirm is the person's own no: nothing to say.
      if (!(e && e.code === 'SPEND_CANCELLED')) state.error = errorOf(e);
      return null;
    }).then(function (r) {
      state.busy = false;
      inFlight = null;
      if (dead) return r;
      paint();
      drawAnswer(parts.answer);
      if (state.error && parts.failure) attention(parts.failure, 'shake');
      if (r && typeof s.onResult === 'function') s.onResult(r);
      return r;
    });
    return inFlight;
  }

  // A sign-in or a sign-out reads the route again, with the library's caches dropped (a signed-out
  // isAvailable() is cached as false for a minute); a language change only draws again.
  const stopWatch = watch(function () {
    const now = !signedOut();
    if (now !== state.session) {
      state.session = now;
      state.answer = null;
      state.stored = false;
      state.error = null;
      const lib = aiOf();
      if (lib && typeof lib.invalidateCache === 'function') lib.invalidateCache();
      refresh();
      return;
    }
    build();
  }, root);

  const ready = refresh().then(function () { enter(root); });

  return {
    el: root,
    /** Run once, with `text` put in the box first when it is given. */
    run: function (text) {
      if (typeof text === 'string') {
        state.text = text;
        if (parts.box) parts.box.value = text;
        paint();
      }
      return ready.then(go);
    },
    /**
     * Draw a result the app kept, as a fresh answer is drawn (its AI label, model and date), with
     * no AI call and no onResult. null takes the answer away. A call in flight wins when it lands.
     */
    show: function (result) {
      state.answer = result || null;
      state.stored = !!result;
      state.error = null;
      if (dead) return;
      paint();
      drawAnswer(parts.answer);
    },
    /**
     * Change any part of the spec; a new appId or sample flag reads the route again, and
     * `result` is drawn as show() draws it.
     */
    set: function (patch) {
      if (!patch) return;
      const reprobe = ('appId' in patch && patch.appId !== s.appId) || ('sample' in patch && patch.sample !== s.sample);
      Object.assign(s, patch);
      if ('variant' in patch) { root.removeAttribute('data-ak-variant'); applyVariant(root, s, ['compact']); }
      if (reprobe) { state.answer = null; state.stored = false; state.error = null; }
      if ('result' in patch) { state.answer = patch.result || null; state.stored = !!patch.result; state.error = null; }
      if (reprobe) refresh(); else build();
    },
    destroy: function () {
      dead = true;
      gen += 1;
      stopWatch();
      if (panel) { panel.destroy(); panel = null; }
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
