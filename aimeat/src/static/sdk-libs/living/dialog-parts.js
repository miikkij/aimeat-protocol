/**
 * @file living/dialog-parts.js
 * @description THE FIVE PIECES BOTH GEAR DIALOGS ARE BUILT OUT OF, so neither of them builds any of
 *   its own: a group with a heading, a set of fields, a block of JSON somebody can copy, a line that
 *   reports what a test call came back with, and a short reading of what describe() says about this
 *   node type.
 *
 *   THE FIELDS ARE THE KIT'S, NOT OURS. One `AIMEAT.atelier.form({ submit: false })` per group, with
 *   an `onInput` writing into a plain draft object — so the label wiring, the hit areas, the select,
 *   the toggle and the announced refusal are the kit's and stay the kit's, exactly as the control
 *   row on a living document already is (render.js 0.2.0).
 *
 *   A COPY BLOCK IS A REAL BUTTON AND A REAL SELECTION. The clipboard API is not available on every
 *   origin a document can be opened from, so the fallback selects the text instead of failing
 *   silently — a person who cannot press Copy can still press Ctrl+C, and the button says which of
 *   the two just happened.
 *
 *   A HEADER IS WHERE A KEY GOES, AND A KEY IS NOT TYPED HERE. An address that wants an API key
 *   wants it in a header, and a header typed into a record is a record carrying somebody's key —
 *   readable by every reader of the document and every copy of it. So the value box takes
 *   `{{secret:NAME}}` instead, picked from the owner's own vault: the name travels in the record,
 *   the value stays on the server, and it is put in as the call leaves. The picker is a list of
 *   NAMES, never of values, because the vault does not hand a value back to anybody.
 *
 *   A PICK OVER A LIST NOBODY HAS FILLED SAYS SO. An empty vault and an owner with no agents are
 *   both ordinary states on a new account, and a select with no options in it reads as a broken
 *   control. Both answer with one sentence and a door to where the thing is made.
 * @structure group · fields · copyBlock · statusLine · vocabularyNote · apexPage · ownerRead ·
 *   pickOrWords · secretPicker · headerEditor
 * @usage  import { group, fields, copyBlock, headerEditor } from './dialog-parts.js';
 * @version-history
 *   v0.7.0 — 2026-09-06 — The header editor, the secret picker over the owner's vault, and
 *     ownerRead/pickOrWords, which the agent pick in the outward dialog stands on too.
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { el, kit } from './dom.js';
import { say } from './hooks-words.js';
import { APEX_URL, NODE_URL } from '../_core/config.js';

/**
 * A page a PERSON opens, addressed at the apex rather than at wherever this document is being
 * read. An app is served from its own subdomain, so a relative link to the profile would send
 * somebody to a host that has no profile on it.
 * @param {string} path @returns {string}
 */
export function apexPage(path) {
  return String(APEX_URL || NODE_URL || '') + String(path);
}

/** One titled group inside a dialog's body. Hidden and shown by the road a person picks. */
export function group(host, title) {
  const body = el('div', { class: 'ak-living__dialog-body' });
  const root = el('section', { class: 'ak-living__dialog-group' }, [
    el('h3', { class: 'ak-living__dialog-heading', text: String(title) }),
    body,
  ]);
  host.appendChild(root);
  return {
    el: root,
    body: body,
    show(on) { root.hidden = !on; },
  };
}

/**
 * A row of the kit's own form fields, reporting into a draft object as they are touched.
 * @param {HTMLElement} host @param {Array<any>} list @param {Record<string, any>} draft
 * @returns {any}
 */
export function fields(host, list, draft) {
  const k = kit();
  const handle = k.form({
    target: host,
    submit: false,
    fields: list.map(function (field) {
      return Object.assign({}, field, {
        onInput(value) { draft[field.name] = value; if (field.after) field.after(value); },
      });
    }),
  });
  handle.el.classList.add('ak-living__dialog-fields');
  return handle;
}

/**
 * A block of text a person is meant to take away with them: JSON, a curl line, a sentence to paste
 * into their own chat.
 * @param {HTMLElement} host @param {{ label: string, text: string, langs?: () => string[] }} spec
 */
export function copyBlock(host, spec) {
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const pre = el('pre', { class: 'ak-living__copy-text', tabindex: '0', text: String(spec.text) });
  const button = el('button', {
    type: 'button', class: 'ak-btn ak-btn--outline ak-living__copy-btn',
    text: say('copy', langs()),
    on: {
      click() {
        const text = pre.textContent || '';
        const done = function () {
          button.textContent = say('copied', langs());
          setTimeout(function () { button.textContent = say('copy', langs()); }, 1600);
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { select(); });
            return;
          }
        } catch { /* no clipboard on this origin */ }
        select();
      },
    },
  });
  /** The fallback: put the text under the person's own Ctrl+C rather than failing in silence. */
  function select() {
    try {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      pre.focus();
    } catch { /* nothing more to try */ }
  }
  const root = el('div', { class: 'ak-living__copy' }, [
    el('div', { class: 'ak-living__copy-head' }, [
      el('span', { class: 'ak-living__copy-label', text: String(spec.label) }),
      button,
    ]),
    pre,
  ]);
  host.appendChild(root);
  return {
    el: root,
    set(text) { pre.textContent = String(text); },
  };
}

/** Where a test call's answer lands: the value it read, or the refusal in words. */
export function statusLine(host) {
  const line = el('p', { class: 'ak-living__dialog-status', role: 'status' });
  host.appendChild(line);
  return {
    el: line,
    say(text, ok) {
      line.textContent = String(text || '');
      line.setAttribute('data-ok', ok ? 'yes' : 'no');
    },
  };
}

/* ── What the owner's own lists are read with ───────────────────────────────────────────────── */

/**
 * One read of this node as the signed-in owner, for a list this library offers a pick over: the
 * vault's names, the owner's agents. It is the session's own fetch, so no principal travels from
 * the record and a guest simply gets null.
 * @param {string} path
 * @returns {Promise<any|null>}
 */
export async function ownerRead(path) {
  try {
    const ns = /** @type {any} */ (window).AIMEAT;
    const session = ns && ns.auth && typeof ns.auth.getSession === 'function' ? ns.auth.getSession() : null;
    if (!session || typeof session.fetch !== 'function') return null;
    const answer = await session.fetch(String(path));
    if (!answer || !answer.ok) return null;
    return answer.data || null;
  } catch { return null; }
}

/**
 * A sentence and a door, for a pick whose list is empty or could not be read. The door is a real
 * link to the page where the thing is made, on the node rather than on this document's origin.
 * @param {{ words: string, doorWords: string, href: string }} spec
 * @returns {HTMLElement}
 */
export function pickOrWords(spec) {
  return el('p', { class: 'ak-living__dialog-none' }, [
    el('span', { text: String(spec.words) + ' ' }),
    el('a', {
      class: 'ak-living__dialog-door', href: String(spec.href), target: '_blank', rel: 'noopener',
      text: String(spec.doorWords),
    }),
  ]);
}

/**
 * The picker that puts a secret's NAME into a value box. It writes `{{secret:NAME}}` where the
 * caret is, so a header value can carry a word around it ("Bearer {{secret:X}}"), and it resets
 * itself after each pick so the same secret can be put in twice.
 * @param {{ names: string[], input: HTMLInputElement|HTMLTextAreaElement, langs?: () => string[],
 *   base?: string }} spec
 * @returns {HTMLElement}
 */
export function secretPicker(spec) {
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const names = Array.isArray(spec.names) ? spec.names : [];
  if (!names.length) {
    return pickOrWords({
      words: say('secret.none', langs()),
      doorWords: say('secret.add', langs()),
      href: apexPage('/v1/profile?tab=access'),
    });
  }
  const select = el('select', {
    class: 'ak-input ak-living__secret-pick',
    'aria-label': say('secret.pick', langs()),
  }, [el('option', { value: '' }, say('secret.pick', langs()))].concat(names.map(function (name) {
    return el('option', { value: name }, name);
  })));
  select.addEventListener('change', function () {
    const name = String(/** @type {HTMLSelectElement} */ (select).value || '');
    /** @type {HTMLSelectElement} */ (select).value = '';
    if (!name) return;
    insertAtCaret(spec.input, '{{secret:' + name + '}}');
  });
  return select;
}

/**
 * Put text where the caret is, and leave the caret after it. A box that always appended would be
 * wrong for the header this exists for: "Bearer " is typed first and the secret goes after it,
 * but a scheme written after the fact belongs in front.
 * @param {any} input @param {string} text
 */
function insertAtCaret(input, text) {
  const value = String(input.value || '');
  let at = value.length;
  try { if (typeof input.selectionStart === 'number') at = input.selectionStart; } catch { /* no caret here */ }
  const end = (function () {
    try { return typeof input.selectionEnd === 'number' ? input.selectionEnd : at; } catch { return at; }
  }());
  input.value = value.slice(0, at) + text + value.slice(end);
  try { input.selectionStart = input.selectionEnd = at + text.length; } catch { /* no caret here */ }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

/**
 * The headers a call carries, as rows a person can add to and take away from. The map is rebuilt
 * from the rows on every keystroke and handed back, so the caller keeps one shape and never has to
 * read the DOM.
 * @param {HTMLElement} host
 * @param {{ headers?: Record<string, string>, langs?: () => string[], base?: string,
 *   secrets: () => string[], onChange: (headers: Record<string, string>) => void }} spec
 * @returns {{ el: HTMLElement, refresh: () => void }}
 */
export function headerEditor(host, spec) {
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const words = function (key) { return say(key, langs()); };
  /** @type {Array<{ name: string, value: string }>} */
  const rows = [];
  for (const name of Object.keys(spec.headers || {})) {
    rows.push({ name: name, value: String((spec.headers || {})[name]) });
  }

  const list = el('div', { class: 'ak-living__headers' });
  const add = el('button', {
    type: 'button', class: 'ak-btn ak-btn--outline ak-living__headers-add', text: words('headers.add'),
    on: { click() { rows.push({ name: '', value: '' }); draw(); report(); } },
  });
  const root = el('div', { class: 'ak-living__dialog-headers' }, [
    el('p', { class: 'ak-living__dialog-hint', text: words('headers.lead') }),
    list,
    add,
  ]);
  host.appendChild(root);

  /** The map as the record carries it: a row with no name is a row still being typed. */
  function report() {
    /** @type {Record<string, string>} */
    const out = {};
    for (const row of rows) {
      const name = String(row.name || '').trim();
      if (name) out[name] = String(row.value || '');
    }
    if (spec.onChange) spec.onChange(out);
  }

  function draw() {
    while (list.firstChild) list.removeChild(list.firstChild);
    const names = spec.secrets() || [];
    rows.forEach(function (row, i) {
      const name = /** @type {HTMLInputElement} */ (el('input', {
        type: 'text', class: 'ak-input ak-living__header-name', value: row.name,
        placeholder: words('headers.name'), 'aria-label': words('headers.name'),
      }));
      const value = /** @type {HTMLInputElement} */ (el('input', {
        type: 'text', class: 'ak-input ak-living__header-value', value: row.value,
        placeholder: words('headers.value'), 'aria-label': words('headers.value'),
      }));
      name.addEventListener('input', function () { row.name = name.value; report(); });
      value.addEventListener('input', function () { row.value = value.value; report(); });
      const drop = el('button', {
        type: 'button', class: 'ak-btn ak-btn--ghost ak-living__header-drop', text: words('headers.remove'),
        on: { click() { rows.splice(i, 1); draw(); report(); } },
      });
      list.appendChild(el('div', { class: 'ak-living__header' }, [
        name, value, secretPicker({ names: names, input: value, langs: langs, base: spec.base }), drop,
      ]));
    });
    if (!rows.length) list.appendChild(el('p', { class: 'ak-living__dialog-hint', text: words('headers.none') }));
  }

  draw();
  return { el: root, refresh: draw };
}

/**
 * What describe() says about this node type, in one line and one list — the same vocabulary an AI
 * reads, put in front of the person editing the same node by hand.
 * @param {HTMLElement} host @param {any} vocabulary
 */
export function vocabularyNote(host, vocabulary) {
  const root = el('div', { class: 'ak-living__vocabulary' }, [
    el('p', { class: 'ak-living__vocabulary-summary', text: String(vocabulary.summary || '') }),
    el('p', {
      class: 'ak-living__vocabulary-options',
      text: (vocabulary.options || []).join(' · '),
    }),
  ]);
  host.appendChild(root);
  return root;
}
