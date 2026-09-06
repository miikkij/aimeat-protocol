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
 * @structure group · fields · copyBlock · statusLine · vocabularyNote
 * @usage  import { group, fields, copyBlock } from './dialog-parts.js';
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { el, kit } from './dom.js';
import { say } from './hooks-words.js';

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
