/**
 * @file test/unit/phaser-stub.mjs
 * @description The one stub harness for verifying modules of the served library
 *   src/static/sdk-libs/phaser/ without a browser and without Phaser. Thirteen scratch scripts
 *   each wrote their own fake scene on 2026-09-02; this is their union, in one place, so the
 *   next module's verification script imports it instead of writing a fourteenth.
 *
 *   makeScene(opts)       a fake scene: add / make / physics / textures / anims / tweens / time /
 *                         cameras / scale / input / sound / events / game, every call recorded in
 *                         scene.log, and scene.clock.advance(ms) running timers, tweens and camera
 *                         effects deterministically. scene.step(ms) is one frame.
 *   makeStore(initial)    a fake saves() store recording every write
 *   makeDom(opts)         the minimal document the editor and designer panels drive
 *   makeAudioContext()    the stub AudioContext the chiptune and audio modules play into
 *   installGlobals(opts)  window / document / location / matchMedia / Phaser in place before the
 *                         module is imported; returns the restore function
 * @structure re-exports from phaser-stub-scene.mjs (the scene, clock, camera, scale, game),
 *   phaser-stub-objects.mjs (game objects), phaser-stub-managers.mjs (textures, anims),
 *   phaser-stub-input.mjs (input, sound), phaser-stub-physics.mjs and phaser-stub-dom.mjs
 *   (document, audio context, store, globals)
 * @usage
 *   import { installGlobals, makeScene } from '../test/unit/phaser-stub.mjs';
 *   const restore = installGlobals();
 *   const { fx } = await import('../src/static/sdk-libs/phaser/fx.js');   // after the globals
 *   const scene = makeScene();
 *   const f = fx(scene); const e = f.at(10, 20, 'sparks'); scene.clock.advance(2000);
 *   restore();
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
export { makeScene, makeClock, makeCamera, makeScale, makeGame } from './phaser-stub-scene.mjs';
export { emitter, gameObject, record, graphics, text, container, sprite, tileSprite, shape, particles, group, tilemap, textMetrics, TINT_FILL, TINT_MULTIPLY } from './phaser-stub-objects.mjs';
export { texturesManager, animsManager, canvasContext } from './phaser-stub-managers.mjs';
export { makeInput, makeGamepad, makeSound, KEY_CODES } from './phaser-stub-input.mjs';
export { makePhysics } from './phaser-stub-physics.mjs';
export { FakeNode, makeDom, makeAudioContext, makeStore, makePhaserNamespace, installGlobals } from './phaser-stub-dom.mjs';
