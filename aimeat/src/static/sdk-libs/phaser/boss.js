/**
 * @file phaser/boss.js
 * @description A boss fight, sequenced. A boss is an actor (or a physics sprite), a health, and
 *   PHASES that start at a health fraction; each phase plays named PATTERNS, and a pattern is a
 *   small script of timed steps: move, dash, telegraph, fire, spawn, slam, wait, a function, a
 *   loop and a random pick. The game owns its projectiles and minions through onFire and
 *   onSpawn; this module owns the order, the clock, the health bar across the top of the camera
 *   and the ending. The steps themselves are in boss-steps.js and the bar in boss-bar.js.
 *
 *   THE CLOCK IS THE SCENE'S. Every wait is a delayedCall and every motion a tween on the scene,
 *   so a paused or sleeping scene holds the fight, a hit-stop from juice slows it, and pause()
 *   here holds the timers, the tweens and a dash in flight without touching the scene. Every
 *   step is finite; a phase loops only because the sequencer starts its patterns again.
 *
 *   A PHASE CHANGE WAITS FOR THE STEP. damage() crosses a boundary and marks the next phase; the
 *   step in flight finishes, the boss is invulnerable for the window the phase asks for, the
 *   bar flashes, the phase's enter steps play once, and its patterns begin. A hit that crosses
 *   two boundaries lands in the phase the health says, and phases only go forward: a heal moves
 *   the bar and nothing else. skipTo() is the test door and switches at once.
 *
 *   ZERO ENDS THE FIGHT ONCE. The running pattern is cancelled, the defeat steps play (by
 *   default three explosions from fx, a slow-motion from juice, and the actor's death, waited
 *   for), and 'defeat' fires when they are done. The 'damage' event with fraction 0 is the
 *   instant signal; 'defeat' is the one to change scenes on, so the ending is seen.
 *
 *   fx AND juice ARE BORROWED OR MADE. A game that has them passes its handles; otherwise this
 *   module makes its own on start() and takes them down in destroy(). Less motion is answered
 *   per step in boss-steps.js: a telegraph is one short mark, the bar's lag fill snaps, and a
 *   move, a dash and a slam still happen, because where the boss is is the game.
 * @structure BossStep / BossPhase / BossSpec / BossHandle · boss(scene, spec) → the runner
 *   (play / cycle / startPhase / transition), health (damage / heal / defeat), the controls
 *   (start / pause / resume / stop / skipTo / target) and destroy
 * @usage
 *   const b = AIMEAT.phaser.boss(this, {
 *     actor: warden, health: 300, name: 'The Warden',
 *     patterns: {
 *       sweep: [{ move: { to: 'left', ms: 700 } }, { telegraph: { ms: 400, kind: 'line' } },
 *               { fire: { kind: 'aimed', count: 1, speed: 320 } }, { move: { to: 'right', ms: 700 } }],
 *       barrage: [{ telegraph: { ms: 500, kind: 'ring' } }, { fire: { kind: 'ring', count: 12 } }, { slam: { ms: 700 } }],
 *     },
 *     phases: [{ at: 1, name: 'Patrol', patterns: ['sweep'] },
 *              { at: 0.5, name: 'Fury', patterns: ['barrage', 'sweep'], speed: 1.3, invulnerableMs: 800,
 *                enter: [{ telegraph: { ms: 600, kind: 'flash' } }, { spawn: { kind: 'imp', count: 2, at: 'sides' } }] }],
 *     onFire: (o, angles) => angles.forEach((a) => shoot(o.x, o.y, a, o.speed)),
 *     onSpawn: (x, y, kind) => imps.add(x, y, kind),
 *   });
 *   b.target(hero.sprite); b.start();
 *   b.on('defeat', () => this.scene.start('victory'));
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: phases on health fractions, named patterns, the ten step kinds,
 *     the segmented lag bar, the invulnerable window, defeat once, pause on the scene's clock.
 */
import { look, curve } from './tokens.js';
import { fx as makeFx } from './fx.js';
import { juice as makeJuice } from './juice.js';
import { bossBar } from './boss-bar.js';
import { runStep, untint } from './boss-steps.js';

/** The default defeat: three explosions a beat apart, a slow-motion, the death. */
const DEFEAT_BEAT = 160;
const DEFEAT_SLOWMO_MS = 700;
const DEFEAT_SLOWMO_SCALE = 0.35;
const DEFEAT_EXPLOSIONS = 3;
const DEFEAT_SCATTER = 26;

/** The events a listener may ask for. */
const EVENTS = ['phase', 'pattern', 'telegraph', 'fire', 'spawn', 'slam', 'damage', 'heal', 'defeat'];

/**
 * @typedef {object} BossStep   one of these keys per step
 * @property {{ x?: number, y?: number, to?: 'target'|'left'|'right'|'center'|'top', ms?: number }} [move]
 *   a tween to a point or a place word. Default 600 ms.
 * @property {{ toward?: 'target'|'left'|'right'|'center'|'top', speed?: number, ms?: number }} [dash]
 *   a velocity toward a place for ms (600 px/s, 400 ms by default); a sprite with no body is tweened
 * @property {{ ms?: number, kind?: 'flash'|'ring'|'line', tone?: string|number, radius?: number, length?: number }} [telegraph]
 *   a warning lasting ms (500 by default) in the warn tone: the sprite blinks, a ring grows at the
 *   boss, or a line reaches toward the target. Fires 'telegraph' first, for a sound.
 * @property {{ kind?: 'aimed'|'spread'|'ring'|'rain', count?: number, speed?: number, spread?: number, ms?: number }} [fire]
 *   spec.onFire(origin, angles) with one angle per shot, in radians: aimed at the target, a fan of
 *   spread degrees (60) around it, a ring starting at it, or drops from the top of the view over
 *   ms (600), one call per drop. Takes no time except rain.
 * @property {{ kind?: string, count?: number, at?: 'sides'|'top'|'around', radius?: number }} [spawn]
 *   spec.onSpawn(x, y, kind) per minion: the view's two sides, along its top, or a ring of radius
 *   (80) around the boss. Takes no time.
 * @property {{ ms?: number, height?: number }|true} [slam]  up, down, a shake and a dust burst, 'slam'
 * @property {number} [wait]                        ms
 * @property {(ctx: any) => any} [fn]               the game's own; a returned number is a wait in ms
 * @property {number} [loop]                        with steps: run them this many times
 * @property {BossStep[]} [steps]
 * @property {string[]} [random]                    play one of these patterns, by name
 * @property {boolean} [die]                        the actor's death, waited for (the defeat's last step)
 */

/**
 * @typedef {object} BossPhase
 * @property {number} at          the health fraction at or under which the phase starts; 1 first
 * @property {string} [name]
 * @property {Array<string|BossStep[]>} patterns  names from spec.patterns, or inline step lists
 * @property {boolean} [loop]     start the patterns again when the last ends. Default true.
 * @property {number} [speed]     every duration divided by this. Default 1.
 * @property {BossStep[]} [enter] played once on entering the phase
 * @property {number} [invulnerableMs]  damage() is refused for this long after entering. Default spec.invulnerableMs, else 0.
 */

/**
 * @typedef {object} BossSpec
 * @property {any} actor          an ActorHandle from actor(), or a physics sprite
 * @property {number} [health]    the maximum. Default 100.
 * @property {string} [name]
 * @property {Record<string, BossStep[]>} [patterns]
 * @property {BossPhase[]} [phases]  Default: one phase at 1 playing every pattern in order.
 * @property {BossStep[]} [defeat]   Default: three explosions, a slow-motion, then die.
 * @property {number} [invulnerableMs]
 * @property {(origin: { x: number, y: number, speed: number, kind: string }, angles: number[]) => void} [onFire]
 * @property {(x: number, y: number, kind: string) => void} [onSpawn]
 * @property {any} [target]       the player's sprite, for aimed steps; target() sets it later
 * @property {any} [fx]           an fx() handle; else one is made on start()
 * @property {any} [juice]        a juice() handle; else one is made on start()
 * @property {{ y?: number, share?: number, tone?: any, depth?: number, hidden?: boolean }} [bar]
 * @property {any} [theme]
 */

/**
 * @typedef {object} BossHandle
 * @property {any} sprite
 * @property {any} actor          the ActorHandle, or null for a bare sprite
 * @property {() => void} start
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => void} stop     cancel the running pattern; start() begins again from the phase the health says
 * @property {() => string} phase  the current phase's name
 * @property {() => number} health
 * @property {(n: number) => number} damage   the new fraction; unchanged while invulnerable or defeated
 * @property {(n: number) => number} heal     the new fraction
 * @property {(t: any) => void} target  a sprite, an ActorHandle, or a point
 * @property {(phaseName: string) => boolean} skipTo   for testing: the health to that phase's at, the phase now
 * @property {(event: string, fn: (payload?: any) => void) => () => void} on
 *   'phase' (phase, previous) · 'pattern' (name) · 'telegraph' · 'fire' · 'spawn' · 'slam' ·
 *   'damage' and 'heal' ({ amount, health, fraction }) · 'defeat'
 * @property {{ show: () => void, hide: () => void, setName: (name: string) => void,
 *   state: () => { fraction: number, shown: number, lag: number, visible: boolean } }} bar
 * @property {() => boolean} running
 * @property {() => void} destroy
 */

/**
 * A boss fight for one scene.
 * @param {any} scene
 * @param {BossSpec} spec
 * @returns {BossHandle}
 */
export function boss(scene, spec) {
  const s = spec || /** @type {BossSpec} */ ({});
  if (!s.actor) throw new Error('boss() wants spec.actor: an actor() handle or a physics sprite.');
  const actorHandle = s.actor.sprite && typeof s.actor.die === 'function' ? s.actor : null;
  const sprite = actorHandle ? actorHandle.sprite : s.actor;
  const th = s.theme || look(scene);
  const ease = curve(th);
  const max = Math.max(1, typeof s.health === 'number' && isFinite(s.health) ? s.health : 100);
  const patterns = s.patterns || {};

  /** The phases, highest at first, the first one at 1 whatever it said. */
  const phases = (Array.isArray(s.phases) && s.phases.length ? s.phases.slice()
    : [{ at: 1, patterns: Object.keys(patterns) }])
    .map(function (p, i) {
      return Object.assign({}, p, {
        at: i === 0 && (typeof p.at !== 'number') ? 1 : Math.max(0, Math.min(1, typeof p.at === 'number' ? p.at : 1)),
        name: p.name != null ? String(p.name) : 'phase ' + (i + 1),
        patterns: Array.isArray(p.patterns) ? p.patterns : [],
      });
    })
    .sort(function (a, b) { return b.at - a.at; });
  phases[0].at = 1;

  let health = max;
  let phaseAt = 0;
  /** @type {number|null} */
  let pendingPhase = null;
  let started = false;
  let running = false;
  let paused = false;
  let invulnerable = false;
  let defeated = false;
  let gone = false;
  let token = 0;
  /** @type {any[]} timers the running pattern owns: cancelled with it. */
  const runTimers = [];
  /** @type {any[]} timers the fight owns: the invulnerable window. */
  const keepTimers = [];
  /** @type {any[]} tweens in flight. */
  const tweens = [];
  /** @type {any[]} graphics a step drew and has not taken away. */
  const drawn = [];
  /** @type {Record<string, Array<(...args: any[]) => void>>} */
  const handlers = {};
  for (const name of EVENTS) handlers[name] = [];

  let targetObj = s.target || null;
  let fxHandle = s.fx || null;
  let juiceHandle = s.juice || null;
  let ownFx = false;
  let ownJuice = false;

  const bar = bossBar(scene, Object.assign({ name: s.name, phases: phases, theme: th }, s.bar || {}));
  if (s.bar && s.bar.hidden) bar.hide();
  bar.setPhase(phases[0].name);

  /* ── The world a step reaches ────────────────────────────────────────────────────────── */

  function emit(event, a, b) {
    const list = handlers[event];
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        fn(a, b);
      } catch (err) {
        console.warn('[aimeat-phaser] a boss handler for "' + event + '" threw:', err);
      }
    }
  }

  /**
   * A wait on the scene's clock, owned by the running pattern (or by the fight when kept).
   * @param {number} ms
   * @param {() => void} fn
   * @param {boolean} [keep]
   * @returns {any}
   */
  function after(ms, fn, keep) {
    const list = keep ? keepTimers : runTimers;
    const timer = scene.time.delayedCall(Math.max(0, ms), function () {
      const at = list.indexOf(timer);
      if (at >= 0) list.splice(at, 1);
      if (!gone) fn();
    });
    if (paused && !keep) timer.paused = true;
    list.push(timer);
    return timer;
  }

  function tween(config) {
    const done = config.onComplete;
    /** @type {any} */
    let t = null;
    config.onComplete = function () {
      const at = tweens.indexOf(t);
      if (at >= 0) tweens.splice(at, 1);
      if (!gone && typeof done === 'function') done();
    };
    t = scene.tweens.add(config);
    tweens.push(t);
    if (paused && typeof t.pause === 'function') t.pause();
    return t;
  }

  function targetPoint() {
    if (!targetObj) return null;
    const o = targetObj.sprite ? targetObj.sprite : targetObj;
    return typeof o.x === 'number' && typeof o.y === 'number' ? o : null;
  }

  /** @type {any} */
  const world = {
    scene: scene, sprite: sprite, actor: actorHandle, th: th, ease: ease, spec: s,
    fx: null, juice: null, held: null, bodyMoves: undefined, ctx: null,
    target: targetPoint,
    ms: function (want, fallback) {
      const raw = typeof want === 'number' && isFinite(want) ? want : fallback;
      const speed = phases[phaseAt].speed;
      return Math.max(0, raw / (typeof speed === 'number' && speed > 0 ? speed : 1));
    },
    after: after,
    tween: tween,
    own: function (g) { drawn.push(g); return g; },
    disown: function (g) {
      const at = drawn.indexOf(g);
      if (at >= 0) drawn.splice(at, 1);
      if (g && g.scene) g.destroy();
    },
    emit: emit,
  };

  /* ── The runner ──────────────────────────────────────────────────────────────────────── */

  /** Cancel whatever is in flight: timers, tweens, a dash, a held body, a drawn warning, a tint. */
  function cancelRun() {
    token += 1;
    running = false;
    for (const t of runTimers) if (t && typeof t.remove === 'function') t.remove(false);
    runTimers.length = 0;
    for (const t of tweens.slice()) {
      if (typeof t.remove === 'function') t.remove();
      else if (typeof t.stop === 'function') t.stop();
    }
    tweens.length = 0;
    for (const g of drawn.slice()) if (g && g.scene) g.destroy();
    drawn.length = 0;
    if (world.held && sprite.body && typeof sprite.setVelocity === 'function') sprite.setVelocity(0, 0);
    world.held = null;
    if (sprite.body && world.bodyMoves !== undefined) {
      sprite.body.moves = world.bodyMoves;
      world.bodyMoves = undefined;
    }
    if (!defeated) untint(sprite);
  }

  /** The steps of a pattern entry: a name into spec.patterns, or an inline list. */
  function stepsOf(entry) {
    if (Array.isArray(entry)) return entry;
    const list = patterns[entry];
    if (!Array.isArray(list)) {
      console.warn('[aimeat-phaser] boss: no pattern named "' + entry + '" in spec.patterns.');
      return [];
    }
    return list;
  }

  /**
   * Run steps in order under a token, then done(). loop and random unroll here; every other
   * step goes to boss-steps.js. A phase marked pending takes over between two steps.
   * @param {any[]} steps
   * @param {number} i
   * @param {number} mine
   * @param {() => void} done
   */
  function play(steps, i, mine, done) {
    if (mine !== token || gone) return;
    if (pendingPhase !== null && !defeated) {
      transition();
      return;
    }
    if (i >= steps.length) {
      done();
      return;
    }
    const st = steps[i];
    const next = function () { play(steps, i + 1, mine, done); };
    if (st && typeof st.loop === 'number' && Array.isArray(st.steps)) {
      let left = Math.max(0, Math.round(st.loop));
      const again = function () {
        if (left <= 0) { next(); return; }
        left -= 1;
        play(st.steps, 0, mine, again);
      };
      again();
      return;
    }
    if (st && Array.isArray(st.random) && st.random.length) {
      const pick = st.random[Math.floor(Math.random() * st.random.length)];
      emit('pattern', typeof pick === 'string' ? pick : 'random');
      play(stepsOf(pick), 0, mine, next);
      return;
    }
    runStep(world, st, next);
  }

  /** The phase's patterns in order, and again while it loops. */
  function cycle(mine) {
    const phase = phases[phaseAt];
    const list = phase.patterns;
    let at = 0;
    const one = function () {
      if (mine !== token || gone) return;
      if (at >= list.length) {
        if (phase.loop === false || !list.length) {
          running = false;
          return;
        }
        at = 0;
      }
      const entry = list[at];
      at += 1;
      emit('pattern', typeof entry === 'string' ? entry : 'inline');
      play(stepsOf(entry), 0, mine, one);
    };
    one();
  }

  /**
   * Enter a phase: 'phase', the invulnerable window, the enter steps once, then the patterns.
   * @param {number} i
   * @param {number|null} prev
   */
  function startPhase(i, prev) {
    phaseAt = i;
    const phase = phases[i];
    const mine = token;
    running = true;
    bar.setPhase(phase.name);
    const window = typeof phase.invulnerableMs === 'number' ? phase.invulnerableMs
      : (typeof s.invulnerableMs === 'number' ? s.invulnerableMs : 0);
    if (window > 0) {
      invulnerable = true;
      after(window, function () { invulnerable = false; }, true);
    }
    emit('phase', phase.name, prev === null ? null : phases[prev].name);
    play(Array.isArray(phase.enter) ? phase.enter : [], 0, mine, function () { cycle(mine); });
  }

  function transition() {
    const i = /** @type {number} */ (pendingPhase);
    const prev = phaseAt;
    pendingPhase = null;
    cancelRun();
    bar.flash();
    startPhase(i, prev);
  }

  /** The phase a health fraction lands in: the last one whose at is not under it. */
  function phaseFor(fraction) {
    let found = 0;
    for (let i = 0; i < phases.length; i++) if (phases[i].at >= fraction) found = i;
    return found;
  }

  /* ── Health ──────────────────────────────────────────────────────────────────────────── */

  function defeat() {
    defeated = true;
    pendingPhase = null;
    invulnerable = false;
    cancelRun();
    untint(sprite);
    const mine = token;
    running = true;
    const steps = Array.isArray(s.defeat) ? s.defeat : defaultDefeat();
    play(steps, 0, mine, function () {
      running = false;
      emit('defeat');
    });
  }

  /** @returns {BossStep[]} */
  function defaultDefeat() {
    /** @type {BossStep[]} */
    const steps = [];
    for (let i = 0; i < DEFEAT_EXPLOSIONS; i++) {
      steps.push({
        fn: function () {
          const dx = (Math.random() - 0.5) * DEFEAT_SCATTER * 2;
          const dy = (Math.random() - 0.5) * DEFEAT_SCATTER * 2;
          if (world.fx) world.fx.at(sprite.x + dx, sprite.y + dy, 'explosion');
          else if (world.juice) world.juice.burst(sprite.x + dx, sprite.y + dy, 'hit');
          if (i === 0 && world.juice) world.juice.slowmo(DEFEAT_SLOWMO_MS, DEFEAT_SLOWMO_SCALE);
          return DEFEAT_BEAT;
        },
      });
    }
    steps.push({ die: true });
    return steps;
  }

  /**
   * @param {number} n
   * @returns {number} the new fraction
   */
  function damage(n) {
    const amount = typeof n === 'number' && isFinite(n) ? n : 0;
    if (gone || defeated || invulnerable || amount <= 0) return health / max;
    health = Math.max(0, health - amount);
    const fraction = health / max;
    bar.set(fraction);
    emit('damage', { amount: amount, health: health, fraction: fraction });
    if (health <= 0) {
      defeat();
      return 0;
    }
    const want = phaseFor(fraction);
    if (want > phaseAt && want !== pendingPhase) {
      pendingPhase = want;
      // A boss standing idle (a phase that did not loop and ended) changes phase now.
      if (started && !running) transition();
    }
    return fraction;
  }

  /**
   * @param {number} n
   * @returns {number}
   */
  function heal(n) {
    const amount = typeof n === 'number' && isFinite(n) ? n : 0;
    if (gone || defeated || amount <= 0) return health / max;
    health = Math.min(max, health + amount);
    const fraction = health / max;
    bar.set(fraction);
    emit('heal', { amount: amount, health: health, fraction: fraction });
    return fraction;
  }

  /* ── The controls ────────────────────────────────────────────────────────────────────── */

  function start() {
    if (gone || started || defeated) return;
    started = true;
    if (!fxHandle) {
      fxHandle = makeFx(scene, { theme: th });
      ownFx = true;
    }
    if (!juiceHandle) {
      juiceHandle = makeJuice(scene, { theme: th });
      ownJuice = true;
    }
    world.fx = fxHandle;
    world.juice = juiceHandle;
    pendingPhase = null;
    startPhase(phaseFor(health / max), null);
  }

  function pause() {
    if (gone || paused) return;
    paused = true;
    for (const t of runTimers) if (t) t.paused = true;
    for (const t of tweens) if (t && typeof t.pause === 'function') t.pause();
    if (world.held && sprite.body && typeof sprite.setVelocity === 'function') sprite.setVelocity(0, 0);
  }

  function resume() {
    if (gone || !paused) return;
    paused = false;
    for (const t of runTimers) if (t) t.paused = false;
    for (const t of tweens) if (t && typeof t.resume === 'function') t.resume();
    if (world.held && sprite.body && typeof sprite.setVelocity === 'function') sprite.setVelocity(world.held.vx, world.held.vy);
  }

  function stop() {
    if (gone) return;
    cancelRun();
    started = false;
    pendingPhase = null;
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  function skipTo(name) {
    if (gone || defeated) return false;
    let i = -1;
    for (let k = 0; k < phases.length; k++) if (phases[k].name === name) i = k;
    if (i < 0) return false;
    const prev = phaseAt;
    health = i === 0 ? max : Math.max(1, Math.round(phases[i].at * max));
    bar.set(health / max, { instant: true });
    pendingPhase = null;
    cancelRun();
    if (started) {
      bar.flash();
      startPhase(i, prev);
    } else {
      phaseAt = i;
      bar.setPhase(phases[i].name);
    }
    return true;
  }

  function on(event, fn) {
    if (typeof fn !== 'function' || !handlers[event]) {
      return function () { /* nothing was registered */ };
    }
    handlers[event].push(fn);
    return function off() {
      const at = handlers[event].indexOf(fn);
      if (at >= 0) handlers[event].splice(at, 1);
    };
  }

  function destroy() {
    if (gone) return;
    cancelRun();
    gone = true;
    scene.events.off('shutdown', destroy);
    for (const t of keepTimers) if (t && typeof t.remove === 'function') t.remove(false);
    keepTimers.length = 0;
    for (const name in handlers) handlers[name].length = 0;
    bar.destroy();
    if (ownFx && fxHandle) fxHandle.destroy();
    if (ownJuice && juiceHandle) juiceHandle.destroy();
    fxHandle = null;
    juiceHandle = null;
    world.fx = null;
    world.juice = null;
  }

  /** @type {any} */
  const handle = {
    sprite: sprite,
    actor: actorHandle,
    start: start,
    pause: pause,
    resume: resume,
    stop: stop,
    phase: function () { return phases[phaseAt].name; },
    health: function () { return health; },
    damage: damage,
    heal: heal,
    target: function (t) { targetObj = t || null; },
    skipTo: skipTo,
    on: on,
    bar: { show: bar.show, hide: bar.hide, setName: bar.setName, state: bar.state },
    running: function () { return running && !paused; },
    destroy: destroy,
  };
  world.ctx = {
    boss: handle, scene: scene, sprite: sprite, actor: actorHandle,
    target: targetPoint,
    get fx() { return world.fx; },
    get juice() { return world.juice; },
  };

  scene.events.once('shutdown', destroy);
  return handle;
}
