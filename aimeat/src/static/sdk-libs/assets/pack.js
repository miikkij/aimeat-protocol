/**
 * @file assets/pack.js
 * @description Many small pictures into one sheet, in the browser, with no server and no build step.
 *
 *   WHY AN ATLAS AT ALL. Forty separate sprites are forty requests and forty texture binds; one
 *   sheet plus one JSON is two requests and one bind, and every engine on this node reads the
 *   TexturePacker JSON hash format, Phaser included. An app that generates its art (the phaser
 *   library's textures do) or lets a person drop files in can now ship the packed result instead of
 *   the loose pieces.
 *
 *   THE ALGORITHM IS SHELVES, and it is the right one here. Sprites are sorted tall to short and
 *   laid in rows, each row as high as its first sprite. It is a few percent worse than a full
 *   bin-packing tree on a pathological set and it is a handful of lines that anyone can read, which
 *   matters more for something that runs on a phone while a person waits.
 *
 *   IT LOADS WHAT IT IS GIVEN AND NOTHING ELSE. A source may be an image already on the page, an
 *   ImageBitmap, a Blob from a file input, or an address, and an address is fetched because packing
 *   is what the app asked for. Nothing is discovered, crawled or retried.
 * @structure loadSource() · shelve() · potUp() · packAtlas(images, opts)
 * @usage
 *   const packed = await AIMEAT.assets.packAtlas([{ key: 'coin', src: coinBlob }], { maxSize: 1024 });
 *   const sheet = await AIMEAT.assets.upload(packed.png, { app: 'ridge', key: 'ridge/atlas.png' });
 *   const data  = await AIMEAT.assets.upload(new Blob([JSON.stringify(packed.json)],
 *     { type: 'application/json' }), { app: 'ridge', key: 'ridge/atlas.json' });
 *   lib.add('atlases', 'main', { texture: sheet.url, data: data.url });
 *   await lib.save();
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the shelf packer, the TexturePacker JSON hash output and the
 *     PNG blob.
 */
import { refuse } from './manifest.js';

/** How wide and tall a sheet may get before a phone's GPU starts refusing it. */
const MAX_SIZE = 2048;

/** The gap between two frames, so a sprite never bleeds a neighbour's pixel at a fractional scale. */
const PADDING = 2;

/**
 * @typedef {object} PackSource
 * @property {string} key   the frame name a scene will draw with
 * @property {HTMLImageElement|ImageBitmap|Blob|string} src
 */

/**
 * Turn one source into something a canvas can draw, and say how big it is.
 * @param {PackSource} item
 * @returns {Promise<{ key: string, image: any, w: number, h: number }>}
 */
async function loadSource(item) {
  const key = item && item.key ? String(item.key) : '';
  if (!key) refuse('every image handed to packAtlas() needs a key: it becomes the frame name.');
  const src = item.src;
  if (!src) refuse('"' + key + '" has no src.');

  if (typeof src === 'string') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    try {
      await img.decode();
    } catch {
      refuse('"' + key + '" did not load from ' + src + '. An address from another site also has to '
        + 'allow a cross-origin read, or the packed sheet cannot be read back out of the canvas.');
    }
    return { key: key, image: img, w: img.naturalWidth, h: img.naturalHeight };
  }

  if (typeof Blob !== 'undefined' && src instanceof Blob) {
    const bitmap = await createImageBitmap(src);
    return { key: key, image: bitmap, w: bitmap.width, h: bitmap.height };
  }

  const any = /** @type {any} */ (src);
  const w = any.naturalWidth || any.width || 0;
  const h = any.naturalHeight || any.height || 0;
  if (!w || !h) {
    refuse('"' + key + '" has no size yet. An <img> has to have finished loading (await img.decode()) '
      + 'before it can be packed.');
  }
  if (any.decode && any.complete === false) await any.decode();
  return { key: key, image: any, w: w, h: h };
}

/**
 * Lay the sprites out in rows, tall to short. Each row is as high as its first sprite; a sprite
 * that will not fit the row starts the next one.
 * @param {Array<{ key: string, image: any, w: number, h: number }>} loaded
 * @param {number} maxSize
 * @param {number} padding
 * @returns {{ placed: Array<{ key: string, image: any, x: number, y: number, w: number, h: number }>,
 *   width: number, height: number }}
 */
function shelve(loaded, maxSize, padding) {
  const order = loaded.slice().sort(function (a, b) {
    return b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : 1);
  });
  /** @type {Array<{ key: string, image: any, x: number, y: number, w: number, h: number }>} */
  const placed = [];
  let x = padding;
  let y = padding;
  let shelfHeight = 0;
  let width = 0;

  for (const one of order) {
    if (one.w + padding * 2 > maxSize || one.h + padding * 2 > maxSize) {
      refuse('"' + one.key + '" is ' + one.w + '×' + one.h + ' and the sheet is capped at ' + maxSize
        + '. Raise maxSize, or keep that picture out of the atlas and load it on its own.');
    }
    if (x + one.w + padding > maxSize) {
      x = padding;
      y += shelfHeight + padding;
      shelfHeight = 0;
    }
    placed.push({ key: one.key, image: one.image, x: x, y: y, w: one.w, h: one.h });
    x += one.w + padding;
    if (x > width) width = x;
    if (one.h > shelfHeight) shelfHeight = one.h;
  }

  // `width` is already the right edge of the widest row plus its trailing gap, and `y` is the top
  // of the last row, so the sheet is exactly as big as what was laid in it.
  return { placed: placed, width: width, height: y + shelfHeight + padding };
}

/**
 * The next power of two at or above a number. Some older GPUs want their textures that way, and a
 * mipmapped texture always does.
 * @param {number} value
 * @returns {number}
 */
function potUp(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

/**
 * Get the PNG out of the canvas. toBlob is the only lossless way, and it is asynchronous.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function toPng(canvas) {
  return new Promise(function (resolve) {
    canvas.toBlob(function (blob) {
      if (!blob) refuse('the sheet could not be turned into a PNG. This happens when one of the '
        + 'pictures came from another site without permission to read it back.');
      resolve(/** @type {Blob} */ (blob));
    }, 'image/png');
  });
}

/**
 * @typedef {object} PackAtlasOptions
 * @property {number} [maxSize]   the sheet's cap, 2048 by default
 * @property {number} [padding]   pixels between frames, 2 by default
 * @property {boolean} [pot]      round the sheet up to a power of two
 * @property {string} [name]      what meta.image is called, 'atlas.png' by default
 */

/**
 * Pack pictures into one sheet plus the JSON that cuts it up.
 *
 * @param {PackSource[]} images
 * @param {PackAtlasOptions} [opts]
 * @returns {Promise<{ png: Blob, json: any, sheet: HTMLCanvasElement }>}
 */
export async function packAtlas(images, opts) {
  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!list.length) refuse('packAtlas() was given no pictures.');
  const o = opts || /** @type {PackAtlasOptions} */ ({});
  const maxSize = o.maxSize && o.maxSize > 0 ? Math.floor(o.maxSize) : MAX_SIZE;
  const padding = o.padding != null && o.padding >= 0 ? Math.floor(o.padding) : PADDING;

  /** @type {Record<string, boolean>} */
  const seen = {};
  for (const one of list) {
    const key = one && one.key ? String(one.key) : '';
    if (key && seen[key]) {
      refuse('"' + key + '" was handed to packAtlas() twice. A frame name has to be unique inside '
        + 'a sheet, or one of the two pictures is unreachable.');
    }
    seen[key] = true;
  }

  const loaded = [];
  for (const one of list) loaded.push(await loadSource(one));

  const laid = shelve(loaded, maxSize, padding);
  const width = o.pot ? potUp(laid.width) : laid.width;
  const height = o.pot ? potUp(laid.height) : laid.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) refuse('this browser gave no 2d canvas, so nothing can be packed here.');
  for (const frame of laid.placed) {
    /** @type {any} */ (ctx).drawImage(frame.image, frame.x, frame.y, frame.w, frame.h);
  }

  /** @type {Record<string, any>} */
  const frames = {};
  for (const frame of laid.placed) {
    frames[frame.key] = {
      frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.w, h: frame.h },
      sourceSize: { w: frame.w, h: frame.h },
    };
  }

  const json = {
    frames: frames,
    meta: {
      app: 'aimeat-assets',
      version: '1.0',
      image: o.name || 'atlas.png',
      format: 'RGBA8888',
      size: { w: width, h: height },
      scale: '1',
    },
  };

  const png = await toPng(canvas);
  return { png: png, json: json, sheet: canvas };
}
