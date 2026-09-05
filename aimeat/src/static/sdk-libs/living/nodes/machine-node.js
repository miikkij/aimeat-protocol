/**
 * @file living/nodes/machine-node.js
 * @description THE DOCUMENT'S OWN STATE, as a node the rest of the graph can read. Its output is
 *   the current state as a dotted path, so a formula asks if(state = "hot", …) and a template
 *   changes with it, and nothing else has to know a statechart is under there.
 *
 *   EVENTS COME FROM TWO PLACES AND NOWHERE ELSE. A crossing — a { expr, send } pair that fires
 *   once when its condition BECOMES true — and living.send(event) from a control or the host. A
 *   guard can then refuse the transition, which is how "only cool down once we are actually under
 *   the threshold" is written without a second flag.
 *
 *   ENTRY AND EXIT ASSIGN TO VALUE NODES, so arriving somewhere can put a word on the screen or
 *   reset a counter; those assignments make the machine a WRITER, and the graph orders it before
 *   the values it writes. The interpreter itself is machine.js and it decides without touching
 *   anything — this module is only the wiring.
 *
 * @node     machine   A statechart in XState's vocabulary; its output is the state it is in.
 * @inputs   machine   initial · states (nested allowed) · when (crossings that send events)
 * @outputs  machine   value — the current state as a dotted path, e.g. "hot" or "hot.rising"
 * @options  machine   on { EVENT: { target, guard } } · entry · exit · after { ms: target } · block (a section to show it in)
 * @example  machine   { "type": "machine", "initial": "fine", "states": { "cold": { "on": { "WARM": "fine" } }, "fine": { "on": { "HOT": "hot", "COLD": "cold" } }, "hot": { "entry": { "note": "\"jäähdytä\"" }, "on": { "COOL": { "target": "fine", "guard": "t < 30" } } } }, "when": [{ "expr": "t > 30", "send": "HOT" }, { "expr": "t < 30", "send": "COOL" }, { "expr": "t < 5", "send": "COLD" }] }
 * @structure machineNode: the node-type module (dependsOn · prepare · evaluate)
 * @usage  import { machineNode } from './machine-node.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { createMachine } from '../machine.js';
import { symbolsOf } from '../formula-parse.js';
import { parse } from '../formula-parse.js';
import { isError } from '../formula-eval.js';

/** Every node id a machine's guards, crossings and assignments read or write. */
function referenced(node) {
  const out = [];
  const add = (src) => {
    const tree = parse(String(src));
    if (!isError(tree)) for (const s of symbolsOf(tree)) if (out.indexOf(s.split('.')[0]) < 0) out.push(s.split('.')[0]);
  };
  const walk = (states) => {
    for (const name of Object.keys(states || {})) {
      const s = states[name] || {};
      for (const event of Object.keys(s.on || {})) {
        const h = s.on[event];
        if (h && typeof h === 'object' && h.guard) add(h.guard);
      }
      for (const map of [s.entry, s.exit]) {
        for (const id of Object.keys(map || {})) add(map[id]);
      }
      if (s.states) walk(s.states);
    }
  };
  walk(node.states);
  for (const w of (node.when || [])) add(w.expr);
  return out;
}

/** Every value node a machine's entry or exit action writes to. */
export function writesOf(node) {
  const out = [];
  const walk = (states) => {
    for (const name of Object.keys(states || {})) {
      const s = states[name] || {};
      for (const map of [s.entry, s.exit]) {
        for (const id of Object.keys(map || {})) if (out.indexOf(id) < 0) out.push(id);
      }
      if (s.states) walk(s.states);
    }
  };
  walk(node.states);
  return out;
}

export const machineNode = {
  id: 'machine',

  /** A machine reads what its guards and crossings read. What it WRITES is an edge the graph
   *  adds in the other direction, so the machine is recomputed before the values it assigns. */
  dependsOn(node) { return referenced(node); },

  prepare(node, ctx) {
    if (!ctx.state.machines.has(ctx.id)) ctx.state.machines.set(ctx.id, createMachine(node));
    const m = ctx.state.machines.get(ctx.id);
    ctx.compiled.machine = m;
    return m.errors.slice();
  },

  evaluate(node, ctx) {
    const m = ctx.state.machines.get(ctx.id);
    return m ? m.path() : '';
  },
};
