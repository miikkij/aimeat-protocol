/**
 * @file phaser/tileworld-minimap.js
 * @description The small map in the corner: the whole world drawn once from the tile grid into
 *   one texture at scroll factor zero, with the player as a dot that is moved each frame.
 *
 *   A PICTURE, NOT A CAMERA. A second camera would render every tile again every frame, and a
 *   200 by 200 world drawn cell by cell into a Graphics object would replay forty thousand
 *   commands a frame. So the grid is painted once into a texture and shown as one image, and the
 *   only per-frame work is moving the dot. The picture changes only when refresh() is asked for,
 *   which is what an app does after set() has changed the world.
 *
 *   IT RIDES THE MAIN CAMERA, LIKE THE HUD. A scroll-factor-zero object still takes the camera's
 *   zoom, so the corner is worked out in the camera's own terms and the image is scaled back by
 *   the zoom: the map stays the size that was asked for whatever the world is zoomed to.
 *
 *   LESS MOTION CHANGES NOTHING HERE. The map is still, and the dot is placed rather than tweened.
 * @structure MINIMAP_DEPTH · minimap(scene, world, opts) → { image, dot, refresh, toggle, destroy }
 * @usage
 *   const mini = AIMEAT.phaser.minimap(this, world, { corner: 'tr', size: 140, marks: ['E', 'C'] });
 *   world.set(tx, ty, '.'); mini.refresh();
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the one-texture overview, the corner placement under zoom,
 *     the marks and the player dot.
 */
import { look } from './tokens.js';
import { minimapTone, markTone } from './tileworld-tiles.js';

/** Above the HUD's plate (900) and under its toast (950), so a message still reads over the map. */
export const MINIMAP_DEPTH = 940;

/** How many minimaps this page has made, so each one's texture key is its own. */
let made = 0;

/**
 * @typedef {object} MinimapOptions
 * @property {'tl'|'tr'|'bl'|'br'} [corner]  Default 'tr'.
 * @property {number} [size]        the longer side in pixels. Default 140.
 * @property {number} [scale]       pixels per tile; overrides size when given
 * @property {boolean} [showPlayer] Default true.
 * @property {string[]} [marks]     legend marks drawn as dots, for example ['E', 'C']. Default none.
 * @property {number} [pad]         distance from the edges of the view. Default 10.
 * @property {number} [depth]       Default MINIMAP_DEPTH.
 * @property {any} [theme]          a theme handle to draw with. Default: read off the game's frame.
 */

/**
 * @typedef {object} MinimapHandle
 * @property {any} image                          the picture
 * @property {any} dot                            the player's dot
 * @property {() => void} refresh                 redraw the picture from the world as it is now
 * @property {(on?: boolean) => boolean} toggle   show or hide; returns whether it now shows
 * @property {() => void} destroy
 */

/**
 * The overview of one world, in a corner of the view.
 * @param {any} scene
 * @param {import('./tileworld.js').TileWorldHandle} world
 * @param {MinimapOptions} [opts]
 * @returns {MinimapHandle}
 */
export function minimap(scene, world, opts) {
  const o = opts || /** @type {MinimapOptions} */ ({});
  const th = o.theme || look(scene);
  const b = world.bounds;
  const cols = Math.max(1, b.cols);
  const rows = Math.max(1, b.rows);
  const size = Math.max(1, typeof o.size === 'number' ? o.size : 140);
  const cell = typeof o.scale === 'number' && o.scale > 0 ? o.scale : size / Math.max(cols, rows);
  const w = Math.ceil(cols * cell);
  const h = Math.ceil(rows * cell);
  const pad = typeof o.pad === 'number' ? o.pad : 10;
  const depth = typeof o.depth === 'number' ? o.depth : MINIMAP_DEPTH;
  const corner = o.corner || 'tr';
  const marks = Array.isArray(o.marks) ? o.marks : [];
  const showPlayer = o.showPlayer !== false;
  const id = ++made;
  let version = 0;
  let key = '';
  let gone = false;
  /** Where the picture's top-left sits, in the camera's own coordinates. */
  const origin = { x: 0, y: 0 };

  /** The main camera's zoom, which a scroll-factor-zero object still takes. */
  function zoom() {
    const cam = scene.cameras && scene.cameras.main;
    return cam && cam.zoom > 0 ? cam.zoom : 1;
  }

  /**
   * Paint the world into a fresh texture and answer its key. Walkable ground is one fill, so
   * only the cells that differ from it cost a command.
   * @returns {string}
   */
  function draw() {
    version += 1;
    const next = 'ak-minimap-' + id + '-' + version;
    const g = scene.make.graphics({ add: false });
    const box = Math.ceil(cell);
    /** @type {Array<{ tx: number, ty: number, kind: string }>} */
    const dots = [];
    g.fillStyle(th.surface, 0.92).fillRect(0, 0, w + 2, h + 2);
    g.fillStyle(th.line, 1).fillRect(1, 1, w, h);
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const mark = world.tileAt(tx, ty);
        const kind = world.legend[mark] || '';
        if (marks.indexOf(mark) >= 0) dots.push({ tx: tx, ty: ty, kind: kind });
        const tone = minimapTone(th, kind, !world.walkable(tx, ty));
        if (tone === th.line) continue;
        g.fillStyle(tone, 1).fillRect(1 + tx * cell, 1 + ty * cell, box, box);
      }
    }
    const r = Math.max(1.5, cell * 0.6);
    for (const d of dots) {
      g.fillStyle(markTone(th, d.kind), 1).fillCircle(1 + (d.tx + 0.5) * cell, 1 + (d.ty + 0.5) * cell, r);
    }
    g.lineStyle(1, th.line, 1).strokeRect(0.5, 0.5, w + 1, h + 1);
    g.generateTexture(next, w + 2, h + 2);
    g.destroy();
    return next;
  }

  key = draw();
  const image = scene.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
  const dot = scene.add.graphics().setScrollFactor(0).setDepth(depth + 1);
  const radius = Math.max(2, cell * 0.8);
  dot.fillStyle(th.ink, 1).fillCircle(0, 0, radius + 1);
  dot.fillStyle(th.accent, 1).fillCircle(0, 0, radius);
  dot.setVisible(showPlayer);

  /**
   * Put the picture in its corner. Under zoom z a scroll-factor-zero object lands on the screen at
   * (x - view / 2) * z + view / 2, so the corner is solved for x and the image scaled by 1 / z.
   * @returns {void}
   */
  function place() {
    const z = zoom();
    const vw = scene.scale.width;
    const vh = scene.scale.height;
    const sx = corner.indexOf('r') >= 0 ? vw - pad - (w + 2) : pad;
    const sy = corner.indexOf('b') >= 0 ? vh - pad - (h + 2) : pad;
    origin.x = vw / 2 + (sx - vw / 2) / z;
    origin.y = vh / 2 + (sy - vh / 2) / z;
    image.setPosition(origin.x, origin.y).setScale(1 / z);
  }

  /** The dot to where the player is: set, never tweened. @returns {void} */
  function follow() {
    if (gone || !dot.visible) return;
    const p = world.player;
    if (!p) return;
    const z = zoom();
    dot.setPosition(
      origin.x + (1 + (p.x / b.tileWidth) * cell) / z,
      origin.y + (1 + (p.y / b.tileHeight) * cell) / z,
    ).setScale(1 / z);
  }

  place();
  follow();
  scene.events.on('postupdate', follow);

  const api = {
    image: image,
    dot: dot,

    refresh() {
      if (gone) return;
      const old = key;
      key = draw();
      image.setTexture(key);
      place();
      follow();
      if (old !== key && scene.textures.exists(old)) scene.textures.remove(old);
    },

    toggle(on) {
      if (gone) return false;
      const show = typeof on === 'boolean' ? on : !image.visible;
      image.setVisible(show);
      dot.setVisible(show && showPlayer);
      return show;
    },

    destroy() {
      if (gone) return;
      gone = true;
      scene.events.off('postupdate', follow);
      scene.events.off('shutdown', api.destroy);
      image.destroy();
      dot.destroy();
      if (scene.textures && scene.textures.exists(key)) scene.textures.remove(key);
    },
  };

  scene.events.once('shutdown', api.destroy);
  return api;
}
