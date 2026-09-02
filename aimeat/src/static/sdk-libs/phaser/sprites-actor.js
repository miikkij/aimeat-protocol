/**
 * @file phaser/sprites-actor.js
 * @description The character a game moves: a physics sprite with a small state machine and the
 *   events a game hangs its feel on. It is the actor() half of sprites.js, in its own file so
 *   both stay under the line limit; sprites.js re-exports it, so a caller sees one module.
 *
 *   THE STATE FOLLOWS THE BODY, NOT THE KEYS. update(c) reads left, right, jump and run off a
 *   controls state and sets the velocity; idle, walk, run, jump and fall are then read back off
 *   what the body is doing, so a hero pushed off a ledge falls without anyone pressing anything.
 *   drive(vx, vy) is the top-down frame from a vector, with the facing in four or eight
 *   directions picked by name when the sheet has a clip per direction and by flipX when it has
 *   not. Both stand down while the actor is stunned by a hit or dead, and both leave a custom
 *   clip alone until it ends.
 *
 *   A HIT IS A FLASH, A GRACE AND A BEAT. The sprite fills with the theme's err colour for
 *   ninety milliseconds, blinks through the grace period (dropped under less motion: the one
 *   short flash stays, as juice.flash does), is knocked away from where the hit came from, and
 *   holds the hit state for hitMs, during which input is ignored. hit() answers false in the
 *   grace and while dead, so a game can call it from an overlap every frame.
 *
 *   A DEATH PLAYS OUT AND THEN CALLS BACK. die(cb) plays the die clip and fires 'die' when it
 *   ends, or when dieMs passes for a sheet without one, whichever comes first and once. A
 *   platformer body keeps falling so a death in the air still lands.
 *
 *   A SPEECH BUBBLE IS FINITE. say() draws a plate on the theme's surface with the words in the
 *   body face, follows the sprite after every update, and leaves by itself: a fade, or under
 *   less motion, plain removal. A second say() replaces the first.
 *
 *   NOTHING OUTLIVES destroy(): timers, the blink tween, the bubble, the listeners and the
 *   sprite, and the scene's own shutdown calls it.
 * @structure the state tables · directionOf() · ActorSpec / ActorHandle · actor(scene, spec)
 * @usage
 *   const me = AIMEAT.phaser.actor(this, { key: 'hero', x: 80, y: 200 });
 *   // in update(): pad.update(); me.update(pad);
 *   me.on('hit', () => j.shake()); me.on('die', () => this.scene.restart());
 * @version-history
 *   v1.2.1 — 2026-09-03 — The hit flash uses setTint() + the FILL tint mode: Phaser 4 removed
 *     setTintFill() and logged a console error on every hit.
 *   v1.2.0 — 2026-09-02 — Initial: the state machine, hit, die, say, update and drive.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, cssColour } from './tokens.js';

/** The actor's own states. Anything else set() is given is a custom clip. */
const BUILT_IN = { idle: true, walk: true, run: true, jump: true, fall: true, hit: true, die: true };

/** States a top-down sheet carries per direction. */
const DIRECTIONAL = { idle: true, walk: true, run: true };

/** When a state has no clip of its own, the nearest one that reads the same. */
const FALLBACK = { run: ['walk'], walk: ['run'], fall: ['jump'], jump: ['fall'] };

/** The eight directions by angle, y down, starting at right and turning clockwise. */
const BY_ANGLE8 = ['right', 'downright', 'down', 'downleft', 'left', 'upleft', 'up', 'upright'];
const BY_ANGLE4 = ['right', 'down', 'left', 'up'];

/** The hit flash, in milliseconds: the fill in the theme's err colour. */
const FLASH_MS = 90;

/** The speech bubble: padding, the tail's height, the wrap width and how long words stay. */
const BUBBLE_PAD = 6;
const BUBBLE_TAIL = 6;
const BUBBLE_WIDTH = 140;
const BUBBLE_MIN_MS = 1200;
const BUBBLE_MS_PER_CHAR = 45;
const BUBBLE_MAX_MS = 6000;

/**
 * The direction a velocity points, as a clip suffix. A sheet without directional clips gets
 * left or right only, and nothing at all when the motion is vertical, so the facing holds.
 * @param {number} vx
 * @param {number} vy
 * @param {number} directions  4 or 8
 * @param {boolean} directional
 * @returns {string}
 */
function directionOf(vx, vy, directions, directional) {
  if (!directional) return vx < 0 ? 'left' : (vx > 0 ? 'right' : '');
  const angle = Math.atan2(vy, vx) * 180 / Math.PI;
  if (directions === 8) return BY_ANGLE8[((Math.round(angle / 45) % 8) + 8) % 8];
  return BY_ANGLE4[((Math.round(angle / 90) % 4) + 4) % 4];
}

/**
 * @typedef {object} ActorSpec
 * @property {string} key                     the sheet: a SheetHandle's key, or a loaded one
 * @property {number} [x]
 * @property {number} [y]
 * @property {'platformer'|'topdown'} [mode]  what update() and drive() drive. Default 'platformer'.
 * @property {number} [speed]                 pixels per second on the ground. Default 220.
 * @property {number} [runSpeed]              pixels per second while the controls state carries
 *   run. Default 0: no run. controls() has no run action, so a game that wants one sets
 *   c.run before the call, for instance from c.action.
 * @property {number} [jump]                  the jump's launch speed. Default 420.
 * @property {boolean} [doubleJump]
 * @property {4|8} [directions]               top-down facing. Default: 8 when the sheet has an
 *   eight-way walk, 4 otherwise.
 * @property {string} [facing]                'left' or 'right', or a top-down direction.
 *   Default 'right', or 'down' on a sheet with a clip per direction.
 * @property {'left'|'right'} [artFaces]      which way the drawn art looks. Default 'right'.
 * @property {Record<string, string>} [anims] state → animation key, when the names are not
 *   <key>-<state>. animations() and spriteSheet() both hand back a map in this shape.
 * @property {boolean} [physics]              false makes a plain sprite: update() and drive()
 *   then only face and animate. Default true.
 * @property {boolean} [collideWorldBounds]   Default true.
 * @property {number} [bounce]
 * @property {number} [depth]
 * @property {number} [scale]
 * @property {number} [hitMs]                 how long a hit holds the actor still. Default 220.
 * @property {number} [invulnerableMs]        the grace after a hit. Default 600.
 * @property {number} [dieMs]                 how long a death takes when the sheet has no die
 *   clip, and the longest it may take when it has one. Default 700.
 */

/**
 * @typedef {object} ActorHandle
 * @property {any} sprite
 * @property {string} key
 * @property {'platformer'|'topdown'} mode
 * @property {{ speed: number, jump: number, doubleJump: boolean, runSpeed: number }} move  the
 *   numbers level.js's platformer() takes as its player options, in that shape
 * @property {string} state      idle · walk · run · jump · fall · hit · die · or any clip name
 * @property {string} facing     'left' or 'right', or a top-down direction such as 'upleft'
 * @property {boolean} dead
 * @property {(dir: string) => void} face
 * @property {(state: string) => boolean} set   a clip by name; a custom clip holds until it
 *   ends or until the next set(), and a looping custom clip holds until the next set()
 * @property {(event: 'state'|'hit'|'die'|'land', fn: (...args: any[]) => void) => () => void} on
 * @property {(opts?: { from?: { x: number, y: number }, knockback?: number, stunMs?: number,
 *   invulnerableMs?: number }) => boolean} hit   false while the actor is dead or in its grace
 * @property {(cb?: () => void) => void} die
 * @property {(text: string, opts?: { ms?: number, size?: number, width?: number }) => any} say
 * @property {(controlsState: any) => void} update   the platformer frame: left, right, jump, run
 * @property {(vx: number, vy: number) => void} drive   the top-down frame: a velocity
 * @property {(x?: number, y?: number) => void} reset   alive again, at a place
 * @property {() => void} destroy
 */

/**
 * A character: a physics sprite, a state machine, and the events a game hangs its feel on.
 * @param {any} scene
 * @param {ActorSpec} spec
 * @returns {ActorHandle}
 */
export function actor(scene, spec) {
  const s = spec || /** @type {ActorSpec} */ ({});
  const th = look(scene);
  const key = s.key || 'hero';
  const mode = s.mode === 'topdown' ? 'topdown' : 'platformer';
  const move = {
    speed: typeof s.speed === 'number' ? s.speed : 220,
    jump: typeof s.jump === 'number' ? s.jump : 420,
    doubleJump: !!s.doubleJump,
    runSpeed: typeof s.runSpeed === 'number' ? s.runSpeed : 0,
  };
  const names = s.anims || {};
  const artLeft = s.artFaces === 'left';
  const hitMs = typeof s.hitMs === 'number' ? s.hitMs : 220;
  const graceMs = typeof s.invulnerableMs === 'number' ? s.invulnerableMs : 600;
  const dieMs = typeof s.dieMs === 'number' ? s.dieMs : 700;
  const startX = s.x || 0;
  const startY = s.y || 0;

  const sprite = s.physics === false || !scene.physics
    ? scene.add.sprite(startX, startY, key)
    : scene.physics.add.sprite(startX, startY, key);
  if (sprite.body) {
    sprite.setCollideWorldBounds(s.collideWorldBounds !== false);
    if (typeof s.bounce === 'number') sprite.setBounce(s.bounce);
  }
  if (typeof s.depth === 'number') sprite.setDepth(s.depth);
  if (typeof s.scale === 'number') sprite.setScale(s.scale);

  // A sheet that carries a clip per direction is turned by name; any other is turned by flipX.
  const directional = scene.anims.exists(key + '-walk-down');
  const eightWay = directional && scene.anims.exists(key + '-walk-upleft');
  const directions = s.directions === 8 || (s.directions !== 4 && eightWay) ? 8 : 4;

  let state = '';
  let facing = s.facing || (directional ? 'down' : 'right');
  let playing = '';
  let custom = false;
  let dead = false;
  let gone = false;
  let wasDown = true;
  let jumpHeld = false;
  let airJumps = 0;
  let stunUntil = 0;
  let graceUntil = 0;
  /** @type {any} */
  let bubble = null;
  /** @type {any} */
  let blink = null;
  /** @type {any[]} */
  const timers = [];
  /** @type {Record<string, Array<(...args: any[]) => void>>} */
  const handlers = { state: [], hit: [], die: [], land: [] };

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
        console.warn('[aimeat-phaser] an actor handler for "' + event + '" threw:', err);
      }
    }
  }

  /**
   * A wait on the scene's own clock, so it pauses with the scene, and forgotten by destroy().
   * @param {number} ms
   * @param {() => void} fn
   * @returns {void}
   */
  function after(ms, fn) {
    const timer = scene.time.delayedCall(Math.max(0, ms), function () {
      const at = timers.indexOf(timer);
      if (at >= 0) timers.splice(at, 1);
      if (!gone) fn();
    });
    timers.push(timer);
  }

  /**
   * The animation a state plays, if the sheet has one: the direction-specific clip first, the
   * named one next, then the nearest sibling.
   * @param {string} want
   * @returns {string} '' when there is none
   */
  function animFor(want) {
    /** @type {string[]} */
    const tries = [];
    if (directional && DIRECTIONAL[want]) tries.push(key + '-' + want + '-' + facing);
    tries.push(names[want] || key + '-' + want);
    for (const other of FALLBACK[want] || []) tries.push(names[other] || key + '-' + other);
    for (const name of tries) if (scene.anims.exists(name)) return name;
    return '';
  }

  /** Play whatever the state and the facing now ask for, if it is not already playing. */
  function play() {
    if (!state) return;
    const name = animFor(state);
    if (name && name !== playing) {
      sprite.play(name, true);
      playing = name;
    } else if (!name && playing) {
      // A state with no clip holds the frame it is on rather than cycling the last one.
      sprite.anims.stop();
      playing = '';
    }
  }

  /**
   * @param {string} next
   * @returns {boolean} whether the state changed
   */
  function set(next) {
    if (gone || !next) return false;
    if (dead && next !== 'die') return false;
    const prev = state;
    if (next === prev) {
      play();
      return false;
    }
    state = next;
    custom = !BUILT_IN[next];
    play();
    if (custom) {
      // A custom clip holds until its animation ends; one that loops, or has no clip, does not.
      const held = playing;
      if (held) {
        sprite.once('animationcomplete-' + held, function () {
          if (!gone && state === next) {
            custom = false;
            set('idle');
          }
        });
      } else {
        custom = false;
      }
    }
    emit('state', next, prev);
    return true;
  }

  /**
   * Turn. 'left' and 'right' flip a side-view sheet; a top-down sheet picks its clip by name.
   * @param {string} dir
   * @returns {void}
   */
  function face(dir) {
    if (!dir || dir === facing) return;
    facing = dir;
    applyFlip();
    play();
  }

  function applyFlip() {
    if (directional) return;
    const left = facing.indexOf('left') >= 0;
    const right = facing.indexOf('right') >= 0;
    if (left || right) sprite.setFlipX(left !== artLeft);
  }

  function stopBlink() {
    if (!blink) return;
    blink.stop();
    blink = null;
    sprite.setAlpha(1);
  }

  /* ── The bubble ────────────────────────────────────────────────────────────────────────── */

  /** The bubble sits just over the sprite's head and follows it after every update. */
  function placeBubble() {
    if (!bubble) return;
    const originY = typeof sprite.originY === 'number' ? sprite.originY : 0.5;
    bubble.setPosition(Math.round(sprite.x), Math.round(sprite.y - sprite.displayHeight * originY - 2));
  }

  function dropBubble() {
    if (!bubble) return;
    const old = bubble;
    bubble = null;
    scene.events.off('postupdate', placeBubble);
    if (scene.tweens) scene.tweens.killTweensOf(old);
    if (old.scene) old.destroy();
  }

  /**
   * A short line over the actor's head, gone by itself. A second say() replaces the first.
   * @param {string} text
   * @param {{ ms?: number, size?: number, width?: number }} [opts]
   * @returns {any} the container, or null when there was nothing to say
   */
  function say(text, opts) {
    const o = opts || {};
    dropBubble();
    const words = text == null ? '' : String(text);
    if (gone || !words) return null;
    const size = typeof o.size === 'number' ? o.size : 12;
    const label = scene.add.text(0, 0, words, {
      fontFamily: th.font,
      fontSize: size + 'px',
      color: cssColour(th.ink),
      align: 'center',
      wordWrap: { width: typeof o.width === 'number' ? o.width : BUBBLE_WIDTH },
    }).setOrigin(0.5, 1);
    const w = Math.round(label.width) + BUBBLE_PAD * 2;
    const h = Math.round(label.height) + BUBBLE_PAD * 2;
    const plate = scene.add.graphics();
    plate.fillStyle(th.surface, 1).fillRoundedRect(-w / 2, -h - BUBBLE_TAIL, w, h, 6);
    plate.lineStyle(1, th.line, 1).strokeRoundedRect(-w / 2, -h - BUBBLE_TAIL, w, h, 6);
    plate.fillStyle(th.surface, 1).fillTriangle(-4, -BUBBLE_TAIL - 1, 4, -BUBBLE_TAIL - 1, 0, 0);
    label.setPosition(0, -BUBBLE_TAIL - BUBBLE_PAD);
    bubble = scene.add.container(0, 0, [plate, label]).setDepth((sprite.depth || 0) + 1);
    placeBubble();
    scene.events.on('postupdate', placeBubble);

    const ms = typeof o.ms === 'number' ? o.ms
      : Math.min(BUBBLE_MAX_MS, BUBBLE_MIN_MS + words.length * BUBBLE_MS_PER_CHAR);
    const mine = bubble;
    after(ms, function () {
      if (bubble !== mine) return;
      if (reducedMotion() || !scene.tweens) {
        dropBubble();
        return;
      }
      scene.tweens.add({
        targets: mine, alpha: 0, duration: 160,
        onComplete: function () { if (bubble === mine) dropBubble(); },
      });
    });
    return bubble;
  }

  /* ── Hurt and dead ─────────────────────────────────────────────────────────────────────── */

  /**
   * Take a hit: a flash in the theme's err colour, a blink through the grace period (dropped
   * under less motion), a knockback away from where it came from, and the hit state for a beat.
   * @param {{ from?: { x: number, y: number }, knockback?: number, stunMs?: number,
   *   invulnerableMs?: number }} [opts]
   * @returns {boolean} whether it landed
   */
  function hit(opts) {
    const o = opts || {};
    const now = scene.time.now;
    if (gone || dead || now < graceUntil) return false;
    const grace = typeof o.invulnerableMs === 'number' ? o.invulnerableMs : graceMs;
    const stun = typeof o.stunMs === 'number' ? o.stunMs : hitMs;
    graceUntil = now + grace;
    stunUntil = now + stun;

    if (sprite.body && o.from) {
      const k = typeof o.knockback === 'number' ? o.knockback : move.speed * 0.8;
      const dx = sprite.x - o.from.x;
      const dy = sprite.y - o.from.y;
      if (mode === 'platformer') {
        const side = dx === 0 ? (facing === 'left' ? 1 : -1) : (dx < 0 ? -1 : 1);
        sprite.setVelocity(side * k, -k * 0.55);
      } else {
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        sprite.setVelocity((dx / len) * k, (dy / len) * k);
      }
    }

    // Phaser 4 dropped setTintFill(): a fill tint is setTint() plus the FILL tint mode, and
    // clearTint() puts the mode back to MULTIPLY itself.
    sprite.setTint(th.err);
    const PH = /** @type {any} */ (window).Phaser;
    if (typeof sprite.setTintMode === 'function' && PH && PH.TintModes) {
      sprite.setTintMode(PH.TintModes.FILL);
    }
    after(FLASH_MS, function () { sprite.clearTint(); });
    stopBlink();
    if (!reducedMotion() && scene.tweens && grace > FLASH_MS * 2) {
      blink = scene.tweens.add({
        targets: sprite, alpha: 0.35, duration: 70, yoyo: true,
        repeat: Math.max(0, Math.floor(grace / 140) - 1),
        onComplete: function () {
          blink = null;
          sprite.setAlpha(1);
        },
      });
    }
    set('hit');
    after(stun, function () {
      if (!dead && state === 'hit') set('idle');
    });
    emit('hit', o);
    return true;
  }

  /**
   * Die: the die clip plays out (or dieMs passes, whichever comes first), then 'die' fires and
   * the callback runs. A platformer body keeps falling so a death in the air still lands.
   * @param {() => void} [cb]
   * @returns {void}
   */
  function die(cb) {
    if (gone || dead) return;
    dead = true;
    graceUntil = Infinity;
    stunUntil = 0;
    stopBlink();
    sprite.clearTint();
    dropBubble();
    if (sprite.body) {
      if (mode === 'platformer') sprite.setVelocityX(0);
      else sprite.setVelocity(0, 0);
    }
    set('die');
    let done = false;
    const finish = function () {
      if (done || gone) return;
      done = true;
      emit('die');
      if (typeof cb === 'function') cb();
    };
    if (playing) sprite.once('animationcomplete-' + playing, finish);
    after(dieMs, finish);
  }

  /* ── The two frames ────────────────────────────────────────────────────────────────────── */

  /**
   * The platformer frame. Reads left, right, jump and run off a controls state.
   * @param {any} c
   * @returns {void}
   */
  function update(c) {
    if (gone) return;
    const body = sprite.body;
    const onGround = !!(body && (body.blocked.down || body.touching.down));
    if (onGround) airJumps = 0;
    if (onGround && !wasDown && !dead) emit('land');
    wasDown = onGround;
    if (dead || scene.time.now < stunUntil) return;

    const left = !!(c && c.left);
    const right = !!(c && c.right);
    const wantJump = !!(c && c.jump);
    const running = move.runSpeed > 0 && !!(c && c.run);
    const pace = running ? move.runSpeed : move.speed;
    const vx = left === right ? 0 : (left ? -pace : pace);
    if (body) sprite.setVelocityX(vx);
    if (vx !== 0) face(vx < 0 ? 'left' : 'right');

    let jumped = false;
    if (wantJump && !jumpHeld && body) {
      if (onGround) {
        sprite.setVelocityY(-move.jump);
        jumped = true;
      } else if (move.doubleJump && airJumps < 1) {
        sprite.setVelocityY(-move.jump * 0.86);
        airJumps += 1;
        jumped = true;
      }
    }
    jumpHeld = wantJump;

    if (custom) return;
    if (body && (jumped || !onGround)) set(jumped || body.velocity.y < 0 ? 'jump' : 'fall');
    else if (vx !== 0) set(running ? 'run' : 'walk');
    else set('idle');
  }

  /**
   * The top-down frame: a velocity, from which the facing and the state follow.
   * @param {number} vx
   * @param {number} vy
   * @returns {void}
   */
  function drive(vx, vy) {
    if (gone || dead || scene.time.now < stunUntil) return;
    const ax = typeof vx === 'number' && isFinite(vx) ? vx : 0;
    const ay = typeof vy === 'number' && isFinite(vy) ? vy : 0;
    if (sprite.body) sprite.setVelocity(ax, ay);
    const moving = ax !== 0 || ay !== 0;
    if (moving) face(directionOf(ax, ay, directions, directional));
    if (custom) return;
    set(moving ? 'walk' : 'idle');
  }

  /* ── The rest of the surface ───────────────────────────────────────────────────────────── */

  /**
   * Listen for 'state' (next, previous), 'hit' (the options given), 'die' or 'land'.
   * @param {string} event
   * @param {(...args: any[]) => void} fn
   * @returns {() => void} stop listening
   */
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

  /**
   * Alive again, standing still, at a place when one is given.
   * @param {number} [nx]
   * @param {number} [ny]
   * @returns {void}
   */
  function reset(nx, ny) {
    if (gone) return;
    dead = false;
    custom = false;
    stunUntil = 0;
    graceUntil = 0;
    airJumps = 0;
    jumpHeld = false;
    wasDown = true;
    stopBlink();
    sprite.clearTint();
    dropBubble();
    if (sprite.body) sprite.setVelocity(0, 0);
    if (typeof nx === 'number' && typeof ny === 'number') sprite.setPosition(nx, ny);
    state = '';
    playing = '';
    set('idle');
  }

  function destroy() {
    if (gone) return;
    gone = true;
    scene.events.off('shutdown', destroy);
    dropBubble();
    stopBlink();
    for (const timer of timers) {
      if (timer && typeof timer.remove === 'function') timer.remove(false);
    }
    timers.length = 0;
    for (const name in handlers) handlers[name].length = 0;
    if (scene.tweens) scene.tweens.killTweensOf(sprite);
    if (sprite.scene) sprite.destroy();
  }

  applyFlip();
  set('idle');
  scene.events.once('shutdown', destroy);

  return {
    sprite: sprite,
    key: key,
    mode: mode,
    move: move,
    get state() { return state; },
    get facing() { return facing; },
    get dead() { return dead; },
    face: face,
    set: set,
    on: on,
    hit: hit,
    die: die,
    say: say,
    update: update,
    drive: drive,
    reset: reset,
    destroy: destroy,
  };
}
