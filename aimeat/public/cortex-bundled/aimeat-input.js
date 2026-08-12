/**
 * @file aimeat-input.js
 * @description The shared INPUT primitive for AIMEAT apps: tap, double-tap, long-press, swipe and
 *   drag as one Pointer Events implementation, with a keyboard equivalent for every gesture so the
 *   same code answers a finger and a keyboard. It owns gesture recognition and NOTHING about what a
 *   gesture means. Written because mobile input was the one part of the mobile story the platform
 *   had no answer for: the layout rules (overflow, viewport, the chrome strip) are covered in the
 *   build-app prompt and in fifteen appdev pitfalls, while touch handling was hand-rolled per app
 *   and per pack. `aimeat-viewport` remains the CAMERA for a movable surface; this pack is gestures
 *   on an element, and the two compose (see `claimFor`).
 * @structure
 *   - injectCss()                      → structural CSS (touch-action, tap highlight, pad geometry)
 *   - tappable(el, onActivate, opts)   → an element that behaves as a button on both inputs
 *   - on(el, handlers, opts)           → gesture recognizer, returns a handle
 *   - haptic(kind)                     → navigator.vibrate where it exists, no-op elsewhere
 *   - pad(host, opts)                  → virtual thumbstick / dpad, WASD + arrows on desktop
 *   - isCoarse(), hasHover(), claimFor()
 * @usage
 *   <script src="/v1/cortex/aimeat-input/libs/aimeat-input.js"></script>
 *   AIMEAT.input.tappable(btn, () => open(card));                  // buttons and cards
 *   AIMEAT.input.on(list, {                                        // gesture surfaces
 *     swipe: (dir) => dir === 'left' && archive(),
 *     longPress: () => menu(),
 *   }, { axis: 'x' });                                             // vertical scrolling survives
 * @version-history
 *   v1.0.0 — 2026-08-12 — Initial release. Pointer Events only (never touch+mouse together),
 *     one gesture state machine per element, keyboard equivalence on by default, touch-action
 *     derived from the handlers you register, and the trailing synthetic click suppressed once a
 *     gesture has consumed the interaction. The pad contains its own absolutely positioned parts
 *     (overflow: clip) and re-places them on resize: browser verification at 390px caught this pack
 *     inflating the page by 444px, which is the very failure the mobile checklist warns about.
 */
(function (global) {
  'use strict';

  var AIMEAT = global.AIMEAT = global.AIMEAT || {};

  // Idempotent, in case a pack embeds a copy the way aimeat-dag embeds the viewport.
  if (AIMEAT.input) return;

  var VERSION = '1.0.0';

  // Defaults chosen from the platform conventions rather than invented: 44px is the touch target
  // the mobile checklist already asks for, 500ms is the long-press users bring from the OS, and a
  // 10px slop is what separates a tap from the start of a scroll on a real thumb.
  var TAP_SLOP = 10;          // client px a tap may drift and still count as a tap
  var LONG_PRESS_MS = 500;
  var DOUBLE_TAP_MS = 300;
  var SWIPE_MIN_PX = 40;
  var SWIPE_MAX_MS = 600;
  var CLICK_SUPPRESS_MS = 400;

  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  function media(q) {
    try { return !!(global.matchMedia && global.matchMedia(q).matches); } catch (e) { /* noop */ }
    return false;
  }

  /** True on a finger/stylus-first device. Use it to CHOOSE a layout, never to skip mouse support. */
  function isCoarse() { return media('(pointer: coarse)'); }

  /** True where a real hover exists. A control whose meaning only appears on hover is unreachable without it. */
  function hasHover() { return media('(hover: hover)'); }

  function resolveEl(elOrSelector) {
    return typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
  }

  // Structural CSS only — no colour, no spacing, no font. The app owns every cosmetic, so injection
  // order never matters and nothing here can fight an app stylesheet.
  var cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    var css = [
      /* touch-action: manipulation removes the legacy 300ms tap delay without disabling scroll or
         pinch-zoom; -webkit-tap-highlight-color kills the grey iOS flash so the app's own pressed
         state is the only feedback. min-height/width come from a variable the app can raise but
         should not lower: 44px is the smallest target a thumb hits reliably. */
      '.ai-tap { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }',
      '.ai-tap-size { min-height: var(--ai-touch, 44px); min-width: var(--ai-touch, 44px); }',
      '.ai-grab { touch-action: none; user-select: none; -webkit-user-select: none; }',
      '.ai-pan-y { touch-action: pan-y; }',   /* horizontal gesture, vertical scrolling survives */
      '.ai-pan-x { touch-action: pan-x; }',
      /* The pad is positioned and sized here; everything visible about it is the app's own CSS on
         .ai-pad-base / .ai-pad-stick, which start with no paint at all. */
      /* overflow containment is load-bearing, not cosmetic: the base and the stick are absolutely
         positioned, so before the first touch (and after a viewport change that leaves a stale
         placement) they sit partly outside the host. Uncontained, they widen the PAGE, and one
         element wider than the screen makes a phone shrink-to-fit the whole document — the exact
         bug the mobile checklist exists to prevent. `clip` rather than `hidden` so the host does
         not become a scroll container. Measured at 390px: 444px of horizontal overflow without it. */
      '.ai-pad { position: relative; touch-action: none; user-select: none; -webkit-user-select: none; overflow: hidden; overflow: clip; }',
      '.ai-pad-base { position: absolute; width: var(--ai-pad-size, 128px); height: var(--ai-pad-size, 128px); margin-left: calc(var(--ai-pad-size, 128px) / -2); margin-top: calc(var(--ai-pad-size, 128px) / -2); border-radius: 50%; pointer-events: none; }',
      '.ai-pad-stick { position: absolute; width: var(--ai-pad-stick, 56px); height: var(--ai-pad-stick, 56px); margin-left: calc(var(--ai-pad-stick, 56px) / -2); margin-top: calc(var(--ai-pad-stick, 56px) / -2); border-radius: 50%; pointer-events: none; will-change: transform; }',
      '.ai-pad-idle .ai-pad-base, .ai-pad-idle .ai-pad-stick { opacity: var(--ai-pad-idle-opacity, 0.35); }',
      '@media (prefers-reduced-motion: reduce) { .ai-pad-stick { transition: none; } }',
    ].join('\n');
    var style = document.createElement('style');
    style.setAttribute('data-aimeat-input', '1');
    style.textContent = css;
    document.head.appendChild(style);
    cssInjected = true;
  }

  /**
   * Vibrate, where the device and the browser both allow it. Silent everywhere else, including
   * every desktop browser and iOS Safari, so it is safe to call unconditionally — it is never the
   * only feedback a user gets, only a reinforcement of feedback that is already on screen.
   *
   * @param {'light'|'medium'|'heavy'|'success'|'warning'|number|number[]} [kind='light']
   * @returns {boolean} whether the device actually buzzed
   */
  var HAPTICS = { light: 10, medium: 20, heavy: 35, success: [12, 40, 12], warning: [24, 60, 24] };
  function haptic(kind) {
    var pattern = typeof kind === 'number' || Array.isArray(kind) ? kind : HAPTICS[kind || 'light'];
    if (!pattern || !global.navigator || !global.navigator.vibrate) return false;
    try { return !!global.navigator.vibrate(pattern); } catch (e) { /* noop: blocked by policy */ }
    return false;
  }

  /**
   * Make an element behave as a button for a finger, a mouse and a keyboard alike.
   *
   * This listens for `click`, NOT for `touchstart` or `pointerdown`, and that is the whole point:
   * the browser already synthesizes a correct click from a tap, routes Enter and Space to it, and
   * announces it to a screen reader. Hand-rolling touchstart is what produces the double-fire, the
   * gesture that triggers mid-scroll, and the control a keyboard can never reach. What the browser
   * does NOT do on its own is remove the 300ms delay and the grey flash, so the class does that.
   *
   * Reach for `on()` instead only when a click is genuinely not enough: a canvas, a map, a surface
   * where the same pointer can also drag or swipe.
   *
   * @param {Element|string} elOrSelector
   * @param {Function} onActivate (ev) → void
   * @param {Object} [opts]
   * @param {boolean} [opts.size=true] enforce the 44px minimum target (--ai-touch)
   * @param {string}  [opts.role='button'] set only when the element has no implicit one
   * @param {string}  [opts.label] accessible name, when the element has no text of its own
   * @param {string|false} [opts.haptic='light'] buzz on activation
   * @returns {{destroy: Function}}
   */
  function tappable(elOrSelector, onActivate, opts) {
    opts = opts || {};
    var el = resolveEl(elOrSelector);
    if (!el) throw new Error('aimeat-input: element not found');
    injectCss();

    el.classList.add('ai-tap');
    if (opts.size !== false) el.classList.add('ai-tap-size');

    // A real <button> or <a href> already carries role, focus and keyboard activation. Adding them
    // to something else is what makes a <div> reachable; adding them to a button is noise.
    var tag = (el.tagName || '').toLowerCase();
    var native = tag === 'button' || (tag === 'a' && el.hasAttribute('href')) || tag === 'input';
    if (!native) {
      if (!el.hasAttribute('role')) el.setAttribute('role', opts.role || 'button');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    }
    if (opts.label && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', opts.label);

    function fire(ev) {
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return;
      if (opts.haptic !== false) haptic(opts.haptic || 'light');
      onActivate(ev);
    }
    function onClick(ev) { fire(ev); }
    function onKey(ev) {
      // Space scrolls the page and Enter submits a form; both are wrong here, and only for the
      // element we made focusable ourselves — a native control routes its own keys.
      if (native) return;
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      ev.preventDefault();
      fire(ev);
    }

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);

    return {
      destroy: function () {
        el.removeEventListener('click', onClick);
        el.removeEventListener('keydown', onKey);
        el.classList.remove('ai-tap', 'ai-tap-size');
      },
    };
  }

  var DIR_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  function directionOf(dx, dy, axis) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (axis === 'x') return dx < 0 ? 'left' : 'right';
    if (axis === 'y') return dy < 0 ? 'up' : 'down';
    if (ax >= ay) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }

  // Which scrolling the browser must keep doing while this element is under a finger. Derived from
  // the handlers actually registered, because the wrong value here is the single most damaging
  // mistake in touch code: `touch-action: none` on a list kills scrolling for the whole list, and
  // no value at all makes a horizontal swipe fight the page.
  function deriveTouchAction(h, axis) {
    if (h.dragMove || h.dragStart || h.dragEnd) return 'none';
    if (h.swipe) {
      if (axis === 'x') return 'pan-y';
      if (axis === 'y') return 'pan-x';
      return 'none';
    }
    return 'manipulation';
  }

  /**
   * Recognize gestures on one element. Pointer Events only, one gesture at a time, and every
   * gesture that can be expressed with a keyboard is.
   *
   * @param {Element|string} elOrSelector
   * @param {Object} handlers
   * @param {Function} [handlers.tap]        (ev, info) after a press that did not move or linger
   * @param {Function} [handlers.doubleTap]  (ev, info) two taps inside `doubleTapMs`
   * @param {Function} [handlers.longPress]  (ev, info) press held past `longPressMs` without moving
   * @param {Function} [handlers.swipe]      (dir, info) 'left'|'right'|'up'|'down'
   * @param {Function} [handlers.dragStart]  (ev, info) once the press passes the slop
   * @param {Function} [handlers.dragMove]   (ev, info) info carries dx, dy, and the per-event ddx/ddy
   * @param {Function} [handlers.dragEnd]    (ev, info) info carries the final dx, dy and velocity
   * @param {Object} [opts]
   * @param {'x'|'y'|'both'} [opts.axis='both'] which way swipes and drags are read. DECLARE THIS on
   *   anything that also scrolls: 'x' keeps vertical scrolling alive, 'both' takes the element out
   *   of scrolling entirely.
   * @param {boolean} [opts.keyboard=true] arrows fire `swipe`, Enter/Space fire `tap`, and the
   *   context-menu key or a right click fires `longPress`
   * @param {number}  [opts.slop=10] px of drift a tap tolerates
   * @param {number}  [opts.longPressMs=500] @param {number} [opts.doubleTapMs=300]
   * @param {number}  [opts.swipeMinPx=40] @param {number} [opts.swipeMaxMs=600]
   * @param {string|false} [opts.touchAction] override the derived value; false leaves CSS untouched
   * @param {string|false} [opts.haptic='light'] buzz when longPress fires (the one gesture with no
   *   visual start of its own)
   * @returns {{destroy: Function, update: Function, el: Element}}
   */
  function on(elOrSelector, handlers, opts) {
    opts = opts || {};
    var el = resolveEl(elOrSelector);
    if (!el) throw new Error('aimeat-input: element not found');
    var h = handlers || {};
    injectCss();

    var axis = opts.axis || 'both';
    var slop = opts.slop != null ? opts.slop : TAP_SLOP;
    var longMs = opts.longPressMs != null ? opts.longPressMs : LONG_PRESS_MS;
    var dblMs = opts.doubleTapMs != null ? opts.doubleTapMs : DOUBLE_TAP_MS;
    var swipeMin = opts.swipeMinPx != null ? opts.swipeMinPx : SWIPE_MIN_PX;
    var swipeMax = opts.swipeMaxMs != null ? opts.swipeMaxMs : SWIPE_MAX_MS;
    var keyboard = opts.keyboard !== false;

    if (opts.touchAction !== false) {
      el.style.touchAction = opts.touchAction || deriveTouchAction(h, axis);
      if (h.dragMove || h.dragStart) el.classList.add('ai-grab');
    }
    // A gesture surface that reports taps has to be reachable without a pointer at all.
    if (keyboard && (h.tap || h.swipe) && !el.hasAttribute('tabindex') && el.tabIndex < 0) {
      el.setAttribute('tabindex', '0');
    }

    var g = null;                 // the live gesture, or null
    var lastTapAt = 0;
    var suppressClickUntil = 0;
    var longTimer = null;

    function clearLongTimer() {
      if (longTimer) { clearTimeout(longTimer); longTimer = null; }
    }

    function info(extra) {
      var base = {
        dx: g ? g.x - g.sx : 0,
        dy: g ? g.y - g.sy : 0,
        duration: g ? nowMs() - g.t0 : 0,
        pointerType: g ? g.pointerType : 'keyboard',
        source: g ? 'pointer' : 'keyboard',
      };
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) base[k] = extra[k];
      return base;
    }

    // Once a gesture has consumed the interaction, the browser still delivers the synthetic click
    // that follows a tap. Without this the consumer gets the gesture AND a click, which is the
    // double-fire everyone hits when hand-rolling touch.
    function consumeClick() { suppressClickUntil = nowMs() + CLICK_SUPPRESS_MS; }
    function onClickCapture(ev) {
      if (nowMs() > suppressClickUntil) return;
      suppressClickUntil = 0;
      ev.stopPropagation();
      ev.preventDefault();
    }

    function onPointerDown(ev) {
      if (g) return;                       // a second finger never corrupts a gesture in flight
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      // Best-effort, for the same reason aimeat-viewport does it: a synthetic PointerEvent has no
      // active pointer and setPointerCapture throws NotFoundError, swallowing the whole pointerdown.
      try { el.setPointerCapture && el.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }

      g = {
        id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY,
        px: ev.clientX, py: ev.clientY, t0: nowMs(), moved: false, dragging: false,
        longFired: false, pointerType: ev.pointerType || 'mouse',
      };

      if (h.longPress) {
        longTimer = setTimeout(function () {
          if (!g || g.moved) return;
          g.longFired = true;
          if (opts.haptic !== false) haptic(opts.haptic || 'light');
          consumeClick();
          h.longPress(ev, info());
        }, longMs);
      }
    }

    function onPointerMove(ev) {
      if (!g || ev.pointerId !== g.id) return;
      g.px = g.x; g.py = g.y;
      g.x = ev.clientX; g.y = ev.clientY;

      if (!g.moved && Math.abs(g.x - g.sx) + Math.abs(g.y - g.sy) > slop) {
        g.moved = true;
        clearLongTimer();
        if (h.dragStart || h.dragMove || h.dragEnd) {
          g.dragging = true;
          if (h.dragStart) h.dragStart(ev, info());
        }
      }
      if (g.dragging && h.dragMove) h.dragMove(ev, info({ ddx: g.x - g.px, ddy: g.y - g.py }));
    }

    function onPointerUp(ev) {
      if (!g || ev.pointerId !== g.id) return;
      clearLongTimer();
      var cur = g;
      var dx = cur.x - cur.sx, dy = cur.y - cur.sy;
      var dt = nowMs() - cur.t0;
      var dist = Math.hypot(dx, dy);

      if (cur.dragging && h.dragEnd) {
        h.dragEnd(ev, info({ velocity: dt > 0 ? dist / dt : 0 }));
        consumeClick();
      } else if (h.swipe && cur.moved && dist >= swipeMin && dt <= swipeMax) {
        var dir = directionOf(dx, dy, axis);
        // An 'x' surface must not report a vertical flick as a horizontal swipe.
        var wrongWay = (axis === 'x' && Math.abs(dy) > Math.abs(dx)) || (axis === 'y' && Math.abs(dx) > Math.abs(dy));
        if (!wrongWay) {
          consumeClick();
          h.swipe(dir, info({ velocity: dt > 0 ? dist / dt : 0 }));
        }
      } else if (!cur.moved && !cur.longFired) {
        var at = nowMs();
        if (h.doubleTap && at - lastTapAt < dblMs) {
          lastTapAt = 0;
          consumeClick();
          h.doubleTap(ev, info());
        } else {
          lastTapAt = at;
          if (h.tap) { consumeClick(); h.tap(ev, info()); }
        }
      }
      g = null;
    }

    function onPointerCancel(ev) {
      if (!g || ev.pointerId !== g.id) return;
      clearLongTimer();
      if (g.dragging && h.dragEnd) h.dragEnd(ev, info({ cancelled: true }));
      g = null;
    }

    // Desktop equivalents. A right click is the mouse's long-press, and it is what a user with no
    // touchscreen will reach for; without this the context menu appears instead.
    function onContextMenu(ev) {
      if (!h.longPress || !keyboard) return;
      ev.preventDefault();
      h.longPress(ev, { dx: 0, dy: 0, duration: 0, pointerType: 'mouse', source: 'contextmenu' });
    }
    function onKeyDown(ev) {
      if (!keyboard) return;
      if (h.swipe && DIR_KEYS[ev.key]) {
        var dir = DIR_KEYS[ev.key];
        if (axis === 'x' && (dir === 'up' || dir === 'down')) return;
        if (axis === 'y' && (dir === 'left' || dir === 'right')) return;
        ev.preventDefault();
        h.swipe(dir, { dx: 0, dy: 0, duration: 0, velocity: 0, pointerType: 'keyboard', source: 'keyboard' });
        return;
      }
      if (h.tap && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar')) {
        ev.preventDefault();
        h.tap(ev, { dx: 0, dy: 0, duration: 0, pointerType: 'keyboard', source: 'keyboard' });
      }
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('keydown', onKeyDown);

    return {
      el: el,
      /** Swap the handlers without rebinding listeners or losing a gesture in flight. */
      update: function (next) { h = next || {}; },
      destroy: function () {
        clearLongTimer();
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('pointermove', onPointerMove);
        el.removeEventListener('pointerup', onPointerUp);
        el.removeEventListener('pointercancel', onPointerCancel);
        el.removeEventListener('click', onClickCapture, true);
        el.removeEventListener('contextmenu', onContextMenu);
        el.removeEventListener('keydown', onKeyDown);
        el.classList.remove('ai-grab');
        if (opts.touchAction !== false) el.style.touchAction = '';
      },
    };
  }

  /**
   * Bridge to aimeat-viewport: turn a drag handler into the drag handle its `onClaimPointer`
   * delegate expects, so an app can use one vocabulary for both packs. The viewport owns pan, zoom
   * and pinch on the surface; this pack owns what a gesture on a CHILD means. Neither reimplements
   * the other, and an app that loads both never has two recognizers fighting for one pointer.
   *
   *   const vp = AIMEAT.viewport.create('#board', {
   *     onClaimPointer: (ev) => {
   *       const card = ev.target.closest('[data-card]');
   *       return card ? AIMEAT.input.claimFor({ onMove: (dx, dy) => nudge(card, dx, dy) }) : null;
   *     },
   *   });
   *
   * @param {Object} spec { onMove(worldDx, worldDy, ev, cam), onEnd(moved, ev) }
   * @returns {Object} the same shape, safe to hand straight to the viewport
   */
  function claimFor(spec) {
    spec = spec || {};
    return {
      onMove: function (dx, dy, ev, cam) { if (spec.onMove) spec.onMove(dx, dy, ev, cam); },
      onEnd: function (moved, ev) { if (spec.onEnd) spec.onEnd(moved, ev); },
    };
  }

  /**
   * A virtual thumbstick for a game, and the keyboard that stands in for it on a desktop. Reports a
   * normalized vector on every change; the game reads it in its own loop or on the callback, and
   * nothing about how it LOOKS is decided here (the two elements start with no paint at all, so the
   * app skins them the way it skins aimeat-game, through its own CSS).
   *
   * @param {Element|string} hostOrSelector the area a thumb may land in (give it a size)
   * @param {Object} [opts]
   * @param {Function} [opts.onChange] ({x, y, angle, distance, active, source}) on every change
   * @param {'stick'|'dpad'} [opts.mode='stick'] dpad snaps the vector to 8 directions
   * @param {boolean} [opts.keyboard=true] WASD and the arrow keys drive the same vector
   * @param {boolean} [opts.floating=true] the base appears where the thumb lands, rather than fixed
   * @param {number}  [opts.deadZone=0.12] fraction of the radius that still reads as centre
   * @returns {{value: Function, destroy: Function, host: Element}}
   */
  function pad(hostOrSelector, opts) {
    opts = opts || {};
    var host = resolveEl(hostOrSelector);
    if (!host) throw new Error('aimeat-input: pad host not found');
    injectCss();

    var mode = opts.mode || 'stick';
    var floating = opts.floating !== false;
    var deadZone = opts.deadZone != null ? opts.deadZone : 0.12;
    var useKeys = opts.keyboard !== false;

    host.classList.add('ai-pad', 'ai-pad-idle');
    var base = document.createElement('div');
    base.className = 'ai-pad-base';
    var stick = document.createElement('div');
    stick.className = 'ai-pad-stick';
    host.appendChild(base);
    host.appendChild(stick);

    var radius = 0, originX = 0, originY = 0, pointerId = null;
    var vec = { x: 0, y: 0, angle: 0, distance: 0, active: false, source: 'none' };
    var keys = {};

    function place(cx, cy) {
      var r = host.getBoundingClientRect();
      originX = cx - r.left; originY = cy - r.top;
      base.style.left = originX + 'px'; base.style.top = originY + 'px';
      stick.style.left = originX + 'px'; stick.style.top = originY + 'px';
      radius = (base.offsetWidth || 128) / 2;
    }

    function emit(x, y, source) {
      var d = Math.min(1, Math.hypot(x, y));
      if (d < deadZone) { x = 0; y = 0; d = 0; }
      if (mode === 'dpad' && d > 0) {
        var step = Math.PI / 4;
        var a = Math.round(Math.atan2(y, x) / step) * step;
        x = Math.cos(a); y = Math.sin(a); d = 1;
      }
      vec = { x: x, y: y, angle: d ? Math.atan2(y, x) : 0, distance: d, active: d > 0, source: source };
      stick.style.transform = 'translate(' + (x * radius) + 'px,' + (y * radius) + 'px)';
      host.classList.toggle('ai-pad-idle', !vec.active);
      if (opts.onChange) opts.onChange(vec);
    }

    // Geometry, kept correct without touching the vector. A placement measured at one viewport is
    // wrong after a rotation or a resize, and a pad that has never been touched has no placement at
    // all — both leave the parts sitting outside the host.
    function recentre() {
      if (pointerId !== null) return;          // never move the base out from under a live thumb
      var r = host.getBoundingClientRect();
      if (!r.width) return;
      place(r.left + r.width / 2, r.top + r.height / 2);
      stick.style.transform = 'translate(' + (vec.x * radius) + 'px,' + (vec.y * radius) + 'px)';
    }

    function onDown(ev) {
      if (pointerId !== null) return;
      pointerId = ev.pointerId;
      try { host.setPointerCapture && host.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
      if (floating) place(ev.clientX, ev.clientY);
      else if (!radius) { var r = host.getBoundingClientRect(); place(r.left + r.width / 2, r.top + r.height / 2); }
      emit(0, 0, 'pointer');
    }
    function onMove(ev) {
      if (ev.pointerId !== pointerId) return;
      var r = host.getBoundingClientRect();
      emit((ev.clientX - r.left - originX) / radius, (ev.clientY - r.top - originY) / radius, 'pointer');
    }
    function onUp(ev) {
      if (ev.pointerId !== pointerId) return;
      pointerId = null;
      emit(0, 0, 'pointer');
    }

    var KEY_VEC = {
      ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
      ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
      ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
      ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
    };
    function fromKeys() {
      var x = 0, y = 0;
      for (var k in keys) {
        if (!keys[k] || !KEY_VEC[k]) continue;
        x += KEY_VEC[k][0]; y += KEY_VEC[k][1];
      }
      var len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      if (!radius) { var r = host.getBoundingClientRect(); place(r.left + r.width / 2, r.top + r.height / 2); }
      emit(x, y, 'keyboard');
    }
    function onKeyDown(ev) { if (KEY_VEC[ev.key]) { keys[ev.key] = true; ev.preventDefault(); fromKeys(); } }
    function onKeyUp(ev) { if (KEY_VEC[ev.key]) { keys[ev.key] = false; fromKeys(); } }
    // A game runs full-screen and the pad is rarely the focused element, so the keyboard listens on
    // the window. It is removed again by destroy().
    function onBlur() { keys = {}; fromKeys(); }

    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    if (useKeys) {
      global.addEventListener('keydown', onKeyDown);
      global.addEventListener('keyup', onKeyUp);
      global.addEventListener('blur', onBlur);
    }
    var ro = null;
    if (global.ResizeObserver) { ro = new global.ResizeObserver(recentre); ro.observe(host); }
    recentre();

    return {
      host: host,
      /** The current vector. Read it from a game loop rather than accumulating onChange calls. */
      value: function () { return { x: vec.x, y: vec.y, angle: vec.angle, distance: vec.distance, active: vec.active, source: vec.source }; },
      destroy: function () {
        if (ro) ro.disconnect();
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onUp);
        if (useKeys) {
          global.removeEventListener('keydown', onKeyDown);
          global.removeEventListener('keyup', onKeyUp);
          global.removeEventListener('blur', onBlur);
        }
        if (base.parentNode) base.parentNode.removeChild(base);
        if (stick.parentNode) stick.parentNode.removeChild(stick);
        host.classList.remove('ai-pad', 'ai-pad-idle');
      },
    };
  }

  AIMEAT.input = {
    VERSION: VERSION,
    on: on,
    tappable: tappable,
    haptic: haptic,
    pad: pad,
    claimFor: claimFor,
    isCoarse: isCoarse,
    hasHover: hasHover,
    injectCss: injectCss,
  };
})(typeof window !== 'undefined' ? window : this);
