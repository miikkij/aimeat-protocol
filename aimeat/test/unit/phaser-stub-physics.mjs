/**
 * @file test/unit/phaser-stub-physics.mjs
 * @description The arcade physics plugin of the fake Phaser scene: physics.add (sprite, image,
 *   group, staticGroup, collider, overlap, existing), the world (gravity, bounds, overlapRect,
 *   timeScale, pause), velocityFromRotation and moveTo. world.step(ms) moves every dynamic body
 *   by its velocity, clamps a body that collides with the world bounds, and runs the colliders'
 *   callbacks on overlapping pairs; nothing is pushed apart, which is what a script wants when it
 *   sets `body.blocked.down` by hand to say "on the ground".
 * @structure makePhysics(scene, opts) → { world, add, velocityFromRotation, moveTo, … }
 * @usage  Internal to phaser-stub-scene.mjs; scripts reach it as scene.physics.
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial, split out of phaser-stub-scene.mjs.
 */
import { emitter, sprite, group } from './phaser-stub-objects.mjs';

/**
 * @param {any} scene
 * @param {{ gravity?: number|{ x?: number, y?: number }, overlapRect?: Function }} [opts]
 *   gravity: the world's y gravity (default 0). overlapRect: a replacement for the world's own,
 *   for a script that wants to say what is solid where.
 * @returns {any}
 */
export function makePhysics(scene, opts) {
  const o = opts || {};
  const wev = emitter();
  const bodiesOf = (thing) => {
    if (!thing) return [];
    if (thing.entries) return thing.entries.filter((g) => g.body && !g.destroyed && g.active);
    if (Array.isArray(thing)) return thing.flatMap(bodiesOf);
    return thing.body && !thing.destroyed && thing.active ? [thing] : [];
  };
  const rectOf = (g) => ({ x: g.body.x, y: g.body.y, width: g.body.width, height: g.body.height });
  const meet = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const world = Object.assign({
    kind: 'physicsWorld', gravity: { x: 0, y: typeof o.gravity === 'number' ? o.gravity : (o.gravity && typeof o.gravity.y === 'number' ? o.gravity.y : 0) },
    bounds: { x: 0, y: 0, width: scene.scale.width, height: scene.scale.height }, timeScale: 1, isPaused: false, drawDebug: false, debugGraphic: null, fps: 60, log: [],
    colliders: { list: [], add(c) { this.list.push(c); return c; }, remove(c) { const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); return c; }, getActive() { return this.list.filter((c) => c.active); }, destroy() { this.list.length = 0; } },
    checkCollision: { up: true, down: true, left: true, right: true },
  }, wev);
  Object.defineProperty(world.bounds, 'right', { get() { return this.x + this.width; } });
  Object.defineProperty(world.bounds, 'bottom', { get() { return this.y + this.height; } });
  Object.defineProperty(world, 'bodies', { get: () => new Set(scene.made.filter((g) => g.body && !g.body.isStatic && !g.destroyed).map((g) => g.body)) });
  Object.defineProperty(world, 'staticBodies', { get: () => new Set(scene.made.filter((g) => g.body && g.body.isStatic && !g.destroyed).map((g) => g.body)) });
  const wchain = (name, fn) => { world[name] = function (...a) { world.log.push([name, ...a]); scene.log.push({ kind: 'physicsWorld', method: name, args: a, target: world }); const r = fn(...a); return r === undefined ? world : r; }; };
  wchain('setBounds', (x, y, w, h, cl, cr, cu, cd) => { world.bounds.x = x; world.bounds.y = y; world.bounds.width = w; world.bounds.height = h; if (cl !== undefined) world.setBoundsCollision(cl, cr, cu, cd); });
  wchain('setBoundsCollision', (l, r, u, d) => { world.checkCollision = { left: l !== false, right: r !== false, up: u !== false, down: d !== false }; });
  wchain('removeCollider', (c) => { world.colliders.remove(c); });
  wchain('pause', () => { world.isPaused = true; world.emit('pause'); });
  wchain('resume', () => { world.isPaused = false; world.emit('resume'); });
  wchain('enable', (g, isStatic) => { for (const one of Array.isArray(g) ? g : [g]) if (!one.body) physics.add.existing(one, isStatic); });
  wchain('disable', (g) => { for (const one of Array.isArray(g) ? g : [g]) if (one.body) one.body.enable = false; });
  wchain('enableBody', (g) => { if (g.body) g.body.enable = true; });
  wchain('disableBody', (b) => { b.enable = false; });
  wchain('setFPS', (n) => { world.fps = n; });
  wchain('wrap', () => {});
  world.overlap = (a, b, cb, proc, ctx) => { let hit = false; for (const ga of bodiesOf(a)) for (const gb of bodiesOf(b)) if (ga !== gb && meet(rectOf(ga), rectOf(gb)) && (!proc || proc.call(ctx, ga, gb))) { hit = true; if (cb) cb.call(ctx, ga, gb); } return hit; };
  world.collide = world.overlap;
  world.overlapRect = function (x, y, w, h, includeDynamic, includeStatic) {
    if (typeof o.overlapRect === 'function') return o.overlapRect(x, y, w, h, includeDynamic, includeStatic);
    const box = { x, y, width: w, height: h };
    return scene.made.filter((g) => g.body && g.body.enable && !g.destroyed && (g.body.isStatic ? includeStatic : includeDynamic !== false) && meet(box, rectOf(g))).map((g) => g.body);
  };
  world.overlapCirc = (x, y, r, includeDynamic, includeStatic) => world.overlapRect(x - r, y - r, r * 2, r * 2, includeDynamic, includeStatic);
  /** Move every dynamic body by its velocity for ms, then run the colliders' callbacks on overlapping pairs. */
  world.step = function (ms) {
    if (world.isPaused) return;
    const dt = (ms / 1000) * world.timeScale;
    for (const g of scene.made) {
      const b = g.body;
      if (!b || b.isStatic || !b.enable || !b.moves || g.destroyed) continue;
      if (b.allowGravity) { b.velocity.x += (world.gravity.x + b.gravity.x) * dt; b.velocity.y += (world.gravity.y + b.gravity.y) * dt; }
      b.velocity.x += b.acceleration.x * dt; b.velocity.y += b.acceleration.y * dt;
      b.velocity.x = Math.max(-b.maxVelocity.x, Math.min(b.maxVelocity.x, b.velocity.x));
      b.velocity.y = Math.max(-b.maxVelocity.y, Math.min(b.maxVelocity.y, b.velocity.y));
      b.prev = { x: g.x, y: g.y };
      g.x += b.velocity.x * dt; g.y += b.velocity.y * dt;
      b.blocked = { none: true, up: false, down: false, left: false, right: false };
      if (b.collideWorldBounds) {
        const r = rectOf(g);
        const wb = world.bounds;
        if (r.x < wb.x && world.checkCollision.left) { g.x += wb.x - r.x; b.velocity.x = -b.velocity.x * b.bounce.x; b.blocked.left = true; }
        if (r.x + r.width > wb.right && world.checkCollision.right) { g.x -= r.x + r.width - wb.right; b.velocity.x = -b.velocity.x * b.bounce.x; b.blocked.right = true; }
        if (r.y < wb.y && world.checkCollision.up) { g.y += wb.y - r.y; b.velocity.y = -b.velocity.y * b.bounce.y; b.blocked.up = true; }
        if (r.y + r.height > wb.bottom && world.checkCollision.down) { g.y -= r.y + r.height - wb.bottom; b.velocity.y = -b.velocity.y * b.bounce.y; b.blocked.down = true; }
        b.blocked.none = !(b.blocked.left || b.blocked.right || b.blocked.up || b.blocked.down);
        if (b.onWorldBounds && !b.blocked.none) world.emit('worldbounds', b, b.blocked.up, b.blocked.down, b.blocked.left, b.blocked.right);
      }
    }
    for (const c of world.colliders.getActive()) world.overlap(c.object1, c.object2, (ga, gb) => { c.hits += 1; if (c.collideCallback) c.collideCallback.call(c.callbackContext, ga, gb); }, c.processCallback, c.callbackContext);
  };
  const collider = (a, b, cb, proc, ctx, overlapOnly) => {
    const c = { kind: overlapOnly ? 'overlap' : 'collider', object1: a, object2: b, collideCallback: cb || null, processCallback: proc || null, callbackContext: ctx, active: true, overlapOnly: !!overlapOnly, name: '', hits: 0, world };
    c.setName = (n) => { c.name = n; return c; };
    c.destroy = () => { c.active = false; world.colliders.remove(c); };
    world.colliders.add(c);
    scene.log.push({ kind: c.kind, method: 'create', args: [a, b], target: c });
    return c;
  };
  const physics = {
    kind: 'physics', world, config: o, log: [],
    add: {
      sprite: (x, y, key, frame) => sprite(scene, 'sprite', x, y, key, frame, true, false),
      image: (x, y, key, frame) => sprite(scene, 'image', x, y, key, frame, true, false),
      staticSprite: (x, y, key, frame) => sprite(scene, 'sprite', x, y, key, frame, true, true),
      staticImage: (x, y, key, frame) => sprite(scene, 'image', x, y, key, frame, true, true),
      existing: (g, isStatic) => { if (!g.body) { const s = sprite(scene, 'sprite', 0, 0, undefined, undefined, true, !!isStatic); g.body = s.body; g.body.gameObject = g; s.destroy(); scene.made.splice(scene.made.indexOf(s), 1); } return g; },
      group: (cfg) => group(scene, cfg, true, false),
      staticGroup: (cfg) => group(scene, cfg, true, true),
      collider: (a, b, cb, proc, ctx) => collider(a, b, cb, proc, ctx, false),
      overlap: (a, b, cb, proc, ctx) => collider(a, b, cb, proc, ctx, true),
      body: (x, y, w, h) => { const s = sprite(scene, 'body', x, y, undefined, undefined, true, false); s.body.setSize(w || 64, h || 64); return s.body; },
      staticBody: (x, y, w, h) => { const s = sprite(scene, 'body', x, y, undefined, undefined, true, true); s.body.setSize(w || 64, h || 64); return s.body; },
    },
    velocityFromRotation: (rot, speed, vec) => { const v = vec || { x: 0, y: 0 }; const s = speed === undefined ? 60 : speed; v.x = Math.cos(rot) * s; v.y = Math.sin(rot) * s; return v; },
    velocityFromAngle: (deg, speed, vec) => physics.velocityFromRotation((deg * Math.PI) / 180, speed, vec),
    moveTo: (g, x, y, speed, maxTime) => { const a = Math.atan2(y - g.y, x - g.x); let s = speed === undefined ? 60 : speed; if (maxTime > 0) s = Math.hypot(x - g.x, y - g.y) / (maxTime / 1000); g.body.setVelocity(Math.cos(a) * s, Math.sin(a) * s); return a; },
    moveToObject: (g, t, speed, maxTime) => physics.moveTo(g, t.x, t.y, speed, maxTime),
    accelerateTo: (g, x, y, speed) => { const a = Math.atan2(y - g.y, x - g.x); g.body.setAcceleration(Math.cos(a) * (speed || 60), Math.sin(a) * (speed || 60)); return a; },
    accelerateToObject: (g, t, speed) => physics.accelerateTo(g, t.x, t.y, speed),
    closest: (src, targets) => { const list = (targets ? bodiesOf(targets) : scene.made.filter((g) => g.body && g !== src && !g.destroyed)); let best = null; let d = Infinity; for (const g of list) { const dd = Math.hypot(g.x - src.x, g.y - src.y); if (dd < d) { d = dd; best = g; } } return best; },
    furthest: (src, targets) => { const list = (targets ? bodiesOf(targets) : scene.made.filter((g) => g.body && g !== src && !g.destroyed)); let best = null; let d = -1; for (const g of list) { const dd = Math.hypot(g.x - src.x, g.y - src.y); if (dd > d) { d = dd; best = g; } } return best; },
    overlap: (a, b, cb, proc, ctx) => world.overlap(a, b, cb, proc, ctx),
    collide: (a, b, cb, proc, ctx) => world.overlap(a, b, cb, proc, ctx),
    overlapRect: (x, y, w, h, d, s) => world.overlapRect(x, y, w, h, d, s),
    overlapCirc: (x, y, r, d, s) => world.overlapCirc(x, y, r, d, s),
    pause: () => world.pause(),
    resume: () => world.resume(),
    isPaused: () => world.isPaused,
    disableUpdate: () => {},
    enableUpdate: () => {},
    shutdown: () => {},
    destroy: () => {},
  };
  return physics;
}
