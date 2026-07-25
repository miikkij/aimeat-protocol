/**
 * @file styles.js
 * @description Extension action: the catalogue. Every palette with its exact hex values, every algorithm with
 *   its character, the recipe defaults and the sandbox limits. Free, so discovery is never paywalled.
 * @structure the action entry point, `(ctx, input) => result`, as the default export
 * @usage POST /v1/ext/pixel-mirage/styles {}
 * @version-history
 *   v1.0.0 - 2026-07-25 - Initial agent-facing dither service.
 */

export default async function (ctx, input) {
  input = input || {};
  var palettes = [], i;
  for (i = 0; i < PM.PALETTES.length; i++) {
    var p = PM.PALETTES[i];
    palettes.push({ id: p.id, name: p.name, tags: p.tags, colors: p.colors, count: p.colors.length });
  }
  var algorithms = [];
  for (i = 0; i < PM.ALGORITHMS.length; i++) {
    var a = PM.ALGORITHMS[i];
    algorithms.push({ id: a.id, name: a.name, kind: a.kind, note: a.note });
  }
  return {
    palettes: palettes,
    algorithms: algorithms,
    defaults: PM.DEFAULTS,
    limits: {
      max_output_px: MAX_SIZE,
      max_image_base64_bytes: MAX_B64,
      max_variants_per_call: 6,
      max_variant_output_px: 384,
      max_png_source_pixels: MAX_PNG_PIXELS,
      accepted_formats: ['png', 'baseline jpeg'],
      palette_extraction: 'palette:"auto" with colorCount 2..16 runs median cut on the image itself',
    },
    recipe_keys: RECIPE_KEYS,
  };
}
