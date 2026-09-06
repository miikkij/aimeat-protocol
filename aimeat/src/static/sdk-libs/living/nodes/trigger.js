/**
 * @file living/nodes/trigger.js
 * @description THE DOCUMENT TELLS SOMEBODY. Every other node in this library moves inward: a value
 *   is set, formulas follow, the screen catches up. A trigger is the one that moves outward — when
 *   a machine actually TRANSITIONS, one message leaves the browser carrying the whole state of the
 *   document, and a receiver on the far side can act on it without knowing anything about this
 *   library or this page.
 *
 *   IT WATCHES A TRANSITION, NOT A RECOMPUTE. `on: "phase"` is a machine id, and a machine that
 *   sits in the state it reached says nothing however many times the graph is worked out. That is
 *   the whole difference between a hook worth having and a receiver drowned in identical messages,
 *   and it is why the trigger reads the graph's `transitions` rather than its `changed`.
 *   `on: { node, when }` is the other door: an expression that turns true, for a document whose
 *   crossing is not worth a statechart of its own.
 *
 *   THE MESSAGE CARRIES EVERYTHING, on purpose. document · at · transition · values · machines ·
 *   trigger. A receiver that has the whole state can decide what to do with one message; a receiver
 *   handed only "it went to exporting" has to ask, and there is nobody here to ask. `include` is
 *   the way to narrow it, and naming a node there also sends its ROW whole rather than abbreviated.
 *
 *   TWO SWITCHES, BOTH THE OWNER'S. The document's own `hooks: { enabled: false }` stops every
 *   trigger at once, and each trigger's `enabled` stops that one. Neither is a substitute for the
 *   node's allowlist, which is what actually decides whether the call may be made.
 *
 *   ITS OUTPUT IS THE TIME IT LAST SPOKE, so a sentence can say "kerrottu viimeksi {{ tell }}" and
 *   the chain shows it downstream of the machine it watches. Before the first delivery it is empty.
 *
 * @node       trigger   When a machine moves, the document tells somebody: a URL, or one of your own agents.
 * @inputs     trigger   on (the machine id it watches, or { node, when } for a crossing that turns true)
 * @outputs    trigger   value — the time of the last delivery, empty before the first
 * @options    trigger   target { kind: "url", url, method, headers } or { kind: "agent", agent } · headers (sent with a url delivery; a value may name a secret of the owner's as {{secret:NAME}}, which the node puts in as the call leaves, so no key is written into the document) · enabled · include ("all", or a list of node ids whose rows then go whole) · label
 * @languages  trigger   label
 * @example    trigger   { "type": "trigger", "on": "phase", "enabled": true, "target": { "kind": "url", "url": "https://example.org/hook", "method": "POST" }, "include": "all", "label": { "fi": "Kerro invertterille", "en": "Tell the inverter" } }
 * @structure trigger: the node-type module (dependsOn · prepare · evaluate · coerce) · watchOf(node)
 * @usage  import { trigger } from './trigger.js';
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */
import { parse, symbolsOf } from '../formula-parse.js';
import { isError } from '../formula-eval.js';

/** The methods a trigger may use on a URL. A GET carries no body, so it is not one of them. */
export const TRIGGER_METHODS = ['POST', 'PUT'];

/**
 * What this trigger watches, in one shape whatever the record wrote: a machine id, or a node with
 * a crossing expression over it.
 * @param {any} node
 * @returns {{ node: string, when: string }}
 */
export function watchOf(node) {
  const on = node && node.on;
  if (typeof on === 'string') return { node: on, when: '' };
  if (on && typeof on === 'object') return { node: String(on.node || ''), when: String(on.when || '') };
  return { node: '', when: '' };
}

/** Every node id a trigger's crossing expression reads, so the graph works them out first. */
function readsOf(when) {
  if (!when) return [];
  const tree = parse(String(when));
  if (isError(tree)) return [];
  const out = [];
  for (const s of symbolsOf(tree)) {
    const head = s.split('.')[0];
    if (out.indexOf(head) < 0) out.push(head);
  }
  return out;
}

export const trigger = {
  id: 'trigger',
  settable: true,

  /** It stands on what it watches, so the chain draws it downstream of the machine. */
  dependsOn(node) {
    const watch = watchOf(node);
    const out = watch.node ? [watch.node] : [];
    for (const id of readsOf(watch.when)) if (out.indexOf(id) < 0) out.push(id);
    return out;
  },

  prepare(node, ctx) {
    const errors = [];
    const nodes = ((ctx.doc || {}).model || {}).nodes || {};
    const watch = watchOf(node);

    if (!watch.node) {
      errors.push('a trigger with no node to watch; `on` is a machine id, or { node, when }');
    } else if (!Object.prototype.hasOwnProperty.call(nodes, watch.node)) {
      // The graph names a missing dependency itself; saying it twice would be two refusals for one
      // mistake.
    } else if (!watch.when && String((nodes[watch.node] || {}).type) !== 'machine') {
      errors.push('a trigger watching "' + watch.node + '", which is a '
        + String((nodes[watch.node] || {}).type) + ' rather than a machine. A trigger fires on a '
        + 'machine\'s transition; to fire on a value crossing, write on: { node, when }');
    }
    if (watch.when) {
      const tree = parse(String(watch.when));
      if (isError(tree)) errors.push('a crossing that cannot be read: ' + tree.error);
    }

    const target = node.target || {};
    const kind = String(target.kind || '');
    if (kind === 'url') {
      if (!target.url) errors.push('a trigger aimed at a url with no url on it');
      const method = String(target.method || 'POST').toUpperCase();
      if (TRIGGER_METHODS.indexOf(method) < 0) {
        errors.push('a trigger sending with "' + method + '"; it may use ' + TRIGGER_METHODS.join(' or '));
      }
    } else if (kind === 'agent') {
      if (!target.agent) errors.push('a trigger aimed at an agent with no agent named on it');
    } else {
      errors.push('a trigger with no target to tell; a target is { kind: "url", url } or { kind: "agent", agent }');
    }

    if (Array.isArray(node.include)) {
      for (const id of node.include) {
        if (!Object.prototype.hasOwnProperty.call(nodes, String(id))) {
          errors.push('an include naming "' + String(id) + '", which this document does not have');
        }
      }
    } else if (node.include != null && String(node.include) !== 'all') {
      errors.push('an include of "' + String(node.include) + '"; it is "all" or a list of node ids');
    }

    if (!ctx.state.values.has(ctx.id)) ctx.state.values.set(ctx.id, '');
    return errors;
  },

  /** Its value is what the delivery runtime last wrote here: the time it spoke. */
  evaluate(node, ctx) { return ctx.state.values.get(ctx.id); },

  coerce(node, ctx, raw) { return raw == null ? '' : String(raw); },
};
