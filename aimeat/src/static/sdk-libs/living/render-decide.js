/**
 * @file living/render-decide.js
 * @description WHAT A DECIDE NODE LOOKS LIKE ON THE SCREEN. One row: the label, where the node is
 *   in words (waiting, asking, moved, waiting for a person, not available and why), each answer
 *   with its confidence, and what the node gates and the thresholds in force, so a person sees on
 *   the screen what the decision record keeps.
 *
 *   A PROPOSAL UNDER THE THRESHOLD IS A QUESTION TO THE PERSON. The row then says what the model
 *   proposed and how sure it was, and offers one button per event the machine accepts now plus
 *   "keep the state". The proposed event is the primary button; the person's press goes through
 *   the runtime's resolve(), which moves the machine and records the verdict on the decision.
 *   When the model was not available or failed, the same buttons are offered without a proposal:
 *   the machine is moved by hand, which is the only honest way left to move it.
 *
 *   It lives beside render.js rather than inside it, for the 800-line ceiling and because it is the
 *   one drawn row with buttons that act.
 * @structure decideRow(host, spec) → { el, update, relabel }
 * @usage  import { decideRow } from './render-decide.js';
 * @version-history
 *   v0.8.0 — 2026-09-19 — Initial (living 0.8.0).
 */
import { el, clear } from './dom.js';
import { sayDecide } from './decide-words.js';
import { eventsAccepted } from './nodes/decide.js';

/** A probability or a confidence as a person reads it: two decimals. */
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : ''; }

/**
 * @param {HTMLElement} host
 * @param {{ id: string, node: any, graph: any, label: () => string, langs: () => string[],
 *   resolve?: (id: string, choice: string) => void }} spec
 */
export function decideRow(host, spec) {
  const node = spec.node || {};
  const graph = spec.graph;
  const langs = spec.langs;
  const labelEl = el('span', { class: 'ak-living__note-label', text: spec.label() || spec.id });
  const statusEl = el('span', { class: 'ak-living__decide-status' });
  const reasonEl = el('p', { class: 'ak-living__decide-reason', hidden: true });
  const answersEl = el('dl', { class: 'ak-living__decide-answers' });
  const personEl = el('div', { class: 'ak-living__decide-person', hidden: true });
  const gatesEl = el('p', { class: 'ak-living__decide-gates' });
  const root = el('div', { class: 'ak-living__decide', 'data-living-node': spec.id }, [
    labelEl, statusEl, reasonEl, answersEl, personEl, gatesEl,
  ]);
  host.appendChild(root);

  function update() {
    const status = String(graph.valueOf(spec.id) || '');
    const f = graph.fieldsOf(spec.id) || {};
    root.setAttribute('data-decide', status || 'idle');
    statusEl.textContent = sayDecide('status.' + status, langs());
    const reason = String(f.reason || '');
    reasonEl.textContent = reason;
    reasonEl.hidden = !reason;

    clear(answersEl);
    for (const q of Object.keys(node.questions || {})) {
      const v = f[q];
      if (v === '' || v == null) continue;
      const conf = f[q + '.confidence'];
      const shown = typeof v === 'number' ? num(v) : String(v);
      answersEl.appendChild(el('dt', { text: q }));
      answersEl.appendChild(el('dd', { text: conf === '' || conf == null ? shown : shown + ' (' + num(conf) + ')' }));
    }
    answersEl.hidden = !answersEl.firstChild;

    clear(personEl);
    const byHand = status === 'unavailable' || status === 'failed';
    personEl.hidden = status !== 'person' && !byHand;
    if (!personEl.hidden && node.machine) {
      const pending = String(f.pending || '');
      const conf = f[String(node.event) + '.confidence'];
      const t = (node.thresholds || {})[String(node.event)];
      const machine = graph.nodeOf(String(node.machine)) || {};
      const accepted = eventsAccepted(machine, String(graph.valueOf(String(node.machine)) || ''));
      personEl.appendChild(el('p', {
        text: byHand ? sayDecide('byHand', langs())
          : accepted.indexOf(pending) >= 0
            ? sayDecide('proposal', langs(), { event: pending, conf: num(conf), t: num(Number(t)) })
            : sayDecide('proposalNone', langs()),
      }));
      const row = el('div', { class: 'ak-living__decide-actions' });
      const ordered = accepted.indexOf(pending) >= 0
        ? [pending].concat(accepted.filter(function (e) { return e !== pending; }))
        : accepted;
      ordered.forEach(function (event, i) {
        row.appendChild(el('button', {
          type: 'button', class: i === 0 && event === pending ? 'ak-btn ak-btn--primary' : 'ak-btn',
          'data-event': event,
          text: sayDecide(byHand ? 'step' : 'confirm', langs(), { event: event }),
          on: { click: function () { if (spec.resolve) spec.resolve(spec.id, event); } },
        }));
      });
      row.appendChild(el('button', {
        type: 'button', class: 'ak-btn ak-btn--ghost', 'data-event': '',
        text: sayDecide('keep', langs()),
        on: { click: function () { if (spec.resolve) spec.resolve(spec.id, ''); } },
      }));
      personEl.appendChild(row);
    }

    const ts = Object.entries(node.thresholds || {}).map(function (e) { return e[0] + ' ' + num(Number(e[1])); });
    gatesEl.textContent = sayDecide('gates', langs()) + ': ' + String(node.gates || '')
      + (ts.length ? ' · ' + sayDecide('thresholds', langs()) + ': ' + ts.join(', ') : '');
  }
  update();

  return {
    el: root,
    update: update,
    relabel() {
      const words = spec.label() || spec.id;
      if (labelEl.textContent !== words) labelEl.textContent = words;
      update();
    },
  };
}
