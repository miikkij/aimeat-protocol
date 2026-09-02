/**
 * @file phaser/juice.js
 * @description The nine gestures that make a hit land: the screen shakes, the clock stops for a
 *   beat, the picture flashes, particles leave the impact, a number rises off it, the counter
 *   grows, the whole scene goes slow, the thing that was struck squashes, and something fast
 *   leaves a ghost behind it. Every game on this node otherwise rewrites all nine, badly, and
 *   each one is three lines from being permanent.
 *
 *   NOTHING HERE RUNS FOREVER. Every effect states its own end: a particle burst is exploded once
 *   and its emitter is destroyed when the last particle has died, a number tweens and destroys
 *   itself, a combo counter decays, and both time-scale effects hold a captured baseline they
 *   always return to. destroy() takes down anything still in flight and puts the clocks back,
 *   and the scene's own shutdown does the same without the caller asking.
 *
 *   THE CLOCK IS THE THING BEING SCALED, so the clock cannot be what times the recovery.
 *   hitStop() and slowmo() slow scene.time, scene.tweens, the arcade world and the animation
 *   manager; a delayedCall on the scene's own clock would then take 1/scale as long to fire, and
 *   a scene stopped at 0.05 would wait twenty times its own hit-stop. Both recoveries are
 *   therefore driven from real time (a timeout, and a requestAnimationFrame ramp), which is also
 *   what a hit-stop IS: a fixed number of milliseconds of the player's time, not the game's.
 *
 *   THE ARCADE WORLD SCALES THE OTHER WAY. scene.time.timeScale and scene.tweens.timeScale are
 *   multipliers (0.3 is three-tenths speed), and Phaser's arcade world.timeScale is a divisor
 *   (2 is half speed, verified in the 4.2.1 bundle: the step threshold is frameTimeMS *
 *   timeScale). So one asked-for `scale` becomes `scale` on three of them and `1 / scale` on the
 *   fourth, which is the single most likely thing to be got wrong by hand.
 *
 *   NO COLOUR IS WRITTEN HERE. Every particle, number and flash takes a theme number read once
 *   through boot.js, so the whole set re-tones with the page's palette and mode.
 *
 *   LESS MOTION IS ANSWERED HONESTLY. What MOVES the picture or the clock is skipped outright:
 *   shake, hitStop, slowmo, pop, trail and burst do nothing and say so by returning false. What
 *   TELLS the player something stays and loses only its travel: a number appears where it was
 *   thrown and fades without rising, a combo counter shows its count without the bounce, and a
 *   flash is one short tint rather than a repeat.
 * @structure tone() · particle textures (dot / chip / spark) · BURSTS presets · juice(scene, opts)
 *   returning shake / hitStop / flash / burst / number / combo / slowmo / pop / trail / destroy
 * @usage
 *   const j = AIMEAT.phaser.juice(this);
 *   j.hitStop(90); j.shake(); j.burst(x, y, 'hit'); j.number(x, y, '-12', { tone: 'err' });
 * @version-history
 *   v1.1.0 — 2026-09-02 — Initial: the nine finite effects, the captured time-scale baseline and
 *     the real-time recoveries.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, cssColour, channels, ms as toMs, curve } from './tokens.js';

/** Just above the HUD's toast, so a damage number is never hidden by the score plate. */
const JUICE_DEPTH = 960;

/** The shake a caller gets when it names no strength, and the ceiling any caller is held to:
 *  past this the picture stops being readable and the effect stops being an effect. */
const SHAKE_STRENGTH = 0.006;
const SHAKE_MAX = 0.05;
const SHAKE_MS = 180;

/** A hit-stop is never shorter than one frame at 60fps, because a stop nobody can see is a stall
 *  in the code and nothing on the screen. The scale has a floor for the same reason: at 0 the
 *  arcade divisor would be infinite. */
const FRAME_MS = 16;
const SCALE_FLOOR = 0.02;

/** How long a combo counter waits, with nothing added to it, before it leaves. */
const COMBO_MS = 900;

/**
 * One of the four tone words, or a number, as a theme colour.
 * @param {any} th  the theme handle
 * @param {'ok'|'warn'|'err'|'accent'|'ink'|number|undefined} want
 * @param {number} fallback
 * @returns {number}
 */
function tone(th, want, fallback) {
  if (typeof want === 'number' && isFinite(want)) return want;
  if (want === 'ok') return th.ok;
  if (want === 'warn') return th.warn;
  if (want === 'err') return th.err;
  if (want === 'accent') return th.accent;
  if (want === 'ink') return th.ink;
  return fallback;
}

/** A colour as the suffix of a texture key, so one shape in two colours is two textures. */
function keyOf(prefix, colour) {
  return 'ak-juice-' + prefix + '-' + ((colour >>> 0) & 0xffffff).toString(16);
}

/**
 * The three particle shapes, drawn once per colour and kept. A round dot for coins and dust, a
 * square chip for confetti, and a short bar for sparks and hits.
 * @param {any} scene
 * @param {'dot'|'chip'|'spark'} shape
 * @param {number} colour
 * @returns {string} the texture key
 */
function particleTexture(scene, shape, colour) {
  const key = keyOf(shape, colour);
  if (scene.textures && scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ add: false });
  g.fillStyle(colour, 1);
  let w = 8;
  let h = 8;
  if (shape === 'dot') {
    g.fillCircle(4, 4, 4);
  } else if (shape === 'chip') {
    w = 7;
    h = 10;
    g.fillRect(0, 0, w, h);
  } else {
    w = 12;
    h = 3;
    g.fillRect(0, 0, w, h);
  }
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

/**
 * The five presets, as functions of the theme so each one names a token rather than a colour.
 * `shape` picks the texture, `colour` picks the token, and the rest is the emitter config Phaser
 * takes verbatim. `life` is the longest a particle can live, which is what decides when the
 * emitter is taken down.
 * @type {Record<string, (th: any) => { shape: 'dot'|'chip'|'spark', colour: number,
 *   count: number, life: number, config: any }>}
 */
const BURSTS = {
  coin: function (th) {
    return {
      shape: 'dot', colour: th.ch3, count: 10, life: 560,
      config: {
        speed: { min: 60, max: 170 }, angle: { min: -150, max: -30 },
        gravityY: 340, lifespan: { min: 380, max: 560 },
        scale: { start: 1, end: 0 }, emitting: false,
      },
    };
  },
  hit: function (th) {
    return {
      shape: 'spark', colour: th.err, count: 12, life: 340,
      config: {
        speed: { min: 90, max: 260 }, angle: { min: 0, max: 360 },
        lifespan: { min: 200, max: 340 }, rotate: { min: -180, max: 180 },
        scale: { start: 1, end: 0.2 }, alpha: { start: 1, end: 0.2 }, emitting: false,
      },
    };
  },
  dust: function (th) {
    return {
      shape: 'dot', colour: th.inkDim, count: 8, life: 460,
      config: {
        speed: { min: 20, max: 80 }, angle: { min: 190, max: 350 },
        gravityY: 40, lifespan: { min: 300, max: 460 },
        scale: { start: 0.9, end: 0.1 }, alpha: { start: 0.55, end: 0 }, emitting: false,
      },
    };
  },
  spark: function (th) {
    return {
      shape: 'spark', colour: th.accent, count: 14, life: 300,
      config: {
        speed: { min: 120, max: 340 }, angle: { min: 0, max: 360 },
        lifespan: { min: 180, max: 300 }, rotate: { min: -180, max: 180 },
        scale: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
      },
    };
  },
  confetti: function (th) {
    return {
      shape: 'chip', colour: th.ch1, count: 22, life: 1000,
      config: {
        speed: { min: 140, max: 320 }, angle: { min: -160, max: -20 },
        gravityY: 430, lifespan: { min: 640, max: 1000 },
        rotate: { min: -180, max: 180 }, scale: { start: 1, end: 0.7 },
        alpha: { start: 1, end: 0.2 },
        tint: [th.ch1, th.ch2, th.ch3, th.ch4],
        emitting: false,
      },
    };
  },
};

/**
 * @typedef {object} JuiceOptions
 * @property {any} [theme]     a theme handle to dress every effect with. Default: read once off
 *   the element the game was booted into. Read ONCE, so a page that changes its palette mid-game
 *   wants a fresh juice() rather than a repaint.
 * @property {number} [depth]  where numbers and combo counters sit. Default 960, just above the
 *   HUD's toast.
 */

/**
 * @typedef {object} JuiceHandle
 * @property {(strength?: number, ms?: number) => boolean} shake
 * @property {(ms?: number, scale?: number) => boolean} hitStop
 * @property {(colour?: 'accent'|'ink'|'err'|number, ms?: number) => boolean} flash
 * @property {(x: number, y: number, kind: 'coin'|'hit'|'dust'|'spark'|'confetti', opts?: any) => any} burst
 * @property {(x: number, y: number, text: string|number, opts?: any) => any} number
 * @property {(target: any, opts: { count: number, label?: string, ms?: number }) => any} combo
 * @property {(ms: number, scale: number) => boolean} slowmo
 * @property {(gameObject: any, scale?: number) => boolean} pop
 * @property {(gameObject: any, opts?: any) => boolean} trail
 * @property {() => void} destroy
 */

/**
 * The juice for one scene. One handle owns everything it started, so one destroy() ends all of it.
 * @param {any} scene
 * @param {JuiceOptions} [opts]
 * @returns {JuiceHandle}
 */
export function juice(scene, opts) {
  const o = opts || /** @type {JuiceOptions} */ ({});
  const th = o.theme || look(scene);
  const depth = typeof o.depth === 'number' ? o.depth : JUICE_DEPTH;
  const ease = curve(th);
  const pace = toMs(th.motion, 200);
  let dead = false;

  /** THE BASELINE. Captured before anything is scaled, so every recovery returns to what the game
   *  was actually running at rather than to a hopeful 1. */
  const world = scene.physics && scene.physics.world ? scene.physics.world : null;
  const anims = scene.anims && typeof scene.anims.globalTimeScale === 'number' ? scene.anims : null;
  const base = {
    time: scene.time ? scene.time.timeScale : 1,
    tweens: scene.tweens ? scene.tweens.timeScale : 1,
    world: world ? world.timeScale : 1,
    anims: anims ? anims.globalTimeScale : 1,
  };

  /** Real-time timeouts still owed, and the ramp still running. Both are cancelled by destroy(). */
  /** @type {Set<number>} */
  const timeouts = new Set();
  /** @type {any[]} Phaser timer events, which pause with the scene and are removed with it. */
  const timers = [];
  /** @type {any[]} everything drawn that has not taken itself away yet. */
  const objects = [];
  let ramp = 0;

  /**
   * A real-time wait. Used only where the scene's own clock is the thing being scaled.
   * @param {number} wait
   * @param {() => void} run
   * @returns {void}
   */
  function later(wait, run) {
    const id = setTimeout(function () {
      timeouts.delete(id);
      if (!dead) run();
    }, Math.max(0, wait));
    timeouts.add(id);
  }

  /** Remember a drawn thing so destroy() can find it, and forget it once it is gone. */
  function own(obj) {
    objects.push(obj);
    return obj;
  }

  function disown(obj) {
    const at = objects.indexOf(obj);
    if (at >= 0) objects.splice(at, 1);
  }

  /**
   * Put every clock at one multiple of its baseline. `scale` is the SPEED asked for, so the three
   * multipliers take it and the arcade divisor takes its reciprocal.
   * @param {number} scale
   * @returns {void}
   */
  function setSpeed(scale) {
    const k = Math.max(SCALE_FLOOR, scale);
    if (scene.time) scene.time.timeScale = base.time * k;
    if (scene.tweens) scene.tweens.timeScale = base.tweens * k;
    if (world) world.timeScale = base.world / k;
    if (anims) anims.globalTimeScale = base.anims * k;
  }

  /** Every clock back where it was found. */
  function restoreSpeed() {
    if (scene.time) scene.time.timeScale = base.time;
    if (scene.tweens) scene.tweens.timeScale = base.tweens;
    if (world) world.timeScale = base.world;
    if (anims) anims.globalTimeScale = base.anims;
  }

  /* ── The picture ───────────────────────────────────────────────────────────────────────── */

  /**
   * One shake of the main camera. `strength` is Phaser's own intensity, a share of the viewport,
   * and it is clamped: a caller who asks for 0.5 gets 0.05 and a game that is still playable.
   * @param {number} [strength]
   * @param {number} [msWanted]
   * @returns {boolean} whether anything ran
   */
  function shake(strength, msWanted) {
    if (dead || reducedMotion() || !scene.cameras || !scene.cameras.main) return false;
    const power = Math.min(SHAKE_MAX, Math.max(0, typeof strength === 'number' && isFinite(strength)
      ? strength : SHAKE_STRENGTH));
    const span = Math.max(FRAME_MS, typeof msWanted === 'number' && isFinite(msWanted) ? msWanted : SHAKE_MS);
    scene.cameras.main.shake(span, power);
    return true;
  }

  /**
   * One tint over the whole camera. Kept under less motion, because a flash is the game answering
   * rather than the game moving; it is a single short tint either way.
   * @param {'accent'|'ink'|'err'|number} [colour]
   * @param {number} [msWanted]
   * @returns {boolean}
   */
  function flash(colour, msWanted) {
    if (dead || !scene.cameras || !scene.cameras.main) return false;
    const c = channels(tone(th, colour, th.accent));
    const span = Math.max(FRAME_MS, typeof msWanted === 'number' && isFinite(msWanted) ? msWanted : 120);
    scene.cameras.main.flash(span, c.r, c.g, c.b);
    return true;
  }

  /* ── The clock ─────────────────────────────────────────────────────────────────────────── */

  /**
   * The beat a hit lands on: everything drops to `scale` for `ms` of REAL time and snaps back.
   * Overlapping calls do not stack; the last one owns the recovery.
   * @param {number} [msWanted]  default 90, floored at one frame
   * @param {number} [scale]     default 0.05, floored at 0.02
   * @returns {boolean}
   */
  function hitStop(msWanted, scale) {
    if (dead || reducedMotion()) return false;
    const span = Math.max(FRAME_MS, typeof msWanted === 'number' && isFinite(msWanted) ? msWanted : 90);
    const k = Math.max(SCALE_FLOOR, typeof scale === 'number' && isFinite(scale) ? scale : 0.05);
    if (ramp) {
      cancelAnimationFrame(ramp);
      ramp = 0;
    }
    setSpeed(k);
    later(span, restoreSpeed);
    return true;
  }

  /**
   * The long version: down to `scale` and then a smooth ramp back over the same span. The ramp is
   * driven by requestAnimationFrame rather than by a tween, because the tween manager is one of
   * the four clocks being slowed and would decelerate its own recovery.
   * @param {number} msWanted  how long the slow lasts before the ramp starts
   * @param {number} scale     the speed during it, 1 being normal
   * @returns {boolean}
   */
  function slowmo(msWanted, scale) {
    if (dead || reducedMotion()) return false;
    const span = Math.max(FRAME_MS, typeof msWanted === 'number' && isFinite(msWanted) ? msWanted : 600);
    const k = Math.max(SCALE_FLOOR, Math.min(1, typeof scale === 'number' && isFinite(scale) ? scale : 0.35));
    if (ramp) {
      cancelAnimationFrame(ramp);
      ramp = 0;
    }
    setSpeed(k);
    later(span, function () {
      const back = Math.max(FRAME_MS, span * 0.5);
      const from = performance.now();
      const step = function (now) {
        if (dead) return;
        const p = Math.min(1, (now - from) / back);
        // Ease out, so the last tenth of the ramp is the part the eye can follow.
        setSpeed(k + (1 - k) * (1 - (1 - p) * (1 - p)));
        if (p < 1) {
          ramp = requestAnimationFrame(step);
          return;
        }
        ramp = 0;
        restoreSpeed();
      };
      ramp = requestAnimationFrame(step);
    });
    return true;
  }

  /* ── The particles ─────────────────────────────────────────────────────────────────────── */

  /**
   * One finite burst at a point in the world.
   *
   * The emitter is created with `emitting: false`, exploded once, and destroyed a little after the
   * longest particle can live. There is no standing emitter and nothing to remember to stop.
   *
   * @param {number} x
   * @param {number} y
   * @param {'coin'|'hit'|'dust'|'spark'|'confetti'} kind
   * @param {{ count?: number, colour?: 'ok'|'warn'|'err'|'accent'|'ink'|number, depth?: number,
   *   scrollFactor?: number, config?: any }} [burstOpts]  `config` is merged over the preset, so a
   *   caller can change one number without restating the preset.
   * @returns {any} the emitter, in case the caller wants it gone sooner, or null when nothing ran
   */
  function burst(x, y, kind, burstOpts) {
    if (dead || reducedMotion() || !scene.add) return null;
    const make = BURSTS[kind] || BURSTS.hit;
    const preset = make(th);
    const b = burstOpts || {};
    const colour = tone(th, b.colour, preset.colour);
    const key = particleTexture(scene, preset.shape, colour);
    /** @type {any} */
    const config = {};
    for (const name in preset.config) config[name] = preset.config[name];
    if (b.config) for (const name in b.config) config[name] = b.config[name];

    const emitter = scene.add.particles(x, y, key, config);
    emitter.setDepth(typeof b.depth === 'number' ? b.depth : depth - 20);
    if (typeof b.scrollFactor === 'number') emitter.setScrollFactor(b.scrollFactor);
    own(emitter);
    emitter.explode(Math.max(1, typeof b.count === 'number' ? b.count : preset.count));
    // The particles age on the raw frame delta, not on the scene clock, so the wait is real time
    // too. The slack covers the frame the last one dies on.
    later(preset.life + 80, function () {
      disown(emitter);
      emitter.destroy();
    });
    return emitter;
  }

  /* ── The figures ───────────────────────────────────────────────────────────────────────── */

  /**
   * A damage or score number that rises off the thing it belongs to and fades. Under less motion
   * it stays where it was thrown and only fades, because the number is the information and the
   * rise is the decoration.
   * @param {number} x
   * @param {number} y
   * @param {string|number} text
   * @param {{ tone?: 'ok'|'warn'|'err'|'accent', size?: number, rise?: number, ms?: number }} [numOpts]
   * @returns {any} the Text object
   */
  function number(x, y, text, numOpts) {
    if (dead || !scene.add) return null;
    const n = numOpts || {};
    const size = Math.max(8, typeof n.size === 'number' ? n.size : 22);
    const label = scene.add.text(x, y, text == null ? '' : String(text), {
      fontFamily: th.fontDisplay,
      fontSize: size + 'px',
      color: cssColour(tone(th, n.tone, th.ink)),
    }).setOrigin(0.5, 1).setDepth(depth);
    own(label);

    const still = reducedMotion();
    const span = Math.max(200, typeof n.ms === 'number' ? n.ms : Math.max(600, pace * 3));
    const rise = still ? 0 : (typeof n.rise === 'number' ? n.rise : 38);
    scene.tweens.add({
      targets: label,
      y: y - rise,
      alpha: 0,
      duration: span,
      ease: still ? 'Linear' : ease,
      onComplete: function () {
        disown(label);
        label.destroy();
      },
    });
    return label;
  }

  /**
   * Where a combo counter goes. A plain point is taken as it is; an Element is measured against
   * the canvas and converted into the game's own coordinates, so a counter can sit over a DOM
   * button as easily as over a sprite.
   * @param {any} target
   * @returns {{ x: number, y: number }}
   */
  function pointOf(target) {
    if (!target) return { x: scene.scale.width / 2, y: scene.scale.height / 2 };
    if (typeof target.x === 'number' && typeof target.y === 'number') {
      return { x: target.x, y: target.y };
    }
    const canvas = scene.game && scene.game.canvas;
    if (target.nodeType !== 1 || !canvas) return { x: scene.scale.width / 2, y: scene.scale.height / 2 };
    const box = target.getBoundingClientRect();
    const frame = canvas.getBoundingClientRect();
    const kx = frame.width > 0 ? scene.scale.width / frame.width : 1;
    const ky = frame.height > 0 ? scene.scale.height / frame.height : 1;
    return {
      x: (box.left + box.width / 2 - frame.left) * kx,
      y: (box.top + box.height / 2 - frame.top) * ky,
    };
  }

  /** The one combo counter this handle owns: a new call feeds it rather than adding a second. */
  /** @type {any} */
  let comboBox = null;
  /** @type {number} */
  let comboTimer = 0;

  function dropCombo() {
    if (!comboBox) return;
    const box = comboBox;
    comboBox = null;
    disown(box);
    if (!box.scene) return;
    scene.tweens.add({
      targets: box,
      alpha: 0,
      duration: Math.max(120, pace),
      onComplete: function () { box.destroy(); },
    });
  }

  /**
   * The counter that grows: bigger with every hit, one bounce each time, and gone once the player
   * stops feeding it. The bounce is dropped under less motion; the count is not.
   * @param {{ x: number, y: number }|Element} target
   * @param {{ count: number, label?: string, ms?: number, size?: number }} comboOpts
   * @returns {any} the container holding the count and its label
   */
  function combo(target, comboOpts) {
    if (dead || !scene.add) return null;
    const c = comboOpts || /** @type {any} */ ({});
    const count = Math.max(0, Math.round(typeof c.count === 'number' ? c.count : 0));
    const at = pointOf(target);
    // The counter grows with the run and then stops growing, so a hundred-hit chain does not fill
    // the screen with one number.
    const size = (typeof c.size === 'number' ? c.size : 26) + Math.min(count, 20) * 1.6;

    if (!comboBox) {
      const digits = scene.add.text(0, 0, '', {
        fontFamily: th.fontDisplay, fontSize: size + 'px', color: cssColour(th.accent),
      }).setOrigin(0.5, 1);
      const word = scene.add.text(0, 4, '', {
        fontFamily: th.fontMono, fontSize: '12px', color: cssColour(th.inkDim),
      }).setOrigin(0.5, 0);
      comboBox = own(scene.add.container(at.x, at.y, [digits, word]).setDepth(depth));
      comboBox.setData('digits', digits);
      comboBox.setData('word', word);
    }

    const digits = comboBox.getData('digits');
    const word = comboBox.getData('word');
    digits.setFontSize(size);
    digits.setText(String(count));
    word.setText(c.label ? String(c.label) : '');
    word.setVisible(!!c.label);
    comboBox.setPosition(at.x, at.y);
    comboBox.setAlpha(1);
    comboBox.setScale(1);

    if (!reducedMotion()) {
      scene.tweens.add({
        targets: comboBox, scale: 1.35, duration: Math.max(60, pace * 0.4),
        yoyo: true, ease: 'Back.easeOut',
      });
    }

    if (comboTimer) {
      clearTimeout(comboTimer);
      timeouts.delete(comboTimer);
      comboTimer = 0;
    }
    const hold = Math.max(200, typeof c.ms === 'number' ? c.ms : COMBO_MS);
    const id = setTimeout(function () {
      timeouts.delete(id);
      comboTimer = 0;
      if (!dead) dropCombo();
    }, hold);
    timeouts.add(id);
    comboTimer = id;
    return comboBox;
  }

  /* ── The body ──────────────────────────────────────────────────────────────────────────── */

  /**
   * Squash and stretch: the thing struck goes wide and short, then back. Runs on the object's own
   * scale, so it composes with whatever scale the game had already given it.
   * @param {any} gameObject
   * @param {number} [scale]  how far the pulse goes. Default 1.18.
   * @returns {boolean}
   */
  function pop(gameObject, scale) {
    if (dead || reducedMotion() || !gameObject || !gameObject.scene || !scene.tweens) return false;
    const k = Math.max(1.01, typeof scale === 'number' && isFinite(scale) ? scale : 1.18);
    const fromX = typeof gameObject.scaleX === 'number' ? gameObject.scaleX : 1;
    const fromY = typeof gameObject.scaleY === 'number' ? gameObject.scaleY : 1;
    scene.tweens.add({
      targets: gameObject,
      scaleX: fromX * k,
      scaleY: fromY / k,
      duration: Math.max(FRAME_MS, pace * 0.5),
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: function () {
        // Put the exact numbers back: a yoyo lands on the start value, and "close enough" drifts
        // over a hundred pops.
        if (!gameObject.scene) return;
        gameObject.setScale(fromX, fromY);
      },
    });
    return true;
  }

  /**
   * A ghost trail: `count` copies of the object, made one after another AS IT MOVES, each fading
   * out where it was made. One call covers (count - 1) * step + ms and then there is nothing left.
   * @param {any} gameObject  anything with a texture: a Sprite, an Image, an animated Sprite
   * @param {{ count?: number, step?: number, ms?: number, alpha?: number, tint?: number }} [trailOpts]
   * @returns {boolean}
   */
  function trail(gameObject, trailOpts) {
    if (dead || reducedMotion() || !gameObject || !gameObject.scene || !scene.add) return false;
    const t = trailOpts || {};
    const count = Math.max(1, Math.min(12, Math.round(typeof t.count === 'number' ? t.count : 5)));
    const step = Math.max(FRAME_MS, typeof t.step === 'number' ? t.step : 40);
    const span = Math.max(FRAME_MS, typeof t.ms === 'number' ? t.ms : 280);
    const top = Math.max(0, Math.min(1, typeof t.alpha === 'number' ? t.alpha : 0.5));

    for (let i = 0; i < count; i++) {
      // The scene's own clock times the ghosts, so they pause when the scene does and slow when
      // the game is in slow motion. That is the right answer here: a ghost belongs to the game's
      // time, where a hit-stop recovery belongs to the player's.
      const timer = scene.time.delayedCall(i * step, function () {
        if (dead || !gameObject.scene) return;
        const frame = gameObject.frame ? gameObject.frame.name : undefined;
        const ghost = scene.add.image(gameObject.x, gameObject.y, gameObject.texture.key, frame);
        ghost.setOrigin(gameObject.originX, gameObject.originY)
          .setScale(gameObject.scaleX, gameObject.scaleY)
          .setRotation(gameObject.rotation)
          .setFlipX(!!gameObject.flipX)
          .setFlipY(!!gameObject.flipY)
          .setAlpha(top)
          .setDepth((gameObject.depth || 0) - 1);
        if (typeof t.tint === 'number') ghost.setTint(t.tint);
        own(ghost);
        scene.tweens.add({
          targets: ghost, alpha: 0, duration: span, ease: 'Quad.easeOut',
          onComplete: function () {
            disown(ghost);
            ghost.destroy();
          },
        });
      });
      timers.push(timer);
    }
    return true;
  }

  /* ── The end ───────────────────────────────────────────────────────────────────────────── */

  /** Everything still in flight, taken down, and every clock put back where it was found. */
  function destroy() {
    if (dead) return;
    dead = true;
    if (scene.events && typeof scene.events.off === 'function') {
      scene.events.off('shutdown', destroy);
      scene.events.off('destroy', destroy);
    }
    for (const id of timeouts) clearTimeout(id);
    timeouts.clear();
    comboTimer = 0;
    comboBox = null;
    for (const timer of timers) {
      if (timer && typeof timer.remove === 'function') timer.remove(false);
    }
    timers.length = 0;
    if (ramp) {
      cancelAnimationFrame(ramp);
      ramp = 0;
    }
    for (const obj of objects.slice()) {
      if (!obj) continue;
      if (scene.tweens) scene.tweens.killTweensOf(obj);
      if (typeof obj.destroy === 'function' && obj.scene !== undefined) obj.destroy();
    }
    objects.length = 0;
    restoreSpeed();
  }

  // A scene that shuts down takes its juice with it, so an app that forgets to call destroy()
  // still leaves no scaled clock behind for the next scene to inherit.
  if (scene.events && typeof scene.events.once === 'function') {
    scene.events.once('shutdown', destroy);
    scene.events.once('destroy', destroy);
  }

  return {
    shake: shake,
    hitStop: hitStop,
    flash: flash,
    burst: burst,
    number: number,
    combo: combo,
    slowmo: slowmo,
    pop: pop,
    trail: trail,
    destroy: destroy,
  };
}
