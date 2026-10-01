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
 *                 that does not answer capabilities): the library's own `fix` sentence
 *     ready       the box and the run button; an empty box, or one under `minChars`, keeps the
 *                 button off and says why under it
 *     busy        the button is held busy and a status line says the AI is working
 *     answered    the answer (markdown through AIMEAT.md when it is loaded, else text), the visible
 *                 AI label through AIMEAT.ai.disclose(), the model, a cost line from r.budget, and
 *                 a note when the answer was cut at the length limit
 *     error       words for each code the library throws; SPEND_CANCELLED says nothing
 *
 *   WHAT FETCHES. Nothing here fetches: every call goes through AIMEAT.ai, which spends the signed-in
 *   person's own budget on their own provider. The block redraws on a sign-in, a sign-out and a
 *   language change (members-shared watch()).
 *
 *   THE SECOND ROUTE. With `copyPrompt: true` the kit's promptPanel sits under the block: copy the
 *   prompt into any AI chat and paste the answer back, for a person whose AI is not connected here.
 *   A pasted answer is drawn like a model answer, says where it came from, and reaches onResult with
 *   `pasted: true` and no provenance record.
 * @parts aiTask root · title · hint · notice · signIn · label · input · reason · bar · run · status · failure · result · aiLabel · body · meta · model · cost · truncated · copyRoute
 * @variants aiTask compact
 * @tokens aiTask --ak-ai-width
 * @fork aiTask Copying it out means calling AIMEAT.ai.capabilities(), complete() or completeJson(), disclose() and AIMEAT.md.render() yourself, writing the no-AI, signed-out and error words in three languages, and holding the button busy.
 * @structure aiTask(spec) (helpers: aiOf · authOf · signedOut · unset · money · errorWords)
 * @usage
 *   AIMEAT.atelier.aiTask({ target: '#ask', appId: 'my-app', title: 'Read my situation',
 *     input: { placeholder: 'Describe it in your own words', minChars: 10 },
 *     prompt: (text) => 'Analyse this situation:\n' + text, copyPrompt: true,
 *     onResult: (r) => save(r.content, r.provenance) });
 * @version-history
 *   v0.62.1 — 2026-10-01 — The cost line's amounts go through _core/format.js money() in the
 *     currency the budget names (default USD), not a hand-made "$0.00", so a Finnish reader sees
 *     their own number format.
 *   v0.62.0 — 2026-10-01 — Initial.
 */
import { el, clear, resolve, uid, enter, attention } from './dom.js';
import { money as fmtMoney } from '../_core/format.js';
import { t } from './i18n.js';
import { tai } from './ai-task-i18n.js';
import { isPlaceholder, sampleBadge, watch } from './members-shared.js';
import { promptPanel } from './workbench-parts.js';
import { applyVariant } from './parts-model.js';

/** The page's AIMEAT.ai, or null. */
function aiOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.ai ? ns.ai : null;
}

/** The page's AIMEAT.auth, or null. */
function authOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.auth ? ns.auth : null;
}

/** True when the page knows for certain that nobody is signed in. */
function signedOut() {
  const auth = authOf();
  return !!(auth && typeof auth.getSession === 'function' && !auth.getSession());
}

/** Whether a prop is missing or still a fill's placeholder. */
function unset(v) {
  return !v || isPlaceholder(v);
}

/**
 * An amount on the budget line, through the SDK's one money formatter (_core/format.js): the
 * reader's own number format, four decimals under a cent and two above. The currency is the one
 * the budget answer names, else US dollars, which is what the node's `..._usd` fields hold.
 * @param {number} v
 * @param {string} [currency]  a three-letter code
 * @returns {string}
 */
function money(v, currency) {
  if (typeof v !== 'number' || !isFinite(v)) return '';
  const code = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'USD';
  return fmtMoney(v, code);
}

/** The codes that have their own sentence; JSON_PARSE_FAILED shares the shape mismatch's. */
const CODES = ['NO_API_KEY', 'INVALID_API_KEY', 'QUOTA_EXHAUSTED', 'APP_QUOTA_EXHAUSTED', 'RATE_LIMITED', 'JSON_SCHEMA_MISMATCH'];

/**
 * The words for a failed call, in the current language.
 * @param {{ code?: string, message?: string }} e
 */
function errorWords(e) {
  const code = e && e.code === 'JSON_PARSE_FAILED' ? 'JSON_SCHEMA_MISMATCH' : (e && e.code);
  if (code && CODES.indexOf(code) >= 0) return tai('aiTask.err.' + code);
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
 * @property {'markdown'|'text'|((result: any, host: HTMLElement) => void)} [render]  'markdown' by default
 * @property {string} [runLabel]
 * @property {boolean} [copyPrompt]  add the copy-the-prompt, paste-the-answer route under the block
 * @property {boolean} [sample]
 * @property {Record<string, any>} [options]  more fields for the call: model, temperature,
 *   max_tokens, confirm, role
 * @property {'compact'} [variant]
 * @property {(result: any) => void} [onResult]  the result, with `provenance` (or `pasted: true`)
 */

/**
 * Ask the AI once and show the answer.
 * @param {AiTaskSpec} spec
 * @returns {{ el: HTMLElement, run: (text?: string) => Promise<any>,
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
   * off or on. `answer` is what is shown: a model's result, a pasted one, or the sample.
   */
  const state = {
    avail: 'checking',
    fix: '',
    text: '',
    busy: false,
    /** @type {any} */
    answer: null,
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

  /** Which route this page has. Spends nothing: capabilities() plans the call without making it. */
  async function probe() {
    if (isSample()) return { avail: 'sample', fix: '' };
    const lib = aiOf();
    if (!lib) return { avail: 'nolib', fix: '' };
    if (signedOut()) return { avail: 'signedout', fix: '' };
    if (typeof lib.capabilities === 'function') {
      try {
        const caps = await lib.capabilities({ app_id: s.appId });
        const text = caps && caps.capabilities && caps.capabilities.text;
        if (text && text.on === false) return { avail: 'off', fix: String(text.fix || text.message || text.reason || '') };
        if (text && text.on === true) return { avail: 'on', fix: '' };
      } catch (e) {
        // A node without GET /v1/ai/capabilities: isAvailable() below answers instead.
        console.debug('aimeat-atelier: aiTask capabilities not read', e);
      }
    }
    if (typeof lib.isAvailable === 'function') {
      const ok = await Promise.resolve(lib.isAvailable()).catch(function () { return false; });
      return ok ? { avail: 'on', fix: '' } : { avail: 'off', fix: '' };
    }
    return { avail: 'on', fix: '' };
  }

  async function refresh() {
    const mine = ++gen;
    state.avail = 'checking';
    build();
    const r = await probe();
    if (mine !== gen || dead) return;
    state.avail = r.avail;
    state.fix = r.fix;
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
    // The sample answer is drawn in the current language, so a language change redraws it too.
    if (state.avail === 'sample') state.answer = sampleAnswer();
    root.appendChild(el('h3', { class: 'ak-aitask__title', 'data-ak-part': 'title' },
      [s.title || tai('aiTask.title'), state.avail === 'sample' ? sampleBadge() : null].filter(Boolean)));
    if (s.hint) root.appendChild(el('p', { class: 'ak-aitask__hint', 'data-ak-part': 'hint' }, s.hint));
    notice();
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

  /** The line that says why the AI route is not here, and what to do. */
  function notice() {
    let words = '';
    if (state.avail === 'sample') words = tai('aiTask.sampleNote');
    else if (state.avail === 'nolib') words = s.copyPrompt ? tai('aiTask.noLibCopy') : tai('aiTask.noLib');
    else if (state.avail === 'signedout') words = tai('aiTask.signIn');
    else if (state.avail === 'off') words = state.fix || tai('aiTask.off');
    if (!words) return;
    const line = el('p', { class: 'ak-aitask__notice', 'data-ak-part': 'notice' }, words);
    root.appendChild(line);
    const auth = authOf();
    if (state.avail === 'signedout' && auth && typeof auth.signIn === 'function') {
      const b = el('button', { type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'signIn', 'data-ak-noguard': true }, tai('aiTask.signInBtn'));
      b.addEventListener('click', function () {
        // The click is the user gesture that opens the sign-in window; the login event redraws.
        Promise.resolve(auth.signIn()).catch(function (e) { console.debug('aimeat-atelier: sign-in closed', e); });
      });
      root.appendChild(el('div', { class: 'ak-aitask__bar' }, [b]));
    }
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
      root.appendChild(el('div', { class: 'ak-form__field ak-aitask__field' }, [
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
      el('h4', { class: 'ak-aitask__copy-title' }, tai('aiTask.copyTitle')),
    ]);
    root.appendChild(host);
    panel = promptPanel({
      target: host,
      prompt: promptText,
      expect: s.schema ? 'json' : 'text',
      onResult: function (value, raw) {
        /** @type {any} */
        const r = { content: raw, pasted: true, provenance: null };
        if (s.schema) r.parsed = value;
        state.answer = r;
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
    if (parts.failure) {
      parts.failure.textContent = state.error ? errorWords(state.error) : '';
      parts.failure.hidden = !state.error;
    }
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
    const lib = aiOf();
    if (r.provenance && lib && typeof lib.disclose === 'function') {
      try { lib.disclose(r.provenance, { target: label }); } catch (e) { console.debug('aimeat-atelier: AI label not drawn', e); }
    }
    const body = el('div', { class: 'ak-aitask__body', 'data-ak-part': 'body' });
    host.appendChild(body);
    drawBody(r, body);
    const meta = [];
    if (r.pasted) meta.push(el('span', { class: 'ak-aitask__model', 'data-ak-part': 'model' }, tai('aiTask.pasted')));
    if (r.model) meta.push(el('span', { class: 'ak-aitask__model', 'data-ak-part': 'model' }, tai('aiTask.model', { model: r.model })));
    const b = r.budget;
    if (b && typeof b.spent_today_usd === 'number') {
      const cap = typeof b.daily_budget_usd === 'number' && b.daily_budget_usd > 0;
      meta.push(el('span', { class: 'ak-aitask__cost', 'data-ak-part': 'cost' }, cap
        ? tai('aiTask.cost', { spent: money(b.spent_today_usd, b.currency), budget: money(b.daily_budget_usd, b.currency) })
        : tai('aiTask.costNoCap', { spent: money(b.spent_today_usd, b.currency) })));
    }
    if (meta.length) host.appendChild(el('p', { class: 'ak-aitask__meta', 'data-ak-part': 'meta' }, meta));
    if (r.truncated) host.appendChild(el('p', { class: 'ak-aitask__truncated', 'data-ak-part': 'truncated' }, tai('aiTask.truncated')));
  }

  /** The answer itself: the app's own render, markdown, or text. */
  function drawBody(r, body) {
    if (typeof s.render === 'function') {
      try { s.render(r, body); } catch (e) { body.textContent = String(r.content || ''); console.debug('aimeat-atelier: aiTask render failed', e); }
      return;
    }
    const text = s.schema && r.parsed !== undefined && !r.pasted
      ? JSON.stringify(r.parsed, null, 2)
      : String(r.content == null ? '' : r.content);
    if (s.schema) { body.appendChild(el('pre', { class: 'ak-aitask__json' }, text)); return; }
    const ns = /** @type {any} */ (window).AIMEAT;
    const md = ns && ns.md;
    if (s.render !== 'text' && md && typeof md.render === 'function') {
      try { md.render(text, body); return; } catch (e) { console.debug('aimeat-atelier: markdown not drawn', e); }
    }
    body.appendChild(el('div', { class: 'ak-aitask__text' }, text));
  }

  /** One run from the button or from run(). Resolves to the result, or null when nothing ran. */
  function go() {
    if (inFlight) return inFlight;
    if (!canAsk() || reason()) return Promise.resolve(null);
    state.error = null;
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
    inFlight = call.then(function (r) {
      state.answer = r;
      return r;
    }, function (e) {
      // A cancelled spend confirm is the person's own no: nothing to say.
      if (!(e && e.code === 'SPEND_CANCELLED')) state.error = { code: e && e.code, message: e && e.message ? e.message : String(e || '') };
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
    /** Change any part of the spec; a new appId or sample flag reads the route again. */
    set: function (patch) {
      if (!patch) return;
      const reprobe = ('appId' in patch && patch.appId !== s.appId) || ('sample' in patch && patch.sample !== s.sample);
      Object.assign(s, patch);
      if ('variant' in patch) { root.removeAttribute('data-ak-variant'); applyVariant(root, s, ['compact']); }
      if (reprobe) { state.answer = null; state.error = null; refresh(); } else build();
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
