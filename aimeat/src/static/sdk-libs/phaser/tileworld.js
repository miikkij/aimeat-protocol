/**
 * @file phaser/tileworld.js
 * @description A large top-down world in tilemap layers, from a few lines of text or from a Tiled
 *   map, with the questions a game asks of its ground answered in tile coordinates.
 *
 *   TWO ROADS IN, ONE HANDLE. ASCII rows with a legend (the platformer's format in level.js, with
 *   a top-down legend: walls, water, trees, doors, chests, bridges, grass) are drawn from generated
 *   tiles on the theme into four layers: floor, decor, walls and overhead. A Tiled JSON map that
 *   preloadPack() loaded is built layer by layer under its own names, with the tileset image the
 *   spec names. Whichever road, the handle reads the same: at(), tileAt(), walkable(), grid(),
 *   set(), and the two coordinate conversions.
 *
 *   THE WALLS LAYER IS THE ONE THAT BLOCKS. Everything solid lives on it (walls, trunks, blocking
 *   water, an app's own kinds), so one collider and one collision list cover the world. A repaint
 *   through set() picks its collision up from that list, because Phaser's putTileAt reads the
 *   layer's collideIndexes, which is why the list is declared before the first tile is placed.
 *
 *   OVERHEAD IS DRAWN ABOVE THE PLAYER. A tree's crown is two tiles, the lower half at the tree
 *   and the cap on the cell above it, both on the overhead layer at OVERHEAD_DEPTH. The floor,
 *   decor and walls sit below zero, so a sprite at the default depth walks between them.
 *
 *   NOTHING LOOPS but one frame hook that exists only when water was asked to slow rather than
 *   block, and destroy() removes it. The scene's own shutdown calls destroy() unasked.
 * @structure DEFAULT_LEGEND · KIND · parseRows · buildAscii (paint) · buildTiled · tileWorld(scene,
 *   spec) → handle; the art is ./tileworld-tiles.js and the overview ./tileworld-minimap.js
 * @usage
 *   const world = AIMEAT.phaser.tileWorld(this, { map: ROWS, tile: 32, camera: 'follow' });
 *   const t = world.toTile(world.player.x, world.player.y);
 *   if (world.tileAt(t.x, t.y) === 'C') world.set(t.x, t.y, '.');
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the ASCII and Tiled roads, the four layers, the collision
 *     list, the objects callback, the camera follow with deadzone, and the water that slows.
 */
import { look } from './tokens.js';
import { DRAW_KINDS, tileStrip, marker } from './tileworld-tiles.js';

export { minimap, MINIMAP_DEPTH } from './tileworld-minimap.js';

/** The marks every AIMEAT top-down world understands without being told. */
const DEFAULT_LEGEND = {
  '#': 'wall',
  '.': 'floor',
  '~': 'water',
  T: 'tree',
  D: 'door',
  C: 'chest',
  P: 'spawn',
  E: 'enemy',
  N: 'npc',
  '=': 'bridge',
  ',': 'grass',
};

/**
 * What each kind is: the layer it is drawn on ('floor', 'decor', 'walls', or none for a thing the
 * app places itself), whether it blocks, and whether the objects callback reports it.
 * @type {Record<string, { layer: string|null, solid?: boolean, object?: boolean }>}
 */
const KIND = {
  floor: { layer: 'floor' },
  grass: { layer: 'floor' },
  water: { layer: 'floor' },
  bridge: { layer: 'floor' },
  wall: { layer: 'walls', solid: true },
  tree: { layer: 'walls', solid: true },
  door: { layer: 'decor', object: true },
  chest: { layer: 'decor', object: true },
  spawn: { layer: null },
  enemy: { layer: null, object: true },
  npc: { layer: null, object: true },
};

/** A kind an app named itself: a block on the walls layer, and it blocks. */
const OWN_KIND = { layer: 'walls', solid: true };

/** The kinds a tree's cap may hang over: open ground, where a player walks under it. */
const UNDER_CANOPY = { floor: true, grass: true, bridge: true, spawn: true, enemy: true, npc: true };

/** The four layers of an ASCII world, bottom to top. */
const LAYER_NAMES = ['floor', 'decor', 'walls', 'overhead'];

/** The floor's depth; each layer above it adds one, so all of them stay under a default sprite. */
const GROUND_DEPTH = -10;

/** The depth of everything drawn over the player. Put your own flying things above it. */
export const OVERHEAD_DEPTH = 5;

/** The generated tileset's first index. 1, as in Tiled, so 0 can never be mistaken for a tile. */
const FIRST_GID = 1;

const WATER_SPEED = 0.5;
const DEADZONE_SHARE = 0.25;
const FOLLOW_LERP = 0.1;

/** @param {string} text */
function warn(text) {
  console.warn('[aimeat-phaser] tileWorld: ' + text);
}

/**
 * A Tiled property, whichever shape the parser left it in: the raw array of { name, value } that
 * Phaser keeps on a tile layer, or a plain object.
 * @param {any} props
 * @param {string} name
 * @returns {any}
 */
function property(props, name) {
  if (Array.isArray(props)) {
    for (const p of props) if (p && p.name === name) return p.value;
    return undefined;
  }
  return props && typeof props === 'object' ? props[name] : undefined;
}

/**
 * Read ASCII rows into a grid of marks. Short rows are padded with floor, a space is floor, and a
 * mark the legend does not name is read as floor and reported once.
 * @param {string[]} rows
 * @param {Record<string, string>} legend
 * @returns {{ cols: number, rows: number, marks: string[][] }}
 */
function parseRows(rows, legend) {
  const lines = Array.isArray(rows) && rows.length ? rows : ['.'];
  let cols = 1;
  for (const line of lines) cols = Math.max(cols, String(line == null ? '' : line).length);
  /** @type {string[][]} */
  const marks = [];
  /** @type {Record<string, boolean>} */
  const strays = {};
  for (let y = 0; y < lines.length; y++) {
    const line = String(lines[y] == null ? '' : lines[y]);
    /** @type {string[]} */
    const row = [];
    for (let x = 0; x < cols; x++) {
      let mark = x < line.length ? line.charAt(x) : '.';
      if (mark === ' ') mark = '.';
      if (!legend[mark]) {
        strays[mark] = true;
        mark = '.';
      }
      row.push(mark);
    }
    marks.push(row);
  }
  const unknown = Object.keys(strays);
  if (unknown.length) {
    warn('the map uses marks the legend does not name (' + unknown.join(' ') + '); each was read '
      + 'as floor. Name them in spec.legend, mark → kind.');
  }
  return { cols: cols, rows: lines.length, marks: marks };
}

/**
 * The ASCII road: generated tiles into four blank layers.
 * @param {any} scene
 * @param {any} s
 * @param {any} th
 * @returns {any} the parts tileWorld() assembles
 */
function buildAscii(scene, s, th) {
  const legend = Object.assign({}, DEFAULT_LEGEND, s.legend || {});
  const tile = s.tile || 32;
  const waterBlocks = s.water !== 'slow';
  const parsed = parseRows(s.map, legend);
  const cols = parsed.cols;
  const rows = parsed.rows;
  const marks = parsed.marks;

  /** Does this kind block? An app's own kinds do; water does unless it was asked to slow. */
  function solid(kind) {
    const info = KIND[kind];
    if (!info) return true;
    if (kind === 'water') return waterBlocks;
    return !!info.solid;
  }

  const kinds = DRAW_KINDS.slice();
  for (const mark in legend) {
    const kind = legend[mark];
    if (!KIND[kind] && kinds.indexOf(kind) < 0) kinds.push(kind);
  }
  const strip = tileStrip(scene, kinds, tile, th);
  const map = scene.make.tilemap({ tileWidth: tile, tileHeight: tile, width: cols, height: rows });
  const tileset = map.addTilesetImage('ak-tileworld', strip.key, tile, tile, 0, 0, FIRST_GID);
  /** @type {Record<string, any>} */
  const layers = {};
  /** @type {any[]} */
  const order = [];
  for (let i = 0; i < LAYER_NAMES.length; i++) {
    const name = LAYER_NAMES[i];
    const layer = map.createBlankLayer(name, tileset);
    layer.setDepth(name === 'overhead' ? OVERHEAD_DEPTH : GROUND_DEPTH + i);
    layers[name] = layer;
    order.push(layer);
  }

  // The collision list goes in BEFORE any tile: putTileAt reads it, so every later put, the ones
  // set() makes included, carries the right flag without a second call. It is built from the
  // kinds the legend can name, because those are the only ones a cell can ever hold.
  /** @type {number[]} */
  const collideIndexes = [];
  for (const mark in legend) {
    const index = strip.index[legend[mark]] + FIRST_GID;
    if (solid(legend[mark]) && collideIndexes.indexOf(index) < 0) collideIndexes.push(index);
  }
  layers.walls.setCollision(collideIndexes, true, false);

  function inside(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < cols && ty < rows;
  }

  function kindAt(tx, ty) {
    return legend[marks[ty][tx]] || 'floor';
  }

  function slot(kind) {
    return strip.index[kind] + FIRST_GID;
  }

  /**
   * The four indexes one cell shows, from its own mark and the one below it (a tree below puts
   * its cap here). With faces true Phaser recomputes the collision edges round the cell.
   * @param {number} tx
   * @param {number} ty
   * @param {boolean} faces
   * @returns {void}
   */
  function paint(tx, ty, faces) {
    const kind = kindAt(tx, ty);
    const info = KIND[kind] || OWN_KIND;
    const below = ty + 1 < rows ? kindAt(tx, ty + 1) : '';
    layers.floor.putTileAt(slot(info.layer === 'floor' ? kind : 'floor'), tx, ty, faces);
    layers.decor.putTileAt(info.layer === 'decor' ? slot(kind) : -1, tx, ty, faces);
    layers.walls.putTileAt(solid(kind) ? slot(kind) : -1, tx, ty, faces);
    let over = -1;
    if (kind === 'tree') over = slot('canopy');
    else if (below === 'tree' && UNDER_CANOPY[kind]) over = slot('canopytop');
    layers.overhead.putTileAt(over, tx, ty, faces);
  }

  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) paint(tx, ty, false);
  layers.walls.calculateFacesWithin(0, 0, cols, rows);

  /** @type {Array<{ tx: number, ty: number, mark: string }>} */
  const objects = [];
  let spawn = null;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const kind = kindAt(tx, ty);
      if (KIND[kind] && KIND[kind].object) objects.push({ tx: tx, ty: ty, mark: marks[ty][tx] });
      if (kind === 'spawn' && !spawn) spawn = { tx: tx, ty: ty };
    }
  }

  return {
    map: map,
    layers: layers,
    order: order,
    blocking: [layers.walls],
    cols: cols,
    rows: rows,
    tileWidth: tile,
    tileHeight: tile,
    legend: legend,
    spawn: spawn,
    objects: objects,
    tileAt(tx, ty) {
      return inside(tx, ty) ? marks[ty][tx] : '';
    },
    kindAt(tx, ty) {
      return inside(tx, ty) ? kindAt(tx, ty) : '';
    },
    walkable(tx, ty) {
      return inside(tx, ty) && !solid(kindAt(tx, ty));
    },
    set(tx, ty, mark) {
      if (!inside(tx, ty)) return false;
      if (!legend[mark]) {
        warn('"' + mark + '" is not in the legend; set() left the cell alone.');
        return false;
      }
      marks[ty][tx] = mark;
      paint(tx, ty, true);
      if (ty > 0) paint(tx, ty - 1, true);
      return true;
    },
  };
}

/**
 * The Tiled road: the layers the file names, collision from a list or a property, marks from the
 * spec so the same handle answers.
 * @param {any} scene
 * @param {any} s
 * @returns {any} the parts tileWorld() assembles
 */
function buildTiled(scene, s) {
  const legend = Object.assign({}, DEFAULT_LEGEND, s.legend || {});
  const map = scene.make.tilemap({ key: s.tiled });
  const wanted = Array.isArray(s.tileset) ? s.tileset : (s.tileset ? [s.tileset] : []);
  /** @type {any[]} */
  const sets = [];
  for (const t of wanted) {
    const set = t && map.addTilesetImage(t.name, t.image);
    if (set) sets.push(set);
  }
  if (!sets.length) {
    warn('the Tiled map "' + s.tiled + '" has no tileset image. Pass tileset: { name, image }, '
      + 'the name from the Tiled file and the key of the image the pack loaded.');
  }
  /** @type {Record<string, string>} tile index → mark */
  const marks = s.marks || {};
  /** @type {Record<string, number>} mark → tile index */
  const reverse = {};
  for (const index in marks) reverse[String(marks[index])] = Number(index);
  const collidesList = Array.isArray(s.collides) ? s.collides : [];
  const overheadList = Array.isArray(s.overhead) ? s.overhead : ['overhead'];
  const cols = map.width;
  const rows = map.height;

  let last = FIRST_GID;
  for (const set of map.tilesets || []) {
    last = Math.max(last, (set.firstgid || FIRST_GID) + (set.total || 0) - 1);
  }

  /** @type {Record<string, any>} */
  const layers = {};
  /** @type {any[]} */
  const order = [];
  /** @type {any[]} */
  const blocking = [];
  let overheads = 0;
  const data = map.layers || [];
  for (let i = 0; i < data.length; i++) {
    const ld = data[i];
    const layer = map.createLayer(ld.name, sets, 0, 0);
    if (!layer) continue;
    const over = overheadList.indexOf(ld.name) >= 0 || property(ld.properties, 'overhead') === true;
    layer.setDepth(over ? OVERHEAD_DEPTH + overheads++ : GROUND_DEPTH + i);
    layers[ld.name] = layer;
    order.push(layer);
    const blocks = collidesList.indexOf(ld.name) >= 0 || property(ld.properties, 'collides') === true;
    if (blocks) layer.setCollisionBetween(FIRST_GID, last, true, false);
    else layer.setCollisionByProperty({ collides: true }, true, false);
    const found = layer.layer && Array.isArray(layer.layer.collideIndexes)
      && layer.layer.collideIndexes.length > 0;
    if (blocks || found) {
      layer.calculateFacesWithin(0, 0, cols, rows);
      blocking.push(layer);
    }
  }

  function inside(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < cols && ty < rows;
  }

  /** The highest layer holding a tile at the cell, with the tile. */
  function top(tx, ty) {
    for (let i = order.length - 1; i >= 0; i--) {
      const t = order[i].getTileAt(tx, ty);
      if (t && t.index > -1) return { tile: t, layer: order[i] };
    }
    return null;
  }

  function walkable(tx, ty) {
    if (!inside(tx, ty)) return false;
    for (const layer of blocking) {
      const t = layer.getTileAt(tx, ty);
      if (t && t.index > -1 && t.collides) return false;
    }
    return true;
  }

  /** The topmost marked tile's mark; without one, '#' where something blocks and '.' elsewhere. */
  function tileAt(tx, ty) {
    if (!inside(tx, ty)) return '';
    for (let i = order.length - 1; i >= 0; i--) {
      const t = order[i].getTileAt(tx, ty);
      if (t && t.index > -1 && marks[t.index] != null) return String(marks[t.index]);
    }
    return walkable(tx, ty) ? '.' : '#';
  }

  function kindAt(tx, ty) {
    const mark = tileAt(tx, ty);
    return mark ? legend[mark] || '' : '';
  }

  /** The layer set() writes when none is named: the topmost occupied one above the ground, else
   *  the highest layer that is not overhead, else the ground. */
  function target(tx, ty) {
    const t = top(tx, ty);
    if (t && order.indexOf(t.layer) > 0) return t.layer;
    for (let i = order.length - 1; i >= 0; i--) if (order[i].depth < OVERHEAD_DEPTH) return order[i];
    return order[0] || null;
  }

  /** @type {Array<{ tx: number, ty: number, mark: string }>} */
  const objects = [];
  let spawn = null;
  if (Object.keys(marks).length) {
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const mark = tileAt(tx, ty);
        const kind = legend[mark];
        if (KIND[kind] && KIND[kind].object) objects.push({ tx: tx, ty: ty, mark: mark });
        if (kind === 'spawn' && !spawn) spawn = { tx: tx, ty: ty };
      }
    }
  }

  return {
    map: map,
    layers: layers,
    order: order,
    blocking: blocking,
    cols: cols,
    rows: rows,
    tileWidth: map.tileWidth,
    tileHeight: map.tileHeight,
    legend: legend,
    spawn: spawn,
    objects: objects,
    tileAt: tileAt,
    kindAt: kindAt,
    walkable: walkable,
    set(tx, ty, mark, layerName) {
      if (!inside(tx, ty)) return false;
      let layer = layerName ? layers[layerName] : null;
      if (layerName && !layer) {
        warn('the Tiled map has no layer "' + layerName + '"; set() left the cell alone.');
        return false;
      }
      if (!layer) layer = target(tx, ty);
      if (!layer) return false;
      let index = -1;
      if (mark !== '.') {
        if (reverse[mark] == null) {
          warn('"' + mark + '" has no tile index in spec.marks; set() left the cell alone.');
          return false;
        }
        index = reverse[mark];
      }
      layer.putTileAt(index, tx, ty, true);
      return true;
    },
  };
}

/**
 * @typedef {object} TileWorldSpec
 * @property {string[]} [map]   ASCII rows, top to bottom, one character per cell
 * @property {Record<string, string>} [legend]  extra or replacement marks, mark → kind. The
 *   kinds are wall, floor, water, tree, door, chest, spawn, enemy, npc, bridge and grass; any
 *   other name is drawn as a block and blocks.
 * @property {number} [tile]    the tile side in pixels for an ASCII world. Default 32.
 * @property {string} [tiled]   the key of a Tiled JSON map preloadPack() loaded (a pack's
 *   tilemaps entry, or an aimeat-assets entry with format 'tiled'); used instead of map
 * @property {{ name: string, image: string }|Array<{ name: string, image: string }>} [tileset]
 *   for a Tiled map: the tileset's name inside the Tiled file, and the key of its image
 * @property {string[]} [collides]  Tiled layer names that block as a whole. A layer with a
 *   boolean property collides=true blocks too, and a tile with that property blocks on any layer.
 * @property {string[]} [overhead]  Tiled layer names drawn above the player. Default ['overhead'];
 *   a layer property overhead=true does the same.
 * @property {Record<number, string>} [marks]  for a Tiled map: tile index → legend mark, so at()
 *   answers with marks, 'P' places the player, and objects fires for E, N, C and D tiles
 * @property {'block'|'slow'} [water]  whether water blocks (the default) or lets the player
 *   through at waterSpeed: each frame the body's velocity is scaled while its centre is in water
 * @property {number} [waterSpeed]  the share of speed kept in slowing water. Default 0.5.
 * @property {any} [player]     a physics sprite; the world collides it with everything solid and
 *   the camera follows it. Absent, the world makes a round marker at the spawn.
 * @property {(x: number, y: number, mark: string, tileX: number, tileY: number) => void} [objects]
 *   called once per enemy, npc, chest and door cell, during the build, with the cell's centre in
 *   world pixels, so the app places its own things there
 * @property {'follow'|'fixed'} [camera]  'follow' (the default) keeps the player in view
 * @property {{ width?: number, height?: number }|false} [deadzone]  the box the player moves in
 *   before the camera follows. Default a quarter of the view each way; false for none.
 * @property {number} [lerp]    how quickly the camera catches up, 0..1. Default 0.1.
 * @property {boolean} [bounds] keep the physics world and the camera inside the map. Default true.
 * @property {number} [zoom]    the main camera's zoom
 * @property {any} [theme]      a theme handle to draw with. Default: read off the game's frame.
 */

/**
 * @typedef {object} TileWorldHandle
 * @property {any} map                      the Phaser tilemap
 * @property {Record<string, any>} layers   by name: floor, decor, walls and overhead for an ASCII
 *   world; the Tiled layer names otherwise
 * @property {any} player                   the sprite the world collides and the camera follows
 * @property {{ x: number, y: number, tx: number, ty: number }} spawn  where 'P' was, or the first
 *   walkable cell
 * @property {{ x: number, y: number, width: number, height: number, cols: number, rows: number,
 *   tileWidth: number, tileHeight: number }} bounds
 * @property {Record<string, string>} legend  the marks in force, mark → kind
 * @property {(x: number, y: number) => string} at        the mark at a world position, '' outside
 * @property {(tx: number, ty: number) => string} tileAt  the mark at a cell, '' outside
 * @property {(tx: number, ty: number, mark: string, layer?: string) => boolean} set  repaint a
 *   cell as another mark; its collision and the tree cap above follow. On a Tiled map the mark
 *   comes from spec.marks, '.' clears the topmost tile above the ground, and layer names the
 *   layer to write.
 * @property {(tx: number, ty: number) => boolean} walkable
 * @property {() => boolean[][]} grid   rows of walkability, grid[ty][tx]; the same array until
 *   set() changes the world, so read it rather than write into it
 * @property {(tx: number, ty: number) => { x: number, y: number }} toWorld  the cell's centre
 * @property {(x: number, y: number) => { x: number, y: number }} toTile
 * @property {() => void} destroy
 */

/**
 * Build a top-down world and hand back the questions a game asks of it.
 * @param {any} scene
 * @param {TileWorldSpec} spec
 * @returns {TileWorldHandle}
 */
export function tileWorld(scene, spec) {
  const s = spec || /** @type {TileWorldSpec} */ ({});
  const th = s.theme || look(scene);
  if (!s.tiled && !Array.isArray(s.map)) {
    warn('nothing to build from: pass map (ASCII rows) or tiled (a loaded map key). A one-cell '
      + 'floor stands in.');
  }
  const w = s.tiled ? buildTiled(scene, s) : buildAscii(scene, s, th);
  const tw = w.tileWidth;
  const tHeight = w.tileHeight;
  const pxW = w.cols * tw;
  const pxH = w.rows * tHeight;
  let gone = false;
  /** @type {boolean[][]|null} */
  let cache = null;

  function toWorld(tx, ty) {
    return { x: tx * tw + tw / 2, y: ty * tHeight + tHeight / 2 };
  }

  function toTile(x, y) {
    return { x: Math.floor(x / tw), y: Math.floor(y / tHeight) };
  }

  // The spawn: where 'P' was, else the first open cell reading the map like a page.
  let cell = w.spawn;
  if (!cell) {
    for (let ty = 0; ty < w.rows && !cell; ty++) {
      for (let tx = 0; tx < w.cols; tx++) {
        if (w.walkable(tx, ty)) { cell = { tx: tx, ty: ty }; break; }
      }
    }
  }
  if (!cell) cell = { tx: 0, ty: 0 };
  const start = toWorld(cell.tx, cell.ty);
  const spawn = { x: start.x, y: start.y, tx: cell.tx, ty: cell.ty };

  const physics = scene.physics && scene.physics.world ? scene.physics : null;
  if (s.bounds !== false && physics) physics.world.setBounds(0, 0, pxW, pxH);

  // The player: the app's, or a marker the world makes and owns.
  let player = s.player || null;
  let ownPlayer = false;
  if (!player && physics) {
    const key = marker(scene, Math.min(tw, tHeight), th);
    player = physics.add.sprite(spawn.x, spawn.y, key);
    player.setCollideWorldBounds(s.bounds !== false);
    if (player.body && typeof player.body.setSize === 'function') {
      player.body.setSize(tw * 0.6, tHeight * 0.6, true);
    }
    ownPlayer = true;
  }
  /** @type {any[]} */
  const colliders = [];
  if (player && physics) {
    for (const layer of w.blocking) colliders.push(physics.add.collider(player, layer));
  }

  // The camera: inside the world, following the player from a dead zone.
  const cam = scene.cameras && scene.cameras.main ? scene.cameras.main : null;
  let following = false;
  if (cam) {
    if (typeof s.zoom === 'number' && s.zoom > 0) cam.setZoom(s.zoom);
    if (s.camera !== 'fixed' && player) {
      if (s.bounds !== false) cam.setBounds(0, 0, pxW, pxH);
      const lerp = typeof s.lerp === 'number' ? s.lerp : FOLLOW_LERP;
      cam.startFollow(player, true, lerp, lerp);
      if (s.deadzone !== false) {
        const dz = s.deadzone || {};
        cam.setDeadzone(
          dz.width || Math.round(cam.width * DEADZONE_SHARE),
          dz.height || Math.round(cam.height * DEADZONE_SHARE),
        );
      }
      following = true;
    }
  }

  // Water that slows: the one standing hook, and only when it was asked for.
  let slow = null;
  if (s.water === 'slow' && player) {
    const keep = typeof s.waterSpeed === 'number' ? Math.max(0, Math.min(1, s.waterSpeed)) : WATER_SPEED;
    slow = function () {
      const body = player.body;
      if (!body || !body.velocity) return;
      const t = toTile(player.x, player.y);
      if (w.kindAt(t.x, t.y) !== 'water') return;
      body.velocity.x *= keep;
      body.velocity.y *= keep;
    };
    scene.events.on('postupdate', slow);
  }

  if (typeof s.objects === 'function') {
    for (const o of w.objects) {
      const p = toWorld(o.tx, o.ty);
      s.objects(p.x, p.y, o.mark, o.tx, o.ty);
    }
  }

  /** @type {TileWorldHandle} */
  const api = {
    map: w.map,
    layers: w.layers,
    player: player,
    spawn: spawn,
    bounds: {
      x: 0, y: 0, width: pxW, height: pxH,
      cols: w.cols, rows: w.rows, tileWidth: tw, tileHeight: tHeight,
    },
    legend: w.legend,

    at(x, y) {
      const t = toTile(x, y);
      return w.tileAt(t.x, t.y);
    },

    tileAt(tx, ty) {
      return w.tileAt(tx, ty);
    },

    set(tx, ty, mark, layerName) {
      if (gone) return false;
      const ok = w.set(tx, ty, mark, layerName);
      if (ok) cache = null;
      return ok;
    },

    walkable(tx, ty) {
      return w.walkable(tx, ty);
    },

    grid() {
      if (cache) return cache;
      /** @type {boolean[][]} */
      const rows = [];
      for (let ty = 0; ty < w.rows; ty++) {
        /** @type {boolean[]} */
        const row = [];
        for (let tx = 0; tx < w.cols; tx++) row.push(w.walkable(tx, ty));
        rows.push(row);
      }
      cache = rows;
      return rows;
    },

    toWorld: toWorld,
    toTile: toTile,

    destroy() {
      if (gone) return;
      gone = true;
      scene.events.off('shutdown', api.destroy);
      if (slow) scene.events.off('postupdate', slow);
      if (cam && following && typeof cam.stopFollow === 'function') cam.stopFollow();
      const world = scene.physics && scene.physics.world;
      if (world && typeof world.removeCollider === 'function') {
        for (const c of colliders) world.removeCollider(c);
      }
      colliders.length = 0;
      // On a scene shutdown Phaser has already taken the layers and the sprite off the display
      // list; each of these is a no-op then, and the map itself is not a game object, so it is
      // ours to release either way.
      for (const layer of w.order) if (layer && typeof layer.destroy === 'function') layer.destroy();
      if (w.map && typeof w.map.destroy === 'function') w.map.destroy();
      if (ownPlayer && player && typeof player.destroy === 'function') player.destroy();
      cache = null;
    },
  };

  scene.events.once('shutdown', api.destroy);
  return api;
}
