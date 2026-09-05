/**
 * @file living/describe-data.js
 * @description GENERATED — do not edit. Every node type's summary, inputs, outputs, options,
 *   language-map fields and worked example, read out of the node modules' own JSDoc by
 *   tools/build-living-nodes.ts.
 *   `AIMEAT.living.describe(type)` answers from this, so what an AI reads at run time and what
 *   the source says are the same thing by construction. Run `pnpm build:living-nodes` after
 *   changing an @node / @inputs / @outputs / @options / @languages / @example line;
 *   `pnpm check:living-nodes` refuses a commit where the two have drifted.
 * @structure NODES: one entry per node type
 * @usage  import { NODES } from './describe-data.js';
 * @version-history
 *   v1.1.0 — 2026-09-06 — Generated: `languages` joins each entry.
 *   v1.0.0 — 2026-09-05 — Generated (the living document, stage 1).
 */
export const NODES = {
  "binding": {
    summary: "One block prop on this screen reads one node.",
    inputs: ["from (the node whose output the prop takes)"],
    outputs: ["value — the same value, so the chain view can show where it went"],
    options: ["block (a layout block id)","prop (a prop path on that block, dots allowed)"],
    languages: [],
    example: {"type":"binding","block":"dial","prop":"value","from":"t"},
    file: "nodes/binding.js",
  },
  "control": {
    summary: "A slider, switch, pick, number or text field bound to one value node.",
    inputs: ["target (the value node this control moves)"],
    outputs: ["value — what the target holds now, so a template can read the control by name"],
    options: ["kind=slider|toggle|pick|number|text","label","options (for pick)","block (a section to put it in)"],
    languages: ["label","options[].label"],
    example: {"type":"control","kind":"slider","target":"t","label":{"fi":"Lämpötila","en":"Temperature"},"block":"controls"},
    file: "nodes/control.js",
  },
  "formula": {
    summary: "A spreadsheet expression over the other nodes, worked out with its units.",
    inputs: ["expr (an expression naming other nodes)"],
    outputs: ["value — the result, with its unit","tex — the same expression set as mathematics"],
    options: ["unit (convert the result, or name a plain one)","format (how the answer is printed: 1","\"int\"","\"unit\"","{ decimals, group, locale, style, currency, unit, prefix, suffix }; `locale: \"auto\"` writes the number in the page's language)","label","block (a section to print it in)"],
    languages: ["label"],
    example: {"type":"formula","expr":"t * 9/5 + 32","unit":"°F","format":1,"label":{"fi":"Fahrenheit","en":"Fahrenheit"},"block":"maths"},
    file: "nodes/formula.js",
  },
  "machine": {
    summary: "A statechart in XState's vocabulary; its output is the state it is in.",
    inputs: ["initial","states (nested allowed)","when (crossings that send events)"],
    outputs: ["value — the current state as a dotted path, e.g. \"hot\" or \"hot.rising\""],
    options: ["on { EVENT: { target, guard } }","entry","exit","after { ms: target }","block (a section to show it in)"],
    languages: ["label","the entry and exit assignments that write words"],
    example: {"type":"machine","initial":"fine","states":{"cold":{"on":{"WARM":"fine"}},"fine":{"on":{"HOT":"hot","COLD":"cold"}},"hot":{"entry":{"note":{"fi":"\"jäähdytä\"","en":"\"cool it down\""}},"on":{"COOL":{"target":"fine","guard":"t < 30"}}}},"when":[{"expr":"t > 30","send":"HOT"},{"expr":"t < 30","send":"COOL"},{"expr":"t < 5","send":"COLD"}]},
    file: "nodes/machine-node.js",
  },
  "source": {
    summary: "A live value from a memory key, or a constant when the page cannot read one.",
    inputs: ["key (a memory key)","path (a dotted path inside the record)","value (the fallback)"],
    outputs: ["value — what the key holds now, with the node's unit on it"],
    options: ["unit","format (how it is printed: 1","\"int\"","\"unit\"","an object; `locale: \"auto\"` writes the number in the page's language)","scope=own|public","owner (for a public read)","label"],
    languages: ["label"],
    example: {"type":"source","key":"sensors.livingroom","path":"celsius","unit":"°C","format":1,"value":21,"label":{"fi":"Olohuone","en":"Living room"}},
    file: "nodes/source.js",
  },
  "text": {
    summary: "A sentence over the graph: it changes when the numbers do.",
    inputs: ["template (with {{ node }}, {{ node | format }} and {{ if expr }}…{{ else }}…{{ end }})"],
    outputs: ["value — the rendered sentence"],
    options: ["block (a section to render it into)","label"],
    languages: ["template","label"],
    example: {"type":"text","template":{"fi":"Lämpötila on {{ t | 1 }} °C, {{ if t > 30 }}liian kuuma{{ else }}hyvä{{ end }}.","en":"It is {{ t | 1 }} °C, {{ if t > 30 }}too hot{{ else }}fine{{ end }}."},"block":"note"},
    file: "nodes/text-node.js",
  },
  "value": {
    summary: "A named quantity: the writable ground the rest of the document stands on.",
    inputs: ["value (the quantity itself, a literal — never a reference)"],
    outputs: ["value — the number with its unit, or the text, truth or list it holds"],
    options: ["unit","min","max","step","format (how it is printed: 1","\"int\"","\"unit\"","an object; `locale: \"auto\"` writes the number in the page's language)","label"],
    languages: ["label"],
    example: {"type":"value","value":22,"unit":"°C","min":-20,"max":40,"step":0.5,"format":1,"label":{"fi":"Lämpötila","en":"Temperature"}},
    file: "nodes/value.js",
  },
};
