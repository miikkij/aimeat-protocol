/**
 * @file living/index.js
 * @description The aimeat-living library. AIMEAT.living turns ONE JSON record into a document
 *   that is alive: its parts are wired to each other through formulas in a single dependency
 *   graph, so touching one thing moves everything that stood on it — the number, the gauge, the
 *   chart, the sentence, the state the document is in — and the whole screen moves at once.
 *
 *   THE RECORD IS THE PRODUCT. { v, register, look, layout, model }: `layout` is an ordinary
 *   mosaic arrangement, which the person can rearrange and the AI already knows how to write, and
 *   `model` is one graph of nodes — values, formulas, controls, bindings, sentences, a statechart
 *   and live sources. An AI writes the record, a person edits it with their own AI or touches the
 *   controls, and there is no code in between. That is the whole design: a document is DATA, not
 *   an app somebody has to build.
 *
 *   IT COMPUTES IN THE BROWSER. No route, no server round trip, no engine on the node: a slider
 *   moves faster than a request returns, and a document whose numbers wait on a network is a
 *   document that feels dead. Persistence is the record, and the record is a memory key.
 *
 *   THE BINDINGS GO THROUGH THE KIT'S OWN DOOR. A bound block is refreshed the way the mosaic
 *   refreshes any bound block, so the kit's motion runs for free: a figure counts to its new
 *   value, a chart's marks move, rows glide. This library draws only what the kit has no
 *   component for — the control row, the set formula, the changing sentence, the machine's state
 *   and the chain view.
 *
 *   describe() IS THE VOCABULARY, and it is read out of the node modules' own JSDoc, so what an
 *   AI asks the library at run time and what the source says are the same list by construction.
 *   A later node type — a generator: a procedural texture, an effect chain, an agent call — joins
 *   by writing one module and one registry line, and appears in describe() without anyone
 *   remembering to add it.
 * @structure mount(el, doc, opts) · describe(type?) · validate(doc) · chain(el, doc) · version
 * @usage
 *   <link rel="stylesheet" href="/lib/aimeat-atelier.css">
 *   <link rel="stylesheet" href="/lib/aimeat-living.css">
 *   <script src="/v1/libs/aimeat-atelier.js"></script>
 *   <script src="/v1/libs/aimeat-living.js"></script>
 *   const doc = AIMEAT.living.mount(host, record, { onChange(e) { save(record); } });
 *   doc.set('t', 31);
 * @version-history
 *   v0.2.0 — 2026-09-05 — THREE COPIES DROPPED, because the kit grew the seams they worked
 *     around (atelier 0.53.0). The control row is one form field of the kit's — the input, the
 *     label wiring, the range's track and its 40px hit area are no longer built here. The chain
 *     view stops insetting its columns by 6 % to keep a long label inside the graph's frame; the
 *     graph does that itself now. And which components read a bound record is asked of the
 *     mounted mosaic (blocks()) instead of being a list of the kit's cases kept in this library —
 *     which moves that one refusal from validate() to the mounted handle's `refusals`, because
 *     without a mosaic there is nobody to ask.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1): the graph, formulas with units,
 *     the TeX printer, the statechart, bindings through the mosaic, templates, live sources, the
 *     chain view and describe().
 */
import { attach } from '../_core/namespace.js';
import { createGraph } from './graph.js';
import { NODE_TYPES, typeOf } from './nodes/index.js';
import { unboundBlocks } from './nodes/binding.js';
import { planBindings, layoutWithSources, sourceNameFor, composeBlock } from './bindings.js';
import { renderNodeInto } from './render.js';
import { chain as chainView } from './chain.js';
import { NODES } from './describe-data.js';
import { resolve, kit } from './dom.js';
import { isError, isQuantity, asText } from './formula-eval.js';
import { unitLabel } from './units.js';

const VERSION = '0.2.0';

/** The node types whose rendering this library does itself, when the node names a block. */
const DRAWN = ['control', 'formula', 'text', 'machine', 'value', 'source'];

/**
 * Read a document without running it: every refusal it would hit, in words, before anything is
 * on the screen. An empty list means it will mount.
 *
 * One refusal is NOT here and cannot be: whether a bound block's component reads a record at all
 * is the kit's vocabulary, and without a mounted mosaic there is nobody to ask. mount() asks —
 * `surface.blocks()` — and adds it to the handle's `refusals` with the same words. The library
 * used to keep a copy of the kit's list so it could answer early, and a copy of somebody else's
 * list is wrong the day the kit gains a component.
 * @param {any} doc
 * @returns {{ ok: boolean, refusals: string[] }}
 */
export function validate(doc) {
  const refusals = [];
  if (!doc || typeof doc !== 'object') return { ok: false, refusals: ['This is not a document record.'] };
  if (doc.v != null && Number(doc.v) !== 1) refusals.push('This document says it is version ' + doc.v + ', and this build reads version 1.');
  const model = doc.model || {};
  const nodes = model.nodes || {};
  if (!nodes || typeof nodes !== 'object') return { ok: false, refusals: ['The document has no model.nodes to work out.'] };

  const graph = createGraph(doc);
  for (const e of graph.errors) refusals.push(e);

  const blocks = new Map();
  for (const block of ((doc.layout || {}).blocks || [])) if (block && block.id) blocks.set(String(block.id), block);

  for (const id of Object.keys(nodes)) {
    const node = nodes[id] || {};
    if (node.type === 'binding') {
      const block = blocks.get(String(node.block));
      if (!block) {
        refusals.push('The binding "' + id + '" writes to block "' + String(node.block) + '", and the layout has no block by that name.');
      }
      // Whether that component READS a bound record is the kit's answer, not this library's, so
      // it is asked of the mounted mosaic in mount() rather than guessed from a copied list here.
      continue;
    }
    if (!node.block) continue;
    if (DRAWN.indexOf(String(node.type)) < 0) continue;
    const block = blocks.get(String(node.block));
    if (!block) {
      refusals.push('Node "' + id + '" is drawn into block "' + String(node.block) + '", and the layout has no block by that name.');
    } else if (String(block.component) !== 'section') {
      refusals.push('Node "' + id + '" is drawn into block "' + block.id + '", which is a ' + block.component + '. A node is drawn into a section.');
    }
  }
  return { ok: refusals.length === 0, refusals: refusals };
}

/** Say the refusals on the screen, because a blank page says nothing. */
function refusalPanel(host, refusals) {
  const k = kit();
  if (k && typeof k.emptyState === 'function') {
    return k.emptyState({
      target: host, tone: 'error',
      title: 'This document cannot be worked out yet',
      hint: refusals.join(' '),
    });
  }
  const box = document.createElement('div');
  box.className = 'ak-living__refusals';
  for (const r of refusals) {
    const line = document.createElement('p');
    line.textContent = r;
    box.appendChild(line);
  }
  host.appendChild(box);
  return { destroy() { if (box.parentNode) box.parentNode.removeChild(box); } };
}

/**
 * Mount one document.
 * @param {string|Element} target
 * @param {any} doc
 * @param {{ onChange?: (e: any) => void, chainBlock?: string, live?: boolean }} [opts]
 * @returns {any}
 */
export function mount(target, doc, opts) {
  const options = opts || {};
  const host = /** @type {HTMLElement} */ (resolve(target, document.body));
  const check = validate(doc);
  if (!check.ok) {
    const panel = refusalPanel(host, check.refusals);
    return {
      el: host, refusals: check.refusals, ok: false,
      ready: Promise.resolve(), set() {}, get() {}, send() {}, values() { return {}; },
      state() { return {}; }, chain() { return null; }, describe: describe,
      destroy() { panel.destroy(); },
    };
  }

  const graph = createGraph(doc);
  graph.refresh();

  const plan = planBindings(doc);
  const layout = layoutWithSources(doc.layout, plan);

  /** Every node that draws itself, grouped by the section it draws into. */
  const drawnByBlock = new Map();
  const nodes = (doc.model || {}).nodes || {};
  for (const id of Object.keys(nodes)) {
    const node = nodes[id] || {};
    if (!node.block || DRAWN.indexOf(String(node.type)) < 0) continue;
    const list = drawnByBlock.get(String(node.block)) || [];
    list.push(id);
    drawnByBlock.set(String(node.block), list);
  }

  /** The live handles, so a change updates the one row that moved. */
  const views = new Map();
  let chainHandle = null;
  let timer = null;
  let destroyed = false;

  const sources = {};
  for (const [blockId, entries] of plan) {
    sources[sourceNameFor(blockId)] = (function (id, list) {
      return function () {
        const block = ((doc.layout || {}).blocks || []).find(function (b) { return b && String(b.id) === id; });
        const base = block && block.props ? block.props.data : null;
        return composeBlock(graph, list, base);
      };
    }(blockId, entries));
  }

  const fill = {};
  for (const [blockId, ids] of drawnByBlock) {
    fill[blockId] = (function (list) {
      return function (body) {
        for (const id of list) {
          const view = renderNodeInto(body, { id: id, node: nodes[id], graph: graph, set: apply });
          if (view) views.set(id, view);
        }
      };
    }(ids));
  }
  if (options.chainBlock) {
    fill[options.chainBlock] = function (body) {
      chainHandle = chainView(body, { graph: graph, title: 'The chain' });
    };
  }

  const k = kit();
  if (!k || typeof k.mosaic !== 'function') {
    const panel = refusalPanel(host, ['This page needs the Atelier kit: load /v1/libs/aimeat-atelier.js before aimeat-living.']);
    return {
      el: host, refusals: ['aimeat-atelier is not on this page.'], ok: false,
      ready: Promise.resolve(), set() {}, get() {}, send() {}, values() { return {}; },
      state() { return {}; }, chain() { return null; }, describe: describe,
      destroy() { panel.destroy(); },
    };
  }

  const surface = k.mosaic({
    target: host, layout: layout, fallback: layout, sources: sources, fill: fill,
  });

  // THE ONE REFUSAL THAT NEEDED THE KIT. A binding aimed at a block whose component does not read
  // a record would land nowhere in silence; the mounted mosaic says which blocks it actually
  // bound, so the answer is the kit's own rather than a list copied into this library.
  const lateRefusals = unboundBlocks(surface, plan.keys()).map(function (b) {
    return 'A binding writes to block "' + b.id + '", which is a ' + b.component
      + ' — that component does not read a bound record.';
  });
  for (const line of lateRefusals) console.warn('aimeat-living: ' + line);

  /** Everything one change touched, sent to the screen and to whoever is listening. */
  function announce(changed) {
    if (!changed.length) return;
    for (const id of changed) {
      const view = views.get(id);
      if (view) view.update();
    }
    const touched = new Set();
    for (const id of changed) {
      const node = nodes[id] || {};
      if (node.type === 'binding' && node.block) touched.add(String(node.block));
      for (const next of graph.dependents(id)) {
        const dep = nodes[next] || {};
        if (dep.type === 'binding' && dep.block) touched.add(String(dep.block));
      }
    }
    for (const blockId of touched) surface.refresh(sourceNameFor(blockId));
    if (chainHandle) chainHandle.flash(changed);
    schedule();
    if (options.onChange) {
      options.onChange({ changed: changed.slice(), values: valuesNow(), state: statesNow() });
    }
  }

  /** Move one node and let the change travel. */
  function apply(id, raw) {
    if (destroyed) return { changed: [] };
    const out = graph.set(id, raw);
    announce(out.changed);
    return out;
  }

  /** The next `after` timer in any machine, as one timeout — never a poll. */
  function schedule() {
    if (timer) { clearTimeout(timer); timer = null; }
    const due = graph.nextDue(Date.now());
    if (due == null || destroyed) return;
    timer = setTimeout(function () {
      timer = null;
      if (destroyed) return;
      announce(graph.tick(Date.now()).changed);
    }, Math.max(16, due));
  }

  function valuesNow() {
    const out = {};
    for (const id of graph.ids) {
      const v = graph.valueOf(id);
      out[id] = isQuantity(v) ? { value: v.n, unit: unitLabel(v.u) } : (isError(v) ? { error: v.error } : v);
    }
    return out;
  }

  function statesNow() {
    const out = {};
    for (const id of graph.ids) if ((nodes[id] || {}).type === 'machine') out[id] = String(graph.valueOf(id) || '');
    return out;
  }

  // ── Live sources: read the keys once, then follow the platform's own change event. ──
  const sourceIds = graph.ids.filter(function (id) { return (nodes[id] || {}).type === 'source' && nodes[id].key; });
  function readSources() {
    if (!sourceIds.length || destroyed) return Promise.resolve();
    const type = typeOf('source');
    return Promise.all(sourceIds.map(function (id) {
      return type.read(nodes[id]).then(function (v) { return { id: id, v: v }; });
    })).then(function (got) {
      if (destroyed) return;
      const changed = [];
      for (const one of got) {
        if (one.v === undefined) continue;
        for (const c of graph.set(one.id, one.v).changed) if (changed.indexOf(c) < 0) changed.push(c);
      }
      announce(changed);
    });
  }
  const onLive = function () { readSources(); };
  if (options.live !== false && sourceIds.length) window.addEventListener('aimeat-live-update', onLive);

  const ready = Promise.resolve().then(readSources).then(function () { schedule(); });

  return {
    el: host,
    ok: true,
    /** What the KIT refused once it had mounted; validate() cannot reach these on its own. */
    refusals: lateRefusals,
    ready: ready,
    /** The mosaic this document is rendered through — the arrangement is still the kit's. */
    mosaic: surface,
    /** The graph itself, for a host that wants to read the wiring. */
    graph: graph,

    /** Move one node. The same door a control uses, so a person and an agent are the same event. */
    set(id, value) { return apply(String(id), value); },
    /** What one node comes to now. */
    get(id) { return graph.valueOf(String(id)); },
    /** Every node's current value, in a shape that can be written to a record. */
    values: valuesNow,
    /** Every machine's current state. */
    state: statesNow,
    /** Send an event to the machines. */
    send(event) { const out = graph.send(String(event)); announce(out.changed); return out; },
    /** Work the whole document out again. */
    refresh() { const out = graph.refresh(); announce(out.changed); return out; },
    /** Draw the chain somewhere of the host's choosing, following this same document. */
    chain(where) {
      const view = chainView(where, { graph: graph, title: 'The chain' });
      if (!chainHandle) chainHandle = view;
      return view;
    },
    describe: describe,
    version: VERSION,

    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('aimeat-live-update', onLive);
      if (chainHandle) chainHandle.destroy();
      for (const [, view] of views) if (view.el && view.el.parentNode) view.el.parentNode.removeChild(view.el);
      views.clear();
      surface.destroy();
    },
  };
}

/**
 * The vocabulary: every node type, what it takes, what it answers with, and one example each —
 * read out of the node modules' own JSDoc, so it is never a stale second list.
 * @param {string} [type]
 * @returns {object|string[]|null}
 */
export function describe(type) {
  if (type == null) return Object.keys(NODES).sort();
  const found = NODES[String(type)];
  if (!found) return null;
  return Object.assign({ id: String(type) }, found);
}

/**
 * The chain of a document that is not mounted — a read-only picture of the wiring.
 * @param {string|Element} where @param {any} doc
 */
export function chain(where, doc) {
  const graph = createGraph(doc);
  graph.refresh();
  return chainView(where, { graph: graph, title: 'The chain' });
}

const living = {
  version: VERSION,
  mount: mount,
  validate: validate,
  describe: describe,
  chain: chain,
  /** The node type ids this build knows, without the documentation. */
  types() { return Object.keys(NODE_TYPES).sort(); },
  /** What a value comes to, as a person would read it — number, unit, refusal. */
  read(value) { return asText(value); },
};

attach('living', living);

export { living };
