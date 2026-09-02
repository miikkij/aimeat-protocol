/**
 * @file phaser/sprites.js
 * @description Moving characters with zero art, and the animations for real art once it arrives.
 *
 *   spriteSheet() GENERATES a whole animated sheet on the theme's colours: a side-view hero with
 *   idle, walk, jump, fall, hit and die, a top-down figure with a walk in four or eight
 *   directions, three enemies (slime, bat, walker), a spinning coin and a bobbing pickup. Each
 *   comes out as one texture with numbered frames and its animations registered under
 *   <key>-<clip>, so sprite.play('hero-walk') works the moment the call returns. The drawings
 *   live in sprites-draw.js; this file lays the cells out and registers the clips.
 *
 *   animations() does the second half for a REAL sheet somebody loaded: a map of clip name to
 *   frames becomes the same <key>-<clip> set under the same rules, so a game written on the
 *   generated hero swaps in drawn art by changing one preload and nothing else.
 *
 *   actor() is the character itself, in sprites-actor.js and re-exported here: a physics sprite
 *   with a small state machine, a facing, a hit, a death, a speech bubble, and one update() a
 *   platformer feeds its controls state or one drive(vx, vy) a top-down game feeds a vector.
 *
 *   spriteFromLibrary() is the sugar for an aimeat-assets library: an image entry that carried
 *   frames is already a sheet after preloadPack(), so this cuts its clips and hands back a
 *   sprite, or an actor.
 *
 *   BOTH REGISTRATIONS ARE IDEMPOTENT PER KEY. A texture or an animation that exists is left
 *   alone, so two scenes may ask for the same hero and a scene restart costs nothing. The less-
 *   motion answer is read when a clip is registered: idle breathing, the coin's spin and the
 *   pickup's bob become their first frame, while a walk, a jump or a death still play, because
 *   they say what is happening.
 * @structure register() · spriteSheet() · animations() · spriteFromLibrary(); actor() lives in
 *   ./sprites-actor.js and the drawings in ./sprites-draw.js
 * @usage
 *   const hero = AIMEAT.phaser.spriteSheet(this, { kind: 'hero' });      // texture + anims
 *   const me = AIMEAT.phaser.actor(this, { key: hero.key, x: 80, y: 200 });
 *   // in update(): pad.update(); me.update(pad);
 *   me.on('land', () => j.burst(me.sprite.x, me.sprite.y, 'dust'));
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: generated sheets for seven kinds, animations() for loaded
 *     sheets, the actor with its state machine, and spriteFromLibrary().
 */
import { reducedMotion } from '../atelier/dom.js';
import { look } from './tokens.js';
import { KINDS, plan, palette, draw } from './sprites-draw.js';
import { actor } from './sprites-actor.js';

export { actor };

/** How many cells go on one row of a generated sheet before the next row starts. A strip forty
 *  frames wide would pass the texture size some phones allow; sixteen keeps a 64-pixel frame
 *  under 1024 wide. */
const MAX_COLUMNS = 16;

/** The clip names that are decoration: under less motion they hold their first frame. */
const DECORATION = { idle: true, bob: true, spin: true, breathe: true };

/** Clips that play once when the map does not say. A death that loops is a nightmare. */
const ONCE = { die: true, hit: true, jump: true, fall: true };

/**
 * Register one clip, once. Frames may be numbers (a strip or a generated sheet) or names (an
 * atlas).
 * @param {any} scene
 * @param {string} key      the texture
 * @param {string} name     the clip: 'walk'
 * @param {Array<number|string>} frames
 * @param {{ rate?: number, repeat?: number, yoyo?: boolean }} how
 * @returns {string} the animation key, <key>-<name>
 */
function register(scene, key, name, frames, how) {
  const animKey = key + '-' + name;
  if (scene.anims.exists(animKey)) return animKey;
  scene.anims.create({
    key: animKey,
    frames: frames.map(function (f) { return { key: key, frame: f }; }),
    frameRate: how.rate || 8,
    repeat: frames.length > 1 && typeof how.repeat === 'number' ? how.repeat : 0,
    yoyo: !!how.yoyo,
  });
  return animKey;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   Generated sheets
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} SheetSpec
 * @property {'hero'|'topdown'|'slime'|'bat'|'walker'|'coin'|'pickup'} [kind]  Default 'hero'.
 * @property {string} [key]      the texture key, and the prefix of every animation. Default: the kind.
 * @property {number} [width]    one frame's width. Default: the kind's own (the hero is 32).
 * @property {number} [height]   one frame's height (the hero is 40).
 * @property {{ body?: number, visor?: number, trim?: number }} [palette]  theme numbers, the same
 *   three textures.character takes; what each means per kind is in sprites-draw.js (a coin's
 *   visor is its edge and its trim the shine)
 * @property {4|8} [directions]  the top-down figure only. Default 4.
 */

/**
 * @typedef {object} SheetHandle
 * @property {string} key
 * @property {string} kind
 * @property {number} width
 * @property {number} height
 * @property {number} frames                       how many cells the sheet holds
 * @property {Record<string, string>} anims        clip → animation key ('walk' → 'hero-walk')
 * @property {Record<string, { start: number, end: number }>} clips   clip → its frame range
 */

/**
 * A generated, animated sheet on the theme's colours, with its animations registered.
 *
 * The hero carries idle (2), walk (6, also registered as run for level.js), jump, fall, hit
 * and die (3). The top-down figure carries idle and a four-frame walk per direction, named
 * <key>-walk-down and so on, with the 'down' pair also plain <key>-idle and <key>-walk. The
 * slime, bat and walker carry idle (2), walk (4; the bat's is also fly), hit and die (2). The
 * coin carries spin (6) and the pickup bob (4), both also idle.
 *
 * @param {any} scene
 * @param {SheetSpec} [spec]
 * @returns {SheetHandle}
 */
export function spriteSheet(scene, spec) {
  const s = spec || /** @type {SheetSpec} */ ({});
  if (s.kind && !KINDS[s.kind]) {
    console.warn('[aimeat-phaser] spriteSheet(): "' + s.kind + '" is not a kind it draws. The kinds '
      + 'are ' + Object.keys(KINDS).join(', ') + '; drawing a hero.');
  }
  const kind = KINDS[s.kind] ? s.kind : 'hero';
  const key = s.key || kind;
  const th = look(scene);
  const p = plan(kind, s);
  const w = s.width || p.width;
  const h = s.height || p.height;
  const pal = palette(kind, th, s.palette);

  let total = 0;
  for (const clip of p.clips) {
    clip.start = total;
    total += clip.count;
  }
  const columns = Math.min(total, MAX_COLUMNS);
  const rows = Math.ceil(total / columns);

  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({ add: false });
    for (const clip of p.clips) {
      for (let i = 0; i < clip.count; i++) {
        const cell = clip.start + i;
        draw(kind, g, clip.name, i, (cell % columns) * w, Math.floor(cell / columns) * h, w, h, pal);
      }
    }
    g.generateTexture(key, columns * w, rows * h);
    g.destroy();
    // generateTexture leaves one whole-sheet frame; the cells are cut out by hand, numbered
    // from 0, which is exactly what a loaded spritesheet looks like from here on.
    const texture = scene.textures.get(key);
    for (let i = 0; i < total; i++) {
      texture.add(i, 0, (i % columns) * w, Math.floor(i / columns) * h, w, h);
    }
  }

  const still = reducedMotion();
  /** @type {Record<string, string>} */
  const anims = {};
  /** @type {Record<string, { start: number, end: number }>} */
  const clips = {};
  for (const clip of p.clips) {
    /** @type {number[]} */
    const frames = [];
    const count = still && clip.still ? 1 : clip.count;
    for (let i = 0; i < count; i++) frames.push(clip.start + i);
    anims[clip.name] = register(scene, key, clip.name, frames, { rate: clip.rate, repeat: clip.repeat });
    if (clip.alias) {
      anims[clip.alias] = register(scene, key, clip.alias, frames, {
        rate: clip.aliasRate || clip.rate, repeat: clip.repeat,
      });
    }
    clips[clip.name] = { start: clip.start, end: clip.start + clip.count - 1 };
  }
  return { key: key, kind: kind, width: w, height: h, frames: total, anims: anims, clips: clips };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   Animations for a loaded sheet
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * One clip, as the map may write it: a frame number, a list of frames (numbers, or names for an
 * atlas), or an object with a range and its pace.
 * @typedef {number|Array<number|string>|{ start?: number, end?: number, count?: number,
 *   frames?: Array<number|string>, rate?: number, repeat?: number, yoyo?: boolean,
 *   essential?: boolean }} ClipSpec
 */

/**
 * The frames and the pace one ClipSpec asks for.
 * @param {ClipSpec} want
 * @returns {{ frames: Array<number|string>, rate?: number, repeat?: number, yoyo?: boolean,
 *   essential?: boolean }|null}
 */
function readClip(want) {
  if (typeof want === 'number') return { frames: [want] };
  if (typeof want === 'string') return { frames: [want] };
  if (Array.isArray(want)) return want.length ? { frames: want.slice() } : null;
  if (!want || typeof want !== 'object') return null;
  /** @type {Array<number|string>} */
  let frames = [];
  if (Array.isArray(want.frames)) {
    frames = want.frames.slice();
  } else if (typeof want.start === 'number') {
    const end = typeof want.end === 'number' ? want.end
      : (typeof want.count === 'number' ? want.start + want.count - 1 : want.start);
    for (let i = want.start; i <= end; i++) frames.push(i);
  }
  if (!frames.length) return null;
  return { frames: frames, rate: want.rate, repeat: want.repeat, yoyo: want.yoyo, essential: want.essential };
}

/**
 * Register the clips of a sheet that is already loaded: one from a pack's spritesheets, an
 * aimeat-assets image entry that carried frames, or an atlas whose frames have names.
 *
 *   animations(this, 'hero', { idle: [0, 1], walk: { start: 2, end: 7, rate: 10 }, jump: 8 });
 *
 * A clip with more than one frame loops unless the map says repeat, except die, hit, jump and
 * fall, which play once. Under less motion idle, bob, spin and breathe become their first frame
 * unless the entry says essential: true. Names are <key>-<clip>, so the map above makes
 * hero-idle, hero-walk and hero-jump, and a game can play them by name or through the handle.
 *
 * @param {any} scene
 * @param {string} key                          the texture
 * @param {Record<string, ClipSpec>} map        clip name → frames
 * @returns {{ key: string, anims: Record<string, string> }}
 */
export function animations(scene, key, map) {
  /** @type {Record<string, string>} */
  const anims = {};
  if (!scene.textures.exists(key)) {
    console.warn('[aimeat-phaser] animations(): the texture "' + key + '" is not loaded, so its '
      + 'clips were not registered. Load the sheet first (preloadPack) and call again; the names '
      + 'will be the same.');
    for (const name in map || {}) anims[name] = key + '-' + name;
    return { key: key, anims: anims };
  }
  const still = reducedMotion();
  for (const name in map || {}) {
    const clip = readClip(map[name]);
    if (!clip) {
      console.warn('[aimeat-phaser] animations(): "' + name + '" names no frames and was skipped.');
      continue;
    }
    const frames = still && DECORATION[name] && !clip.essential ? clip.frames.slice(0, 1) : clip.frames;
    const repeat = typeof clip.repeat === 'number' ? clip.repeat : (ONCE[name] ? 0 : -1);
    anims[name] = register(scene, key, name, frames, { rate: clip.rate, repeat: repeat, yoyo: clip.yoyo });
  }
  return { key: key, anims: anims };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   From an aimeat-assets library
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A sprite, or an actor, from an image entry in an aimeat-assets library. The entry's frames
 * ({ frameWidth, frameHeight, count }) made preloadPack() load it as a sheet under the same key,
 * so all that is left is to cut its clips and put it on the scene.
 *
 *   const lib = await AIMEAT.assets.library({ app: 'ridge' });
 *   await preloadPack(this, lib);
 *   const { actor: me } = spriteFromLibrary(this, lib, 'hero', {
 *     x: 80, y: 200, animations: { idle: [0, 1], walk: { start: 2, end: 7 }, jump: 8 },
 *     actor: { speed: 240 },
 *   });
 *
 * @param {any} scene
 * @param {any} lib        an aimeat-assets library (awaited), or the manifest lib.get() returns
 * @param {string} key     the image entry's key, which is also the texture's
 * @param {{ x?: number, y?: number, animations?: Record<string, ClipSpec>, play?: string,
 *   physics?: boolean,
 *   actor?: boolean|Partial<import('./sprites-actor.js').ActorSpec> }} [opts]  play names a
 *   clip to start on; actor makes an ActorHandle instead of a bare sprite, with these options
 * @returns {{ sprite: any, anims: Record<string, string>, entry: any,
 *   actor: import('./sprites-actor.js').ActorHandle|null }}
 */
export function spriteFromLibrary(scene, lib, key, opts) {
  const o = opts || {};
  const man = lib && typeof lib.get === 'function' ? lib.get() : lib;
  const entry = man && man.images ? man.images[key] : null;
  if (!entry) {
    throw new Error('[aimeat-phaser] the library has no image "' + key + '". lib.get().images lists '
      + 'what it holds; a sheet is an image entry with frames { frameWidth, frameHeight, count }.');
  }
  if (!scene.textures.exists(key)) {
    throw new Error('[aimeat-phaser] "' + key + '" is not loaded yet. preloadPack(this, lib) in '
      + 'preload(), or awaited in create(), puts the library on the scene first.');
  }
  if (!entry.frames && o.animations) {
    console.warn('[aimeat-phaser] "' + key + '" is a single image, not a sheet: its manifest entry '
      + 'has no frames, so every clip in the animations map cuts the same one frame. Give the entry '
      + 'frames { frameWidth, frameHeight, count } and load again.');
  }
  const anims = o.animations ? animations(scene, key, o.animations).anims : {};
  const x = o.x || 0;
  const y = o.y || 0;
  if (o.actor) {
    const given = o.actor === true ? {} : o.actor;
    const handle = actor(scene, Object.assign({ x: x, y: y, anims: anims }, given, { key: key }));
    return { sprite: handle.sprite, anims: anims, entry: entry, actor: handle };
  }
  const sprite = o.physics && scene.physics
    ? scene.physics.add.sprite(x, y, key)
    : scene.add.sprite(x, y, key);
  if (o.play && anims[o.play]) sprite.play(anims[o.play]);
  return { sprite: sprite, anims: anims, entry: entry, actor: null };
}
