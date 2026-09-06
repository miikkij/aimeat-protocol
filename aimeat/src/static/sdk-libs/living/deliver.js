/**
 * @file living/deliver.js
 * @description WHEN A DOCUMENT TELLS SOMEBODY, AND HOW OFTEN. This is the runtime behind the
 *   trigger node: after every operation the graph performs it is handed the TRANSITIONS that
 *   operation made, works out which triggers those concern, and sends one message per trigger.
 *
 *   ONE MESSAGE PER TRANSITION, NOT PER RECOMPUTE AND NOT PER CROSSING. A slider dragged across a
 *   threshold recomputes sixty times a second and crosses once, and one recompute can hold several
 *   crossings — two machines moving on the same change, or one machine settling through two states.
 *   So a trigger fires at most once per operation, on the LAST transition of its own machine, and
 *   the receiver gets the message it would have wanted rather than three copies of a story told in
 *   instalments.
 *
 *   IT READS THE TRIGGERS OUT OF THE RECORD, NOT OUT OF THE GRAPH. The record is the truth, and the
 *   gear dialog writes into it: a trigger added by hand works on the next crossing rather than on
 *   the next remount. The graph still knows the type, so validate() refuses a bad one and the chain
 *   draws it in the right place.
 *
 *   TWO SWITCHES AND A THIRD THAT IS NOT OURS. The document's `hooks: { enabled: false }` stops
 *   every trigger at once and each trigger's own `enabled` stops that one — both the owner's, both
 *   in the record. The third is the node's allowlist, which is what actually decides whether the
 *   call may be made at all, and no amount of switching here can talk past it.
 * @structure createDeliveries(spec) → { after, test, list, status, destroy }
 * @usage
 *   const deliveries = createDeliveries({ doc, graph, hooks, langs, onDelivery });
 *   await deliveries.after(graph.set('pv', 5));
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { parse } from './formula-parse.js';
import { evaluate, isError } from './formula-eval.js';
import { textOf } from './i18n.js';
import { buildPayload } from './payload.js';
import { watchOf } from './nodes/trigger.js';
import { say, fill } from './hooks-words.js';

/** How many deliveries one mount remembers. Enough to see what happened, small enough to hold. */
export const KEPT = 50;

/** A value as a line of text, for the from/to of a crossing that is not a machine. */
function asLine(v) {
  if (v == null) return '';
  if (typeof v === 'object' && typeof v.n === 'number') return String(v.n);
  if (Array.isArray(v)) return '[' + v.length + ']';
  if (typeof v === 'object') return '';
  return String(v);
}

/** Truth, the way every guard and crossing in this library reads it. */
function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v && typeof v === 'object' && typeof v.n === 'number') return v.n !== 0;
  if (typeof v === 'string') return v !== '';
  return !!v;
}

/**
 * The delivery runtime for one mounted document.
 * @param {{ doc: any, graph: any, hooks: any, langs?: () => string[],
 *   onDelivery?: (e: any) => void, onChanged?: (ids: string[]) => void }} spec
 * @returns {any}
 */
export function createDeliveries(spec) {
  const doc = spec.doc || {};
  const graph = spec.graph;
  const hooks = spec.hooks;
  const langs = typeof spec.langs === 'function' ? spec.langs : function () { return []; };
  const log = [];
  const crossings = new Map();
  const trees = new Map();
  let destroyed = false;

  /** Every trigger the RECORD carries right now, in the order it wrote them. */
  function triggers() {
    const nodes = (doc.model || {}).nodes || {};
    const out = [];
    for (const id of Object.keys(nodes)) {
      const node = nodes[id] || {};
      if (String(node.type) === 'trigger') out.push({ id: id, node: node });
    }
    return out;
  }

  /** The document's master switch. Absent means on: a trigger is already an explicit thing to write. */
  function masterOn() {
    return !(doc.hooks && doc.hooks.enabled === false);
  }

  /** One crossing expression, compiled once. */
  function treeFor(when) {
    if (!trees.has(when)) {
      const tree = parse(String(when));
      trees.set(when, isError(tree) ? null : tree);
    }
    return trees.get(when);
  }

  /**
   * The transition this trigger is looking at in this operation, or null. A machine watch takes
   * the LAST transition of its own machine; a crossing watch is a rising edge on an expression.
   */
  function transitionFor(entry, transitions) {
    const watch = watchOf(entry.node);
    if (!watch.node) return null;
    if (!watch.when) {
      let found = null;
      for (const move of transitions) if (move.node === watch.node) found = move;
      return found;
    }
    const tree = treeFor(watch.when);
    if (!tree) return null;
    const before = crossings.get(entry.id);
    const value = graph.valueOf(watch.node);
    const now = truthy(evaluate(tree, graph.scope));
    crossings.set(entry.id, { on: now, reading: asLine(value) });
    if (!now || (before && before.on)) return null;
    return {
      node: watch.node,
      from: before ? before.reading : '',
      to: asLine(value),
      event: watch.when,
    };
  }

  /** The title a task carries, so an agent's inbox says what happened before it is opened. */
  function taskTitle(transition) {
    const title = String(textOf(doc.title, langs()) || doc.key || '');
    return 'Living document: ' + title + ', ' + transition.from + ' → ' + transition.to;
  }

  /** Send one message and remember what came back. */
  async function deliver(id, node, transition, isTest) {
    const at = new Date().toISOString();
    const body = buildPayload({
      doc: doc, graph: graph, langs: langs, triggerId: id, trigger: node,
      transition: transition, at: at, test: !!isTest,
    });
    const target = node.target || {};
    const answer = String(target.kind) === 'agent'
      ? await hooks.task({
        agent: String(target.agent || ''),
        title: taskTitle(transition),
        description: fill(say('sentence.task', langs()), {
          title: String(textOf(doc.title, langs()) || doc.key || ''),
          from: transition.from, to: transition.to,
        }) + '\n\n' + JSON.stringify(body, null, 2),
        body: body,
      })
      : await hooks.send({
        url: String(target.url || ''), method: String(target.method || 'POST'), body: body,
      });

    const event = {
      trigger: id,
      at: at,
      test: !!isTest,
      ok: !answer.refusal,
      status: Number(answer.status || 0),
      ms: Number(answer.ms || 0),
      refusal: answer.refusal ? hooks.words(answer.refusal) : '',
      transition: transition,
    };
    log.push(event);
    while (log.length > KEPT) log.shift();
    if (spec.onDelivery) spec.onDelivery(event);
    // The trigger's own output is the time it last spoke, so a sentence can say it.
    if (!isTest && event.ok) {
      const out = graph.set(id, at);
      if (spec.onChanged && out.changed.length) spec.onChanged(out.changed);
    }
    return event;
  }

  return {
    /**
     * Everything one graph operation set off. Handed the operation's own result, so the
     * transitions are the ones it actually made rather than a guess from the changed list.
     * @param {{ changed?: string[], transitions?: any[] }} result
     * @returns {Promise<any[]>}
     */
    async after(result) {
      if (destroyed) return [];
      const transitions = (result && result.transitions) || [];
      const out = [];
      for (const entry of triggers()) {
        if (entry.node.enabled === false || !masterOn()) {
          // The switches are still read on a crossing watch, so its edge is not remembered as
          // having fired while the trigger was off.
          continue;
        }
        const transition = transitionFor(entry, transitions);
        if (!transition) continue;
        out.push(await deliver(entry.id, entry.node, transition, false));
      }
      return out;
    },

    /**
     * A sample message, marked as one. It goes even when the switches are off, because that is
     * what a person pressing "test send" is asking for; the node's allowlist still decides.
     * @param {string} triggerId
     */
    async test(triggerId) {
      const nodes = (doc.model || {}).nodes || {};
      const node = nodes[String(triggerId)];
      if (!node || String(node.type) !== 'trigger') {
        return { trigger: String(triggerId), ok: false, status: 0, ms: 0, refusal: 'No trigger by that name.' };
      }
      const watch = watchOf(node);
      const state = String(graph.valueOf(watch.node) || '');
      return deliver(String(triggerId), node, {
        node: watch.node, from: state, to: state, event: watch.when || 'TEST',
      }, true);
    },

    /**
     * REMEMBER WHERE THE CROSSINGS STAND, WITHOUT TELLING ANYBODY. Mounting is not a change: a
     * page opened twice must not send two messages saying nothing happened. So the crossing
     * expressions are evaluated once on the state as found, and the first rising edge that counts
     * is the first one a person or a reading actually causes.
     */
    prime() {
      for (const entry of triggers()) {
        const watch = watchOf(entry.node);
        if (!watch.when) continue;
        const tree = treeFor(watch.when);
        if (!tree) continue;
        crossings.set(entry.id, {
          on: truthy(evaluate(tree, graph.scope)),
          reading: asLine(graph.valueOf(watch.node)),
        });
      }
    },

    /** The deliveries this mount has made, oldest first. */
    list() { return log.slice(); },

    /** Whether this page can tell anybody anything, and why not when it cannot. */
    status() {
      const from = hooks.status();
      return {
        signedIn: from.signedIn,
        enabled: masterOn(),
        reason: from.signedIn ? '' : from.reason,
        triggers: triggers().map(function (e) { return e.id; }),
      };
    },

    destroy() { destroyed = true; },
  };
}
