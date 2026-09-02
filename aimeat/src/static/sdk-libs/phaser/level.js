/**
 * @file phaser/level.js
 * @description The level department: an ASCII map becomes a playable arcade-physics platformer.
 *
 *   THE MAP IS THE LEVEL FORMAT. Twelve lines of text in a source file is a level a person can
 *   read, diff and edit without a tool, which is why the legend is open: the seven default marks
 *   cover a platformer, and any extra entry an app names becomes a solid tile of its own kind.
 *   parseMap() is pure, so a level can be checked, generated or shipped as data long before a
 *   scene exists.
 *
 *   IT RUNS WITH NO ART. Every texture name defaults to what assets.tiles() and assets.character()
 *   produce, and when one is missing the module draws a plain rectangle from the theme tokens on
 *   the spot. So a level built five minutes into a project already plays, and adding real art
 *   later changes nothing but the look.
 *
 *   DEATH IS THE APP'S TO OWN. 'die' fires first; a listener that returns true has handled it and
 *   the module stands down. Otherwise the camera fades, the player returns to the spawn and play
 *   resumes, because a game that only reports the death and then sits there is not finished.
 * @structure parseMap(rows, legend) → level data · platformer(scene, spec) → handle ·
 *   drawParallax (internal); the theme bridge is ./tokens.js
 * @usage  const level = AIMEAT.phaser.platformer(this, { map: ROWS, controls: pad, camera: 'follow' });
 *         level.on('coin', (n) => hud.set({ score: n }));
 *         // in scene.update(): level.update();
 * @version-history
 *   v1.1.0 — 2026-09-02 — parallaxBackdrop takes a preset name or a parallax() spec (true keeps the
 *     drawn blocks every level so far already has), and spec.player takes an actor handle from
 *     sprites.js: the actor then animates and moves itself off the same controls state.
 *   v1.0.1 — 2026-09-02 — destroy() on a scene shutdown no longer clears groups Phaser has already
 *     emptied (a restart threw inside Phaser's Group.clear).
 *   v1.0.0 — 2026-09-02 — Initial (wish-phaser4-design-book-page).
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, channels } from './tokens.js';
import { parallax } from './parallax.js';

/** The marks every AIMEAT platformer understands without saying so. */
const DEFAULT_LEGEND = {
  '#': 'ground',
  '=': 'brick',
  '^': 'spike',
  o: 'coin',
  E: 'enemy',
  P: 'spawn',
  G: 'goal',
};

/** Marks that mean "nothing here". */
const BLANK = { '.': true, ' ': true, '': true };

/** The kinds that are actors or hazards rather than floor, so everything else is something to
 *  stand on. An app's own legend entry is solid by default, which is the useful assumption. */
const NOT_SOLID = { coin: true, enemy: true, spawn: true, goal: true, spike: true };

/** Which theme colour a missing texture is drawn in. */
const TINT_ROLE = {
  ground: 'line', brick: 'inkDim', spike: 'err', coin: 'warn',
  goal: 'ok', enemy: 'accent', player: 'accent',
};

/** The texture names assets.tiles() and assets.character() produce. */
const DEFAULT_TEXTURES = {
  ground: 'tile-ground', brick: 'tile-brick', spike: 'tile-spike', coin: 'tile-coin',
  goal: 'tile-goal', enemy: 'tile-enemy', player: 'hero',
};

/** How fast an enemy walks, as a share of the player's speed. */
const ENEMY_SHARE = 0.42;

/**
 * Read an ASCII map into level data. Coordinates are GRID cells, not pixels: column and row,
 * both counted from zero, so the same data drives any tile size.
 *
 * @param {string[]} rows  one string per row, top to bottom
 * @param {Record<string, string>} [legend]  extra or replacement marks, mark → kind
 * @returns {{
 *   width: number, height: number,
 *   tiles: Array<{ x: number, y: number, kind: string }>,
 *   spawn: { x: number, y: number }|null,
 *   coins: Array<{ x: number, y: number }>,
 *   enemies: Array<{ x: number, y: number }>,
 *   goal: { x: number, y: number }|null,
 *   spikes: Array<{ x: number, y: number }>,
 * }}
 */
export function parseMap(rows, legend) {
  const lines = Array.isArray(rows) ? rows : [];
  const marks = Object.assign({}, DEFAULT_LEGEND, legend || {});
  /** @type {Array<{ x: number, y: number, kind: string }>} */
  const tiles = [];
  /** @type {Array<{ x: number, y: number }>} */
  const coins = [];
  /** @type {Array<{ x: number, y: number }>} */
  const enemies = [];
  /** @type {Array<{ x: number, y: number }>} */
  const spikes = [];
  let spawn = null;
  let goal = null;
  let width = 0;

  for (let y = 0; y < lines.length; y += 1) {
    const line = String(lines[y] == null ? '' : lines[y]);
    if (line.length > width) width = line.length;
    for (let x = 0; x < line.length; x += 1) {
      const mark = line.charAt(x);
      if (BLANK[mark]) continue;
      const kind = marks[mark];
      if (!kind) continue;
      // Every non-empty cell lands in `tiles` with its kind, so an app's own legend entry is
      // reachable; the named lists below are the views the platformer builds from.
      tiles.push({ x: x, y: y, kind: kind });
      if (kind === 'coin') coins.push({ x: x, y: y });
      else if (kind === 'enemy') enemies.push({ x: x, y: y });
      else if (kind === 'spike') spikes.push({ x: x, y: y });
      else if (kind === 'spawn') spawn = { x: x, y: y };
      else if (kind === 'goal') goal = { x: x, y: y };
    }
  }

  return {
    width: width,
    height: lines.length,
    tiles: tiles,
    spawn: spawn,
    coins: coins,
    enemies: enemies,
    goal: goal,
    spikes: spikes,
  };
}

/**
 * Make sure a texture exists, drawing a plain rectangle from the theme when it does not. This is
 * what lets a level play before anyone has made art for it.
 * @param {any} scene
 * @param {string} key
 * @param {string} kind
 * @param {number} size
 * @param {any} th
 * @returns {string} the key that now exists
 */
function ensureTexture(scene, key, kind, size, th) {
  if (scene.textures.exists(key)) return key;
  const colour = th[TINT_ROLE[kind] || 'ink'];
  const g = scene.add.graphics();
  g.fillStyle(colour, 1);
  if (kind === 'coin') g.fillCircle(size / 2, size / 2, Math.max(3, size * 0.3));
  else if (kind === 'spike') g.fillTriangle(0, size, size / 2, size * 0.2, size, size);
  else g.fillRect(0, 0, size, size);
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
}

/**
 * Build a platformer out of an ASCII map: tiles, coins, enemies, spikes, a goal and a player who
 * runs on the controls state.
 *
 * @param {any} scene
 * @param {{
 *   map: string[], legend?: Record<string, string>, tile?: number,
 *   textures?: Partial<Record<'ground'|'brick'|'spike'|'coin'|'goal'|'enemy'|'player', string>>,
 *   gravity?: number,
 *   player?: { speed?: number, jump?: number, doubleJump?: boolean } | any,
 *   controls?: any, camera?: 'follow'|'fixed', bounds?: boolean,
 *   parallaxBackdrop?: boolean|string|object,
 * }} spec  player also takes an actor handle from sprites.js (recognised by its .sprite);
 *   parallaxBackdrop takes a parallax() preset name or spec, and true keeps the drawn blocks
 * @returns {{
 *   player: any,
 *   groups: { ground: any, coins: any, enemies: any, spikes: any, goal: any },
 *   map: any,
 *   backdrop: any,
 *   on: (event: string, fn: (value?: any) => any) => () => void,
 *   update: () => void, reset: () => void, destroy: () => void,
 * }}
 */
export function platformer(scene, spec) {
  const s = spec || /** @type {any} */ ({});
  const th = look(scene);
  const still = reducedMotion();
  const tile = s.tile || 32;
  const map = parseMap(s.map || [], s.legend);
  const tex = Object.assign({}, DEFAULT_TEXTURES, s.textures || {});
  // An actor handle (sprites.js) is recognised by its sprite; its `move` has the options' shape.
  const given = s.player && s.player.sprite ? s.player : null;
  const move = Object.assign({ speed: 220, jump: 420, doubleJump: false }, given ? given.move : (s.player || {}));
  const pxW = Math.max(tile, map.width * tile);
  const pxH = Math.max(tile, map.height * tile);
  const fadeMs = 180;

  /** Grid cells something solid stands in, for the ledge check an enemy does before it walks. */
  const solidCells = new Set();
  for (const t of map.tiles) if (!NOT_SOLID[t.kind]) solidCells.add(t.x + ',' + t.y);

  /** @type {Record<string, Array<(value?: any) => any>>} */
  const handlers = { coin: [], die: [], goal: [], land: [] };
  let coinCount = 0;
  let dead = false;
  let finished = false;
  let wasDown = false;
  let jumpHeld = false;
  let airJumps = 0;
  let gone = false;

  scene.physics.world.gravity.y = s.gravity != null ? s.gravity : 900;
  if (s.bounds !== false) scene.physics.world.setBounds(0, 0, pxW, pxH);
  // true keeps the two drawn blocks every level published so far already has. A preset name or
  // a spec goes straight to parallax(), which fits the camera rather than the world.
  /** @type {any} */
  let backdrop = null;
  if (s.parallaxBackdrop === true) drawParallax(scene, th, pxW, pxH);
  else if (s.parallaxBackdrop) backdrop = parallax(scene, s.parallaxBackdrop);

  // ── The world ────────────────────────────────────────────────────────────────────────────────
  const ground = scene.physics.add.staticGroup();
  for (const t of map.tiles) {
    if (NOT_SOLID[t.kind]) continue;
    const key = ensureTexture(scene, tex[t.kind] || 'tile-' + t.kind, t.kind, tile, th);
    const block = ground.create(t.x * tile + tile / 2, t.y * tile + tile / 2, key);
    block.setDisplaySize(tile, tile);
    block.refreshBody();
  }

  const coins = scene.physics.add.staticGroup();
  const spikes = scene.physics.add.staticGroup();
  const goal = scene.physics.add.staticGroup();
  const enemies = scene.physics.add.group();

  const playerKey = given ? given.key : ensureTexture(scene, tex.player, 'player', tile, th);
  const start = map.spawn || { x: 1, y: Math.max(0, map.height - 2) };
  const player = given ? given.sprite : scene.physics.add.sprite(start.x * tile + tile / 2, start.y * tile + tile / 2, playerKey);
  if (given) {
    player.setPosition(start.x * tile + tile / 2, start.y * tile + tile / 2);
  } else {
    player.setBounce(0.04);
    player.setCollideWorldBounds(s.bounds !== false);
  }

  scene.physics.add.collider(player, ground);
  scene.physics.add.collider(enemies, ground);
  scene.physics.add.overlap(player, coins, takeCoin, undefined, null);
  scene.physics.add.overlap(player, spikes, kill, undefined, null);
  scene.physics.add.overlap(player, enemies, kill, undefined, null);
  scene.physics.add.overlap(player, goal, reachGoal, undefined, null);

  if (s.camera !== 'fixed') {
    scene.cameras.main.startFollow(player, true, 0.12, 0.12);
    if (s.bounds !== false) scene.cameras.main.setBounds(0, 0, pxW, pxH);
  }

  populate();

  /** Put the collectables, hazards, enemies and the goal on the map. Also the whole of reset(). */
  function populate() {
    coins.clear(true, true);
    spikes.clear(true, true);
    goal.clear(true, true);
    enemies.clear(true, true);

    for (const c of map.coins) {
      const key = ensureTexture(scene, tex.coin, 'coin', tile, th);
      const coin = coins.create(c.x * tile + tile / 2, c.y * tile + tile / 2, key);
      coin.setDisplaySize(tile * 0.6, tile * 0.6);
      coin.refreshBody();
    }
    for (const sp of map.spikes) {
      const key = ensureTexture(scene, tex.spike, 'spike', tile, th);
      const spike = spikes.create(sp.x * tile + tile / 2, sp.y * tile + tile * 0.72, key);
      spike.setDisplaySize(tile, tile * 0.55);
      spike.refreshBody();
    }
    if (map.goal) {
      const key = ensureTexture(scene, tex.goal, 'goal', tile, th);
      const flag = goal.create(map.goal.x * tile + tile / 2, map.goal.y * tile + tile / 2, key);
      flag.setDisplaySize(tile * 0.8, tile);
      flag.refreshBody();
    }
    for (const e of map.enemies) {
      const key = ensureTexture(scene, tex.enemy, 'enemy', tile, th);
      const foe = enemies.create(e.x * tile + tile / 2, e.y * tile + tile / 2, key);
      foe.setDisplaySize(tile * 0.9, tile * 0.9);
      foe.setBounce(0, 0);
      foe.setCollideWorldBounds(s.bounds !== false);
      foe.setData('dir', 1);
      foe.setVelocityX(move.speed * ENEMY_SHARE);
    }
  }

  /**
   * @param {string} event
   * @param {any} [value]
   * @returns {boolean} whether a listener said it had handled this
   */
  function emit(event, value) {
    const list = handlers[event];
    if (!list) return false;
    let handled = false;
    for (const fn of list.slice()) if (fn(value) === true) handled = true;
    return handled;
  }

  /**
   * @param {any} _who
   * @param {any} coin
   * @returns {void}
   */
  function takeCoin(_who, coin) {
    if (!coin.active) return;
    coin.disableBody(true, false);
    coinCount += 1;
    emit('coin', coinCount);
    if (still) { coin.destroy(); return; }
    scene.tweens.add({
      targets: coin, y: coin.y - tile * 0.6, alpha: 0, scaleX: 1.4, scaleY: 1.4,
      duration: 220, ease: 'Sine.easeOut', onComplete: function () { coin.destroy(); },
    });
  }

  /** A spike or an enemy touched the player. @returns {void} */
  function kill() {
    if (dead || finished) return;
    dead = true;
    if (emit('die')) { dead = false; return; }
    // An actor plays its death clip first, then stands on the spawn again.
    if (given) {
      given.die(function () { placePlayer(); given.reset(); dead = false; });
      return;
    }
    player.setVelocity(0, 0);
    const c = channels(th.bg);
    const cam = scene.cameras.main;
    cam.fadeOut(fadeMs, c.r, c.g, c.b, function (_camera, progress) {
      if (progress < 1) return;
      placePlayer();
      cam.fadeIn(fadeMs, c.r, c.g, c.b);
      dead = false;
    });
  }

  /** The goal was reached, once. @returns {void} */
  function reachGoal() {
    if (finished || dead) return;
    finished = true;
    emit('goal');
  }

  /** Put the player back where the map says they start. @returns {void} */
  function placePlayer() {
    player.setVelocity(0, 0);
    player.setPosition(start.x * tile + tile / 2, start.y * tile + tile / 2);
    airJumps = 0;
  }

  /**
   * Would an enemy walk off the edge with its next step? The map answers, so no probe sprite and
   * no second physics body is needed.
   * @param {any} foe
   * @param {number} dir
   * @returns {boolean}
   */
  function atLedge(foe, dir) {
    const gx = Math.floor((foe.x + dir * tile * 0.55) / tile);
    const gy = Math.floor((foe.y + tile * 0.6) / tile);
    return !solidCells.has(gx + ',' + gy);
  }

  /** The animation the player's state asks for, when the sheet carries it. @returns {void} */
  function animate(vx, onGround) {
    const anims = scene.anims;
    if (!anims || typeof anims.exists !== 'function') return;
    const want = !onGround ? tex.player + '-jump' : (vx !== 0 ? tex.player + '-run' : tex.player + '-idle');
    if (anims.exists(want)) player.play(want, true);
  }

  const api = {
    player: player,
    groups: { ground: ground, coins: coins, enemies: enemies, spikes: spikes, goal: goal },
    map: map,
    backdrop: backdrop,

    /**
     * Listen for 'coin' (the running count), 'die', 'goal' or 'land'. A 'die' listener that
     * returns true has handled the death and the built-in respawn stands down.
     * @param {string} event
     * @param {(value?: any) => any} fn
     * @returns {() => void} stop listening
     */
    on(event, fn) {
      const list = handlers[event] || (handlers[event] = []);
      list.push(fn);
      return function off() {
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
      };
    },

    /** Call from the scene's own update(). @returns {void} */
    update() {
      if (gone) return;
      const body = player.body;
      const onGround = !!(body && body.blocked.down);
      if (onGround && !wasDown) emit('land');
      if (onGround) airJumps = 0;
      wasDown = onGround;

      patrol();
      if (dead || finished) { if (!given) animate(0, onGround); return; }
      // An actor reads the same controls state and animates itself; the block below is the
      // drawn player's.
      if (given) { given.update(s.controls); return; }

      const c = s.controls;
      const left = !!(c && c.left);
      const right = !!(c && c.right);
      const wantJump = !!(c && c.jump);
      const vx = left === right ? 0 : (left ? -move.speed : move.speed);
      player.setVelocityX(vx);
      if (vx !== 0) player.setFlipX(vx < 0);

      if (wantJump && !jumpHeld) {
        if (onGround) player.setVelocityY(-move.jump);
        else if (move.doubleJump && airJumps < 1) { player.setVelocityY(-move.jump * 0.86); airJumps += 1; }
      }
      jumpHeld = wantJump;
      animate(vx, onGround);
    },

    /** Back to the start: the map repopulated, the count at zero, the player on the spawn. */
    reset() {
      coinCount = 0;
      dead = false;
      finished = false;
      airJumps = 0;
      populate();
      placePlayer();
    },

    destroy() {
      if (gone) return;
      gone = true;
      scene.events.off('shutdown', api.destroy);
      for (const key in handlers) handlers[key].length = 0;
      scene.tweens.killTweensOf(player);
      // On a scene shutdown Phaser has already emptied the groups when this runs, and clear() on
      // an emptied group throws inside Phaser; an explicit destroy() mid-play still has them.
      [coins, spikes, goal, enemies, ground].forEach(function (group) {
        if (group && group.children) group.clear(true, true);
      });
      if (backdrop) { backdrop.destroy(); backdrop = null; }
      // An actor owns its sprite and destroys it on shutdown itself.
      if (!given) player.destroy();
    },
  };

  /** Enemies walk until a wall or a ledge turns them round. @returns {void} */
  function patrol() {
    const list = enemies.getChildren ? enemies.getChildren() : [];
    for (const foe of list) {
      if (!foe.active || !foe.body) continue;
      let dir = foe.getData('dir') || 1;
      const hitWall = dir < 0 ? foe.body.blocked.left : foe.body.blocked.right;
      if (hitWall || (foe.body.blocked.down && atLedge(foe, dir))) {
        dir = -dir;
        foe.setData('dir', dir);
      }
      foe.setVelocityX(move.speed * ENEMY_SHARE * dir);
      foe.setFlipX(dir < 0);
    }
  }

  scene.events.once('shutdown', api.destroy);
  return api;
}

/**
 * Two drawn layers behind the level, moving with the camera at different rates. Shapes only, and
 * both colours off the theme, so a backdrop costs no art and matches the app around it.
 * @param {any} scene
 * @param {any} th
 * @param {number} pxW
 * @param {number} pxH
 * @returns {void}
 */
function drawParallax(scene, th, pxW, pxH) {
  const far = scene.add.graphics();
  far.setScrollFactor(0.25).setDepth(-30).fillStyle(th.line, 0.55);
  const step = Math.max(90, Math.round(pxW / 14));
  for (let x = 0; x < pxW; x += step) {
    const h = pxH * (0.22 + ((x / step) % 3) * 0.06);
    far.fillRect(x, pxH - h, step * 0.92, h);
  }

  const near = scene.add.graphics();
  near.setScrollFactor(0.5).setDepth(-20).fillStyle(th.inkDim, 0.28);
  const step2 = Math.max(60, Math.round(pxW / 22));
  for (let x = -step2; x < pxW; x += step2) {
    const h = pxH * (0.12 + ((x / step2) % 4) * 0.035);
    near.fillRect(x, pxH - h, step2 * 0.86, h);
  }
}
