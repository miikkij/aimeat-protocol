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
 * @structure controlRow · textView · machineView · valueRow · renderNodeInto
 * @usage  import { renderNodeInto } from './render.js';
 * @version-history
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

let seq = 0;
function uid() { seq += 1; return 'ak-living-' + seq; }

/**
 * How a value reads in a control's readout: the number in the target node's own writing, and the
 * unit when it has one. A readout has always shown the unit, so 'after' is what it asks for when
 * the node's format says nothing — a document with no format looks exactly as it did.
 * @param {any} v @param {any} format
 * @returns {string}
 */
function readout(v, format) { return formatParts(v, format, 'after').text; }

/** Which of the kit's field types each control kind is. */
const FIELD_TYPE = { slider: 'range', toggle: 'toggle', pick: 'select', number: 'number', text: 'text' };

/** One option of a pick, however the record wrote it: a bare value or { value, label }. */
function asOption(o) {
  const opt = o && typeof o === 'object' ? o : { value: o, label: String(o) };
  return { value: String(opt.value), label: String(opt.label == null ? opt.value : opt.label) };
}

/**
 * A control row: ONE kit form field, reporting continuously, with the graph's own words in the
 * reading beside it.
 * @param {HTMLElement} host
 * @param {{ id: string, node: any, target: any, value: any, onSet: (v: any) => void }} spec
 * @returns {{ el: HTMLElement, update: (value: any) => void }}
 */
export function controlRow(host, spec) {
  const kind = String(spec.node.kind || 'slider');
  const target = spec.target || {};
  const id = uid();
  const type = FIELD_TYPE[kind] || 'text';
  const start = kind === 'toggle'
    ? (spec.value === true || asNumber(spec.value) === 1)
    : (isQuantity(spec.value) ? spec.value.n : (spec.value == null ? null : asText(spec.value)));

  const k = kit();
  const handle = k.form({
    target: host,
    submit: false,
    fields: [{
      name: 'value', id: id, type: type,
      label: spec.node.label || target.label || spec.node.target,
      min: target.min, max: target.max, step: target.step, unit: target.unit,
      value: start,
      options: kind === 'pick' ? (spec.node.options || []).map(asOption) : undefined,
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

  // The reading is the kit's for a range, which already draws one, and ours for the kinds it does
  // not — one element either way, so the graph's words (a quantity with its unit, a refusal in
  // words) always land in the same place and an app has one class to target.
  let readoutEl = root.querySelector('[data-ak-part="readout"]');
  if (!readoutEl) {
    readoutEl = el('output', { class: 'ak-form__readout', 'data-ak-part': 'readout', for: id });
    (field || root).appendChild(readoutEl);
  }
  readoutEl.classList.add('ak-living__readout');

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
    const words = readout(v, target.format);
    if (readoutEl.textContent !== words) readoutEl.textContent = words;
    // The kit mirrors the raw number into aria-valuetext; a living document knows the unit and
    // the refusal, so it says the same thing the eye is reading.
    if (input.hasAttribute('aria-valuetext')) input.setAttribute('aria-valuetext', words);
  }
  update(spec.value);
  return { el: root, update: update };
}

/**
 * A sentence that changes with the graph. Text, never markup.
 * @param {HTMLElement} host @param {{ id: string, label?: string, text: string }} spec
 */
export function textView(host, spec) {
  const body = el('p', { class: 'ak-living__text', text: spec.text });
  const root = el('div', { class: 'ak-living__note', 'data-living-node': spec.id }, [
    spec.label ? el('span', { class: 'ak-living__note-label', text: spec.label }) : null, body,
  ]);
  host.appendChild(root);
  return { el: root, update(text) { if (body.textContent !== text) body.textContent = String(text); } };
}

/**
 * The machine's states, with the one it is in marked.
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
  const root = el('div', { class: 'ak-living__machine', 'data-living-node': spec.id }, [
    spec.label ? el('span', { class: 'ak-living__note-label', text: spec.label }) : null, strip,
  ]);
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
  return { el: root, update: update };
}

/**
 * A value, read out. A number counts to its new figure the way the kit's figures do, written the
 * way the node's `format` asks for all the way there.
 * @param {HTMLElement} host @param {{ id: string, label?: string, value: any, format?: any }} spec
 */
export function valueRow(host, spec) {
  const figure = el('span', { class: 'ak-living__figure' });
  const unit = el('span', { class: 'ak-living__figure-unit' });
  const root = el('div', { class: 'ak-living__value', 'data-living-node': spec.id }, [
    el('span', { class: 'ak-living__note-label', text: spec.label || spec.id }),
    el('span', { class: 'ak-living__figure-row' }, [figure, unit]),
  ]);
  host.appendChild(root);
  let last = NaN;
  let unitNow = '';
  let placeNow = 'none';
  const write = function (n) {
    const body = formatNumber(n, spec.format);
    if (!unitNow || placeNow === 'none') return body;
    return placeNow === 'before' ? unitNow + ' ' + body : body + ' ' + unitNow;
  };
  function update(v) {
    const parts = formatParts(v, spec.format);
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
  return { el: root, update: update };
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
 * calls when that node changes, or null for a node that has no direct rendering.
 * @param {HTMLElement} host
 * @param {{ id: string, node: any, graph: any, set: (id: string, v: any) => void }} spec
 * @returns {{ el: HTMLElement, update: (...args: any[]) => void, kind: string }|null}
 */
export function renderNodeInto(host, spec) {
  const node = spec.node;
  const graph = spec.graph;
  const value = graph.valueOf(spec.id);
  if (node.type === 'control') {
    const target = graph.nodeOf(String(node.target)) || {};
    const view = controlRow(host, {
      id: spec.id, node: node, target: target, value: value,
      onSet(v) { spec.set(String(node.target), v); },
    });
    return { el: view.el, update: () => view.update(graph.valueOf(spec.id)), kind: 'control' };
  }
  if (node.type === 'formula') {
    const view = formulaView(host, {
      id: spec.id, label: node.label, value: value, format: node.format,
      tex: (graph.fieldsOf(spec.id) || {}).tex || '',
      plain: spec.id + ' = ' + String(node.expr),
    });
    return { el: view.el, update: () => view.update(graph.valueOf(spec.id), (graph.fieldsOf(spec.id) || {}).tex || ''), kind: 'formula' };
  }
  if (node.type === 'text') {
    const view = textView(host, { id: spec.id, label: node.label, text: String(value == null ? '' : value) });
    return { el: view.el, update: () => view.update(String(graph.valueOf(spec.id) == null ? '' : graph.valueOf(spec.id))), kind: 'text' };
  }
  if (node.type === 'machine') {
    const view = machineView(host, { id: spec.id, label: node.label, states: statesOf(node), path: String(value || '') });
    return { el: view.el, update: () => view.update(String(graph.valueOf(spec.id) || '')), kind: 'machine' };
  }
  if (node.type === 'value' || node.type === 'source') {
    const view = valueRow(host, { id: spec.id, label: node.label, value: value, format: node.format });
    return { el: view.el, update: () => view.update(graph.valueOf(spec.id)), kind: node.type };
  }
  return null;
}
