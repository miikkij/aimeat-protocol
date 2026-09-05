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
 *   THE RECORD CARRIES ITS OWN WORDS. Any human-facing string may be a language map instead of a
 *   string — `{ fi: "Ilma ovella", en: "Air at the door" }` — on a label, a title, a hint, a
 *   pick's option, a sentence template, a machine's entry words, or a block's props. The page's
 *   language decides which is read, the record's own `lang` is the fallback, and a change of
 *   language moves the WORDS ONLY: the slider stays where the person put it, the machine stays in
 *   the state it reached, and nothing is remounted, so the kit's entrance does not run again for
 *   a change of wording. `langs` is the optional list of what the record carries, `lang` its
 *   default. describe(type).languages says which of that type's fields take a map.
 * @structure mount(el, doc, opts) · describe(type?) · validate(doc) · chain(el, doc) · version
 * @usage
 *   <link rel="stylesheet" href="/lib/aimeat-atelier.css">
 *   <link rel="stylesheet" href="/lib/aimeat-living.css">
 *   <script src="/v1/libs/aimeat-atelier.js"></script>
 *   <script src="/v1/libs/aimeat-living.js"></script>
 *   const doc = AIMEAT.living.mount(host, record, { onChange(e) { save(record); } });
 *   doc.set('t', 31);
 *   doc.setLanguage('en');   // …or just let the login pill do it
 * @version-history
 *   v0.4.0 — 2026-09-06 — A LIVING RECORD IS BILINGUAL BY CONSTRUCTION (the living document, stage
 *     4). Any human-facing string may be a language map; the page's language decides, the record's
 *     `lang` is the fallback and the map's first key the last resort. mount() follows the
 *     platform's language event and exposes setLanguage(); the graph re-reads only the nodes whose
 *     source is words, every drawn view rewrites its label in place, and the chain's pills follow.
 *     validate() refuses a map with no language keys and a sentence whose holes differ between
 *     languages, naming the node and the language. A `format` is per record rather than per
 *     language, except `locale: "auto"`, which follows the page.
 *   v0.3.0 — 2026-09-05 — FOUR FINDINGS FROM THE FIRST DOCUMENT BUILT ON IT, three of them in the
 *     part a record can see. `format` stops being a documented field nothing read: formula, value
 *     and source nodes print through format.js — a number of decimals, a word, or an object with
 *     grouping, a locale, a currency and where the unit goes — and the value that flows on is
 *     untouched, so a document says `format` instead of putting a round() into the maths it
 *     prints. A MACHINE ENTERS THE STATE IT STARTS IN: the initial state's entry actions run on
 *     the first refresh, outermost first through the nested initials, the way SCXML and XState
 *     run an initial transition, so a value a machine writes is right on the first paint rather
 *     than blank until the first crossing. A PERCENTAGE IS A LABEL ON A FACE NUMBER: `%` and
 *     `ppm` carry no hidden scale, so ln(rh) is ln(72) and rh / 100 is 0.72, and fraction(x) and
 *     percent(x) are the two doors between the two readings — the only behaviour change in this
 *     version, and the reason it is 0.3.0 rather than 0.2.1. The fourth was the kit's: a bound
 *     figure dropped the unit in props.data (atelier 0.53.1).
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
import { parseTemplate, symbolsOfTemplate } from './text.js';
import {
  TEXT_KEYS, hasLangMap, isPlainObject, langKeysOf, langMapError, localizeLayout, localizeProps,
  onLanguageChange, preference,
} from './i18n.js';

const VERSION = '0.4.0';

/** The node types whose rendering this library does itself, when the node names a block. */
const DRAWN = ['control', 'formula', 'text', 'machine', 'value', 'source'];

/**
 * Every language map in one node, refused by name where it is not one. The FIELDS TO LOOK AT ARE
 * describe()'s own — `NODES[type].languages`, generated from each node module's `@languages`
 * line — so a node type that later gains a translatable field is checked here without anybody
 * remembering to come back and add it.
 * @param {string} id @param {any} node @param {string[]} out
 */
function nodeLanguageRefusals(id, node, out) {
  for (const field of ((NODES[String(node.type)] || {}).languages || [])) {
    // The machine's line names its assignments in words rather than as a field path; those are
    // walked below, where the states are.
    if (/[^A-Za-z0-9_[\].]/.test(field)) continue;
    const perItem = /^([A-Za-z0-9_]+)\[\]\.([A-Za-z0-9_]+)$/.exec(field);
    if (perItem) {
      const items = node[perItem[1]];
      if (!Array.isArray(items)) continue;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || typeof item !== 'object') continue;
        const bad = langMapError(item[perItem[2]]);
        if (bad) out.push('Option ' + (i + 1) + ' of "' + id + '" has a ' + perItem[2] + ' that ' + bad + '.');
      }
      continue;
    }
    const bad = langMapError(node[field]);
    if (bad) out.push('Node "' + id + '" has a ' + field + ' that ' + bad + '.');
  }
}

/** The words a machine's entry and exit actions write, refused where a map has no language in it. */
function machineLanguageRefusals(id, node, out) {
  const walk = (states, prefix) => {
    for (const name of Object.keys(states || {})) {
      const state = states[name] || {};
      const path = prefix ? prefix + '.' + name : name;
      for (const kind of ['entry', 'exit']) {
        for (const target of Object.keys(state[kind] || {})) {
          const bad = langMapError(state[kind][target]);
          if (bad) {
            out.push('The ' + kind + ' of "' + id + '" at ' + path + ' writes a ' + target
              + ' that ' + bad + '.');
          }
        }
      }
      if (state.states) walk(state.states, path);
    }
  };
  walk(node.states, '');
}

/**
 * A SENTENCE CARRIES THE SAME HOLES IN EVERY LANGUAGE IT IS WRITTEN IN. The Finnish and the
 * English are composed separately — that is the point — but if one of them reads `dew` and the
 * other does not, the document says two different things depending on who opens it, and the
 * missing half is exactly what nobody notices. So the symbols are compared by name and the
 * refusal says WHICH node and WHICH language.
 * @param {string} id @param {any} node @param {string[]} out
 */
function templateLanguageRefusals(id, node, out) {
  const bad = langMapError(node.template);
  if (bad) { out.push('The sentence "' + id + '" has a template that ' + bad + '.'); return; }
  if (!isPlainObject(node.template)) return;
  const perLang = new Map();
  for (const lang of langKeysOf(node.template)) {
    const parts = parseTemplate(node.template[lang]);
    if (!Array.isArray(parts)) {
      out.push('The sentence "' + id + '" cannot be read in ' + lang + ': ' + parts.error);
      continue;
    }
    perLang.set(lang, symbolsOfTemplate(parts).map((s) => s.split('.')[0]));
  }
  const every = [];
  for (const [, list] of perLang) for (const s of list) if (every.indexOf(s) < 0) every.push(s);
  for (const [lang, list] of perLang) {
    for (const s of every) {
      if (list.indexOf(s) >= 0) continue;
      out.push('The sentence "' + id + '" reads "' + s + '" in one language and not in ' + lang
        + '. A sentence carries the same holes in every language it is written in.');
    }
  }
}

/** Every language map in a block's props, however deep, refused where it has no language in it. */
function propLanguageRefusals(blockId, props, out, path) {
  if (Array.isArray(props)) {
    props.forEach((p, i) => propLanguageRefusals(blockId, p, out, path + '[' + i + ']'));
    return;
  }
  if (!isPlainObject(props)) return;
  for (const key of Object.keys(props)) {
    const at = props[key];
    const where = (path ? path + '.' : '') + key;
    if (TEXT_KEYS.indexOf(key) >= 0 && isPlainObject(at)) {
      const bad = langMapError(at);
      if (bad) out.push('Block "' + blockId + '" has a ' + where + ' that ' + bad + '.');
      continue;
    }
    if (isPlainObject(at) || Array.isArray(at)) propLanguageRefusals(blockId, at, out, where);
  }
}

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

  const graph = createGraph(doc, { langs: function () { return preference(doc); } });
  for (const e of graph.errors) refusals.push(e);

  const blocks = new Map();
  for (const block of ((doc.layout || {}).blocks || [])) if (block && block.id) blocks.set(String(block.id), block);

  for (const [blockId, block] of blocks) propLanguageRefusals(blockId, block.props, refusals, '');

  for (const id of Object.keys(nodes)) {
    const node = nodes[id] || {};
    nodeLanguageRefusals(id, node, refusals);
    if (node.type === 'machine') machineLanguageRefusals(id, node, refusals);
    if (node.type === 'text') templateLanguageRefusals(id, node, refusals);
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
 * @param {{ onChange?: (e: any) => void, chainBlock?: string, live?: boolean,
 *   language?: string }} [opts]
 * @returns {any}
 */
export function mount(target, doc, opts) {
  const options = opts || {};
  const host = /** @type {HTMLElement} */ (resolve(target, document.body));

  /**
   * THE LANGUAGE IS ASKED FOR, NEVER KEPT. `wish` is what a host said through setLanguage() or
   * the `language` option; everything else is the page's own answer, which the login pill sets
   * and every other library on this platform already reads. There is no language switch here.
   */
  let wish = options.language ? String(options.language) : null;
  const langs = function () { return preference(doc, wish); };

  const check = validate(doc);
  if (!check.ok) {
    const panel = refusalPanel(host, check.refusals);
    return {
      el: host, refusals: check.refusals, ok: false,
      ready: Promise.resolve(), set() {}, get() {}, send() {}, values() { return {}; },
      state() { return {}; }, chain() { return null; }, describe: describe,
      language() { return langs()[0]; }, setLanguage() { return { changed: [] }; },
      destroy() { panel.destroy(); },
    };
  }

  const graph = createGraph(doc, { langs: langs });
  graph.refresh();

  const plan = planBindings(doc);
  const layout = layoutWithSources(localizeLayout(doc.layout, langs()), plan);

  /**
   * The blocks whose own props say something in more than one language, worked out once. A
   * language change touches these and nothing else, which is what keeps a change of wording from
   * repainting a screen that has not otherwise moved.
   */
  const wordyBlocks = new Set();
  /** Where each hero sits among the heroes: they share the band rather than owning a unit. */
  const heroPlace = new Map();
  let heroes = 0;
  for (const block of ((doc.layout || {}).blocks || [])) {
    if (!block || !block.id) continue;
    if (hasLangMap(block.props)) wordyBlocks.add(String(block.id));
    if (String(block.component) === 'hero') { heroPlace.set(String(block.id), heroes); heroes += 1; }
  }

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
        const base = block && block.props ? localizeProps(block.props.data, langs()) : null;
        return composeBlock(graph, list, base);
      };
    }(blockId, entries));
  }

  const fill = {};
  for (const [blockId, ids] of drawnByBlock) {
    fill[blockId] = (function (list) {
      return function (body) {
        for (const id of list) {
          const view = renderNodeInto(body, {
            id: id, node: nodes[id], graph: graph, langs: langs, set: apply,
          });
          if (view) views.set(id, view);
        }
      };
    }(ids));
  }
  if (options.chainBlock) {
    fill[options.chainBlock] = function (body) {
      chainHandle = chainView(body, { graph: graph, title: 'The chain', langs: langs });
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

  /**
   * Where one block's own words are on the screen. A unit carries `data-ak-block`; a hero does
   * not, because the arrangement draws every hero into one shared band above the navigation, so
   * it is found by its place among the heroes instead.
   * @param {any} block @param {Map<string, any>} mounted
   * @returns {Element|null}
   */
  function elementOf(block, mounted) {
    const entry = mounted.get(String(block.id));
    if (!entry || !entry.el || !entry.el.querySelector) return null;
    if (entry.el.getAttribute && entry.el.getAttribute('data-ak-block') === String(block.id)) return entry.el;
    if (String(block.component) === 'hero') {
      const band = entry.el.querySelectorAll('.ak-hero');
      return band[heroPlace.get(String(block.id)) || 0] || band[0] || null;
    }
    return entry.el;
  }

  /**
   * THE ARRANGEMENT'S OWN WORDS, WRITTEN AGAIN WHERE THEY STAND. A section's heading and a hero's
   * title are props of the layout, and the mosaic re-reads a layout only by re-rendering the
   * whole screen — which would throw away every count-up, close every open control and run the
   * kit's entrance a second time, for a change that is only wording. So the kit's own named parts
   * are written into directly, and only on the blocks that actually say something in more than
   * one language. A part inside a block's BODY belongs to whatever was drawn there, not to the
   * block, and is left alone.
   */
  function relabelBlocks() {
    if (!wordyBlocks.size) return;
    const wanted = langs();
    const mounted = new Map();
    for (const entry of surface.blocks()) mounted.set(String(entry.id), entry);
    for (const block of ((doc.layout || {}).blocks || [])) {
      if (!block || !wordyBlocks.has(String(block.id))) continue;
      const root = elementOf(block, mounted);
      if (!root) continue;
      const props = localizeProps(block.props, wanted);
      for (const key of TEXT_KEYS) {
        const words = props[key];
        if (typeof words !== 'string') continue;
        const at = root.querySelector('[data-ak-part="' + key + '"]');
        if (!at || (at.closest && at.closest('[data-ak-part="body"]'))) continue;
        if (at.textContent !== words) at.textContent = words;
      }
    }
  }

  /** Which language the screen is currently written in, so one switch is not answered twice. */
  let languageNow = langs().join('|');

  /**
   * THE PAGE CHANGED LANGUAGE, AND NOTHING ELSE DID. Every drawn view rewrites its own label in
   * place, the graph re-reads the nodes whose source is words and asks each machine to say its
   * current state's words again, the arrangement's headings are rewritten, and only the bound
   * blocks that actually carry words — or whose value genuinely moved — are refreshed. Nothing is
   * remounted: the slider is where the person left it, the machine is in the state it reached,
   * and no entrance runs a second time.
   * @returns {{ changed: string[], language: string }}
   */
  function relanguage() {
    const key = langs().join('|');
    if (destroyed || key === languageNow) return { changed: [], language: langs()[0] };
    languageNow = key;
    for (const [, view] of views) if (typeof view.relabel === 'function') view.relabel();
    const out = graph.relanguage();
    for (const id of out.changed) {
      const view = views.get(id);
      if (view) view.update();
    }
    relabelBlocks();
    for (const [blockId, entries] of plan) {
      const moved = entries.some(function (e) { return out.changed.indexOf(e.from) >= 0; });
      if (moved || wordyBlocks.has(String(blockId))) surface.refresh(sourceNameFor(blockId));
    }
    // The chain is REDRAWN, never flashed: nothing travelled, the pills simply say it in the
    // other language now.
    if (chainHandle) chainHandle.set();
    if (options.onChange) {
      options.onChange({
        changed: out.changed.slice(), values: valuesNow(), state: statesNow(), language: langs()[0],
      });
    }
    return { changed: out.changed, language: langs()[0] };
  }
  const stopLang = onLanguageChange(function () { relanguage(); });

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
      const view = chainView(where, { graph: graph, title: 'The chain', langs: langs });
      if (!chainHandle) chainHandle = view;
      return view;
    },
    describe: describe,
    version: VERSION,

    /** The language this screen is written in right now. */
    language() { return langs()[0]; },

    /**
     * Ask for a language, for a host that has its own switch. Passing null hands the decision
     * back to the page, which is where it belongs — the login pill is the switch on this
     * platform, and a document that fought it would be a second answer to one question.
     * @param {string|null} lang
     */
    setLanguage(lang) {
      wish = lang == null ? null : String(lang);
      return relanguage();
    },

    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      stopLang();
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
  const langs = function () { return preference(doc); };
  const graph = createGraph(doc, { langs: langs });
  graph.refresh();
  return chainView(where, { graph: graph, title: 'The chain', langs: langs });
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
