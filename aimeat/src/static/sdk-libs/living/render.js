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
 *   EVERY CLASS HERE IS ak-living__*, and every size and colour in the stylesheet comes off an
 *   --ak-* token, so a living document wears the look of whatever page it is on.
 * @structure controlRow · textView · machineView · valueRow · renderNodeInto
 * @usage  import { renderNodeInto } from './render.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { el, countTo } from './dom.js';
import { formulaView } from './formula-view.js';
import { isError, isQuantity, asText, trimNumber, asNumber } from './formula-eval.js';
import { unitLabel } from './units.js';

let seq = 0;
function uid() { seq += 1; return 'ak-living-' + seq; }

/** How a value reads in a control's readout: the number, and the unit when it has one. */
function readout(v) {
  if (isError(v)) return v.error;
  if (isQuantity(v)) return trimNumber(v.n) + (unitLabel(v.u) ? ' ' + unitLabel(v.u) : '');
  return asText(v);
}

/**
 * A control row: a label, the input, and what it currently reads.
 * @param {HTMLElement} host
 * @param {{ id: string, node: any, target: any, value: any, onSet: (v: any) => void }} spec
 * @returns {{ el: HTMLElement, update: (value: any) => void }}
 */
export function controlRow(host, spec) {
  const kind = String(spec.node.kind || 'slider');
  const target = spec.target || {};
  const id = uid();
  const label = el('label', {
    class: 'ak-form__label ak-living__label', for: id, 'data-ak-part': 'label',
    text: spec.node.label || target.label || spec.node.target,
  });
  const value = el('output', { class: 'ak-living__readout', 'data-ak-part': 'readout', for: id });

  let input;
  if (kind === 'toggle') {
    input = el('input', { id: id, type: 'checkbox', class: 'ak-toggle ak-living__input' });
  } else if (kind === 'pick') {
    input = el('select', { id: id, class: 'ak-input ak-living__input' },
      (spec.node.options || []).map(function (o) {
        const opt = o && typeof o === 'object' ? o : { value: o, label: String(o) };
        return el('option', { value: String(opt.value) }, String(opt.label == null ? opt.value : opt.label));
      }));
  } else if (kind === 'text') {
    input = el('input', { id: id, type: 'text', class: 'ak-input ak-living__input' });
  } else {
    input = el('input', {
      id: id, class: 'ak-input ak-living__input' + (kind === 'slider' ? ' ak-living__slider' : ''),
      type: kind === 'slider' ? 'range' : 'number',
      min: target.min == null ? null : String(target.min),
      max: target.max == null ? null : String(target.max),
      step: target.step == null ? null : String(target.step),
    });
  }

  input.addEventListener('input', function () {
    const node = /** @type {any} */ (input);
    if (kind === 'toggle') { spec.onSet(!!node.checked); return; }
    if (kind === 'text' || kind === 'pick') { spec.onSet(node.value); return; }
    spec.onSet(node.value === '' ? null : Number(node.value));
  });

  const root = el('div', {
    class: 'ak-form__field ak-living__control', 'data-living-node': spec.id, 'data-living-kind': kind,
  }, [label, el('div', { class: 'ak-living__control-row' }, [input, value])]);
  host.appendChild(root);

  function update(v) {
    const node = /** @type {any} */ (input);
    if (kind === 'toggle') node.checked = !!(v === true || asNumber(v) === 1);
    else if (kind === 'text' || kind === 'pick') { const s = isQuantity(v) ? String(v.n) : asText(v); if (node.value !== s) node.value = s; }
    else { const n = asNumber(v); if (Number.isFinite(n) && String(n) !== node.value) node.value = String(n); }
    value.textContent = readout(v);
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
 * A value, read out. A number counts to its new figure the way the kit's figures do.
 * @param {HTMLElement} host @param {{ id: string, label?: string, value: any }} spec
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
  function update(v) {
    if (isQuantity(v) || typeof v === 'number') {
      const n = isQuantity(v) ? v.n : v;
      countTo(figure, Number.isFinite(last) ? last : n, n, trimNumber);
      last = n;
      unit.textContent = isQuantity(v) ? unitLabel(v.u) : '';
      return;
    }
    figure.textContent = asText(v);
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
      id: spec.id, label: node.label, value: value,
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
    const view = valueRow(host, { id: spec.id, label: node.label, value: value });
    return { el: view.el, update: () => view.update(graph.valueOf(spec.id)), kind: node.type };
  }
  return null;
}
