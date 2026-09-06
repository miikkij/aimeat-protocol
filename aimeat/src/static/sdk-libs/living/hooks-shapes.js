/**
 * @file living/hooks-shapes.js
 * @description WHAT THE TWO GEAR DIALOGS SAY, WORKED OUT FROM THE RECORD RATHER THAN TYPED INTO A
 *   TEMPLATE. A dialog that shows a plausible-looking example somebody wrote once is worse than no
 *   dialog at all: the person copies it, the shape is wrong for their node, and the failure lands on
 *   the far side of an API call where nobody can see it. So the JSON on the screen is generated from
 *   THIS node — its path, its unit, its current reading — and from describe(), which is the same
 *   vocabulary an AI reads.
 *
 *   THE INWARD DIALOG OFFERS THREE ROADS AND THEY ARE NOT ALTERNATIVES TO EACH OTHER. The URL road
 *   is for a reading that already exists at an address. The MEMORY road is for a value somebody
 *   else writes — a device, an agent, another app — and it is a key of this document's own, under
 *   `<document key>.in.<node>`, because a memory write REPLACES a value and a writer must never be
 *   handed the whole record to overwrite. The AGENT road is the same memory road said as a sentence
 *   a person can paste into their own chat, which is the road most people will actually take.
 *
 *   THE OUTWARD DIALOG SHOWS THE MESSAGE ITSELF, for the state the document is in at the moment it
 *   is opened. Not a sample, not a schema: the object that would leave if the machine moved now,
 *   built by the same payload.js the delivery uses. If those two ever disagree, the dialog is
 *   lying, which is why they are one function called twice rather than two functions.
 * @structure inwardShape(ctx) · outwardShape(ctx) · memoryKeyFor(doc, id)
 * @usage
 *   import { inwardShape } from './hooks-shapes.js';
 *   const shape = inwardShape({ id, node, doc, graph, langs, base });
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { NODES } from './describe-data.js';
import { shapeFor } from './json-path.js';
import { readValue, buildPayload } from './payload.js';
import { statesOf } from './render.js';
import { textOf } from './i18n.js';
import { watchOf, TRIGGER_METHODS } from './nodes/trigger.js';
import { say, fill } from './hooks-words.js';

/** describe()'s own answer for one type, without importing the library's front door. */
function vocabularyOf(type) {
  const found = NODES[String(type)];
  return found ? Object.assign({ id: String(type) }, found) : { id: String(type) };
}

/**
 * The memory key somebody writing this value from outside would write to. It is a key of this
 * document's own rather than the record itself, because a memory write replaces a value: handing a
 * device the record's key would let one reading overwrite the whole document.
 * @param {any} doc @param {string} id
 * @returns {string}
 */
export function memoryKeyFor(doc, id) {
  return String((doc && doc.key) || 'living') + '.in.' + String(id);
}

/**
 * The inward dialog's whole content, for a control, a value or a source.
 * @param {{ id: string, node: any, doc: any, graph: any, langs?: () => string[], base?: string }} ctx
 * @returns {any}
 */
export function inwardShape(ctx) {
  const doc = ctx.doc || {};
  const nodes = (doc.model || {}).nodes || {};
  const langs = typeof ctx.langs === 'function' ? ctx.langs : function () { return []; };
  const wanted = langs();

  // A GEAR ON A CONTROL IS A GEAR ON THE VALUE UNDER IT. A control is a hand on a quantity; the
  // quantity is what an address or an agent would write, so that is the node this dialog edits.
  const subjectId = String(ctx.node && ctx.node.type === 'control' && ctx.node.target
    ? ctx.node.target : ctx.id);
  const subject = nodes[subjectId] || ctx.node || {};

  const sample = readValue(ctx.graph ? ctx.graph.valueOf(subjectId) : subject.value);
  const road = subject.url ? 'url' : (subject.key ? 'key' : 'hand');
  const path = String(subject.path || '');
  const expected = subject.raw ? sample : shapeFor(path || 'value', sample);

  const base = String(ctx.base || '');
  const key = memoryKeyFor(doc, subjectId);
  const body = { key: key, value: { value: sample } };
  const hasRange = typeof subject.min === 'number' || typeof subject.max === 'number'
    || typeof subject.step === 'number';

  return {
    subject: subjectId,
    target: subjectId,
    label: String(textOf(subject.label, wanted) || subjectId),
    road: road,
    url: String(subject.url || ''),
    path: path,
    raw: !!subject.raw,
    every: subject.every == null ? '' : String(subject.every),
    key: String(subject.key || ''),
    sample: sample,
    /** The answer a URL has to give for THIS node to find its number in it. */
    expected: expected,
    range: hasRange
      ? { min: subject.min, max: subject.max, step: subject.step, unit: String(subject.unit || '') }
      : null,
    /** The memory road: the key, the request, and a line somebody can paste into a terminal. */
    write: {
      key: key,
      request: {
        method: 'POST',
        url: base + '/v1/memory',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer <your token>' },
        body: body,
      },
      curl: 'curl -X POST ' + base + '/v1/memory'
        + ' -H "Content-Type: application/json"'
        + ' -H "Authorization: Bearer <your token>"'
        + " -d '" + JSON.stringify(body) + "'",
    },
    /** The agent road: the same thing said out loud, in the language the page is reading. */
    sentence: fill(say('sentence.write', wanted), {
      key: key,
      sample: JSON.stringify(sample),
      title: String(textOf(doc.title, wanted) || doc.key || ''),
    }),
    vocabulary: vocabularyOf(subject.type || 'value'),
  };
}

/**
 * The outward dialog's whole content, for a machine or for a trigger already written on one.
 * @param {{ id: string, node: any, doc: any, graph: any, langs?: () => string[], base?: string }} ctx
 * @returns {any}
 */
export function outwardShape(ctx) {
  const doc = ctx.doc || {};
  const nodes = (doc.model || {}).nodes || {};
  const langs = typeof ctx.langs === 'function' ? ctx.langs : function () { return []; };
  const wanted = langs();
  const isTrigger = String((ctx.node || {}).type) === 'trigger';

  /** The trigger this dialog edits: the one clicked, the one already on this machine, or none yet. */
  let triggerId = isTrigger ? String(ctx.id) : null;
  if (!triggerId) {
    for (const id of Object.keys(nodes)) {
      const node = nodes[id] || {};
      if (String(node.type) === 'trigger' && watchOf(node).node === String(ctx.id)) {
        triggerId = id;
        break;
      }
    }
  }
  const written = triggerId ? nodes[triggerId] : null;
  const watching = written ? watchOf(written).node : String(ctx.id);
  const machine = nodes[watching] || {};

  const target = (written && written.target) || {};
  const kind = String(target.kind || 'url') === 'agent' ? 'agent' : 'url';
  const shaped = kind === 'agent'
    ? { kind: 'agent', agent: String(target.agent || '') }
    : { kind: 'url', url: String(target.url || ''), method: String(target.method || 'POST') };

  const draft = written || {
    type: 'trigger', on: watching, enabled: true, target: shaped, include: 'all',
  };
  const state = String(ctx.graph ? ctx.graph.valueOf(watching) || '' : '');

  return {
    /** The trigger's id when the record already carries one, null when this would write the first. */
    trigger: triggerId,
    /** The id a new trigger would be written under, so the dialog can say it before saving. */
    newId: String(watching) + 'Tells',
    watching: watching,
    label: String(textOf(draft.label, wanted) || textOf(machine.label, wanted) || watching),
    states: statesOf(machine),
    enabled: draft.enabled !== false,
    include: Array.isArray(draft.include) ? draft.include.slice() : 'all',
    target: shaped,
    methods: TRIGGER_METHODS.slice(),
    /** The message as it would go, for the state the document is in right now. */
    payload: buildPayload({
      doc: doc, graph: ctx.graph, langs: langs,
      triggerId: triggerId || (String(watching) + 'Tells'),
      trigger: draft,
      transition: { node: watching, from: state, to: state, event: '' },
      at: new Date().toISOString(),
    }),
    vocabulary: vocabularyOf('trigger'),
  };
}
