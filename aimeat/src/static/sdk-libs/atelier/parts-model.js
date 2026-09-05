/**
 * @file atelier/parts-model.js
 * @description THE ONE WAY A COMPONENT IS CHANGED WITHOUT BEING FORKED. Every public component
 *   in this kit is customised through the same four things, and this module is what makes them
 *   the same four things rather than four per component.
 *
 *     PARTS      every element the kit builds inside a component carries its own stable class
 *                (`ak-<component>__<part>`) AND `data-ak-part="<part>"`, so an app's own CSS
 *                targets a box by NAME instead of by DOM depth: `[data-ak-part="aside"] { … }`
 *                keeps working when the markup around it changes.
 *     SLOTS      `parts: { <part>: value }` on the spec replaces or fills that part. A value is
 *                a string, a DOM node, an array of either, or a FUNCTION of the row (or of
 *                nothing, for a block) returning one of those. A part the kit renders empty by
 *                default — `extra`, `aside`, `before`, `after` — appears the moment the app
 *                gives it something, which is how a row gains a third line or a right-hand
 *                figure without the app rewriting the row.
 *     VARIANTS   `variant: 'dense'` puts `data-ak-variant="dense"` on the component root, and
 *                the stylesheet reads it. A builder PICKS a legitimate shape rather than
 *                overriding one.
 *     TOKENS     every size and colour a builder would otherwise write into a rule is an
 *                `--ak-<component>-<thing>` property that falls back to the global one, so the
 *                app sets a variable on its own box and nothing else moves.
 *
 *   THE ENTRANCE, THE KEYING AND THE PICK ARE UNTOUCHED BY ALL OF IT. A slot's content is
 *   written into the row the component already built and keyed, inside the same `settle` /
 *   `keyedRows` pass, so a customised row still rises in, still glides when it moves, still
 *   fades out where it stood, and still reports the record it is showing NOW.
 *
 *   A part's declared name is the contract. `@parts`, `@slots`, `@variants` and `@tokens` lines
 *   in each component module's JSDoc are read by tools/build-atelier-parts.ts into
 *   describe-data.js, which is what `AIMEAT.atelier.describe(name)` answers with — so the list
 *   an app reads at run time and the list in the source are the same list by construction.
 * @structure partValue · fillPart · partEl · slotInto · variantOf · applyVariant
 * @usage
 *   import { partEl, slotInto, applyVariant } from './parts-model.js';
 *   const title = partEl('span', 'ak-list__title', 'title');
 *   slotInto(title, spec, 'title', item, item.title);      // app's, else the kit's own
 *   slotInto(row, spec, 'aside', item, null, 'span', 'ak-list__aside');   // empty unless given
 * @version-history
 *   v0.51.0 — 2026-09-05 — Initial (wish-atelier-always-excellent, part 3: nearly right, made
 *     right — one customisation model for every component).
 */
import { el } from './dom.js';

/**
 * What the app declared for one part, already called if it was a function.
 *
 * `undefined` means the app said NOTHING about this part and the kit's own default stands.
 * `null` (or a function returning null) means the app said "not this one", and the part is
 * left out — which is how a builder REMOVES a line rather than hiding it with CSS.
 * @param {any} spec  the component's own spec
 * @param {string} name  the part's declared name
 * @param {...any} args  what the part is being rendered for (the row, the tile, the card)
 * @returns {any}
 */
export function partValue(spec, name, ...args) {
  const parts = spec && spec.parts;
  if (!parts || typeof parts !== 'object') return undefined;
  if (!(name in parts)) return undefined;
  const v = parts[name];
  return typeof v === 'function' ? v.apply(null, args) : v;
}

/**
 * Whether the app declared anything at all for this part (without calling it).
 * @param {any} spec @param {string} name @returns {boolean}
 */
export function hasPart(spec, name) {
  const parts = spec && spec.parts;
  return !!(parts && typeof parts === 'object' && name in parts);
}

/**
 * Write one value into an element: text for a string or a number, the node itself for a node,
 * each member in turn for an array. Anything else is ignored rather than stringified, because
 * "[object Object]" in a row is worse than an empty line.
 * @param {HTMLElement} node
 * @param {any} value
 * @returns {boolean}  whether anything was written
 */
export function fillPart(node, value) {
  if (value == null || value === false) return false;
  if (Array.isArray(value)) {
    let any = false;
    for (const v of value) any = fillPart(node, v) || any;
    return any;
  }
  if (value instanceof Node) { node.appendChild(value); return true; }
  if (typeof value === 'string' || typeof value === 'number') {
    node.appendChild(document.createTextNode(String(value)));
    return true;
  }
  return false;
}

/**
 * One part's element: the kit's own class, and the declared name as `data-ak-part` so an app
 * reaches it without knowing how deep it sits.
 * @param {string} tag
 * @param {string} cls
 * @param {string} name
 * @param {object} [attrs]
 * @returns {HTMLElement}
 */
export function partEl(tag, cls, name, attrs) {
  const a = Object.assign({ class: cls, 'data-ak-part': name }, attrs || {});
  return el(tag, a);
}

/**
 * THE SLOT. Build the part, fill it with what the app declared (falling back to the kit's own
 * content), and append it to the host — or append nothing at all when neither has anything to
 * say, which is what keeps an unused `extra` or `aside` out of the DOM entirely.
 * @param {HTMLElement} host  where the part goes
 * @param {any} spec  the component's spec (its `parts` is read)
 * @param {string} name  the part's declared name
 * @param {any} own  the kit's own content for this part (string, node, or null)
 * @param {{ tag?: string, cls?: string, attrs?: object, args?: any[] }} [opts]
 * @returns {HTMLElement|null}  the part element, when one was appended
 */
export function slotInto(host, spec, name, own, opts) {
  const o = opts || {};
  const given = partValue(spec, name, ...(o.args || []));
  const value = given === undefined ? own : given;
  const node = partEl(o.tag || 'span', o.cls || '', name, o.attrs);
  if (!fillPart(node, value)) return null;
  host.appendChild(node);
  return node;
}

/**
 * The variant the app picked, when it is one this component actually has. An unknown name is
 * dropped with a word rather than stamped, because a typo that silently does nothing is the
 * shape of bug this whole model exists to remove.
 * @param {any} spec @param {string[]} allowed @returns {string|null}
 */
export function variantOf(spec, allowed) {
  const v = spec && spec.variant;
  if (v == null || v === '' || v === 'default') return null;
  if (allowed.indexOf(String(v)) >= 0) return String(v);
  console.warn('aimeat-atelier: unknown variant "' + v + '" — this component has: ' + allowed.join(', '));
  return null;
}

/**
 * Stamp the picked variant on the component root, where the stylesheet reads it.
 * @param {HTMLElement} root @param {any} spec @param {string[]} allowed @returns {string|null}
 */
export function applyVariant(root, spec, allowed) {
  const v = variantOf(spec, allowed);
  if (v) root.setAttribute('data-ak-variant', v);
  return v;
}
