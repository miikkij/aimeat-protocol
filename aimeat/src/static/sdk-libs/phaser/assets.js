/**
 * @file phaser/assets.js
 * @description What a game loads, and what it can draw instead of loading.
 *
 *   pack() declares resources in one frozen manifest: images, spritesheets, atlases, audio,
 *   Tiled maps, JSON and bitmap fonts, with relative addresses resolved against the pack's base
 *   and the base against the page. A data: URI is REFUSED with a warning, because a base64 blob
 *   inside a single-file app is paid for on every load, in the page's own bytes, forever. Real
 *   files belong at /v1/pub/<owner>/… or in storage, and both are ordinary URLs.
 *
 *   preloadPack() registers a manifest on a scene's loader, draws the progress IN THE CANVAS on
 *   the Atelier colours, keeps going past a file that 404s (and says which one), and resolves
 *   with what arrived and what did not. It works from preload() and from create() alike: called
 *   during preload it lets the scene manager start the loader, called later it starts it itself.
 *
 *   textures generates art so a game runs with NO FILES AT ALL: named shapes, a tile set with
 *   simple shading, and a small hero with idle, run and jump animations. Every colour is a
 *   theme number, so the same generated art re-tones with the palette and the mode.
 *
 *   NOTHING LOOPS but the run cycle, which loops because a run cycle is what the caller asked
 *   for. The progress bar is torn down the moment the load finishes.
 * @structure pack · preloadPack (+ the in-canvas bar) · textures.shapes / .tiles / .character
 * @usage
 *   const art = pack({ id: 'level1', base: '/v1/pub/alice/game/', images: { sky: 'sky.png' } });
 *   function preload() { preloadPack(this, art); }        // the scene manager starts the loader
 *   async function create() { await preloadPack(this, art); }   // this call starts it
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the manifest, the loader with the in-canvas bar, and the
 *     generated shapes, tiles and character.
 */
import { theme, hex } from './boot.js';

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The manifest
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} PackSpec
 * @property {string} [id]                          a name for the pack, used in warnings
 * @property {string} [base]                        prefix for every relative address in the pack
 * @property {Record<string, string>} [images]
 * @property {Record<string, { url: string, frameWidth: number, frameHeight: number }>} [spritesheets]
 * @property {Record<string, { texture: string, data: string }>} [atlases]
 * @property {Record<string, string|string[]>} [audio]   one address, or the mp3 + ogg pair
 * @property {Record<string, string>} [tilemaps]    Tiled JSON
 * @property {Record<string, string>} [json]
 * @property {Record<string, { texture: string, data: string }>} [bitmapFonts]
 */

/**
 * Resolve one address against the pack's base, and refuse the one form that must not be here.
 * @param {string} url
 * @param {string} base
 * @param {string} id     the pack's name, for the warning
 * @param {string} key
 * @returns {string|null} the absolute address, or null when the entry is refused
 */
function address(url, base, id, key) {
  if (typeof url !== 'string' || !url.trim()) return null;
  if (url.slice(0, 5).toLowerCase() === 'data:') {
    console.warn('[aimeat-phaser] pack "' + id + '" entry "' + key + '" is a data: URI and was '
      + 'dropped. Serve the file (/v1/pub/<owner>/… or storage) and give the pack its address: a '
      + 'base64 blob is carried in the page on every single load.');
    return null;
  }
  return new URL(url, base).href;
}

/**
 * Copy a map of key → address, resolving and filtering as it goes.
 * @param {Record<string, string>|undefined} src
 * @param {string} base
 * @param {string} id
 * @returns {Record<string, string>|undefined}
 */
function urlMap(src, base, id) {
  if (!src) return undefined;
  /** @type {Record<string, string>} */
  const out = {};
  for (const key in src) {
    const url = address(src[key], base, id, key);
    if (url) out[key] = url;
  }
  return Object.freeze(out);
}

/**
 * Copy a map of key → { …, and one or two addresses }.
 * @param {Record<string, any>|undefined} src
 * @param {string} base
 * @param {string} id
 * @param {string[]} fields  the members that are addresses
 * @returns {Record<string, any>|undefined}
 */
function entryMap(src, base, id, fields) {
  if (!src) return undefined;
  /** @type {Record<string, any>} */
  const out = {};
  for (const key in src) {
    const from = src[key];
    if (!from) continue;
    /** @type {any} */
    const entry = {};
    let ok = true;
    for (const name in from) entry[name] = from[name];
    for (const field of fields) {
      const url = address(from[field], base, id, key);
      if (!url) { ok = false; break; }
      entry[field] = url;
    }
    if (ok) out[key] = Object.freeze(entry);
  }
  return Object.freeze(out);
}

/**
 * Audio takes one address or a list of them (the mp3 + ogg pair every browser between them can
 * play), so it resolves either shape.
 * @param {Record<string, string|string[]>|undefined} src
 * @param {string} base
 * @param {string} id
 * @returns {Record<string, string[]>|undefined}
 */
function audioMap(src, base, id) {
  if (!src) return undefined;
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const key in src) {
    const from = src[key];
    const list = Array.isArray(from) ? from : [from];
    /** @type {string[]} */
    const urls = [];
    for (const one of list) {
      const url = address(one, base, id, key);
      if (url) urls.push(url);
    }
    if (urls.length) out[key] = /** @type {string[]} */ (Object.freeze(urls));
  }
  return Object.freeze(out);
}

/**
 * Declare a pack. The result is frozen: a manifest is a statement of what a level needs, and a
 * thing two scenes share must not be edited by either of them.
 * @param {PackSpec} spec
 * @returns {Readonly<any>}
 */
export function pack(spec) {
  const s = spec || /** @type {PackSpec} */ ({});
  const id = s.id || 'pack';
  // The base resolves against the page, so a relative base ('assets/') means what it looks like
  // it means from wherever the app is served.
  const base = new URL(s.base || '.', location.href).href;
  return Object.freeze({
    id: id,
    base: base,
    images: urlMap(s.images, base, id),
    spritesheets: entryMap(s.spritesheets, base, id, ['url']),
    atlases: entryMap(s.atlases, base, id, ['texture', 'data']),
    audio: audioMap(s.audio, base, id),
    tilemaps: urlMap(s.tilemaps, base, id),
    json: urlMap(s.json, base, id),
    bitmapFonts: entryMap(s.bitmapFonts, base, id, ['texture', 'data']),
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The load
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/** The scene status the scene manager sets just before it starts the loader itself. */
function loadingStatus() {
  const P = /** @type {any} */ (window).Phaser;
  return P && P.Scenes && typeof P.Scenes.LOADING === 'number' ? P.Scenes.LOADING : 3;
}

/**
 * Put one manifest on a loader.
 * @param {any} loader
 * @param {any} manifest
 * @param {Set<string>} keys  every key registered, so the result can be told apart from whatever
 *   else the app queued on the same loader
 * @returns {number} how many files were registered
 */
function register(loader, manifest, keys) {
  let count = 0;
  const put = function (key) { keys.add(key); count++; };
  const images = manifest.images || {};
  for (const key in images) { loader.image(key, images[key]); put(key); }
  const sheets = manifest.spritesheets || {};
  for (const key in sheets) {
    const sheet = sheets[key];
    loader.spritesheet(key, sheet.url, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
    put(key);
  }
  const atlases = manifest.atlases || {};
  for (const key in atlases) { loader.atlas(key, atlases[key].texture, atlases[key].data); put(key); }
  const sounds = manifest.audio || {};
  for (const key in sounds) { loader.audio(key, sounds[key]); put(key); }
  const maps = manifest.tilemaps || {};
  for (const key in maps) { loader.tilemapTiledJSON(key, maps[key]); put(key); }
  const blobs = manifest.json || {};
  for (const key in blobs) { loader.json(key, blobs[key]); put(key); }
  const fonts = manifest.bitmapFonts || {};
  for (const key in fonts) { loader.bitmapFont(key, fonts[key].texture, fonts[key].data); put(key); }
  return count;
}

/**
 * The progress bar, drawn in the canvas on the theme's colours: a rounded track, the fill, and
 * the file name in the mono face. It is INFORMATION, so reduced motion does not take it away;
 * there is nothing to take away, because it moves only when the load moves.
 * @param {any} scene
 * @param {any} look
 * @param {{ x?: number, y?: number, width?: number }} place
 * @returns {{ set: (p: number, name: string) => void, destroy: () => void }}
 */
function progressBar(scene, look, place) {
  const gameWidth = scene.scale.width;
  const gameHeight = scene.scale.height;
  const width = place.width || Math.min(360, Math.round(gameWidth * 0.6));
  const height = 14;
  const radius = 7;
  const left = place.x != null ? place.x : Math.round((gameWidth - width) / 2);
  const top = place.y != null ? place.y : Math.round((gameHeight - height) / 2);

  const shape = scene.add.graphics();
  shape.setDepth(9999).setScrollFactor(0);
  const label = scene.add.text(left, top + height + 8, '', {
    fontFamily: look.fontMono,
    fontSize: '12px',
    color: hex(look.inkDim),
  });
  label.setDepth(9999).setScrollFactor(0);

  return {
    set(p, name) {
      const done = Math.max(0, Math.min(1, p || 0));
      shape.clear();
      shape.fillStyle(look.surface, 1).fillRoundedRect(left, top, width, height, radius);
      shape.lineStyle(1, look.line, 1).strokeRoundedRect(left, top, width, height, radius);
      const filled = Math.round(width * done);
      if (filled > 2) {
        shape.fillStyle(look.accent, 1)
          .fillRoundedRect(left, top, filled, height, Math.min(radius, filled / 2));
      }
      label.setText(Math.round(done * 100) + '%' + (name ? '  ' + name : ''));
    },
    destroy() {
      shape.destroy();
      label.destroy();
    },
  };
}

/**
 * @typedef {object} PreloadOptions
 * @property {false|{ x?: number, y?: number, width?: number }} [bar]  false hides the bar; an
 *   object places it. Default: centred, at 60% of the canvas width.
 * @property {any} [theme]  a theme object to draw the bar with. Default: read off the canvas.
 * @property {(p: number, file: string) => void} [onProgress]
 * @property {(entry: { key: string, url: string, type: string }) => void} [onFail]
 */

/**
 * Load one pack, or several, into a scene.
 *
 * TWO CALL SITES, one function. From `preload()` the scene manager starts the loader once preload
 * returns, so this call only registers and waits. From `create()` (or anywhere later) nothing is
 * going to start it, so this call does. Which one you are at is read from the scene's own status,
 * not guessed.
 *
 * A file that fails is COLLECTED, not thrown: one missing sprite must not take the level with it.
 * The result says exactly which addresses did not answer.
 *
 * @param {any} scene
 * @param {any|any[]} packOrPacks
 * @param {PreloadOptions} [opts]
 * @returns {Promise<{ loaded: string[], failed: Array<{ key: string, url: string, type: string }> }>}
 */
export function preloadPack(scene, packOrPacks, opts) {
  const o = opts || /** @type {PreloadOptions} */ ({});
  const manifests = Array.isArray(packOrPacks) ? packOrPacks : [packOrPacks];
  const loader = scene.load;
  /** @type {Set<string>} */
  const mine = new Set();
  let queued = 0;
  for (const manifest of manifests) {
    if (manifest) queued += register(loader, manifest, mine);
  }

  /** @type {Array<{ key: string, url: string, type: string }>} */
  const failed = [];
  /** @type {string[]} */
  const loaded = [];

  if (!queued) return Promise.resolve({ loaded: loaded, failed: failed });

  const look = o.theme || theme(scene.game.canvas);
  const bar = o.bar === false ? null : progressBar(scene, look, o.bar || {});
  if (bar) bar.set(0, '');

  return new Promise(function (ok) {
    let last = '';
    const onFileProgress = function (file, value) {
      last = (file && file.key) || '';
      if (o.onProgress) o.onProgress(loader.progress, last);
      if (bar) bar.set(loader.progress, last);
      // `value` is this one file's share; the bar shows the whole load, which is what a person
      // waiting for the level wants to see.
      void value;
    };
    const onProgress = function (value) {
      if (o.onProgress) o.onProgress(value, last);
      if (bar) bar.set(value, last);
    };
    const onFileDone = function (key) {
      if (mine.has(key)) loaded.push(key);
    };
    const onError = function (file) {
      const entry = {
        key: (file && file.key) || '',
        url: (file && file.url) || '',
        type: (file && file.type) || '',
      };
      if (!mine.has(entry.key)) return;
      failed.push(entry);
      if (o.onFail) o.onFail(entry);
      console.warn('[aimeat-phaser] "' + entry.key + '" did not load from ' + entry.url
        + '. The rest of the pack keeps loading.');
    };
    const onComplete = function () {
      loader.off('fileprogress', onFileProgress);
      loader.off('progress', onProgress);
      loader.off('filecomplete', onFileDone);
      loader.off('loaderror', onError);
      loader.off('complete', onComplete);
      if (bar) bar.destroy();
      ok({ loaded: loaded, failed: failed });
    };

    loader.on('fileprogress', onFileProgress);
    loader.on('progress', onProgress);
    loader.on('filecomplete', onFileDone);
    loader.on('loaderror', onError);
    loader.on('complete', onComplete);

    const status = scene.sys && scene.sys.settings ? scene.sys.settings.status : null;
    const managerWillStart = typeof status === 'number' && status < loadingStatus();
    if (!managerWillStart && !loader.isLoading()) loader.start();
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   Art without files
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Move a colour toward white (a positive amount) or toward black (a negative one). This is how
 * every generated texture gets its shading: one theme colour in, a lit face and a shadowed face
 * out, so the art re-tones with the palette instead of carrying paint of its own.
 * @param {number} colour 0xrrggbb
 * @param {number} amount -1..1
 * @returns {number}
 */
function shade(colour, amount) {
  const end = amount >= 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(amount));
  const mix = function (c) { return Math.round(c + (end - c) * k); };
  const r = mix((colour >> 16) & 255);
  const g = mix((colour >> 8) & 255);
  const b = mix(colour & 255);
  return (r << 16) | (g << 8) | b;
}

/**
 * A graphics object that is never added to the scene: it exists to be drawn once and turned into
 * a texture, so it must not spend a frame on screen first.
 * @param {any} scene
 * @returns {any}
 */
function pen(scene) {
  return scene.make.graphics({ add: false });
}

/**
 * Named shapes, drawn by the caller and kept as textures.
 * @param {any} scene
 * @param {Array<{ key: string, width?: number, height?: number,
 *   draw: (g: any, look: any) => void }>} list
 * @returns {string[]} the keys now available to `scene.add.image` and friends
 */
function shapes(scene, list) {
  const look = theme(scene.game.canvas);
  /** @type {string[]} */
  const made = [];
  for (const item of list || []) {
    if (!item || !item.key || typeof item.draw !== 'function') continue;
    made.push(item.key);
    // An existing key is left alone: generateTexture would draw over the old canvas rather than
    // replace it, and a half-overwritten texture is a bug that looks like a rendering fault.
    if (scene.textures.exists(item.key)) continue;
    const g = pen(scene);
    item.draw(g, look);
    g.generateTexture(item.key, item.width || 32, item.height || 32);
    g.destroy();
  }
  return made;
}

/** Which theme colour each known tile kind takes when the caller does not name one. */
const TILE_COLOUR = {
  ground: 'line',
  brick: 'warn',
  spike: 'err',
  coin: 'ch3',
  goal: 'ok',
  water: 'ch1',
  crate: 'warn',
};

/**
 * Draw one tile kind. Everything is derived from a single colour plus its lit and shadowed
 * shades, which is what makes a whole tile set answer one token.
 * @param {any} g
 * @param {string} kind
 * @param {number} colour
 * @param {number} size
 * @param {any} look
 */
function drawTile(g, kind, colour, size, look) {
  const lit = shade(colour, 0.32);
  const dark = shade(colour, -0.3);
  const edge = Math.max(2, Math.round(size / 8));

  if (kind === 'spike') {
    g.fillStyle(dark, 1).fillRect(0, size - edge, size, edge);
    const teeth = 3;
    const step = size / teeth;
    for (let i = 0; i < teeth; i++) {
      const x = i * step;
      g.fillStyle(colour, 1).fillTriangle(x, size - edge, x + step / 2, edge / 2, x + step, size - edge);
      g.fillStyle(lit, 1).fillTriangle(x, size - edge, x + step / 2, edge / 2, x + step / 2, size - edge);
    }
    return;
  }

  if (kind === 'coin') {
    const r = size / 2 - edge / 2;
    g.fillStyle(dark, 1).fillCircle(size / 2, size / 2, r);
    g.fillStyle(colour, 1).fillCircle(size / 2, size / 2, r - edge / 2);
    g.fillStyle(lit, 1).fillCircle(size / 2 - r / 4, size / 2 - r / 4, r / 3);
    return;
  }

  if (kind === 'goal') {
    const poleWidth = Math.max(2, Math.round(size / 10));
    g.fillStyle(look.inkDim, 1).fillRect(edge, 0, poleWidth, size);
    g.fillStyle(colour, 1).fillTriangle(edge + poleWidth, edge, size - edge, size / 3, edge + poleWidth, size * 0.6);
    return;
  }

  if (kind === 'brick') {
    g.fillStyle(colour, 1).fillRect(0, 0, size, size);
    g.fillStyle(dark, 1);
    g.fillRect(0, size / 2 - 1, size, 2);
    g.fillRect(size / 2 - 1, 0, 2, size / 2);
    g.fillRect(size / 4 - 1, size / 2, 2, size / 2);
    g.fillRect((size * 3) / 4 - 1, size / 2, 2, size / 2);
    g.fillStyle(lit, 1).fillRect(0, 0, size, 2);
    return;
  }

  // ground, water, crate and anything the caller named itself: a solid block with a lit top and
  // a shadowed bottom, which is enough to read as a surface at tile size.
  g.fillStyle(colour, 1).fillRect(0, 0, size, size);
  g.fillStyle(lit, 1).fillRect(0, 0, size, edge);
  g.fillStyle(dark, 1).fillRect(0, size - Math.round(edge / 2), size, Math.round(edge / 2));
}

/**
 * A tile set, generated. Each kind becomes one square texture keyed by its name (with `prefix`
 * in front when given), so a level built from the ASCII map in level.js can name them directly.
 * @param {any} scene
 * @param {{ size?: number, prefix?: string,
 *   kinds: Record<string, number|boolean|undefined> }} spec
 * @returns {string[]} the keys made
 */
function tiles(scene, spec) {
  const s = spec || { kinds: {} };
  const look = theme(scene.game.canvas);
  const size = s.size || 32;
  const prefix = s.prefix || '';
  /** @type {string[]} */
  const made = [];
  for (const kind in s.kinds || {}) {
    const key = prefix + kind;
    made.push(key);
    if (scene.textures.exists(key)) continue;
    const asked = s.kinds[kind];
    const token = TILE_COLOUR[kind] || 'accent';
    const colour = typeof asked === 'number' ? asked : look[token];
    const g = pen(scene);
    drawTile(g, kind, colour, size, look);
    g.generateTexture(key, size, size);
    g.destroy();
  }
  return made;
}

/** The six frames a generated hero carries: one idle, four of the run cycle, one in the air. */
const HERO_FRAMES = 6;

/**
 * Draw one hero frame at its place along the strip.
 * @param {any} g
 * @param {number} index  0 idle · 1..4 run · 5 jump
 * @param {number} left   where this frame starts on the strip
 * @param {number} w
 * @param {number} h
 * @param {{ body: number, visor: number, trim: number }} pal
 */
function drawHero(g, index, left, w, h, pal) {
  const running = index >= 1 && index <= 4;
  const jumping = index === 5;
  const step = running ? index - 1 : 0;
  // The run cycle: legs apart, together, apart the other way, together. The body bobs a pixel on
  // the two contact frames, which is what makes four frames read as a stride.
  const swing = running ? [1, 0, -1, 0][step] : 0;
  const bob = running ? [0, -1, 0, -1][step] : 0;

  const bodyW = Math.round(w * 0.6);
  const bodyH = Math.round(h * 0.5);
  const bodyX = left + Math.round((w - bodyW) / 2);
  const bodyY = Math.round(h * 0.16) + bob;
  const radius = Math.round(bodyW * 0.26);

  const legW = Math.max(3, Math.round(bodyW * 0.24));
  const legH = Math.round(h * 0.26);
  const legTop = bodyY + bodyH - 2;
  const legLeft = bodyX + Math.round(bodyW * 0.13);
  const legRight = bodyX + bodyW - Math.round(bodyW * 0.13) - legW;
  const reach = Math.max(2, Math.round(legH * 0.3));

  // Legs first, so the body sits over their tops.
  g.fillStyle(pal.trim, 1);
  if (jumping) {
    g.fillRect(legLeft, legTop, legW, legH - reach);
    g.fillRect(legRight, legTop, legW, legH - Math.round(reach / 2));
  } else {
    g.fillRect(legLeft, legTop, legW, legH + swing * reach);
    g.fillRect(legRight, legTop, legW, legH - swing * reach);
  }

  // The body: a rounded block, the shape a small hero reads as at any size.
  g.fillStyle(pal.body, 1).fillRoundedRect(bodyX, bodyY, bodyW, bodyH, radius);
  // The visor: one dark band across the upper third, which is the whole face.
  const visorH = Math.max(3, Math.round(bodyH * 0.26));
  g.fillStyle(pal.visor, 1).fillRoundedRect(
    bodyX + Math.round(bodyW * 0.16), bodyY + Math.round(bodyH * 0.18),
    Math.round(bodyW * 0.68), visorH, Math.round(visorH / 2),
  );
  // An arm on the near side, swinging against the legs and raised on the jump.
  const armW = Math.max(3, Math.round(bodyW * 0.22));
  const armH = Math.max(3, Math.round(bodyH * 0.26));
  const armY = bodyY + Math.round(bodyH * 0.5)
    - (jumping ? Math.round(bodyH * 0.3) : swing * Math.round(bodyH * 0.16));
  g.fillStyle(pal.trim, 1).fillRect(bodyX - Math.round(armW / 2), armY, armW, armH);
}

/**
 * A small hero, generated, with its animations registered: `<key>-idle`, `<key>-run`, `<key>-jump`.
 * A platformer runs on this alone, with no files anywhere.
 *
 * The run cycle repeats, because a run cycle that plays once is a stumble; idle and jump are
 * single frames and hold.
 *
 * @param {any} scene
 * @param {{ key?: string, width?: number, height?: number,
 *   palette?: { body?: number, visor?: number, trim?: number } }} [spec]
 * @returns {{ key: string, frames: number, anims: { idle: string, run: string, jump: string } }}
 */
function character(scene, spec) {
  const s = spec || {};
  const look = theme(scene.game.canvas);
  const key = s.key || 'hero';
  const w = s.width || 32;
  const h = s.height || 40;
  const asked = s.palette || {};
  const body = typeof asked.body === 'number' ? asked.body : look.accent;
  const pal = {
    body: body,
    visor: typeof asked.visor === 'number' ? asked.visor : look.ink,
    trim: typeof asked.trim === 'number' ? asked.trim : shade(body, -0.34),
  };
  const names = {
    idle: key + '-idle',
    run: key + '-run',
    jump: key + '-jump',
  };

  if (!scene.textures.exists(key)) {
    const g = pen(scene);
    for (let i = 0; i < HERO_FRAMES; i++) drawHero(g, i, i * w, w, h, pal);
    g.generateTexture(key, w * HERO_FRAMES, h);
    g.destroy();
    // generateTexture leaves one whole-strip frame, so the six frames are cut out by hand. This
    // is what lets the strip be used exactly like a loaded spritesheet.
    const texture = scene.textures.get(key);
    for (let i = 0; i < HERO_FRAMES; i++) texture.add(i, 0, i * w, 0, w, h);
  }

  if (!scene.anims.exists(names.idle)) {
    scene.anims.create({ key: names.idle, frames: [{ key: key, frame: 0 }], frameRate: 1 });
  }
  if (!scene.anims.exists(names.run)) {
    scene.anims.create({
      key: names.run,
      frames: [1, 2, 3, 4].map(function (f) { return { key: key, frame: f }; }),
      frameRate: 10,
      repeat: -1,
    });
  }
  if (!scene.anims.exists(names.jump)) {
    scene.anims.create({ key: names.jump, frames: [{ key: key, frame: 5 }], frameRate: 1 });
  }

  return { key: key, frames: HERO_FRAMES, anims: names };
}

/** Generated art: shapes the caller draws, a tile set, and a hero with its animations. */
export const textures = { shapes, tiles, character };
