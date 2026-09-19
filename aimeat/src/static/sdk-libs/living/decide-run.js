/**
 * @file living/decide-run.js
 * @description THE HALF OF A DECIDE NODE THAT TALKS TO THE MODEL. The node type (nodes/decide.js)
 *   is the shape and the outputs; this runtime decides WHEN to ask, asks through AIMEAT.decide, and
 *   turns the answer into graph operations: the answers into the node, and a sure enough event into
 *   the machine.
 *
 *   IT ASKS ON A CHANGE OF TEXT, NEVER ON A RENDER. prime() remembers the text each node stands on
 *   when the document mounts, and mounting asks nothing: a sheet opened twice must not pay twice to
 *   learn what it already showed. after() hears every graph operation's changed list; a node whose
 *   input moved waits until the text has rested for its `wait`, and then asks only if the text
 *   differs from the text it last asked about. A text control reports every keystroke, and a model
 *   asked on each one would be asked about half-words.
 *
 *   THE LATEST TEXT WINS. A question still in flight when newer text arrives is answered into
 *   nothing: its answer would describe a message that is no longer the one on the screen.
 *
 *   IT NEVER INVENTS AN ANSWER. No library on the page, no session, no key, the operator's switch
 *   off: the node's value becomes "unavailable", the reason is written in words, and every answer
 *   stays empty. A refused or failed call is "failed" with the node's own words. The machine does
 *   not move in either case.
 *
 *   BELOW THE THRESHOLD, A PERSON DECIDES. The event question's winner is sent to the machine only
 *   when its confidence reaches the record's threshold. Otherwise the proposal waits in `pending`,
 *   and resolve() is the person's answer: it sends the event they chose (or none) and records their
 *   verdict on the decision with AIMEAT.decide.review(), so the record says who moved the machine.
 *   The same door is open when the model was unavailable or failed: nothing was decided then, so
 *   nothing is reviewed, and the person moves the machine by hand.
 *
 *   ONE SEAM FOR TESTS. `spec.decide()` returns the object to ask; mount() passes the page's own
 *   AIMEAT.decide unless the host hands in another, which is how the unit tests run the real code
 *   with no node, no key and no network.
 * @structure createDecisions(spec) → { prime, after, ask, resolve, list, destroy }
 * @usage
 *   const judge = createDecisions({ doc, graph, langs, decide: () => AIMEAT.decide, onResult });
 *   judge.prime();
 *   judge.after(graph.set('message', text));
 * @version-history
 *   v0.8.0 — 2026-09-19 — Initial (living 0.8.0).
 */
import { inputsOf, questionsOf, eventsOf, eventsAccepted, WAIT_DEFAULT, WAIT_FLOOR } from './nodes/decide.js';
import { asText, isQuantity } from './formula-eval.js';
import { sayDecide } from './decide-words.js';

/** How many decisions a mount remembers for its log. */
const LOG_SIZE = 50;

/**
 * @param {{ doc: any, graph: any, langs?: () => string[], decide?: () => any,
 *   onResult?: (out: { changed: string[], transitions?: any[] }) => void,
 *   onDecision?: (entry: any) => void,
 *   timers?: { set: (fn: () => void, ms: number) => any, clear: (h: any) => void },
 *   now?: () => number }} spec
 */
export function createDecisions(spec) {
  const doc = spec.doc || {};
  const graph = spec.graph;
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const api = typeof spec.decide === 'function' ? spec.decide : function () { return null; };
  const timers = spec.timers || {
    set: function (fn, ms) { return setTimeout(fn, ms); },
    clear: function (h) { clearTimeout(h); },
  };
  const now = spec.now || function () { return Date.now(); };
  const nodes = (doc.model || {}).nodes || {};
  const ids = Object.keys(nodes).filter(function (id) { return String((nodes[id] || {}).type) === 'decide'; });

  /** The text each node last asked about (or found on mount). */
  const last = new Map();
  /** A pending rest timer per node. */
  const waiting = new Map();
  /** Which ask is the newest per node; an older answer is dropped. */
  const seq = new Map();
  /** The last result each node holds, whole, so a person's answer keeps the model's answers beside it. */
  const results = new Map();
  const log = [];
  let destroyed = false;

  /** What one node would send: the text, or named fields when it reads several nodes. */
  function stateOf(node) {
    const list = inputsOf(node);
    const read = function (id) {
      const v = graph.valueOf(id);
      return isQuantity(v) ? asText(v) : (v == null ? '' : (typeof v === 'object' ? asText(v) : v));
    };
    if (list.length === 1) return String(read(list[0]));
    const out = {};
    for (const id of list) out[id] = read(id);
    return out;
  }
  function keyOf(state) { return typeof state === 'string' ? state : JSON.stringify(state); }
  function isEmpty(state) {
    if (typeof state === 'string') return !state.trim();
    return Object.keys(state).every(function (k) { return !String(state[k] == null ? '' : state[k]).trim(); });
  }

  /** The people the text may mention: node values, or strings the record wrote. */
  function namesOf(node) {
    const out = [];
    for (const n of Array.isArray(node.names) ? node.names : []) {
      const v = Object.prototype.hasOwnProperty.call(nodes, String(n)) ? asText(graph.valueOf(String(n))) : String(n);
      if (v && v.trim()) out.push(v.trim());
    }
    return out;
  }

  /** Hand one graph operation to the host, with the node itself counted as changed. */
  function report(id, out) {
    const changed = (out && out.changed) ? out.changed.slice() : [];
    if (changed.indexOf(id) < 0) changed.unshift(id);
    const result = { changed: changed, transitions: (out && out.transitions) || [] };
    if (spec.onResult) spec.onResult(result);
    return result;
  }

  /** Merge two operations' answers into one, in order. */
  function merge(a, b) {
    const changed = (a.changed || []).slice();
    for (const c of (b.changed || [])) if (changed.indexOf(c) < 0) changed.push(c);
    return { changed: changed, transitions: (a.transitions || []).concat(b.transitions || []) };
  }

  function remember(entry) {
    log.push(entry);
    while (log.length > LOG_SIZE) log.shift();
    if (spec.onDecision) { try { spec.onDecision(entry); } catch { /* a listener's own fault */ } }
  }

  /** The machine this node moves, and what it accepts right now. */
  function machineOf(node) {
    if (!node.machine || !node.event) return null;
    const def = nodes[String(node.machine)];
    if (!def || String(def.type) !== 'machine') return null;
    const path = String(graph.valueOf(String(node.machine)) || '');
    return { id: String(node.machine), def: def, path: path, accepted: eventsAccepted(def, path), all: eventsOf(def) };
  }

  /**
   * Ask about the text the node stands on now. `force` asks even when the text is the one already
   * asked about (a person pressing "ask again", or a host calling d.decide(id)).
   * @param {string} id @param {boolean} [force]
   */
  async function ask(id, force) {
    if (destroyed) return null;
    const node = nodes[id];
    if (!node) return null;
    const state = stateOf(node);
    const key = keyOf(state);
    if (!force && last.get(id) === key) return null;
    last.set(id, key);
    if (isEmpty(state)) return null;
    const mine = (seq.get(id) || 0) + 1;
    seq.set(id, mine);
    const stale = function () { return destroyed || seq.get(id) !== mine; };

    const lib = api();
    if (!lib || typeof lib.ask !== 'function') {
      return settle(id, { status: 'unavailable', reason: sayDecide('noLib', langs()) }, null, 'unavailable');
    }
    let available = true;
    if (typeof lib.isAvailable === 'function') {
      try { available = !!(await lib.isAvailable()); } catch { available = false; }
    }
    if (stale()) return null;
    if (!available) {
      const why = typeof lib.unavailableReason === 'function' ? lib.unavailableReason() : null;
      return settle(id, { status: 'unavailable', reason: String(why || sayDecide('unavailable', langs())) }, null, 'unavailable');
    }

    const questions = questionsOf(node);
    const m = machineOf(node);
    let offered = null;
    if (m) {
      const q = questions[String(node.event)];
      if (q) {
        const keep = {};
        for (const opt of Object.keys(q.criteria || {})) {
          // An option that IS an event of this machine is offered only when the state it is in
          // takes it; an option that is no event at all (NONE, "none of these") always stays.
          if (m.accepted.indexOf(opt) >= 0 || m.all.indexOf(opt) < 0) keep[opt] = q.criteria[opt];
        }
        offered = Object.keys(keep);
        if (offered.length >= 2) questions[String(node.event)] = { type: 'choice', instructions: q.instructions, criteria: keep };
        else delete questions[String(node.event)];
      }
    }
    const thresholds = {};
    for (const [q, t] of Object.entries(node.thresholds || {})) if (questions[q]) thresholds[q] = Number(t);

    report(id, graph.set(id, { status: 'asking' }));
    let r;
    try {
      r = await lib.ask(state, questions, {
        gates: String(node.gates || ''),
        thresholds: thresholds,
        subject: node.subject ? String(node.subject) : (doc.key ? String(doc.key) + '#' + id : undefined),
        names: namesOf(node),
      });
    } catch (e) {
      if (stale()) return null;
      const words = (e && /** @type {any} */ (e).message) || String(e);
      return settle(id, { status: 'failed', reason: words }, null, 'failed');
    }
    if (stale()) return null;

    const answers = (r && r.answers) || {};
    const passed = {};
    for (const [q, t] of Object.entries(thresholds)) {
      const a = answers[q];
      if (!a) continue;
      const v = a.type === 'choice' ? (a.confidence == null ? 0 : a.confidence) : Number(a.value);
      passed[q] = v >= t;
    }
    const base = { answers: answers, passed: passed, decision: (r && r.decision_id) || '', offered: offered || [] };

    if (!m || !answers[String(node.event)]) {
      return settle(id, Object.assign({ status: 'decided' }, base), null, 'decided');
    }
    const winner = String(answers[String(node.event)].value || '');
    if (!passed[String(node.event)]) {
      return settle(id, Object.assign({ status: 'person', pending: winner }, base), null, 'person');
    }
    if (m.accepted.indexOf(winner) < 0) {
      return settle(id, Object.assign({ status: 'stayed' }, base), null, 'stayed');
    }
    return settle(id, Object.assign({ status: 'moved', event: winner, by: 'model' }, base), winner, 'moved');
  }

  /**
   * Put a result into the node, then — when there is one — send the event. The answers land FIRST
   * so a guard on the transition can read them, and one report carries both operations.
   */
  function settle(id, result, event, outcome) {
    const node = nodes[id] || {};
    results.set(id, result);
    let out = graph.set(id, result);
    if (event) {
      const moved = graph.send(event);
      if (!moved.transitions || !moved.transitions.length) {
        // A guard refused the move. The machine had the last word; the node says so.
        const kept = Object.assign({}, result, { status: 'stayed', event: '' });
        results.set(id, kept);
        out = merge(out, graph.set(id, kept));
        outcome = 'stayed';
      }
      out = merge(out, moved);
    }
    remember({
      node: id, at: new Date(now()).toISOString(), outcome: outcome, by: 'model',
      decision: result.decision || '', event: event || '', pending: result.pending || '',
      gates: String(node.gates || ''), thresholds: Object.assign({}, node.thresholds || {}),
      offered: result.offered || [], reason: result.reason || '',
      answers: summary(result.answers),
    });
    return report(id, out);
  }

  /** The answers as a log reads them: the value and the confidence, no probability tables. */
  function summary(answers) {
    const out = {};
    for (const [q, a] of Object.entries(answers || {})) {
      out[q] = { value: a && a.value, confidence: a && typeof a.confidence === 'number' ? a.confidence : undefined };
    }
    return out;
  }

  /**
   * A PERSON'S ANSWER to a proposal that was not sure enough. `choice` is the event they send, or
   * empty to keep the state. The verdict is recorded on the decision: "confirmed" when they took
   * what the model proposed, "overridden" otherwise.
   * @param {string} id @param {string} [choice]
   */
  function resolve(id, choice) {
    const node = nodes[id];
    if (!node || destroyed) return null;
    const s = graph.fieldsOf(id) || {};
    // A person answers a proposal under the threshold, and also stands in when the model could not
    // be asked or failed: the machine still has to be movable by somebody.
    if (['person', 'unavailable', 'failed'].indexOf(String(graph.valueOf(id))) < 0) return null;
    const pending = String(s.pending || '');
    const pick = String(choice || '');
    const m = machineOf(node);
    const sendable = !!(m && pick && m.accepted.indexOf(pick) >= 0);
    const next = Object.assign({}, results.get(id) || {}, { status: sendable ? 'moved' : 'stayed', pending: '', event: sendable ? pick : '', by: 'person' });
    results.set(id, next);
    let out = graph.set(id, next);
    if (sendable) out = merge(out, graph.send(pick));
    const lib = api();
    const decision = String(s.decision || '');
    if (decision && lib && typeof lib.review === 'function') {
      const confirmed = pick === pending;
      Promise.resolve(lib.review(decision, confirmed ? 'confirmed' : 'overridden', confirmed ? {} : { override: pick || 'NONE' }))
        .catch(function () { /* the move stands; the review is the record's, and the node logs a failed write itself */ });
    }
    remember({
      node: id, at: new Date(now()).toISOString(), outcome: sendable ? 'moved' : 'stayed', by: 'person',
      decision: decision, event: sendable ? pick : '', pending: pending,
      gates: String(node.gates || ''), thresholds: Object.assign({}, node.thresholds || {}),
      offered: [], reason: '', answers: {},
    });
    return report(id, out);
  }

  return {
    /** Remember the text each node stands on now. Mounting is not a change, so nothing is asked. */
    prime() {
      for (const id of ids) last.set(id, keyOf(stateOf(nodes[id])));
    },

    /** Hear one graph operation; a node whose input moved waits for the text to rest, then asks. */
    after(out) {
      if (destroyed || !out || !out.changed || !out.changed.length) return;
      for (const id of ids) {
        const node = nodes[id];
        const reads = inputsOf(node);
        if (!reads.some(function (r) { return out.changed.indexOf(r) >= 0; })) continue;
        if (waiting.has(id)) timers.clear(waiting.get(id));
        const wait = Math.max(WAIT_FLOOR, Number(node.wait) || WAIT_DEFAULT);
        waiting.set(id, timers.set(function () { waiting.delete(id); ask(id, false); }, wait));
      }
    },

    ask: ask,
    resolve: resolve,

    /** The last fifty decisions this mount made or a person made, oldest first. */
    list() { return log.slice(); },

    destroy() {
      destroyed = true;
      for (const [, h] of waiting) timers.clear(h);
      waiting.clear();
    },
  };
}
