/**
 * @file living/render.js
 * @description WHAT A NODE LOOKS LIKE WHEN IT IS PUT ON THE SCREEN DIRECTLY. Most nodes reach the
 *   page through a binding — the gauge, the chart, the figure are the kit's own components and
 *   the graph only feeds them. Four kinds have no component to feed and are drawn here: the
 *   CONTROL a person moves, the FORMULA set as mathematics, the SENTENCE that changes with the
 *   state, and the MACHINE's current state.
 *
 *   THEY GO INTO A SECTION BLOCK. A node with a `block` field is rendered into that block's body
 *   through the mosaic's own `fill` door, which means it sits inside the arrangement — the person
 *   can move it, span it and rename it with everything else — rather than in a strip this library
 *   bolted on underneath.
 *
 *   A CONTROL TAKES ITS BOUNDS FROM THE VALUE IT MOVES. min, max, step, unit and label are read
 *   off the target node, never typed twice, so a slider cannot offer a number the value will
 *   refuse. It reports and does nothing else: the write goes through the engine, which is what
 *   makes a person's hand and an agent's call the same event.
 *
 *   THE CONTROL IS A KIT FIELD, NOT MARKUP OF OUR OWN. It is declared to AIMEAT.atelier.form as
 *   one field with `submit: false` and an `onInput`, so the label wiring, the announced refusal,
 *   the range's track and reading, and the 40px hit area are the kit's and stay the kit's. This
 *   file used to build the input, the label and the readout by hand — five branches that were a
 *   worse copy of what the kit already had, and a second place for every accessibility fix to be
 *   made. What is left here is what a living document adds: the graph's own words in the readout
 *   (a quantity with its unit, a refusal in words) and the marker classes an app targets.
 *
 *   EVERY CLASS THIS FILE ADDS IS ak-living__*, and every size and colour in the stylesheet comes
 *   off an --ak-* token, so a living document wears the look of whatever page it is on.
 *
 *   A WORD IS CHANGED IN PLACE, NEVER BY REBUILDING THE ROW. Every view here answers with
 *   relabel() as well as update(): the language changed, so the label, the option and the reading
 *   are written again into the elements that are already on the screen. Rebuilding would be
 *   fewer lines and would take the slider out from under the person's finger, fire the kit's
 *   entrance again, and restart every count-up — for a change that is only words.
 * @structure controlRow · textView · machineView · valueRow · renderNodeInto
 * @usage  import { renderNodeInto } from './render.js';
 * @version-history
 *   v0.4.1 — 2026-09-06 — A CONTROL SAYS ITS ANSWER ONCE. The reading beside a control is drawn
 *     only for the slider and the number field, which cannot show the answer themselves. A pick's
 *     reading printed the stored value while its select showed the option's words, so one row said
 *     "Outdoors" and "ulko" at the same time; a toggle printed "true" beside a switch; a text
 *     field printed a copy of what was in the box.
 *   v0.4.0 — 2026-09-06 — Every human-facing string this file prints is read through the record's
 *     language (i18n.js), and every view answers with relabel() so a language change moves the
 *     words without moving anything else. A number written with `locale: "auto"` follows too.
 *   v0.3.0 — 2026-09-05 — Every number this file prints goes through format.js and the node's own
 *     `format`: the reading beside a control (which keeps showing its unit, since it always has),
 *     the value row, and the formula's answer. The count-up counts in the same writing.
 *   v0.2.0 — 2026-09-05 — The control row is built by the kit's form(): one field of the right
 *     type, `submit: false`, `onInput` reporting to the engine. Atelier 0.53.0's `type: 'range'`
 *     is what made that possible. The classes an app may already target — ak-input,
 *     ak-form__field, ak-form__label, ak-living__input, ak-living__slider, ak-living__readout —
 *     are all still on the elements they were on.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { el, countTo, kit } from './dom.js';
import { formulaView } from './formula-view.js';
import { isQuantity, asText, asNumber } from './formula-eval.js';
import { formatNumber, formatParts } from './format.js';
import { textOf } from './i18n.js';

let seq = 0;
function uid() { seq += 1; return 'ak-living-' + seq; }

/** The languages a spec asks for, however the caller passed them. */
function langsOf(spec) {
  if (!spec || typeof spec.langs !== 'function') return [];
  return spec.langs() || [];
}

/**
 * How a value reads in a control's readout: the number in the target node's own writing, and the
 * unit when it has one. A readout has always shown the unit, so 'after' is what it asks for when
 * the node's format says nothing — a document with no format looks exactly as it did.
 * @param {any} v @param {any} format @param {string} [lang]
 * @returns {string}
 */
function readout(v, format, lang) { return formatParts(v, format, 'after', lang).text; }

/** Which of the kit's field types each control kind is. */
const FIELD_TYPE = { slider: 'range', toggle: 'toggle', pick: 'select', number: 'number', text: 'text' };

/**
 * WHICH CONTROLS GET A READING BESIDE THEM, and it is the shorter list. A reading earns its place
 * only where the control CANNOT show the answer itself: the slider, whose track says nothing, and
 * the number field, whose box shows the figure but never the unit.
 *
 * A pick, a toggle and a text field are their own readout, and a second copy beside them can only
 * ever disagree. On a pick it always did: the select showed the option's words ("Outdoors") and
 * the reading printed what the document STORES ("ulko") — the id a guard compares against, which
 * is not words and does not change with the language. Translating that id into the option's label
 * would have fixed the disagreement by printing the same word twice on one row, which is not what
 * a form does.
 */
const READS_OUT = ['slider', 'number'];

/**
 * One option of a pick, however the record wrote it: a bare value or { value, label }. The VALUE
 * is what the document stores and never changes with the language; the LABEL is what the person
 * reads and may be a language map.
 * @param {any} o @param {string[]} langs
 */
function asOption(o, langs) {
  const opt = o && typeof o === 'object' ? o : { value: o, label: o };
  const label = textOf(opt.label == null ? opt.value : opt.label, langs);
  return { value: String(opt.value), label: String(label) };
}

/**
 * A control row: ONE kit form field, reporting continuously, with the graph's own words in the
 * reading beside it.
 * @param {HTMLElement} host
 * @param {{ id: string, node: any, target: any, value: any, langs?: () => string[],
 *   onSet: (v: any) => void }} spec
 * @returns {{ el: HTMLElement, update: (value: any) => void, relabel: (value?: any) => void }}
 */
export function controlRow(host, spec) {
  const kind = String(spec.node.kind || 'slider');
  const target = spec.target || {};
  const id = uid();
  const type = FIELD_TYPE[kind] || 'text';
  const start = kind === 'toggle'
    ? (spec.value === true || asNumber(spec.value) === 1)
    : (isQuantity(spec.value) ? spec.value.n : (spec.value == null ? null : asText(spec.value)));
  /** The label this control shows: its own, then the value's, then the value's id. */
  const wording = function () {
    const langs = langsOf(spec);
    const own = textOf(spec.node.label, langs);
    return String(own || textOf(target.label, langs) || spec.node.target);
  };

  const k = kit();
  const handle = k.form({
    target: host,
    submit: false,
    fields: [{
      name: 'value', id: id, type: type,
      label: wording(),
      min: target.min, max: target.max, step: target.step, unit: target.unit,
      value: start,
      options: kind === 'pick' ? (spec.node.options || []).map((o) => asOption(o, langsOf(spec))) : undefined,
      // The person's hand goes through the ENGINE, exactly where an agent's call goes: the input
      // is never the source of truth, it only reports.
      onInput(v) { spec.onSet(v); },
    }],
  });

  const root = handle.el;
  root.classList.add('ak-living__control');
  root.setAttribute('data-living-node', spec.id);
  root.setAttribute('data-living-kind', kind);
  const field = root.querySelector('[data-ak-part="field"]');
  const input = /** @type {any} */ (root.querySelector('[data-ak-part="input"]'));
  const labelEl = root.querySelector('[data-ak-part="label"]');
  if (labelEl) labelEl.classList.add('ak-living__label');
  input.classList.add('ak-living__input');
  if (kind === 'slider') input.classList.add('ak-living__slider');
  const row = root.querySelector('[data-ak-part="range"]');
  if (row) row.classList.add('ak-living__control-row');

  // The reading is the kit's for a range, which already draws one, and ours for the number field,
  // which the kit gives none — one element either way, so the graph's words (a quantity with its
  // unit, a refusal in words) always land in the same place and an app has one class to target.
  // The kinds that show their own answer get none: see READS_OUT.
  let readoutEl = READS_OUT.indexOf(kind) < 0 ? null : root.querySelector('[data-ak-part="readout"]');
  if (!readoutEl && READS_OUT.indexOf(kind) >= 0) {
    readoutEl = el('output', { class: 'ak-form__readout', 'data-ak-part': 'readout', for: id });
    (field || root).appendChild(readoutEl);
  }
  if (readoutEl) readoutEl.classList.add('ak-living__readout');

  function update(v) {
    if (kind === 'toggle') {
      const on = !!(v === true || asNumber(v) === 1);
      if (input.checked !== on) handle.setValues({ value: on });
    } else if (kind === 'text' || kind === 'pick') {
      const s = isQuantity(v) ? String(v.n) : asText(v);
      if (input.value !== s) handle.setValues({ value: s });
    } else {
      const n = asNumber(v);
      if (Number.isFinite(n) && String(n) !== input.value) handle.setValues({ value: n });
    }
    if (!readoutEl) return;
    const words = readout(v, target.format, langsOf(spec)[0]);
    if (readoutEl.textContent !== words) readoutEl.textContent = words;
    // The kit mirrors the raw number into aria-valuetext; a living document knows the unit and
    // the refusal, so it says the same thing the eye is reading.
    if (input.hasAttribute('aria-valuetext')) input.setAttribute('aria-valuetext', words);
  }
  update(spec.value);

  /**
   * THE WORDS, WRITTEN AGAIN. The field, its options and the reading are the ones already on the
   * screen: nothing is rebuilt, so the slider does not move under a finger that is on it and the
   * kit's entrance does not run a second time for a change of language.
   * @param {any} value  what the target holds now, so the reading is re-written in the new writing
   */
  function relabel(value) {
    const langs = langsOf(spec);
    if (labelEl) {
      const words = wording();
      if (labelEl.textContent !== words) labelEl.textContent = words;
    }
    if (kind === 'pick' && input.options) {
      const wanted = (spec.node.options || []).map((o) => asOption(o, langs));
      for (let i = 0; i < input.options.length && i < wanted.length; i++) {
        if (input.options[i].textContent !== wanted[i].label) input.options[i].textContent = wanted[i].label;
      }
    }
    update(value === undefined ? spec.value : value);
  }
  return { el: root, update: update, relabel: relabel };
}

/**
 * A sentence that changes with the graph. Text, never markup.
 * @param {HTMLElement} host @param {{ id: string, label?: string, text: string }} spec
 */
export function textView(host, spec) {
  const body = el('p', { class: 'ak-living__text', text: spec.text });
  const labelEl = spec.label ? el('span', { class: 'ak-living__note-label', text: spec.label }) : null;
  const root = el('div', { class: 'ak-living__note', 'data-living-node': spec.id }, [labelEl, body]);
  host.appendChild(root);
  return {
    el: root,
    update(text) { if (body.textContent !== text) body.textContent = String(text); },
    relabel(label) { if (labelEl && label != null && labelEl.textContent !== label) labelEl.textContent = String(label); },
  };
}

/**
 * The machine's states, with the one it is in marked. The STATE NAMES are the record's own ids —
 * what a guard and a formula compare against — so they read the same in every language; the
 * label above them is words, and follows.
 * @param {HTMLElement} host @param {{ id: string, label?: string, states: string[], path: string }} spec
 */
export function machineView(host, spec) {
  const chips = new Map();
  const strip = el('div', { class: 'ak-living__states', role: 'group' });
  for (const name of spec.states) {
    const chip = el('span', { class: 'ak-living__state', 'data-state': name, text: name });
    chips.set(name, chip);
    strip.appendChild(chip);
  }
  const labelEl = spec.label ? el('span', { class: 'ak-living__note-label', text: spec.label }) : null;
  const root = el('div', { class: 'ak-living__machine', 'data-living-node': spec.id }, [labelEl, strip]);
  host.appendChild(root);

  function update(path) {
    root.setAttribute('data-living-state', String(path || ''));
    const on = String(path || '').split('.');
    for (const [name, chip] of chips) {
      const active = on.indexOf(name) >= 0 || String(path) === name;
      chip.setAttribute('data-on', active ? 'yes' : 'no');
      chip.setAttribute('aria-current', active ? 'true' : 'false');
    }
  }
  update(spec.path);
  return {
    el: root,
    update: update,
    relabel(label) { if (labelEl && label != null && labelEl.textContent !== label) labelEl.textContent = String(label); },
  };
}

/**
 * A value, read out. A number counts to its new figure the way the kit's figures do, written the
 * way the node's `format` asks for all the way there.
 * @param {HTMLElement} host
 * @param {{ id: string, label?: string, value: any, format?: any, langs?: () => string[] }} spec
 */
export function valueRow(host, spec) {
  const figure = el('span', { class: 'ak-living__figure' });
  const unit = el('span', { class: 'ak-living__figure-unit' });
  const labelEl = el('span', { class: 'ak-living__note-label', text: spec.label || spec.id });
  const root = el('div', { class: 'ak-living__value', 'data-living-node': spec.id }, [
    labelEl,
    el('span', { class: 'ak-living__figure-row' }, [figure, unit]),
  ]);
  host.appendChild(root);
  let last = NaN;
  let unitNow = '';
  let placeNow = 'none';
  const write = function (n) {
    const body = formatNumber(n, spec.format, langsOf(spec)[0]);
    if (!unitNow || placeNow === 'none') return body;
    return placeNow === 'before' ? unitNow + ' ' + body : body + ' ' + unitNow;
  };
  function update(v) {
    const parts = formatParts(v, spec.format, undefined, langsOf(spec)[0]);
    if (isQuantity(v) || typeof v === 'number') {
      const n = isQuantity(v) ? v.n : v;
      unitNow = parts.unit;
      placeNow = parts.place;
      countTo(figure, Number.isFinite(last) ? last : n, n, write);
      last = n;
      // The unit keeps its own element unless the format placed it, in which case the number's
      // text already carries it.
      unit.textContent = parts.place === 'none' ? parts.unit : '';
      return;
    }
    figure.textContent = parts.text;
    unit.textContent = '';
    last = NaN;
  }
  update(spec.value);
  return {
    el: root,
    update: update,
    /**
     * The label, and the figure again: a number written with `locale: "auto"` changes its decimal
     * separator with the language even though the quantity did not move, so the count-up is not
     * re-run — the reading is simply written out again where it stands.
     */
    relabel(label, value) {
      if (label != null && labelEl.textContent !== label) labelEl.textContent = String(label);
      const v = value === undefined ? spec.value : value;
      const parts = formatParts(v, spec.format, undefined, langsOf(spec)[0]);
      if (isQuantity(v) || typeof v === 'number') {
        unitNow = parts.unit;
        placeNow = parts.place;
        figure.textContent = write(isQuantity(v) ? v.n : v);
        unit.textContent = parts.place === 'none' ? parts.unit : '';
      }
    },
  };
}

/** Every state name a machine definition declares, outermost first. */
export function statesOf(def) {
  const out = [];
  const walk = (states) => {
    for (const name of Object.keys(states || {})) {
      out.push(name);
      if (states[name] && states[name].states) walk(states[name].states);
    }
  };
  walk(def && def.states);
  return out;
}

/**
 * Put one node on the screen, whichever kind it is. Returns the handle whose update() the engine
 * calls when that node changes and whose relabel() it calls when the page changes language, or
 * null for a node that has no direct rendering.
 * @param {HTMLElement} host
 * @param {{ id: string, node: any, graph: any, langs?: () => string[],
 *   set: (id: string, v: any) => void }} spec
 * @returns {{ el: HTMLElement, update: (...args: any[]) => void, relabel: () => void, kind: string }|null}
 */
export function renderNodeInto(host, spec) {
  const node = spec.node;
  const graph = spec.graph;
  const langs = spec.langs || function () { return []; };
  const value = graph.valueOf(spec.id);
  const label = function () { return textOf(node.label, langs()); };
  if (node.type === 'control') {
    const target = graph.nodeOf(String(node.target)) || {};
    const view = controlRow(host, {
      id: spec.id, node: node, target: target, value: value, langs: langs,
      onSet(v) { spec.set(String(node.target), v); },
    });
    return {
      el: view.el,
      update: () => view.update(graph.valueOf(spec.id)),
      relabel: () => view.relabel(graph.valueOf(spec.id)),
      kind: 'control',
    };
  }
  if (node.type === 'formula') {
    const view = formulaView(host, {
      id: spec.id, label: label(), value: value, format: node.format, langs: langs,
      tex: (graph.fieldsOf(spec.id) || {}).tex || '',
      plain: spec.id + ' = ' + String(node.expr),
    });
    return {
      el: view.el,
      update: () => view.update(graph.valueOf(spec.id), (graph.fieldsOf(spec.id) || {}).tex || ''),
      relabel: () => view.relabel(label(), graph.valueOf(spec.id)),
      kind: 'formula',
    };
  }
  if (node.type === 'text') {
    const view = textView(host, { id: spec.id, label: label(), text: String(value == null ? '' : value) });
    return {
      el: view.el,
      update: () => view.update(String(graph.valueOf(spec.id) == null ? '' : graph.valueOf(spec.id))),
      relabel: () => view.relabel(label()),
      kind: 'text',
    };
  }
  if (node.type === 'machine') {
    const view = machineView(host, { id: spec.id, label: label(), states: statesOf(node), path: String(value || '') });
    return {
      el: view.el,
      update: () => view.update(String(graph.valueOf(spec.id) || '')),
      relabel: () => view.relabel(label()),
      kind: 'machine',
    };
  }
  if (node.type === 'value' || node.type === 'source') {
    const view = valueRow(host, { id: spec.id, label: label(), value: value, format: node.format, langs: langs });
    return {
      el: view.el,
      update: () => view.update(graph.valueOf(spec.id)),
      relabel: () => view.relabel(label() || spec.id, graph.valueOf(spec.id)),
      kind: node.type,
    };
  }
  return null;
}
