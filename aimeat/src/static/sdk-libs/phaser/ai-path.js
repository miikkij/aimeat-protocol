/**
 * @file phaser/ai-path.js
 * @description Routes over a walkability grid, for the brains in ai.js and for any game that wants
 *   a path without a brain: A* between two tiles, string-pulling over the result, a flow field
 *   for many chasers after one target, and the straight-line test that says whether one tile can
 *   see another.
 *
 *   THE GRID IS THE ONE tileWorld().grid() HANDS BACK: rows of booleans, grid[ty][tx], true where a
 *   thing can stand. Any 2D array of truthy and falsy cells reads the same, and a handle with a
 *   grid() method (a tileWorld) is accepted in its place, so the same call works on both.
 *
 *   A CORNER IS NOT CUT UNLESS ASKED. With diagonal moves on, a step from a cell to its diagonal
 *   neighbour is refused when either orthogonal neighbour between them is blocked, because a body
 *   with any width clips that corner and sticks. cutCorners: true lifts the rule for a point.
 *
 *   EVERY SEARCH HAS A BUDGET. findPath() expands at most opts.budget nodes (four thousand by
 *   default) and answers null past it, so a sealed room on a large map costs a bounded amount of
 *   one frame rather than the whole grid. nearest: true turns that null, and the null of a goal
 *   inside a wall, into the path to the reachable tile closest to the goal, which is what a chase
 *   wants.
 *
 *   PLAIN FUNCTIONS OVER PLAIN DATA: no scene, no Phaser, nothing kept between calls, so all of it
 *   can be checked in Node.
 * @structure gridOf() · lineClear() · findPath() (a binary heap over a flat index) · smoothPath()
 *   · flowField()
 * @usage
 *   const p = AIMEAT.phaser.pathfind;
 *   const steps = p.findPath(world.grid(), world.toTile(me.x, me.y), world.toTile(hero.x, hero.y),
 *     { diagonal: true, nearest: true });
 *   const corners = steps ? p.smoothPath(world.grid(), steps) : null;
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: A* with 4- or 8-way moves, corner rule, cost callback and node
 *     budget; string-pulling; the flow field; the Bresenham sight line.
 */

/** How many nodes one findPath() may expand before it gives up. */
const DEFAULT_BUDGET = 4000;

/** The cost of a diagonal step, against 1 for a straight one. */
const DIAGONAL = Math.SQRT2;

/** The four straight moves, then the four diagonals, as dx, dy pairs. */
const STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * @typedef {object} PathOptions
 * @property {boolean} [diagonal]     allow the four diagonal moves. Default false: four-way.
 * @property {boolean} [cutCorners]   with diagonal on, allow a diagonal step past a blocked
 *   orthogonal neighbour. Default false.
 * @property {(x: number, y: number) => number} [cost]  a multiplier for entering a tile: 1 is
 *   plain ground, 3 is mud, and 0, a negative number or a non-finite one makes the tile
 *   impassable for this search.
 * @property {number} [budget]        the most nodes the search may expand. Default 4000.
 * @property {boolean} [nearest]      when the goal cannot be reached (blocked, sealed off, or
 *   past the budget), answer the path to the reachable tile closest to it instead of null.
 */

/**
 * The rows of a grid, whichever shape it arrived in.
 * @param {any} source  boolean[][], or a handle with grid()
 * @returns {any[][]|null}
 */
export function gridOf(source) {
  if (Array.isArray(source)) return source;
  if (source && typeof source.grid === 'function') {
    const g = source.grid();
    return Array.isArray(g) ? g : null;
  }
  return null;
}

/**
 * @param {any[][]} grid
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function open(grid, x, y) {
  const row = grid[y];
  return !!(row && row[x]);
}

/**
 * @param {any} p
 * @returns {{ x: number, y: number }|null}
 */
function point(p) {
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

/**
 * Can one tile see another? A Bresenham walk from tile to tile; true when every cell on the way
 * is open. The two ends are checked too, so a target standing in a wall is not seen.
 * @param {any} gridSource
 * @param {{ x: number, y: number }} from  tile coordinates
 * @param {{ x: number, y: number }} to
 * @returns {boolean}
 */
export function lineClear(gridSource, from, to) {
  const grid = gridOf(gridSource);
  const a = point(from);
  const b = point(to);
  if (!grid || !a || !b) return false;
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!open(grid, x, y)) return false;
    if (x === b.x && y === b.y) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * A binary min-heap over node indexes, ordered by a score array. Small and private: the search
 * is the only caller and it never removes anything but the top.
 * @param {Float64Array} score
 * @returns {{ push: (i: number) => void, pop: () => number, size: () => number }}
 */
function heap(score) {
  /** @type {number[]} */
  const items = [];
  return {
    size() { return items.length; },
    push(i) {
      items.push(i);
      let at = items.length - 1;
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (score[items[parent]] <= score[items[at]]) break;
        const t = items[parent];
        items[parent] = items[at];
        items[at] = t;
        at = parent;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length && last !== undefined) {
        items[0] = last;
        let at = 0;
        for (;;) {
          const l = at * 2 + 1;
          const r = l + 1;
          let best = at;
          if (l < items.length && score[items[l]] < score[items[best]]) best = l;
          if (r < items.length && score[items[r]] < score[items[best]]) best = r;
          if (best === at) break;
          const t = items[best];
          items[best] = items[at];
          items[at] = t;
          at = best;
        }
      }
      return top;
    },
  };
}

/**
 * The shortest route between two tiles, as the tiles stepped on: path[0] is from and the last
 * entry is to. A from that equals to gives [from]. Null when there is no route, when either end
 * is off the grid or blocked, or when the budget ran out (unless nearest is set).
 * @param {any} gridSource  boolean[][] rows, or a handle with grid()
 * @param {{ x: number, y: number }} from  tile coordinates
 * @param {{ x: number, y: number }} to
 * @param {PathOptions} [opts]
 * @returns {Array<{ x: number, y: number }>|null}
 */
export function findPath(gridSource, from, to, opts) {
  const grid = gridOf(gridSource);
  const a = point(from);
  const b = point(to);
  if (!grid || !a || !b || !grid.length) return null;
  const o = opts || {};
  const rows = grid.length;
  let cols = 0;
  for (const row of grid) if (row && row.length > cols) cols = row.length;
  if (!cols) return null;
  if (!open(grid, a.x, a.y)) return null;
  if (a.x === b.x && a.y === b.y) return [a];
  const goalOpen = open(grid, b.x, b.y);
  if (!goalOpen && !o.nearest) return null;

  const diagonal = !!o.diagonal;
  const cut = !!o.cutCorners;
  const cost = typeof o.cost === 'function' ? o.cost : null;
  const budget = typeof o.budget === 'number' && o.budget > 0 ? o.budget : DEFAULT_BUDGET;
  const moves = diagonal ? STRAIGHT.concat(DIAGONALS) : STRAIGHT;

  /** Manhattan for four-way, octile for eight-way: both admissible for their move set. */
  function h(x, y) {
    const dx = Math.abs(x - b.x);
    const dy = Math.abs(y - b.y);
    return diagonal ? Math.max(dx, dy) + (DIAGONAL - 1) * Math.min(dx, dy) : dx + dy;
  }

  const total = rows * cols;
  const g = new Float64Array(total).fill(Infinity);
  const f = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const start = a.y * cols + a.x;
  const goal = b.y * cols + b.x;
  g[start] = 0;
  f[start] = h(a.x, a.y);
  const queue = heap(f);
  queue.push(start);
  let expanded = 0;
  let nearestIndex = start;
  let nearestH = f[start];

  while (queue.size()) {
    const current = queue.pop();
    if (closed[current]) continue;
    if (current === goal) return unwind(parent, current, cols);
    closed[current] = 1;
    if (++expanded > budget) break;
    const cx = current % cols;
    const cy = (current - cx) / cols;
    const hc = h(cx, cy);
    if (hc < nearestH) {
      nearestH = hc;
      nearestIndex = current;
    }
    for (let m = 0; m < moves.length; m++) {
      const nx = cx + moves[m][0];
      const ny = cy + moves[m][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !open(grid, nx, ny)) continue;
      const isDiagonal = m >= 4;
      if (isDiagonal && !cut && (!open(grid, cx, ny) || !open(grid, nx, cy))) continue;
      const next = ny * cols + nx;
      if (closed[next]) continue;
      let step = isDiagonal ? DIAGONAL : 1;
      if (cost) {
        const k = cost(nx, ny);
        if (!(k > 0) || !isFinite(k)) continue;
        step *= k;
      }
      const tentative = g[current] + step;
      if (tentative >= g[next]) continue;
      g[next] = tentative;
      f[next] = tentative + h(nx, ny);
      parent[next] = current;
      queue.push(next);
    }
  }
  if (o.nearest && nearestIndex !== start) return unwind(parent, nearestIndex, cols);
  if (o.nearest) return [a];
  return null;
}

/**
 * The path back from a node to the start, turned round.
 * @param {Int32Array} parent
 * @param {number} end
 * @param {number} cols
 * @returns {Array<{ x: number, y: number }>}
 */
function unwind(parent, end, cols) {
  /** @type {Array<{ x: number, y: number }>} */
  const out = [];
  let at = end;
  while (at >= 0) {
    const x = at % cols;
    out.push({ x: x, y: (at - x) / cols });
    at = parent[at];
  }
  out.reverse();
  return out;
}

/**
 * String-pulling: drop every step that a straight open line can skip, so a path along a corridor
 * becomes its two ends and a path round a corner becomes the corner. The line test is the same
 * Bresenham walk sight uses, so a corner is never cut. The ends are kept.
 * @param {any} gridSource
 * @param {Array<{ x: number, y: number }>} path  what findPath() gave
 * @returns {Array<{ x: number, y: number }>}
 */
export function smoothPath(gridSource, path) {
  const grid = gridOf(gridSource);
  if (!Array.isArray(path) || path.length < 3 || !grid) return Array.isArray(path) ? path.slice() : [];
  const out = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let far = anchor + 1;
    for (let i = path.length - 1; i > anchor + 1; i--) {
      if (lineClear(grid, path[anchor], path[i])) {
        far = i;
        break;
      }
    }
    out.push(path[far]);
    anchor = far;
  }
  return out;
}

/**
 * @typedef {object} FlowField
 * @property {number[][]} dist   the distance of every tile from the target, in steps; Infinity
 *   where the target cannot be reached
 * @property {{ x: number, y: number }} target
 * @property {(x: number, y: number) => { x: number, y: number }|null} step  the neighbour that
 *   brings a tile one closer, or null at the target and anywhere it cannot be reached from
 * @property {(x: number, y: number) => boolean} reachable
 */

/**
 * The whole grid's distance to one target, from which any number of chasers each take one step
 * per frame with a lookup instead of a search. Built with Dijkstra from the target, so it takes
 * the same cost callback and corner rule as findPath(); with a cost the distances are weighted
 * and step() still descends them.
 * @param {any} gridSource
 * @param {{ x: number, y: number }} target  tile coordinates
 * @param {{ diagonal?: boolean, cutCorners?: boolean, cost?: (x: number, y: number) => number }} [opts]
 * @returns {FlowField}
 */
export function flowField(gridSource, target, opts) {
  const grid = gridOf(gridSource) || [];
  const t = point(target) || { x: -1, y: -1 };
  const o = opts || {};
  const rows = grid.length;
  let cols = 0;
  for (const row of grid) if (row && row.length > cols) cols = row.length;
  const diagonal = !!o.diagonal;
  const cut = !!o.cutCorners;
  const cost = typeof o.cost === 'function' ? o.cost : null;
  const moves = diagonal ? STRAIGHT.concat(DIAGONALS) : STRAIGHT;

  /** @type {number[][]} */
  const dist = [];
  for (let y = 0; y < rows; y++) {
    /** @type {number[]} */
    const row = [];
    for (let x = 0; x < cols; x++) row.push(Infinity);
    dist.push(row);
  }

  if (cols && open(grid, t.x, t.y)) {
    const score = new Float64Array(rows * cols).fill(Infinity);
    const closed = new Uint8Array(rows * cols);
    const startIndex = t.y * cols + t.x;
    score[startIndex] = 0;
    const queue = heap(score);
    queue.push(startIndex);
    while (queue.size()) {
      const current = queue.pop();
      if (closed[current]) continue;
      closed[current] = 1;
      const cx = current % cols;
      const cy = (current - cx) / cols;
      dist[cy][cx] = score[current];
      for (let m = 0; m < moves.length; m++) {
        const nx = cx + moves[m][0];
        const ny = cy + moves[m][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !open(grid, nx, ny)) continue;
        const isDiagonal = m >= 4;
        if (isDiagonal && !cut && (!open(grid, cx, ny) || !open(grid, nx, cy))) continue;
        const next = ny * cols + nx;
        if (closed[next]) continue;
        let step = isDiagonal ? DIAGONAL : 1;
        if (cost) {
          // The cost of a tile is paid on entering it; walking the field the other way, that is
          // the cost of the tile being left, which is the current one.
          const k = cost(cx, cy);
          if (!(k > 0) || !isFinite(k)) continue;
          step *= k;
        }
        const tentative = score[current] + step;
        if (tentative >= score[next]) continue;
        score[next] = tentative;
        queue.push(next);
      }
    }
  }

  function reachable(x, y) {
    const row = dist[y];
    return !!row && isFinite(row[x]);
  }

  function step(x, y) {
    if (!reachable(x, y)) return null;
    const here = dist[y][x];
    if (here === 0) return null;
    let best = null;
    let bestDist = here;
    for (let m = 0; m < moves.length; m++) {
      const nx = x + moves[m][0];
      const ny = y + moves[m][1];
      if (!reachable(nx, ny)) continue;
      if (m >= 4 && !cut && (!open(grid, x, ny) || !open(grid, nx, y))) continue;
      if (dist[ny][nx] < bestDist) {
        bestDist = dist[ny][nx];
        best = { x: nx, y: ny };
      }
    }
    return best;
  }

  return { dist: dist, target: t, step: step, reachable: reachable };
}
