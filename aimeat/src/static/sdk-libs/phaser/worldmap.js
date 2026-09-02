/**
 * @file phaser/worldmap.js
 * @description The overworld: the level-select map a player walks across between levels, in the
 *   Super Mario World shape and on the theme's colours with no art at all. An app places the
 *   nodes (levels, towns, bosses, secrets) and the paths between them; this module draws them,
 *   reads which are open from the game's save store, and puts a walker on the map that MOVES
 *   ALONG THE PATHS from node to node, so reaching a level is a journey and not a list.
 *
 *   THE STORE IS THE TRUTH ABOUT WHAT IS OPEN. Given a saves() store, unlocks, stars and best
 *   scores are read from store.levels, and every change the store reports is repainted here, so
 *   a level won anywhere in the game opens the next node on the map with no wiring. Without a
 *   store, spec.unlocked / spec.stars / spec.best carry the same facts and the handle's setters
 *   move them.
 *
 *   A PATH IS OPEN WHEN THE NODE AT ITS FAR END IS OPEN. That is the whole traversal rule: the
 *   walker steps along a path only to an unlocked node, a click on a reachable node walks the
 *   route there hop by hop, and a locked node answers with a shake instead of a move.
 *
 *   EVERY MOTION IS FINITE. A walk is one tween per hop, timed by the path's length; the pulse on
 *   the node just reached is one ring that grows once; the fog lifts in one tween and the haze is
 *   gone. Under less motion the walker hops in place, the fog clears at once and the current node
 *   keeps its resting ring. An idle map animates nothing.
 *
 *   KEYBOARD, PAD AND POINTER ARE EQUAL. left/right/up/down, from a controls state or straight
 *   from the keyboard, pick the neighbour along a path in that direction; jump, action or Enter
 *   picks the node the walker stands on; a click on a node walks there, or picks it when it is
 *   the current one.
 * @structure worldMap(scene, spec) → handle · worldMapScene(spec) → scene config. The graph
 *   (edges, directions, routes, the map's size) is ./worldmap-graph.js and the shapes are
 *   ./worldmap-draw.js.
 * @usage
 *   const map = AIMEAT.phaser.worldMap(this, { nodes, paths, store, controls: pad, camera: 'follow' });
 *   map.on('pick', (node) => this.scene.start(node.scene));
 *   // or the whole screen in one line of the scenes array:
 *   AIMEAT.phaser.worldMapScene({ key: 'map', nodes, paths, store, controls: true, fog: true })
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: nodes by kind, dotted or dashed paths with bezier control
 *     points, the walker that travels the paths, stars and bests from a saves() store, fog of
 *     war beyond the frontier, regions, a following camera and worldMapScene().
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, ms, curve } from './tokens.js';
import { transition } from './menus.js';
import { controls } from './controls.js';
import { DIRS, DIR_PROBE, buildGraph, along, neighbourToward, routeTo, mapSize } from './worldmap-graph.js';
import {
  pathLength, drawRegions, drawPaths, buildNode, paintNode, buildWalker, buildHaze, pulseAt,
} from './worldmap-draw.js';

/** How far the walker travels each second, and the bounds one hop's duration is held to. */
const WALK_SPEED = 240;
const HOP_MIN = 140;
const HOP_MAX = 2400;

/** The walker's bob while it walks: this far up, this long each way. */
const BOB_PX = 4;
const BOB_MS = 120;

/** How far the walker jolts when a locked node refuses it. */
const SHAKE_PX = 8;

/** A closed node's alpha. */
const DIM = 0.6;

/**
 * @typedef {object} MapNode
 * @property {string|number} id
 * @property {number} x
 * @property {number} y
 * @property {string} [label]        default: the id
 * @property {'level'|'town'|'boss'|'secret'} [kind]  default 'level'
 * @property {string} [scene]        the scene a pick starts (worldMapScene does the starting)
 * @property {(node: MapNode) => void} [onPick]
 * @property {boolean} [unlocked]    always open whatever the store says: the first level, a town
 * @property {any} [data]            what node.scene receives on start. Default { node: id }
 */

/**
 * @typedef {object} MapPath
 * @property {string|number} from
 * @property {string|number} to
 * @property {Array<{ x: number, y: number }>} [control]  one point bends the path, two make an S
 * @property {'dotted'|'dashed'} [style]
 */

/**
 * @typedef {object} MapRegion
 * @property {string} [label]   the caption: 'World 1'
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {'accent'|'ok'|'warn'|'err'|'ch1'|'ch2'|'ch3'|'ch4'|'line'|number} [tone]
 */

/**
 * @typedef {object} WorldMapSpec
 * @property {MapNode[]} nodes
 * @property {Array<MapPath|Array<string|number>>} [paths]  a pair [from, to] or a MapPath
 * @property {any} [store]           a saves() store: unlocks, stars and bests are read from it
 * @property {Array<string|number>|Record<string, boolean>} [unlocked]  without a store
 * @property {Record<string, number>} [stars]   without a store
 * @property {Record<string, number>} [best]    without a store
 * @property {string|number} [current]  where the walker starts. Default: the first open node
 * @property {any} [controls]        a controls state; without one the keyboard is read directly
 * @property {any} [walker]          an existing sprite to move instead of the drawn token
 * @property {'follow'|'fixed'} [camera]  'follow' keeps the walker in view inside the map's size
 * @property {number} [width]        the map's own size. Default: past the farthest node
 * @property {number} [height]
 * @property {(scene: any) => void} [backdrop]  called before the map is drawn, for a parallax
 * @property {MapRegion[]} [regions]
 * @property {boolean} [fog]         hide nodes beyond the open ones and their neighbours
 * @property {'dotted'|'dashed'} [pathStyle]  default 'dotted'
 * @property {number} [speed]        walker pixels per second. Default 240
 * @property {number} [depth]        the map container's depth
 */

/**
 * @typedef {object} WorldMapHandle
 * @property {any} el       the container the map lives in
 * @property {any} walker   the marker on the map
 * @property {(event: 'arrive'|'pick'|'move'|'refuse', fn: (value?: any) => void) => (() => void)} on
 *   'arrive' (node) when the walker reaches the node it set out for; 'pick' (node) when the
 *   current node is chosen; 'move' ({ from, to }) when a walk starts; 'refuse' (node) when a
 *   locked node was asked for
 * @property {(id: string|number, opts?: { instant?: boolean }) => Promise<boolean>} goTo
 *   walk the route to an open node, or jump there with instant; false when there is no way
 * @property {() => string|number|null} current  the id the walker stands on
 * @property {() => void} refresh   re-read the store or the maps and repaint
 * @property {(id: string|number, on?: boolean) => void} setUnlocked  false relocks, without a store only
 * @property {(id: string|number, n: number) => void} setStars
 * @property {(id: string|number, n: number) => void} setBest
 * @property {(on: boolean) => void} enable  whether input is answered, for a dialog over the map
 * @property {() => void} destroy
 */

/**
 * The overworld map, drawn into a scene.
 * @param {any} scene
 * @param {WorldMapSpec} spec
 * @returns {WorldMapHandle}
 */
export function worldMap(scene, spec) {
  const s = spec || /** @type {WorldMapSpec} */ ({ nodes: [] });
  const th = look(scene);
  const still = reducedMotion();
  const pace = ms(th.motion, 200);
  const ease = curve(th);
  const store = s.store && s.store.levels ? s.store : null;
  const fog = !!s.fog;
  const speed = typeof s.speed === 'number' && s.speed > 0 ? s.speed : WALK_SPEED;

  // ── The graph ────────────────────────────────────────────────────────────────────────────────
  const nodes = (s.nodes || []).slice();
  const graph = buildGraph(nodes, s.paths);
  const byId = graph.byId;
  const edges = graph.edges;
  const paths = graph.paths;

  // What is open, earned and best when there is no store. Copied, so the app's maps stay its own.
  const local = { unlocked: /** @type {Record<string, boolean>} */ ({}), stars: /** @type {Record<string, number>} */ ({}), best: /** @type {Record<string, number>} */ ({}) };
  if (Array.isArray(s.unlocked)) for (const id of s.unlocked) local.unlocked[String(id)] = true;
  else if (s.unlocked && typeof s.unlocked === 'object') for (const id in s.unlocked) local.unlocked[id] = !!s.unlocked[id];
  for (const id in s.stars || {}) local.stars[id] = s.stars[id];
  for (const id in s.best || {}) local.best[id] = s.best[id];

  /**
   * One node's facts, from the store when there is one.
   * @param {string} key
   * @returns {{ unlocked: boolean, stars: number, best: number }}
   */
  function stateOf(key) {
    const node = byId[key];
    const forced = !!(node && node.unlocked);
    if (store) {
      const rec = store.levels.get(key);
      return {
        unlocked: forced || store.levels.isUnlocked(key),
        stars: rec ? rec.stars : 0,
        best: rec ? rec.best : 0,
      };
    }
    return {
      unlocked: forced || !!local.unlocked[key],
      stars: local.stars[key] || 0,
      best: local.best[key] || 0,
    };
  }

  // ── The picture ──────────────────────────────────────────────────────────────────────────────
  const size = mapSize(nodes, s.regions || [], scene, s.width, s.height);
  if (typeof s.backdrop === 'function') s.backdrop(scene);

  const root = scene.add.container(0, 0);
  if (typeof s.depth === 'number') root.setDepth(s.depth);

  const regions = drawRegions(scene, s.regions || [], th);
  root.add(regions.graphics);
  for (const cap of regions.captions) root.add(cap);
  const pathsG = scene.add.graphics();
  root.add(pathsG);

  /** @type {Record<string, import('./worldmap-draw.js').NodeEntry>} */
  const entries = {};
  for (const n of nodes) {
    const entry = buildNode(scene, n, th);
    entries[String(n.id)] = entry;
    root.add(entry.box);
    wirePointer(entry, String(n.id));
  }
  /** @type {Record<string, any>} the haze over each node beyond the frontier */
  const hazes = {};

  const drawn = s.walker ? null : buildWalker(scene, th);
  const walker = s.walker || drawn.box;
  const walkerBody = drawn ? drawn.body : null;
  if (drawn) root.add(walker);
  /** @type {any[]} pulses still growing */
  const pulses = [];

  /** @type {Record<string, Array<(value?: any) => void>>} */
  const handlers = {};
  let current = pickStart();
  let hoverKey = '';
  let moving = false;
  let live = true;
  let gone = false;
  /** @type {any} */
  let walkTween = null;
  /** @type {any} */
  let bobTween = null;
  /** Bumped by every stop, so a hop that was cut short cannot finish after the fact. */
  let walkGen = 0;
  /** @type {((ok: boolean) => void)|null} the promise of the walk in progress */
  let settleWalk = null;

  placeWalker(byId[current]);
  repaint(true);

  const cam = scene.cameras && scene.cameras.main ? scene.cameras.main : null;
  const following = !!(cam && s.camera === 'follow');
  if (following) {
    cam.setBounds(0, 0, size.w, size.h);
    cam.startFollow(walker, true, still ? 1 : 0.1, still ? 1 : 0.1);
  }

  /** @returns {string} the key the walker starts on */
  function pickStart() {
    if (s.current != null && byId[String(s.current)]) return String(s.current);
    for (const n of nodes) if (stateOf(String(n.id)).unlocked) return String(n.id);
    return nodes.length ? String(nodes[0].id) : '';
  }

  /** @param {MapNode|undefined} node */
  function placeWalker(node) {
    if (!node) return;
    walker.setPosition(node.x, node.y);
  }

  /**
   * @param {string} event
   * @param {any} [value]
   * @returns {void}
   */
  function emit(event, value) {
    const list = handlers[event];
    if (!list) return;
    for (const fn of list.slice()) fn(value);
  }

  /**
   * Repaint every node and path for the state as it stands. With the fog on, the frontier is the
   * open nodes and their neighbours; a node that has just entered it is revealed with one tween.
   * @param {boolean} [initial]
   * @returns {void}
   */
  function repaint(initial) {
    /** @type {Record<string, { unlocked: boolean, stars: number, best: number }>} */
    const facts = {};
    for (const key in entries) facts[key] = stateOf(key);
    const inView = new Set();
    for (const key in entries) {
      if (!fog || facts[key].unlocked) {
        inView.add(key);
        for (const e of edges[key]) inView.add(e.to);
      }
    }
    if (current) inView.add(current);

    for (const key in entries) {
      const entry = entries[key];
      const f = facts[key];
      paintNode(entry, {
        unlocked: f.unlocked, stars: f.stars, best: f.best,
        current: key === current, hover: key === hoverKey,
      }, th);
      const rest = f.unlocked ? 1 : DIM;
      if (!inView.has(key)) hide(entry, key);
      else if (hazes[key]) reveal(entry, key, rest, !!initial);
      else if (!entry.lifting) entry.box.setAlpha(rest);
    }

    drawPaths(pathsG, paths.map(function (p) {
      const ka = String(p.a.id);
      const kb = String(p.b.id);
      return {
        geom: p.geom, style: p.style,
        open: facts[ka].unlocked && facts[kb].unlocked,
        shown: inView.has(ka) && inView.has(kb),
      };
    }), th, s.pathStyle);
  }

  /**
   * Put a node under the haze. Instant: a node only leaves the frontier through a relock, which
   * is rare and local.
   * @param {import('./worldmap-draw.js').NodeEntry} entry
   * @param {string} key
   * @returns {void}
   */
  function hide(entry, key) {
    if (hazes[key]) return;
    if (scene.tweens) scene.tweens.killTweensOf(entry.box);
    entry.lifting = false;
    entry.box.setAlpha(0);
    entry.hit.disableInteractive();
    const haze = buildHaze(scene, entry.node.x, entry.node.y, th);
    hazes[key] = haze;
    root.add(haze);
  }

  /**
   * Lift the haze off a node that has entered the frontier: the cloud fades, the node comes up.
   * @param {import('./worldmap-draw.js').NodeEntry} entry
   * @param {string} key
   * @param {number} rest  the alpha the node settles at
   * @param {boolean} instant
   * @returns {void}
   */
  function reveal(entry, key, rest, instant) {
    const haze = hazes[key];
    delete hazes[key];
    entry.hit.setInteractive({ useHandCursor: true });
    if (instant || still) {
      haze.destroy();
      entry.box.setAlpha(rest);
      return;
    }
    entry.lifting = true;
    scene.tweens.add({
      targets: haze, alpha: 0, duration: pace * 3, ease: ease,
      onComplete: function () { if (haze.scene) haze.destroy(); },
    });
    scene.tweens.add({
      targets: entry.box, alpha: rest, duration: pace * 3, ease: ease,
      onComplete: function () { entry.lifting = false; },
    });
  }

  /**
   * The pointer on a node: hover brightens its label, a press walks there or picks it.
   * @param {import('./worldmap-draw.js').NodeEntry} entry
   * @param {string} key
   * @returns {void}
   */
  function wirePointer(entry, key) {
    entry.hit.setInteractive({ useHandCursor: true });
    entry.hit.on('pointerover', function () {
      if (!live || gone) return;
      hoverKey = key;
      paintOne(key);
    });
    entry.hit.on('pointerout', function () {
      if (gone) return;
      if (hoverKey === key) hoverKey = '';
      paintOne(key);
    });
    entry.hit.on('pointerdown', function () {
      if (!live || moving || gone) return;
      if (key === current) pickCurrent();
      else api.goTo(key);
    });
  }

  /** @param {string} key */
  function paintOne(key) {
    const f = stateOf(key);
    paintNode(entries[key], {
      unlocked: f.unlocked, stars: f.stars, best: f.best,
      current: key === current, hover: key === hoverKey,
    }, th);
  }

  // ── Walking ──────────────────────────────────────────────────────────────────────────────────

  /** @param {string} key @returns {boolean} whether the walker may step onto this node */
  function isOpen(key) {
    return stateOf(key).unlocked;
  }

  /**
   * One hop along a path. The walker rides a tween on t and is placed on the curve each frame;
   * under less motion it is put at the far end and the hop is over.
   * @param {string} toKey
   * @param {() => void} done
   * @returns {void}
   */
  function hop(toKey, done) {
    const edge = (edges[current] || []).find(function (e) { return e.to === toKey; });
    const target = byId[toKey];
    if (!edge || !target) { done(); return; }
    if (still) {
      current = toKey;
      placeWalker(target);
      done();
      return;
    }
    const len = pathLength(edge.path.geom);
    const duration = Math.round(Math.min(HOP_MAX, Math.max(HOP_MIN, (len / speed) * 1000)));
    const probe = along(edge, DIR_PROBE);
    if (typeof walker.setFlipX === 'function') walker.setFlipX(probe.x < byId[current].x);
    bob(duration);
    const ride = { t: 0 };
    const gen = walkGen;
    walkTween = scene.tweens.add({
      targets: ride, t: 1, duration: duration, ease: 'Sine.easeInOut',
      onUpdate: function () {
        if (gen !== walkGen) return;
        const p = along(edge, ride.t);
        walker.setPosition(p.x, p.y);
      },
      onComplete: function () {
        if (gen !== walkGen) return;
        walkTween = null;
        current = toKey;
        placeWalker(target);
        done();
      },
    });
  }

  /**
   * Answer the walk in progress, once.
   * @param {boolean} ok
   * @returns {void}
   */
  function settle(ok) {
    const resolve = settleWalk;
    settleWalk = null;
    if (resolve) resolve(ok);
  }

  /**
   * The bob while walking: up and down for as many beats as fit the hop, then still.
   * @param {number} duration
   * @returns {void}
   */
  function bob(duration) {
    if (!walkerBody || still) return;
    const beats = Math.max(1, Math.floor(duration / (BOB_MS * 2)));
    bobTween = scene.tweens.add({
      targets: walkerBody, y: -BOB_PX, duration: BOB_MS, yoyo: true, repeat: beats - 1,
      ease: 'Sine.easeInOut',
      onComplete: function () { bobTween = null; walkerBody.y = 0; },
    });
  }

  /**
   * Walk a route hop by hop. 'move' fires as it starts, 'arrive' once at the end.
   * @param {string[]} route
   * @returns {Promise<boolean>}
   */
  function travel(route) {
    moving = true;
    emit('move', { from: byId[current], to: byId[route[route.length - 1]] });
    return new Promise(function (resolve) {
      settleWalk = resolve;
      const step = function (i) {
        if (gone) { settle(false); return; }
        if (i >= route.length) {
          moving = false;
          arrive();
          settle(true);
          return;
        }
        hop(route[i], function () { step(i + 1); });
      };
      step(0);
    });
  }

  /** The walker has reached where it set out for. @returns {void} */
  function arrive() {
    repaint();
    const node = byId[current];
    const entry = entries[current];
    if (node && entry && !still) {
      const ring = pulseAt(scene, root, node.x, node.y, entry.r, th, pace, ease, function (gone_) {
        const at = pulses.indexOf(gone_);
        if (at >= 0) pulses.splice(at, 1);
      });
      // A ring still on the scene is remembered so destroy() can kill its tween early.
      if (ring.scene) pulses.push(ring);
    }
    emit('arrive', node);
  }

  /**
   * A locked node was asked for: one counted jolt of the walker, and the app is told.
   * @param {MapNode} node
   * @returns {void}
   */
  function refuse(node) {
    emit('refuse', node);
    if (still || !scene.tweens) return;
    const home = walker.x;
    scene.tweens.killTweensOf(walker);
    scene.tweens.add({
      targets: walker, x: home + SHAKE_PX, duration: Math.round(pace * 0.28),
      ease: 'Sine.easeInOut', yoyo: true, repeat: 2,
      onComplete: function () { walker.x = home; },
    });
  }

  /**
   * A step in a direction: along the path that leaves that way, when its far end is open.
   * @param {'left'|'right'|'up'|'down'} dir
   * @returns {void}
   */
  function step(dir) {
    if (!live || moving || gone) return;
    const edge = neighbourToward(graph, current, dir);
    if (!edge) return;
    if (!isOpen(edge.to)) { refuse(byId[edge.to]); return; }
    travel([edge.to]);
  }

  /** Pick the node the walker stands on. A locked one refuses. @returns {void} */
  function pickCurrent() {
    if (!live || moving || gone) return;
    const node = byId[current];
    if (!node) return;
    if (!isOpen(current)) { refuse(node); return; }
    emit('pick', node);
    if (typeof node.onPick === 'function') node.onPick(node);
  }

  // ── Input ────────────────────────────────────────────────────────────────────────────────────
  // A controls state is read on the edge, so a held direction is one step. With the default
  // scheme UP and W also report `jump`, so a jump that arrives with `up` is the step and not a
  // pick; SPACE reports jump alone and picks.
  const held = { left: false, right: false, up: false, down: false, act: false };
  const tick = function () {
    const c = s.controls;
    if (!live || !c || gone) return;
    for (const dir in DIRS) {
      const now = !!c[dir];
      if (now && !held[dir]) step(/** @type {any} */ (dir));
      held[dir] = now;
    }
    const act = !!(c.action || (c.jump && !c.up));
    if (act && !held.act) pickCurrent();
    held.act = act;
  };
  if (s.controls) scene.events.on('update', tick);

  // Without a controls state the keyboard is read here, so a map with no pad still walks.
  const keyboard = !s.controls && scene.input && scene.input.keyboard ? scene.input.keyboard : null;
  /** @type {Record<string, () => void>} */
  const keys = {
    'keydown-LEFT': function () { step('left'); }, 'keydown-A': function () { step('left'); },
    'keydown-RIGHT': function () { step('right'); }, 'keydown-D': function () { step('right'); },
    'keydown-UP': function () { step('up'); }, 'keydown-W': function () { step('up'); },
    'keydown-DOWN': function () { step('down'); }, 'keydown-S': function () { step('down'); },
    'keydown-ENTER': pickCurrent, 'keydown-SPACE': pickCurrent,
  };
  if (keyboard) for (const name in keys) keyboard.on(name, keys[name]);

  // The store's own changes repaint the map, so a level won elsewhere opens its node here.
  const offStore = store && typeof store.onChange === 'function'
    ? store.onChange(function () { if (!gone) repaint(); })
    : null;

  /** @type {WorldMapHandle} */
  const api = {
    el: root,
    walker: walker,

    on(event, fn) {
      const list = handlers[event] || (handlers[event] = []);
      list.push(fn);
      return function off() {
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
      };
    },

    goTo(id, opts) {
      const key = String(id);
      const target = byId[key];
      if (!target || gone) return Promise.resolve(false);
      if (key === current && !moving) return Promise.resolve(true);
      if (opts && opts.instant) {
        stopWalk();
        current = key;
        placeWalker(target);
        repaint();
        emit('arrive', target);
        return Promise.resolve(true);
      }
      if (moving) return Promise.resolve(false);
      const route = routeTo(graph, current, key, isOpen);
      if (!route) { refuse(target); return Promise.resolve(false); }
      return travel(route);
    },

    current() {
      return byId[current] ? byId[current].id : null;
    },

    refresh() {
      if (!gone) repaint();
    },

    setUnlocked(id, on) {
      const want = on !== false;
      if (store) {
        if (want) store.levels.unlock(id);
        else console.warn('[aimeat-phaser] worldMap: a saves() store cannot relock a level; nothing changed for', id);
      } else {
        local.unlocked[String(id)] = want;
      }
      if (!gone) repaint();
    },

    setStars(id, n) {
      const want = Math.max(0, Math.min(3, Math.floor(typeof n === 'number' ? n : 0)));
      if (store) store.levels.stars(id, want);
      else local.stars[String(id)] = want;
      if (!gone) repaint();
    },

    setBest(id, n) {
      const want = typeof n === 'number' && isFinite(n) ? n : 0;
      if (store) store.levels.best(id, want);
      else local.best[String(id)] = want;
      if (!gone) repaint();
    },

    enable(on) {
      live = !!on;
    },

    destroy() {
      if (gone) return;
      gone = true;
      moving = false;
      scene.events.off('update', tick);
      scene.events.off('shutdown', api.destroy);
      if (keyboard) for (const name in keys) keyboard.off(name, keys[name]);
      if (offStore) offStore();
      stopWalk();
      if (scene.tweens) {
        scene.tweens.killTweensOf(walker);
        for (const key in entries) scene.tweens.killTweensOf(entries[key].box);
        for (const key in hazes) scene.tweens.killTweensOf(hazes[key]);
        for (const ring of pulses) scene.tweens.killTweensOf(ring);
      }
      pulses.length = 0;
      if (following && scene.cameras && scene.cameras.main && typeof scene.cameras.main.stopFollow === 'function') {
        scene.cameras.main.stopFollow();
      }
      for (const key in handlers) handlers[key].length = 0;
      // On a scene shutdown Phaser has already emptied the display list; an explicit destroy()
      // mid-play still has everything, and the container takes its children with it.
      if (root.scene) root.destroy(true);
    },
  };

  /** End a walk where it is: the tweens stop, the hop cannot finish, the promise answers false. */
  function stopWalk() {
    walkGen += 1;
    if (walkTween && typeof walkTween.stop === 'function') walkTween.stop();
    walkTween = null;
    if (bobTween && typeof bobTween.stop === 'function') bobTween.stop();
    bobTween = null;
    if (walkerBody) walkerBody.y = 0;
    moving = false;
    settle(false);
  }

  scene.events.once('shutdown', api.destroy);
  return api;
}

/**
 * A whole map screen as a scene CONFIG for an app's scenes array: the map is built on create, a
 * pick starts the node's scene through the menu transition, and the walker stands where the
 * player last picked when the map comes back. Nothing is created until Phaser starts the scene,
 * so this may be built at module scope.
 *
 * @param {WorldMapSpec & {
 *   key?: string,
 *   controls?: any,
 *   transition?: 'fade'|'wipe'|'iris'|'cut',
 * }} spec  `controls: true` builds a controls state for the scene (keyboard, pad and the touch
 *   overlay); a controls OPTIONS object builds one with those options; a ready state is used as it
 *   is; nothing reads the keyboard alone
 * @returns {{ key: string, create: (data?: any) => void, update: () => void }}
 */
export function worldMapScene(spec) {
  const s = spec || /** @type {any} */ ({ nodes: [] });
  const key = s.key || 'map';
  /** @type {any} the controls state the running scene reads, when it made one */
  let pad = null;
  /** @type {string|number|undefined} where the walker stands when the map comes back */
  let last = s.current;

  return {
    key: key,
    create: function (data) {
      const scene = /** @type {any} */ (this);
      const th = look(scene);
      scene.cameras.main.setBackgroundColor(th.bg);

      const wants = s.controls;
      let own = false;
      if (wants === true || (wants && typeof wants === 'object' && typeof wants.update !== 'function')) {
        pad = controls(scene, wants === true ? { touch: 'auto' } : wants);
        own = true;
      } else {
        pad = wants || null;
      }

      const start = data && data.current != null ? data.current : last;
      const map = worldMap(scene, /** @type {any} */ (Object.assign({}, s, { controls: pad, current: start })));
      map.on('arrive', function (node) { last = node.id; });
      map.on('pick', function (node) {
        last = node.id;
        if (!node.scene) return;
        map.enable(false);
        transition(scene, node.scene, {
          kind: s.transition || 'fade',
          data: node.data !== undefined ? node.data : { node: node.id },
        });
      });

      scene.events.once('shutdown', function () {
        if (own && pad) pad.destroy();
        pad = null;
      });
    },
    update: function () {
      if (pad && typeof pad.update === 'function') pad.update();
    },
  };
}
