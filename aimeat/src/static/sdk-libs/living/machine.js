/**
 * @file living/machine.js
 * @description THE STATECHART UNDERNEATH THE DOCUMENT. A document that only computes is a
 *   calculator; a document that KNOWS WHERE IT IS can say different things, show different
 *   controls and take different actions in each place, and that is what turns a screen of numbers
 *   into something a person works with. So one node type is a statechart, and its output — the
 *   current state, as a dotted path — is read by formulas and templates like any other value.
 *
 *   XSTATE'S VOCABULARY, OUR INTERPRETER. initial, states (nested), on with a target and a guard,
 *   entry, exit and after are the words a model already knows how to write, so an AI writes a
 *   correct machine on the first try instead of learning a private dialect. Taking the LIBRARY
 *   would be a different decision: xstate is a dependency, a bundle and a version to track, for
 *   three hundred lines of behaviour that has to be wired into our own recompute anyway.
 *
 *   A GUARD IS A FORMULA AND AN ENTRY ACTION IS AN ASSIGNMENT — both in the same expression
 *   language as the rest of the document, so there is one thing to learn rather than two.
 *
 *   IT DECIDES; IT DOES NOT WRITE. send() and tick() return the assignments they want made and
 *   the engine makes them, which is what keeps the recompute in one place and this file testable
 *   without a graph, a DOM or a clock.
 *
 *   EVENTS ARRIVE FROM A CROSSING. crossings() evaluates each { expr, send } and reports the ones
 *   that just BECAME true — a rising edge, not a level — so "t > 30" sends HOT once when the
 *   temperature goes over, not on every recompute while it stays there.
 * @structure createMachine(def) → { path, send, tick, crossings, nextDue, reset, errors }
 * @usage
 *   import { createMachine } from './machine.js';
 *   const m = createMachine({ initial: 'fine', states: { fine: { on: { HOT: 'hot' } }, hot: {} } });
 *   m.send('HOT', scope);   // { changed: true, path: 'hot', assigns: [] }
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parse } from './formula-parse.js';
import { evaluate, isError } from './formula-eval.js';

/** Parse every expression in a definition once, collecting the refusals rather than throwing. */
function compile(def, errors) {
  const guards = new Map();
  const assigns = new Map();
  const whens = [];

  function expr(src, where) {
    const tree = parse(src);
    if (isError(tree)) { errors.push(where + ': ' + tree.error); return null; }
    return tree;
  }

  function walkAssign(map, where, key) {
    if (!map || typeof map !== 'object') return;
    const list = [];
    for (const id of Object.keys(map)) {
      const tree = expr(String(map[id]), where + ' sets ' + id);
      if (tree) list.push({ id: id, tree: tree });
    }
    assigns.set(key, list);
  }

  function walk(states, prefix) {
    if (!states || typeof states !== 'object') return;
    for (const name of Object.keys(states)) {
      const node = states[name] || {};
      const path = prefix ? prefix + '.' + name : name;
      walkAssign(node.entry, 'entry of ' + path, 'entry:' + path);
      walkAssign(node.exit, 'exit of ' + path, 'exit:' + path);
      const on = node.on || {};
      for (const event of Object.keys(on)) {
        const h = on[event];
        if (h && typeof h === 'object' && h.guard) {
          const tree = expr(String(h.guard), 'the guard on ' + path + ' → ' + event);
          if (tree) guards.set(path + '|' + event, tree);
        }
      }
      if (node.states) walk(node.states, path);
    }
  }

  walk(def.states, '');
  for (const w of (def.when || [])) {
    const tree = expr(String(w.expr), 'the crossing that sends ' + w.send);
    if (tree) whens.push({ tree: tree, send: String(w.send), was: false });
  }
  return { guards: guards, assigns: assigns, whens: whens };
}

/** The state object at a dotted path. */
function stateAt(def, path) {
  let node = def;
  for (const part of path) {
    const kids = node.states || {};
    if (!kids[part]) return null;
    node = kids[part];
  }
  return node;
}

/** Descend into each state's initial child until the leaf. */
function settleInto(def, path) {
  const out = path.slice();
  for (;;) {
    const node = stateAt(def, out);
    if (!node || !node.states || !node.initial) return out;
    if (!node.states[node.initial]) return out;
    out.push(node.initial);
  }
}

/**
 * The machine.
 * @param {{ initial?: string, states?: object, when?: Array<{ expr: string, send: string }> }} def
 * @returns {{ path: () => string, states: () => string[], send: (event: string, scope: any) => any,
 *   tick: (now: number) => any, crossings: (scope: any) => string[], nextDue: (now: number) => number|null,
 *   reset: () => void, errors: string[] }}
 */
export function createMachine(def) {
  const errors = [];
  const model = def && typeof def === 'object' ? def : {};
  if (!model.states || typeof model.states !== 'object' || !Object.keys(model.states).length) {
    errors.push('a machine with no states');
  } else if (!model.initial || !model.states[model.initial]) {
    errors.push('a machine whose initial state "' + String(model.initial) + '" is not one of its states');
  }
  const compiled = compile(model, errors);

  let active = errors.length ? [] : settleInto(model, [model.initial]);
  /** When each active state was entered, so `after` knows how long it has been there. */
  let enteredAt = new Map();

  function markEntered(path, now) {
    for (let i = 1; i <= path.length; i++) {
      const key = path.slice(0, i).join('.');
      if (!enteredAt.has(key)) enteredAt.set(key, now);
    }
  }
  markEntered(active, 0);

  function assignsFor(kind, path) { return compiled.assigns.get(kind + ':' + path) || []; }

  /** Exit down to depth `keep`, enter the target path, and collect what has to be assigned. */
  function move(target, keep, now) {
    const out = [];
    for (let i = active.length; i > keep; i--) {
      const path = active.slice(0, i).join('.');
      for (const a of assignsFor('exit', path)) out.push(a);
      enteredAt.delete(path);
    }
    const next = settleInto(model, target);
    for (let i = keep + 1; i <= next.length; i++) {
      const path = next.slice(0, i).join('.');
      if (!enteredAt.has(path)) for (const a of assignsFor('entry', path)) out.push(a);
    }
    active = next;
    markEntered(active, now);
    return out;
  }

  /** Where a transition's target points: a dot means from the root, a bare name means a sibling. */
  function resolveTarget(target, ownerDepth) {
    const text = String(target);
    if (text.indexOf('.') >= 0) return text.split('.');
    const parent = active.slice(0, ownerDepth - 1);
    return parent.concat([text]);
  }

  const api = {
    /** The current state as a dotted path. */
    path() { return active.join('.'); },
    /** Every state on the active path, outermost first. */
    states() { return active.map((_, i) => active.slice(0, i + 1).join('.')); },
    errors: errors,

    /**
     * Send an event. Looks for a handler from the deepest active state outward, honouring guards.
     * @param {string} event @param {{ get: (id: string) => any }} scope @param {number} [now]
     * @returns {{ changed: boolean, path: string, assigns: Array<{ id: string, tree: any }> }}
     */
    send(event, scope, now) {
      const clock = now == null ? 0 : now;
      for (let depth = active.length; depth >= 1; depth--) {
        const path = active.slice(0, depth);
        const node = stateAt(model, path);
        const handler = node && node.on ? node.on[event] : null;
        if (!handler) continue;
        const target = typeof handler === 'string' ? handler : handler.target;
        if (!target) continue;
        const guard = compiled.guards.get(path.join('.') + '|' + event);
        if (guard) {
          const v = evaluate(guard, scope);
          if (isError(v) || !truthy(v)) continue;
        }
        const assigns = move(resolveTarget(target, depth), depth - 1, clock);
        return { changed: true, path: active.join('.'), assigns: assigns };
      }
      return { changed: false, path: active.join('.'), assigns: [] };
    },

    /**
     * Fire whichever `after` timer is due. Called by the runtime with the clock; in a test, with
     * whatever number the test wants.
     * @param {number} now
     */
    tick(now) {
      for (let depth = active.length; depth >= 1; depth--) {
        const path = active.slice(0, depth);
        const node = stateAt(model, path);
        if (!node || !node.after) continue;
        const since = enteredAt.get(path.join('.'));
        if (since == null) continue;
        for (const ms of Object.keys(node.after).map(Number).sort((a, b) => a - b)) {
          if (!Number.isFinite(ms) || now - since < ms) continue;
          const handler = node.after[String(ms)];
          const target = typeof handler === 'string' ? handler : handler && handler.target;
          if (!target) continue;
          const assigns = move(resolveTarget(target, depth), depth - 1, now);
          return { changed: true, path: active.join('.'), assigns: assigns };
        }
      }
      return { changed: false, path: active.join('.'), assigns: [] };
    },

    /** How long until the earliest pending `after`, or null when nothing is waiting. */
    nextDue(now) {
      let best = null;
      for (let depth = active.length; depth >= 1; depth--) {
        const path = active.slice(0, depth);
        const node = stateAt(model, path);
        if (!node || !node.after) continue;
        const since = enteredAt.get(path.join('.'));
        if (since == null) continue;
        for (const ms of Object.keys(node.after).map(Number)) {
          if (!Number.isFinite(ms)) continue;
          const left = Math.max(0, since + ms - now);
          if (best == null || left < best) best = left;
        }
      }
      return best;
    },

    /**
     * Which crossings just became true. A rising edge, so an event fires once when the condition
     * is crossed rather than on every recompute while it holds.
     * @param {{ get: (id: string) => any }} scope
     * @returns {string[]}
     */
    crossings(scope) {
      const out = [];
      for (const w of compiled.whens) {
        const v = evaluate(w.tree, scope);
        const now = !isError(v) && truthy(v);
        if (now && !w.was) out.push(w.send);
        w.was = now;
      }
      return out;
    },

    /** Back to the initial state, with the crossings forgotten. */
    reset() {
      active = errors.length ? [] : settleInto(model, [model.initial]);
      enteredAt = new Map();
      markEntered(active, 0);
      for (const w of compiled.whens) w.was = false;
    },
  };
  return api;
}

function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v && typeof v === 'object' && typeof v.n === 'number') return v.n !== 0;
  if (typeof v === 'string') return v !== '';
  return !!v;
}
