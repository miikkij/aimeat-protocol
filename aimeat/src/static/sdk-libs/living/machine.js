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
 *
 *   THE STATE IT STARTS IN IS ENTERED, NOT MERELY OCCUPIED. start() hands back the entry actions
 *   of the initial state — and of every nested initial state under it, outermost first — exactly
 *   as SCXML and XState run them on the initial transition. Without it a value a machine writes
 *   sat blank until the first crossing, so a document opened saying nothing and only became
 *   correct once somebody touched a control. It is handed back rather than run, like every other
 *   assignment here, and it happens ONCE: reset() re-arms it, a second start() is a no-op.
 *
 *   AN ENTRY ACTION THAT WRITES WORDS WRITES THEM IN EVERY LANGUAGE. `{ advice: { fi: "\"tuuleta\"",
 *   en: "\"open a window\"" } }` compiles to one tree per language and the one in force is chosen
 *   at the moment the assignment is handed over — so a machine sitting in `hot` says the right
 *   word the instant the page changes language, without the machine moving. `words()` is that
 *   second door: the active states' word-writing entries, resolved again, for the engine to apply.
 * @structure createMachine(def, opts) → { path, states, start, send, tick, crossings, words,
 *   nextDue, reset, errors }
 * @usage
 *   import { createMachine } from './machine.js';
 *   const m = createMachine({ initial: 'fine', states: { fine: { on: { HOT: 'hot' } }, hot: {} } });
 *   m.start();              // { changed: false, path: 'fine', assigns: [] }
 *   m.send('HOT', scope);   // { changed: true, path: 'hot', assigns: [] }
 * @version-history
 *   v0.4.0 — 2026-09-06 — An entry or exit assignment may be a language map; one tree per language
 *     is compiled and the one in force is picked when the assignment is handed to the engine.
 *     words() hands back the active states' word-writing entries so a language change moves the
 *     words without moving the machine.
 *   v0.3.0 — 2026-09-05 — start(): the initial state's entry actions, and its nested initial
 *     states' entries outermost first, so a value a machine writes is right on the first paint.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parse } from './formula-parse.js';
import { evaluate, isError } from './formula-eval.js';
import { isPlainObject, pickLang } from './i18n.js';

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
      const src = map[id];
      // A LANGUAGE MAP IS PARSED ONCE PER LANGUAGE, never once per assignment: an entry action
      // fires on a crossing and a language is chosen on a click, and neither is a moment to be
      // running the expression parser.
      if (isPlainObject(src)) {
        const trees = {};
        let any = false;
        for (const lang of Object.keys(src)) {
          const tree = expr(String(src[lang]), where + ' sets ' + id + ' in ' + lang);
          if (tree) { trees[lang] = tree; any = true; }
        }
        if (any) list.push({ id: id, tree: null, trees: trees });
        continue;
      }
      const tree = expr(String(src), where + ' sets ' + id);
      if (tree) list.push({ id: id, tree: tree, trees: null });
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
 * @param {{ langs?: () => string[] }} [opts]  how to read the language in force, for an assignment
 *   written as a language map
 * @returns {{ path: () => string, states: () => string[], send: (event: string, scope: any) => any,
 *   tick: (now: number) => any, crossings: (scope: any) => string[], words: () => any[],
 *   nextDue: (now: number) => number|null, reset: () => void, errors: string[] }}
 */
export function createMachine(def, opts) {
  const errors = [];
  const wanted = function () {
    return opts && typeof opts.langs === 'function' ? (opts.langs() || []) : [];
  };
  const model = def && typeof def === 'object' ? def : {};
  if (!model.states || typeof model.states !== 'object' || !Object.keys(model.states).length) {
    errors.push('a machine with no states');
  } else if (!model.initial || !model.states[model.initial]) {
    errors.push('a machine whose initial state "' + String(model.initial) + '" is not one of its states');
  }
  const compiled = compile(model, errors);

  let active = errors.length ? [] : settleInto(model, [model.initial]);
  /** Whether the initial state's entry actions have been handed out; start() does that once. */
  let started = false;
  /** When each active state was entered, so `after` knows how long it has been there. */
  let enteredAt = new Map();

  function markEntered(path, now) {
    for (let i = 1; i <= path.length; i++) {
      const key = path.slice(0, i).join('.');
      if (!enteredAt.has(key)) enteredAt.set(key, now);
    }
  }
  markEntered(active, 0);

  /** One assignment, with the language decided: a plain one is itself, a map picks its entry. */
  function resolveAssign(a) {
    if (!a.trees) return a;
    const got = pickLang(a.trees, wanted());
    return { id: a.id, tree: got ? got.text : null };
  }

  function assignsFor(kind, path) {
    const list = compiled.assigns.get(kind + ':' + path) || [];
    return list.length ? list.map(resolveAssign) : list;
  }

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
     * ARRIVING WHERE IT STARTS. The entry actions of the initial state, and of every nested
     * initial state beneath it, outermost first — the same order a transition into that state
     * would run them in, which is what SCXML and XState call the initial transition.
     *
     * No exit action is ever produced here: nothing has been left. It answers once; a second
     * call hands back nothing, and reset() puts it back on the line.
     * @returns {{ changed: boolean, path: string, assigns: Array<{ id: string, tree: any }> }}
     */
    start() {
      if (started || errors.length || !active.length) {
        started = true;
        return { changed: false, path: active.join('.'), assigns: [] };
      }
      started = true;
      const out = [];
      for (let i = 1; i <= active.length; i++) {
        for (const a of assignsFor('entry', active.slice(0, i).join('.'))) out.push(a);
      }
      return { changed: out.length > 0, path: active.join('.'), assigns: out };
    },

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

    /**
     * THE WORDS THIS MACHINE IS CURRENTLY SAYING, read again in the language now in force. Only
     * the entries written as a language map are here: a plain assignment has nothing to re-read,
     * and re-running it would overwrite a value somebody has since moved. The machine does not
     * transition, nothing is entered or left — the same states are still active and only the
     * words in them are read differently.
     * @returns {Array<{ id: string, tree: any }>}
     */
    words() {
      const out = [];
      for (let i = 1; i <= active.length; i++) {
        const path = active.slice(0, i).join('.');
        for (const a of (compiled.assigns.get('entry:' + path) || [])) {
          if (a.trees) out.push(resolveAssign(a));
        }
      }
      return out;
    },

    /** Back to the initial state, with the crossings forgotten and start() armed again. */
    reset() {
      active = errors.length ? [] : settleInto(model, [model.initial]);
      enteredAt = new Map();
      markEntered(active, 0);
      started = false;
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
