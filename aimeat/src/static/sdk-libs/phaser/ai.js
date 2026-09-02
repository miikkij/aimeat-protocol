/**
 * @file phaser/ai.js
 * @description Enemies that behave: a small state machine on an actor (or a bare physics sprite)
 *   with a built-in set of behaviours, the conditions that move it between them, the senses it
 *   reads the world with, and the routes it walks. Every game on this node otherwise writes the
 *   same patrol-then-chase by hand, and the second enemy copies the first with a bug.
 *
 *   A BRAIN IS STATES, RULES AND SENSES. Each state runs one behaviour (patrol, wander, guard,
 *   chase, flee, shoot, ambush, orbit, sequence, or a game's own); the rules say which condition
 *   moves it to which state; the senses (sight with an optional field of view and, over a grid,
 *   a clear line; hearing through brain.noise(); the actor's own hit event; a health getter) are
 *   read once per frame and handed to both. brain(scene, actor, 'walker') is a whole enemy in
 *   one line, and the same call with a spec is any enemy at all.
 *
 *   THE BRAIN DRIVES, THE GAME OWNS THE REST. It sets a velocity through the actor's own update()
 *   or drive() (or setVelocity on a bare sprite), so the actor's clips, facing, stun and death
 *   keep working; a shot is a call to spec.onShoot(origin, angle) because the projectile is the
 *   game's; a death stops the brain because the actor says so. destroy() unbinds and takes the
 *   debug drawing away, and leaves the sprite where it stands: the brain never owned it.
 *
 *   NOTHING IS LEFT RUNNING. One listener on the scene's update, one entry in the noise registry,
 *   one hit listener on the actor, and all three go on destroy() or on the scene's shutdown. The
 *   debug drawing is redrawn each frame and never tweened. Less motion changes nothing here: an
 *   enemy's movement is the game, and the telegraph flash is one frame.
 * @structure PRESETS · the noise registry · holds() (the condition words) · brain(scene,
 *   subject, spec) with perceive / rules / step / debug; the legs and the behaviours are
 *   ./ai-behaviours.js and the routes ./ai-path.js
 * @usage
 *   const foe = AIMEAT.phaser.actor(this, { key: 'walker', x: 300, y: 200, speed: 70 });
 *   const mind = AIMEAT.phaser.brain(this, foe, {
 *     archetype: 'walker', target: hero, grid: world, sight: 240,
 *     onShoot: (from, angle) => bullets.fire(from.x, from.y, angle),
 *   });
 *   mind.on('shoot', () => sfx.play('pew'));
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the state machine, ten behaviours, the condition words,
 *     sight, hearing and the noise registry, the archetype presets, the debug drawing.
 */
import { look, cssColour } from './tokens.js';
import { motor, behaviours, build } from './ai-behaviours.js';
import { findPath, smoothPath, flowField, lineClear } from './ai-path.js';

export { behaviours };

/** The route maths, for a game that wants a path without a brain. */
export const pathfind = { findPath: findPath, smoothPath: smoothPath, flowField: flowField, lineClear: lineClear };

/** Just under the HUD's 900, so the drawing sits over the game and under the score. */
const DEBUG_DEPTH = 890;

/** A frame longer than this is a tab that was hidden, and is clamped so nothing teleports. */
const MAX_DT = 100;

/** How long a sighting or a noise is remembered when the spec does not say. */
const MEMORY_MS = 1500;

/** The archetypes: a starting state, rules, and what the enemy of that name usually wants. */
const PRESETS = {
  slime: { start: 'patrol', rules: [] },
  bat: {
    start: 'wander', mode: 'topdown', fly: true,
    rules: [{ from: 'wander', to: 'chase', when: 'sees' }, { from: 'chase', to: 'wander', when: 'lost' }],
  },
  walker: {
    start: 'patrol', behaviours: { shoot: { telegraphMs: 200 } },
    rules: [{ from: 'patrol', to: 'shoot', when: 'sees' }, { from: 'shoot', to: 'patrol', when: 'lost' }],
  },
  'boss-minion': { start: 'ambush', rules: [{ from: 'chase', to: 'ambush', when: 'lost' }] },
  guard: {
    start: 'guard',
    rules: [{ from: 'guard', to: 'chase', when: { any: ['sees', 'heard'] } }, { from: 'chase', to: 'guard', when: 'lost' }],
  },
};

/** The condition words. Anything else is reported once and never holds. */
const WORDS = { sees: true, lost: true, hurt: true, heard: true, done: true };

/** Every live brain, so a noise can find the ones in range. */
const LIVE = new Set();

/**
 * @typedef {object} BrainRule
 * @property {string|string[]} from   a state, a list, or 'any'
 * @property {string} to
 * @property {BrainCondition} when
 */

/**
 * A condition: one of the words 'sees', 'lost', 'hurt', 'heard', 'done'; an object with one of
 * near (px), far (px), healthBelow (a share), timer (ms), all (a list), any (a list), not (one);
 * a list, which holds when all of its parts do; or a function of the context.
 *   sees: the target is within sight (and the field of view, and the sight line over the grid)
 *   · lost: nothing to chase: not seen, the memory has expired, no noise · hurt: the actor was
 *   hit this frame · heard: a noise is remembered · done: the behaviour reports it is finished
 *   · near / far: the distance to the target · healthBelow: spec.health() under a share ·
 *   timer: milliseconds in the state
 * @typedef {string|Record<string, any>|any[]|((ctx: BrainContext) => boolean)} BrainCondition
 */

/**
 * @typedef {object} BrainSpec
 * @property {'slime'|'bat'|'walker'|'boss-minion'|'guard'} [archetype]  a preset the rest of
 *   the spec overrides; a plain string as the spec means the same
 * @property {string} [start]              the first state. Default: the preset's, or 'patrol'.
 * @property {Record<string, any>} [behaviours]  config per state: { patrol: { points, speed },
 *   lurk: { type: 'wander', radius: 60 } }. A state's behaviour is the built-in of its name
 *   unless the config names a type (a built-in name or a factory).
 * @property {BrainRule[]} [rules]
 * @property {any} [target]                a sprite, an actor, a point, or a function returning one
 * @property {number} [sight]              pixels. Default 200.
 * @property {number|false} [hearing]      how far a noise is heard from, whatever its own radius.
 *   Default sight; false is deaf.
 * @property {number} [fov]                degrees round the facing that sight covers. Default:
 *   all round.
 * @property {number} [memoryMs]           how long a sighting or a noise lasts. Default 1500.
 * @property {any} [grid]                  boolean[][] or a tileWorld: routes, sight lines and
 *   the ground probe read it
 * @property {number} [tile]               the grid's tile size. Default: the tileWorld's, or 32.
 * @property {(x: number, y: number) => boolean} [solid]   the game's own ground answer
 * @property {(from: { x: number, y: number }, to: { x: number, y: number }) => boolean} [los]
 *   the game's own sight-line answer, in world pixels
 * @property {'platformer'|'topdown'} [mode]  Default: the actor's; for a bare sprite, platformer
 *   when the world has gravity. A flying thing in a platformer is topdown with fly: true.
 * @property {boolean} [fly]               turn the body's gravity off
 * @property {number} [speed]              Default: the actor's move.speed, or 80.
 * @property {number} [jump]               Default: the actor's move.jump, or 320.
 * @property {{ x: number, y: number }} [home]  the post and the wander centre. Default: where
 *   the sprite was when the brain was made.
 * @property {() => number} [health]       0..1, for healthBelow
 * @property {(origin: { x: number, y: number }, angle: number, ctx: BrainContext) => void} [onShoot]
 * @property {'left'|'right'} [artFaces]   a bare sprite's drawn facing. Default 'right'.
 * @property {boolean} [auto]              step on the scene's update. Default true.
 * @property {boolean} [debug]
 * @property {() => number} [random]       a source in [0, 1), for a replay. Default Math.random.
 * @property {number} [budget]             the most nodes one route search may expand
 */

/**
 * What a behaviour and a custom condition are handed. The motor's methods are on it too: go,
 * walk, drive, stop, face, facing, probe, solidAt, onGround, grid, walkable, toTile, toWorld.
 * @typedef {object} BrainContext
 * @property {any} sprite
 * @property {any} actor        null for a bare sprite
 * @property {'platformer'|'topdown'} mode
 * @property {number} x
 * @property {number} y
 * @property {number} speed
 * @property {number} sight
 * @property {number} tile
 * @property {{ x: number, y: number }} home
 * @property {BrainSpec} spec
 * @property {number} now
 * @property {number} dt
 * @property {string} state
 * @property {number} stateMs
 * @property {{ x: number, y: number }|null} target   where the target is, when there is one
 * @property {boolean} sees
 * @property {{ x: number, y: number, at: number }|null} lastSeen
 * @property {{ x: number, y: number, radius: number, at: number }|null} noise
 * @property {boolean} done     a behaviour sets it when it has nothing left to do
 * @property {() => number} distance     to the target, Infinity without one
 * @property {(a: any, b?: any) => number} dist   between a point and the sprite, or two points
 * @property {() => { x: number, y: number }|null} goal   seen, remembered, or heard
 * @property {(range: number) => boolean} visible   sees, at another range
 * @property {() => void} forgetNoise
 * @property {(state: string) => void} set
 * @property {(event: string, ...args: any[]) => void} emit
 * @property {(min: number, max: number) => number} rand
 * @property {() => void} flash     a one-frame tint in the theme's warn colour
 * @property {(point: { x: number, y: number }, speed?: number, o?: { arrive?: number, jump?: boolean, straight?: boolean }) => number} go
 * @property {(dir: number, speed?: number, o?: { jump?: boolean }) => any} walk
 * @property {(vx: number, vy: number) => void} drive
 * @property {() => void} stop
 * @property {(dir: any) => void} face
 * @property {() => { x: number, y: number }} facing
 * @property {(dir: number) => any} probe
 * @property {(x: number, y: number) => boolean} solidAt
 * @property {() => boolean} onGround
 * @property {() => any[][]|null} grid
 * @property {(tx: number, ty: number) => boolean} walkable
 * @property {(x: number, y: number) => { x: number, y: number }} toTile
 * @property {(t: { x: number, y: number }) => { x: number, y: number }} toWorld
 */

/**
 * @typedef {object} BrainHandle
 * @property {any} sprite
 * @property {any} actor
 * @property {'platformer'|'topdown'} mode
 * @property {BrainContext} ctx
 * @property {() => string} state
 * @property {(state: string) => boolean} set
 * @property {(t?: any) => any} target     set when given; answers the current one
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {boolean} paused
 * @property {(event: 'state'|'see'|'lose'|'shoot'|'telegraph'|'hear', fn: (...args: any[]) => void) => () => void} on
 * @property {(delta: number) => void} update   one frame, for auto: false
 * @property {() => Array<{ x: number, y: number }>|null} path   the route being walked, in world points
 * @property {(on: boolean) => void} debug
 * @property {() => void} hurt             tell a brain on a bare sprite it was hit
 * @property {(x: number, y: number, radius?: number) => boolean} hear   a noise for this brain alone
 * @property {() => void} destroy
 */

/**
 * @param {any} a
 * @param {any} b
 * @returns {number}
 */
function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * A brain on an actor or a physics sprite.
 * @param {any} scene
 * @param {any} subject   an ActorHandle, or a sprite with an arcade body
 * @param {BrainSpec|string} [spec]
 * @returns {BrainHandle}
 */
export function brain(scene, subject, spec) {
  /** @type {any} */
  const given = typeof spec === 'string' ? { archetype: spec } : (spec || {});
  const preset = PRESETS[given.archetype] || {};
  if (given.archetype && !PRESETS[given.archetype]) {
    console.warn('[aimeat-phaser] brain: "' + given.archetype + '" is not an archetype. They are '
      + Object.keys(PRESETS).join(', ') + '; going on with the spec alone.');
  }
  /** @type {any} */
  const s = Object.assign({}, preset, given);
  s.behaviours = Object.assign({}, preset.behaviours || {}, given.behaviours || {});
  s.rules = Array.isArray(given.rules) ? given.rules : (preset.rules || []);

  const isActor = !!(subject && subject.sprite && typeof subject.update === 'function');
  const actor = isActor ? subject : null;
  const sprite = isActor ? subject.sprite : subject;
  if (!sprite || typeof sprite.x !== 'number') {
    throw new Error('[aimeat-phaser] brain(): the second argument is an actor (from actor()) or a '
      + 'sprite with a physics body.');
  }
  const th = look(scene);
  const world = scene.physics && scene.physics.world;
  const gravity = world && world.gravity ? world.gravity.y : 0;
  const mode = s.mode === 'topdown' || s.mode === 'platformer' ? s.mode
    : (actor ? actor.mode : (gravity ? 'platformer' : 'topdown'));
  if (s.fly && sprite.body) {
    if (typeof sprite.body.setAllowGravity === 'function') sprite.body.setAllowGravity(false);
    else sprite.body.allowGravity = false;
  }
  const gridSource = s.grid || null;
  const tile = typeof s.tile === 'number' ? s.tile
    : (gridSource && gridSource.bounds && gridSource.bounds.tileWidth) || 32;
  const sight = typeof s.sight === 'number' ? s.sight : 200;
  const hearing = s.hearing === false ? -1 : (typeof s.hearing === 'number' ? s.hearing : sight);
  const fovRad = typeof s.fov === 'number' && s.fov > 0 && s.fov < 360 ? (s.fov * Math.PI) / 180 : 0;
  const memoryMs = typeof s.memoryMs === 'number' ? s.memoryMs : MEMORY_MS;
  const random = typeof s.random === 'function' ? s.random : Math.random;
  const home = s.home && typeof s.home.x === 'number' ? { x: s.home.x, y: s.home.y } : { x: sprite.x, y: sprite.y };

  const legs = motor({
    scene: scene, sprite: sprite, actor: actor, mode: mode,
    speed: typeof s.speed === 'number' ? s.speed : (actor ? actor.move.speed : 80),
    jump: typeof s.jump === 'number' ? s.jump : (actor ? actor.move.jump : 320),
    tile: tile, gridSource: gridSource, solid: typeof s.solid === 'function' ? s.solid : null,
    arrive: 6, artFaces: s.artFaces === 'left' ? 'left' : 'right',
    budget: typeof s.budget === 'number' ? s.budget : 0,
  });

  let state = '';
  let stateSince = 0;
  let rawTarget = s.target;
  /** @type {{ x: number, y: number }|null} */
  let targetPos = null;
  let sees = false;
  let wasSeeing = false;
  /** @type {{ x: number, y: number, at: number }|null} */
  let lastSeen = null;
  /** @type {{ x: number, y: number, radius: number, at: number, until: number }|null} */
  let noise = null;
  let hurt = false;
  let paused = false;
  let gone = false;
  let flashLeft = 0;
  /** @type {any} */
  let current = null;
  /** @type {Record<string, any>} */
  const instances = {};
  /** @type {Record<string, boolean>} */
  const warned = {};
  /** @type {Record<string, Array<(...args: any[]) => void>>} */
  const handlers = { state: [], see: [], lose: [], shoot: [], telegraph: [], hear: [] };
  /** @type {any} */
  let debugGfx = null;
  /** @type {any} */
  let debugLabel = null;

  function now() {
    return scene.time ? scene.time.now : 0;
  }

  /**
   * @param {string} event
   * @param {any} [a]
   * @param {any} [b]
   * @returns {void}
   */
  function emit(event, a, b) {
    const list = handlers[event];
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        fn(a, b);
      } catch (err) {
        console.warn('[aimeat-phaser] a brain handler for "' + event + '" threw:', err);
      }
    }
  }

  function once(key, text) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('[aimeat-phaser] brain: ' + text);
  }

  /* ── The senses ────────────────────────────────────────────────────────────────────────── */

  /** Where the target is now, or null when there is none, or it is dead or gone. */
  function resolveTarget() {
    const t = typeof rawTarget === 'function' ? rawTarget() : rawTarget;
    if (!t) return null;
    if (t.dead === true) return null;
    const pos = t.sprite && typeof t.sprite.x === 'number' ? t.sprite : t;
    if (pos.active === false) return null;
    return typeof pos.x === 'number' && typeof pos.y === 'number' ? { x: pos.x, y: pos.y } : null;
  }

  /**
   * Is the target within a range, inside the field of view, and on a clear line?
   * @param {number} range
   * @returns {boolean}
   */
  function visible(range) {
    if (!targetPos) return false;
    const d = distance(sprite, targetPos);
    if (d > range) return false;
    if (fovRad && d > 0) {
      const f = legs.facing();
      const cos = (f.x * (targetPos.x - sprite.x) + f.y * (targetPos.y - sprite.y)) / d;
      if (cos < Math.cos(fovRad / 2)) return false;
    }
    if (typeof s.los === 'function') return !!s.los({ x: sprite.x, y: sprite.y }, targetPos);
    const g = legs.grid();
    if (g) return lineClear(g, legs.toTile(sprite.x, sprite.y), legs.toTile(targetPos.x, targetPos.y));
    return true;
  }

  function perceive() {
    const t = now();
    targetPos = resolveTarget();
    sees = visible(sight);
    if (sees && targetPos) {
      lastSeen = { x: targetPos.x, y: targetPos.y, at: t };
      if (!wasSeeing) emit('see', targetPos);
    } else if (lastSeen && t - lastSeen.at > memoryMs) {
      lastSeen = null;
      emit('lose');
    }
    wasSeeing = sees;
    if (noise && t > noise.until) noise = null;
  }

  /**
   * A noise at a point. Heard when it is within its own radius or within this brain's hearing.
   * @param {number} x
   * @param {number} y
   * @param {number} [radius]
   * @returns {boolean}
   */
  function hear(x, y, radius) {
    if (gone || hearing < 0) return false;
    const r = typeof radius === 'number' ? radius : 0;
    const d = distance(sprite, { x: x, y: y });
    if (d > Math.max(r, hearing)) return false;
    noise = { x: x, y: y, radius: r, at: now(), until: now() + memoryMs };
    emit('hear', noise);
    return true;
  }

  /* ── The conditions ────────────────────────────────────────────────────────────────────── */

  function health() {
    if (typeof s.health === 'function') return Number(s.health());
    once('health', 'a healthBelow rule needs spec.health, a function answering 0..1. Read as 1.');
    return 1;
  }

  /**
   * @param {any} when
   * @returns {boolean}
   */
  function holds(when) {
    if (typeof when === 'function') return !!when(ctx);
    if (typeof when === 'string') {
      if (!WORDS[when]) once('word:' + when, '"' + when + '" is not a condition word (' + Object.keys(WORDS).join(', ') + '). It never holds.');
      if (when === 'sees') return sees;
      if (when === 'lost') return !sees && !ctx.goal();
      if (when === 'hurt') return hurt;
      if (when === 'heard') return !!noise;
      if (when === 'done') return !!ctx.done;
      return false;
    }
    if (Array.isArray(when)) return when.every(holds);
    if (!when || typeof when !== 'object') return false;
    if (Array.isArray(when.all)) return when.all.every(holds);
    if (Array.isArray(when.any)) return when.any.some(holds);
    if (when.not !== undefined) return !holds(when.not);
    if (typeof when.near === 'number') return !!targetPos && distance(sprite, targetPos) <= when.near;
    if (typeof when.far === 'number') return !targetPos || distance(sprite, targetPos) > when.far;
    if (typeof when.healthBelow === 'number') return health() < when.healthBelow;
    if (typeof when.timer === 'number') return now() - stateSince >= when.timer;
    once('cond', 'a rule has a condition with none of near, far, healthBelow, timer, all, any or not. It never holds.');
    return false;
  }

  /**
   * @param {any} from
   * @returns {boolean}
   */
  function fromMatches(from) {
    if (from === 'any' || from === undefined) return true;
    if (Array.isArray(from)) return from.indexOf(state) >= 0;
    return from === state;
  }

  /** The first rule that holds wins, one transition per frame. */
  function rules() {
    for (const rule of s.rules) {
      if (!rule || typeof rule.to !== 'string' || rule.to === state) continue;
      if (!fromMatches(rule.from)) continue;
      if (holds(rule.when)) {
        set(rule.to);
        return;
      }
    }
  }

  /* ── The states ────────────────────────────────────────────────────────────────────────── */

  /**
   * @param {string} name
   * @returns {any}
   */
  function make(name) {
    const cfg = s.behaviours[name];
    if (typeof cfg === 'function') return build(ctx, cfg, {});
    const c = cfg || {};
    return build(ctx, c.type || name, c);
  }

  /**
   * @param {string} next
   * @returns {boolean}
   */
  function set(next) {
    if (gone || !next || next === state) return false;
    const prev = state;
    if (current && typeof current.exit === 'function') current.exit();
    state = next;
    stateSince = now();
    ctx.done = false;
    legs.forgetRoute();
    current = instances[next] || (instances[next] = make(next));
    if (typeof current.enter === 'function') current.enter();
    emit('state', next, prev);
    return true;
  }

  /** One frame. */
  function step(delta) {
    if (gone || paused) return;
    if (actor && actor.dead) return;
    const dt = Math.max(0, Math.min(MAX_DT, typeof delta === 'number' && isFinite(delta) ? delta : 16));
    ctx.dt = dt;
    ctx.now = now();
    if (flashLeft > 0 && --flashLeft === 0 && typeof sprite.clearTint === 'function') sprite.clearTint();
    perceive();
    rules();
    hurt = false;
    if (current) current.update(dt);
    if (debugGfx) drawDebug();
  }

  /* ── The debug drawing ─────────────────────────────────────────────────────────────────── */

  function drawDebug() {
    const g = debugGfx;
    const x = sprite.x;
    const y = sprite.y;
    g.clear();
    g.lineStyle(1, th.accent, 0.5);
    g.strokeCircle(x, y, sight);
    if (fovRad) {
      const f = legs.facing();
      const a = Math.atan2(f.y, f.x);
      g.lineStyle(1, th.accent, 0.35);
      g.beginPath();
      g.moveTo(x, y);
      g.arc(x, y, sight, a - fovRad / 2, a + fovRad / 2, false);
      g.closePath();
      g.strokePath();
    }
    if (hearing > 0 && hearing !== sight) {
      g.lineStyle(1, th.inkDim, 0.35);
      g.strokeCircle(x, y, hearing);
    }
    const route = legs.path;
    if (route && route.length) {
      g.lineStyle(2, th.ok, 0.8);
      g.beginPath();
      g.moveTo(x, y);
      for (const p of route) g.lineTo(p.x, p.y);
      g.strokePath();
    }
    if (sees && targetPos) {
      g.lineStyle(1, th.err, 0.7);
      g.lineBetween(x, y, targetPos.x, targetPos.y);
    } else if (lastSeen) {
      g.lineStyle(1, th.warn, 0.5);
      g.lineBetween(x, y, lastSeen.x, lastSeen.y);
    }
    if (noise) {
      g.lineStyle(1, th.inkDim, 0.5);
      g.strokeCircle(noise.x, noise.y, 6);
    }
    const hh = (sprite.displayHeight || sprite.height || tile) / 2;
    debugLabel.setText(state);
    debugLabel.setPosition(Math.round(x), Math.round(y - hh - 4));
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function debug(on) {
    if (gone || !scene.add) return;
    if (on && !debugGfx) {
      debugGfx = scene.add.graphics().setDepth(DEBUG_DEPTH);
      debugLabel = scene.add.text(0, 0, state, {
        fontFamily: th.fontMono, fontSize: '10px', color: cssColour(th.ink),
      }).setOrigin(0.5, 1).setDepth(DEBUG_DEPTH);
      drawDebug();
    } else if (!on && debugGfx) {
      debugGfx.destroy();
      debugLabel.destroy();
      debugGfx = null;
      debugLabel = null;
    }
  }

  /* ── The context, the bindings, the handle ─────────────────────────────────────────────── */

  /** @type {any} */
  const ctx = {
    sprite: sprite,
    actor: actor,
    mode: mode,
    get x() { return sprite.x; },
    get y() { return sprite.y; },
    speed: typeof s.speed === 'number' ? s.speed : (actor ? actor.move.speed : 80),
    sight: sight,
    tile: tile,
    home: home,
    spec: s,
    now: 0,
    dt: 0,
    get state() { return state; },
    get stateMs() { return now() - stateSince; },
    get target() { return targetPos; },
    get sees() { return sees; },
    get lastSeen() { return lastSeen; },
    get noise() { return noise; },
    done: false,
    distance() { return targetPos ? distance(sprite, targetPos) : Infinity; },
    dist(a, b) { return b ? distance(a, b) : distance(sprite, a); },
    goal() {
      if (sees && targetPos) return targetPos;
      if (lastSeen) return { x: lastSeen.x, y: lastSeen.y };
      if (noise) return { x: noise.x, y: noise.y };
      return null;
    },
    visible: visible,
    forgetNoise() { noise = null; },
    set: set,
    emit: emit,
    rand(min, max) { return min + random() * (max - min); },
    flash() {
      if (typeof sprite.setTintFill !== 'function') return;
      sprite.setTintFill(th.warn);
      flashLeft = 2;
    },
    go: legs.go,
    walk: legs.walk,
    drive: legs.drive,
    stop: legs.stop,
    face: legs.face,
    facing: legs.facing,
    probe: legs.probe,
    solidAt: legs.solidAt,
    onGround: legs.onGround,
    grid: legs.grid,
    walkable: legs.walkable,
    toTile: legs.toTile,
    toWorld: legs.toWorld,
  };

  const onSceneUpdate = function (_time, delta) { step(delta); };
  const offHit = actor ? actor.on('hit', function () { hurt = true; }) : null;

  function destroy() {
    if (gone) return;
    gone = true;
    LIVE.delete(api);
    scene.events.off('shutdown', destroy);
    if (s.auto !== false) scene.events.off('update', onSceneUpdate);
    if (offHit) offHit();
    if (current && typeof current.exit === 'function') current.exit();
    current = null;
    if (debugGfx) {
      if (debugGfx.scene) debugGfx.destroy();
      if (debugLabel && debugLabel.scene) debugLabel.destroy();
      debugGfx = null;
      debugLabel = null;
    }
    for (const name in handlers) handlers[name].length = 0;
  }

  /** @type {BrainHandle} */
  const api = {
    sprite: sprite,
    actor: actor,
    mode: mode,
    ctx: ctx,
    state() { return state; },
    set: set,
    target(t) {
      if (arguments.length) rawTarget = t;
      return rawTarget;
    },
    pause() {
      if (paused || gone) return;
      paused = true;
      legs.stop();
    },
    resume() { paused = false; },
    get paused() { return paused; },
    on(event, fn) {
      if (typeof fn !== 'function' || !handlers[event]) {
        return function () { /* nothing was registered */ };
      }
      handlers[event].push(fn);
      return function off() {
        const at = handlers[event].indexOf(fn);
        if (at >= 0) handlers[event].splice(at, 1);
      };
    },
    update: step,
    path() { return legs.path; },
    debug: debug,
    hurt() { hurt = true; },
    hear: hear,
    destroy: destroy,
  };

  set(typeof s.start === 'string' ? s.start : 'patrol');
  LIVE.add(api);
  if (s.auto !== false) scene.events.on('update', onSceneUpdate);
  scene.events.once('shutdown', destroy);
  if (s.debug) debug(true);
  return api;
}

/**
 * A noise at a point: every live brain within the radius, or within its own hearing, hears it.
 * Pass the scene to reach only the brains in it.
 * @param {number} x
 * @param {number} y
 * @param {number} [radius]
 * @param {any} [scene]
 * @returns {number} how many heard it
 */
brain.noise = function (x, y, radius, scene) {
  let heard = 0;
  for (const b of LIVE) {
    if (scene && b.sprite && b.sprite.scene && b.sprite.scene !== scene) continue;
    if (b.hear(x, y, radius)) heard += 1;
  }
  return heard;
};
