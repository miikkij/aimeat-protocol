/**
 * @file living/nodes/decide.js
 * @description A JUDGEMENT ABOUT TEXT, AS A NODE THE REST OF THE GRAPH CAN READ. A decide node asks
 *   the node's decision model (AIMEAT.decide) closed questions about the text another node holds,
 *   and puts the answers into the graph as ordinary values: `triage.urgent` is a probability a
 *   guard can compare, `triage.next` is the option that won, `triage.next.confidence` is how sure.
 *
 *   IT CAN MOVE A MACHINE, AND ONLY BY ITS OWN EVENTS. The model cannot design a statechart, but it
 *   can choose which transition one takes when text arrives, because the options are known in
 *   advance: they are the machine's own events. With `machine` and `event`, the question named by
 *   `event` is offered only the events the machine accepts in the state it is in NOW (plus any option
 *   that is not an event at all, such as "NONE"), and a winner at or above its threshold is sent to
 *   the machine. A winner BELOW the threshold is not sent: the node's value becomes "person", the
 *   proposal waits in `pending`, and a person decides on the drawn row. The model never moves a
 *   machine on a guess.
 *
 *   IT ASKS WHEN ITS INPUT CHANGES, AND AT NO OTHER TIME. Not on mount, not on a recompute, not on a
 *   language change: the runtime (decide-run.js) watches the input's changes, waits until the text
 *   has stopped moving for `wait` milliseconds, and asks only when the text differs from what it
 *   last asked about. Everything that talks to the network is in that runtime; this module is the
 *   node's shape, its refusals and its outputs.
 *
 *   IT NEVER INVENTS AN ANSWER. Before the first answer, and whenever the model is not available for
 *   this person, every answer field is empty and the value says why: "unavailable" with the reason
 *   in words in `reason`. A formula that reads an empty answer gets an empty answer.
 *
 *   ENGLISH, AND THE BUILDER'S DUTY. Questions and option meanings are written in English whatever
 *   language the document is read in, so they are never a language map; validate() refuses one.
 *   `gates` says in English what the answer decides and is recorded with every decision, together
 *   with the thresholds in force. The page must load aimeat-decide.js, and the app must declare
 *   TypeSafe in its data map and ask for ai:use, or the node refuses the call and the row says so.
 *
 * @node       decide    Asks the decision model closed questions about a text and exposes the answers; can move a machine by its own events.
 * @inputs     decide    input (the node id whose text is judged, or a list of ids sent as named fields) · names (node ids or strings: the people the text may mention, removed before it leaves)
 * @outputs    decide    value — "" before the first answer, then asking · moved · stayed · person · unavailable · failed · <question id> — the answer: a probability for yesNo, the option name for pickOne, the level for scale ("" until answered) · <question id>.confidence · <question id>.passed · pending — the event waiting for a person · reason — why it did not ask, in words · decision — the recorded decision id
 * @options    decide    questions { id: { yesNo, meaning? } | { pickOne, options } | { scale, levels } } (English) · thresholds { id: 0..1 } (the event question needs one) · gates (English: what the answer decides; required) · machine (a machine id) · event (the pickOne question whose options are that machine's events) · wait (ms the text must rest before asking; default 1500, floor 300) · subject · label · block (a section to draw it in)
 * @languages  decide    label
 * @example    decide    { "type": "decide", "input": "message", "machine": "ticket", "event": "next", "gates": "which step the support ticket takes next", "questions": { "next": { "pickOne": "Which step does this customer message call for?", "options": { "URGENT": "The customer cannot work at all or loses money now.", "RESOLVE": "The customer says the problem is solved.", "NONE": "None of the steps above." } }, "angry": { "yesNo": "The customer is angry or threatens to leave." } }, "thresholds": { "next": 0.7, "angry": 0.8 }, "label": { "fi": "Viestin arvio", "en": "Reading the message" }, "block": "judge" }
 * @structure decideNode: the node-type module (dependsOn · prepare · evaluate · coerce · fields) ·
 *   inputsOf · questionsOf · eventsAccepted · WAIT_FLOOR · WAIT_DEFAULT
 * @usage  import { decideNode } from './decide.js';
 * @version-history
 *   v0.8.0 — 2026-09-19 — Initial (living 0.8.0): a judgement about text moves a statechart.
 */
import { isPlainObject } from '../i18n.js';

/** The shortest rest a text must have before it is asked about. A keystroke is not a message. */
export const WAIT_FLOOR = 300;
/** The rest used when the record names none: long enough for a person to finish pasting. */
export const WAIT_DEFAULT = 1500;

/** The node ids a decide node judges, in one shape whatever the record wrote. */
export function inputsOf(node) {
  const input = node && node.input;
  if (typeof input === 'string' && input) return [input];
  if (Array.isArray(input)) return input.map(String).filter(Boolean);
  return [];
}

/** The `names` entries that are node ids of this document, so the graph works them out first. */
function nameNodes(node, nodes) {
  const out = [];
  for (const n of Array.isArray(node && node.names) ? node.names : []) {
    if (Object.prototype.hasOwnProperty.call(nodes || {}, String(n))) out.push(String(n));
  }
  return out;
}

/**
 * The record's questions in AIMEAT.decide's own shapes. `{ yesNo }` becomes a noul question,
 * `{ pickOne, options }` a choice, `{ scale, levels }` a score. Anything else is refused by prepare.
 * @param {any} node
 * @returns {Record<string, { type: string, instructions: string, criteria?: any }>}
 */
export function questionsOf(node) {
  /** @type {Record<string, { type: string, instructions: string, criteria?: any }>} */
  const out = {};
  const qs = (node && node.questions) || {};
  for (const id of Object.keys(qs)) {
    const q = qs[id] || {};
    if (typeof q.yesNo === 'string') {
      const one = { type: 'noul', instructions: q.yesNo };
      if (q.meaning && (q.meaning.yes !== undefined || q.meaning.no !== undefined)) {
        one.criteria = {};
        if (q.meaning.yes !== undefined) one.criteria.true = q.meaning.yes;
        if (q.meaning.no !== undefined) one.criteria.false = q.meaning.no;
      }
      out[id] = one;
    } else if (typeof q.pickOne === 'string') {
      const options = Array.isArray(q.options)
        ? Object.fromEntries(q.options.map(function (o) { return [String(o), null]; }))
        : (q.options || {});
      out[id] = { type: 'choice', instructions: q.pickOne, criteria: options };
    } else if (typeof q.scale === 'string') {
      out[id] = { type: 'score', instructions: q.scale, criteria: Array.isArray(q.levels) ? q.levels : [] };
    }
  }
  return out;
}

/** The state definition at a dotted path, or null. */
function stateAt(def, path) {
  let states = def && def.states;
  let at = null;
  for (const name of path) {
    if (!states || !states[name]) return null;
    at = states[name];
    states = at.states;
  }
  return at;
}

/** Every event name any state of a machine handles. */
export function eventsOf(def) {
  const out = [];
  const walk = function (states) {
    for (const name of Object.keys(states || {})) {
      const s = states[name] || {};
      for (const e of Object.keys(s.on || {})) if (out.indexOf(e) < 0) out.push(e);
      if (s.states) walk(s.states);
    }
  };
  walk(def && def.states);
  return out;
}

/**
 * The events a machine accepts in the state it is in now: the handlers on the active path, from the
 * deepest state outward, the order the interpreter looks in. A guard is not evaluated here; a
 * guarded event is still one the model may propose, and the machine refuses it if the guard does.
 * @param {any} def @param {string} path  the machine's current state as a dotted path
 * @returns {string[]}
 */
export function eventsAccepted(def, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  const out = [];
  for (let depth = parts.length; depth >= 1; depth--) {
    const s = stateAt(def, parts.slice(0, depth));
    for (const e of Object.keys((s && s.on) || {})) if (out.indexOf(e) < 0) out.push(e);
  }
  return out;
}

/** An empty answer for every question: what the node says before anything is known. */
function blank(node) {
  const out = {};
  for (const id of Object.keys((node && node.questions) || {})) {
    out[id] = '';
    out[id + '.confidence'] = '';
    out[id + '.passed'] = '';
  }
  return out;
}

/** Whether a string-bearing field was written as a language map, which a question must not be. */
function isMap(v) { return isPlainObject(v); }

export const decideNode = {
  id: 'decide',
  settable: true,

  /** It stands on the text it judges and on the names it removes. Not on the machine it moves:
   *  that machine's guards may read this node, and an edge both ways would be a circle. */
  dependsOn(node, ctx) {
    const nodes = (((ctx && ctx.doc) || {}).model || {}).nodes || {};
    const out = inputsOf(node).slice();
    for (const id of nameNodes(node, nodes)) if (out.indexOf(id) < 0) out.push(id);
    return out;
  },

  prepare(node, ctx) {
    const errors = [];
    const nodes = ((ctx.doc || {}).model || {}).nodes || {};
    if (!inputsOf(node).length) errors.push('a decide node with no input; `input` is the id of the node whose text is judged');
    if (typeof node.gates !== 'string' || !node.gates.trim()) {
      errors.push('a decide node with no `gates`; say in English what the answer decides, because it is recorded with every decision');
    }
    const qs = node.questions;
    if (!qs || typeof qs !== 'object' || !Object.keys(qs).length) {
      errors.push('a decide node with no questions');
    } else {
      for (const id of Object.keys(qs)) {
        const q = qs[id] || {};
        if (id.indexOf('.') >= 0) errors.push('a question id "' + id + '" with a dot in it; the dot is how an answer\'s confidence is read');
        const text = q.yesNo !== undefined ? q.yesNo : (q.pickOne !== undefined ? q.pickOne : q.scale);
        if (isMap(text) || (isMap(q.options) && Object.values(q.options).some(isMap))) {
          errors.push('question "' + id + '" written as a language map; the decision model is asked in English, whatever language the document is read in');
        } else if (typeof q.yesNo === 'string') {
          // fine
        } else if (typeof q.pickOne === 'string') {
          const n = Array.isArray(q.options) ? q.options.length : Object.keys(q.options || {}).length;
          if (n < 2) errors.push('question "' + id + '", a pickOne with fewer than two options');
        } else if (typeof q.scale === 'string') {
          const n = Array.isArray(q.levels) ? q.levels.length : 0;
          if (n < 2 || n > 10) errors.push('question "' + id + '", a scale that needs 2 to 10 levels, lowest first');
        } else {
          errors.push('question "' + id + '", which is none of { yesNo }, { pickOne, options }, { scale, levels }');
        }
      }
    }
    for (const [id, t] of Object.entries(node.thresholds || {})) {
      if (!qs || !Object.prototype.hasOwnProperty.call(qs, id)) errors.push('a threshold for "' + id + '", which is not one of its questions');
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0 || n > 1) errors.push('a threshold for "' + id + '" of ' + String(t) + '; a threshold is between 0 and 1');
    }
    if (node.machine != null || node.event != null) {
      const m = nodes[String(node.machine)];
      if (!m) {
        errors.push('a decide node that moves machine "' + String(node.machine) + '", which this document does not have');
      } else if (String(m.type) !== 'machine') {
        errors.push('a decide node that moves "' + String(node.machine) + '", which is a ' + String(m.type) + ' rather than a machine');
      }
      const q = qs && qs[String(node.event)];
      if (!q || typeof q.pickOne !== 'string') {
        errors.push('an `event` of "' + String(node.event) + '"; it names the pickOne question whose options are the machine\'s events');
      } else if (m && String(m.type) === 'machine') {
        const known = eventsOf(m);
        const opts = Array.isArray(q.options) ? q.options.map(String) : Object.keys(q.options || {});
        if (!opts.some(function (o) { return known.indexOf(o) >= 0; })) {
          errors.push('question "' + String(node.event) + '", none of whose options is an event of machine "' + String(node.machine) + '" (' + known.join(', ') + ')');
        }
      }
      if (!node.thresholds || node.thresholds[String(node.event)] == null) {
        errors.push('no threshold for the event question "' + String(node.event) + '"; a machine is moved only above a threshold the record states');
      }
    }
    if (node.wait != null) {
      const w = Number(node.wait);
      if (!Number.isFinite(w) || w < WAIT_FLOOR) errors.push('a wait of ' + String(node.wait) + ' ms; the shortest is ' + WAIT_FLOOR);
    }
    if (!ctx.state.values.has(ctx.id)) ctx.state.values.set(ctx.id, { status: '' });
    return errors;
  },

  /** Its value is the word for where it is: nothing yet, asking, or what the last answer did. */
  evaluate(node, ctx) {
    const s = ctx.state.values.get(ctx.id) || {};
    return String(s.status || '');
  },

  /** What the runtime hands in is the whole last result; it is kept as it came. */
  coerce(node, ctx, raw) {
    if (raw == null || typeof raw !== 'object') return { status: '' };
    return raw;
  },

  /** The answers, flattened so `triage.urgent` and `triage.next.confidence` read like any field. */
  fields(node, ctx) {
    const s = ctx.state.values.get(ctx.id) || {};
    const out = blank(node);
    const answers = s.answers || {};
    for (const id of Object.keys(answers)) {
      const a = answers[id] || {};
      out[id] = a.value == null ? '' : a.value;
      out[id + '.confidence'] = typeof a.confidence === 'number' ? a.confidence : '';
      if (s.passed && Object.prototype.hasOwnProperty.call(s.passed, id)) out[id + '.passed'] = !!s.passed[id];
    }
    out.pending = String(s.pending || '');
    out.reason = String(s.reason || '');
    out.decision = String(s.decision || '');
    return out;
  },
};
