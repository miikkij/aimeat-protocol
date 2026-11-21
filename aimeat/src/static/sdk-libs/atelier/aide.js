/**
 * @file atelier/aide.js
 * @description The in-app aide (TARGET-074 phase 6): a chat panel whose TOOLS ARE THE APP'S
 *   OWN DECLARATIONS. The app hands over its data sources and its actions; the aide can read
 *   what the screen reads and do what the buttons do — nothing else, by construction. "Mark the
 *   overdue ones done" becomes a declared action run through the same handler a button runs.
 *
 *   EVERY ACTION IS CONFIRMED. The model may PROPOSE an action; a person presses Run. A model
 *   answer may also be a PANEL — a small mosaic layout rendered inline with the app's own
 *   sources — which is the governed generative UI: arrangement from a closed vocabulary, never
 *   arbitrary markup.
 *
 *   TRANSPARENCY IS BUILT IN: the panel carries the platform's AI notice, and every model message
 *   wears the provenance label the ai library mints. The model runs on the OWNER'S key through
 *   AIMEAT.ai — no key here, no model call until the person sends, and the first send confirms
 *   the spend.
 *
 *   IT SHOWS WHERE. The model is told the places on the screen (every element carrying
 *   `data-ak-help`, and the places the app's tour names). When the person asks how or where, the
 *   answer may carry `show`: those places are lit one after another with the tour's spotlight
 *   (tour.js), and "Show me again" lights them again. When the model proposes an action whose
 *   declaration names its control (`target`), that control is lit with the proposal and a Run on
 *   it, so the person sees on the screen what the aide would do for them before anything runs.
 * @structure aide(spec) → { el, open, destroy }
 * @usage
 *   AIMEAT.atelier.aide({ target: a.main, appName: 'Errands', tour: a.tour,
 *     sources: { 'errands.items': loadItems },
 *     actions: [{ id: 'complete', summary: 'Mark one errand done', params: { id: 'string' },
 *                 target: 'complete', run: (p) => completeErrand(p.id) }] });
 * @version-history
 *   v0.4.0 — 2026-11-22 — The aide shows where: the answer's `show` lights places on the screen,
 *     and a proposed action lights its control (`target`) with the proposal and Run on it; one
 *     press, in either place, decides (wish-opastettu-kierros-sovelluksiin-monikielinen-tutorial-ja-oma-).
 *   v0.3.0 — 2026-08-28 — What the first PAID run on production found, fixed: (1) completeJson
 *     answers { data: { content, parsed, provenance } } and the validated object is `parsed` —
 *     the aide read `data` itself and reported failure over a good answer; (2) the model was
 *     never told the panel block's exact grammar, so its first panel had no `component` and
 *     rendered empty — the prompt now spells out the block shape, the six legal components and
 *     that only declared source names may be bound. With both: reply, action proposal → human
 *     confirm → app handler, and a generated panel over real sources, all proven live.
 *   v0.2.0 — 2026-08-28 — Renamed copilot → aide before any app uses it: "copilot" collides with
 *     a large product family and the collision would only get more expensive. Same component,
 *     same contract, new name everywhere (function, block id, classes, i18n keys).
 *   v0.1.0 — 2026-08-28 — Initial as copilot.js (TARGET-074 phase 6, slice 1).
 */
import { el, clear, resolve, enter } from './dom.js';
import { t } from './i18n.js';
import { tour } from './tour.js';
import { wordsOf } from './handbook.js';

/** How much resolved source data rides in the prompt — per source and in total. */
const SOURCE_CHARS_MAX = 2000;
const CONTEXT_CHARS_MAX = 8000;
/** A generated panel stays a panel. */
const PANEL_BLOCKS_MAX = 8;
/** Turns of history the model sees. */
const HISTORY_TURNS = 12;
/** The places on screen the model is told about, and how many it may light in one answer. */
const PLACES_MAX = 40;
const PLACES_CHARS_MAX = 3000;
const SHOW_MAX = 5;

/** The structured answer the model is asked for — completeJson validates against this. */
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    action: {
      type: 'object',
      properties: { id: { type: 'string' }, params: { type: 'object' } },
      required: ['id'],
    },
    panel: { type: 'object' },
    show: { type: 'array', items: { type: 'string' }, maxItems: SHOW_MAX },
  },
  required: ['reply'],
};

/**
 * @param {{
 *   target?: string|Element,
 *   appName?: string, intro?: string, appId?: string,
 *   sources?: Record<string, () => any>,
 *   actions?: Array<{ id: string, summary: string, params?: Record<string, string>, run?: (params: any) => any,
 *     target?: string|Element }>,
 *   tour?: { point: Function, start: Function, places?: () => Array<{ id: string, title: string, text: string }> },
 * }} spec
 *   An action's `target` is the control that does the same thing (a help id, a selector or an
 *   element): when the aide proposes the action, that control is lit with the proposal on it.
 *   `tour` is the app's tour; without one the aide lights places with a tour of its own.
 * @returns {{ el: HTMLElement, open: () => void, destroy: () => void }}
 */
export function aide(spec) {
  const s = spec || {};
  const history = [];
  let firstSend = true;
  /** The tour that lights places: the app's own, or one made here on first use. */
  let ownPointer = null;
  function pointer() {
    if (s.tour && typeof s.tour.point === 'function') return s.tour;
    if (!ownPointer) ownPointer = tour({ block: false, invite: false });
    return ownPointer;
  }

  const log = el('div', { class: 'ak-aide__log', role: 'log', 'aria-live': 'polite' });
  const input = /** @type {HTMLTextAreaElement} */ (el('textarea', {
    class: 'ak-input ak-input--area ak-aide__input', rows: 2,
    placeholder: t('aidePlaceholder'), 'aria-label': t('aidePlaceholder'),
  }));
  const sendBtn = el('button', {
    type: 'button', class: 'ak-btn ak-btn--primary',
    on: { click: function () { send(); } },
  }, t('send'));
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
  });

  const notice = el('p', { class: 'ak-aide__notice' });
  const root = el('section', { class: 'ak-root ak-aide', 'aria-label': 'Aide' }, [
    el('header', { class: 'ak-aide__head' }, [
      el('h2', { class: 'ak-section__title', text: t('aideTitle') }),
      notice,
    ]),
    log,
    el('div', { class: 'ak-aide__row' }, [input, sendBtn]),
  ]);
  if (s.target) resolve(s.target).appendChild(root);
  enter(root);

  // The Art. 50 notice, in the platform's words, when the ai library is present.
  const aiNs = /** @type {any} */ (window).AIMEAT && /** @type {any} */ (window).AIMEAT.ai;
  if (aiNs && typeof aiNs.chatNotice === 'function') {
    try { aiNs.chatNotice({ target: notice }); } catch (err) {
      console.warn('aimeat-atelier: the AI notice did not render', err);
    }
  } else {
    notice.textContent = t('aideNotice');
  }
  if (s.intro) bubble('assistant', s.intro, null);

  function bubble(who, text, provenance) {
    const b = el('div', { class: 'ak-aide__msg ak-aide__msg--' + who }, [
      el('p', { class: 'ak-aide__text', text: text }),
    ]);
    if (who === 'assistant' && provenance && aiNs && typeof aiNs.disclose === 'function') {
      const tag = el('span', { class: 'ak-aide__label' });
      b.appendChild(tag);
      try { aiNs.disclose(provenance, { target: tag }); } catch (err) {
        console.warn('aimeat-atelier: the provenance label did not render', err);
      }
    }
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  async function contextText() {
    const parts = [];
    const names = Object.keys(s.sources || {});
    let budget = CONTEXT_CHARS_MAX;
    for (const name of names) {
      if (budget <= 0) break;
      let data;
      try { data = await Promise.resolve().then(s.sources[name]); } catch (err) {
        console.warn('aimeat-atelier: aide source "' + name + '" failed', err);
        continue;
      }
      const chunk = JSON.stringify(data).slice(0, Math.min(SOURCE_CHARS_MAX, budget));
      budget -= chunk.length;
      parts.push('SOURCE ' + name + ': ' + chunk);
    }
    return parts.join('\n');
  }

  function actionsText() {
    const list = s.actions || [];
    if (!list.length) return 'This app declares no actions: answer with words only.';
    return 'ACTIONS you may propose (a person confirms before anything runs):\n' + list.map(function (a) {
      const params = a.params ? ' params: ' + JSON.stringify(a.params) : '';
      return '- id "' + a.id + '": ' + a.summary + params;
    }).join('\n');
  }

  /**
   * The places on the screen the model may point at: every element carrying data-ak-help (its id,
   * title and text), then the places the app's tour names. Only what is on the page now.
   * @returns {Array<{ id: string, title: string, text: string }>}
   */
  function places() {
    const seen = new Set();
    const out = [];
    const add = function (p) {
      if (!p || !p.id || seen.has(p.id) || out.length >= PLACES_MAX) return;
      seen.add(p.id);
      out.push({ id: String(p.id), title: String(p.title || ''), text: String(p.text || '') });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-ak-help]'), function (n) {
      add({ id: n.getAttribute('data-ak-help'),
        title: wordsOf(n.getAttribute('data-ak-help-title') || n.getAttribute('aria-label') || n.textContent || ''),
        text: wordsOf(n.getAttribute('data-ak-help-text') || '') });
    });
    if (s.tour && typeof s.tour.places === 'function') {
      // The tour's list failing leaves the page's places; it is said in the console.
      try { s.tour.places().forEach(add); } catch (err) { console.warn('aimeat-atelier: the aide could not read the tour\'s places', err); }
    }
    return out;
  }

  function placesText(list) {
    if (!list.length) return 'This screen names no places: do not answer with "show".';
    let text = 'PLACES on the screen you may light with "show" (ids exactly as written):\n';
    for (const p of list) {
      const line = '- "' + p.id + '": ' + p.title + (p.text ? ' (' + p.text.replace(/\s+/g, ' ').slice(0, 160) + ')' : '') + '\n';
      if (text.length + line.length > PLACES_CHARS_MAX) break;
      text += line;
    }
    return text;
  }

  /** Light the places one after another, as a short tour; false when none of them is on screen. */
  function showPlaces(ids) {
    const p = pointer();
    const steps = ids.map(function (id) { return { help: id }; });
    return !!p.start({ id: '__adhoc', steps: steps });
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    if (!aiNs || typeof aiNs.completeJson !== 'function') {
      bubble('assistant', t('aideNoAi'), null);
      return;
    }
    const available = await aiNs.isAvailable().catch(function () { return false; });
    if (!available) {
      bubble('assistant', t('aideNoAi'), null);
      return;
    }
    input.value = '';
    bubble('user', text, null);
    history.push({ who: 'user', text: text });
    const thinking = bubble('assistant', '…', null);

    const onScreen = places();
    const prompt = [
      'You are the in-app aide of "' + (s.appName || document.title || 'this app') + '" on the AIMEAT platform.',
      'You may ONLY act through the declared actions below, and only propose one when the person asked to DO something.',
      'Answer as JSON: { "reply": "<plain words for the person>", "action"?: { "id", "params" }, "panel"?: { "blocks": [...] } when a visual answer helps, "show"?: ["<place id>", ...] }.',
      'A panel block is exactly { "id": "<short-slug>", "component": "<one of: list, statRow, table, timeline, figure, cardGrid>", "props": { "source": "<one of the SOURCE names below>", "title": "<a heading>" } } — no other component names, and only source names that appear below.',
      'When the person asks how or where to do something on this screen, answer with "show": the place ids they press, in the order they press them (at most ' + SHOW_MAX + '). The app lights each place on the screen. Use only ids from the PLACES list.',
      placesText(onScreen),
      actionsText(),
      'DATA the screen shows right now:',
      await contextText(),
      'CONVERSATION so far:',
      history.slice(-HISTORY_TURNS).map(function (h) { return h.who + ': ' + h.text; }).join('\n'),
    ].join('\n\n');

    let out;
    try {
      out = await aiNs.completeJson({
        prompt: prompt,
        schema: ANSWER_SCHEMA,
        app_id: s.appId || s.appName || 'atelier-aide',
        confirm: firstSend,
      });
      firstSend = false;
    } catch (err) {
      thinking.remove();
      const code = err && /** @type {any} */ (err).code;
      bubble('assistant', code === 'SPEND_CANCELLED' ? t('cancel') + '.' : t('aideFailed'), null);
      return;
    }

    thinking.remove();
    // completeJson answers { data: { content, parsed, provenance, ... } } — the VALIDATED object
    // is `parsed`. The first paid run read `data` itself and reported failure over a perfectly
    // good answer, which is why this line is spelled out.
    const body = out && out.data ? out.data : out;
    const answer = body && body.parsed ? body.parsed : body;
    const reply = answer && typeof answer.reply === 'string' ? answer.reply : t('aideFailed');
    const b = bubble('assistant', reply, (body && body.provenance) || (out && out.provenance) || null);
    history.push({ who: 'assistant', text: reply });

    if (answer && Array.isArray(answer.show)) offerPlaces(answer.show, onScreen, b);
    if (answer && answer.action && answer.action.id) offerAction(answer.action, b);
    if (answer && answer.panel) renderPanel(answer.panel, b);
  }

  /** The places the model named that are really on the screen: lit now, and again on a press. */
  function offerPlaces(ids, onScreen, into) {
    const known = new Set(onScreen.map(function (p) { return p.id; }));
    const valid = ids.filter(function (id) { return typeof id === 'string' && known.has(id); }).slice(0, SHOW_MAX);
    if (!valid.length) return;
    if (!showPlaces(valid)) return;
    into.appendChild(el('div', { class: 'ak-aide__confirm' }, [
      el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
        on: { click: function () { showPlaces(valid); } } }, t('aideShowAgain')),
    ]));
  }

  /** The model proposed; the person disposes. */
  function offerAction(proposed, into) {
    const declared = (s.actions || []).find(function (a) { return a.id === proposed.id; });
    if (!declared) {
      into.appendChild(el('p', { class: 'ak-aide__text', text: t('aideUnknownAction') }));
      return;
    }
    // One decision, two places to make it: the row in the conversation and, when the action names
    // its control, the card lit on that control. Whichever is pressed first decides; the other goes.
    let decided = false;
    let lit = null;
    const run = async function () {
      if (decided) return;
      decided = true;
      if (lit) { lit.close(); lit = null; }
      clear(row);
      row.appendChild(el('span', { text: '…' }));
      try {
        const result = await Promise.resolve(declared.run ? declared.run(proposed.params || {}) : null);
        clear(row);
        row.appendChild(el('span', { text: typeof result === 'string' ? result : t('ready') }));
      } catch (err) {
        clear(row);
        row.appendChild(el('span', { text: t('aideFailed') + ' ' + String(err && /** @type {any} */ (err).message || '') }));
      }
    };
    const cancel = function () {
      if (decided) return;
      decided = true;
      if (lit) { lit.close(); lit = null; }
      row.remove();
    };
    const row = el('div', { class: 'ak-aide__confirm' }, [
      el('span', { text: declared.summary }),
      el('button', { type: 'button', class: 'ak-btn ak-btn--primary', on: { click: run } }, t('aideRun')),
      el('button', { type: 'button', class: 'ak-btn ak-btn--ghost', on: { click: cancel } }, t('cancel')),
    ]);
    into.appendChild(row);
    // What the aide would do for the person, shown on the screen: the control that does the same.
    if (declared.target) {
      lit = pointer().point(declared.target, {
        title: declared.summary, text: t('aideSuggests'),
        actions: [{ label: t('aideRun'), primary: true, run: run }, { label: t('cancel'), run: cancel }],
        onClose: function () { lit = null; },
      });
    }
  }

  /** The governed generative panel: a mosaic fragment over the app's OWN sources. */
  function renderPanel(panel, into) {
    if (!panel || !Array.isArray(panel.blocks) || panel.blocks.length === 0 || panel.blocks.length > PANEL_BLOCKS_MAX) return;
    const ns = /** @type {any} */ (window).AIMEAT;
    if (!ns || !ns.atelier || typeof ns.atelier.mosaic !== 'function') return;
    const host = el('div', { class: 'ak-aide__panel' });
    into.appendChild(host);
    try {
      const handle = ns.atelier.mosaic({ target: host, layout: { v: 1, blocks: panel.blocks }, sources: s.sources || {} });
      root.addEventListener('ak-destroy', function () { handle.destroy(); }, { once: true });
    } catch (err) {
      console.warn('aimeat-atelier: a generated panel did not render — the words above stand alone.', err);
      host.remove();
    }
  }

  return {
    el: root,
    open() { input.focus(); },
    destroy() {
      if (ownPointer) ownPointer.destroy();
      root.dispatchEvent(new Event('ak-destroy'));
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
