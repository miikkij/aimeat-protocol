/**
 * @file aimeat-dag.js
 * @description Generic DAG / graph canvas for AIMEAT apps. Renders a directed acyclic graph
 *   (workflow blueprints, pipelines, org charts, crew task graphs) with automatic layered layout,
 *   click/tap selection, optional node dragging, and a live state layer (running dash-flow edges,
 *   waiting-human pulse, green/red transitions). Zero dependencies; theme-aware via the app's CSS
 *   variables (--card/--text/--border/--accent/--bg); honours prefers-reduced-motion.
 *
 *   Since v1.1.0 the camera (pan / zoom-at-cursor / pinch / fit / centre) is NOT implemented here
 *   — it is aimeat-viewport, embedded verbatim below so this pack keeps shipping as ONE
 *   self-contained script tag with no `requires`. The embedded copy is generated: run
 *   `pnpm sync:viewport` after editing aimeat-viewport.js, and `pnpm check:viewport` fails the
 *   build if the two ever drift.
 * @structure
 *   - embedded aimeat-viewport (generated region — do not hand-edit)
 *   - THEME_CSS / injectTheme      → dag cosmetics only; the viewport owns structural CSS
 *   - layout(nodes, edges, opts)   → pure layered layout, also exposed as AIMEAT.dag.layout
 *   - Canvas(el, opts)             → the graph canvas, mounted on a viewport instance
 * @usage
 *   <script src="/v1/cortex/aimeat-dag/libs/aimeat-dag.js"></script>
 *   const dag = AIMEAT.dag.Canvas('#canvas', {
 *     nodes: [{ id: 'fetch', label: 'Fetch', sub: 'news-bot' }, { id: 'write', label: 'Write' }],
 *     edges: [{ from: 'fetch', to: 'write' }],
 *     onSelect: (item) => console.log('selected', item),
 *   });
 *   dag.setNodeState('fetch', 'running');   // animated dash-flow on incoming edges
 *   dag.fit();
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: layered auto-layout, pan/zoom/pinch, selection, node drag with
 *     position persistence, live state layer, prefers-reduced-motion support.
 *   v1.0.1 — 2026-07-16 — Fix: setPointerCapture is best-effort (try/catch) — synthetic
 *     PointerEvents and pointers released mid-dispatch threw NotFoundError and swallowed the
 *     whole pointerdown, breaking selection.
 *   v1.1.0 — 2026-07-25 — Camera extracted to aimeat-viewport (TARGET-051) and embedded here.
 *     Behaviour-preserving and API-preserving: same public surface, same class names, same
 *     gesture semantics, same 0.2–2.5 zoom clamp, same fit padding and easing. Consumers need no
 *     change. Dead code removed: clientToWorld was defined and never called — it is now real
 *     public API on the viewport.
 */

/* The camera lives in aimeat-viewport.js and is copied in verbatim below so this pack keeps
 * shipping as one script tag with no `requires`. Edit the SOURCE file, then `pnpm sync:viewport`.
 * `pnpm check:viewport` (pre-commit + CI) fails if the copy ever drifts from the source. */
/* BEGIN embedded aimeat-viewport — GENERATED, DO NOT EDIT (pnpm sync:viewport) */
/**
 * @file aimeat-viewport.js
 * @description The shared CAMERA primitive for AIMEAT canvas surfaces — pan, zoom-at-cursor,
 *   pinch, drag delegation, animated fit/centerOn, and the navigate/interact capture-overlay
 *   model that makes panning work over children which swallow pointer events (iframes). It owns
 *   the camera and NOTHING about content: what counts as draggable content is answered by the
 *   consumer through the `onClaimPointer` hit-test delegate. Extracted verbatim-in-behaviour from
 *   aimeat-dag v1.0.1 (TARGET-051) so a second consumer does not mean a third pan/zoom
 *   implementation; aimeat-dag now sits on this and embeds a byte-identical copy of this file so
 *   it can stay a single self-contained script tag.
 * @structure
 *   - injectCss(prefix)            → structural CSS for one class prefix (host/world/panning/overlay)
 *   - create(hostOrSelector, opts) → the viewport instance
 *   - instance: world, cam(), scale(), setCamera(), fit(), centerOn(), clientToWorld(),
 *     worldToClient(), setMode(), getMode(), refreshCaptures(), destroy()
 * @usage
 *   <script src="/v1/cortex/aimeat-viewport/libs/aimeat-viewport.js"></script>
 *   const vp = AIMEAT.viewport.create('#board', {
 *     classPrefix: 'og', minZoom: 0.05, maxZoom: 3,
 *     captureSelector: '[data-og-frame]',            // enables the navigate/interact model
 *     contentBBox: () => boundsOfAllFrames(),
 *     onClaimPointer: (ev) => { const f = ev.target.closest('[data-og-frame]'); return f ? handleFor(f) : null; },
 *   });
 *   vp.world.appendChild(frameEl);   // children live in world space
 * @version-history
 *   v1.0.3 — 2026-07-25 — Report the version the manifest declares; the constant and the
 *     manifest had crossed. pnpm check:viewport now asserts they match.
 *   v1.0.1 — 2026-07-25 — Fix: do not force position:relative on the host (it beat a consumer's
 *     own position:fixed at the same specificity and collapsed a full-screen board to 0px);
 *     create() promotes the host only when its computed position is static.
 *   v1.0.0 — 2026-07-25 — Initial (TARGET-051 Slice 1): camera extracted from aimeat-dag v1.0.1.
 *     Behaviour-preserving for dag (same gesture semantics, same zoom clamps as defaults, same
 *     easing and reduced-motion handling); new for other consumers are classPrefix, configurable
 *     zoom bounds, the pointer-claim delegate, clientToWorld/worldToClient as public API (it was
 *     dead code in dag), and the navigate/interact capture overlays.
 */
(function (global) {
  'use strict';

  var AIMEAT = global.AIMEAT = global.AIMEAT || {};

  // Idempotent: aimeat-dag embeds a copy of this file so it can ship as one script tag. Loading
  // both the standalone pack and dag must not redefine the namespace.
  if (AIMEAT.viewport) return;

  var REDUCED = false;
  try { REDUCED = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* noop */ }

  var ANIM_MS = 320;
  var ANIM_EASE = 'cubic-bezier(.22,1,.36,1)';

  // Structural CSS only — the consumer owns cosmetics (size, background, radius). Keeping the two
  // sets disjoint means injection order never matters and no rule fights another.
  var injected = {};
  function injectCss(p) {
    if (injected[p]) return;
    var css = [
      /* NOTE: `position` is deliberately NOT set here. The host only has to be a positioning
         context, and a consumer may already be one in a way that matters — a full-screen board is
         `position: fixed; inset: 0`, and a same-specificity `position: relative` from this
         stylesheet would silently win, collapse the host to zero height and leave every pointer
         event landing on nothing. create() promotes the host only when it is actually static. */
      '.' + p + '-host { overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }',
      '.' + p + '-host.' + p + '-panning { cursor: grabbing; }',
      '.' + p + '-host.' + p + '-interact { cursor: default; }',
      '.' + p + '-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }',
      '.' + p + '-world.' + p + '-animated { transition: transform ' + ANIM_MS + 'ms ' + ANIM_EASE + '; }',
      // The capture overlay: transparent, fills its host child, sits above iframe content so the
      // pointer stream reaches the viewport instead of being swallowed.
      '.' + p + '-capture { position: absolute; inset: 0; z-index: 5; background: transparent; cursor: inherit; }',
      '@media (prefers-reduced-motion: reduce) { .' + p + '-world.' + p + '-animated { transition: none; } }',
    ].join('\n');
    var style = document.createElement('style');
    style.setAttribute('data-aimeat-viewport', p);
    style.textContent = css;
    document.head.appendChild(style);
    injected[p] = true;
  }

  function resolveEl(elOrSelector) {
    return typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function isTextEntry(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
  }

  /**
   * Create a viewport over `host`. The instance creates and owns the `world` element; put your
   * content inside `vp.world` and position it in world coordinates.
   *
   * @param {Element|string} hostOrSelector clipping host (the consumer gives it a size)
   * @param {Object} [opts]
   * @param {string}   [opts.classPrefix='av'] prefix for host/world/panning/capture classes — a
   *   consumer that already ships CSS selectors passes its own so nothing renames.
   * @param {number}   [opts.minZoom=0.2] @param {number} [opts.maxZoom=2.5]
   * @param {Object}   [opts.initial={x:40,y:40,k:1}] starting camera
   * @param {number}   [opts.fitPadding=36] @param {number} [opts.fitMaxZoom=1.4]
   * @param {number}   [opts.centerMinZoom=1] centerOn() zooms in to at least this
   * @param {number}   [opts.dragThreshold=4] client px before a claimed pointer counts as moved
   * @param {Function} [opts.contentBBox] () → {x,y,w,h} in world units; required for fit()
   * @param {Function} [opts.onClaimPointer] (ev) → null (viewport pans) | drag handle
   *   { onMove(worldDx, worldDy, ev, cam), onEnd(movedPastThreshold, ev) }
   * @param {Function} [opts.onTap] (ev) fired when a pan gesture ends without moving
   * @param {Function} [opts.onCameraChange] (cam) after any camera change
   * @param {string}   [opts.captureSelector] children matching this get a capture overlay in
   *   navigate mode. Supplying it OPTS IN to the two-mode model (space-hold, middle-mouse pan,
   *   Esc). Omit it and no window listeners are attached at all.
   * @param {string}   [opts.mode='navigate']
   */
  function create(hostOrSelector, opts) {
    opts = opts || {};
    var host = resolveEl(hostOrSelector);
    if (!host) throw new Error('aimeat-viewport: host element not found');

    var P = opts.classPrefix || 'av';
    var minZoom = opts.minZoom != null ? opts.minZoom : 0.2;
    var maxZoom = opts.maxZoom != null ? opts.maxZoom : 2.5;
    var fitPadding = opts.fitPadding != null ? opts.fitPadding : 36;
    var fitMaxZoom = opts.fitMaxZoom != null ? opts.fitMaxZoom : 1.4;
    var centerMinZoom = opts.centerMinZoom != null ? opts.centerMinZoom : 1;
    var dragThreshold = opts.dragThreshold != null ? opts.dragThreshold : 4;
    var twoMode = !!opts.captureSelector;

    injectCss(P);
    host.classList.add(P + '-host');
    /* The world is absolutely positioned, so the host must be a positioning context — but only
       promote it when it is static. Overwriting an existing fixed/absolute/sticky host is how a
       full-screen board ends up 0px tall. */
    if (global.getComputedStyle(host).position === 'static') host.style.position = 'relative';

    var world = document.createElement('div');
    world.className = P + '-world';
    host.appendChild(world);

    var init = opts.initial || {};
    var cam = { x: init.x != null ? init.x : 40, y: init.y != null ? init.y : 40, k: init.k != null ? init.k : 1 };
    var mode = opts.mode === 'interact' ? 'interact' : 'navigate';
    var spaceHeld = false;
    var destroyed = false;

    function emitCam() { if (opts.onCameraChange) opts.onCameraChange({ x: cam.x, y: cam.y, k: cam.k }); }

    function applyCam(animated) {
      if (animated && !REDUCED) {
        world.classList.add(P + '-animated');
        setTimeout(function () { world.classList.remove(P + '-animated'); }, ANIM_MS + 40);
      }
      world.style.transform = 'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.k + ')';
      emitCam();
    }

    // ── capture overlays ──────────────────────────────────────────────────────
    // Children that handle their own pointer events (iframes above all) swallow the stream and
    // panning over them silently stops working. In navigate mode each one gets a transparent
    // overlay; in interact mode the overlays come off and the child behaves normally.
    function refreshCaptures() {
      if (!twoMode) return;
      var wants = (mode === 'navigate') || spaceHeld;
      var targets = world.querySelectorAll(opts.captureSelector);
      for (var i = 0; i < targets.length; i++) {
        var el = targets[i];
        var existing = el.querySelector(':scope > .' + P + '-capture');
        if (wants && !existing) {
          var ov = document.createElement('div');
          ov.className = P + '-capture';
          ov.setAttribute('aria-hidden', 'true');
          el.appendChild(ov);
        } else if (!wants && existing) {
          existing.remove();
        }
      }
    }

    function setMode(next) {
      var m = next === 'interact' ? 'interact' : 'navigate';
      if (m === mode) return;
      mode = m;
      host.classList.toggle(P + '-interact', mode === 'interact');
      refreshCaptures();
    }

    // ── pointer interactions ──────────────────────────────────────────────────
    var pointers = {};   // pointerId → {x,y}
    var gesture = null;  // {mode:'pan'|'pinch'|'claim', ...}

    function clientToWorld(cx, cy) {
      var r = host.getBoundingClientRect();
      return { x: (cx - r.left - cam.x) / cam.k, y: (cy - r.top - cam.y) / cam.k };
    }
    function worldToClient(wx, wy) {
      var r = host.getBoundingClientRect();
      return { x: wx * cam.k + cam.x + r.left, y: wy * cam.k + cam.y + r.top };
    }

    function beginPan(ev) {
      gesture = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, cam0: { x: cam.x, y: cam.y }, moved: false };
      host.classList.add(P + '-panning');
    }

    function onPointerDown(ev) {
      // Capture is best-effort: synthetic PointerEvents (tests, automation) and pointers released
      // mid-dispatch have no active pointer and would throw NotFoundError, swallowing the whole
      // pointerdown. (aimeat-dag v1.0.1 shipped this as a real bug fix.)
      try { host.setPointerCapture && host.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };

      if (Object.keys(pointers).length === 2) {
        var pts = Object.keys(pointers).map(function (id) { return pointers[id]; });
        gesture = {
          mode: 'pinch', d0: dist(pts[0], pts[1]), k0: cam.k,
          mid0: mid(pts[0], pts[1]), cam0: { x: cam.x, y: cam.y },
        };
        return;
      }

      // Middle mouse always pans, and holding space is a temporary navigate — both are the
      // conventions users bring from other canvas tools.
      if (twoMode && (ev.button === 1 || spaceHeld)) { beginPan(ev); return; }

      var handle = opts.onClaimPointer ? opts.onClaimPointer(ev) : null;
      if (handle) {
        gesture = { mode: 'claim', handle: handle, sx: ev.clientX, sy: ev.clientY, moved: false };
        return;
      }
      beginPan(ev);
    }

    function onPointerMove(ev) {
      if (!pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (!gesture) return;

      if (gesture.mode === 'pinch') {
        var pts = Object.keys(pointers).map(function (id) { return pointers[id]; });
        if (pts.length < 2) return;
        var k = clamp(gesture.k0 * dist(pts[0], pts[1]) / Math.max(1, gesture.d0), minZoom, maxZoom);
        var m = mid(pts[0], pts[1]);
        var r = host.getBoundingClientRect();
        // keep the world point under the pinch midpoint stationary
        var wx = (gesture.mid0.x - r.left - gesture.cam0.x) / gesture.k0;
        var wy = (gesture.mid0.y - r.top - gesture.cam0.y) / gesture.k0;
        cam.k = k;
        cam.x = (m.x - r.left) - wx * k;
        cam.y = (m.y - r.top) - wy * k;
        applyCam(false);
        return;
      }

      if (gesture.mode === 'pan') {
        gesture.moved = gesture.moved || Math.abs(ev.clientX - gesture.sx) + Math.abs(ev.clientY - gesture.sy) > 3;
        cam.x = gesture.cam0.x + (ev.clientX - gesture.sx);
        cam.y = gesture.cam0.y + (ev.clientY - gesture.sy);
        applyCam(false);
        return;
      }

      if (gesture.mode === 'claim') {
        var dx = (ev.clientX - gesture.sx) / cam.k;
        var dy = (ev.clientY - gesture.sy) / cam.k;
        if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < dragThreshold / cam.k) return;
        gesture.moved = true;
        if (gesture.handle.onMove) gesture.handle.onMove(dx, dy, ev, { x: cam.x, y: cam.y, k: cam.k });
      }
    }

    function onPointerUp(ev) {
      delete pointers[ev.pointerId];
      host.classList.remove(P + '-panning');
      if (!gesture) return;
      var g = gesture;
      // A pinch that lost one finger keeps waiting for the other to lift.
      if (Object.keys(pointers).length > 0 && g.mode === 'pinch') return;
      gesture = null;
      if (g.mode === 'claim') {
        if (g.handle.onEnd) g.handle.onEnd(g.moved, ev);
      } else if (g.mode === 'pan' && !g.moved) {
        if (opts.onTap) opts.onTap(ev);
      }
    }

    function onWheel(ev) {
      ev.preventDefault();
      var factor = Math.pow(1.0015, -ev.deltaY);
      var k = clamp(cam.k * factor, minZoom, maxZoom);
      var r = host.getBoundingClientRect();
      var wx = (ev.clientX - r.left - cam.x) / cam.k;
      var wy = (ev.clientY - r.top - cam.y) / cam.k;
      cam.k = k;
      cam.x = (ev.clientX - r.left) - wx * k;
      cam.y = (ev.clientY - r.top) - wy * k;
      applyCam(false);
    }

    function onKeyDown(ev) {
      if (ev.code !== 'Space' || spaceHeld || isTextEntry(ev.target)) return;
      spaceHeld = true;
      host.classList.add(P + '-panning');
      refreshCaptures();
      ev.preventDefault();   // stop the page from scrolling under a held space
    }
    function onKeyUp(ev) {
      if (ev.code === 'Escape') { setMode('navigate'); return; }
      if (ev.code !== 'Space' || !spaceHeld) return;
      spaceHeld = false;
      if (!gesture) host.classList.remove(P + '-panning');
      refreshCaptures();
    }

    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    host.addEventListener('wheel', onWheel, { passive: false });
    if (twoMode) {
      global.addEventListener('keydown', onKeyDown);
      global.addEventListener('keyup', onKeyUp);
      host.classList.toggle(P + '-interact', mode === 'interact');
    }

    // ── camera moves ──────────────────────────────────────────────────────────
    function setCamera(next, animated) {
      if (next.k != null) cam.k = clamp(next.k, minZoom, maxZoom);
      if (next.x != null) cam.x = next.x;
      if (next.y != null) cam.y = next.y;
      applyCam(!!animated);
    }

    function fit(animated) {
      var b = opts.contentBBox ? opts.contentBBox() : null;
      if (!b || !(b.w > 0) || !(b.h > 0)) return;
      var k = clamp(Math.min(
        (host.clientWidth - fitPadding * 2) / b.w,
        (host.clientHeight - fitPadding * 2) / b.h,
        fitMaxZoom,
      ), minZoom, maxZoom);
      cam.k = k;
      cam.x = (host.clientWidth - b.w * k) / 2 - b.x * k;
      cam.y = (host.clientHeight - b.h * k) / 2 - b.y * k;
      applyCam(animated !== false);
    }

    /** Centre the camera on a world-space rect {x,y,w,h}, zooming in to at least centerMinZoom. */
    function centerOn(rect, animated) {
      if (!rect) return;
      var k = clamp(Math.max(cam.k, centerMinZoom), minZoom, maxZoom);
      cam.k = k;
      cam.x = host.clientWidth / 2 - (rect.x + rect.w / 2) * k;
      cam.y = host.clientHeight / 2 - (rect.y + rect.h / 2) * k;
      applyCam(animated !== false);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('wheel', onWheel);
      if (twoMode) {
        global.removeEventListener('keydown', onKeyDown);
        global.removeEventListener('keyup', onKeyUp);
      }
      host.classList.remove(P + '-host', P + '-panning', P + '-interact');
      world.remove();
    }

    applyCam(false);

    return {
      host: host,
      world: world,
      cam: function () { return { x: cam.x, y: cam.y, k: cam.k }; },
      scale: function () { return cam.k; },
      setCamera: setCamera,
      fit: fit,
      centerOn: centerOn,
      clientToWorld: clientToWorld,
      worldToClient: worldToClient,
      setMode: setMode,
      getMode: function () { return spaceHeld ? 'navigate' : mode; },
      refreshCaptures: refreshCaptures,
      destroy: destroy,
    };
  }

  AIMEAT.viewport = { create: create, VERSION: '1.0.3' };

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
/* END embedded aimeat-viewport */

(function (global) {
  'use strict';

  var AIMEAT = global.AIMEAT = global.AIMEAT || {};

  if (!AIMEAT.viewport) throw new Error('aimeat-dag: aimeat-viewport missing (embed out of sync)');

  // Cosmetics only. The viewport owns the structural rules for .ad-host and .ad-world
  // (position, overflow, touch-action, cursor, transform, transition) — the two sets are kept
  // disjoint so injection order never matters and no rule fights another.
  var THEME_CSS = [
    '.ad-host { width: 100%; height: 100%; min-height: 320px; background: var(--bg, transparent); border-radius: 12px; }',
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

    var state = {
      nodes: [], edges: [], byId: {}, els: {}, paths: [],
      positions: {},                    // manual overrides (id → {x,y})
      computed: {},                     // effective positions after layout
      sizes: {},
      selected: null,
      direction: opts.direction === 'TB' ? 'TB' : 'LR',
      draggable: opts.draggable !== false,
      destroyed: false,
    };
    if (opts.positions) for (var k in opts.positions) state.positions[k] = { x: opts.positions[k].x, y: opts.positions[k].y };

    // The camera. classPrefix 'ad' keeps every existing .ad-host / .ad-world selector an app may
    // have styled; the zoom clamp and fit padding are the values this pack has always used.
    var vp = AIMEAT.viewport.create(host, {
      classPrefix: 'ad',
      minZoom: 0.2,
      maxZoom: 2.5,
      initial: { x: 40, y: 40, k: 1 },
      fitPadding: 36,
      fitMaxZoom: 1.4,
      centerMinZoom: 1,
      contentBBox: function () { return bbox(); },
      onClaimPointer: function (ev) { return claimPointer(ev); },
      onTap: function () { select(null); },
    });

    var world = vp.world;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ad-edges');
    svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
    var nodeLayer = document.createElement('div');
    world.appendChild(svg);
    world.appendChild(nodeLayer);

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

    /**
     * The viewport's hit-test delegate: claim nodes and edges, let everything else pan.
     * `dragged` lives in the handle closure rather than using the viewport's threshold flag
     * because a NON-draggable node that the pointer moved over must still count as a click.
     */
    function claimPointer(ev) {
      var nodeEl = ev.target.closest ? ev.target.closest('.ad-node') : null;
      if (nodeEl) {
        var id = nodeEl.getAttribute('data-ad-id');
        var from = state.computed[id];
        if (!from) return null;
        var start = { x: from.x, y: from.y };
        var dragged = false;
        return {
          onMove: function (dx, dy) {
            if (!state.draggable) return;
            dragged = true;
            state.els[id].classList.add('ad-dragging');
            state.computed[id] = { x: start.x + dx, y: start.y + dy };
            place(id);
            redrawEdgesFor(id);
          },
          onEnd: function () {
            if (dragged) {
              state.els[id].classList.remove('ad-dragging');
              state.positions[id] = { x: state.computed[id].x, y: state.computed[id].y };
              if (opts.onLayoutChange) opts.onLayoutChange(getPositions());
            } else {
              select({ type: 'node', id: id });
            }
          },
        };
      }
      if (ev.target.classList && ev.target.classList.contains('ad-edge')) {
        var idx = Number(ev.target.getAttribute('data-ad-edge'));
        return {
          onEnd: function () {
            var p = state.paths[idx];
            if (p) select({ type: 'edge', edge: p.edge });
          },
        };
      }
      return null;
    }

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
      vp.fit(animated);
    }

    function zoomTo(id, animated) {
      var p = state.computed[id]; var s = state.sizes[id];
      if (!p || !s) return;
      vp.centerOn({ x: p.x, y: p.y, w: s.w, h: s.h }, animated);
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
      vp.destroy();
    }

    // initial render
    setData({ nodes: opts.nodes || [], edges: opts.edges || [] });
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
      /** The underlying camera (aimeat-viewport). Read-only in spirit — prefer fit/zoomTo. */
      viewport: vp,
    };
  }

  AIMEAT.dag = { Canvas: Canvas, layout: layout };

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
