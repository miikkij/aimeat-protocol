/**
 * @file phaser/tokens.js
 * @description The bridge from the Atelier `--ak-*` contract to the values a Phaser scene needs.
 *   boot.js reads the tokens off an element and hands back colours as numbers; a scene wants them
 *   in three more shapes, and this is where the conversion lives so no two modules write it twice.
 *
 *   A COLOUR IS A NUMBER HERE AND NOWHERE ELSE IS IT ANYTHING. Text objects need a CSS string,
 *   camera fades need three channels, tweens and Graphics need the number itself. All three come
 *   from the same token, so a look changes every one of them at once and no literal is ever
 *   written into a game.
 *
 *   THE PACE AND THE CURVE ARE THE LOOK'S TOO, with one honest limit: `--ak-ease` is usually a
 *   cubic-bezier() expression and Phaser's tween engine has no parser for one, so a named Phaser
 *   curve stands in rather than the tween silently running linear.
 * @structure look(scene) · cssColour(n) · channels(n) · ms(value, fallback) · curve(theme) ·
 *   OVERLAY_DEPTH
 * @usage  const th = look(scene);
 *         scene.add.text(0, 0, 'Play', { fontFamily: th.font, color: cssColour(th.ink) });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (wish-phaser4-design-book-page).
 */
import { theme } from './boot.js';

/** A theme colour as the CSS string a Phaser Text style wants. boot.js owns the conversion. */
export { hex as cssColour } from './boot.js';

/** Above every gameplay layer, so an overlay is never half-covered by a sprite. */
export const OVERLAY_DEPTH = 1000000;

/** The curve used when the look's own ease is a CSS expression Phaser cannot read. */
const FALLBACK_EASE = 'Cubic.easeOut';

/**
 * The look of the element a game was booted into: the canvas's own parent, which is where the app
 * put the game and therefore where its tokens live.
 * @param {any} scene
 * @returns {any} the theme handle from boot.js
 */
export function look(scene) {
  const canvas = scene && scene.game ? scene.game.canvas : null;
  return theme(canvas ? canvas.parentElement : null);
}

/**
 * A theme colour split into the three channels camera.fadeOut / fadeIn take.
 * @param {number} value  0xrrggbb
 * @returns {{ r: number, g: number, b: number }}
 */
export function channels(value) {
  const n = typeof value === 'number' && isFinite(value) ? value : 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * The look's pace in milliseconds, whether the token arrived as a number or as a CSS duration.
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
export function ms(value, fallback) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (isFinite(n)) return /\ds\s*$/.test(value) && !/ms\s*$/.test(value) ? n * 1000 : n;
  }
  return fallback;
}

/**
 * The look's curve, when Phaser can read it.
 * @param {any} th  the theme handle
 * @returns {string} a Phaser ease name
 */
export function curve(th) {
  const e = th && th.ease;
  return typeof e === 'string' && e.indexOf('(') < 0 && e.indexOf(',') < 0 ? e : FALLBACK_EASE;
}
