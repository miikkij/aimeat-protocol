/**
 * @file phaser/transitions.js
 * @description The four ways one scene hands over to the next: a camera fade, a rectangle wiping
 *   across, an iris closing and opening, and a straight cut. Extracted from menus.js, which
 *   re-exports transition() so a caller never has to know this file exists.
 *
 *   THE IRIS IS A RING, NOT A MASK. Phaser 4 refuses setMask under WebGL and says so in the
 *   console ("This method is not supported in WebGL. Create a Mask filter instead."), which
 *   quietly turns the Phaser 3 recipe for this into a no-op on the default renderer. So the
 *   closing circle is drawn as a stroked annulus whose inner edge shrinks to nothing while its
 *   outer edge stays off-screen: the same picture, on one code path, on either renderer.
 *
 *   LESS MOTION IS A CUT. Not a shorter fade, not a faster wipe. Somebody who asked for less
 *   motion gets the scene, immediately, and the Promise still resolves the same way so the
 *   caller's code is unchanged.
 *
 *   BOTH HALVES OR NEITHER. A drawn move covers this scene, starts the next, and uncovers it
 *   there through a one-shot 'create' hook on the target. A scene the manager does not yet know
 *   still starts; it just arrives without the second half, rather than never arriving.
 * @structure transition(scene, toKey, opts) → Promise · fadeOver · coverOver · onceCreated ·
 *   wipeIn / wipeOut · irisIn / irisOut · makeRing
 * @usage  await AIMEAT.phaser.transition(this, 'play', { kind: 'iris', colour: 'accent' });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (wish-phaser4-design-book-page).
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, channels, ms, curve, OVERLAY_DEPTH } from './tokens.js';

/**
 * Hand over to another scene, with a move the player can follow. Resolves once the next scene
 * has been started; under less motion every kind becomes a cut.
 *
 * @param {any} scene  the scene handing over
 * @param {string} toKey  the scene to start
 * @param {{ kind?: 'fade'|'wipe'|'iris'|'cut', duration?: number,
 *   colour?: 'bg'|'ink'|'accent', data?: any }} [opts]
 * @returns {Promise<void>}
 */
export function transition(scene, toKey, opts) {
  const o = opts || {};
  const th = look(scene);
  const kind = reducedMotion() ? 'cut' : (o.kind || 'fade');
  const span = o.duration != null ? o.duration : Math.max(180, ms(th.motion, 200) * 2);
  const tint = o.colour === 'ink' ? th.ink : o.colour === 'accent' ? th.accent : th.bg;
  const ease = curve(th);

  if (kind === 'cut') {
    scene.scene.start(toKey, o.data);
    return Promise.resolve();
  }
  if (kind === 'fade') return fadeOver(scene, toKey, o.data, span, tint);
  if (kind === 'wipe') return coverOver(scene, toKey, o.data, span, tint, ease, wipeIn, wipeOut);
  return coverOver(scene, toKey, o.data, span, tint, ease, irisIn, irisOut);
}

/**
 * The camera's own fade, out here and in over there.
 * @param {any} scene
 * @param {string} toKey
 * @param {any} data
 * @param {number} span
 * @param {number} tint
 * @returns {Promise<void>}
 */
function fadeOver(scene, toKey, data, span, tint) {
  const c = channels(tint);
  return new Promise(function (done) {
    scene.cameras.main.fadeOut(span, c.r, c.g, c.b, function (camera, progress) {
      if (progress < 1) return;
      onceCreated(scene, toKey, function (target) { target.cameras.main.fadeIn(span, c.r, c.g, c.b); });
      scene.scene.start(toKey, data);
      done();
    });
  });
}

/**
 * The two halves of a drawn move: cover this scene, start the next, uncover it there.
 * @param {any} scene
 * @param {string} toKey
 * @param {any} data
 * @param {number} span
 * @param {number} tint
 * @param {string} ease
 * @param {(scene: any, span: number, tint: number, ease: string) => Promise<void>} cover
 * @param {(scene: any, span: number, tint: number, ease: string) => void} uncover
 * @returns {Promise<void>}
 */
function coverOver(scene, toKey, data, span, tint, ease, cover, uncover) {
  return cover(scene, span, tint, ease).then(function () {
    onceCreated(scene, toKey, function (target) { uncover(target, span, tint, ease); });
    scene.scene.start(toKey, data);
  });
}

/**
 * Run something on the target scene the moment it has been created, when the manager already
 * knows it.
 * @param {any} scene
 * @param {string} toKey
 * @param {(target: any) => void} run
 * @returns {void}
 */
function onceCreated(scene, toKey, run) {
  const target = scene.scene.get(toKey);
  if (!target) return;
  const events = target.events || (target.sys ? target.sys.events : null);
  if (!events) return;
  events.once('create', function () { run(target); });
}

/**
 * A rectangle sweeping across the screen until it covers everything.
 * @param {any} scene @param {number} span @param {number} tint @param {string} ease
 * @returns {Promise<void>}
 */
function wipeIn(scene, span, tint, ease) {
  const width = scene.scale.width;
  const height = scene.scale.height;
  const bar = scene.add.rectangle(0, height / 2, width, height, tint).setOrigin(0, 0.5);
  bar.setScrollFactor(0).setDepth(OVERLAY_DEPTH).setScale(0, 1);
  return new Promise(function (done) {
    scene.tweens.add({ targets: bar, scaleX: 1, duration: span, ease: ease, onComplete: function () { done(); } });
  });
}

/**
 * The same rectangle leaving the other side, on the scene that has just arrived.
 * @param {any} scene @param {number} span @param {number} tint @param {string} ease
 * @returns {void}
 */
function wipeOut(scene, span, tint, ease) {
  const width = scene.scale.width;
  const height = scene.scale.height;
  const bar = scene.add.rectangle(width, height / 2, width, height, tint).setOrigin(1, 0.5);
  bar.setScrollFactor(0).setDepth(OVERLAY_DEPTH);
  scene.tweens.add({
    targets: bar, scaleX: 0, duration: span, ease: ease,
    onComplete: function () { bar.destroy(); },
  });
}

/**
 * The iris closing over this scene: the ring's inner edge shrinks to nothing.
 * @param {any} scene @param {number} span @param {number} tint @param {string} ease
 * @returns {Promise<void>}
 */
function irisIn(scene, span, tint, ease) {
  const ring = makeRing(scene, tint);
  return new Promise(function (done) {
    scene.tweens.add({
      targets: ring.state, r: 0, duration: span, ease: ease,
      onUpdate: ring.draw, onComplete: function () { ring.draw(); done(); },
    });
  });
}

/**
 * The iris opening again on the scene that has just arrived.
 * @param {any} scene @param {number} span @param {number} tint @param {string} ease
 * @returns {void}
 */
function irisOut(scene, span, tint, ease) {
  const ring = makeRing(scene, tint);
  ring.state.r = 0;
  ring.draw();
  scene.tweens.add({
    targets: ring.state, r: ring.outer, duration: span, ease: ease,
    onUpdate: ring.draw, onComplete: function () { ring.graphics.destroy(); },
  });
}

/**
 * The annulus the iris is made of, and the one call that redraws it. The outer edge sits past the
 * corner of the screen, so at r = 0 the ring is a filled screen.
 * @param {any} scene
 * @param {number} tint
 * @returns {{ graphics: any, state: { r: number }, outer: number, draw: () => void }}
 */
function makeRing(scene, tint) {
  const width = scene.scale.width;
  const height = scene.scale.height;
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.sqrt(width * width + height * height) / 2 + 4;
  const g = scene.add.graphics();
  g.setScrollFactor(0).setDepth(OVERLAY_DEPTH);
  const state = { r: outer };
  const draw = function () {
    const inner = Math.max(0, state.r);
    g.clear();
    if (inner >= outer) return;
    g.lineStyle(outer - inner, tint, 1);
    g.strokeCircle(cx, cy, (outer + inner) / 2);
  };
  draw();
  return { graphics: g, state: state, outer: outer, draw: draw };
}
