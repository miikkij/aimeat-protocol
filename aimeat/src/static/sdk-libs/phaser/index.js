/**
 * @file phaser/index.js
 * @description The aimeat-phaser library (wish-phaser4-design-book-page). Exposes AIMEAT.phaser: the
 *   parts every Phaser 4 game on this node otherwise re-guesses, so a builder gets a good base in
 *   one go and the Atelier kit and Phaser wear the same clothes:
 *
 *     game(spec)              boot a game into an element: fit / resize / fixed scaling, fullscreen
 *                             with the kit's button, resize under an observer, pause on tab hide
 *     theme(el)               the Atelier --ak-* tokens as Phaser colours and fonts
 *     pack / preloadPack      resource packs with a progress bar in the canvas and 404 reporting
 *     textures                generated shapes, tiles and a character with animations (no files)
 *     audio(game)             the bus: master / music / sfx, unlock on a gesture, crossfade, synth
 *     saves(spec)             ONE memory key per player: profile, settings, levels, scores, inventory;
 *                             guest in localStorage until login, then merged; the public leaderboard
 *     controls(scene)         keyboard, gamepad and a touch overlay as one state per frame
 *     hud / toast             score, lives, level, timer on the tokens
 *     menuItems / titleScene / pauseMenu / transition   in-canvas menus with motions, scene moves
 *     platformer / parseMap   an ASCII map becomes a level with arcade physics
 *     settingsPanel           the DOM settings page on Atelier's own form: volumes, fullscreen,
 *                             touch controls, less motion, key bindings, persisted through saves
 *
 *   IT LOADS PHASER FROM THIS NODE, NEVER A CDN (/lib/phaser@4.min.js), reads every colour from
 *   the Atelier tokens on the element it boots into, and reaches the node only through the data
 *   and auth libraries the app itself loaded (window.AIMEAT.data / .auth), so a game runs signed
 *   out as a guest and keeps its saves in the browser until the person signs in.
 * @structure the AIMEAT.phaser surface, assembled from boot.js · assets.js · audio.js · save.js ·
 *   controls.js · hud.js · menus.js · level.js · settings.js
 * @usage
 *   <link rel="stylesheet" href="/lib/aimeat-phaser.css">
 *   <script src="/v1/libs/aimeat-phaser.js"></script>
 *   const P = AIMEAT.phaser;
 *   const h = await P.game({ parent: '#stage', scale: 'fit', fullscreen: 'button', scenes: [play] });
 * @version-history
 *   v1.1.0 — 2026-09-02 — The game programme (wish-aimeat-assets-and-game-programme): juice (shake,
 *     hit-stop, flash, bursts, numbers, combo, slowmo, pop, trail), net (players together over
 *     the realtime pack: inputs and state deltas, host by lowest id), mobile (orientation prompt,
 *     safe area, wake lock, install), fromLibrary (an aimeat-assets library as the pack) and the
 *     levelEditor (rows the platformer plays, saved to the game's key).
 *   v1.0.0 — 2026-09-02 — Initial: boot, theme, packs, textures, audio, saves, controls, hud,
 *     menus, transitions, the platformer and the settings panel.
 */
import { attach } from '../_core/namespace.js';
import { ensurePhaser, theme, game } from './boot.js';
import { pack, preloadPack, fromLibrary, textures } from './assets.js';
import { audio } from './audio.js';
import { juice } from './juice.js';
import { net } from './net.js';
import { mobile } from './mobile.js';
import { levelEditor } from './editor.js';
import { saves } from './save.js';
import { controls } from './controls.js';
import { hud, toast } from './hud.js';
import { menuItems, titleScene, pauseMenu, transition } from './menus.js';
import { platformer, parseMap } from './level.js';
import { settingsPanel } from './settings.js';

const phaser = {
  /**
   * The library version. It MUST match the newest entry in /lib/aimeat-phaser.css's version
   * history; e2e-libs.ts fails when the two drift.
   */
  version: '1.1.0',

  // ── Boot and the look ──
  ensurePhaser, theme, game,

  // ── Assets (a pack by hand, or an aimeat-assets library through fromLibrary) ──
  pack, preloadPack, fromLibrary, textures,

  // ── Sound ──
  audio,

  // ── Feel, players together, phones ──
  juice, net, mobile,

  // ── The level editor (DOM), writing rows the platformer plays ──
  levelEditor,

  // ── Saves, controls, HUD ──
  saves, controls, hud, toast,

  // ── Menus and scene moves ──
  menuItems, titleScene, pauseMenu, transition,

  // ── Levels ──
  platformer, parseMap,

  // ── The settings page (DOM, on the Atelier kit when present) ──
  settingsPanel,
};

attach('phaser', phaser);
