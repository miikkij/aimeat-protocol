/**
 * @file phaser/ai-behaviours.js
 * @description The legs and the habits of a brain: the motor that turns "go there" into a
 *   velocity on an actor or a bare physics sprite, and the registry of built-in behaviours a
 *   state runs. ai.js owns the state machine, the perception and the handle; this file is what
 *   a state does while it is the state.
 *
 *   ONE MOTOR, TWO MODES. In platformer mode a move is a direction plus a jump, and whether to
 *   jump is read off three probe points ahead of the body (the foot, the knee, above the head):
 *   no ground at the foot is a gap, solid at the knee but clear above the head is a low wall, and
 *   both are cleared with a jump when the behaviour allows one and turned away from when it does
 *   not. In topdown mode a move is a velocity toward the next point of a route over spec.grid,
 *   or a straight line when there is no grid or no route.
 *
 *   A PROBE ASKS THE CHEAPEST THING THAT KNOWS. spec.solid when the game gave one, the grid when
 *   there is one (a tileWorld's walls are tiles, which no physics query sees), and otherwise
 *   scene.physics.overlapRect over the static bodies, which is what a platformer() level's
 *   ground is. The world's bounds count as a wall.
 *
 *   A BEHAVIOUR IS A FACTORY: (ctx, cfg) to { enter, update, exit }. The registry is a plain
 *   object, so a game adds its own by name and a state of that name, or a state whose config
 *   says type, runs it.
 * @structure motor(subject) · pick helpers · behaviours: idle, patrol, wander, guard, chase, flee,
 *   shoot, ambush, orbit, sequence · build(ctx, name, cfg)
 * @usage  internal to ./ai.js; the registry reaches an app as AIMEAT.phaser.behaviours
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the motor with its probes and route following, and the ten
 *     built-in behaviours.
 */
import { findPath, smoothPath, flowField, gridOf } from './ai-path.js';

/** How close to a route's waypoint counts as reached, as a share of a tile. */
const WAYPOINT_SHARE = 0.35;

/** A route is recomputed after this many milliseconds even when the goal tile has not moved. */
const REPATH_MS = 250;

/** How long a wander leg may last before it is given up as stuck. */
const STUCK_MS = 4000;

/**
 * @typedef {object} Probe
 * @property {boolean} gap    no ground at the foot ahead
 * @property {boolean} wall   solid at knee height ahead
 * @property {boolean} high   solid above the head ahead, so a jump would not clear it
 * @property {boolean} edge   the world's bounds are ahead
 */

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
function hypot(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The movement half of a brain. Reads and writes the body; knows nothing about states.
 * @param {{ scene: any, sprite: any, actor: any, mode: 'platformer'|'topdown', speed: number,
 *   jump: number, tile: number, gridSource: any, solid: ((x: number, y: number) => boolean)|null,
 *   arrive: number, artFaces: string, budget: number }} subject
 * @returns {any}
 */
export function motor(subject) {
  const scene = subject.scene;
  const sprite = subject.sprite;
  const actor = subject.actor;
  const topdown = subject.mode === 'topdown';
  const tile = subject.tile;
  let facingX = 1;
  let facingY = 0;
  /** @type {Array<{ x: number, y: number }>|null} */
  let route = null;
  let routeKey = '';
  let routeAt = -Infinity;
  let routeIndex = 0;

  function now() {
    return scene.time ? scene.time.now : 0;
  }

  function toTile(x, y) {
    return { x: Math.floor(x / tile), y: Math.floor(y / tile) };
  }

  function toWorld(t) {
    return { x: t.x * tile + tile / 2, y: t.y * tile + tile / 2 };
  }

  function grid() {
    return gridOf(subject.gridSource);
  }

  function walkable(tx, ty) {
    const g = grid();
    return !!(g && g[ty] && g[ty][tx]);
  }

  /** Is the world's edge there? Anything past the physics bounds counts as a wall. */
  function outside(x, y) {
    const world = scene.physics && scene.physics.world;
    const b = world && world.bounds;
    if (!b || typeof b.x !== 'number') return false;
    return x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height;
  }

  /**
   * Is there something solid at a world point? The game's own answer first, the grid next, the
   * static bodies last.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  function solidAt(x, y) {
    if (subject.solid) return !!subject.solid(x, y);
    if (outside(x, y)) return true;
    const g = grid();
    if (g) {
      const t = toTile(x, y);
      return !walkable(t.x, t.y);
    }
    const physics = scene.physics;
    if (physics && typeof physics.overlapRect === 'function') {
      return physics.overlapRect(x - 1, y - 1, 2, 2, false, true).length > 0;
    }
    return false;
  }

  function halfWidth() {
    return (sprite.displayWidth || sprite.width || tile) / 2;
  }

  function halfHeight() {
    return (sprite.displayHeight || sprite.height || tile) / 2;
  }

  /**
   * The three points ahead of the body, asked.
   * @param {number} dir  -1 or 1
   * @returns {Probe}
   */
  function probe(dir) {
    const d = dir < 0 ? -1 : 1;
    const hw = halfWidth();
    const hh = halfHeight();
    const ax = sprite.x + d * (hw + tile * 0.35);
    return {
      gap: !solidAt(ax, sprite.y + hh + tile * 0.5),
      wall: solidAt(ax, sprite.y + hh - tile * 0.25),
      high: solidAt(ax, sprite.y - hh - tile * 0.6),
      edge: outside(ax, sprite.y),
    };
  }

  function onGround() {
    if (topdown) return true;
    const body = sprite.body;
    return !!(body && ((body.blocked && body.blocked.down) || (body.touching && body.touching.down)));
  }

  function flip(vx) {
    if (actor || vx === 0 || typeof sprite.setFlipX !== 'function') return;
    sprite.setFlipX((vx < 0) !== (subject.artFaces === 'left'));
  }

  function stop() {
    route = null;
    if (actor) {
      if (topdown) actor.drive(0, 0);
      else actor.update({});
    } else if (sprite.body) {
      if (topdown) sprite.setVelocity(0, 0);
      else sprite.setVelocityX(0);
    }
  }

  /**
   * Topdown: a raw velocity, with the facing read off it.
   * @param {number} vx
   * @param {number} vy
   * @returns {void}
   */
  function drive(vx, vy) {
    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      facingX = vx / len;
      facingY = vy / len;
    }
    if (actor) actor.drive(vx, vy);
    else if (sprite.body) sprite.setVelocity(vx, vy);
    flip(vx);
  }

  /**
   * Platformer: walk one way, and jump when the probes say so and the caller allows it.
   * @param {number} dir
   * @param {number} [speed]
   * @param {{ jump?: boolean }} [o]
   * @returns {Probe & { jumped: boolean }}
   */
  function walk(dir, speed, o) {
    const d = dir < 0 ? -1 : 1;
    const pace = speed > 0 ? speed : subject.speed;
    const p = probe(d);
    const jumpNow = !!(o && o.jump) && onGround() && ((p.wall && !p.high) || p.gap);
    facingX = d;
    facingY = 0;
    if (actor) {
      actor.move.speed = pace;
      actor.update({ left: d < 0, right: d > 0, jump: jumpNow });
    } else if (sprite.body) {
      sprite.setVelocityX(d * pace);
      if (jumpNow && typeof sprite.setVelocityY === 'function') sprite.setVelocityY(-subject.jump);
      flip(d);
    }
    return { gap: p.gap, wall: p.wall, high: p.high, edge: p.edge, jumped: jumpNow };
  }

  /**
   * Turn to face a side, or a point.
   * @param {'left'|'right'|{ x: number, y: number }} dir
   * @returns {void}
   */
  function face(dir) {
    let fx = facingX;
    let fy = facingY;
    if (dir === 'left') { fx = -1; fy = 0; } else if (dir === 'right') { fx = 1; fy = 0; } else if (dir && typeof dir.x === 'number') {
      const len = hypot(sprite.x, sprite.y, dir.x, dir.y) || 1;
      fx = (dir.x - sprite.x) / len;
      fy = (dir.y - sprite.y) / len;
    }
    facingX = fx;
    facingY = fy;
    if (actor) {
      if (topdown && actor.facing.length > 5) return; // a directional sheet turns by drive()
      if (fx !== 0) actor.face(fx < 0 ? 'left' : 'right');
    } else {
      flip(fx);
    }
  }

  function facing() {
    if (actor && !topdown) {
      facingX = actor.facing === 'left' ? -1 : 1;
      facingY = 0;
    }
    return { x: facingX, y: facingY };
  }

  /**
   * The route toward a point over the grid, kept until the goal tile moves or REPATH_MS passes.
   * @param {{ x: number, y: number }} point
   * @param {any[][]} g
   * @returns {{ x: number, y: number }|null} the waypoint to head for now
   */
  function waypoint(point, g) {
    const here = toTile(sprite.x, sprite.y);
    const goal = toTile(point.x, point.y);
    const key = goal.x + ',' + goal.y;
    if (!route || routeKey !== key || now() - routeAt > REPATH_MS) {
      const steps = findPath(g, here, goal, { diagonal: true, nearest: true, budget: subject.budget });
      if (steps && steps.length > 1) {
        const last = steps[steps.length - 1];
        route = smoothPath(g, steps).map(toWorld);
        if (last.x === goal.x && last.y === goal.y) route[route.length - 1] = { x: point.x, y: point.y };
        routeIndex = 1;
      } else {
        route = null;
      }
      routeKey = key;
      routeAt = now();
    }
    if (!route) return null;
    while (routeIndex < route.length - 1
      && hypot(sprite.x, sprite.y, route[routeIndex].x, route[routeIndex].y) <= tile * WAYPOINT_SHARE) {
      routeIndex += 1;
    }
    return route[routeIndex];
  }

  /**
   * Toward a point. Returns the distance still to go: 0 when arrived (and stopped), -1 when the
   * way is blocked and the caller did not allow a jump.
   * @param {{ x: number, y: number }} point
   * @param {number} [speed]
   * @param {{ arrive?: number, jump?: boolean, straight?: boolean }} [o]
   * @returns {number}
   */
  function go(point, speed, o) {
    const opt = o || {};
    const pace = speed > 0 ? speed : subject.speed;
    const arrive = typeof opt.arrive === 'number' ? opt.arrive : subject.arrive;
    if (!topdown) {
      const dx = point.x - sprite.x;
      if (Math.abs(dx) <= arrive) {
        stop();
        return 0;
      }
      const p = walk(dx < 0 ? -1 : 1, pace, { jump: !!opt.jump });
      if (!opt.jump && (p.gap || p.wall || p.edge)) {
        stop();
        return -1;
      }
      return Math.abs(dx);
    }
    const d = hypot(sprite.x, sprite.y, point.x, point.y);
    if (d <= arrive) {
      stop();
      return 0;
    }
    const g = opt.straight ? null : grid();
    const aim = (g && waypoint(point, g)) || point;
    const len = hypot(sprite.x, sprite.y, aim.x, aim.y) || 1;
    drive(((aim.x - sprite.x) / len) * pace, ((aim.y - sprite.y) / len) * pace);
    return d;
  }

  return {
    get x() { return sprite.x; },
    get y() { return sprite.y; },
    get path() { return route; },
    tile: tile,
    toTile: toTile,
    toWorld: toWorld,
    grid: grid,
    walkable: walkable,
    solidAt: solidAt,
    probe: probe,
    onGround: onGround,
    stop: stop,
    drive: drive,
    walk: walk,
    face: face,
    facing: facing,
    go: go,
    forgetRoute() { route = null; },
  };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The built-in behaviours
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A pause length from a config value: a number, or a [min, max] pair drawn from.
 * @param {any} ctx
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function span(ctx, value, min, max) {
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && value.length === 2) return ctx.rand(value[0], value[1]);
  return ctx.rand(min, max);
}

/**
 * @param {any} cfg
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function num(cfg, name, fallback) {
  return typeof cfg[name] === 'number' && isFinite(cfg[name]) ? cfg[name] : fallback;
}

/**
 * The built-in behaviours by name. Each is (ctx, cfg) to { enter?, update(dt), exit? }, and a
 * game may add its own: behaviours.taunt = function (ctx, cfg) { ... }.
 * @type {Record<string, (ctx: any, cfg: any) => { enter?: () => void, update: (dt: number) => void, exit?: () => void }>}
 */
export const behaviours = {
  /** Stand still. */
  idle(ctx) {
    return { update() { ctx.stop(); ctx.done = true; } };
  },

  /**
   * Between points when given, otherwise back and forth: along a platform (turning at an edge
   * or a wall) or across a span of `range` around home. Config: points, speed, pauseMs, range.
   */
  patrol(ctx, cfg) {
    const speed = num(cfg, 'speed', ctx.speed);
    const pauseMs = num(cfg, 'pauseMs', 0);
    let points = Array.isArray(cfg.points) && cfg.points.length ? cfg.points : null;
    let i = 0;
    let step = 1;
    let dir = 1;
    let pauseUntil = 0;
    return {
      enter() {
        dir = cfg.dir === -1 || cfg.dir === 1 ? cfg.dir : (ctx.facing().x < 0 ? -1 : 1);
        if (!points && ctx.mode === 'topdown') {
          const range = num(cfg, 'range', ctx.tile * 3);
          points = [{ x: ctx.home.x - range, y: ctx.home.y }, { x: ctx.home.x + range, y: ctx.home.y }];
          i = dir < 0 ? 0 : 1;
        }
      },
      update() {
        ctx.done = false;
        if (ctx.now < pauseUntil) { ctx.stop(); return; }
        if (points) {
          const remain = ctx.go(points[i], speed, { arrive: num(cfg, 'arrive', ctx.tile * 0.25), jump: false });
          if (remain === 0 || remain === -1) {
            if (i + step >= points.length || i + step < 0) step = -step;
            i += step;
            i = Math.max(0, Math.min(points.length - 1, i));
            pauseUntil = ctx.now + pauseMs;
            ctx.done = true;
          }
          return;
        }
        const p = ctx.walk(dir, speed);
        if (p.wall || p.gap || p.edge) {
          dir = -dir;
          pauseUntil = ctx.now + pauseMs;
          ctx.done = true;
        }
      },
    };
  },

  /**
   * A random walk within `radius` of home, with pauses. Over the grid a leg goes to a walkable
   * tile by route; on a platform it is a random direction for a random while.
   */
  wander(ctx, cfg) {
    const speed = num(cfg, 'speed', ctx.speed * 0.6);
    const radius = num(cfg, 'radius', ctx.tile * 4);
    let goal = null;
    let legUntil = 0;
    let pauseUntil = 0;
    let dir = 1;

    function pickGoal() {
      const g = ctx.grid();
      for (let tries = 0; tries < 8; tries++) {
        const a = ctx.rand(0, Math.PI * 2);
        const r = ctx.rand(radius * 0.3, radius);
        const p = { x: ctx.home.x + Math.cos(a) * r, y: ctx.home.y + Math.sin(a) * r };
        if (!g) return p;
        const t = ctx.toTile(p.x, p.y);
        if (ctx.walkable(t.x, t.y)) return ctx.toWorld(t);
      }
      return null;
    }

    function rest() {
      goal = null;
      pauseUntil = ctx.now + span(ctx, cfg.pauseMs, 400, 1400);
      ctx.stop();
      ctx.done = true;
    }

    return {
      enter() { goal = null; pauseUntil = 0; },
      update() {
        ctx.done = false;
        if (ctx.now < pauseUntil) { ctx.stop(); ctx.done = true; return; }
        if (ctx.mode === 'platformer') {
          if (!goal) {
            goal = { x: 0, y: 0 };
            dir = ctx.rand(0, 1) < 0.5 ? -1 : 1;
            legUntil = ctx.now + span(ctx, cfg.legMs, 500, 1500);
          }
          if (ctx.now >= legUntil) { rest(); return; }
          if (Math.abs(ctx.x - ctx.home.x) > radius && (ctx.x - ctx.home.x) * dir > 0) dir = -dir;
          const p = ctx.walk(dir, speed);
          if (p.wall || p.gap || p.edge) dir = -dir;
          return;
        }
        if (!goal) {
          goal = pickGoal();
          legUntil = ctx.now + STUCK_MS;
          if (!goal) { rest(); return; }
        }
        const remain = ctx.go(goal, speed, { jump: false });
        if (remain <= 0 || ctx.now >= legUntil) rest();
      },
    };
  },

  /** Hold a post (home unless cfg.post): return to it when away, face what comes near. */
  guard(ctx, cfg) {
    const speed = num(cfg, 'speed', ctx.speed);
    const faceRange = num(cfg, 'faceRange', ctx.sight);
    const post = cfg.post && typeof cfg.post.x === 'number' ? cfg.post : null;
    return {
      update() {
        const at = post || ctx.home;
        const remain = ctx.go(at, speed, { arrive: num(cfg, 'arrive', ctx.tile * 0.25), jump: true });
        ctx.done = remain === 0;
        if (remain !== 0) return;
        if (ctx.target && ctx.distance() <= faceRange) ctx.face(ctx.target);
        else if (ctx.noise) ctx.face(ctx.noise);
      },
    };
  },

  /**
   * Toward wherever the target is believed to be: seen now, remembered, or heard. Over a route
   * when there is a grid; with jumps on a platform. Reaching a noise forgets it.
   */
  chase(ctx, cfg) {
    const speed = num(cfg, 'speed', ctx.speed);
    const arrive = num(cfg, 'arrive', ctx.tile * 0.4);
    return {
      update() {
        const goal = ctx.goal();
        if (!goal) { ctx.stop(); ctx.done = true; return; }
        const remain = ctx.go(goal, speed, { arrive: arrive, jump: cfg.jump !== false });
        ctx.done = remain === 0;
        if (remain === 0 && !ctx.sees && ctx.noise) ctx.forgetNoise();
      },
    };
  },

  /**
   * Away from the target (or the last noise) while it is closer than `safe`. With a grid, to the
   * reachable tile within `radius` tiles that is farthest from the threat.
   */
  flee(ctx, cfg) {
    const speed = num(cfg, 'speed', ctx.speed * 1.25);
    const safe = num(cfg, 'safe', ctx.sight * 1.5);
    const radius = Math.max(2, Math.round(num(cfg, 'radius', 8)));
    let refuge = null;
    let refugeAt = -Infinity;

    function threat() {
      return ctx.target || ctx.noise || null;
    }

    function pickRefuge(from) {
      const g = ctx.grid();
      if (!g) return null;
      const me = ctx.toTile(ctx.x, ctx.y);
      const field = flowField(g, me, { diagonal: true });
      let best = null;
      let bestScore = -1;
      for (let ty = me.y - radius; ty <= me.y + radius; ty++) {
        for (let tx = me.x - radius; tx <= me.x + radius; tx++) {
          if (!field.reachable(tx, ty) || field.dist[ty][tx] > radius * 1.5) continue;
          const w = ctx.toWorld({ x: tx, y: ty });
          const score = ctx.dist(from, w);
          if (score > bestScore) { bestScore = score; best = w; }
        }
      }
      return best;
    }

    return {
      enter() { refuge = null; },
      update() {
        const from = threat();
        ctx.done = false;
        if (!from || ctx.dist(from) > safe) { ctx.stop(); ctx.done = true; return; }
        if (ctx.mode === 'platformer') {
          const dx = ctx.x - from.x;
          ctx.walk(dx === 0 ? ctx.facing().x : (dx < 0 ? -1 : 1), speed, { jump: true });
          return;
        }
        if (ctx.grid()) {
          if (!refuge || ctx.now - refugeAt > REPATH_MS * 2 || ctx.dist(refuge) <= ctx.tile * 0.3) {
            refuge = pickRefuge(from);
            refugeAt = ctx.now;
          }
          if (refuge) { ctx.go(refuge, speed, { jump: true }); return; }
        }
        const len = ctx.dist(from) || 1;
        ctx.drive(((ctx.x - from.x) / len) * speed, ((ctx.y - from.y) / len) * speed);
      },
    };
  },

  /**
   * Stop and fire at the target every intervalMs while it is within range and in sight. The
   * game owns the projectile: spec.onShoot(origin, angle, ctx). With telegraphMs the brain
   * announces the shot that long before it, with a 'telegraph' event and a one-frame flash.
   */
  shoot(ctx, cfg) {
    const range = num(cfg, 'range', ctx.sight);
    const interval = num(cfg, 'intervalMs', 900);
    const telegraphMs = num(cfg, 'telegraphMs', 0);
    const muzzle = cfg.muzzle && typeof cfg.muzzle.x === 'number' ? cfg.muzzle : { x: 0, y: 0 };
    let since = 0;
    /** @type {{ at: number, origin: { x: number, y: number }, angle: number }|null} */
    let pending = null;

    function aim() {
      const f = ctx.facing();
      const origin = { x: ctx.x + muzzle.x * (f.x < 0 ? -1 : 1), y: ctx.y + muzzle.y };
      const t = ctx.target;
      const angle = t ? Math.atan2(t.y - origin.y, t.x - origin.x) : Math.atan2(f.y, f.x);
      return { origin: origin, angle: angle };
    }

    function fire(shot) {
      since = 0;
      pending = null;
      if (typeof ctx.spec.onShoot === 'function') ctx.spec.onShoot(shot.origin, shot.angle, ctx);
      ctx.emit('shoot', shot);
    }

    return {
      enter() {
        since = interval - num(cfg, 'firstMs', interval * 0.5);
        pending = null;
      },
      update(dt) {
        ctx.stop();
        ctx.done = false;
        since += dt;
        if (ctx.target && cfg.turn !== false) ctx.face(ctx.target);
        if (pending) {
          if (ctx.now >= pending.at) fire(ctx.visible(range) ? aim() : pending);
          return;
        }
        if (since < interval || !ctx.visible(range)) return;
        if (telegraphMs > 0) {
          const shot = aim();
          pending = { at: ctx.now + telegraphMs, origin: shot.origin, angle: shot.angle };
          ctx.flash();
          ctx.emit('telegraph', { origin: shot.origin, angle: shot.angle, ms: telegraphMs });
          return;
        }
        fire(aim());
      },
      exit() { pending = null; },
    };
  },

  /** Still until the target (or a noise) is within `trigger`, then the state named by `then`. */
  ambush(ctx, cfg) {
    const trigger = num(cfg, 'trigger', ctx.sight * 0.5);
    const then = typeof cfg.then === 'string' ? cfg.then : 'chase';
    return {
      update() {
        ctx.stop();
        ctx.done = false;
        const near = (ctx.target && ctx.distance() <= trigger) || (ctx.noise && ctx.dist(ctx.noise) <= trigger);
        if (near) ctx.set(then);
      },
    };
  },

  /**
   * Round a centre: the target when there is one, else home, or cfg.centre. Topdown; on a
   * platform it reduces to walking back and forth under the centre.
   */
  orbit(ctx, cfg) {
    const speed = num(cfg, 'speed', ctx.speed);
    const radius = Math.max(4, num(cfg, 'radius', ctx.tile * 2.5));
    const turn = cfg.clockwise === false ? -1 : 1;
    let angle = 0;
    function centre() {
      if (cfg.centre && typeof cfg.centre.x === 'number') return cfg.centre;
      if (cfg.centre === 'home') return ctx.home;
      return ctx.target || ctx.home;
    }
    return {
      enter() {
        const c = centre();
        angle = Math.atan2(ctx.y - c.y, ctx.x - c.x);
      },
      update(dt) {
        const c = centre();
        ctx.done = false;
        if (ctx.mode === 'platformer') {
          const side = Math.cos(angle) < 0 ? -1 : 1;
          angle += turn * (speed / radius) * (dt / 1000);
          ctx.go({ x: c.x + side * radius, y: ctx.y }, speed, { jump: true });
          return;
        }
        const r = ctx.dist(c);
        if (Math.abs(r - radius) > radius * 0.3) {
          angle = Math.atan2(ctx.y - c.y, ctx.x - c.x);
        } else {
          angle += turn * (speed / radius) * (dt / 1000);
        }
        const aim = { x: c.x + Math.cos(angle) * radius, y: c.y + Math.sin(angle) * radius };
        ctx.go(aim, speed, { straight: true, arrive: 1 });
      },
    };
  },

  /**
   * Steps in turn, each a behaviour for a while: steps: [{ do: 'wander', ms: 2000 }, { do:
   * 'idle', ms: 600 }]. loop: false ends on the last step, which is when 'done' becomes true.
   */
  sequence(ctx, cfg) {
    const steps = Array.isArray(cfg.steps) ? cfg.steps : [];
    const loop = cfg.loop !== false;
    let i = -1;
    let stepAt = 0;
    /** @type {any} */
    let sub = null;
    let ended = false;

    function start(index) {
      if (sub && sub.exit) sub.exit();
      i = index;
      const step = steps[i];
      sub = step ? build(ctx, step.do, step) : null;
      if (sub && sub.enter) sub.enter();
      stepAt = ctx.now;
    }

    return {
      enter() { ended = false; start(0); },
      update(dt) {
        ctx.done = false;
        if (ended || !steps.length) { ctx.stop(); ctx.done = true; return; }
        const step = steps[i];
        if (typeof step.ms === 'number' && ctx.now - stepAt >= step.ms) {
          if (i + 1 < steps.length) start(i + 1);
          else if (loop) start(0);
          else { ended = true; ctx.stop(); ctx.done = true; return; }
        }
        if (sub) sub.update(dt);
      },
      exit() { if (sub && sub.exit) sub.exit(); sub = null; },
    };
  },
};

/**
 * One behaviour instance from a name or a factory, with its config. A name nobody registered
 * is reported once and stands still.
 * @param {any} ctx
 * @param {string|((ctx: any, cfg: any) => any)} type
 * @param {any} cfg
 * @returns {{ enter?: () => void, update: (dt: number) => void, exit?: () => void }}
 */
export function build(ctx, type, cfg) {
  const factory = typeof type === 'function' ? type : behaviours[String(type)];
  if (!factory) {
    console.warn('[aimeat-phaser] brain: no behaviour is called "' + type + '". The built-in ones '
      + 'are ' + Object.keys(behaviours).join(', ') + '; a state of another name wants a type in '
      + 'spec.behaviours, or a factory added to AIMEAT.phaser.behaviours. Standing still.');
    return behaviours.idle(ctx, {});
  }
  return factory(ctx, cfg || {});
}
