/**
 * @file atelier/ai-chat.js
 * @description aiChat: a follow-up conversation with the person's own AI about one document. An
 *   analysis answers the questions it was told to ask; the reader's next question ("what exactly
 *   must the CV contain") is answerable only against the document itself. nuotta wrote this screen
 *   by hand (askAboutTender, chatCard), and spiral, the-firm and cadence each have an analysis that
 *   wants the same follow-up. This block is that screen, over AIMEAT.ai.
 *
 *   THE STATES are aiTask's (ai-task.js), decided by the same probe and said in the same words:
 *     sample      `sample: true`, or an appId that is missing or still a fill's <placeholder>: a
 *                 marked sample exchange; a question gets a sample answer and nothing is sent
 *     no library  AIMEAT.ai is not on the page: one sentence that names aimeat-ai.js, and no box
 *     signed out  a Sign in button through AIMEAT.auth.signIn() when the page has it
 *     unavailable the library's own `fix` sentence, and no box
 *     ready       the conversation so far, the box and Ask; with no document (`context` empty)
 *                 Ask is off and the line under the box says so
 *     busy        Ask is held busy and a status line says the AI is working; the question is in
 *                 the conversation already
 *     answered    each answer as markdown through AIMEAT.md, under the visible AI label from its
 *                 own provenance record (AIMEAT.ai.disclose), with the model, the date and time,
 *                 and a note when it was cut at the length limit; above the conversation the
 *                 standing "you are talking to an AI" notice (AIMEAT.ai.chatNotice)
 *     error       aiTask's words per code; the question goes back into the box, so a retry is one
 *                 press; SPEND_CANCELLED says nothing
 *
 *   THE CALL. Each question is one AIMEAT.ai.complete(): the document, the last `keep` messages of
 *   the conversation and the question, with a system prompt that keeps the answer to the document
 *   (the app's `systemPrompt` replaces it). The document is read at the moment of asking, so
 *   `context` may be a function.
 *
 *   THE HISTORY IS THE APP'S. The block keeps the conversation in memory for the page's life and
 *   hands a copy to onTurn(history) after every answer and after Start over; `history` in the spec
 *   (or set({ history })) draws a kept one again, labels included, because each answer turn keeps
 *   its provenance. Nothing here fetches or writes memory.
 * @parts aiChat root · title · sample · hint · notice · signIn · chatNotice · log · empty · turn · who · question · aiLabel · body · meta · model · made · truncated · failure · form · field · label · input · bar · send · clear · reason · status
 * @variants aiChat compact
 * @tokens aiChat --ak-ai-width
 * @fork aiChat Copying it out means building the grounded prompt from the document and the turns yourself, calling AIMEAT.ai.complete(), chatNotice() and disclose() per answer, AIMEAT.md.render(), writing the no-AI, signed-out and error words in three languages, and holding Ask busy.
 * @structure DEFAULT_SYSTEM · chatPrompt(context, turns, question) · aiChat(spec)
 * @usage
 *   const chat = AIMEAT.atelier.aiChat({ target: '#ask', appId: 'my-app',
 *     context: () => analysis.sourceText, history: analysis.chat || [],
 *     onTurn: (h) => AIMEAT.data.set('my-app.analyses.' + analysis.id, { ...analysis, chat: h }) });
 *   chat.ask('What must the CV contain?');
 * @version-history
 *   v0.63.0 — 2026-10-02 — Initial.
 */
import { el, clear, resolve, uid, enter, attention } from './dom.js';
import { tai } from './ai-task-i18n.js';
import { watch } from './members-shared.js';
import { applyVariant } from './parts-model.js';
import { aiOf, signedOut, unset, errorWords, probeAi, aiNotice, aiLabelInto, drawText, madeWhen, sampleMark } from './ai-task.js';

/** The instructions sent with every question unless the app gives its own `systemPrompt`. */
const DEFAULT_SYSTEM = 'You answer follow-up questions about one document. Answer from the document '
  + 'and the conversation given with each question. When the document does not settle a question, '
  + 'say so plainly and name what is missing. Quote the document\'s own wording when it decides the '
  + 'answer. Answer in the language of the question, in a few sentences.';

/**
 * One turn of the conversation, as onTurn hands it out and `history` takes it back.
 * @typedef {object} AiChatTurn
 * @property {'user'|'assistant'} role
 * @property {string} content
 * @property {string} [model]
 * @property {any} [provenance]  the node's provenance record of an answer
 * @property {string} [at]  an ISO time
 * @property {boolean} [truncated]
 */

/**
 * @typedef {object} AiChatSpec
 * @property {string|Element} [target]
 * @property {string} appId  the app_id the calls are made under
 * @property {string} [title]
 * @property {string} [hint]  one line under the title
 * @property {string|(() => string)} context  the document the conversation is about
 * @property {string} [systemPrompt]  replaces the block's own instructions to the model
 * @property {string} [placeholder]
 * @property {AiChatTurn[]} [history]  a kept conversation to draw and continue
 * @property {(history: AiChatTurn[]) => void} [onTurn]  a copy of the conversation after each
 *   answer, and [] after Start over
 * @property {number} [keep]  how many earlier messages go with each question (default 8)
 * @property {Record<string, any>} [options]  more fields for the call: model, temperature,
 *   max_tokens, confirm, role
 * @property {boolean} [sample]
 * @property {'compact'} [variant]
 */

/**
 * The prompt of one question: the document, the conversation so far and the question.
 * @param {string} context
 * @param {AiChatTurn[]} turns  the earlier messages to send
 * @param {string} question
 * @returns {string}
 */
function chatPrompt(context, turns, question) {
  const lines = ['THE DOCUMENT', context, ''];
  if (turns.length) {
    lines.push('THE CONVERSATION SO FAR');
    for (const m of turns) lines.push((m.role === 'user' ? 'Question: ' : 'Answer: ') + m.content, '');
  }
  lines.push('THE QUESTION', question);
  return lines.join('\n');
}

/**
 * A kept conversation, with anything that is not a turn left out.
 * @param {any} list
 * @returns {AiChatTurn[]}
 */
function turnsOf(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function (m) {
    return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
  }).map(function (m) { return Object.assign({}, m); });
}

/**
 * A follow-up conversation with the AI about one document.
 * @param {AiChatSpec} spec
 * @returns {{ el: HTMLElement, ask: (text: string) => Promise<AiChatTurn|null>,
 *   set: (patch: Partial<AiChatSpec>) => void, destroy: () => void }}
 */
export function aiChat(spec) {
  /** @type {AiChatSpec} */
  const s = Object.assign({}, spec);
  const root = el('section', { class: 'ak-root ak-aichat', 'data-ak-part': 'root' });
  applyVariant(root, s, ['compact']);
  if (s.target) resolve(s.target).appendChild(root);

  /**
   * What the block knows between draws. `avail` is aiTask's route. `history` is the real
   * conversation; turns asked in the sample are marked `sample` and never reach onTurn.
   */
  const state = {
    avail: 'checking',
    fix: '',
    text: '',
    busy: false,
    /** Ask was pressed on an empty box; the line under it says why nothing happened. */
    nudged: false,
    /** @type {any} */
    error: null,
    /** @type {Array<AiChatTurn & { sample?: boolean }>} */
    history: turnsOf(s.history),
    session: !signedOut(),
  };
  let gen = 0;
  let dead = false;
  /** @type {Promise<any>|null} */
  let inFlight = null;
  /** @type {Record<string, any>} */
  let parts = {};

  const isSample = function () { return s.sample === true || unset(s.appId); };
  const canAsk = function () { return state.avail === 'on' || state.avail === 'sample'; };
  const real = function () { return state.history.filter(function (m) { return !m.sample; }); };
  const keep = function () { return typeof s.keep === 'number' && s.keep >= 0 ? Math.floor(s.keep) : 8; };

  /** The document as it is now; a function that throws is no document. */
  function contextText() {
    try {
      const v = typeof s.context === 'function' ? s.context() : s.context;
      return v == null ? '' : String(v).trim();
    } catch (e) {
      console.debug('aimeat-atelier: aiChat context not read', e);
      return '';
    }
  }

  async function refresh() {
    const mine = ++gen;
    state.avail = 'checking';
    build();
    const r = await probeAi(s.appId, isSample());
    if (mine !== gen || dead) return;
    state.avail = r.avail;
    state.fix = r.fix;
    build();
  }

  /**
   * What the log shows: the conversation, or in the sample with none a sample exchange.
   * @returns {Array<AiChatTurn & { sample?: boolean }>}
   */
  function shown() {
    if (state.avail === 'sample' && state.history.length === 0) {
      return [
        { role: 'user', content: tai('aiChat.sampleQuestion') },
        { role: 'assistant', content: '', model: 'sample-model', sample: true },
      ];
    }
    return state.history;
  }

  /** The whole block from `state`. */
  function build() {
    clear(root);
    parts = {};
    root.appendChild(el('h3', { class: 'ak-aichat__title', 'data-ak-part': 'title' },
      [s.title || tai('aiChat.title'), state.avail === 'sample' ? sampleMark() : null].filter(Boolean)));
    if (s.hint) root.appendChild(el('p', { class: 'ak-aichat__hint', 'data-ak-part': 'hint' }, s.hint));
    for (const n of aiNotice('aichat', state, false)) root.appendChild(n);
    const lib = aiOf();
    if (state.avail === 'on' && lib && typeof lib.chatNotice === 'function') {
      // The standing notice that a model is on the other end, owed when the conversation opens.
      const host = el('div', { class: 'ak-aichat__chatnotice', 'data-ak-part': 'chatNotice' });
      root.appendChild(host);
      try { lib.chatNotice({ target: host }); } catch (e) { console.debug('aimeat-atelier: chat notice not drawn', e); }
    }
    const live = canAsk() || state.avail === 'checking';
    parts.log = el('div', { class: 'ak-aichat__log', 'data-ak-part': 'log', role: 'log', 'aria-live': 'polite', 'aria-label': tai('aiChat.log') });
    root.appendChild(parts.log);
    drawLog(live);
    parts.failure = el('p', { class: 'ak-aichat__failure', role: 'alert', 'data-ak-part': 'failure', hidden: true });
    root.appendChild(parts.failure);
    if (live) form();
    paint();
  }

  /**
   * Every turn again, or the empty line when there is none and the box is here.
   * @param {boolean} live
   */
  function drawLog(live) {
    const log = parts.log;
    if (!log) return;
    clear(log);
    const list = shown();
    if (!list.length) {
      if (live) log.appendChild(el('p', { class: 'ak-aichat__empty', 'data-ak-part': 'empty' }, tai('aiChat.empty')));
      log.hidden = !live;
      return;
    }
    log.hidden = false;
    for (const m of list) log.appendChild(drawTurn(m));
  }

  /**
   * One turn: the question as written, or the answer under its AI label with the model and date.
   * @param {AiChatTurn & { sample?: boolean }} m
   * @returns {HTMLElement}
   */
  function drawTurn(m) {
    const mine = m.role === 'user';
    const node = el('div', {
      class: 'ak-aichat__turn ak-aichat__turn--' + (mine ? 'user' : 'ai'), 'data-ak-part': 'turn', 'data-ak-role': m.role,
    }, [el('span', { class: 'ak-aichat__who', 'data-ak-part': 'who' }, mine ? tai('aiChat.you') : tai('aiChat.ai'))]);
    if (mine) {
      node.appendChild(el('p', { class: 'ak-aichat__question', 'data-ak-part': 'question' }, m.content));
      return node;
    }
    const label = el('div', { class: 'ak-aichat__label', 'data-ak-part': 'aiLabel' });
    node.appendChild(label);
    aiLabelInto(label, m.provenance);
    const body = el('div', { class: 'ak-aichat__body', 'data-ak-part': 'body' });
    node.appendChild(body);
    // A sample answer is drawn in the current language, so a language change redraws it too.
    drawText(m.sample ? tai('aiChat.sampleAnswer') : m.content, body, 'markdown', 'ak-aichat__text');
    const meta = [];
    if (m.model) meta.push(el('span', { class: 'ak-aichat__model', 'data-ak-part': 'model' }, tai('aiTask.model', { model: m.model })));
    const when = m.sample ? '' : madeWhen(m.at);
    if (when) meta.push(el('time', { class: 'ak-aichat__made', 'data-ak-part': 'made', datetime: new Date(/** @type {string} */ (m.at)).toISOString() }, tai('aiTask.made', { when: when })));
    if (meta.length) node.appendChild(el('p', { class: 'ak-aichat__meta', 'data-ak-part': 'meta' }, meta));
    if (m.truncated) node.appendChild(el('p', { class: 'ak-aichat__truncated', 'data-ak-part': 'truncated' }, tai('aiTask.truncated')));
    return node;
  }

  /**
   * A new turn at the end of the log, without drawing the others again.
   * @param {AiChatTurn & { sample?: boolean }} m
   * @param {boolean} [fresh]  an answer that just landed rises once
   */
  function addTurn(m, fresh) {
    const log = parts.log;
    if (!log) return;
    const empty = log.querySelector('[data-ak-part="empty"]');
    // The sample exchange stands in for an empty conversation; the first real turn replaces it.
    if (empty || (state.avail === 'sample' && state.history.length === 1)) clear(log);
    log.hidden = false;
    const node = drawTurn(m);
    log.appendChild(node);
    if (fresh) attention(node, 'rise');
  }

  /** The box, the line under it, Ask, Start over and the busy line. */
  function form() {
    const id = uid('ak-aichat');
    const reasonId = id + '-why';
    const box = /** @type {HTMLInputElement} */ (el('input', {
      id: id, class: 'ak-input', 'data-ak-part': 'input', type: 'text', autocomplete: 'off',
      placeholder: s.placeholder || tai('aiChat.placeholder'), 'aria-describedby': reasonId,
    }));
    box.value = state.text;
    box.addEventListener('input', function () { state.text = box.value; state.nudged = false; paint(); });
    box.addEventListener('keydown', function (/** @type {KeyboardEvent} */ e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      press();
    });
    parts.box = box;
    const send = el('button', {
      type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'send', 'data-ak-noguard': true,
      'aria-describedby': reasonId,
    }, tai('aiChat.send'));
    send.addEventListener('click', press);
    parts.send = send;
    const again = el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-part': 'clear', 'data-ak-noguard': true }, tai('aiChat.clear'));
    again.addEventListener('click', startOver);
    parts.clear = again;
    parts.reason = el('p', { class: 'ak-aichat__reason', 'data-ak-part': 'reason', id: reasonId, hidden: true });
    parts.status = el('p', { class: 'ak-aichat__status', role: 'status', 'data-ak-part': 'status' });
    root.appendChild(el('div', { class: 'ak-aichat__form', 'data-ak-part': 'form' }, [
      el('div', { class: 'ak-form__field ak-aichat__field', 'data-ak-part': 'field' }, [
        el('label', { class: 'ak-form__label', 'data-ak-part': 'label', for: id }, tai('aiChat.inputLabel')),
        box,
      ]),
      el('div', { class: 'ak-aichat__bar', 'data-ak-part': 'bar' }, [send, again]),
    ]));
    root.appendChild(parts.reason);
    root.appendChild(parts.status);
  }

  /** Ask from the box; an empty box says why nothing happened and keeps the focus there. */
  function press() {
    if (!state.text.trim()) {
      state.nudged = true;
      paint();
      if (parts.box) parts.box.focus();
      return;
    }
    send(state.text);
  }

  /** Why Ask cannot send now, or ''. */
  function reason() {
    if (state.avail === 'checking') return tai('aiTask.checking');
    if (state.avail === 'on' && !contextText()) return tai('aiChat.noContext');
    if (state.nudged && !state.text.trim()) return tai('aiChat.needText');
    return '';
  }

  /** The parts that change as the person types or a call runs. Not the log. */
  function paint() {
    const why = reason();
    if (parts.reason) {
      parts.reason.textContent = why;
      parts.reason.hidden = !why;
    }
    const send = /** @type {HTMLButtonElement|undefined} */ (parts.send);
    if (send) {
      // The busy mark is drawn from state, so a redraw in the middle of a call keeps it.
      send.disabled = state.busy || !canAsk() || (state.avail === 'on' && !contextText());
      send.classList.toggle('ak-busy', state.busy);
      if (state.busy) send.setAttribute('aria-busy', 'true'); else send.removeAttribute('aria-busy');
    }
    if (parts.clear) {
      parts.clear.hidden = state.history.length === 0;
      parts.clear.disabled = state.busy;
    }
    if (parts.status) {
      // The live region stays in the page; idle, it is empty and read by nobody.
      parts.status.textContent = state.busy ? tai('aiTask.running') : '';
      parts.status.classList.toggle('ak-sr-only', !state.busy);
    }
    if (parts.failure) {
      parts.failure.textContent = state.error ? errorWords(state.error) : '';
      parts.failure.hidden = !state.error;
    }
  }

  /** The conversation without the sample turns, as copies, for onTurn. */
  function handOut() {
    if (typeof s.onTurn !== 'function') return;
    s.onTurn(real().map(function (m) { return Object.assign({}, m); }));
  }

  function startOver() {
    if (state.busy) return;
    const had = real().length > 0;
    state.history = [];
    state.error = null;
    drawLog(true);
    paint();
    if (had) handOut();
    if (parts.box) parts.box.focus();
  }

  /**
   * One question. Resolves to the answer turn, or null when nothing was asked or the call failed.
   * @param {string} text
   * @returns {Promise<AiChatTurn|null>}
   */
  function send(text) {
    if (inFlight) return inFlight;
    const q = String(text == null ? '' : text).trim();
    if (!q || !canAsk()) return Promise.resolve(null);
    const sample = state.avail === 'sample';
    const ctx = contextText();
    if (!sample && !ctx) return Promise.resolve(null);
    const lib = aiOf();
    if (!sample && !lib) return Promise.resolve(null);
    state.error = null;
    state.nudged = false;
    const before = keep() === 0 ? [] : real().slice(-keep());
    /** @type {AiChatTurn & { sample?: boolean }} */
    const asked = { role: 'user', content: q, at: new Date().toISOString() };
    if (sample) asked.sample = true;
    state.history.push(asked);
    addTurn(asked);
    state.text = '';
    if (parts.box) parts.box.value = '';
    if (sample) {
      /** @type {AiChatTurn & { sample?: boolean }} */
      const a = { role: 'assistant', content: '', model: 'sample-model', sample: true };
      state.history.push(a);
      addTurn(a, true);
      paint();
      return Promise.resolve(null);
    }
    /** @type {Record<string, any>} */
    const opts = Object.assign({}, s.options || {}, {
      app_id: s.appId, prompt: chatPrompt(ctx, before, q), systemPrompt: s.systemPrompt || DEFAULT_SYSTEM,
    });
    state.busy = true;
    paint();
    // A library that throws before it returns a promise is a failed call like any other.
    const call = new Promise(function (ok) { ok(lib.complete(opts)); });
    inFlight = call.then(function (r) {
      /** @type {AiChatTurn} */
      const turn = {
        role: 'assistant', content: String(r && r.content != null ? r.content : ''),
        model: r && r.model ? String(r.model) : undefined, provenance: (r && r.provenance) || null,
        at: new Date().toISOString(),
      };
      if (r && r.truncated) turn.truncated = true;
      state.history.push(turn);
      return turn;
    }, function (e) {
      // The question leaves the conversation and goes back into the box, so a retry is one press.
      const i = state.history.lastIndexOf(asked);
      if (i >= 0) state.history.splice(i, 1);
      if (!state.text) state.text = q;
      // A cancelled spend confirm is the person's own no: nothing to say.
      if (!(e && e.code === 'SPEND_CANCELLED')) state.error = { code: e && e.code, message: e && e.message ? e.message : String(e || '') };
      return null;
    }).then(function (turn) {
      state.busy = false;
      inFlight = null;
      if (dead) return turn;
      if (turn) {
        addTurn(turn, true);
        handOut();
      } else {
        drawLog(true);
        if (parts.box) parts.box.value = state.text;
      }
      paint();
      if (state.error && parts.failure) attention(parts.failure, 'shake');
      return turn;
    });
    return inFlight;
  }

  // A sign-in or a sign-out reads the route again, with the library's caches dropped; a language
  // change only draws again. The conversation is the app's and stays.
  const stopWatch = watch(function () {
    const now = !signedOut();
    if (now !== state.session) {
      state.session = now;
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
    /** Ask one question, as if the person had written it and pressed Ask. */
    ask: function (text) {
      return ready.then(function () { return dead ? null : send(text); });
    },
    /**
     * Change any part of the spec. A new appId or sample flag reads the route again; `history`
     * replaces the conversation; `context` is read at the next question.
     */
    set: function (patch) {
      if (!patch) return;
      const reprobe = ('appId' in patch && patch.appId !== s.appId) || ('sample' in patch && patch.sample !== s.sample);
      Object.assign(s, patch);
      if ('variant' in patch) { root.removeAttribute('data-ak-variant'); applyVariant(root, s, ['compact']); }
      if ('history' in patch) state.history = turnsOf(patch.history);
      else if (reprobe) state.history = real();
      state.error = null;
      if (reprobe) refresh(); else build();
    },
    destroy: function () {
      dead = true;
      gen += 1;
      stopWatch();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
