/**
 * @file common.js
 * @description Shared helpers for every Pixel Mirage extension action: input handling (base64 or a public
 *   memory ref), decode with the sandbox size ceilings, and the render cost model that refuses a
 *   recipe it cannot finish instead of letting it time out.
 * @structure MAX_B64 - MAX_SIZE - MAX_PNG_PIXELS - collectRecipe - loadImageBytes - decodeFor - assertAffordable
 * @usage var recipe = PM.normalizeRecipe(collectRecipe(input), MAX_SIZE);
 * @version-history
 *   v1.0.0 - 2026-07-25 - Initial agent-facing dither service.
 */

/*
 * The ceilings below are measured, not guessed. The node gives a sandboxed action 5 s of QuickJS
 * and 64 MB. On this node a 512 px render costs 1.0-2.4 s end to end and a 1.06 MP PNG costs 2.5 s to inflate on its own, so these are the numbers that leave headroom instead of producing
 * an "interrupted" that tells a buyer nothing.
 */
var MAX_B64 = 3 * 1024 * 1024;      // ~2.2 MB of image bytes (node JSON body limit is 5 MB)
var MAX_SIZE = 768;                 // longest edge the sandbox will render
var MAX_PNG_PIXELS = 900000;       // a PNG must be inflated whole — a JPEG can decode at 1/2, 1/4, 1/8

var RECIPE_KEYS = [
  'size', 'palette', 'colors', 'colorCount', 'algorithm', 'scale', 'strength', 'serpentine',
  'pixelate', 'angle', 'brightness', 'contrast', 'gamma', 'saturation', 'hue', 'sharpen',
  'invert', 'posterize', 'bias', 'zoom', 'offsetX', 'offsetY', 'rotate', 'fit',
];

function fail(message, hint) {
  var e = new Error(message);
  e.hint = hint;
  throw e;
}

/** Recipe fields may be nested under `recipe` or written flat on the input; flat wins. */
function collectRecipe(input, extra) {
  var r = {}, i, k;
  var nested = input && input.recipe;
  if (nested && typeof nested === 'object') {
    for (i = 0; i < RECIPE_KEYS.length; i++) {
      k = RECIPE_KEYS[i];
      if (nested[k] !== undefined && nested[k] !== null) r[k] = nested[k];
    }
  }
  for (i = 0; i < RECIPE_KEYS.length; i++) {
    k = RECIPE_KEYS[i];
    if (input && input[k] !== undefined && input[k] !== null) r[k] = input[k];
  }
  if (extra) {
    for (i = 0; i < RECIPE_KEYS.length; i++) {
      k = RECIPE_KEYS[i];
      if (extra[k] !== undefined && extra[k] !== null) r[k] = extra[k];
    }
  }
  return r;
}

/** Pull the image bytes out of whichever channel the caller used. */
async function loadImageBytes(ctx, input) {
  var b64 = input && input.image_base64;

  if (!b64 && input && input.image_ref) {
    var ref = input.image_ref, gaii, key;
    if (typeof ref === 'string') {
      var slash = ref.indexOf('/');
      if (slash < 0) fail('image_ref must be "<gaii>/<memory-key>" or {gaii, key}');
      gaii = ref.slice(0, slash); key = ref.slice(slash + 1);
    } else {
      gaii = ref.gaii; key = ref.key;
    }
    if (!gaii || !key) fail('image_ref needs both a gaii and a memory key');
    var rec;
    try {
      rec = await ctx.memory.getPublic(gaii, key);
    } catch (e) {
      fail('Could not read image_ref ' + gaii + '/' + key + ': ' + (e && e.message ? e.message : e),
        'The record must be a PUBLIC memory record owned by that identity.');
    }
    if (!rec) fail('No public memory record at ' + gaii + '/' + key);
    var v = rec.value !== undefined ? rec.value : rec;
    if (typeof v === 'string') b64 = v;
    else if (v && typeof v === 'object') b64 = v.b64 || v.base64 || v.data || v.image_base64;
    if (!b64) fail('The record at ' + gaii + '/' + key + ' holds no base64 image',
      'Store either a bare base64 string or an object with a b64 / base64 / data field.');
  }

  if (!b64) {
    fail('No image supplied',
      'Pass image_base64 (a data: URL or bare base64 of a PNG or baseline JPEG), or image_ref pointing at a public memory record that holds one.');
  }
  if (typeof b64 !== 'string') fail('image_base64 must be a string');
  if (b64.length > MAX_B64) {
    fail('Image is too large: ' + Math.round(b64.length / 1024) + ' KB of base64, limit is ' + Math.round(MAX_B64 / 1024) + ' KB',
      'Downscale the source first — output is capped at ' + MAX_SIZE + ' px, so about 1500 px of source is already more than the render can use.');
  }
  var bytes = PMC.b64decode(b64);
  if (bytes.length < 16) fail('image_base64 did not decode to any image data');
  return bytes;
}

function decodeFor(bytes, targetLongEdge) {
  var format = (bytes[0] === 0x89 && bytes[1] === 0x50) ? 'png'
    : (bytes[0] === 0xFF && bytes[1] === 0xD8) ? 'jpeg' : 'unknown';
  if (format === 'unknown') {
    fail('Unsupported image format', 'Send PNG or baseline JPEG bytes. WebP, GIF, AVIF and progressive JPEG are not decodable here.');
  }
  var img;
  try {
    img = PMC.decodeImage(bytes, targetLongEdge, MAX_PNG_PIXELS);
  } catch (e) {
    fail('Could not decode the ' + format + ': ' + (e && e.message ? e.message : e));
  }
  img.format = format;
  return img;
}

/*
 * Microseconds of QuickJS per OUTPUT pixel, measured on this node (see the live harness). The
 * point of pricing a render before starting it is that a caller gets "this recipe needs about
 * 6 s, drop size to 560 or pick a cheaper algorithm" instead of a bare "interrupted" five
 * seconds later — and gets it without being charged for a render that was never going to finish.
 */
var COST_US = {
  base: 2.4,            // resample + tone curve + palette-index write + PNG encode
  ordered: 1.0,
  noise: 1.6,
  halftone: 1.9,
  none: 0.8,
  diffusion_small: 3.6, // floyd-steinberg, burkes, sierra-lite, atkinson
  diffusion_large: 7.2, // jarvis, stucki, sierra
  sharpen: 2.8,
  bilinear: 3.8,        // rotation, or an upscale past the box fast path
  many_inks: 0.8,       // palettes over 4 entries pay for the nearest-colour cache
};
var WIDE_KERNELS = { jarvis: 1, stucki: 1, sierra: 1 };
var AUTO_PALETTE_MS = 220;   // median cut over the sampled pixels
var BUDGET_MS = 4200;        // of the sandbox's 5000, leaving room for marshalling the reply

function costPerPixelUs(recipe, geo) {
  var kind = PM.algorithmKind(recipe.algorithm);
  var per = COST_US.base;
  if (kind === 'diffusion') per += WIDE_KERNELS[recipe.algorithm] ? COST_US.diffusion_large : COST_US.diffusion_small;
  else per += COST_US[kind] || 1.0;
  if (recipe.sharpen > 0) per += COST_US.sharpen;
  if (geo.bilinear) per += COST_US.bilinear;
  if (!recipe.colors || recipe.colors.length > 4) per += COST_US.many_inks;
  return per;
}

/** Throw with a concrete, actionable alternative when a recipe cannot finish in the time left. */
function assertAffordable(recipe, img, spentMs, label) {
  var geo = PM.plan(img.width, img.height, recipe);
  var per = costPerPixelUs(recipe, geo);
  var fixed = recipe.colors ? 0 : AUTO_PALETTE_MS;
  var estimate = Math.round(geo.width * geo.height * per / 1000 + fixed);
  var left = BUDGET_MS - spentMs;

  if (estimate > left) {
    // Output pixels grow with size squared, so the affordable size is the current one scaled by
    // the square root of the pixel budget ratio.
    var affordablePx = Math.max(0, (left - fixed) * 1000 / per);
    var suggested = Math.floor(recipe.size * Math.sqrt(affordablePx / (geo.width * geo.height)) / 8) * 8;
    fail('This recipe needs about ' + estimate + ' ms of render time and only ' + Math.max(0, left)
      + ' ms is left in the sandbox budget after decoding' + (label ? ' (' + label + ')' : ''),
      suggested >= 64
        ? 'Set size to ' + suggested + ' or lower, or pick a cheaper algorithm (bayer4/bayer8 and threshold are the fastest, jarvis/stucki/sierra the slowest) or turn sharpen off.'
        : 'Send a smaller source image — decoding it already used ' + spentMs + ' ms of the ' + BUDGET_MS + ' ms budget.');
  }
  return { estimate_ms: estimate, per_pixel_us: Math.round(per * 10) / 10 };
}

function encodeResult(out) {
  var png = PMC.encodeIndexedPng(out.indices, out.width, out.height, out.palette);
  return { png: png, b64: PMC.b64encode(png) };
}

function paletteReport(recipe, out) {
  return { id: recipe.palette, colors: out.colors, count: out.colors.length };
}
