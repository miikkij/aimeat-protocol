/**
 * @file living/graph.js
 * @description ONE DEPENDENCY GRAPH, AND EVERY PART OF THE DOCUMENT IN IT. This is the engine:
 *   it reads the model's nodes, works out who stands on whom, sorts them, evaluates them in that
 *   order, and — when one thing moves — recomputes ONLY what stood on it, in order, and reports
 *   exactly which nodes changed.
 *
 *   THE CHANGED LIST IS THE PRODUCT, not a debugging aid. It is what the bindings use to refresh
 *   the two blocks that moved instead of the eleven that did not, what the chain view flashes,
 *   and what the host's onChange hears. A recompute that repainted everything would work and
 *   would throw away every entrance, glide and count-up the kit does for free.
 *
 *   A CYCLE IS REFUSED BY NAME. "a needs b, and b needs a" — the two ids, in words, before
 *   anything renders. A graph that computed a cycle by giving up after ten rounds would be a
 *   document that is quietly wrong, and quietly wrong is the one failure this whole design
 *   exists to make impossible.
 *
 *   A MACHINE IS BOTH A READER AND A WRITER, which is the one place the graph is not a plain
 *   DAG of formulas. Its guards read nodes, so it depends on them; its entry and exit actions
 *   assign to value nodes, so those depend on IT. That ordering is what lets arriving in a state
 *   put a word on the screen without the word and the state disagreeing for one frame. Events
 *   come from crossings after each pass, and a pass that fires an event runs again — bounded, so
 *   two machines sending each other events settle or stop rather than spin. The FIRST refresh
 *   also runs each machine's initial entry, because a machine that merely occupies its starting
 *   state has never written the word it is supposed to be showing.
 *   THE LANGUAGE IS A READING OF THE RECORD, NOT A STATE OF THE GRAPH. relanguage() re-reads the
 *   nodes whose own source is words — a sentence template — and asks every machine to say the
 *   words of the state it is already in again; then it recomputes only what those touched. No
 *   value is reset, no machine transitions, nothing is remounted: the numbers a person moved are
 *   exactly where they left them and only the words are different.
 * @structure createGraph(doc, opts) → { ids, errors, get, valueOf, fieldsOf, set, send, tick,
 *   refresh, relanguage, dependents, nodeOf, edges }
 * @usage
 *   import { createGraph } from './graph.js';
 *   const g = createGraph(doc, { langs: () => ['fi', 'en'] });
 *   g.set('t', 31);   // { changed: ['t', 'f', 'note', 'state'] }
 * @version-history
 *   v0.4.0 — 2026-09-06 — `opts.langs` reaches every node's ctx, and relanguage() moves the words
 *     without moving the graph.
 *   v0.3.0 — 2026-09-05 — The first refresh runs each machine's initial entry actions, so a value
 *     a machine writes is right on the first paint instead of blank until the first crossing.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { NODE_TYPES, typeOf } from './nodes/index.js';
import { writesOf } from './nodes/machine-node.js';
import { evaluate as runExpr, isError, isQuantity } from './formula-eval.js';

/** How many times one change may set off another before the engine stops and says so. */
const MAX_ROUNDS = 8;

/** Same value, for the purpose of "did this actually change". */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (isQuantity(a) && isQuantity(b)) return a.n === b.n && (a.u ? a.u.label : '') === (b.u ? b.u.label : '');
  if (isError(a) && isError(b)) return a.error === b.error;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!same(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/**
 * Build the graph for one document.
 * @param {{ model?: { nodes?: Record<string, any> } }} doc
 * @param {{ langs?: () => string[] }} [opts]  how a node reads the language in force, for the
 *   fields a record may write as a language map
 * @returns {any}
 */
export function createGraph(doc, opts) {
  const langs = opts && typeof opts.langs === 'function' ? opts.langs : function () { return []; };
  const model = (doc && doc.model) || {};
  const nodes = (model && model.nodes) || {};
  const ids = Object.keys(nodes);
  const errors = [];

  const state = { values: new Map(), machines: new Map() };
  const compiled = new Map();
  const outputs = new Map();
  const fields = new Map();

  /** The scope every formula, template and guard is evaluated against. */
  const scope = {
    get(symbol) {
      const parts = String(symbol).split('.');
      const head = parts[0];
      if (!Object.prototype.hasOwnProperty.call(nodes, head)) return undefined;
      if (parts.length === 1) return outputs.get(head);
      const extra = fields.get(head);
      if (extra && Object.prototype.hasOwnProperty.call(extra, parts.slice(1).join('.'))) {
        return extra[parts.slice(1).join('.')];
      }
      let at = outputs.get(head);
      for (let i = 1; i < parts.length; i++) {
        if (at == null || typeof at !== 'object') return undefined;
        at = at[parts[i]];
      }
      return at;
    },
  };

  function ctxFor(id) {
    if (!compiled.has(id)) compiled.set(id, {});
    return {
      id: id, node: nodes[id], doc: doc, scope: scope, state: state,
      compiled: compiled.get(id), langs: langs,
    };
  }

  // ── Prepare every node once: parse expressions, read units, seed the writable stores. ──
  for (const id of ids) {
    const node = nodes[id] || {};
    const type = typeOf(node.type);
    if (!type) {
      errors.push('Node "' + id + '" is of type "' + String(node.type) + '", which this document does not have. It knows ' + Object.keys(NODE_TYPES).join(', ') + '.');
      continue;
    }
    const found = type.prepare ? type.prepare(node, ctxFor(id)) : [];
    for (const e of found || []) errors.push('Node "' + id + '" has ' + e + '.');
  }

  // ── Edges: who has to be worked out before whom. ──
  /** @type {Map<string, string[]>} */
  const deps = new Map();
  for (const id of ids) {
    const node = nodes[id] || {};
    const type = typeOf(node.type);
    const list = [];
    if (type && type.dependsOn) {
      for (const on of type.dependsOn(node, ctxFor(id)) || []) {
        if (!Object.prototype.hasOwnProperty.call(nodes, on)) {
          errors.push('Node "' + id + '" reads "' + on + '", which this document does not have.');
          continue;
        }
        if (on !== id && list.indexOf(on) < 0) list.push(on);
      }
    }
    deps.set(id, list);
  }
  // A machine WRITES to value nodes, so those come after it.
  for (const id of ids) {
    if ((nodes[id] || {}).type !== 'machine') continue;
    for (const target of writesOf(nodes[id])) {
      if (!Object.prototype.hasOwnProperty.call(nodes, target)) {
        errors.push('Node "' + id + '" assigns to "' + target + '", which this document does not have.');
        continue;
      }
      const list = deps.get(target) || [];
      if (list.indexOf(id) < 0) list.push(id);
      deps.set(target, list);
    }
  }

  /** id → the nodes that stand on it. */
  const dependents = new Map();
  for (const id of ids) dependents.set(id, []);
  for (const id of ids) for (const on of deps.get(id) || []) dependents.get(on).push(id);

  // ── The order, and the refusal when there is not one. ──
  const order = [];
  const left = new Map();
  for (const id of ids) left.set(id, (deps.get(id) || []).length);
  const ready = ids.filter((id) => left.get(id) === 0);
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const next of dependents.get(id) || []) {
      left.set(next, left.get(next) - 1);
      if (left.get(next) === 0) ready.push(next);
    }
  }
  if (order.length !== ids.length) {
    const stuck = ids.filter((id) => order.indexOf(id) < 0);
    const a = stuck[0];
    const b = (deps.get(a) || []).find((x) => stuck.indexOf(x) >= 0) || stuck[1] || a;
    errors.push('These nodes stand in a circle: "' + a + '" needs "' + b + '", and following "'
      + b + '" comes back to "' + a + '". A document cannot work out a circle, so break it.');
    for (const id of stuck) order.push(id);
  }

  /** Work one node out and store what came back. @returns {boolean} whether it changed */
  function computeOne(id) {
    const node = nodes[id] || {};
    const type = typeOf(node.type);
    if (!type) return false;
    const ctx = ctxFor(id);
    let out;
    try {
      out = type.evaluate(node, ctx);
    } catch (e) {
      out = { error: 'Node "' + id + '" could not be worked out: ' + ((e && e.message) || String(e)) };
    }
    if (type.fields) fields.set(id, type.fields(node, ctx));
    const before = outputs.get(id);
    if (outputs.has(id) && same(before, out)) return false;
    outputs.set(id, out);
    return true;
  }

  /** Write into a writable node, through its own type's coerce. @returns {boolean} changed */
  function put(id, raw) {
    const node = nodes[id] || {};
    const type = typeOf(node.type);
    if (!type || !type.settable) return false;
    const ctx = ctxFor(id);
    const next = type.coerce ? type.coerce(node, ctx, raw) : raw;
    if (same(state.values.get(id), next)) return false;
    state.values.set(id, next);
    return true;
  }

  /**
   * One pass over the affected part of the graph, in order. `seed` is the set of ids whose input
   * moved; everything downstream of them is re-evaluated and the ones that actually changed are
   * collected.
   */
  function pass(seed, changed) {
    const dirty = new Set(seed);
    for (const id of order) {
      const mine = dirty.has(id) || (deps.get(id) || []).some((on) => dirty.has(on));
      if (!mine) continue;
      if (computeOne(id)) { dirty.add(id); if (changed.indexOf(id) < 0) changed.push(id); }
    }
  }

  /**
   * The entry actions of the state each machine STARTS in, run once, on the first refresh. A
   * machine that was merely occupying its initial state left the value it writes blank until the
   * first crossing, so the document opened saying nothing. It runs AFTER the first pass, because
   * an entry action is an expression and needs the rest of the graph already worked out.
   */
  function startMachines(changed) {
    const seed = [];
    for (const id of order) {
      if ((nodes[id] || {}).type !== 'machine') continue;
      const m = state.machines.get(id);
      if (!m || typeof m.start !== 'function') continue;
      for (const a of m.start().assigns) {
        const v = a.tree ? evaluateAssign(a.tree) : undefined;
        if (put(a.id, v) && seed.indexOf(a.id) < 0) seed.push(a.id);
      }
    }
    if (seed.length) pass(seed, changed);
  }

  /** After a pass, ask every machine what just became true, and act on it. */
  function settleMachines(changed) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const seed = [];
      for (const id of order) {
        if ((nodes[id] || {}).type !== 'machine') continue;
        const m = state.machines.get(id);
        if (!m) continue;
        let moved = false;
        for (const event of m.crossings(scope)) {
          const out = m.send(event, scope, Date.now());
          if (!out.changed) continue;
          moved = true;
          for (const a of out.assigns) {
            const v = a.tree ? evaluateAssign(a.tree) : undefined;
            if (put(a.id, v) && seed.indexOf(a.id) < 0) seed.push(a.id);
          }
        }
        if (moved && seed.indexOf(id) < 0) seed.push(id);
      }
      if (!seed.length) return;
      pass(seed, changed);
    }
    errors.push('The machines in this document kept sending each other events; the engine stopped after ' + MAX_ROUNDS + ' rounds.');
  }

  /**
   * What one entry or exit action comes to, in the same expression language as everything else.
   * A null tree is an assignment written as a language map that carries no language this build
   * could read; it assigns nothing rather than throwing.
   */
  function evaluateAssign(tree) { return tree ? runExpr(tree, scope) : undefined; }

  const api = {
    ids: ids,
    order: order,
    errors: errors,
    scope: scope,
    /** The node record, as the document wrote it. */
    nodeOf(id) { return nodes[id]; },
    /** What one node currently comes to. */
    valueOf(id) { return outputs.get(id); },
    /** A node's extra outputs — a formula's TeX, for instance. */
    fieldsOf(id) { return fields.get(id) || {}; },
    /** Who stands on this node. */
    dependents(id) { return (dependents.get(id) || []).slice(); },
    /** What this node stands on. */
    dependencies(id) { return (deps.get(id) || []).slice(); },
    /** Every edge, for the chain view. */
    edges() {
      const out = [];
      for (const id of ids) for (const on of deps.get(id) || []) out.push({ from: on, to: id });
      return out;
    },

    /** Work the whole document out from the top. @returns {{ changed: string[] }} */
    refresh() {
      const changed = [];
      pass(ids, changed);
      startMachines(changed);
      settleMachines(changed);
      return { changed: changed };
    },

    /**
     * THE LANGUAGE CHANGED, AND NOTHING ELSE DID. Every node whose own source is words is read
     * again from the record, every machine says the words of the state it is already in again,
     * and only what those touched is recomputed. A value a person moved is not written, a machine
     * does not transition, and the changed list is the words that actually became different — so
     * the caller can update those and leave the rest of the screen exactly where it is.
     * @returns {{ changed: string[] }}
     */
    relanguage() {
      const changed = [];
      const seed = [];
      for (const id of order) {
        const node = nodes[id] || {};
        const type = typeOf(node.type);
        if (!type || typeof type.relanguage !== 'function') continue;
        type.relanguage(node, ctxFor(id));
        if (seed.indexOf(id) < 0) seed.push(id);
      }
      for (const id of order) {
        if ((nodes[id] || {}).type !== 'machine') continue;
        const m = state.machines.get(id);
        if (!m || typeof m.words !== 'function') continue;
        for (const a of m.words()) {
          if (put(a.id, evaluateAssign(a.tree)) && seed.indexOf(a.id) < 0) seed.push(a.id);
        }
      }
      if (seed.length) pass(seed, changed);
      return { changed: changed };
    },

    /**
     * Move one writable node and recompute what stood on it.
     * @param {string} id @param {any} raw
     * @returns {{ changed: string[] }}
     */
    set(id, raw) {
      const changed = [];
      if (!put(id, raw)) return { changed: changed };
      pass([id], changed);
      settleMachines(changed);
      return { changed: changed };
    },

    /**
     * Send an event to every machine that has a handler for it.
     * @param {string} event
     * @returns {{ changed: string[] }}
     */
    send(event) {
      const changed = [];
      const seed = [];
      for (const id of order) {
        if ((nodes[id] || {}).type !== 'machine') continue;
        const m = state.machines.get(id);
        if (!m) continue;
        const out = m.send(event, scope, Date.now());
        if (!out.changed) continue;
        seed.push(id);
        for (const a of out.assigns) { const v = evaluateAssign(a.tree); if (put(a.id, v)) seed.push(a.id); }
      }
      if (!seed.length) return { changed: changed };
      pass(seed, changed);
      settleMachines(changed);
      return { changed: changed };
    },

    /**
     * Fire whichever `after` timers are due.
     * @param {number} now
     * @returns {{ changed: string[] }}
     */
    tick(now) {
      const changed = [];
      const seed = [];
      for (const id of order) {
        if ((nodes[id] || {}).type !== 'machine') continue;
        const m = state.machines.get(id);
        if (!m) continue;
        for (let i = 0; i < MAX_ROUNDS; i++) {
          const out = m.tick(now);
          if (!out.changed) break;
          seed.push(id);
          for (const a of out.assigns) { const v = evaluateAssign(a.tree); if (put(a.id, v)) seed.push(a.id); }
        }
      }
      if (!seed.length) return { changed: changed };
      pass(seed, changed);
      settleMachines(changed);
      return { changed: changed };
    },

    /** How long until the earliest pending timer in any machine, or null. */
    nextDue(now) {
      let best = null;
      for (const [, m] of state.machines) {
        const left = m.nextDue(now);
        if (left != null && (best == null || left < best)) best = left;
      }
      return best;
    },

    /** The machine handle for one node — the chain view reads its active states from here. */
    machineOf(id) { return state.machines.get(id) || null; },
  };
  return api;
}
