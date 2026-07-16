/**
 * aimeat-dag — generic DAG / graph canvas for AIMEAT apps.
 *
 * Renders a directed acyclic graph (workflow blueprints, pipelines, org charts, crew task
 * graphs) with automatic layered layout, smooth pan/zoom (wheel + pinch + touch drag),
 * click/tap selection, optional node dragging, and a live state layer (running dash-flow,
 * waiting-human pulse, green/red transitions). Zero dependencies; theme-aware via the app's
 * CSS variables (--card/--text/--border/--accent/--bg); honors prefers-reduced-motion.
 *
 * Usage:
 *   <script src="/v1/cortex/aimeat-dag/libs/aimeat-dag.js"></script>
 *   <script>
 *     var dag = AIMEAT.dag.Canvas('#canvas', {
 *       nodes: [{ id: 'fetch', label: 'Fetch', sub: 'news-bot' }, { id: 'write', label: 'Write' }],
 *       edges: [{ from: 'fetch', to: 'write' }],
 *       onSelect: function (item) { console.log('selected', item); },
 *     });
 *     dag.setNodeState('fetch', 'running');   // animated dash-flow on incoming edges
 *     dag.setNodeState('fetch', 'green');     // success pop
 *     dag.fit();
 *   </script>
 */
(function (global) {
  'use strict';

  var AIMEAT = global.AIMEAT = global.AIMEAT || {};

  var REDUCED = false;
  try { REDUCED = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* noop */ }

  var THEME_CSS = [
    '.ad-host { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; touch-action: none; background: var(--bg, transparent); border-radius: 12px; user-select: none; -webkit-user-select: none; cursor: grab; }',
    '.ad-host.ad-panning { cursor: grabbing; }',
    '.ad-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }',
    '.ad-world.ad-animated { transition: transform 320ms cubic-bezier(.22,1,.36,1); }',
    '.ad-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }',
    '.ad-edge { fill: none; stroke: var(--border, #94a3b8); stroke-width: 2; pointer-events: stroke; cursor: pointer; transition: stroke 200ms; }',
    '.ad-edge.ad-selected { stroke: var(--accent, #e8564a); stroke-width: 2.5; }',
    '.ad-edge.ad-edge-active { stroke: var(--accent, #e8564a); stroke-dasharray: 7 5; animation: ad-dash 700ms linear infinite; }',
    '@keyframes ad-dash { to { stroke-dashoffset: -12; } }',
    '.ad-node { position: absolute; box-sizing: border-box; min-width: 130px; max-width: 240px; background: var(--card, #fff); color: var(--text, #1a1a2e); border: 1.5px solid var(--border, #e5e7eb); border-radius: 12px; padding: 10px 14px; box-shadow: 0 2px 8px rgba(0,0,0,.10); cursor: pointer; transition: border-color 200ms, box-shadow 200ms, transform 200ms; }',
    '.ad-node:hover { box-shadow: 0 4px 14px rgba(0,0,0,.16); transform: translateY(-1px); }',
    '.ad-node.ad-dragging { cursor: grabbing; transition: none; z-index: 3; }',
    '.ad-node.ad-selected { border-color: var(--accent, #e8564a); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #e8564a) 22%, transparent), 0 4px 14px rgba(0,0,0,.14); }',
    '.ad-label { font: 600 13px/1.35 system-ui, sans-serif; overflow-wrap: break-word; }',
    '.ad-sub { font: 400 11px/1.35 system-ui, sans-serif; opacity: .65; margin-top: 2px; overflow-wrap: break-word; }',
    '.ad-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }',
    '.ad-badge { font: 600 10px/1 system-ui, sans-serif; padding: 3px 7px; border-radius: 999px; background: var(--bg-dim, rgba(127,127,127,.12)); color: inherit; }',
    '.ad-badge.ad-tone-ok { background: rgba(34,197,94,.15); color: #16a34a; }',
    '.ad-badge.ad-tone-warn { background: rgba(245,158,11,.16); color: #b45309; }',
    '.ad-badge.ad-tone-bad { background: rgba(239,68,68,.15); color: #dc2626; }',
    '.ad-badge.ad-tone-info { background: rgba(59,130,246,.15); color: #2563eb; }',
    // ── state layer ──
    '.ad-node.ad-state-green { border-color: #22c55e; }',
    '.ad-node.ad-state-red, .ad-node.ad-state-input-red, .ad-node.ad-state-output-red, .ad-node.ad-state-timed-out, .ad-node.ad-state-agent-offline { border-color: #ef4444; }',
    '.ad-node.ad-state-running, .ad-node.ad-state-dispatched { border-color: var(--accent, #e8564a); }',
    '.ad-node.ad-state-skipped { opacity: .5; }',
    '.ad-node.ad-state-waiting-human { border-color: #f59e0b; animation: ad-pulse 1.6s ease-in-out infinite; }',
    '@keyframes ad-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,.45); } 50% { box-shadow: 0 0 0 9px rgba(245,158,11,0); } }',
    '.ad-node.ad-pop { animation: ad-pop 420ms cubic-bezier(.22,1.4,.36,1); }',
    '@keyframes ad-pop { 0% { transform: scale(.94); } 60% { transform: scale(1.04); } 100% { transform: scale(1); } }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .ad-world.ad-animated { transition: none; }',
    '  .ad-edge.ad-edge-active { animation: none; }',
    '  .ad-node.ad-state-waiting-human { animation: none; box-shadow: 0 0 0 3px rgba(245,158,11,.35); }',
    '  .ad-node.ad-pop { animation: none; }',
    '  .ad-node, .ad-node:hover { transition: none; transform: none; }',
    '}',
  ].join('\n');

  var themeInjected = false;
  function injectTheme() {
    if (themeInjected) return;
    var style = document.createElement('style');
    style.setAttribute('data-aimeat-dag', '1');
    style.textContent = THEME_CSS;
    document.head.appendChild(style);
    themeInjected = true;
  }

  function resolveEl(elOrSelector) {
    return typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
  }

  function esc(text) {
    var d = document.createElement('div');
    d.textContent = String(text == null ? '' : text);
    return d.innerHTML;
  }

  /**
   * Layered DAG layout (pure — also exposed as AIMEAT.dag.layout for headless use).
   * Rank = longest path from a source; order within rank by 2-pass barycenter of neighbors.
   * Returns { positions: {id:{x,y}}, ranks: {id:rank} } using the given node sizes.
   */
  function layout(nodes, edges, opts) {
    opts = opts || {};
    var dir = opts.direction === 'TB' ? 'TB' : 'LR';
    var gapMain = opts.gapMain != null ? opts.gapMain : 90;   // between ranks
    var gapCross = opts.gapCross != null ? opts.gapCross : 26; // between siblings
    var sizes = opts.sizes || {};
    var defW = opts.nodeWidth != null ? opts.nodeWidth : 170;
    var defH = opts.nodeHeight != null ? opts.nodeHeight : 62;
    var ids = nodes.map(function (n) { return n.id; });
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });
    var preds = {}; var succs = {};
    ids.forEach(function (id) { preds[id] = []; succs[id] = []; });
    edges.forEach(function (e) {
      if (!idSet[e.from] || !idSet[e.to]) return;
      preds[e.to].push(e.from); succs[e.from].push(e.to);
    });

    // 1. longest-path ranks by relaxation (graphs are small; O(V*E) worst case is fine).
    var rank = {};
    ids.forEach(function (id) { rank[id] = 0; });
    var changed = true; var guard = 0;
    while (changed && guard++ < ids.length + 2) {
      changed = false;
      edges.forEach(function (e) {
        if (!idSet[e.from] || !idSet[e.to]) return;
        if (rank[e.to] < rank[e.from] + 1) { rank[e.to] = rank[e.from] + 1; changed = true; }
      });
    }

    // 2. group by rank, order by barycenter of predecessor order (2 downstream sweeps).
    var maxRank = 0;
    ids.forEach(function (id) { if (rank[id] > maxRank) maxRank = rank[id]; });
    var cols = [];
    for (var r = 0; r <= maxRank; r++) cols.push([]);
    ids.forEach(function (id) { cols[rank[id]].push(id); });
    var order = {};
    cols.forEach(function (col) { col.forEach(function (id, i) { order[id] = i; }); });
    for (var pass = 0; pass < 2; pass++) {
      for (var c = 1; c <= maxRank; c++) {
        cols[c].sort(function (a, b) {
          var ba = bary(a); var bb = bary(b);
          return ba === bb ? order[a] - order[b] : ba - bb;
        });
        cols[c].forEach(function (id, i) { order[id] = i; });
      }
    }
    function bary(id) {
      var ps = preds[id];
      if (!ps.length) return order[id];
      var sum = 0;
      ps.forEach(function (p) { sum += order[p]; });
      return sum / ps.length;
    }

    // 3. coordinates: each rank is a column (LR) / row (TB); ranks centered on the cross axis.
    var w = function (id) { return (sizes[id] && sizes[id].w) || defW; };
    var h = function (id) { return (sizes[id] && sizes[id].h) || defH; };
    var positions = {};
    var mainOffset = 0;
    cols.forEach(function (col) {
      var rankMain = 0; // max extent of this rank on the main axis
      var crossTotal = 0;
      col.forEach(function (id) {
        rankMain = Math.max(rankMain, dir === 'LR' ? w(id) : h(id));
        crossTotal += (dir === 'LR' ? h(id) : w(id)) + gapCross;
      });
      crossTotal -= gapCross;
      var crossPos = -crossTotal / 2;
      col.forEach(function (id) {
        if (dir === 'LR') { positions[id] = { x: mainOffset, y: crossPos }; crossPos += h(id) + gapCross; }
        else { positions[id] = { x: crossPos, y: mainOffset }; crossPos += w(id) + gapCross; }
      });
      mainOffset += rankMain + gapMain;
    });
    return { positions: positions, ranks: rank };
  }

  var DEFAULT_RENDER = function (node) {
    var html = '<div class="ad-label">' + esc(node.label != null ? node.label : node.id) + '</div>';
    if (node.sub) html += '<div class="ad-sub">' + esc(node.sub) + '</div>';
    if (node.badges && node.badges.length) {
      html += '<div class="ad-badges">' + node.badges.map(function (b) {
        return '<span class="ad-badge' + (b.tone ? ' ad-tone-' + esc(b.tone) : '') + '">' + esc(b.text) + '</span>';
      }).join('') + '</div>';
    }
    return html;
  };

  /**
   * Create a DAG canvas.
   * @param {Element|string} elOrSelector host element (sized by the app; min-height applied).
   * @param {Object} opts
   * @param {Array}  opts.nodes  [{ id, label?, sub?, badges?: [{text,tone?}], state?, html? }]
   * @param {Array}  opts.edges  [{ from, to }]
   * @param {Function} [opts.renderNode] (node) → inner HTML string (replaces the default card body)
   * @param {string} [opts.direction='LR'] 'LR' | 'TB'
   * @param {Object} [opts.positions] { id: {x,y} } manual overrides (from a previous onLayoutChange)
   * @param {boolean} [opts.draggable=true] allow dragging nodes (fires onLayoutChange)
   * @param {boolean} [opts.fit=true] fit the graph on first render
   * @param {Function} [opts.onSelect] ({ type:'node'|'edge', ... } | null)
   * @param {Function} [opts.onLayoutChange] (positions) after a node drag ends
   */
  function Canvas(elOrSelector, opts) {
    opts = opts || {};
    var host = resolveEl(elOrSelector);
    if (!host) throw new Error('aimeat-dag: host element not found');
    injectTheme();
    host.classList.add('ad-host');

    var world = document.createElement('div');
    world.className = 'ad-world';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ad-edges');
    svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
    var nodeLayer = document.createElement('div');
    world.appendChild(svg);
    world.appendChild(nodeLayer);
    host.appendChild(world);

    var state = {
      nodes: [], edges: [], byId: {}, els: {}, paths: [],
      positions: {},                    // manual overrides (id → {x,y})
      computed: {},                     // effective positions after layout
      sizes: {},
      cam: { x: 40, y: 40, k: 1 },
      selected: null,
      direction: opts.direction === 'TB' ? 'TB' : 'LR',
      draggable: opts.draggable !== false,
      destroyed: false,
    };
    if (opts.positions) for (var k in opts.positions) state.positions[k] = { x: opts.positions[k].x, y: opts.positions[k].y };

    function applyCam(animated) {
      if (animated && !REDUCED) {
        world.classList.add('ad-animated');
        setTimeout(function () { world.classList.remove('ad-animated'); }, 360);
      }
      world.style.transform = 'translate(' + state.cam.x + 'px,' + state.cam.y + 'px) scale(' + state.cam.k + ')';
    }

    // ── rendering ──
    function renderNodes() {
      nodeLayer.innerHTML = '';
      state.els = {}; state.sizes = {};
      state.nodes.forEach(function (n) {
        var el = document.createElement('div');
        el.className = 'ad-node';
        el.setAttribute('data-ad-id', n.id);
        el.innerHTML = n.html != null ? n.html : (opts.renderNode || DEFAULT_RENDER)(n);
        if (n.state) el.classList.add('ad-state-' + n.state);
        nodeLayer.appendChild(el);
        state.els[n.id] = el;
      });
      // Measure real sizes, then lay out with them.
      state.nodes.forEach(function (n) {
        var el = state.els[n.id];
        state.sizes[n.id] = { w: el.offsetWidth || 170, h: el.offsetHeight || 62 };
      });
      var res = layout(state.nodes, state.edges, { direction: state.direction, sizes: state.sizes });
      state.computed = {};
      state.nodes.forEach(function (n) {
        var p = state.positions[n.id] || res.positions[n.id] || { x: 0, y: 0 };
        state.computed[n.id] = { x: p.x, y: p.y };
        place(n.id);
      });
      drawEdges();
    }

    function place(id) {
      var el = state.els[id]; var p = state.computed[id];
      if (!el || !p) return;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    }

    function anchor(id, side) {
      var p = state.computed[id]; var s = state.sizes[id] || { w: 170, h: 62 };
      if (state.direction === 'LR') {
        return side === 'out' ? { x: p.x + s.w, y: p.y + s.h / 2 } : { x: p.x, y: p.y + s.h / 2 };
      }
      return side === 'out' ? { x: p.x + s.w / 2, y: p.y + s.h } : { x: p.x + s.w / 2, y: p.y };
    }

    function edgePath(e) {
      var a = anchor(e.from, 'out'); var b = anchor(e.to, 'in');
      if (state.direction === 'LR') {
        var mx = (a.x + b.x) / 2;
        return 'M' + a.x + ',' + a.y + ' C' + mx + ',' + a.y + ' ' + mx + ',' + b.y + ' ' + b.x + ',' + b.y;
      }
      var my = (a.y + b.y) / 2;
      return 'M' + a.x + ',' + a.y + ' C' + a.x + ',' + my + ' ' + b.x + ',' + my + ' ' + b.x + ',' + b.y;
    }

    function drawEdges() {
      svg.innerHTML = '';
      state.paths = [];
      state.edges.forEach(function (e, i) {
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'ad-edge');
        path.setAttribute('d', edgePath(e));
        path.setAttribute('data-ad-edge', String(i));
        svg.appendChild(path);
        state.paths.push({ edge: e, el: path });
      });
      syncEdgeActivity();
    }

    function redrawEdgesFor(id) {
      state.paths.forEach(function (p) {
        if (p.edge.from === id || p.edge.to === id) p.el.setAttribute('d', edgePath(p.edge));
      });
    }

    /** Incoming edges of a running/dispatched node animate (data flowing toward the work). */
    function syncEdgeActivity() {
      var active = {};
      state.nodes.forEach(function (n) {
        if (n.state === 'running' || n.state === 'dispatched') active[n.id] = true;
      });
      state.paths.forEach(function (p) {
        p.el.classList.toggle('ad-edge-active', !!active[p.edge.to]);
      });
    }

    // ── selection ──
    function select(item) {
      state.selected = item;
      for (var id in state.els) state.els[id].classList.remove('ad-selected');
      state.paths.forEach(function (p) { p.el.classList.remove('ad-selected'); });
      if (item && item.type === 'node' && state.els[item.id]) state.els[item.id].classList.add('ad-selected');
      if (item && item.type === 'edge') {
        state.paths.forEach(function (p) {
          if (p.edge === item.edge) p.el.classList.add('ad-selected');
        });
      }
      if (opts.onSelect) opts.onSelect(item ? (item.type === 'node' ? { type: 'node', node: state.byId[item.id] } : { type: 'edge', edge: item.edge }) : null);
    }

    // ── pointer interactions: pan, pinch, node drag, click-select ──
    var pointers = {};       // pointerId → {x,y}
    var gesture = null;      // {mode:'pan'|'drag'|'pinch', ...}

    function clientToWorld(cx, cy) {
      var r = host.getBoundingClientRect();
      return { x: (cx - r.left - state.cam.x) / state.cam.k, y: (cy - r.top - state.cam.y) / state.cam.k };
    }

    function onPointerDown(ev) {
      // Capture is best-effort: synthetic PointerEvents (tests, automation) and pointers
      // released mid-dispatch have no active pointer and would throw NotFoundError.
      try { host.setPointerCapture && host.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var count = Object.keys(pointers).length;
      if (count === 2) {
        var pts = Object.keys(pointers).map(function (id) { return pointers[id]; });
        gesture = { mode: 'pinch', d0: dist(pts[0], pts[1]), k0: state.cam.k, mid0: mid(pts[0], pts[1]), cam0: { x: state.cam.x, y: state.cam.y } };
        return;
      }
      var nodeEl = ev.target.closest ? ev.target.closest('.ad-node') : null;
      if (nodeEl) {
        var id = nodeEl.getAttribute('data-ad-id');
        gesture = { mode: 'node', id: id, sx: ev.clientX, sy: ev.clientY, start: { x: state.computed[id].x, y: state.computed[id].y }, moved: false };
      } else if (ev.target.classList && ev.target.classList.contains('ad-edge')) {
        var idx = Number(ev.target.getAttribute('data-ad-edge'));
        gesture = { mode: 'edgeclick', idx: idx };
      } else {
        gesture = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, cam0: { x: state.cam.x, y: state.cam.y }, moved: false };
        host.classList.add('ad-panning');
      }
    }

    function onPointerMove(ev) {
      if (!pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (!gesture) return;
      if (gesture.mode === 'pinch') {
        var pts = Object.keys(pointers).map(function (id) { return pointers[id]; });
        if (pts.length < 2) return;
        var k = clamp(gesture.k0 * dist(pts[0], pts[1]) / Math.max(1, gesture.d0), 0.2, 2.5);
        var m = mid(pts[0], pts[1]);
        var r = host.getBoundingClientRect();
        // keep the world point under the pinch midpoint stationary
        var wx = (gesture.mid0.x - r.left - gesture.cam0.x) / gesture.k0;
        var wy = (gesture.mid0.y - r.top - gesture.cam0.y) / gesture.k0;
        state.cam.k = k;
        state.cam.x = (m.x - r.left) - wx * k;
        state.cam.y = (m.y - r.top) - wy * k;
        applyCam(false);
        return;
      }
      if (gesture.mode === 'pan') {
        gesture.moved = gesture.moved || Math.abs(ev.clientX - gesture.sx) + Math.abs(ev.clientY - gesture.sy) > 3;
        state.cam.x = gesture.cam0.x + (ev.clientX - gesture.sx);
        state.cam.y = gesture.cam0.y + (ev.clientY - gesture.sy);
        applyCam(false);
        return;
      }
      if (gesture.mode === 'node') {
        var dx = (ev.clientX - gesture.sx) / state.cam.k;
        var dy = (ev.clientY - gesture.sy) / state.cam.k;
        if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 4 / state.cam.k) return;
        if (!state.draggable) return;
        gesture.moved = true;
        state.els[gesture.id].classList.add('ad-dragging');
        state.computed[gesture.id] = { x: gesture.start.x + dx, y: gesture.start.y + dy };
        place(gesture.id);
        redrawEdgesFor(gesture.id);
      }
    }

    function onPointerUp(ev) {
      delete pointers[ev.pointerId];
      host.classList.remove('ad-panning');
      if (!gesture) return;
      var g = gesture;
      if (Object.keys(pointers).length > 0 && g.mode === 'pinch') return; // wait for the second finger
      gesture = null;
      if (g.mode === 'node') {
        if (g.moved) {
          state.els[g.id].classList.remove('ad-dragging');
          state.positions[g.id] = { x: state.computed[g.id].x, y: state.computed[g.id].y };
          if (opts.onLayoutChange) opts.onLayoutChange(getPositions());
        } else {
          select({ type: 'node', id: g.id });
        }
      } else if (g.mode === 'edgeclick') {
        var p = state.paths[g.idx];
        if (p) select({ type: 'edge', edge: p.edge });
      } else if (g.mode === 'pan' && !g.moved) {
        select(null);
      }
    }

    function onWheel(ev) {
      ev.preventDefault();
      var factor = Math.pow(1.0015, -ev.deltaY);
      var k = clamp(state.cam.k * factor, 0.2, 2.5);
      var r = host.getBoundingClientRect();
      var wx = (ev.clientX - r.left - state.cam.x) / state.cam.k;
      var wy = (ev.clientY - r.top - state.cam.y) / state.cam.k;
      state.cam.k = k;
      state.cam.x = (ev.clientX - r.left) - wx * k;
      state.cam.y = (ev.clientY - r.top) - wy * k;
      applyCam(false);
    }

    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    host.addEventListener('wheel', onWheel, { passive: false });

    // ── public surface ──
    function bbox() {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      state.nodes.forEach(function (n) {
        var p = state.computed[n.id]; var s = state.sizes[n.id] || { w: 170, h: 62 };
        if (!p) return;
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
      });
      if (minX === Infinity) return { x: 0, y: 0, w: 1, h: 1 };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function fit(animated) {
      var b = bbox();
      var pad = 36;
      var k = clamp(Math.min((host.clientWidth - pad * 2) / b.w, (host.clientHeight - pad * 2) / b.h, 1.4), 0.2, 2.5);
      state.cam.k = k;
      state.cam.x = (host.clientWidth - b.w * k) / 2 - b.x * k;
      state.cam.y = (host.clientHeight - b.h * k) / 2 - b.y * k;
      applyCam(animated !== false);
    }

    function zoomTo(id, animated) {
      var p = state.computed[id]; var s = state.sizes[id];
      if (!p || !s) return;
      var k = clamp(Math.max(state.cam.k, 1), 0.2, 2.5);
      state.cam.k = k;
      state.cam.x = host.clientWidth / 2 - (p.x + s.w / 2) * k;
      state.cam.y = host.clientHeight / 2 - (p.y + s.h / 2) * k;
      applyCam(animated !== false);
    }

    function getPositions() {
      var out = {};
      for (var id in state.positions) out[id] = { x: state.positions[id].x, y: state.positions[id].y };
      return out;
    }

    function setData(data) {
      state.nodes = (data.nodes || []).slice();
      state.edges = (data.edges || []).slice();
      state.byId = {};
      state.nodes.forEach(function (n) { state.byId[n.id] = n; });
      var sel = state.selected;
      renderNodes();
      // keep a still-existing selection highlighted across re-renders
      if (sel && sel.type === 'node' && state.byId[sel.id]) state.els[sel.id].classList.add('ad-selected');
      else state.selected = null;
    }

    function setNodeState(id, st) {
      var n = state.byId[id]; var el = state.els[id];
      if (!n || !el) return;
      var prev = n.state;
      n.state = st;
      el.className = el.className.replace(/\bad-state-[a-z-]+\b/g, '').replace(/\s+/g, ' ').trim();
      if (st) el.classList.add('ad-state-' + st);
      if (st === 'green' && prev !== 'green') {
        el.classList.remove('ad-pop');
        void el.offsetWidth; // restart the pop animation
        el.classList.add('ad-pop');
      }
      syncEdgeActivity();
    }

    function destroy() {
      state.destroyed = true;
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('wheel', onWheel);
      host.classList.remove('ad-host');
      world.remove();
    }

    // initial render
    setData({ nodes: opts.nodes || [], edges: opts.edges || [] });
    applyCam(false);
    if (opts.fit !== false) {
      // fit after layout has real sizes (next frame — the host may have just been inserted)
      requestAnimationFrame(function () { if (!state.destroyed) fit(false); });
    }

    return {
      el: host,
      setData: setData,
      setNodeState: setNodeState,
      select: function (id) { select(id == null ? null : { type: 'node', id: id }); },
      fit: fit,
      zoomTo: zoomTo,
      getPositions: getPositions,
      relayout: function () { state.positions = {}; renderNodes(); fit(); },
      destroy: destroy,
    };
  }

  AIMEAT.dag = { Canvas: Canvas, layout: layout };

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
