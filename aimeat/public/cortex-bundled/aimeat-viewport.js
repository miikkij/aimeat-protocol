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
      /* Sweep first. The selector decides WHO gets an overlay, so an element that has left the set
         must lose the one it already has. Only matching elements were visited, so a consumer that
         excludes a frame at runtime — "let me use just this one" — kept a dead overlay sitting on
         top of it and the frame stayed unclickable with no way to tell why. */
      var stale = world.querySelectorAll('.' + P + '-capture');
      for (var k = 0; k < stale.length; k++) {
        var owner = stale[k].parentElement;
        if (owner && owner.matches && !owner.matches(opts.captureSelector)) stale[k].remove();
      }
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

  AIMEAT.viewport = { create: create, VERSION: '1.0.4' };

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
