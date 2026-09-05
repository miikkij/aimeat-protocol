/**
 * @file test/unit/phaser-stub-objects.mjs
 * @description The game objects of the fake Phaser scene in phaser-stub.mjs: the shared base
 *   (chainable setters, an event emitter, a call log), graphics with generateTexture, text,
 *   containers, sprites and images with an arcade body, tile sprites, shapes, zones, particle
 *   emitters whose bursts complete on the scene clock, groups, tilemaps with layers that collide
 *   the way Phaser 4's PutTileAt does, and the texture and animation managers. Nothing here
 *   draws; every call is recorded on the object (`obj.log`) and on the scene (`scene.log`) so a
 *   verification script asserts what a module asked Phaser to do.
 * @structure emitter() · gameObject() and the setter table · graphics · text · container · sprite
 *   / image / tileSprite / rectangle / circle / zone · body() · particles · group · tilemap
 *   (the texture and animation managers are in phaser-stub-managers.mjs)
 * @usage  Internal to phaser-stub-scene.mjs; scripts import makeScene from phaser-stub.mjs.
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial: the union of the thirteen scratch stubs of 2026-09-02.
 */

/** Phaser's tint modes, as boot.js and boss-steps.js read them off window.Phaser. */
export const TINT_MULTIPLY = 0;
export const TINT_FILL = 1;

/**
 * A small event emitter with Phaser's shape: on / once / off / emit / listenerCount.
 * @returns {any}
 */
export function emitter() {
  /** @type {Map<string, Array<{ fn: Function, once: boolean, ctx: any }>>} */
  const lists = new Map();
  const api = {
    on(name, fn, ctx) { list(name).push({ fn, once: false, ctx }); return api; },
    once(name, fn, ctx) { list(name).push({ fn, once: true, ctx }); return api; },
    addListener(name, fn, ctx) { return api.on(name, fn, ctx); },
    off(name, fn) {
      if (fn === undefined) { lists.delete(name); return api; }
      lists.set(name, list(name).filter((l) => l.fn !== fn));
      return api;
    },
    removeListener(name, fn) { return api.off(name, fn); },
    removeAllListeners(name) { if (name === undefined) lists.clear(); else lists.delete(name); return api; },
    emit(name, ...args) {
      const l = list(name).slice();
      if (!l.length) return false;
      for (const h of l) {
        if (h.once) api.off(name, h.fn);
        h.fn.apply(h.ctx, args);
      }
      return true;
    },
    listenerCount(name) { return list(name).length; },
    listeners(name) { return list(name).map((l) => l.fn); },
    eventNames() { return [...lists.keys()]; },
  };
  function list(name) {
    if (!lists.has(name)) lists.set(name, []);
    return lists.get(name);
  }
  return api;
}

/**
 * The chainable setters every game object answers, and what each one changes.
 * @type {Record<string, (o: any, ...a: any[]) => void>}
 */
const SETTERS = {
  setPosition(o, x, y) { o.x = x; o.y = y === undefined ? x : y; },
  setX(o, x) { o.x = x; },
  setY(o, y) { o.y = y; },
  setOrigin(o, x, y) { o.originX = x === undefined ? 0.5 : x; o.originY = y === undefined ? o.originX : y; },
  setDisplayOrigin(o, x, y) { o.displayOriginX = x; o.displayOriginY = y === undefined ? x : y; },
  setDepth(o, d) { o.depth = d; },
  setScrollFactor(o, x, y) { o.scrollFactorX = x; o.scrollFactorY = y === undefined ? x : y; },
  setAlpha(o, a) { o.alpha = a === undefined ? 1 : a; },
  setVisible(o, v) { o.visible = !!v; },
  setScale(o, x, y) { o.scaleX = x === undefined ? 1 : x; o.scaleY = y === undefined ? o.scaleX : y; sizeFromScale(o); },
  setDisplaySize(o, w, h) { o.displayWidth = w; o.displayHeight = h; o.scaleX = o.width ? w / o.width : 1; o.scaleY = o.height ? h / o.height : 1; },
  setSize(o, w, h) { o.width = w; o.height = h; sizeFromScale(o); if (o.input) { o.input.hitArea.width = w; o.input.hitArea.height = h; } },
  setAngle(o, a) { o.angle = a; o.rotation = (a * Math.PI) / 180; },
  setRotation(o, r) { o.rotation = r; o.angle = (r * 180) / Math.PI; },
  setFlipX(o, v) { o.flipX = !!v; },
  setFlipY(o, v) { o.flipY = !!v; },
  setFlip(o, x, y) { o.flipX = !!x; o.flipY = !!y; },
  toggleFlipX(o) { o.flipX = !o.flipX; },
  setTint(o, c) { o.tint = c === undefined ? 0xffffff : c; o.tintFill = false; o.isTinted = true; },
  setTintFill(o, c) { o.tint = c === undefined ? 0xffffff : c; o.tintFill = true; o.isTinted = true; },
  clearTint(o) { o.tint = 0xffffff; o.tintFill = false; o.isTinted = false; o.tintMode = TINT_MULTIPLY; },
  setTintMode(o, m) { o.tintMode = m; },
  setBlendMode(o, m) { o.blendMode = m; },
  setMask(o, m) { o.mask = m; },
  clearMask(o) { o.mask = null; },
  setInteractive(o, cfg) {
    const hit = cfg && cfg.hitArea ? cfg.hitArea : { x: 0, y: 0, width: o.width, height: o.height };
    o.input = { cfg: cfg === undefined ? null : cfg, hitArea: hit, enabled: true, cursor: cfg && cfg.cursor, draggable: !!(cfg && cfg.draggable), dropZone: !!(cfg && cfg.dropZone) };
  },
  disableInteractive(o) { if (o.input) o.input.enabled = false; },
  removeInteractive(o) { o.input = null; },
  setName(o, n) { o.name = n; },
  setActive(o, v) { o.active = !!v; },
  setState(o, s) { o.state = s; },
  setData(o, k, v) { if (typeof k === 'object' && k) for (const n in k) o.data.set(n, k[n]); else o.data.set(k, v); },
  setTexture(o, key, frame) { o.texture = { key }; o.frame = frameOf(frame); },
  setFrame(o, frame) { o.frame = frameOf(frame); },
  setCrop(o, x, y, w, h) { o.crop = x === undefined ? null : { x, y, width: w, height: h }; },
  setPipeline() {},
  setPostPipeline() {},
  setStyle(o, s) { Object.assign(o.style, s || {}); },
  setPadding() {},
};

function sizeFromScale(o) {
  o.displayWidth = o.width * o.scaleX;
  o.displayHeight = o.height * o.scaleY;
}

function frameOf(frame) {
  return { name: frame === undefined ? '__BASE' : frame };
}

/**
 * The base every object is built on. Records into `scene.log` and `scene.made`, carries an
 * emitter and Phaser's chainable setters, and forgets its scene on destroy the way Phaser does.
 * @param {any} scene
 * @param {string} kind
 * @param {Record<string, any>} [props]
 * @returns {any}
 */
export function gameObject(scene, kind, props) {
  const ev = emitter();
  const o = Object.assign({
    kind, type: kind, x: 0, y: 0, alpha: 1, visible: true, depth: 0, scrollFactorX: 1, scrollFactorY: 1,
    originX: 0.5, originY: 0.5, scaleX: 1, scaleY: 1, angle: 0, rotation: 0, width: 32, height: 32,
    tint: 0xffffff, tintFill: false, isTinted: false, tintMode: TINT_MULTIPLY, blendMode: 0, mask: null,
    flipX: false, flipY: false, active: true, name: '', state: 0, input: null, crop: null,
    parentContainer: null, destroyed: false, scene, data: new Map(), log: [],
    on: ev.on, once: ev.once, off: ev.off, emit: ev.emit, addListener: ev.addListener,
    removeListener: ev.removeListener, removeAllListeners: ev.removeAllListeners,
    listenerCount: ev.listenerCount, listeners: ev.listeners,
  }, props || {});
  for (const name in SETTERS) {
    o[name] = function (...args) {
      record(o, name, args);
      SETTERS[name](o, ...args);
      return o;
    };
  }
  o.getData = (k) => o.data.get(k);
  o.getBounds = () => {
    const w = o.displayWidth;
    const h = o.displayHeight;
    const left = o.x - w * o.originX;
    const top = o.y - h * o.originY;
    return { x: left, y: top, width: w, height: h, left, top, right: left + w, bottom: top + h, centerX: left + w / 2, centerY: top + h / 2 };
  };
  o.getCenter = () => { const b = o.getBounds(); return { x: b.centerX, y: b.centerY }; };
  o.getTopLeft = () => { const b = o.getBounds(); return { x: b.left, y: b.top }; };
  o.destroy = function (fromScene) {
    if (o.destroyed) return;
    record(o, 'destroy', fromScene === undefined ? [] : [fromScene]);
    o.destroyed = true;
    o.emit('destroy', o);
    if (o.parentContainer) o.parentContainer.remove(o);
    if (o.list) for (const c of o.list.slice()) c.destroy();
    if (o.body && o.body.enable) o.body.enable = false;
    o.scene = undefined;
    o.active = false;
  };
  sizeFromScale(o);
  scene.made.push(o);
  return o;
}

/** @param {any} o @param {string} method @param {any[]} args */
export function record(o, method, args) {
  const entry = { kind: o.kind, method, args, target: o };
  o.log.push(entry);
  if (o.scene && o.scene.log) o.scene.log.push(entry);
}

/* ── Graphics ──────────────────────────────────────────────────────────────────────────────── */

const DRAW_OPS = ['clear', 'fillStyle', 'lineStyle', 'fillGradientStyle', 'lineGradientStyle', 'fillRect',
  'strokeRect', 'fillRoundedRect', 'strokeRoundedRect', 'fillCircle', 'strokeCircle', 'fillEllipse',
  'strokeEllipse', 'fillTriangle', 'strokeTriangle', 'fillPoints', 'strokePoints', 'fillPoint',
  'lineBetween', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'strokePath', 'fillPath',
  'fillRectShape', 'strokeRectShape', 'fillCircleShape', 'strokeCircleShape', 'fillTriangleShape',
  'strokeTriangleShape', 'fillEllipseShape', 'strokeEllipseShape', 'strokeLineShape', 'slice',
  'save', 'restore', 'translateCanvas', 'scaleCanvas', 'rotateCanvas', 'setDefaultStyles'];

/**
 * A Graphics object. Every draw op lands in `g.ops` as [name, ...args]; clear() empties them
 * (leaving a ['clear'] marker so the object is still findable by what it drew).
 * @param {any} scene
 * @param {{ add?: boolean }} [opts]
 * @returns {any}
 */
export function graphics(scene, opts) {
  const g = gameObject(scene, 'graphics', { ops: [], added: !(opts && opts.add === false), width: 0, height: 0 });
  for (const name of DRAW_OPS) {
    g[name] = function (...args) {
      record(g, name, args);
      if (name === 'clear') g.ops = [['clear']];
      else g.ops.push([name, ...args]);
      return g;
    };
  }
  g.generateTexture = function (key, w, h) {
    record(g, 'generateTexture', [key, w, h]);
    scene.textures.register(key, w, h, { from: 'graphics', ops: g.ops.slice() });
    return g;
  };
  g.createGeometryMask = function () { return { kind: 'geometryMask', geometry: g, invertAlpha: false, destroy() {} }; };
  g.createBitmapMask = function () { return { kind: 'bitmapMask', bitmap: g, destroy() {} }; };
  return g;
}

/* ── Text ──────────────────────────────────────────────────────────────────────────────────── */

/** Every character is 7 px wide and a line is 14 px tall; a fontSize in the style scales both. */
export function textMetrics(str, style) {
  const size = style && style.fontSize ? parseFloat(String(style.fontSize)) || 14 : 14;
  const wrap = style && style.wordWrap && typeof style.wordWrap.width === 'number' ? style.wordWrap.width : 0;
  const cw = size / 2;
  const lines = wrapLines(String(str), wrap ? Math.max(1, Math.floor(wrap / cw)) : 0);
  const width = Math.max(0, ...lines.map((l) => l.length)) * cw;
  return { lines, width, height: lines.length * size };
}

function wrapLines(text, perLine) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!perLine) { out.push(para); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (next.length > perLine && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** @returns {any} */
export function text(scene, x, y, str, style) {
  const t = gameObject(scene, 'text', { x, y, text: '', style: Object.assign({}, style || {}), originX: 0, originY: 0 });
  const measure = () => { const m = textMetrics(t.text, t.style); t.width = m.width; t.height = m.height; sizeFromScale(t); };
  const chain = (name, fn) => { t[name] = function (...a) { record(t, name, a); fn(...a); measure(); return t; }; };
  chain('setText', (s) => { t.text = s == null ? '' : (Array.isArray(s) ? s.join('\n') : String(s)); });
  chain('setColor', (c) => { t.style.color = c; });
  chain('setFontSize', (s) => { t.style.fontSize = typeof s === 'number' ? s + 'px' : s; });
  chain('setFontFamily', (f) => { t.style.fontFamily = f; });
  chain('setFontStyle', (f) => { t.style.fontStyle = f; });
  chain('setFont', (f) => { t.style.font = f; });
  chain('setAlign', (a) => { t.style.align = a; });
  chain('setWordWrapWidth', (w) => { t.style.wordWrap = Object.assign({}, t.style.wordWrap, { width: w }); });
  chain('setLineSpacing', (n) => { t.style.lineSpacing = n; });
  chain('setStroke', (c, w) => { t.style.stroke = c; t.style.strokeThickness = w; });
  chain('setShadow', () => {});
  chain('setFixedSize', (w, h) => { t.style.fixedWidth = w; t.style.fixedHeight = h; });
  chain('setResolution', () => {});
  chain('setBackgroundColor', (c) => { t.style.backgroundColor = c; });
  t.getWrappedText = (s) => {
    const wrap = t.style.wordWrap && t.style.wordWrap.width;
    const cw = (t.style.fontSize ? parseFloat(String(t.style.fontSize)) || 14 : 14) / 2;
    return wrapLines(String(s == null ? t.text : s), wrap ? Math.max(1, Math.floor(wrap / cw)) : 0);
  };
  t.setText(str == null ? '' : str);
  return t;
}

/* ── Container ─────────────────────────────────────────────────────────────────────────────── */

/** @returns {any} */
export function container(scene, x, y, kids) {
  const c = gameObject(scene, 'container', { x: x || 0, y: y || 0, list: [], originX: 0, originY: 0, width: 0, height: 0 });
  const each = (k) => (Array.isArray(k) ? k : [k]);
  const chain = (name, fn) => { c[name] = function (...a) { record(c, name, a); const r = fn(...a); return r === undefined ? c : r; }; };
  chain('add', (k) => { for (const o of each(k)) { if (o.parentContainer && o.parentContainer !== c) o.parentContainer.remove(o); o.parentContainer = c; c.list.push(o); } });
  chain('addAt', (k, i) => { for (const o of each(k)) { o.parentContainer = c; c.list.splice(i, 0, o); } });
  chain('remove', (k, destroy) => { for (const o of each(k)) { const i = c.list.indexOf(o); if (i >= 0) c.list.splice(i, 1); o.parentContainer = null; if (destroy) o.destroy(); } });
  chain('removeAll', (destroy) => { for (const o of c.list.slice()) c.remove(o, destroy); });
  chain('bringToTop', (o) => { c.remove(o); c.list.push(o); o.parentContainer = c; });
  chain('sendToBack', (o) => { c.remove(o); c.list.unshift(o); o.parentContainer = c; });
  chain('moveTo', (o, i) => { c.remove(o); c.list.splice(i, 0, o); o.parentContainer = c; });
  chain('sort', (key) => { c.list.sort((a, b) => a[key] - b[key]); });
  chain('iterate', (fn, ctx) => { for (const o of c.list.slice()) fn.call(ctx, o); });
  chain('each', (fn, ctx) => { for (const o of c.list.slice()) fn.call(ctx, o); });
  chain('setExclusive', () => {});
  c.getAt = (i) => c.list[i];
  c.getByName = (n) => c.list.find((o) => o.name === n) || null;
  c.getIndex = (o) => c.list.indexOf(o);
  c.getAll = () => c.list.slice();
  c.exists = (o) => c.list.indexOf(o) >= 0;
  c.getFirst = (prop, value) => c.list.find((o) => o[prop] === value) || null;
  c.count = (prop, value) => c.list.filter((o) => o[prop] === value).length;
  Object.defineProperty(c, 'length', { get: () => c.list.length });
  Object.defineProperty(c, 'first', { get: () => c.list[0] || null });
  Object.defineProperty(c, 'last', { get: () => c.list[c.list.length - 1] || null });
  if (kids) c.add(kids);
  return c;
}

/* ── Sprites, images, tile sprites and shapes ──────────────────────────────────────────────── */

/**
 * An arcade physics body on an object. Velocity is a number the caller reads back; `scene.step()`
 * integrates it. `blocked` and `touching` are set by hand, the way a collision would.
 * @returns {any}
 */
export function body(o, isStatic) {
  const sides = () => ({ none: true, up: false, down: false, left: false, right: false });
  const b = {
    kind: 'body', gameObject: o, isStatic: !!isStatic, enable: true, moves: !isStatic, allowGravity: !isStatic,
    immovable: !!isStatic, pushable: !isStatic, collideWorldBounds: false, onWorldBounds: false,
    velocity: { x: 0, y: 0 }, acceleration: { x: 0, y: 0 }, gravity: { x: 0, y: 0 }, bounce: { x: 0, y: 0 },
    drag: { x: 0, y: 0 }, maxVelocity: { x: 10000, y: 10000 }, offset: { x: 0, y: 0 }, prev: { x: o.x, y: o.y },
    blocked: sides(), touching: sides(), wasTouching: sides(), checkCollision: { none: false, up: true, down: true, left: true, right: true },
    width: o.width, height: o.height, isCircle: false, radius: 0, mass: 1, angle: 0, speed: 0, log: [],
    onFloor() { return b.blocked.down; },
    onCeiling() { return b.blocked.up; },
    onWall() { return b.blocked.left || b.blocked.right; },
  };
  const chain = (name, fn) => { b[name] = function (...a) { b.log.push([name, ...a]); record(o, 'body.' + name, a); fn(...a); return b; }; };
  chain('setVelocity', (x, y) => { b.velocity.x = x; b.velocity.y = y === undefined ? x : y; });
  chain('setVelocityX', (x) => { b.velocity.x = x; });
  chain('setVelocityY', (y) => { b.velocity.y = y; });
  chain('setAcceleration', (x, y) => { b.acceleration.x = x; b.acceleration.y = y === undefined ? x : y; });
  chain('setAccelerationX', (x) => { b.acceleration.x = x; });
  chain('setAccelerationY', (y) => { b.acceleration.y = y; });
  chain('setSize', (w, h, center) => { b.width = w; b.height = h; b.centered = center !== false; });
  chain('setOffset', (x, y) => { b.offset.x = x; b.offset.y = y === undefined ? x : y; });
  chain('setCircle', (r, ox, oy) => { b.isCircle = true; b.radius = r; b.offset.x = ox || 0; b.offset.y = oy || 0; });
  chain('setEnable', (v) => { b.enable = v !== false; });
  chain('setAllowGravity', (v) => { b.allowGravity = v !== false; });
  chain('setGravity', (x, y) => { b.gravity.x = x; b.gravity.y = y === undefined ? x : y; });
  chain('setGravityX', (x) => { b.gravity.x = x; });
  chain('setGravityY', (y) => { b.gravity.y = y; });
  chain('setBounce', (x, y) => { b.bounce.x = x; b.bounce.y = y === undefined ? x : y; });
  chain('setBounceX', (x) => { b.bounce.x = x; });
  chain('setBounceY', (y) => { b.bounce.y = y; });
  chain('setCollideWorldBounds', (v, bx, by, onWorldBounds) => { b.collideWorldBounds = v !== false; b.onWorldBounds = !!onWorldBounds; if (bx !== undefined) b.bounce.x = bx; if (by !== undefined) b.bounce.y = by; });
  chain('setImmovable', (v) => { b.immovable = v !== false; });
  chain('setPushable', (v) => { b.pushable = v !== false; });
  chain('setDrag', (x, y) => { b.drag.x = x; b.drag.y = y === undefined ? x : y; });
  chain('setDragX', (x) => { b.drag.x = x; });
  chain('setDragY', (y) => { b.drag.y = y; });
  chain('setMaxVelocity', (x, y) => { b.maxVelocity.x = x; b.maxVelocity.y = y === undefined ? x : y; });
  chain('setMaxVelocityX', (x) => { b.maxVelocity.x = x; });
  chain('setMaxVelocityY', (y) => { b.maxVelocity.y = y; });
  chain('setMass', (m) => { b.mass = m; });
  chain('setFriction', () => {});
  chain('setBoundsRectangle', (r) => { b.customBoundsRectangle = r; });
  chain('reset', (x, y) => { o.x = x; o.y = y; b.velocity.x = 0; b.velocity.y = 0; b.acceleration.x = 0; b.acceleration.y = 0; });
  chain('stop', () => { b.velocity.x = 0; b.velocity.y = 0; b.acceleration.x = 0; b.acceleration.y = 0; });
  chain('updateFromGameObject', () => { b.width = o.displayWidth; b.height = o.displayHeight; });
  Object.defineProperty(b, 'x', { get: () => o.x - o.displayWidth * o.originX + b.offset.x, set: (v) => { o.x = v; } });
  Object.defineProperty(b, 'y', { get: () => o.y - o.displayHeight * o.originY + b.offset.y, set: (v) => { o.y = v; } });
  Object.defineProperty(b, 'halfWidth', { get: () => b.width / 2 });
  Object.defineProperty(b, 'halfHeight', { get: () => b.height / 2 });
  Object.defineProperty(b, 'center', { get: () => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }) });
  Object.defineProperty(b, 'position', { get: () => ({ x: b.x, y: b.y }) });
  Object.defineProperty(b, 'right', { get: () => b.x + b.width });
  Object.defineProperty(b, 'bottom', { get: () => b.y + b.height });
  return b;
}

/** The physics setters a sprite forwards to its body, as Phaser's mixins do. */
const BODY_FORWARDS = ['setVelocity', 'setVelocityX', 'setVelocityY', 'setAcceleration', 'setAccelerationX',
  'setAccelerationY', 'setBounce', 'setBounceX', 'setBounceY', 'setCollideWorldBounds', 'setImmovable',
  'setPushable', 'setDrag', 'setDragX', 'setDragY', 'setMaxVelocity', 'setGravity', 'setGravityX',
  'setGravityY', 'setMass', 'setFriction', 'setCircle', 'setOffset', 'setBodySize'];

/**
 * A sprite (or an image, which is a sprite without animation). play() records the clip and
 * `sprite.finishAnim()` fires the animationcomplete events a real clip would when it ends.
 * @returns {any}
 */
export function sprite(scene, kind, x, y, key, frame, physics, isStatic) {
  const s = gameObject(scene, kind, { x, y, texture: { key: key === undefined ? '__DEFAULT' : key }, frame: frameOf(frame), body: null });
  const tex = scene.textures.entries.get(key);
  if (tex && tex.frames.size) {
    const f = tex.frames.get(frame === undefined ? tex.frames.keys().next().value : frame);
    if (f) { s.width = f.width; s.height = f.height; }
  }
  if (tex && !tex.frames.size && tex.width) { s.width = tex.width; s.height = tex.height; }
  sizeFromScale(s);
  if (kind === 'sprite') {
    const anims = {
      currentAnim: null, currentFrame: null, isPlaying: false, isPaused: false, repeat: 0, timeScale: 1,
      getName: () => (anims.currentAnim ? anims.currentAnim.key : ''),
      play: (k, ignore) => s.play(k, ignore),
      stop: () => { record(s, 'anims.stop', []); anims.isPlaying = false; s.playing = null; return s; },
      pause: () => { anims.isPaused = true; return s; },
      resume: () => { anims.isPaused = false; return s; },
      restart: () => { anims.isPlaying = true; return s; },
      setRepeat: (n) => { anims.repeat = n; return s; },
      exists: (k) => scene.anims.exists(k),
    };
    s.anims = anims;
    s.playing = null;
    s.play = function (k, ignoreIfPlaying) {
      const name = typeof k === 'string' ? k : (k && k.key);
      record(s, 'play', [name, ignoreIfPlaying]);
      if (ignoreIfPlaying && anims.isPlaying && s.playing === name) return s;
      const anim = scene.anims.get(name);
      anims.currentAnim = anim || { key: name, frames: [], repeat: 0 };
      anims.isPlaying = true;
      s.playing = name;
      s.emit('animationstart', anims.currentAnim, null, s);
      s.emit('animationstart-' + name, anims.currentAnim, null, s);
      return s;
    };
    s.playReverse = (k) => s.play(k);
    s.playAfterDelay = (k) => s.play(k);
    s.playAfterRepeat = (k) => s.play(k);
    s.chain = () => s;
    s.stop = () => anims.stop();
    s.finishAnim = function () {
      const anim = anims.currentAnim;
      if (!anim) return;
      const name = anim.key;
      if (anim.repeat !== -1) { anims.isPlaying = false; s.playing = null; }
      s.emit('animationcomplete', anim, null, s);
      s.emit('animationcomplete-' + name, anim, null, s);
    };
  }
  if (physics) {
    s.body = body(s, isStatic);
    for (const name of BODY_FORWARDS) {
      const target = name === 'setBodySize' ? 'setSize' : name;
      s[name] = function (...a) { record(s, name, a); s.body[target](...a); return s; };
    }
    s.refreshBody = () => { record(s, 'refreshBody', []); s.body.updateFromGameObject(); return s; };
    s.enableBody = (reset, x2, y2, enable, show) => { if (reset) s.body.reset(x2, y2); if (enable !== undefined) s.body.enable = enable; if (show !== undefined) s.visible = show; return s; };
    s.disableBody = (disable, hide) => { if (disable) s.body.enable = false; if (hide) s.visible = false; return s; };
  }
  return s;
}

/** @returns {any} */
export function tileSprite(scene, x, y, w, h, key, frame) {
  const t = gameObject(scene, 'tileSprite', { x, y, width: w, height: h, texture: { key }, frame: frameOf(frame), tilePositionX: 0, tilePositionY: 0, tileScaleX: 1, tileScaleY: 1 });
  const chain = (name, fn) => { t[name] = function (...a) { record(t, name, a); fn(...a); return t; }; };
  chain('setTilePosition', (px, py) => { t.tilePositionX = px; if (py !== undefined) t.tilePositionY = py; });
  chain('setTileScale', (sx, sy) => { t.tileScaleX = sx; t.tileScaleY = sy === undefined ? sx : sy; });
  sizeFromScale(t);
  return t;
}

/** @returns {any} */
export function shape(scene, kind, x, y, w, h, fill, alpha) {
  const r = gameObject(scene, kind, {
    x, y, width: w === undefined ? 128 : w, height: h === undefined ? 128 : h,
    fillColor: fill, fillAlpha: alpha === undefined ? 1 : alpha, isFilled: fill !== undefined,
    strokeColor: 0, strokeAlpha: 1, lineWidth: 0, isStroked: false,
  });
  if (kind === 'circle') { r.radius = w === undefined ? 64 : w; r.width = r.radius * 2; r.height = r.radius * 2; r.fillColor = h; r.fillAlpha = fill === undefined ? 1 : fill; r.isFilled = h !== undefined; }
  const chain = (name, fn) => { r[name] = function (...a) { record(r, name, a); fn(...a); return r; }; };
  chain('setFillStyle', (c, a) => { r.fillColor = c; r.fillAlpha = a === undefined ? 1 : a; r.isFilled = c !== undefined; });
  chain('setStrokeStyle', (lw, c, a) => { r.lineWidth = lw; r.strokeColor = c; r.strokeAlpha = a === undefined ? 1 : a; r.isStroked = lw !== undefined; });
  chain('setRadius', (rad) => { r.radius = rad; r.width = rad * 2; r.height = rad * 2; });
  chain('setRectangleDropZone', (dw, dh) => { r.input = { hitArea: { x: 0, y: 0, width: dw, height: dh }, enabled: true, dropZone: true }; });
  chain('setCircleDropZone', (rad) => { r.input = { hitArea: { radius: rad }, enabled: true, dropZone: true }; });
  chain('setDropZone', () => { if (r.input) r.input.dropZone = true; });
  sizeFromScale(r);
  return r;
}

/* ── Particles ─────────────────────────────────────────────────────────────────────────────── */

/** The longest a particle of this config lives, in ms: lifespan may be a number, a range or a callback. */
function maxLifespan(config) {
  const l = config && config.lifespan;
  if (typeof l === 'number') return l;
  if (l && typeof l === 'object') {
    if (typeof l.max === 'number') return l.max;
    if (typeof l.end === 'number') return Math.max(l.start || 0, l.end);
  }
  return 1000;
}

/**
 * A particle emitter. explode() is recorded once per call and schedules the 'complete' event on
 * the scene clock after the longest lifespan, which is how a burst dies deterministically.
 * @returns {any}
 */
export function particles(scene, x, y, key, config) {
  const cfg = Object.assign({}, config || {});
  const e = gameObject(scene, 'particles', {
    x, y, texture: { key }, config: cfg, emitting: cfg.emitting !== false, frequency: cfg.frequency === undefined ? 0 : cfg.frequency,
    quantity: cfg.quantity === undefined ? 1 : cfg.quantity, exploded: [], alive: 0, follow: null, width: 0, height: 0,
  });
  const chain = (name, fn) => { e[name] = function (...a) { record(e, name, a); const r = fn(...a); return r === undefined ? e : r; }; };
  chain('explode', (count, ex, ey) => {
    const n = count === undefined ? e.quantity : count;
    e.exploded.push([n, ex, ey]);
    e.alive += n;
    e.emitting = false;
    scene.clock.delayedCall(maxLifespan(cfg), () => {
      if (e.destroyed) return;
      e.alive = Math.max(0, e.alive - n);
      if (e.alive === 0) e.emit('complete', e);
    }, [], null, { owner: e, kind: 'particles' });
  });
  chain('emitParticleAt', (ex, ey, count) => { e.explode(count === undefined ? 1 : count, ex, ey); });
  chain('emitParticle', (count, ex, ey) => { e.explode(count === undefined ? 1 : count, ex, ey); });
  chain('start', (advance) => { e.emitting = true; e.advanced = advance; });
  chain('stop', (kill) => { e.emitting = false; if (kill) e.alive = 0; });
  chain('pause', () => { e.paused = true; });
  chain('resume', () => { e.paused = false; });
  chain('killAll', () => { e.alive = 0; });
  chain('startFollow', (target, ox, oy, trackVisible) => { e.follow = { target, offsetX: ox || 0, offsetY: oy || 0, trackVisible: !!trackVisible }; });
  chain('stopFollow', () => { e.follow = null; });
  chain('setFrequency', (f, q) => { e.frequency = f; if (q !== undefined) e.quantity = q; });
  chain('setQuantity', (q) => { e.quantity = q; });
  chain('setConfig', (c) => { Object.assign(cfg, c || {}); });
  chain('setEmitZone', (z) => { cfg.emitZone = z; });
  chain('setDeathZone', (z) => { cfg.deathZone = z; });
  chain('setEmitterFrame', (f) => { cfg.frame = f; });
  chain('setParticleSpeed', (sx, sy) => { cfg.speedX = sx; cfg.speedY = sy === undefined ? sx : sy; });
  chain('setParticleScale', (sx, sy) => { cfg.scaleX = sx; cfg.scaleY = sy === undefined ? sx : sy; });
  chain('setParticleAlpha', (a) => { cfg.alpha = a; });
  chain('setParticleLifespan', (l) => { cfg.lifespan = l; });
  chain('setParticleGravity', (gx, gy) => { cfg.gravityX = gx; cfg.gravityY = gy; });
  chain('setParticleTint', (t) => { cfg.tint = t; });
  e.getAliveParticleCount = () => e.alive;
  e.getDeadParticleCount = () => 0;
  e.getParticleCount = () => e.alive;
  e.atLimit = () => false;
  return e;
}

/* ── Groups ────────────────────────────────────────────────────────────────────────────────── */

/** @returns {any} */
export function group(scene, cfg, physics, isStatic) {
  const g = gameObject(scene, isStatic ? 'staticGroup' : (physics ? 'physicsGroup' : 'group'), { config: cfg || {}, entries: [], runChildUpdate: false, width: 0, height: 0 });
  const chain = (name, fn) => { g[name] = function (...a) { record(g, name, a); const r = fn(...a); return r === undefined ? g : r; }; };
  const make = (x, y, key, frame) => {
    const o = physics ? sprite(scene, 'sprite', x, y, key, frame, true, isStatic) : sprite(scene, 'sprite', x, y, key, frame, false);
    o.group = g;
    return o;
  };
  chain('create', (x, y, key, frame, visible, active) => {
    const o = make(x, y, key, frame);
    if (visible !== undefined) o.visible = visible;
    if (active !== undefined) o.active = active;
    g.entries.push(o);
    return o;
  });
  chain('createMultiple', (c) => {
    const list = Array.isArray(c) ? c : [c];
    const out = [];
    for (const one of list) for (let i = 0; i < (one.quantity || one.repeat + 1 || 1); i++) out.push(g.create(0, 0, one.key, one.frame, one.visible, one.active));
    return out;
  });
  chain('add', (o, addToScene) => { if (g.entries.indexOf(o) < 0) g.entries.push(o); o.group = g; if (addToScene) o.added = true; });
  chain('addMultiple', (list) => { for (const o of list) g.add(o); });
  chain('remove', (o, removeFromScene, destroyChild) => { const i = g.entries.indexOf(o); if (i >= 0) g.entries.splice(i, 1); if (destroyChild) o.destroy(); });
  chain('clear', (removeFromScene, destroyChild) => { if (destroyChild) for (const o of g.entries.slice()) o.destroy(); g.entries.length = 0; });
  chain('killAndHide', (o) => { o.active = false; o.visible = false; if (o.body) o.body.enable = false; });
  chain('setDepth', (d, step) => { g.depth = d; g.entries.forEach((o, i) => o.setDepth(d + (step || 0) * i)); });
  chain('setAlpha', (a) => { g.entries.forEach((o) => o.setAlpha(a)); });
  chain('setVisible', (v) => { g.entries.forEach((o) => o.setVisible(v)); });
  chain('setActive', (v) => { g.entries.forEach((o) => { o.active = v; }); });
  chain('setVelocity', (x, y) => { g.entries.forEach((o) => o.body && o.body.setVelocity(x, y)); });
  chain('setVelocityX', (x) => { g.entries.forEach((o) => o.body && o.body.setVelocityX(x)); });
  chain('setVelocityY', (y) => { g.entries.forEach((o) => o.body && o.body.setVelocityY(y)); });
  chain('refresh', () => { g.entries.forEach((o) => o.body && o.body.updateFromGameObject()); });
  chain('iterate', (fn, ctx) => { for (const o of g.entries.slice()) fn.call(ctx, o); });
  chain('each', (fn, ctx) => { for (const o of g.entries.slice()) fn.call(ctx, o); });
  g.get = (x, y, key, frame) => { const dead = g.getFirstDead(); if (dead) { dead.active = true; dead.visible = true; if (x !== undefined) dead.setPosition(x, y); return dead; } return g.create(x || 0, y || 0, key, frame); };
  g.getChildren = () => g.entries;
  g.getLength = () => g.entries.length;
  g.getTotalUsed = () => g.entries.filter((o) => o.active).length;
  g.countActive = (v) => g.entries.filter((o) => o.active === (v !== false)).length;
  g.getFirstAlive = () => g.entries.find((o) => o.active) || null;
  g.getFirstDead = () => g.entries.find((o) => !o.active) || null;
  g.getFirst = (prop, value) => g.entries.find((o) => o[prop] === value) || null;
  g.contains = (o) => g.entries.indexOf(o) >= 0;
  g.getMatching = (prop, value) => g.entries.filter((o) => o[prop] === value);
  g.children = { entries: g.entries, size: 0, iterate: g.iterate, each: g.each, getArray: () => g.entries, get length() { return g.entries.length; } };
  Object.defineProperty(g.children, 'size', { get: () => g.entries.length });
  g.destroy = function (destroyChildren) { record(g, 'destroy', [destroyChildren]); if (destroyChildren) for (const o of g.entries.slice()) o.destroy(); g.entries.length = 0; g.destroyed = true; g.scene = undefined; };
  if (cfg && cfg.key) g.createMultiple(cfg);
  return g;
}

/* ── Tilemaps ──────────────────────────────────────────────────────────────────────────────── */

function tile(index, tx, ty, tw, th) {
  return { index, x: tx, y: ty, pixelX: tx * tw, pixelY: ty * th, width: tw, height: th, collides: false, properties: {}, tint: 0xffffff, alpha: 1, visible: true, faceLeft: false, faceRight: false, faceTop: false, faceBottom: false };
}

function tilemapLayer(scene, map, name, fill) {
  const L = gameObject(scene, 'tilemapLayer', { name, tilemap: map, cells: [], layer: { name, collideIndexes: [], width: map.width, height: map.height, data: null }, facesCalls: 0, puts: 0, width: map.widthInPixels, height: map.heightInPixels, originX: 0, originY: 0 });
  for (let y = 0; y < map.height; y++) {
    const row = [];
    for (let x = 0; x < map.width; x++) row.push(tile(fill ? fill(x, y) : -1, x, y, map.tileWidth, map.tileHeight));
    L.cells.push(row);
  }
  L.layer.data = L.cells;
  const inside = (tx, ty) => ty >= 0 && ty < map.height && tx >= 0 && tx < map.width;
  const idx = (list) => (Array.isArray(list) ? list : [list]);
  const mark = (i) => { if (L.layer.collideIndexes.indexOf(i) < 0) L.layer.collideIndexes.push(i); };
  const unmark = (i) => { const at = L.layer.collideIndexes.indexOf(i); if (at >= 0) L.layer.collideIndexes.splice(at, 1); };
  const chain = (fn, key) => { L[key] = function (...a) { record(L, key, a); const r = fn(...a); return r === undefined ? L : r; }; };
  chain((indexes, collides) => { for (const i of idx(indexes)) { if (collides !== false) mark(i); else unmark(i); } for (const row of L.cells) for (const t of row) if (idx(indexes).indexOf(t.index) >= 0) t.collides = collides !== false; }, 'setCollision');
  chain((a, b, collides) => { for (let i = a; i <= b; i++) { if (collides !== false) mark(i); else unmark(i); } for (const row of L.cells) for (const t of row) if (t.index >= a && t.index <= b) t.collides = collides !== false; }, 'setCollisionBetween');
  chain((props, collides) => { for (const row of L.cells) for (const t of row) { if (t.index < 0) continue; for (const k in props) if (t.properties[k] === props[k]) { t.collides = collides !== false; mark(t.index); } } }, 'setCollisionByProperty');
  chain((indexes, collides) => { const list = idx(indexes); for (const row of L.cells) for (const t of row) if (t.index >= 0 && list.indexOf(t.index) < 0) { t.collides = collides !== false; mark(t.index); } }, 'setCollisionByExclusion');
  chain((index, tx, ty) => { if (!inside(tx, ty)) return null; L.puts += 1; const t = L.cells[ty][tx]; t.index = typeof index === 'object' && index ? index.index : index; t.collides = L.layer.collideIndexes.indexOf(t.index) >= 0; return t; }, 'putTileAt');
  chain((index, wx, wy) => L.putTileAt(index, L.worldToTileX(wx), L.worldToTileY(wy)), 'putTileAtWorldXY');
  chain((tx, ty) => { if (!inside(tx, ty)) return null; const t = L.cells[ty][tx]; t.index = -1; t.collides = false; return t; }, 'removeTileAt');
  chain((index, tx, ty, w, h) => { for (let y = ty || 0; y < (ty || 0) + (h === undefined ? map.height : h); y++) for (let x = tx || 0; x < (tx || 0) + (w === undefined ? map.width : w); x++) L.putTileAt(index, x, y); }, 'fill');
  chain(() => { L.facesCalls += 1; }, 'calculateFacesWithin');
  chain((fn, ctx) => { for (const row of L.cells) for (const t of row) fn.call(ctx, t); }, 'forEachTile');
  chain((tint) => { for (const row of L.cells) for (const t of row) t.tint = tint; }, 'setTint');
  L.getTileAt = (tx, ty, nonNull) => { if (!inside(tx, ty)) return null; const t = L.cells[ty][tx]; return t.index === -1 && !nonNull ? null : t; };
  L.getTileAtWorldXY = (wx, wy, nonNull) => L.getTileAt(L.worldToTileX(wx), L.worldToTileY(wy), nonNull);
  L.hasTileAt = (tx, ty) => inside(tx, ty) && L.cells[ty][tx].index !== -1;
  L.getTilesWithin = (tx, ty, w, h, filter) => { const out = []; for (let y = ty || 0; y < (ty || 0) + (h === undefined ? map.height : h); y++) for (let x = tx || 0; x < (tx || 0) + (w === undefined ? map.width : w); x++) if (inside(x, y)) { const t = L.cells[y][x]; if (filter && filter.isNotEmpty && t.index === -1) continue; if (filter && filter.isColliding && !t.collides) continue; out.push(t); } return out; };
  L.findByIndex = (index) => { for (const row of L.cells) for (const t of row) if (t.index === index) return t; return null; };
  L.filterTiles = (fn) => L.getTilesWithin().filter(fn);
  L.findTile = (fn) => L.getTilesWithin().find(fn) || null;
  L.worldToTileX = (wx) => Math.floor((wx - L.x) / map.tileWidth);
  L.worldToTileY = (wy) => Math.floor((wy - L.y) / map.tileHeight);
  L.tileToWorldX = (tx) => L.x + tx * map.tileWidth;
  L.tileToWorldY = (ty) => L.y + ty * map.tileHeight;
  L.tileToWorldXY = (tx, ty) => ({ x: L.tileToWorldX(tx), y: L.tileToWorldY(ty) });
  L.worldToTileXY = (wx, wy) => ({ x: L.worldToTileX(wx), y: L.worldToTileY(wy) });
  return L;
}

/**
 * A tilemap. A blank one from { width, height, tileWidth, tileHeight }, or a Tiled one from
 * `tiledMaps[key]` ({ width, height, tileWidth, tileHeight, tilesets: [{ name, ... }], layers:
 * [{ name, data: number[][], tileProps?: Record<index, props> }], objects? }).
 * @returns {any}
 */
export function tilemap(scene, cfg, tiledMaps) {
  const c = cfg || {};
  const tiled = c.key && tiledMaps ? tiledMaps[c.key] : null;
  const map = {
    kind: 'tilemap', key: c.key || null, config: c, tilesets: [], layers: [], objects: [], created: [], destroyed: false, log: [], scene,
    width: tiled ? tiled.width : (c.width || 10), height: tiled ? tiled.height : (c.height || 10),
    tileWidth: tiled ? tiled.tileWidth : (c.tileWidth || 32), tileHeight: tiled ? tiled.tileHeight : (c.tileHeight || 32),
  };
  map.widthInPixels = map.width * map.tileWidth;
  map.heightInPixels = map.height * map.tileHeight;
  if (tiled) {
    map.tilesets = (tiled.tilesets || []).map((t) => Object.assign({ firstgid: 1, image: null }, t));
    map.layers = (tiled.layers || []).map((l) => Object.assign({ properties: [] }, l));
    map.objects = tiled.objects || [];
  }
  map.addTilesetImage = function (name, key, tw, th, margin, spacing, gid) {
    record(map, 'addTilesetImage', [name, key, tw, th, margin, spacing, gid]);
    const texKey = key === undefined ? name : key;
    if (tiled) {
      const ts = map.tilesets.find((t) => t.name === name);
      if (!ts) return null;
      ts.image = texKey;
      return ts;
    }
    const tex = scene.textures.entries.get(texKey);
    if (!tex) return null;
    const w = tw || map.tileWidth;
    const ts = { name, image: texKey, key: texKey, firstgid: gid === undefined ? 0 : gid, tileWidth: w, tileHeight: th || map.tileHeight, total: Math.max(1, Math.floor(tex.width / w)), columns: Math.max(1, Math.floor(tex.width / w)) };
    map.tilesets.push(ts);
    return ts;
  };
  map.createBlankLayer = function (name, tileset, x, y, w, h, tw, th) {
    record(map, 'createBlankLayer', [name, tileset, x, y, w, h, tw, th]);
    const L = tilemapLayer(scene, map, name);
    L.tileset = tileset;
    L.x = x || 0; L.y = y || 0;
    map.layers.push({ name, properties: [], tilemapLayer: L });
    map.created.push(L);
    return L;
  };
  map.createLayer = function (name, sets, x, y) {
    record(map, 'createLayer', [name, sets, x, y]);
    const ld = map.layers.find((l) => l.name === name || l.id === name);
    if (!ld) return null;
    const L = tilemapLayer(scene, map, ld.name, (tx, ty) => (ld.data && ld.data[ty] ? ld.data[ty][tx] : -1));
    for (const row of L.cells) for (const t of row) if (ld.tileProps && ld.tileProps[t.index]) t.properties = Object.assign({}, ld.tileProps[t.index]);
    L.sets = sets; L.x = x || 0; L.y = y || 0;
    ld.tilemapLayer = L;
    map.created.push(L);
    return L;
  };
  map.getLayer = (name) => map.layers.find((l) => l.name === name) || null;
  map.getObjectLayer = (name) => { const l = map.objects.find((o) => o.name === name); return l || null; };
  map.createFromObjects = () => [];
  map.getTileset = (name) => map.tilesets.find((t) => t.name === name) || null;
  map.setCollision = (indexes, collides, recalc, layer) => { (layer || map.created[map.created.length - 1]).setCollision(indexes, collides); return map; };
  map.worldToTileX = (wx) => Math.floor(wx / map.tileWidth);
  map.worldToTileY = (wy) => Math.floor(wy / map.tileHeight);
  map.tileToWorldX = (tx) => tx * map.tileWidth;
  map.tileToWorldY = (ty) => ty * map.tileHeight;
  map.destroy = function () { record(map, 'destroy', []); map.destroyed = true; for (const L of map.created) if (!L.destroyed) L.destroy(); };
  scene.made.push(map);
  return map;
}

