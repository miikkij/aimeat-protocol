/**
 * @file living/nodes/index.js
 * @description THE REGISTRY, AND THE ONE PLACE A NEW NODE TYPE JOINS. Every type is a module
 *   exporting the same four things — dependsOn, prepare, evaluate and, when it can be written to,
 *   coerce — so the engine never knows what kind of node it is holding, and a later type
 *   (a generator: a procedural texture, an effect chain, an agent call) joins by writing one
 *   module and adding one line here.
 *
 *   THE VOCABULARY AN AI READS IS THE SAME FILES. Each module's @node / @inputs / @outputs /
 *   @options / @example JSDoc is read into describe-data.js by tools/build-living-nodes.ts, and
 *   pnpm check:living-nodes refuses a commit where the generated list and the modules disagree —
 *   so what living.describe() answers at run time and what the source says are the same thing by
 *   construction, the way the kit's own parts list already is.
 * @structure NODE_TYPES: id → module · typeOf(name)
 * @usage  import { NODE_TYPES } from './nodes/index.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { value } from './value.js';
import { formula } from './formula.js';
import { control } from './control.js';
import { binding } from './binding.js';
import { textNode } from './text-node.js';
import { machineNode } from './machine-node.js';
import { sourceNode } from './source.js';

/** Every node type this build knows, by the name a document writes in its `type` field. */
export const NODE_TYPES = {
  value: value,
  formula: formula,
  control: control,
  binding: binding,
  text: textNode,
  machine: machineNode,
  source: sourceNode,
};

/** One type module, or null when a document names a type this build does not have. */
export function typeOf(name) {
  return Object.prototype.hasOwnProperty.call(NODE_TYPES, String(name)) ? NODE_TYPES[String(name)] : null;
}
