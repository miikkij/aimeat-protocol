/**
 * @file phaser/worldmap-graph.js
 * @description The graph under the overworld map: nodes by id, the paths between them as edges
 *   in both directions, the maths that says which neighbour a direction means and which route
 *   leads to a node over open ground, and the map's own size. Plain functions over plain data
 *   (the one side effect is a warning for a path to nowhere), so all of it can be checked
 *   without a scene.
 * @structure DIRS · DIR_PROBE · buildGraph (normalizePaths) · along · neighbourToward · routeTo ·
 *   mapSize
 * @usage  internal to ./worldmap.js
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the overworld map's graph, kept apart from worldmap.js so
 *     the logic file stays under the 800-line rule.
 */
import { pointAt } from './worldmap-draw.js';

/** The four directions a step can be asked in, as unit vectors. */
export const DIRS = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

/** How closely a path has to point the way that was asked: the cosine of about 70 degrees. */
const DIR_MATCH = 0.34;

/** Where along a path its direction is measured, so a curve that leaves upward reads as up. */
export const DIR_PROBE = 0.3;

/** The room the map's own size leaves past its farthest node. */
const MARGIN = 80;

/**
 * @typedef {{ to: string, path: any, reverse: boolean }} Edge
 */

/**
 * @typedef {object} Graph
 * @property {Record<string, any>} byId     node key → the app's node object
 * @property {Record<string, Edge[]>} edges  node key → the paths leaving it
 * @property {Array<{ a: any, b: any, geom: any, style?: string }>} paths
 */

/**
 * Paths as the graph wants them: both ends resolved to nodes, the geometry the curve maths reads.
 * A pair whose end names no node is dropped with a warning rather than drawn to nowhere.
 * @param {Array<any>|undefined} given  a pair [from, to] or { from, to, control?, style? }
 * @param {Record<string, any>} byId
 * @returns {Array<{ a: any, b: any, geom: any, style?: string }>}
 */
function normalizePaths(given, byId) {
  const out = [];
  for (const raw of given || []) {
    const p = Array.isArray(raw) ? { from: raw[0], to: raw[1] } : raw;
    const a = p && byId[String(p.from)];
    const b = p && byId[String(p.to)];
    if (!a || !b) {
      console.warn('[aimeat-phaser] worldMap: a path names a node that is not on the map:', raw);
      continue;
    }
    const control = Array.isArray(p.control) ? p.control.slice(0, 2) : [];
    out.push({ a: a, b: b, geom: { from: a, to: b, control: control }, style: p.style });
  }
  return out;
}

/**
 * The graph: every node by its key and every path as an edge leaving each of its ends.
 * @param {any[]} nodes
 * @param {Array<any>|undefined} paths
 * @returns {Graph}
 */
export function buildGraph(nodes, paths) {
  /** @type {Record<string, any>} */
  const byId = {};
  for (const n of nodes) byId[String(n.id)] = n;
  const list = normalizePaths(paths, byId);
  /** @type {Record<string, Edge[]>} */
  const edges = {};
  for (const n of nodes) edges[String(n.id)] = [];
  for (const p of list) {
    edges[String(p.a.id)].push({ to: String(p.b.id), path: p, reverse: false });
    edges[String(p.b.id)].push({ to: String(p.a.id), path: p, reverse: true });
  }
  return { byId: byId, edges: edges, paths: list };
}

/**
 * The point a hop passes at t, whichever way round the path was declared.
 * @param {Edge} edge
 * @param {number} t
 * @returns {{ x: number, y: number }}
 */
export function along(edge, t) {
  return pointAt(edge.path.geom, edge.reverse ? 1 - t : t);
}

/**
 * The neighbour a direction asks for: the path leaving the current node whose first stretch
 * points that way best, or null when no path leaves that way at all.
 * @param {Graph} graph
 * @param {string} current
 * @param {'left'|'right'|'up'|'down'} dir
 * @returns {Edge|null}
 */
export function neighbourToward(graph, current, dir) {
  const here = graph.byId[current];
  const want = DIRS[dir];
  if (!here || !want) return null;
  let best = null;
  let bestDot = DIR_MATCH;
  for (const e of graph.edges[current] || []) {
    const p = along(e, DIR_PROBE);
    const dx = p.x - here.x;
    const dy = p.y - here.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const dot = (dx / len) * want.x + (dy / len) * want.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = e;
    }
  }
  return best;
}

/**
 * The route to a node over open ground: a breadth-first search along paths whose far ends are
 * open. Null when there is none.
 * @param {Graph} graph
 * @param {string} current
 * @param {string} key
 * @param {(key: string) => boolean} isOpen
 * @returns {string[]|null} the keys after the current one
 */
export function routeTo(graph, current, key, isOpen) {
  /** @type {Record<string, string>} */
  const cameFrom = {};
  const queue = [current];
  cameFrom[current] = '';
  while (queue.length) {
    const at = queue.shift();
    if (at === key) break;
    for (const e of graph.edges[at] || []) {
      if (cameFrom[e.to] !== undefined || !isOpen(e.to)) continue;
      cameFrom[e.to] = at;
      queue.push(e.to);
    }
  }
  if (cameFrom[key] === undefined) return null;
  const route = [];
  for (let k = key; k !== current; k = cameFrom[k]) route.unshift(k);
  return route;
}

/**
 * The map's own size: what the spec says, else past the farthest node or region, never smaller
 * than the viewport.
 * @param {any[]} nodes
 * @param {any[]} regions
 * @param {any} scene
 * @param {number|undefined} width
 * @param {number|undefined} height
 * @returns {{ w: number, h: number }}
 */
export function mapSize(nodes, regions, scene, width, height) {
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  for (const r of regions || []) {
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  const vw = scene.scale ? scene.scale.width : 0;
  const vh = scene.scale ? scene.scale.height : 0;
  return {
    w: width || Math.max(vw, maxX + MARGIN),
    h: height || Math.max(vh, maxY + MARGIN),
  };
}
