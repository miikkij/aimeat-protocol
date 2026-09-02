/**
 * @file phaser/tileworld-tiles.js
 * @description The art a top-down world wears before anyone has drawn any: one strip of square
 *   tiles generated from the theme, so a world built from twelve lines of text is on the screen in
 *   colour five minutes into a project and looks like the page it sits in.
 *
 *   ONE STRIP, ONE TILESET. Every kind is drawn at its own slot along a single texture, and the
 *   slot number is the tile index. That is what a Phaser tileset wants, and it is what lets set()
 *   repaint a cell with one number. A kind an app names in its own legend gets a slot too, drawn
 *   as a plain block, so an unfamiliar mark blocks and shows rather than vanishing.
 *
 *   EVERY SHAPE STAYS INSIDE ITS CELL. The slots sit edge to edge, so a circle that reached past
 *   its cell would be painted into the neighbouring slot and turn up there as a stray arc. Radii
 *   are at most half a tile and centred, which is why a tree's crown is two tiles: the lower half
 *   over the trunk, and the cap over the cell above it, on the overhead layer.
 *
 *   NO COLOUR IS WRITTEN HERE. Every fill is a theme number or a shade of one, so the same world
 *   re-tones with the palette and the mode, the way the platformer's tiles in assets.js do.
 * @structure mix · shade · DRAW_KINDS · the draw functions, one per kind · tileStrip(scene, kinds,
 *   size, th) → { key, index, count } · marker(scene, size, th) → key · minimapTone · markTone
 * @usage
 *   const strip = tileStrip(scene, DRAW_KINDS, 32, look(scene));
 *   map.addTilesetImage('ak-tileworld', strip.key, 32, 32, 0, 0, 1);
 *   layer.putTileAt(strip.index.wall + 1, tx, ty);
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the generated strip for the ten top-down kinds, the player
 *     marker, and the minimap tones.
 */

/** The kinds the strip always carries, in slot order. An app's own kinds are appended after. */
export const DRAW_KINDS = [
  'floor', 'grass', 'water', 'bridge', 'wall', 'tree', 'door', 'chest', 'canopy', 'canopytop',
];

/**
 * Blend one colour toward another, channel by channel.
 * @param {number} from  0xrrggbb
 * @param {number} to    0xrrggbb
 * @param {number} k     0..1, how far toward the second colour
 * @returns {number}
 */
export function mix(from, to, k) {
  const t = Math.max(0, Math.min(1, k));
  const channel = function (shift) {
    const a = (from >> shift) & 255;
    const b = (to >> shift) & 255;
    return Math.round(a + (b - a) * t);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * Move a colour toward white (a positive amount) or toward black (a negative one). Every tile
 * takes one theme colour and derives its lit and shadowed faces from it this way, so the whole
 * strip answers one palette.
 * @param {number} colour  0xrrggbb
 * @param {number} amount  -1..1
 * @returns {number}
 */
export function shade(colour, amount) {
  const end = amount >= 0 ? 255 : 0;
  const target = (end << 16) | (end << 8) | end;
  return mix(colour, target, Math.abs(amount));
}

/**
 * The pen sizes every kind shares at one tile size.
 * @param {number} s
 * @returns {{ edge: number, dot: number }}
 */
function gauge(s) {
  return { edge: Math.max(2, Math.round(s / 8)), dot: Math.max(1, Math.round(s / 16)) };
}

/** Plain ground: the surface colour with three flecks of the line colour. */
function drawFloor(g, left, s, th) {
  const d = gauge(s).dot;
  g.fillStyle(th.surface, 1).fillRect(left, 0, s, s);
  g.fillStyle(th.line, 1);
  g.fillRect(left + s * 0.28, s * 0.34, d, d);
  g.fillRect(left + s * 0.66, s * 0.7, d, d);
  g.fillRect(left + s * 0.52, s * 0.14, d, d);
}

/** Ground with blades on it: the floor, then five short strokes of a calmed green. */
function drawGrass(g, left, s, th) {
  const d = gauge(s).dot;
  drawFloor(g, left, s, th);
  g.fillStyle(mix(th.ok, th.surface, 0.3), 1);
  g.fillRect(left + s * 0.2, s * 0.5, d, d * 3);
  g.fillRect(left + s * 0.42, s * 0.22, d, d * 3);
  g.fillRect(left + s * 0.68, s * 0.58, d, d * 3);
  g.fillRect(left + s * 0.3, s * 0.78, d, d * 2);
  g.fillRect(left + s * 0.78, s * 0.3, d, d * 2);
}

/** Deep water: the first channel colour darkened, with two lighter ripples. */
function drawWater(g, left, s, th) {
  const d = gauge(s).dot;
  g.fillStyle(shade(th.ch1, -0.42), 1).fillRect(left, 0, s, s);
  g.fillStyle(shade(th.ch1, 0.05), 1);
  g.fillRect(left + s * 0.12, s * 0.3, s * 0.42, d);
  g.fillRect(left + s * 0.5, s * 0.66, s * 0.38, d);
}

/** Planks across the water: the water first, so a bridge blends into the river it crosses. */
function drawBridge(g, left, s, th) {
  const e = gauge(s).edge;
  const rail = Math.max(1, Math.round(e / 3));
  drawWater(g, left, s, th);
  g.fillStyle(th.warn, 1).fillRect(left, e / 2, s, s - e);
  g.fillStyle(shade(th.warn, -0.35), 1);
  g.fillRect(left, s / 3, s, 1);
  g.fillRect(left, (s * 2) / 3, s, 1);
  g.fillRect(left, e / 2, s, rail);
  g.fillRect(left, s - e / 2 - rail, s, rail);
}

/** A wall seen from above: the dim ink in a brick pattern with a lit top edge. */
function drawWall(g, left, s, th) {
  g.fillStyle(th.inkDim, 1).fillRect(left, 0, s, s);
  g.fillStyle(shade(th.inkDim, -0.4), 1);
  g.fillRect(left, s / 2 - 1, s, 2);
  g.fillRect(left + s / 2 - 1, 0, 2, s / 2);
  g.fillRect(left + s / 4 - 1, s / 2, 2, s / 2);
  g.fillRect(left + (s * 3) / 4 - 1, s / 2, 2, s / 2);
  g.fillStyle(shade(th.inkDim, 0.22), 1).fillRect(left, 0, s, 2);
}

/** The trunk of a tree on the ground, with the crown's shadow round it. The crown itself is the
 *  canopy pair on the overhead layer. */
function drawTree(g, left, s, th) {
  const trunk = Math.max(3, Math.round(s * 0.22));
  drawFloor(g, left, s, th);
  g.fillStyle(shade(th.ok, -0.5), 0.35).fillCircle(left + s / 2, s * 0.62, s * 0.38);
  g.fillStyle(shade(th.warn, -0.3), 1).fillRect(left + s / 2 - trunk / 2, s * 0.4, trunk, s * 0.6);
  g.fillStyle(th.warn, 1)
    .fillRect(left + s / 2 - trunk / 2, s * 0.4, Math.max(1, Math.round(trunk / 3)), s * 0.6);
}

/** The lower half of a crown, over the tree's own cell. */
function drawCanopy(g, left, s, th) {
  g.fillStyle(shade(th.ok, -0.12), 1).fillCircle(left + s / 2, s * 0.16, s * 0.5);
  g.fillStyle(shade(th.ok, 0.12), 1).fillCircle(left + s / 2 - s * 0.14, s * 0.04, s * 0.2);
}

/** The cap of a crown, over the cell above the tree: the same circle, one tile lower. */
function drawCanopyTop(g, left, s, th) {
  g.fillStyle(shade(th.ok, -0.12), 1).fillCircle(left + s / 2, s * 1.16, s * 0.5);
  g.fillStyle(shade(th.ok, 0.12), 1).fillCircle(left + s / 2 - s * 0.14, s * 1.04, s * 0.2);
}

/** A door in its frame: two leaves and a knob. */
function drawDoor(g, left, s, th) {
  const e = gauge(s).edge;
  const d = gauge(s).dot;
  drawFloor(g, left, s, th);
  g.fillStyle(shade(th.warn, -0.45), 1).fillRect(left + e / 2, e / 2, s - e, s - e);
  g.fillStyle(th.warn, 1).fillRect(left + e, e, s - 2 * e, s - 2 * e);
  g.fillStyle(shade(th.warn, -0.3), 1).fillRect(left + s / 2 - 1, e, 2, s - 2 * e);
  g.fillStyle(shade(th.warn, 0.45), 1).fillCircle(left + s * 0.62, s * 0.5, d + 1);
}

/** A chest on the ground: the lid seam and a latch in the third channel colour. */
function drawChest(g, left, s, th) {
  const d = gauge(s).dot;
  const radius = Math.max(2, Math.round(s / 12));
  drawFloor(g, left, s, th);
  g.fillStyle(shade(th.warn, -0.4), 1).fillRect(left + s * 0.15, s * 0.3, s * 0.7, s * 0.52);
  g.fillStyle(th.warn, 1).fillRoundedRect(left + s * 0.15, s * 0.25, s * 0.7, s * 0.5, radius);
  g.fillStyle(shade(th.warn, -0.4), 1).fillRect(left + s * 0.15, s * 0.45, s * 0.7, 1);
  g.fillStyle(th.ch3, 1).fillRect(left + s / 2 - d, s * 0.41, d * 2, d * 2 + 1);
}

/** Anything an app named itself: a solid block in the accent, lit above and shadowed below. */
function drawBlock(g, left, s, th) {
  const e = gauge(s).edge;
  g.fillStyle(th.accent, 1).fillRect(left, 0, s, s);
  g.fillStyle(shade(th.accent, 0.3), 1).fillRect(left, 0, s, e);
  g.fillStyle(shade(th.accent, -0.3), 1).fillRect(left, s - Math.round(e / 2), s, Math.round(e / 2));
}

/** @type {Record<string, (g: any, left: number, s: number, th: any) => void>} */
const DRAW = {
  floor: drawFloor,
  grass: drawGrass,
  water: drawWater,
  bridge: drawBridge,
  wall: drawWall,
  tree: drawTree,
  door: drawDoor,
  chest: drawChest,
  canopy: drawCanopy,
  canopytop: drawCanopyTop,
};

/**
 * The strip: one square per kind, side by side, as a single texture. Drawn once per kind set and
 * tile size and kept, so a second world in the same game reuses it (and a palette changed
 * mid-game wants a new game, as with every generated texture here).
 * @param {any} scene
 * @param {string[]} kinds  slot order; anything outside DRAW_KINDS is drawn as a block
 * @param {number} size    the tile side in pixels
 * @param {any} th         the theme handle from tokens.js look()
 * @returns {{ key: string, index: Record<string, number>, count: number }}  index is the slot of
 *   each kind, zero-based; add the tileset's first gid to get the tile index
 */
export function tileStrip(scene, kinds, size, th) {
  const list = kinds.slice();
  const key = 'ak-tileworld-' + size + '-' + list.join('.');
  /** @type {Record<string, number>} */
  const index = {};
  for (let i = 0; i < list.length; i++) index[list[i]] = i;
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({ add: false });
    for (let i = 0; i < list.length; i++) (DRAW[list[i]] || drawBlock)(g, i * size, size, th);
    g.generateTexture(key, size * list.length, size);
    g.destroy();
  }
  return { key: key, index: index, count: list.length };
}

/**
 * The player the world makes when the app has not brought one: a round marker in the accent with
 * an ink ring and a small eye, so it reads as a figure with a facing at any tile size.
 * @param {any} scene
 * @param {number} size  the tile side
 * @param {any} th
 * @returns {string} the texture key
 */
export function marker(scene, size, th) {
  const key = 'ak-tileworld-marker-' + size;
  if (!scene.textures.exists(key)) {
    const d = gauge(size).dot;
    const g = scene.make.graphics({ add: false });
    g.fillStyle(th.ink, 1).fillCircle(size / 2, size / 2, size * 0.34);
    g.fillStyle(th.accent, 1).fillCircle(size / 2, size / 2, size * 0.28);
    g.fillStyle(th.surface, 1).fillCircle(size * 0.6, size * 0.44, Math.max(1.5, d));
    g.generateTexture(key, size, size);
    g.destroy();
  }
  return key;
}

/**
 * The colour a cell takes on the minimap. Walkable ground is the line colour, so the walkable
 * shape of the world reads as one tone against the surface, and the things that matter stand out.
 * @param {any} th
 * @param {string} kind   the legend kind at the cell, '' when the world has no legend for it
 * @param {boolean} solid whether the cell blocks
 * @returns {number}
 */
export function minimapTone(th, kind, solid) {
  if (kind === 'water') return shade(th.ch1, -0.25);
  if (kind === 'tree') return shade(th.ok, -0.15);
  if (kind === 'bridge' || kind === 'door') return th.warn;
  if (kind === 'chest') return th.ch3;
  if (solid) return th.inkDim;
  return th.line;
}

/**
 * The dot a marked cell gets on the minimap: enemies in the error colour, people in ok, chests
 * in the third channel, doors in warn, and anything else in the accent.
 * @param {any} th
 * @param {string} kind
 * @returns {number}
 */
export function markTone(th, kind) {
  if (kind === 'enemy') return th.err;
  if (kind === 'npc') return th.ok;
  if (kind === 'chest') return th.ch3;
  if (kind === 'door') return th.warn;
  return th.accent;
}
