/**
 * @file atelier/copilot.js
 * @description The in-app copilot (TARGET-074 phase 6): a chat panel whose TOOLS ARE THE APP'S
 *   OWN DECLARATIONS. The app hands over its data sources and its actions; the copilot can read
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
 * @structure copilot(spec) → { el, open, destroy }
 * @usage
 *   AIMEAT.atelier.copilot({ target: a.main, appName: 'Errands',
 *     sources: { 'errands.items': loadItems },
 *     actions: [{ id: 'complete', summary: 'Mark one errand done', params: { id: 'string' },
 *                 run: (p) => completeErrand(p.id) }] });
 * @version-history
 *   v0.1.0 — 2026-08-28 — Initial (TARGET-074 phase 6, slice 1).
 */
import { el, clear, resolve, enter } from './dom.js';
import { t } from './i18n.js';

/** How much resolved source data rides in the prompt — per source and in total. */
const SOURCE_CHARS_MAX = 2000;
const CONTEXT_CHARS_MAX = 8000;
/** A generated panel stays a panel. */
const PANEL_BLOCKS_MAX = 8;
/** Turns of history the model sees. */
const HISTORY_TURNS = 12;

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
  },
  required: ['reply'],
};

/**
 * @param {{
 *   target?: string|Element,
 *   appName?: string, intro?: string, appId?: string,
 *   sources?: Record<string, () => any>,
 *   actions?: Array<{ id: string, summary: string, params?: Record<string, string>, run?: (params: any) => any }>,
 * }} spec
 * @returns {{ el: HTMLElement, open: () => void, destroy: () => void }}
 */
export function copilot(spec) {
  const s = spec || {};
  const history = [];
  let firstSend = true;

  const log = el('div', { class: 'ak-copilot__log', role: 'log', 'aria-live': 'polite' });
  const input = /** @type {HTMLTextAreaElement} */ (el('textarea', {
    class: 'ak-input ak-input--area ak-copilot__input', rows: 2,
    placeholder: t('copilotPlaceholder'), 'aria-label': t('copilotPlaceholder'),
  }));
  const sendBtn = el('button', {
    type: 'button', class: 'ak-btn ak-btn--primary',
    on: { click: function () { send(); } },
  }, t('send'));
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
  });

  const notice = el('p', { class: 'ak-copilot__notice' });
  const root = el('section', { class: 'ak-root ak-copilot', 'aria-label': 'Copilot' }, [
    el('header', { class: 'ak-copilot__head' }, [
      el('h2', { class: 'ak-section__title', text: t('copilotTitle') }),
      notice,
    ]),
    log,
    el('div', { class: 'ak-copilot__row' }, [input, sendBtn]),
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
    notice.textContent = t('copilotNotice');
  }
  if (s.intro) bubble('assistant', s.intro, null);

  function bubble(who, text, provenance) {
    const b = el('div', { class: 'ak-copilot__msg ak-copilot__msg--' + who }, [
      el('p', { class: 'ak-copilot__text', text: text }),
    ]);
    if (who === 'assistant' && provenance && aiNs && typeof aiNs.disclose === 'function') {
      const tag = el('span', { class: 'ak-copilot__label' });
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
        console.warn('aimeat-atelier: copilot source "' + name + '" failed', err);
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

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    if (!aiNs || typeof aiNs.completeJson !== 'function') {
      bubble('assistant', t('copilotNoAi'), null);
      return;
    }
    const available = await aiNs.isAvailable().catch(function () { return false; });
    if (!available) {
      bubble('assistant', t('copilotNoAi'), null);
      return;
    }
    input.value = '';
    bubble('user', text, null);
    history.push({ who: 'user', text: text });
    const thinking = bubble('assistant', '…', null);

    const prompt = [
      'You are the in-app copilot of "' + (s.appName || document.title || 'this app') + '" on the AIMEAT platform.',
      'You may ONLY act through the declared actions below, and only propose one when the person asked to DO something.',
      'Answer as JSON: { "reply": "<plain words for the person>", "action"?: { "id", "params" }, "panel"?: <a small mosaic layout { v:1, blocks:[...] } when a visual answer helps> }.',
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
        app_id: s.appId || s.appName || 'atelier-copilot',
        confirm: firstSend,
      });
      firstSend = false;
    } catch (err) {
      thinking.remove();
      const code = err && /** @type {any} */ (err).code;
      bubble('assistant', code === 'SPEND_CANCELLED' ? t('cancel') + '.' : t('copilotFailed'), null);
      return;
    }

    thinking.remove();
    const answer = out && out.data ? out.data : out;
    const reply = answer && typeof answer.reply === 'string' ? answer.reply : t('copilotFailed');
    const b = bubble('assistant', reply, out && out.provenance ? out.provenance : null);
    history.push({ who: 'assistant', text: reply });

    if (answer && answer.action && answer.action.id) offerAction(answer.action, b);
    if (answer && answer.panel) renderPanel(answer.panel, b);
  }

  /** The model proposed; the person disposes. */
  function offerAction(proposed, into) {
    const declared = (s.actions || []).find(function (a) { return a.id === proposed.id; });
    if (!declared) {
      into.appendChild(el('p', { class: 'ak-copilot__text', text: t('copilotUnknownAction') }));
      return;
    }
    const row = el('div', { class: 'ak-copilot__confirm' }, [
      el('span', { text: declared.summary }),
      el('button', {
        type: 'button', class: 'ak-btn ak-btn--primary',
        on: { click: async function () {
          clear(row);
          row.appendChild(el('span', { text: '…' }));
          try {
            const result = await Promise.resolve(declared.run ? declared.run(proposed.params || {}) : null);
            clear(row);
            row.appendChild(el('span', { text: typeof result === 'string' ? result : t('ready') }));
          } catch (err) {
            clear(row);
            row.appendChild(el('span', { text: t('copilotFailed') + ' ' + String(err && /** @type {any} */ (err).message || '') }));
          }
        } },
      }, t('copilotRun')),
      el('button', {
        type: 'button', class: 'ak-btn ak-btn--ghost',
        on: { click: function () { row.remove(); } },
      }, t('cancel')),
    ]);
    into.appendChild(row);
  }

  /** The governed generative panel: a mosaic fragment over the app's OWN sources. */
  function renderPanel(panel, into) {
    if (!panel || !Array.isArray(panel.blocks) || panel.blocks.length === 0 || panel.blocks.length > PANEL_BLOCKS_MAX) return;
    const ns = /** @type {any} */ (window).AIMEAT;
    if (!ns || !ns.atelier || typeof ns.atelier.mosaic !== 'function') return;
    const host = el('div', { class: 'ak-copilot__panel' });
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
      root.dispatchEvent(new Event('ak-destroy'));
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
