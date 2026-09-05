/**
 * @file living/nodes/source.js
 * @description A VALUE THAT COMES FROM SOMEWHERE ELSE. A source node reads a memory key — the
 *   sensor an agent writes, the reading a device pushes, the record another app keeps — and puts
 *   it into the graph as an ordinary quantity, so a formula standing on it cannot tell whether a
 *   person moved a slider or a thermometer moved by itself.
 *
 *   IT RIDES THE ROAD THAT IS ALREADY THERE. Reading is AIMEAT.data when the page carries it, and
 *   staying up to date is the same aimeat-live-update event every profile tab listens for. No new
 *   protocol, no polling loop, no route: a document that follows a device needs no more platform
 *   than a document that does not.
 *
 *   WITHOUT THE LIBRARY IT IS A CONSTANT. A page with no aimeat-data on it — a test, a preview, a
 *   file opened from disk — falls back to the node's own `value`, so a document always renders.
 *   That is the same progressive rule the mosaic's live binding follows.
 *
 * @node     source    A live value from a memory key, or a constant when the page cannot read one.
 * @inputs   source    key (a memory key) · path (a dotted path inside the record) · value (the fallback)
 * @outputs  source    value — what the key holds now, with the node's unit on it
 * @options  source    unit · scope=own|public · owner (for a public read) · label
 * @example  source    { "type": "source", "key": "sensors.livingroom", "path": "celsius", "unit": "°C", "value": 21 }
 * @structure sourceNode: the node-type module (dependsOn · prepare · evaluate · read)
 * @usage  import { sourceNode } from './source.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parseUnit } from '../units.js';
import { isError } from '../formula-eval.js';
import { wrapValue } from './value.js';

/** Dig a dotted path out of a record; the record itself when no path was asked for. */
function dig(record, path) {
  if (!path) return record;
  let at = record;
  for (const key of String(path).split('.').filter(Boolean)) {
    if (at == null || typeof at !== 'object') return undefined;
    at = at[key];
  }
  return at;
}

/** The shapes a device writes, in the order a device is likely to have written them. */
const COMMON_FIELDS = ['value', 'reading', 'n', 'celsius', 'temp', 'amount'];

export const sourceNode = {
  id: 'source',
  settable: true,

  dependsOn() { return []; },

  prepare(node, ctx) {
    const errors = [];
    const unit = parseUnit(node.unit);
    if (isError(unit)) errors.push(unit.error);
    ctx.compiled.unit = isError(unit) ? null : unit;
    if (!ctx.state.values.has(ctx.id)) ctx.state.values.set(ctx.id, wrapValue(node.value, ctx.compiled.unit));
    return errors;
  },

  evaluate(node, ctx) { return ctx.state.values.get(ctx.id); },

  coerce(node, ctx, raw) {
    let v = raw;
    if (v != null && typeof v === 'object' && !Array.isArray(v) && typeof v.n !== 'number') {
      const dug = dig(v, node.path);
      v = dug;
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        for (const f of COMMON_FIELDS) if (typeof v[f] === 'number') { v = v[f]; break; }
      }
    } else if (node.path && v != null && typeof v === 'object') {
      v = dig(v, node.path);
    }
    if (v != null && typeof v === 'object' && typeof v.n === 'number') v = v.n;
    return wrapValue(v, ctx.compiled.unit);
  },

  /**
   * Read the key through the platform's data library, when the page has one. Resolves to
   * undefined where it cannot, and the fallback value stands.
   * @param {any} node
   * @returns {Promise<any>}
   */
  read(node) {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (!node.key || !ns || !ns.data) return Promise.resolve(undefined);
    const call = node.scope === 'public' && typeof ns.data.getPublic === 'function'
      ? ns.data.getPublic(node.owner, node.key)
      : (typeof ns.data.get === 'function' ? ns.data.get(node.key) : null);
    if (!call) return Promise.resolve(undefined);
    return Promise.resolve(call).catch(() => undefined);
  },
};
