/**
 * @file dither.js
 * @description Extension action: one image plus one recipe in, one palette-indexed PNG out, with the fully
 *   normalised recipe echoed so the render is reproducible.
 * @structure the action entry point, `(ctx, input) => result`, as the default export
 * @usage POST /v1/ext/pixel-mirage/dither { image_base64, palette, algorithm, size }
 * @version-history
 *   v1.0.0 - 2026-07-25 - Initial agent-facing dither service.
 */

export default async function (ctx, input) {
  var t0 = Date.now();
  input = input || {};

  var raw = collectRecipe(input);
  var recipe = PM.normalizeRecipe(raw, MAX_SIZE);

  var bytes = await loadImageBytes(ctx, input);
  var tDecode0 = Date.now();
  // Rotation and zoom sample the source, so keep a little headroom over the output size.
  var need = Math.round(recipe.size * ((recipe.rotate !== 0 || recipe.zoom > 100) ? 1.35 : 1));
  var img = decodeFor(bytes, need);
  var tDecode = Date.now() - tDecode0;

  var budget = assertAffordable(recipe, img, Date.now() - t0);

  var tRender0 = Date.now();
  var out = PM.render(img.rgba, img.width, img.height, recipe);
  var tRender = Date.now() - tRender0;

  var tEnc0 = Date.now();
  var enc = encodeResult(out);
  var tEncode = Date.now() - tEnc0;

  var asDataUrl = input.return !== 'png';

  return {
    image: (asDataUrl ? 'data:image/png;base64,' : '') + enc.b64,
    format: 'png',
    width: out.width,
    height: out.height,
    bytes: enc.png.length,
    palette: paletteReport(recipe, out),
    recipe: recipe,
    source: { width: img.width, height: img.height, format: img.format },
    timing_ms: { decode: tDecode, render: tRender, encode: tEncode, total: Date.now() - t0, estimated_render: budget.estimate_ms },
  };
}
