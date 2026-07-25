/**
 * @file variants.js
 * @description Extension action: render the same image up to six ways from ONE decode, so the frames are
 *   directly comparable and choosing a direction costs one call instead of six.
 * @structure the action entry point, `(ctx, input) => result`, as the default export
 * @usage POST /v1/ext/pixel-mirage/variants { image_base64, recipe, variants: [{ label, ... }] }
 * @version-history
 *   v1.0.0 - 2026-07-25 - Initial agent-facing dither service.
 */

var MAX_VARIANTS = 6;
var VARIANT_MAX_SIZE = 384;   // six renders share one 5 s budget with the decode

export default async function (ctx, input) {
  var t0 = Date.now();
  input = input || {};

  var list = input.variants;
  if (!Array.isArray(list) || list.length === 0) {
    fail('variants must be a non-empty array of recipe overrides',
      'Example: variants: [{"label":"riso","palette":"riso-trio"},{"label":"gameboy","palette":"gameboy","algorithm":"bayer8"}]');
  }
  if (list.length > MAX_VARIANTS) {
    fail('Too many variants: ' + list.length + ', the limit is ' + MAX_VARIANTS,
      'Split the sweep across several calls — every variant is a full render inside one time budget.');
  }

  var base = collectRecipe(input);
  if (base.size === undefined || base.size === null) base.size = 288;
  if (base.size > VARIANT_MAX_SIZE) base.size = VARIANT_MAX_SIZE;

  var bytes = await loadImageBytes(ctx, input);

  // Decode ONCE at the largest size any variant asks for, then render each from the same pixels:
  // that is what makes the sheet comparable — every frame sees identical source data.
  var need = base.size;
  for (var i = 0; i < list.length; i++) {
    var s = list[i] && list[i].size;
    if (typeof s === 'number' && s > need) need = Math.min(s, VARIANT_MAX_SIZE);
  }
  var tDecode0 = Date.now();
  var img = decodeFor(bytes, Math.round(need * 1.35));
  var tDecode = Date.now() - tDecode0;

  var results = [];
  for (var v = 0; v < list.length; v++) {
    var over = list[v] || {};
    var merged = collectRecipe({ recipe: base }, over);
    if (merged.size > VARIANT_MAX_SIZE) merged.size = VARIANT_MAX_SIZE;
    var recipe = PM.normalizeRecipe(merged, VARIANT_MAX_SIZE);
    // Every frame is priced against what is LEFT, so a sheet fails on the frame that would have
    // blown the budget and names it, instead of dying halfway with nothing to show.
    assertAffordable(recipe, img, Date.now() - t0, 'variant "' + (typeof over.label === 'string' ? over.label : v + 1) + '"');

    var tr = Date.now();
    var out = PM.render(img.rgba, img.width, img.height, recipe);
    var enc = encodeResult(out);

    var delta = {};
    for (var k in over) {
      if (Object.prototype.hasOwnProperty.call(over, k) && k !== 'label') delta[k] = over[k];
    }

    results.push({
      label: typeof over.label === 'string' ? over.label : 'variant ' + (v + 1),
      overrides: delta,
      image: 'data:image/png;base64,' + enc.b64,
      width: out.width,
      height: out.height,
      bytes: enc.png.length,
      palette: paletteReport(recipe, out),
      recipe: recipe,
      render_ms: Date.now() - tr,
    });
  }

  return {
    variants: results,
    count: results.length,
    base_recipe: PM.normalizeRecipe(base, VARIANT_MAX_SIZE),
    source: { width: img.width, height: img.height, format: img.format },
    timing_ms: { decode: tDecode, total: Date.now() - t0 },
  };
}
