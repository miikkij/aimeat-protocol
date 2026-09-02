/**
 * @file phaser/boss-steps.js
 * @description What one step of a boss pattern does: the move, the dash, the telegraph, the
 *   volley, the minion call, the slam, the wait and the game's own function. boss.js owns the
 *   order, the phases and the health; this file owns the doing, so each half stays under the
 *   line limit and a step can be read on its own.
 *
 *   EVERY STEP ENDS BY CALLING next(). A step with a duration ends on the scene's own clock,
 *   through the world's after() (a delayedCall) or its tween(), so a paused scene, a hit-stop and
 *   a slow-motion all hold it. A step with no duration (fire, spawn) calls next() before it
 *   returns. Nothing here keeps a frame loop.
 *
 *   THE GAME OWNS ITS PROJECTILES AND MINIONS. fire computes the angles and hands them to
 *   spec.onFire(origin, angles) as RADIANS, y down, 0 pointing right, which is what Math.cos,
 *   Math.sin and physics.velocityFromRotation take; the spread an author writes is in degrees,
 *   because sixty degrees is how a fan is thought of. spawn hands each minion's place to
 *   spec.onSpawn(x, y, kind). rain is the one kind that calls onFire once per drop, from the top
 *   of the view, spread over the step's ms.
 *
 *   A TELEGRAPH IS A WARNING WITH A LENGTH. The sprite blinks in the warn tone, a ring grows at
 *   the boss, or a line reaches toward the target, for ms, and the step lasts exactly that long
 *   so the player gets the whole warning. Under less motion the picture is one short mark (the
 *   ring or the line drawn once at full size, the sprite tinted once) and the wait is unchanged.
 *
 *   A SLAM IS A JUMP, A LANDING AND A BEAT. body.moves is off while the sprite is tweened, so
 *   gravity does not fight the jump, and put back after. juice.shake and an fx dust burst land
 *   with it when the game has them.
 * @structure viewOf() · resolveTo() · anglesFor() · tintFill() / untint() · runStep(world, step,
 *   next) and one function per step kind
 * @usage  import { runStep } from './boss-steps.js';   // read by boss.js only
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: move, dash, telegraph, fire, spawn, slam, wait, fn and die.
 */
import { reducedMotion } from '../atelier/dom.js';
import { toneColour } from './boss-bar.js';

/** The defaults an author leaves out. */
const MOVE_MS = 600;
const DASH_SPEED = 600;
const DASH_MS = 400;
const TELEGRAPH_MS = 500;
const RING_RADIUS = 70;
const LINE_LENGTH = 480;
const FIRE_SPEED = 260;
const SPREAD_DEG = 60;
const RAIN_MS = 600;
const SPAWN_RADIUS = 80;
const SLAM_MS = 700;
const SLAM_HEIGHT = 60;
const EDGE = 24;

/** The one short mark a telegraph is under less motion, and one half of a blink. */
const FLASH_MS = 90;
const BLINK_HALF = 80;

/**
 * The camera's view in world coordinates.
 * @param {any} scene
 * @returns {{ x: number, y: number, width: number, height: number, right: number, bottom: number,
 *   cx: number, cy: number }}
 */
export function viewOf(scene) {
  const cam = scene.cameras && scene.cameras.main;
  let x = 0;
  let y = 0;
  let w = scene.scale ? scene.scale.width : 960;
  let h = scene.scale ? scene.scale.height : 540;
  if (cam) {
    const wv = cam.worldView;
    if (wv && typeof wv.width === 'number' && wv.width > 0) {
      x = wv.x; y = wv.y; w = wv.width; h = wv.height;
    } else {
      x = cam.scrollX || 0; y = cam.scrollY || 0; w = cam.width || w; h = cam.height || h;
    }
  }
  return { x: x, y: y, width: w, height: h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
}

/**
 * Where a place word points: the target, an edge of the view, or a point given as it is.
 * @param {any} world
 * @param {any} to  'target' | 'left' | 'right' | 'center' | 'top' | { x, y }
 * @returns {{ x: number, y: number }}
 */
export function resolveTo(world, to) {
  const sprite = world.sprite;
  const view = viewOf(world.scene);
  const margin = (sprite.displayWidth || 32) / 2 + EDGE;
  if (to && typeof to === 'object' && typeof to.x === 'number' && typeof to.y === 'number') return { x: to.x, y: to.y };
  if (to === 'left') return { x: view.x + margin, y: sprite.y };
  if (to === 'right') return { x: view.right - margin, y: sprite.y };
  if (to === 'center') return { x: view.cx, y: sprite.y };
  if (to === 'top') return { x: sprite.x, y: view.y + (sprite.displayHeight || 32) / 2 + EDGE };
  const t = world.target();
  if (t) return { x: t.x, y: t.y };
  return { x: view.cx, y: view.cy };
}

/**
 * The angles of a volley, in radians.
 * @param {'aimed'|'spread'|'ring'|string} kind
 * @param {number} aim      the angle toward the target
 * @param {number} count
 * @param {number} spreadDeg
 * @returns {number[]}
 */
export function anglesFor(kind, aim, count, spreadDeg) {
  const n = Math.max(1, Math.round(count));
  /** @type {number[]} */
  const out = [];
  if (kind === 'ring') {
    for (let i = 0; i < n; i++) out.push(aim + (Math.PI * 2 * i) / n);
    return out;
  }
  const span = kind === 'spread' ? (spreadDeg * Math.PI) / 180 : 0;
  for (let i = 0; i < n; i++) out.push(n === 1 ? aim : aim - span / 2 + (span * i) / (n - 1));
  return out;
}

/** @returns {any} the Phaser namespace, when the engine is on the page. */
function phaserGlobal() {
  return typeof window !== 'undefined' ? /** @type {any} */ (window).Phaser : undefined;
}

/**
 * Fill the sprite with one colour. Phaser 4 dropped setTintFill for a tint MODE, and logs an
 * error for the old call, so the mode is set here and put back by untint().
 * @param {any} sprite
 * @param {number} colour
 * @returns {void}
 */
export function tintFill(sprite, colour) {
  if (typeof sprite.setTint !== 'function') return;
  sprite.setTint(colour);
  const P = phaserGlobal();
  if (typeof sprite.setTintMode === 'function' && P && P.TintModes) sprite.setTintMode(P.TintModes.FILL);
}

/**
 * Clear the tint and put the mode back to multiply, so a later tint from the game darkens the
 * sprite as it expects rather than filling it.
 * @param {any} sprite
 * @returns {void}
 */
export function untint(sprite) {
  if (typeof sprite.clearTint === 'function') sprite.clearTint();
  const P = phaserGlobal();
  if (typeof sprite.setTintMode === 'function' && P && P.TintModes) sprite.setTintMode(P.TintModes.MULTIPLY);
}

/** The angle from the boss to a point. */
function angleTo(world, p) {
  return Math.atan2(p.y - world.sprite.y, p.x - world.sprite.x);
}

/** Turn an actor handle to face a horizontal direction; a bare sprite is left as it is. */
function faceToward(world, dx) {
  if (world.actor && dx !== 0) world.actor.face(dx < 0 ? 'left' : 'right');
}

/** Let a tween move a physics body without the body fighting it, and remember to put it back. */
function holdBody(world) {
  const body = world.sprite.body;
  if (!body) return;
  if (typeof body.setVelocity === 'function') body.setVelocity(0, 0);
  world.bodyMoves = body.moves;
  body.moves = false;
}

function releaseBody(world) {
  const body = world.sprite.body;
  if (!body || world.bodyMoves === undefined) return;
  body.moves = world.bodyMoves;
  world.bodyMoves = undefined;
}

/* ── The kinds ────────────────────────────────────────────────────────────────────────────── */

function move(world, st, next) {
  const to = resolveTo(world, st.to !== undefined ? st.to : st);
  const span = world.ms(st.ms, MOVE_MS);
  const sprite = world.sprite;
  faceToward(world, to.x - sprite.x);
  if (!world.scene.tweens || span <= 0) {
    sprite.setPosition(to.x, to.y);
    world.after(span, next);
    return;
  }
  holdBody(world);
  world.tween({
    targets: sprite, x: to.x, y: to.y, duration: span, ease: world.ease,
    onComplete: function () {
      releaseBody(world);
      next();
    },
  });
}

function dash(world, st, next) {
  const to = resolveTo(world, st.toward || 'target');
  const sprite = world.sprite;
  const dx = to.x - sprite.x;
  const dy = to.y - sprite.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = typeof st.speed === 'number' ? st.speed : DASH_SPEED;
  const span = world.ms(st.ms, DASH_MS);
  faceToward(world, dx);
  if (sprite.body && typeof sprite.setVelocity === 'function') {
    world.held = { vx: (dx / len) * speed, vy: (dy / len) * speed };
    sprite.setVelocity(world.held.vx, world.held.vy);
    world.after(span, function () {
      world.held = null;
      sprite.setVelocity(0, 0);
      next();
    });
    return;
  }
  const far = (speed * span) / 1000;
  if (!world.scene.tweens) {
    sprite.setPosition(sprite.x + (dx / len) * far, sprite.y + (dy / len) * far);
    world.after(span, next);
    return;
  }
  world.tween({
    targets: sprite, x: sprite.x + (dx / len) * far, y: sprite.y + (dy / len) * far,
    duration: span, ease: 'Quad.easeOut', onComplete: next,
  });
}

function telegraph(world, st, next) {
  const kind = st.kind === 'ring' || st.kind === 'line' ? st.kind : 'flash';
  const span = world.ms(st.ms, TELEGRAPH_MS);
  const colour = toneColour(world.th, st.tone, world.th.warn);
  const sprite = world.sprite;
  const scene = world.scene;
  const aim = angleTo(world, resolveTo(world, 'target'));
  const still = reducedMotion();
  world.emit('telegraph', { kind: kind, ms: span, tone: colour, angle: aim, x: sprite.x, y: sprite.y });

  if (kind === 'flash') {
    if (still || span < BLINK_HALF * 2) {
      tintFill(sprite, colour);
      world.after(Math.min(FLASH_MS, span), function () { untint(sprite); });
    } else {
      let left = Math.floor(span / (BLINK_HALF * 2));
      const blink = function () {
        if (left <= 0) return;
        left -= 1;
        tintFill(sprite, colour);
        world.after(BLINK_HALF, function () {
          untint(sprite);
          world.after(BLINK_HALF, blink);
        });
      };
      blink();
    }
    world.after(span, next);
    return;
  }

  const g = world.own(scene.add.graphics());
  g.setDepth((sprite.depth || 0) - 1);
  const radius = typeof st.radius === 'number' ? st.radius : RING_RADIUS;
  const length = typeof st.length === 'number' ? st.length : LINE_LENGTH;
  const draw = function (r, a) {
    g.clear();
    g.setPosition(sprite.x, sprite.y);
    g.lineStyle(kind === 'ring' ? 2 : 3, colour, a);
    if (kind === 'ring') g.strokeCircle(0, 0, r);
    else g.lineBetween(0, 0, Math.cos(aim) * length, Math.sin(aim) * length);
  };
  const done = function () {
    world.disown(g);
    next();
  };
  if (still || !scene.tweens) {
    draw(radius, 0.9);
    world.after(Math.min(FLASH_MS, span), function () { g.clear(); });
    world.after(span, done);
    return;
  }
  const state = { r: kind === 'ring' ? 6 : radius, a: 0.25 };
  draw(state.r, state.a);
  world.tween({
    targets: state, r: radius, a: 0.95, duration: span, ease: 'Linear',
    onUpdate: function () { draw(state.r, state.a); },
    onComplete: done,
  });
}

function fire(world, st, next) {
  const kind = st.kind === 'spread' || st.kind === 'ring' || st.kind === 'rain' ? st.kind : 'aimed';
  const count = Math.max(1, Math.round(typeof st.count === 'number' ? st.count : (kind === 'aimed' ? 1 : 8)));
  const speed = typeof st.speed === 'number' ? st.speed : FIRE_SPEED;
  const sprite = world.sprite;
  const call = function (origin, angles) {
    world.emit('fire', { origin: origin, angles: angles });
    if (typeof world.spec.onFire === 'function') world.spec.onFire(origin, angles);
  };

  if (kind === 'rain') {
    const span = world.ms(st.ms, RAIN_MS);
    const view = viewOf(world.scene);
    const t = world.target();
    const spread = typeof st.spread === 'number' ? st.spread : view.width;
    const cx = t ? t.x : view.cx;
    for (let i = 0; i < count; i++) {
      world.after((span * i) / count, function () {
        const x = Math.max(view.x, Math.min(view.right, cx - spread / 2 + Math.random() * spread));
        call({ x: x, y: view.y - 12, speed: speed, kind: 'rain' }, [Math.PI / 2]);
      });
    }
    world.after(span, next);
    return;
  }

  const aim = angleTo(world, resolveTo(world, 'target'));
  const angles = anglesFor(kind, aim, count, typeof st.spread === 'number' ? st.spread : SPREAD_DEG);
  call({ x: sprite.x, y: sprite.y, speed: speed, kind: kind }, angles);
  next();
}

function spawn(world, st, next) {
  const kind = st.kind == null ? 'minion' : String(st.kind);
  const count = Math.max(1, Math.round(typeof st.count === 'number' ? st.count : 2));
  const where = st.at === 'top' || st.at === 'around' ? st.at : 'sides';
  const view = viewOf(world.scene);
  const sprite = world.sprite;
  const radius = typeof st.radius === 'number' ? st.radius : SPAWN_RADIUS;
  for (let i = 0; i < count; i++) {
    let x;
    let y;
    if (where === 'sides') {
      x = i % 2 === 0 ? view.x + EDGE : view.right - EDGE;
      y = sprite.y;
    } else if (where === 'top') {
      x = view.x + (view.width * (i + 1)) / (count + 1);
      y = view.y + EDGE;
    } else {
      const a = (Math.PI * 2 * i) / count - Math.PI / 2;
      x = sprite.x + Math.cos(a) * radius;
      y = sprite.y + Math.sin(a) * radius;
    }
    world.emit('spawn', { kind: kind, x: x, y: y });
    if (typeof world.spec.onSpawn === 'function') world.spec.onSpawn(x, y, kind);
  }
  next();
}

function slam(world, st, next) {
  const span = world.ms(st.ms, SLAM_MS);
  const height = typeof st.height === 'number' ? st.height : SLAM_HEIGHT;
  const sprite = world.sprite;
  const land = function () {
    const feetY = sprite.y + (sprite.displayHeight || 32) * (typeof sprite.originY === 'number' ? 1 - sprite.originY : 0.5);
    if (world.juice) world.juice.shake();
    if (world.fx) world.fx.at(sprite.x, feetY, 'dust', { count: 14 });
    else if (world.juice) world.juice.burst(sprite.x, feetY, 'dust');
    world.emit('slam', { x: sprite.x, y: feetY });
    world.after(span * 0.3, next);
  };
  if (reducedMotion() || !world.scene.tweens) {
    world.after(span * 0.7, land);
    return;
  }
  holdBody(world);
  const ground = sprite.y;
  world.tween({
    targets: sprite, y: ground - height, duration: span * 0.45, ease: 'Quad.easeOut',
    onComplete: function () {
      world.tween({
        targets: sprite, y: ground, duration: span * 0.25, ease: 'Quad.easeIn',
        onComplete: function () {
          releaseBody(world);
          land();
        },
      });
    },
  });
}

/** The actor's death, waited for; a bare sprite fades and is hidden. */
function die(world, next) {
  const sprite = world.sprite;
  if (world.actor && typeof world.actor.die === 'function') {
    world.actor.die(next);
    return;
  }
  if (sprite.body && typeof sprite.setVelocity === 'function') sprite.setVelocity(0, 0);
  const hide = function () {
    if (typeof sprite.setVisible === 'function') sprite.setVisible(false);
    if (sprite.body && typeof sprite.body.setEnable === 'function') sprite.body.setEnable(false);
    next();
  };
  if (reducedMotion() || !world.scene.tweens) {
    hide();
    return;
  }
  world.tween({ targets: sprite, alpha: 0, duration: 300, ease: 'Quad.easeIn', onComplete: hide });
}

/* ── The dispatcher ───────────────────────────────────────────────────────────────────────── */

/**
 * Run one leaf step. loop and random are unrolled by boss.js before they reach here.
 * @param {any} world  what a step may reach: scene, sprite, actor, target(), th, ease, spec, fx,
 *   juice, ms(), after(), tween(), own(), disown(), emit()
 * @param {any} st
 * @param {() => void} next
 * @returns {void}
 */
export function runStep(world, st, next) {
  if (!st || typeof st !== 'object') {
    next();
    return;
  }
  if (st.move) { move(world, st.move, next); return; }
  if (st.dash) { dash(world, st.dash, next); return; }
  if (st.telegraph) { telegraph(world, st.telegraph, next); return; }
  if (st.fire) { fire(world, st.fire, next); return; }
  if (st.spawn) { spawn(world, st.spawn, next); return; }
  if (st.slam) { slam(world, st.slam === true ? {} : st.slam, next); return; }
  if (st.die) { die(world, next); return; }
  if (typeof st.wait === 'number') { world.after(world.ms(st.wait, 0), next); return; }
  if (typeof st.fn === 'function') {
    const r = st.fn(world.ctx);
    if (typeof r === 'number' && isFinite(r) && r > 0) world.after(world.ms(r, 0), next);
    else next();
    return;
  }
  console.warn('[aimeat-phaser] boss: a step with none of move, dash, telegraph, fire, spawn, slam, '
    + 'wait, fn, loop, random or die was skipped:', st);
  next();
}
