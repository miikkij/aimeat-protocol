/**
 * @file phaser/cutscene.js
 * @description The cutscene runner: a list of steps run in order through the dialogue box, and
 *   ended early by a held action. A step is one line, one question with a branch, a wait, a
 *   move, a camera pan or zoom, a fade, or a function of the app's own; the list is what a
 *   scripted moment in a game otherwise becomes as nested callbacks. Extracted from dialogue.js,
 *   which held both halves until the 800-line rule refused it; the box is still that file's.
 *
 *   A STEP NAMED then IS A THENABLE. A question step carries its branch as { ask, then }, and
 *   JavaScript treats any object with a then function as a promise when it is awaited or returned
 *   from an async function. The runner therefore never awaits a step object and never resolves
 *   with one; it reads the fields and awaits the work.
 *
 *   EVERY STEP CAN BE CUT SHORT, AND LANDS WHERE IT WAS GOING. A wait resolves, a move and a pan
 *   are stopped and set to their end values, a fade snaps to its end, a line is closed. skip()
 *   does that to the step in flight and the list stops after it; a scene shutdown does the same.
 *   Under less motion moves and pans land immediately and a fade is a cut, while a wait still
 *   waits, because a pause is pacing rather than motion.
 *
 *   THE SKIP IS A HOLD, NOT A TAP. A tap already means "next line", so the way out is the action
 *   held for 700 ms, or a finger on the small pill in the top corner. The ring in the pill fills
 *   while the button is down and is redrawn only then; let go and one redraw clears it.
 *
 *   THE FADE IS A RECTANGLE, NOT THE CAMERA'S OWN. It sits just under the dialogue box, so a line
 *   said in the dark is still read, and it is one object per run, made on the first fade and
 *   taken down with everything else at the end.
 * @structure number() · cutscene(scene, steps, opts) → a promise carrying skip() and dialogue;
 *   inside it lineOf · doSay · doAsk · doWait · doMove · doCamera · doFade · doFn · runStep ·
 *   runList · the hold-to-skip ring (armSkip, tick, drawArc) · skip · cleanup
 * @usage
 *   await AIMEAT.phaser.cutscene(this, [{ skip: true }, { camera: { x: 900, y: 200, ms: 800 } },
 *     { fade: 'out', ms: 300 }, { fade: 'in', ms: 300 }, { say: ['guide', 'Something moved.'] },
 *     { ask: ['guide', 'Follow it?', [{ label: 'Yes', value: true }, { label: 'No', value: false }]],
 *       then: (yes) => (yes ? [{ say: ['guide', 'Stay close.'] }] : []) }], { controls: pad });
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: extracted from dialogue.js as a pure move; the runner, the
 *     eight step kinds and hold-to-skip.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, ms, curve, cssColour } from './tokens.js';
import { tone, inRect, DIALOGUE_DEPTH, MARGIN } from './dialogue-draw.js';
import { dialogue } from './dialogue.js';

/** @typedef {import('./dialogue.js').SpeakerSpec} SpeakerSpec */
/** @typedef {import('./dialogue.js').LineOptions} LineOptions */
/** @typedef {import('./dialogue.js').Choice} Choice */
/** @typedef {import('./dialogue.js').DialogueHandle} DialogueHandle */

/** How long the action is held before a skippable cutscene ends. */
const HOLD_MS = 700;

/** @param {any} v @param {number} fallback @returns {number} */
function number(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/**
 * @typedef {object} CutsceneOptions
 * @property {any} [controls]
 * @property {any} [library]
 * @property {Record<string, SpeakerSpec>} [speakers]
 * @property {DialogueHandle} [dialogue]  a box to speak through. Default: one made here and taken
 *   down at the end.
 * @property {boolean} [skippable]         the same as a { skip: true } step anywhere in the list
 * @property {string} [skipLabel]          Default 'Hold to skip'.
 * @property {'bottom'|'top'} [position]
 * @property {any} [theme]
 */

/**
 * One step. Exactly one of say / ask / wait / move / camera / fn / fade / skip is read.
 * @typedef {object} CutsceneStep
 * @property {any[]|{ speaker?: string, text: string, opts?: LineOptions }} [say]
 *   [speaker, text, opts] or the same as an object
 * @property {any[]|{ speaker?: string, text: string, choices: Choice[], opts?: LineOptions }} [ask]
 *   [speaker, text, choices, opts] or the same as an object
 * @property {(value: any) => (CutsceneStep[]|void)} [then]  the branch an answer opens: steps
 *   run before the list continues
 * @property {number} [wait]   milliseconds on the scene's clock
 * @property {{ target: any, x?: number, y?: number, ms?: number, ease?: string }} [move]
 *   one tween; any numeric field besides ms is tweened (alpha, angle, scale)
 * @property {{ x?: number, y?: number, zoom?: number, ms?: number, ease?: string }} [camera]
 *   pan the main camera to a world point and/or zoom it
 * @property {(scene: any) => (Promise<any>|any)} [fn]
 * @property {'in'|'out'} [fade]   a full-camera rectangle: 'out' covers, 'in' uncovers
 * @property {number} [ms]         the fade's length
 * @property {'bg'|'ink'|'accent'|number} [colour]  the fade's colour. Default 'bg'.
 * @property {boolean} [skip]      marks the whole cutscene as skippable by a held action
 */

/**
 * Run steps in order. Returns a promise that resolves with { skipped } when the last step is done
 * or the player skipped, and carries skip() and the dialogue it speaks through.
 *
 * @param {any} scene
 * @param {CutsceneStep[]} steps
 * @param {CutsceneOptions} [opts]
 * @returns {Promise<{ skipped: boolean }> & { skip: () => void, dialogue: DialogueHandle }}
 */
export function cutscene(scene, steps, opts) {
  const o = opts || /** @type {CutsceneOptions} */ ({});
  const th = o.theme || look(scene);
  const still = reducedMotion();
  const pace = ms(th.motion, 200);
  const ease = curve(th);
  const list = Array.isArray(steps) ? steps : [];
  const own = !o.dialogue;
  const talk = o.dialogue || dialogue(scene, {
    controls: o.controls, library: o.library, speakers: o.speakers, position: o.position, theme: th,
  });
  const pad = o.controls || null;
  const skippable = o.skippable === true || list.some(function (s) { return !!(s && s.skip); });

  let stopped = false;
  let finished = false;
  /** @type {(() => void)|null} what cuts the step in flight short, set by every step that can be */
  let cancel = null;
  /** @type {any} the full-camera rectangle a fade paints */
  let cover = null;
  /** @type {any} the hold-to-skip ring's parts */
  let ring = null;
  let heldMs = 0;
  let pointerHeld = false;

  /**
   * [speaker, text, choices, opts], an object with those names, or a bare text.
   * @param {any} spec
   * @returns {{ speaker: string, text: string, choices: any, opts: LineOptions }}
   */
  function lineOf(spec) {
    if (Array.isArray(spec)) {
      const withChoices = Array.isArray(spec[2]);
      return {
        speaker: spec[0], text: spec[1], choices: withChoices ? spec[2] : null,
        opts: (withChoices ? spec[3] : spec[2]) || {},
      };
    }
    if (spec && typeof spec === 'object') {
      return { speaker: spec.speaker, text: spec.text, choices: spec.choices || null, opts: spec.opts || spec };
    }
    return { speaker: '', text: spec == null ? '' : String(spec), choices: null, opts: {} };
  }

  function hideTalk() { talk.hide(); }

  /** @param {any} spec @returns {Promise<void>} */
  function doSay(spec) {
    const line = lineOf(spec);
    cancel = hideTalk;
    return talk.say(line.speaker, line.text, line.opts);
  }

  /**
   * @param {any} spec
   * @param {any} branch  the step's then: given the answer, returns steps to run first
   * @returns {Promise<void>}
   */
  function doAsk(spec, branch) {
    const line = lineOf(spec);
    cancel = hideTalk;
    return talk.ask(line.speaker, line.text, line.choices || [], line.opts).then(function (value) {
      cancel = null;
      if (stopped || typeof branch !== 'function') return undefined;
      const more = branch(value);
      return Array.isArray(more) ? runList(more) : undefined;
    });
  }

  /** @param {number} wait @returns {Promise<void>} */
  function doWait(wait) {
    return new Promise(function (res) {
      const t = scene.time.delayedCall(Math.max(0, wait), function () {
        cancel = null;
        res();
      });
      cancel = function () {
        t.remove(false);
        res();
      };
    });
  }

  /** @param {any} m @returns {Promise<void>} */
  function doMove(m) {
    const target = m && m.target;
    if (!target) return Promise.resolve();
    /** @type {Record<string, number>} */
    const props = {};
    let any = false;
    for (const k in m) {
      if (k === 'target' || k === 'ms' || k === 'ease' || typeof m[k] !== 'number') continue;
      props[k] = m[k];
      any = true;
    }
    const land = function () { for (const k in props) target[k] = props[k]; };
    const span = number(m.ms, pace * 3);
    if (!any) return Promise.resolve();
    if (still || span <= 0 || !scene.tweens) {
      land();
      return Promise.resolve();
    }
    return new Promise(function (res) {
      /** @type {any} */
      let tween = null;
      cancel = function () {
        if (tween) tween.stop();
        land();
        res();
      };
      tween = scene.tweens.add(Object.assign({
        targets: target, duration: span, ease: m.ease || ease,
        onComplete: function () {
          cancel = null;
          res();
        },
      }, props));
    });
  }

  /** @param {any} c @returns {Promise<void>} */
  function doCamera(c) {
    const cam = scene.cameras && scene.cameras.main;
    if (!cam) return Promise.resolve();
    const hasPoint = typeof c.x === 'number' || typeof c.y === 'number';
    const x = number(c.x, cam.midPoint ? cam.midPoint.x : 0);
    const y = number(c.y, cam.midPoint ? cam.midPoint.y : 0);
    const zoom = typeof c.zoom === 'number' ? c.zoom : null;
    const span = number(c.ms, pace * 4);
    const land = function () {
      if (hasPoint) cam.centerOn(x, y);
      if (zoom != null) cam.setZoom(zoom);
    };
    if (still || span <= 0) {
      land();
      return Promise.resolve();
    }
    return new Promise(function (res) {
      let pending = 0;
      const one = function (_camera, progress) {
        if (progress < 1) return;
        pending -= 1;
        if (pending > 0) return;
        cancel = null;
        res();
      };
      cancel = function () {
        if (cam.panEffect) cam.panEffect.reset();
        if (cam.zoomEffect) cam.zoomEffect.reset();
        land();
        res();
      };
      if (hasPoint) {
        pending += 1;
        cam.pan(x, y, span, c.ease || ease, true, one);
      }
      if (zoom != null) {
        pending += 1;
        cam.zoomTo(zoom, span, c.ease || ease, true, one);
      }
      if (!pending) {
        cancel = null;
        res();
      }
    });
  }

  /**
   * @param {'in'|'out'} kind
   * @param {any} msWanted
   * @param {any} colour
   * @returns {Promise<void>}
   */
  function doFade(kind, msWanted, colour) {
    const tint = tone(th, colour, th.bg);
    const target = kind === 'out' ? 1 : 0;
    const span = number(msWanted, pace * 2);
    if (!cover) {
      cover = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, tint, 1)
        .setOrigin(0, 0).setScrollFactor(0).setDepth(DIALOGUE_DEPTH - 10);
      cover.setAlpha(kind === 'out' ? 0 : 1);
    }
    cover.setFillStyle(tint, 1);
    if (still || span <= 0 || !scene.tweens) {
      cover.setAlpha(target);
      return Promise.resolve();
    }
    return new Promise(function (res) {
      cancel = function () {
        scene.tweens.killTweensOf(cover);
        cover.setAlpha(target);
        res();
      };
      scene.tweens.add({
        targets: cover, alpha: target, duration: span, ease: 'Linear',
        onComplete: function () {
          cancel = null;
          res();
        },
      });
    });
  }

  /** @param {(scene: any) => any} fn @returns {Promise<void>} */
  function doFn(fn) {
    cancel = null;
    return Promise.resolve().then(function () { return fn(scene); }).then(function () { return undefined; });
  }

  /** @param {any} s @returns {Promise<void>} */
  function runStep(s) {
    if (!s || typeof s !== 'object') return Promise.resolve();
    if (s.say !== undefined) return doSay(s.say);
    if (s.ask !== undefined) return doAsk(s.ask, s.then);
    if (typeof s.wait === 'number') return doWait(s.wait);
    if (s.move) return doMove(s.move);
    if (s.camera) return doCamera(s.camera);
    if (typeof s.fn === 'function') return doFn(s.fn);
    if (s.fade === 'in' || s.fade === 'out') return doFade(s.fade, s.ms, s.colour);
    if (s.skip) return Promise.resolve();
    console.warn('[aimeat-phaser] a cutscene step was not understood and was left out:', s);
    return Promise.resolve();
  }

  /** @param {any[]} items */
  async function runList(items) {
    for (const s of items) {
      if (stopped) return;
      // The step is read, never awaited: a { ask, then } step is a thenable.
      await runStep(s);
    }
  }

  /* ── Hold to skip ─────────────────────────────────────────────────────────────────────── */

  function release() { pointerHeld = false; }

  /** The arc that fills while the button is down. Cleared with one redraw when it is let go. */
  function drawArc(p) {
    if (!ring) return;
    ring.arc.clear();
    if (p <= 0) return;
    ring.arc.lineStyle(3, th.accent, 1);
    ring.arc.beginPath();
    ring.arc.arc(ring.cx, ring.cy, ring.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, false);
    ring.arc.strokePath();
  }

  /**
   * One frame of the hold. Runs only while a skippable cutscene is on, and draws only while the
   * button is down.
   * @param {number} _time
   * @param {number} delta
   */
  function tick(_time, delta) {
    if (finished) return;
    const down = pointerHeld || !!(pad && (pad.action || pad.jump));
    if (!down) {
      if (heldMs > 0) {
        heldMs = 0;
        drawArc(0);
      }
      return;
    }
    heldMs += typeof delta === 'number' && isFinite(delta) ? delta : 16;
    const p = Math.min(1, heldMs / HOLD_MS);
    drawArc(p);
    if (p >= 1) skip();
  }

  /** The small pill in the top right: the words, and the ring the hold fills. */
  function armSkip() {
    const r = 9;
    const hgt = 28;
    const label = scene.add.text(0, 0, o.skipLabel || 'Hold to skip', {
      fontFamily: th.fontMono || th.font, fontSize: '12px', color: cssColour(th.inkDim),
    }).setOrigin(0, 0.5).setScrollFactor(0);
    const w = 12 + Math.ceil(label.width) + 10 + r * 2 + 12;
    const area = { x: 0, y: 0, width: w, height: hgt };
    const plate = scene.add.graphics().setScrollFactor(0);
    plate.fillStyle(th.surface, 0.96);
    plate.fillRoundedRect(0, 0, w, hgt, hgt / 2);
    plate.lineStyle(1, th.line, 1);
    plate.strokeRoundedRect(0, 0, w, hgt, hgt / 2);
    plate.setInteractive({ hitArea: area, hitAreaCallback: inRect, useHandCursor: true });
    plate.on('pointerdown', function () { pointerHeld = true; });
    plate.on('pointerup', release);
    plate.on('pointerout', release);
    label.setPosition(12, hgt / 2);
    const cx = w - 12 - r;
    const cy = hgt / 2;
    const track = scene.add.graphics().setScrollFactor(0);
    track.lineStyle(2, th.line, 1);
    track.strokeCircle(cx, cy, r);
    const arc = scene.add.graphics().setScrollFactor(0);
    const root = scene.add.container(scene.scale.width - MARGIN - w, MARGIN, [plate, label, track, arc])
      .setScrollFactor(0).setDepth(DIALOGUE_DEPTH + 5);
    ring = { root: root, arc: arc, cx: cx, cy: cy, r: r };
    if (scene.events) scene.events.on('update', tick);
    if (scene.input) scene.input.on('pointerup', release);
  }

  /* ── The run ──────────────────────────────────────────────────────────────────────────── */

  /** End it now: the step in flight lands on its end state and the list stops. */
  function skip() {
    if (stopped || finished) return;
    stopped = true;
    const fn = cancel;
    cancel = null;
    if (fn) fn();
  }

  /** Take down everything the run put up. Runs once, however the run ended. */
  function cleanup() {
    if (finished) return;
    finished = true;
    cancel = null;
    if (scene.events) {
      scene.events.off('update', tick);
      scene.events.off('shutdown', onShutdown);
    }
    if (scene.input) scene.input.off('pointerup', release);
    if (ring) {
      ring.root.destroy();
      ring = null;
    }
    if (cover) {
      if (scene.tweens) scene.tweens.killTweensOf(cover);
      cover.destroy();
      cover = null;
    }
    if (own) talk.destroy();
    else talk.hide();
  }

  function onShutdown() {
    skip();
    cleanup();
  }
  if (scene.events && typeof scene.events.once === 'function') scene.events.once('shutdown', onShutdown);
  if (skippable) armSkip();

  const done = runList(list).then(function () {
    cleanup();
    return { skipped: stopped };
  }, function (err) {
    cleanup();
    throw err;
  });

  return Object.assign(done, { skip: skip, dialogue: talk });
}
