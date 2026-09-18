/**
 * @file prompt/index.js
 * @description The aimeat-prompt library. Exposes AIMEAT.prompt: the prompt-driven workflow as one
 *   component. The app composes a prompt, the person copies it into THEIR OWN AI chat, and brings
 *   the answer back by pasting it; the app reads the answer and carries on.
 *
 *   WHY THIS EXISTS. It is how an app gets AI work done for a person whose AI cannot connect to
 *   this node (a consumer Gemini app, Copilot without Copilot Studio, ChatGPT without Developer
 *   mode), and for anyone who would rather not hand an app a model key. It costs the app nothing,
 *   it works with any AI, and the person sees everything before it is sent and before it comes
 *   back. Every app that did this built its own copy button, its own paste box and its own way of
 *   digging JSON out of a chat answer, and the last of those is where they broke.
 *
 *   WHAT IT DOES NOT DO. It makes no network call and stores nothing. What the app does with the
 *   answer (save it with AIMEAT.data, feed it into the next prompt) is the app's own code. It is
 *   not AIMEAT.ai, which calls a model on the person's own key from inside the app.
 *
 *   THE ANSWER IS UNTRUSTED TEXT. It comes from a chat the app cannot see. expect: "json" parses
 *   it and hands over data; it is never evaluated, and the app renders it as text, not as HTML.
 * @structure extractJson(text) (from extract-json.js) · card(target, options) → { setPrompt, getPrompt, reset, destroy }
 * @usage <script src="/v1/libs/aimeat-prompt.js"></script>
 *   AIMEAT.prompt.card('#plan', {
 *     label: 'Plan my week',
 *     prompt: () => 'Here are my tasks: ' + JSON.stringify(tasks) + '. Answer with JSON: {"days": [...]}',
 *     expect: 'json',
 *     onResult: (plan) => showPlan(plan),
 *   });
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial. Item 10 of the instruction review: the portal's PromptCard is a
 *     Preact component an app cannot load, so apps get the same shape as a served library.
 */
import { attach } from '../_core/namespace.js';
import { extractJson } from './extract-json.js';

const STYLE_ID = 'aimeat-prompt-style';
const CSS = [
  '.aimeat-prompt{display:flex;flex-direction:column;gap:.75rem;padding:1rem;border:1px solid var(--color-base-300,#d4d4d8);border-radius:var(--radius-box,.75rem);background:var(--color-base-100,#fff);color:var(--color-base-content,#18181b);font:inherit;max-width:100%;box-sizing:border-box}',
  '.aimeat-prompt *{box-sizing:border-box}',
  '.aimeat-prompt__label{font-weight:600;margin:0}',
  '.aimeat-prompt__hint{margin:0;font-size:.875rem;opacity:.75}',
  '.aimeat-prompt__text{margin:0;padding:.75rem;max-height:14rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:.8125rem/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--color-base-200,#f4f4f5);border-radius:calc(var(--radius-box,.75rem)/2)}',
  '.aimeat-prompt__row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}',
  '.aimeat-prompt__btn{min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--color-primary,#4f46e5);border-radius:calc(var(--radius-box,.75rem)/2);background:var(--color-primary,#4f46e5);color:var(--color-primary-content,#fff);font:inherit;font-weight:600;cursor:pointer}',
  '.aimeat-prompt__btn--quiet{background:transparent;color:var(--color-base-content,#18181b);border-color:var(--color-base-300,#d4d4d8)}',
  '.aimeat-prompt__btn:disabled{opacity:.5;cursor:default}',
  '.aimeat-prompt__btn:focus-visible,.aimeat-prompt__answer:focus-visible{outline:2px solid var(--color-primary,#4f46e5);outline-offset:2px}',
  '.aimeat-prompt__answer{width:100%;min-height:7rem;padding:.75rem;border:1px solid var(--color-base-300,#d4d4d8);border-radius:calc(var(--radius-box,.75rem)/2);background:var(--color-base-100,#fff);color:inherit;font:inherit;resize:vertical}',
  '.aimeat-prompt__status{margin:0;font-size:.875rem;min-height:1.25rem}',
  '.aimeat-prompt__status--error{color:var(--color-error,#b91c1c)}',
].join('\n');

const TEXT = {
  en: {
    copy: 'Copy the prompt', copied: 'Copied', show: 'Show the prompt', hide: 'Hide the prompt',
    hint: 'Copy the prompt, run it in your own AI chat, then paste the whole answer below.',
    hintCopyOnly: 'Copy the prompt and run it in your own AI chat.',
    answer: 'Paste the answer here', use: 'Use this answer',
    copyFailed: 'Could not copy. Select the prompt text and copy it by hand.',
    empty: 'Paste the answer first.',
    notJson: 'No JSON found in the answer. Ask your AI to answer with JSON only, then paste again.',
    building: 'Preparing the prompt…',
  },
  fi: {
    copy: 'Kopioi prompti', copied: 'Kopioitu', show: 'Näytä prompti', hide: 'Piilota prompti',
    hint: 'Kopioi prompti, aja se omassa AI-chatissasi ja liitä koko vastaus alle.',
    hintCopyOnly: 'Kopioi prompti ja aja se omassa AI-chatissasi.',
    answer: 'Liitä vastaus tähän', use: 'Käytä tätä vastausta',
    copyFailed: 'Kopiointi ei onnistunut. Valitse promptin teksti ja kopioi se käsin.',
    empty: 'Liitä ensin vastaus.',
    notJson: 'Vastauksesta ei löytynyt JSONia. Pyydä AI:ta vastaamaan pelkällä JSONilla ja liitä uudelleen.',
    building: 'Valmistellaan promptia…',
  },
  es: {
    copy: 'Copiar el prompt', copied: 'Copiado', show: 'Mostrar el prompt', hide: 'Ocultar el prompt',
    hint: 'Copia el prompt, ejecútalo en tu propio chat de IA y pega abajo la respuesta completa.',
    hintCopyOnly: 'Copia el prompt y ejecútalo en tu propio chat de IA.',
    answer: 'Pega aquí la respuesta', use: 'Usar esta respuesta',
    copyFailed: 'No se pudo copiar. Selecciona el texto del prompt y cópialo a mano.',
    empty: 'Primero pega la respuesta.',
    notJson: 'No se encontró JSON en la respuesta. Pide a tu IA que responda solo con JSON y pega de nuevo.',
    building: 'Preparando el prompt…',
  },
};

/** The language the rest of the page is in: the platform's one key, then the document. */
function pageLang() {
  const auth = globalThis.AIMEAT && globalThis.AIMEAT.auth;
  const raw = (auth && typeof auth.getLang === 'function' && auth.getLang()) || document.documentElement.lang || 'en';
  const short = String(raw).slice(0, 2).toLowerCase();
  return TEXT[short] ? short : 'en';
}

/** @param {string} tag @param {string} className @param {string} [text] */
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {string} className @param {string} text @returns {HTMLButtonElement} */
function button(className, text) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = text;
  return node;
}

/** @param {string} text */
async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }
  // An insecure origin or an old browser has no async clipboard. The hidden field is the fallback
  // every copy button on the web falls back to.
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const done = document.execCommand('copy');
  field.remove();
  if (!done) throw new Error('copy refused');
}

/**
 * Mount one prompt card.
 *
 * @param {string|Element} target  A selector or an element. Its content is replaced.
 * @param {{
 *   prompt: string | (() => string | Promise<string>),
 *   label?: string,
 *   hint?: string,
 *   expect?: 'text' | 'json',
 *   onResult?: (value: unknown, raw: string) => void | Promise<void>,
 *   onCopied?: (prompt: string) => void,
 *   validate?: (value: unknown) => string | null | undefined,
 *   showPrompt?: boolean,
 *   lang?: string,
 * }} options
 *   prompt    — the text, or a function that builds it when the person copies, so it can carry
 *               data that changed since the card was mounted (an earlier answer, a fresh list).
 *   expect    — "text" (default) hands the pasted answer over as it is. "json" hands over the
 *               parsed value and refuses an answer with no JSON in it.
 *   validate  — return a sentence to refuse the answer with; return nothing to accept it.
 *   onResult  — omit it and the card is copy-only: no paste box is drawn.
 * @returns {{ setPrompt: (p: string | (() => string | Promise<string>)) => void, getPrompt: () => Promise<string>, reset: () => void, destroy: () => void }}
 */
function card(target, options) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error('AIMEAT.prompt.card: no element matches ' + String(target));
  if (!options || (typeof options.prompt !== 'string' && typeof options.prompt !== 'function')) {
    throw new Error('AIMEAT.prompt.card: options.prompt is a string or a function that returns one');
  }
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const words = TEXT[TEXT[options.lang] ? options.lang : pageLang()];
  let source = options.prompt;
  const build = async () => String(typeof source === 'function' ? await source() : source);

  const root = el('section', 'aimeat-prompt');
  if (options.label) root.appendChild(el('h3', 'aimeat-prompt__label', options.label));
  const takesAnswer = typeof options.onResult === 'function';
  root.appendChild(el('p', 'aimeat-prompt__hint', options.hint || (takesAnswer ? words.hint : words.hintCopyOnly)));
  const shown = el('pre', 'aimeat-prompt__text');
  // A tab stop only while the text scrolls: a keyboard user needs to reach a scrolling box to
  // read it, and a short prompt would otherwise be one empty stop on every card.
  const fitTabStop = () => {
    if (!shown.hidden && shown.scrollHeight > shown.clientHeight) shown.tabIndex = 0;
    else shown.removeAttribute('tabindex');
  };
  const row = el('div', 'aimeat-prompt__row');
  const copyButton = button('aimeat-prompt__btn', words.copy);
  const toggle = button('aimeat-prompt__btn aimeat-prompt__btn--quiet', words.hide);
  row.append(copyButton, toggle);
  const status = el('p', 'aimeat-prompt__status');
  status.setAttribute('role', 'status');
  root.append(shown, row);

  const say = (text, isError) => {
    status.textContent = text || '';
    status.classList.toggle('aimeat-prompt__status--error', Boolean(isError));
  };
  const refresh = async () => {
    shown.textContent = words.building;
    try { shown.textContent = await build(); } catch (err) { shown.textContent = ''; say(String(err && err.message || err), true); }
    fitTabStop();
  };
  const setShown = (visible) => {
    shown.hidden = !visible;
    toggle.textContent = visible ? words.hide : words.show;
    toggle.setAttribute('aria-expanded', String(visible));
    fitTabStop();
  };

  copyButton.addEventListener('click', async () => {
    copyButton.disabled = true;
    try {
      const text = await build();
      shown.textContent = text;
      fitTabStop();
      await copyText(text);
      copyButton.textContent = words.copied;
      say('');
      setTimeout(() => { copyButton.textContent = words.copy; }, 2000);
      if (typeof options.onCopied === 'function') options.onCopied(text);
    } catch (err) {
      console.warn('aimeat-prompt: the prompt could not be copied', err);
      say(words.copyFailed, true);
      setShown(true);
    } finally {
      copyButton.disabled = false;
    }
  });
  toggle.addEventListener('click', () => setShown(shown.hidden));

  /** @type {HTMLTextAreaElement|null} */
  let answer = null;
  if (typeof options.onResult === 'function') {
    answer = /** @type {HTMLTextAreaElement} */ (el('textarea', 'aimeat-prompt__answer'));
    answer.placeholder = words.answer;
    answer.setAttribute('aria-label', words.answer);
    const useButton = button('aimeat-prompt__btn', words.use);
    useButton.addEventListener('click', async () => {
      const raw = answer ? answer.value.trim() : '';
      if (!raw) { say(words.empty, true); return; }
      /** @type {unknown} */
      let value = raw;
      if (options.expect === 'json') {
        const parsed = extractJson(raw);
        if (parsed === undefined) { say(words.notJson, true); return; }
        value = parsed;
      }
      const refusal = typeof options.validate === 'function' ? options.validate(value) : null;
      if (refusal) { say(String(refusal), true); return; }
      useButton.disabled = true;
      try {
        await options.onResult(value, raw);
        say('');
      } catch (err) {
        say(String(err && err.message || err), true);
      } finally {
        useButton.disabled = false;
      }
    });
    const useRow = el('div', 'aimeat-prompt__row');
    useRow.appendChild(useButton);
    root.append(answer, useRow);
  }
  root.appendChild(status);

  host.replaceChildren(root);
  setShown(options.showPrompt !== false);
  refresh();

  return {
    setPrompt(next) { source = next; refresh(); },
    getPrompt: build,
    reset() { if (answer) answer.value = ''; say(''); },
    destroy() { root.remove(); },
  };
}

attach('prompt', { card, extractJson });
