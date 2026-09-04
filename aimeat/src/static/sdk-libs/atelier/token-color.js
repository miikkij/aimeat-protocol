/**
 * @file atelier/token-color.js
 * @description One probe, shared: read a --ak-* token off a live element as an sRGB colour, with
 *   the look, the palette and the mode all answered at once. A custom property's computed value
 *   is the raw token stream, so a color-mix() expression comes back UNRESOLVED; the probe span
 *   makes the browser resolve it (its `color` computes all the way to rgb() whatever the
 *   expression was), and a 1×1 canvas fill settles whichever colour space it came back in (oklab
 *   is color-mix's home) into bytes. Extracted from scene3d.js on 2026-09-05 when the ambient
 *   layer needed the same probe: one copy, which is what the copied-logic gate asks for.
 *
 *   Colour strings are assembled from the bytes, never written out, so the kit keeps its promise
 *   that no colour lives in JavaScript.
 * @structure tokenRgb(node, name, fallbackName) → [r, g, b] · tokenColor(node, name, fallbackName) → 'rgb(r,g,b)'
 * @usage
 *   import { tokenRgb, tokenColor } from './token-color.js';
 *   const [r, g, b] = tokenRgb(root, '--ak-accent');
 *   const css = tokenColor(root, '--ak-surface-2', '--ak-surface');
 * @version-history
 *   v0.47.0 — 2026-09-05 — Initial: a pure extraction of scene3d.js's tokenColor (v0.36.0), with
 *     tokenRgb underneath it for the renderers that want bytes.
 */

let colorCtx = null;

/**
 * The token's colour as sRGB bytes, resolved on `node` — the look, palette and mode it lives in.
 * @param {Element} node
 * @param {string} name  the custom property, e.g. '--ak-accent'
 * @param {string} [fallbackName]  a second token to read when the first is unset
 * @returns {[number, number, number]}
 */
export function tokenRgb(node, name, fallbackName) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = fallbackName
    ? 'var(' + name + ', var(' + fallbackName + ', currentColor))'
    : 'var(' + name + ', currentColor)';
  node.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  // The computed colour can come back in oklab() (color-mix's home space), which neither
  // THREE.Color nor a byte reader can parse — a 1×1 canvas fill settles any CSS colour the
  // browser knows into sRGB bytes.
  if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  colorCtx.fillStyle = resolved;
  colorCtx.fillRect(0, 0, 1, 1);
  const px = colorCtx.getImageData(0, 0, 1, 1).data;
  return [px[0], px[1], px[2]];
}

/**
 * The same colour as an rgb() string — what THREE.Color and a canvas fillStyle both take.
 * @param {Element} node
 * @param {string} name
 * @param {string} [fallbackName]
 * @returns {string}
 */
export function tokenColor(node, name, fallbackName) {
  const c = tokenRgb(node, name, fallbackName);
  return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
}
