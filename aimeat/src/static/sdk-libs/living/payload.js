/**
 * @file living/payload.js
 * @description WHAT LEAVES THE BROWSER WHEN A DOCUMENT TELLS SOMEBODY. One object, and it carries
 *   the whole state rather than the one thing that moved: which document this is, when, which
 *   machine transitioned and from where to where, every value with its unit and its label, and
 *   every machine's state. A receiver that has all of it can decide what to do with ONE message;
 *   a receiver handed "it went to exporting" has to ask, and there is nobody on this end to ask.
 *
 *   A LABEL IS WORDS AND WORDS HAVE A LANGUAGE, so the labels are read in whatever language the
 *   page is reading. The ids are not: an id is what a formula compares against and what a receiver
 *   keys on, and an id that changed with the reader's language would be a different message in each.
 *
 *   A ROW IS ABBREVIATED UNLESS IT WAS ASKED FOR. A living document holds days and years as single
 *   nodes — twenty-four hours, three hundred and sixty-five days, a 288-element year — and putting
 *   all of them into every message would turn a webhook into a data dump and hit the node's payload
 *   cap on the first crossing. So a row travels as its LENGTH and a head of twenty-four, and naming
 *   the node in `include` is how a receiver that wants the whole row says so.
 * @structure ROW_HEAD · readValue · buildPayload(spec)
 * @usage
 *   import { buildPayload } from './payload.js';
 *   const body = buildPayload({ doc, graph, langs, triggerId, trigger, transition, at });
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { isError, isQuantity } from './formula-eval.js';
import { unitLabel } from './units.js';
import { textOf } from './i18n.js';

/** How much of a row travels when nobody asked for the whole thing. */
export const ROW_HEAD = 24;

/** The node types whose current value is a reading a receiver can act on. */
const CARRIES_A_VALUE = ['value', 'formula', 'source', 'text'];

/**
 * One graph value as plain JSON: a number, a line of text, a truth, or a row of those. A quantity
 * loses its unit here because the unit travels beside it, once, rather than on every element.
 * @param {any} v
 * @returns {any}
 */
export function readValue(v) {
  if (isQuantity(v)) return v.n;
  if (Array.isArray(v)) return v.map(readValue);
  if (isError(v)) return null;
  if (v === undefined) return null;
  return v;
}

/** The unit a value carries: its own, or the one every element of a row carries. */
function unitOf(v) {
  if (isQuantity(v)) return unitLabel(v.u);
  if (Array.isArray(v) && v.length && isQuantity(v[0])) return unitLabel(v[0].u);
  return '';
}

/**
 * The message.
 * @param {{ doc: any, graph: any, langs: () => string[], triggerId: string, trigger: any,
 *   transition: { node: string, from: string, to: string, event: string },
 *   at?: string, test?: boolean }} spec
 * @returns {any}
 */
export function buildPayload(spec) {
  const doc = spec.doc || {};
  const graph = spec.graph;
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const wanted = langs();
  const nodes = (doc.model || {}).nodes || {};
  const trigger = spec.trigger || {};

  const named = Array.isArray(trigger.include) ? trigger.include.map(String) : null;

  const values = {};
  const machines = {};
  for (const id of graph.ids) {
    const node = nodes[id] || {};
    const type = String(node.type);
    if (type === 'machine') { machines[id] = String(graph.valueOf(id) || ''); continue; }
    if (CARRIES_A_VALUE.indexOf(type) < 0) continue;
    if (named && named.indexOf(id) < 0) continue;

    const raw = graph.valueOf(id);
    let value = readValue(raw);
    // A row goes whole only when the trigger named this node; otherwise its length and a head.
    if (Array.isArray(value) && !named) {
      value = { length: value.length, head: value.slice(0, ROW_HEAD) };
    }
    const entry = {
      value: value,
      unit: unitOf(raw),
      label: String(textOf(node.label, wanted) || id),
    };
    if (isError(raw)) entry.error = String(raw.error);
    const stale = String((graph.fieldsOf(id) || {}).stale || '');
    if (stale) entry.stale = stale;
    values[id] = entry;
  }

  const body = {
    document: {
      key: String(doc.key || ''),
      title: String(textOf(doc.title, wanted) || ''),
      register: String(doc.register || ''),
    },
    at: String(spec.at || new Date().toISOString()),
    transition: {
      node: String((spec.transition || {}).node || ''),
      from: String((spec.transition || {}).from || ''),
      to: String((spec.transition || {}).to || ''),
      event: String((spec.transition || {}).event || ''),
    },
    values: values,
    machines: machines,
    trigger: {
      id: String(spec.triggerId || ''),
      label: String(textOf(trigger.label, wanted) || spec.triggerId || ''),
    },
  };
  if (spec.test) body.test = true;
  return body;
}
