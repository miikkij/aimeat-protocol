/**
 * @file atelier/workbench-parts.js
 * @description Two more workbench pieces, drawn in the approved Postinjalostamo design and built by
 *   hand in that app before they came here (wish kittiin-kehotepaneeli, 2026-09-29):
 *
 *     promptPanel  the way a person's OWN AI helps without a key on this node: step 1 shows a short
 *                  preview of the prompt with Copy and Show all, step 2 (when an answer is expected)
 *                  is a white box to paste the answer in and one button that hands it back parsed.
 *                  Two columns on a wide card, one on a phone.
 *     queueRow     one work item in a queue list, as the design draws it: who and when on a small
 *                  line, the subject, then chips (the class) and, when it waits, why in its tone.
 *                  It is the CONTENT of a list row: pass it as `parts: { row: ... }` to list or
 *                  listDetail, and the kit keeps the keying, the pick and the selection mark.
 *
 *   THE PROMPT PANEL PARSES, IT DOES NOT DECIDE. With `expect: 'json'` it finds the JSON object in
 *   what was pasted (fenced or not) and hands it to `onResult`; what the object means, and showing
 *   the changes before saving them, stays the app's.
 * @structure promptPanel · queueRow · parseAnswer
 * @usage  AIMEAT.atelier.promptPanel({ target: host, prompt: buildPrompt, expect: 'json', onResult: preview });
 *         AIMEAT.atelier.listDetail({ target: box, items, renderDetail,
 *           parts: { row: function (it) { return AIMEAT.atelier.queueRow({ who: it.from, when: it.at,
 *             title: it.subject, chips: [{ text: it.klass }], note: it.waits ? { text: 'Extraction failed', tone: 'warn' } : null }); } } });
 * @parts promptPanel root · col · step · preview · copy · toggle · answer · apply
 * @fork promptPanel Two columns of your own; copy .ak-promptpanel* out of workbench.css and keep the parse in parseAnswer.
 * @parts queueRow root · top · who · when · title · chips · chip · note
 * @fork queueRow Build your own row content; copy .ak-qrow* out of workbench.css.
 * @version-history
 *   v0.1.0 — 2026-09-29 — Initial.
 */
import { el, clear, resolve, whileBusy, uid } from './dom.js';
import { t } from './i18n.js';
import { toast } from './parts-ui.js';

/**
 * The JSON object in an answer pasted from a chat window: fences stripped, the outermost braces
 * taken, parsed. Null when there is none, so the caller says so in words.
 * @param {string} text
 * @returns {any|null}
 */
export function parseAnswer(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  // A parse that fails IS the answer: there is no object in the text.
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** A kit button that shows it is working while its promise runs. */
function button(label, cls, part, onClick) {
  const b = el('button', { type: 'button', class: 'ak-btn' + (cls ? ' ' + cls : ''), 'data-ak-part': part, 'data-ak-noguard': true }, label);
  b.addEventListener('click', function () {
    whileBusy(b, Promise.resolve().then(onClick)).catch(function (err) {
      toast({ title: String((err && err.message) || err), tone: 'err' });
    });
  });
  return b;
}

/**
 * THE PROMPT PANEL.
 * @param {{
 *   target?: string|Element,
 *   prompt: string | (() => string),
 *   expect?: 'json'|'text'|null,
 *   onResult?: (value: any, raw: string) => any,
 *   copyLabel?: string, applyLabel?: string,
 * }} spec
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function promptPanel(spec) {
  const promptText = function () { return typeof spec.prompt === 'function' ? spec.prompt() : String(spec.prompt || ''); };
  const answers = !!(spec.onResult && spec.expect !== null);
  const root = el('div', { class: 'ak-root ak-promptpanel' + (answers ? '' : ' ak-promptpanel--one'), 'data-ak-part': 'root' });

  const shortText = function () {
    const lines = promptText().split('\n');
    return lines[0].slice(0, 120) + '… (' + t('promptLines', { n: lines.length }) + ')';
  };
  const one = el('div', { class: 'ak-promptpanel__col', 'data-ak-part': 'col' });
  one.appendChild(el('div', { class: 'ak-promptpanel__step', 'data-ak-part': 'step', text: answers ? t('promptStepCopy') : t('promptStepCopyOnly') }));
  const preview = el('div', { class: 'ak-promptpanel__preview', 'data-ak-part': 'preview', text: shortText() });
  one.appendChild(preview);
  const row = el('div', { class: 'ak-promptpanel__row' });
  row.appendChild(button(spec.copyLabel || t('promptCopy'), 'ak-btn--primary', 'copy', function () {
    return navigator.clipboard.writeText(promptText()).then(function () { toast({ title: t('promptCopied'), tone: 'ok' }); });
  }));
  let full = false;
  const toggle = button(t('promptShowAll'), '', 'toggle', function () {
    full = !full;
    preview.textContent = full ? promptText() : shortText();
    preview.classList.toggle('ak-promptpanel__preview--full', full);
    toggle.textContent = full ? t('promptHide') : t('promptShowAll');
  });
  row.appendChild(toggle);
  one.appendChild(row);
  root.appendChild(one);

  if (answers) {
    const two = el('div', { class: 'ak-promptpanel__col', 'data-ak-part': 'col' });
    const id = uid('ak-pp');
    two.appendChild(el('label', { class: 'ak-promptpanel__step', 'data-ak-part': 'step', for: id, text: t('promptStepPaste') }));
    const area = el('textarea', { id: id, class: 'ak-input ak-input--area ak-promptpanel__answer', 'data-ak-part': 'answer', rows: 4, placeholder: t('promptPastePh') });
    two.appendChild(area);
    const row2 = el('div', { class: 'ak-promptpanel__row' });
    row2.appendChild(button(spec.applyLabel || t('promptApply'), 'ak-promptpanel__apply', 'apply', function () {
      const raw = /** @type {HTMLTextAreaElement} */ (area).value;
      if (spec.expect === 'json') {
        const value = parseAnswer(raw);
        if (value == null) throw new Error(t('promptNoJson'));
        return spec.onResult && spec.onResult(value, raw);
      }
      return spec.onResult && spec.onResult(raw, raw);
    }));
    two.appendChild(row2);
    root.appendChild(two);
  }

  if (spec.target) resolve(spec.target).appendChild(root);
  return {
    el: root,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * THE QUEUE ROW — the content of one work item in a queue list.
 * @param {{
 *   who?: string, when?: string|number|Date, title: string,
 *   chips?: Array<{ text: string }>, note?: { text: string, tone?: 'warn'|'err'|'ok'|'info' }|null,
 * }} spec
 * @returns {HTMLElement}
 */
export function queueRow(spec) {
  const s = spec || { title: '' };
  const root = el('span', { class: 'ak-qrow', 'data-ak-part': 'root' });
  const top = el('span', { class: 'ak-qrow__top', 'data-ak-part': 'top' });
  top.appendChild(el('span', { class: 'ak-qrow__who', 'data-ak-part': 'who', text: s.who || '' }));
  top.appendChild(el('span', { class: 'ak-qrow__when', 'data-ak-part': 'when', text: whenText(s.when) }));
  root.appendChild(top);
  root.appendChild(el('span', { class: 'ak-qrow__title', 'data-ak-part': 'title', text: s.title || '—' }));
  const chips = el('span', { class: 'ak-qrow__chips', 'data-ak-part': 'chips' });
  (s.chips || []).forEach(function (c) {
    if (c && c.text) chips.appendChild(el('span', { class: 'ak-qrow__chip', 'data-ak-part': 'chip', text: c.text }));
  });
  if (s.note && s.note.text) {
    const tone = ['warn', 'err', 'ok', 'info'].indexOf(s.note.tone || '') >= 0 ? s.note.tone : 'warn';
    chips.appendChild(el('span', { class: 'ak-qrow__note ak-tone-text--' + tone, 'data-ak-part': 'note', text: s.note.text }));
  }
  if (chips.firstChild) root.appendChild(chips);
  return root;
}

/** "27.9. 17.32" for a date this year, the day and month and time; a string passes as it is. */
function whenText(when) {
  if (when == null || when === '') return '';
  if (typeof when === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(when)) return when;
  const d = when instanceof Date ? when : new Date(when);
  if (isNaN(d.getTime())) return String(when);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getDate() + '.' + (d.getMonth() + 1) + '. ' + pad(d.getHours()) + '.' + pad(d.getMinutes());
}
