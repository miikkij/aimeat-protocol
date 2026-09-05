/**
 * @file test/unit/phaser-stub-managers.mjs
 * @description The texture and animation managers of the fake Phaser scene, and the recording
 *   2D canvas context both they and the document's canvases hand out. A texture is a Map of
 *   frames added by hand the way the sprite sheets do; a canvas texture carries a context whose
 *   every call is recorded; an animation is a clip by key, refused as a duplicate the way
 *   Phaser refuses one.
 * @structure canvasContext() · textureObject() · texturesManager() · animsManager()
 * @usage  Internal to phaser-stub-scene.mjs; scripts reach them as scene.textures and scene.anims.
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial, split out of phaser-stub-objects.mjs.
 */
import { emitter } from './phaser-stub-objects.mjs';

/**
 * A recording CanvasRenderingContext2D: every property sticks and every method is a no-op that
 * records into `ctx.calls`. Gradients answer addColorStop; getImageData answers opaque pixels.
 * @returns {any}
 */
export function canvasContext(width, height) {
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1, globalCompositeOperation: 'source-over', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', imageSmoothingEnabled: true, calls: [], canvas: { width: width || 0, height: height || 0 } };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return (...a) => { t.calls.push([k, ...a]); return { stops: [], addColorStop(o, c) { this.stops.push([o, c]); } }; };
      if (k === 'createPattern') return () => ({});
      if (k === 'getImageData') return (x, y, w, h) => ({ width: w || 1, height: h || 1, data: new Uint8ClampedArray((w || 1) * (h || 1) * 4).fill(255) });
      if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
      if (k === 'isPointInPath') return () => false;
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return (...a) => { t.calls.push([k, ...a]); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function textureObject(key, w, h, extra) {
  const tex = Object.assign({ key, width: w || 0, height: h || 0, frames: new Map(), source: [{ width: w || 0, height: h || 0 }], log: [] }, extra || {});
  tex.add = function (name, sourceIndex, x, y, fw, fh) {
    const f = { name, sourceIndex, x, y, width: fw, height: fh, cutX: x, cutY: y, cutWidth: fw, cutHeight: fh, realWidth: fw, realHeight: fh, texture: tex };
    tex.frames.set(name, f);
    tex.log.push(['add', name, sourceIndex, x, y, fw, fh]);
    return f;
  };
  tex.get = (name) => tex.frames.get(name === undefined ? '__BASE' : name) || null;
  tex.has = (name) => tex.frames.has(name);
  tex.remove = (name) => tex.frames.delete(name);
  tex.getFrameNames = (includeBase) => [...tex.frames.keys()].filter((n) => includeBase || n !== '__BASE');
  tex.getFramesFromTextureSource = () => [...tex.frames.values()];
  tex.getSourceImage = () => tex.source[0];
  tex.setFilter = () => tex;
  Object.defineProperty(tex, 'frameTotal', { get: () => tex.frames.size });
  tex.add('__BASE', 0, 0, 0, tex.width, tex.height);
  return tex;
}

/**
 * The texture manager: a Map of textures by key (`entries`), each with frames added by hand
 * the way the sprite sheets do, and canvas textures with a recording 2D context.
 * `register(key, w, h)` is the door a script uses to fake a loaded image.
 * @returns {any}
 */
export function texturesManager() {
  const entries = new Map();
  const ev = emitter();
  const T = {
    kind: 'textures', entries, log: [], on: ev.on, once: ev.once, off: ev.off, emit: ev.emit,
    register(key, w, h, extra) { const tex = textureObject(key, w, h, extra); entries.set(key, tex); T.log.push(['register', key, w, h]); ev.emit('addtexture', key, tex); return tex; },
    exists: (key) => entries.has(key),
    get: (key) => entries.get(key) || (typeof key === 'object' && key ? key : missing()),
    getFrame: (key, frame) => { const t = entries.get(key); return t ? t.get(frame) : null; },
    remove: (key) => { const had = entries.delete(typeof key === 'string' ? key : key && key.key); T.log.push(['remove', key]); if (had) ev.emit('removetexture', key); return T; },
    removeKey: (key) => T.remove(key),
    list: () => [...entries.keys()],
    getTextureKeys: () => [...entries.keys()],
    each: (fn, ctx) => { for (const t of entries.values()) fn.call(ctx, t); },
    addImage: (key, img) => T.register(key, (img && img.width) || 32, (img && img.height) || 32, { from: 'image', image: img }),
    addBase64: (key) => T.register(key, 32, 32, { from: 'base64' }),
    addSpriteSheet: (key, img, cfg) => {
      const tex = T.register(key, (img && img.width) || cfg.frameWidth, (img && img.height) || cfg.frameHeight, { from: 'spritesheet' });
      const cols = Math.max(1, Math.floor(tex.width / cfg.frameWidth));
      const n = cfg.endFrame !== undefined ? cfg.endFrame + 1 : cols * Math.max(1, Math.floor(tex.height / cfg.frameHeight));
      for (let i = 0; i < n; i++) tex.add(i, 0, (i % cols) * cfg.frameWidth, Math.floor(i / cols) * cfg.frameHeight, cfg.frameWidth, cfg.frameHeight);
      return tex;
    },
    addCanvas: (key, canvas) => T.register(key, (canvas && canvas.width) || 0, (canvas && canvas.height) || 0, { from: 'canvas', canvas, context: canvasContext(canvas && canvas.width, canvas && canvas.height), getContext() { return this.context; }, refresh() { this.refreshed = (this.refreshed || 0) + 1; return this; } }),
    createCanvas: (key, w, h) => {
      if (entries.has(key)) return null;
      const context = canvasContext(w, h);
      return T.register(key, w, h, {
        from: 'canvas', context, refreshed: 0, canvas: { width: w, height: h, getContext: () => context },
        getContext() { return context; }, getCanvas() { return this.canvas; },
        refresh() { this.refreshed += 1; return this; }, clear() { context.calls.push(['clear']); return this; },
        draw() { return this; }, drawFrame() { return this; }, update() { return this; },
      });
    },
    getPixel: () => ({ r: 0, g: 0, b: 0, a: 255 }),
    setDefaultFilter: () => T,
  };
  function missing() { return textureObject('__MISSING', 32, 32); }
  T.register('__DEFAULT', 32, 32);
  T.register('__MISSING', 32, 32);
  return T;
}

/**
 * The animation manager: a Map of clips by key (`entries`). create() refuses a duplicate the
 * way Phaser does (returns false); generateFrameNumbers and generateFrameNames build frame lists.
 * @param {any} scene
 * @returns {any}
 */
export function animsManager(scene) {
  const entries = new Map();
  const ev = emitter();
  const A = {
    kind: 'anims', entries, log: [], globalTimeScale: 1, paused: false, on: ev.on, once: ev.once, off: ev.off, emit: ev.emit,
    exists: (key) => entries.has(key),
    get: (key) => entries.get(key) || null,
    create(cfg) {
      if (!cfg || entries.has(cfg.key)) return false;
      const anim = Object.assign({ frameRate: 24, repeat: 0, yoyo: false, delay: 0, duration: 0, hideOnComplete: false, showOnStart: false }, cfg);
      anim.frames = (cfg.frames || []).map((f) => (typeof f === 'object' && f ? f : { key: cfg.key, frame: f }));
      if (!anim.duration && anim.frames.length) anim.duration = (anim.frames.length / anim.frameRate) * 1000;
      entries.set(cfg.key, anim);
      A.log.push(['create', cfg.key]);
      ev.emit('add', cfg.key, anim);
      return anim;
    },
    remove(key) { const anim = entries.get(key); entries.delete(key); A.log.push(['remove', key]); return anim || null; },
    generateFrameNumbers(key, cfg) {
      const c = cfg || {};
      if (Array.isArray(c.frames)) return c.frames.map((frame) => ({ key, frame }));
      const tex = scene.textures.entries.get(key);
      const total = tex ? tex.frames.size - 1 : 0;
      const start = c.start === undefined ? (c.first === undefined ? 0 : c.first) : c.start;
      const end = c.end === undefined || c.end === -1 ? Math.max(start, total - 1) : c.end;
      const out = [];
      for (let i = start; i <= end; i++) out.push({ key, frame: i });
      return out;
    },
    generateFrameNames(key, cfg) {
      const c = cfg || {};
      const pad = (n) => (c.zeroPad ? String(n).padStart(c.zeroPad, '0') : String(n));
      if (Array.isArray(c.frames)) return c.frames.map((f) => ({ key, frame: (c.prefix || '') + pad(f) + (c.suffix || '') }));
      const out = [];
      for (let i = c.start === undefined ? 0 : c.start; i <= (c.end === undefined ? 0 : c.end); i++) out.push({ key, frame: (c.prefix || '') + pad(i) + (c.suffix || '') });
      return out;
    },
    pauseAll() { A.paused = true; return A; },
    resumeAll() { A.paused = false; return A; },
    play(key, children) { for (const c of Array.isArray(children) ? children : [children]) if (c && c.play) c.play(key); return A; },
    staggerPlay(key, children) { return A.play(key, children); },
    toJSON() { return { anims: [...entries.values()], globalTimeScale: A.globalTimeScale }; },
    fromJSON(data) { for (const a of (data && data.anims) || []) A.create(a); return A; },
    keys: () => [...entries.keys()],
  };
  return A;
}
