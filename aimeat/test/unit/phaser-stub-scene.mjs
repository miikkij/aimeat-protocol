/**
 * @file test/unit/phaser-stub-scene.mjs
 * @description The fake Phaser scene: a manual clock that runs timers, tweens and camera effects
 *   deterministically (`scene.clock.advance(ms)`), the factories (add, make, physics.add), the
 *   managers (textures, anims, cameras, scale, input, sound, time, tweens, load, cache, registry)
 *   and the game with its canvas and scene manager. `scene.step(ms)` advances the clock, moves
 *   every arcade body by its velocity and fires the scene's update events, which is the frame
 *   loop the ai and daynight scripts each rebuilt.
 * @structure makeClock() · makeCamera() · makeScale() · makeGame() · makeScene(opts)
 *   (input and sound are in phaser-stub-input.mjs, physics in phaser-stub-physics.mjs)
 * @usage  import { makeScene } from './phaser-stub.mjs'; const scene = makeScene({ width: 960 });
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial: the union of the thirteen scratch stubs of 2026-09-02.
 */
import {
  emitter, gameObject, record, graphics, text, container, sprite, tileSprite, shape, particles,
  group, tilemap,
} from './phaser-stub-objects.mjs';
import { texturesManager, animsManager } from './phaser-stub-managers.mjs';
import { makeInput, makeSound } from './phaser-stub-input.mjs';
import { makePhysics } from './phaser-stub-physics.mjs';
import { makeDom } from './phaser-stub-dom.mjs';

const EPS = 1e-9;

/* ── The clock ─────────────────────────────────────────────────────────────────────────────── */

/** Tween config keys that are not animated properties. */
const TWEEN_SKIP = { targets: 1, duration: 1, ease: 1, delay: 1, yoyo: 1, repeat: 1, repeatDelay: 1, hold: 1, loop: 1, loopDelay: 1, paused: 1, onStart: 1, onUpdate: 1, onComplete: 1, onYoyo: 1, onRepeat: 1, onLoop: 1, onStop: 1, onPause: 1, onResume: 1, onActive: 1, callbackScope: 1, completeDelay: 1, persist: 1, props: 1, data: 1, flipX: 1, flipY: 1, interpolation: 1, useFrames: 1, easeParams: 1 };

/**
 * Timers, tweens and camera effects on one deterministic clock. advance(ms) fires everything
 * due inside ms in the order it falls due, including what a callback schedules on the way.
 * @param {any[]} log  the scene log to record into
 * @returns {any}
 */
export function makeClock(log) {
  const timers = [];
  const tweens = [];
  const clock = { kind: 'clock', now: 0, timeScale: 1, tweenScale: 1, timers, tweens };

  clock.addEvent = function (cfg) {
    const c = cfg || {};
    const t = {
      kind: 'timer', delay: Math.max(0, c.delay || 0), remaining: Math.max(0, c.delay || 0), elapsed: 0,
      callback: c.callback, args: c.args || [], scope: c.callbackScope, loop: !!c.loop, repeat: c.repeat || 0, repeatCount: c.repeat || 0,
      paused: !!c.paused, removed: false, done: false, hasDispatched: false, timeScale: c.timeScale === undefined ? 1 : c.timeScale, meta: c.meta || null,
      remove(dispatch) { if (dispatch && !t.done && t.callback) t.callback.apply(t.scope, t.args); t.removed = true; },
      destroy() { t.removed = true; },
      reset(next) { Object.assign(t, next || {}); t.remaining = t.delay; t.elapsed = 0; t.removed = false; t.done = false; return t; },
      getProgress() { return t.delay ? Math.min(1, t.elapsed / t.delay) : 1; },
      getOverallProgress() { return t.getProgress(); },
      getElapsed() { return t.elapsed; },
      getElapsedSeconds() { return t.elapsed / 1000; },
      getRemaining() { return t.remaining; },
      getRemainingSeconds() { return t.remaining / 1000; },
      getRepeatCount() { return t.repeatCount; },
    };
    if (c.startAt) { t.elapsed = c.startAt; t.remaining = Math.max(0, t.delay - c.startAt); }
    timers.push(t);
    log.push({ kind: 'time', method: 'addEvent', args: [c], target: t });
    return t;
  };
  clock.delayedCall = (ms, fn, args, scope, meta) => clock.addEvent({ delay: ms, callback: fn, args, callbackScope: scope, meta });
  clock.removeEvent = (t) => { for (const one of Array.isArray(t) ? t : [t]) if (one) one.removed = true; };
  clock.removeAllEvents = () => { for (const t of timers) t.removed = true; };
  clock.clearPendingEvents = clock.removeAllEvents;

  /** A tween on one or more targets. Linear in time (the ease is recorded, not applied). */
  clock.tween = function (config, startNow) {
    const c = config || {};
    const targets = c.targets === undefined ? [] : (Array.isArray(c.targets) ? c.targets : [c.targets]);
    const t = {
      kind: 'tween', config: c, targets, props: [], duration: Math.max(0, c.duration === undefined ? 1000 : c.duration), delay: c.delay || 0, hold: c.hold || 0,
      yoyo: !!c.yoyo, repeat: c.loop !== undefined && c.loop !== 0 ? c.loop : (c.repeat || 0), repeatDelay: c.repeatDelay || c.loopDelay || 0, completeDelay: c.completeDelay || 0,
      elapsed: 0, progress: 0, totalProgress: 0, alive: true, paused: !!c.paused && !startNow, started: false, completed: false, stopped: false, timeScale: 1, data: c.data,
      remaining: 0, cycles: 0,
    };
    const cycle = t.duration * (t.yoyo ? 2 : 1) + t.hold;
    t.total = t.repeat === -1 ? Infinity : t.delay + cycle * (t.repeat + 1) + t.repeatDelay * t.repeat + t.completeDelay;
    t.remaining = t.total;
    const wanted = c.props && typeof c.props === 'object' ? c.props : c;
    for (const key in wanted) {
      if (wanted === c && TWEEN_SKIP[key]) continue;
      const want = wanted[key];
      for (const target of targets) {
        const from = typeof target[key] === 'number' ? target[key] : 0;
        let to;
        let start = from;
        if (typeof want === 'number') to = want;
        else if (typeof want === 'string' && /^[+-]=/.test(want)) to = from + parseFloat(want.slice(2)) * (want[0] === '-' ? -1 : 1);
        else if (typeof want === 'string' && isFinite(parseFloat(want))) to = parseFloat(want);
        else if (want && typeof want === 'object' && (typeof want.to === 'number' || typeof want.value === 'number' || typeof want.from === 'number')) {
          to = typeof want.to === 'number' ? want.to : (typeof want.value === 'number' ? want.value : from);
          if (typeof want.from === 'number') start = want.from;
          if (typeof want.start === 'number') start = want.start;
        } else if (typeof want === 'function') to = want(target, key, from, 0, targets.length, t);
        else continue;
        t.props.push({ target, key, from: start, to });
      }
    }
    const setAt = (v) => { for (const p of t.props) p.target[p.key] = p.from + (p.to - p.from) * v; };
    const call = (name, ...a) => { if (typeof c[name] === 'function') c[name].apply(c.callbackScope, [t, targets, ...a]); };
    t.tick = function (ms) {
      if (!t.alive || t.paused) return;
      t.elapsed += ms;
      t.remaining = Math.max(0, t.total - t.elapsed);
      const after = t.elapsed - t.delay;
      if (after < 0) return;
      if (!t.started) { t.started = true; setAt(0); call('onStart'); }
      const cycleLen = cycle + t.repeatDelay;
      const cyc = cycleLen > 0 ? Math.floor(after / cycleLen) : 0;
      const inCycle = cycleLen > 0 ? after - cyc * cycleLen : 0;
      while (t.cycles < cyc && (t.repeat === -1 || t.cycles < t.repeat)) { t.cycles += 1; call('onRepeat'); if (c.loop) call('onLoop'); }
      let v;
      if (t.duration <= 0) v = t.yoyo ? 0 : 1;
      else if (inCycle < t.duration) v = inCycle / t.duration;
      else if (t.yoyo && inCycle < t.duration * 2 + t.hold) v = Math.max(0, 1 - (inCycle - t.duration - t.hold) / t.duration);
      else v = t.yoyo ? 0 : 1;
      t.progress = Math.min(1, Math.max(0, v));
      t.totalProgress = t.total === Infinity ? 0 : Math.min(1, t.elapsed / t.total);
      if (t.elapsed + EPS >= t.total) { t.finish(); return; }
      setAt(t.progress);
      call('onUpdate');
    };
    t.finish = function () {
      if (!t.alive) return;
      t.alive = false;
      t.completed = true;
      t.progress = t.yoyo ? 0 : 1;
      t.totalProgress = 1;
      setAt(t.progress);
      call('onUpdate');
      call('onComplete');
    };
    t.complete = () => { t.finish(); return t; };
    t.stop = () => { if (t.alive) { t.alive = false; t.stopped = true; call('onStop'); } return t; };
    t.remove = () => { t.alive = false; return t; };
    t.destroy = () => { t.alive = false; return t; };
    t.pause = () => { t.paused = true; call('onPause'); return t; };
    t.resume = () => { t.paused = false; call('onResume'); return t; };
    t.play = () => { t.paused = false; if (!t.alive && !t.completed) t.alive = true; return t; };
    t.restart = () => { t.elapsed = 0; t.remaining = t.total; t.alive = true; t.completed = false; t.stopped = false; t.started = false; t.cycles = 0; return t; };
    t.seek = (p) => { t.elapsed = t.total === Infinity ? p * cycle : p * t.total; t.tick(0); return t; };
    t.setTimeScale = (n) => { t.timeScale = n; return t; };
    t.isPlaying = () => t.alive && !t.paused;
    t.isPaused = () => t.paused;
    t.hasTarget = (o) => targets.indexOf(o) >= 0;
    t.getValue = () => (t.props[0] ? t.props[0].target[t.props[0].key] : 0);
    t.updateTo = (key, value) => { for (const p of t.props) if (p.key === key) p.to = value; return t; };
    tweens.push(t);
    log.push({ kind: 'tweens', method: 'add', args: [c], target: t });
    return t;
  };

  const liveTimers = () => timers.filter((t) => !t.removed && !t.done);
  const liveTweens = () => tweens.filter((t) => t.alive);
  clock.liveTimers = liveTimers;
  clock.liveTweens = liveTweens;
  clock.pending = () => liveTimers().length + liveTweens().length;

  function fireDue() {
    for (let guard = 0; guard < 100000; guard++) {
      const due = timers.find((t) => !t.removed && !t.done && !t.paused && t.remaining <= EPS);
      if (!due) return;
      due.hasDispatched = true;
      if (due.loop || due.repeatCount > 0) {
        if (!due.loop) due.repeatCount -= 1;
        due.remaining = due.delay;
        due.elapsed = 0;
      } else {
        due.done = true;
      }
      if (due.callback) due.callback.apply(due.scope, due.args);
    }
  }

  /** Step the clock: every timer and tween whose time falls inside ms fires, in time order. */
  clock.advance = function (ms) {
    let budget = Math.max(0, ms || 0);
    for (let guard = 0; guard < 100000; guard++) {
      fireDue();
      if (budget <= EPS) break;
      const tScale = clock.timeScale;
      const items = [];
      for (const t of liveTimers()) if (!t.paused) items.push({ t, until: tScale * t.timeScale > 0 ? t.remaining / (tScale * t.timeScale) : Infinity, scale: tScale * t.timeScale, timer: true });
      for (const t of liveTweens()) if (!t.paused) items.push({ t, until: clock.tweenScale * t.timeScale > 0 ? t.remaining / (clock.tweenScale * t.timeScale) : Infinity, scale: clock.tweenScale * t.timeScale, timer: false });
      const next = items.reduce((m, i) => (i.until < m ? i.until : m), Infinity);
      const step = Math.min(budget, next);
      if (!isFinite(step)) { clock.now += budget; break; }
      // The clock moves first, so a tween's onComplete reads the time it completed at.
      clock.now += step;
      budget -= step;
      for (const i of items) {
        if (i.timer) { i.t.remaining = Math.max(0, i.t.remaining - step * i.scale); i.t.elapsed += step * i.scale; } else i.t.tick(step * i.scale);
      }
    }
    fireDue();
    return clock.now;
  };
  /** Run until nothing is pending, or until maxMs has passed (a looping timer never ends). */
  clock.runAll = function (maxMs) {
    const stopAt = clock.now + (maxMs === undefined ? 60000 : maxMs);
    for (let guard = 0; guard < 100000 && clock.pending() > 0 && clock.now < stopAt; guard++) {
      const live = [...liveTimers().filter((t) => !t.paused).map((t) => t.remaining), ...liveTweens().filter((t) => !t.paused).map((t) => t.remaining)];
      const next = live.length ? Math.max(0, Math.min(...live)) : 0;
      if (!isFinite(next) || (next <= EPS && !timers.some((t) => !t.removed && !t.done && t.remaining <= EPS))) break;
      clock.advance(Math.min(next, stopAt - clock.now));
    }
    return clock.now;
  };
  return clock;
}

/* ── Camera, scale, input, sound ───────────────────────────────────────────────────────────── */

/** @returns {any} */
export function makeCamera(scene, w, h, name) {
  const ev = emitter();
  const cam = Object.assign({
    kind: 'camera', name: name || '', x: 0, y: 0, width: w, height: h, scrollX: 0, scrollY: 0, zoom: 1, rotation: 0, alpha: 1, visible: true,
    backgroundColor: null, bounds: null, follow: null, deadzone: null, lerp: { x: 1, y: 1 }, followOffset: { x: 0, y: 0 }, roundPixels: false, ignored: [], log: [], scene,
    useBounds: false, dirty: false,
  }, ev);
  const effect = (label) => ({ isRunning: false, progress: 0, timer: null, reset() { this.isRunning = false; this.progress = 0; if (this.timer) this.timer.removed = true; this.timer = null; cam.log.push([label + '.reset']); } });
  cam.fadeEffect = effect('fade'); cam.flashEffect = effect('flash'); cam.shakeEffect = effect('shake'); cam.panEffect = effect('pan'); cam.zoomEffect = effect('zoom'); cam.rotateToEffect = effect('rotateTo');
  Object.defineProperty(cam, 'worldView', { get: () => ({ x: cam.scrollX, y: cam.scrollY, width: cam.width / cam.zoom, height: cam.height / cam.zoom, right: cam.scrollX + cam.width / cam.zoom, bottom: cam.scrollY + cam.height / cam.zoom, centerX: cam.scrollX + cam.width / cam.zoom / 2, centerY: cam.scrollY + cam.height / cam.zoom / 2 }) });
  Object.defineProperty(cam, 'midPoint', { get: () => ({ x: cam.scrollX + cam.width / 2 / cam.zoom, y: cam.scrollY + cam.height / 2 / cam.zoom }) });
  Object.defineProperty(cam, 'centerX', { get: () => cam.width / 2 });
  Object.defineProperty(cam, 'centerY', { get: () => cam.height / 2 });
  Object.defineProperty(cam, 'displayWidth', { get: () => cam.width / cam.zoom });
  Object.defineProperty(cam, 'displayHeight', { get: () => cam.height / cam.zoom });
  const chain = (name, fn) => { cam[name] = function (...a) { cam.log.push([name, ...a]); scene.log.push({ kind: 'camera', method: name, args: a, target: cam }); const r = fn(...a); return r === undefined ? cam : r; }; };
  chain('setBounds', (x, y, bw, bh, centerOn) => { cam.bounds = { x, y, width: bw, height: bh }; cam.useBounds = true; if (centerOn) cam.centerToBounds(); });
  chain('removeBounds', () => { cam.bounds = null; cam.useBounds = false; });
  chain('setZoom', (z, zy) => { cam.zoom = z === undefined ? 1 : z; cam.zoomX = cam.zoom; cam.zoomY = zy === undefined ? cam.zoom : zy; });
  chain('setScroll', (x, y) => { cam.scrollX = x; cam.scrollY = y === undefined ? x : y; });
  chain('centerOn', (x, y) => { cam.scrollX = x - cam.width / 2 / cam.zoom; cam.scrollY = y - cam.height / 2 / cam.zoom; });
  chain('centerOnX', (x) => { cam.scrollX = x - cam.width / 2 / cam.zoom; });
  chain('centerOnY', (y) => { cam.scrollY = y - cam.height / 2 / cam.zoom; });
  chain('centerToBounds', () => { if (cam.bounds) cam.centerOn(cam.bounds.x + cam.bounds.width / 2, cam.bounds.y + cam.bounds.height / 2); });
  chain('centerToSize', () => { cam.scrollX = 0; cam.scrollY = 0; });
  chain('startFollow', (target, roundPixels, lx, ly, ox, oy) => { cam.follow = target; cam.roundPixels = !!roundPixels; cam.lerp = { x: lx === undefined ? 1 : lx, y: ly === undefined ? lx === undefined ? 1 : lx : ly }; cam.followOffset = { x: ox || 0, y: oy || 0 }; });
  chain('stopFollow', () => { cam.follow = null; });
  chain('setLerp', (x, y) => { cam.lerp = { x, y: y === undefined ? x : y }; });
  chain('setFollowOffset', (x, y) => { cam.followOffset = { x: x || 0, y: y || 0 }; });
  chain('setDeadzone', (dw, dh) => { cam.deadzone = dw === undefined ? null : { width: dw, height: dh }; });
  chain('setBackgroundColor', (c) => { cam.backgroundColor = c; });
  chain('setAlpha', (a) => { cam.alpha = a; });
  chain('setVisible', (v) => { cam.visible = !!v; });
  chain('setPosition', (x, y) => { cam.x = x; cam.y = y === undefined ? x : y; });
  chain('setSize', (sw, sh) => { cam.width = sw; cam.height = sh === undefined ? sw : sh; });
  chain('setViewport', (x, y, sw, sh) => { cam.x = x; cam.y = y; cam.width = sw; cam.height = sh; });
  chain('setRoundPixels', (v) => { cam.roundPixels = !!v; });
  chain('setRotation', (r) => { cam.rotation = r; });
  chain('setAngle', (a) => { cam.rotation = (a * Math.PI) / 180; });
  chain('setName', (n) => { cam.name = n; });
  chain('setOrigin', () => {});
  chain('setMask', (m) => { cam.mask = m; });
  chain('clearMask', () => { cam.mask = null; });
  chain('setPostPipeline', () => {});
  chain('ignore', (list) => { for (const o of Array.isArray(list) ? list : [list]) cam.ignored.push(o); });
  chain('resetFX', () => { for (const e of [cam.fadeEffect, cam.flashEffect, cam.shakeEffect, cam.panEffect, cam.zoomEffect, cam.rotateToEffect]) e.reset(); });
  const run = (fx, name, ms, apply, cb, ctx, extra) => {
    fx.reset();
    fx.isRunning = true;
    cam.emit('camera' + name + 'start', cam, fx, ms, ...(extra || []));
    const done = () => { fx.isRunning = false; fx.progress = 1; fx.timer = null; if (apply) apply(); if (typeof cb === 'function') cb.call(ctx, cam, 1, ...(extra || [])); cam.emit('camera' + name + 'complete', cam, fx); };
    if (!ms || ms <= 0) done();
    else fx.timer = scene.clock.delayedCall(ms, done, [], null, { owner: cam, kind: 'camera.' + name });
  };
  chain('fadeOut', (ms, r, g, b, cb, ctx) => { cam.fading = 'out'; run(cam.fadeEffect, 'fadeout', ms === undefined ? 1000 : ms, () => { cam.faded = true; }, cb, ctx); });
  chain('fadeIn', (ms, r, g, b, cb, ctx) => { cam.fading = 'in'; run(cam.fadeEffect, 'fadein', ms === undefined ? 1000 : ms, () => { cam.faded = false; }, cb, ctx); });
  chain('fade', (ms, r, g, b, force, cb, ctx) => { cam.fading = 'out'; run(cam.fadeEffect, 'fadeout', ms === undefined ? 1000 : ms, () => { cam.faded = true; }, cb, ctx); });
  chain('fadeFrom', (ms, r, g, b, force, cb, ctx) => { run(cam.fadeEffect, 'fadein', ms === undefined ? 1000 : ms, null, cb, ctx); });
  chain('flash', (ms, r, g, b, force, cb, ctx) => { cam.flashes = (cam.flashes || 0) + 1; run(cam.flashEffect, 'flash', ms === undefined ? 250 : ms, null, cb, ctx); });
  chain('shake', (ms, intensity, force, cb, ctx) => { cam.shakes = (cam.shakes || 0) + 1; cam.lastShake = { ms, intensity }; run(cam.shakeEffect, 'shake', ms === undefined ? 100 : ms, null, cb, ctx); });
  chain('pan', (x, y, ms, ease, force, cb, ctx) => { run(cam.panEffect, 'pan', ms === undefined ? 1000 : ms, () => cam.centerOn(x, y), cb, ctx, [x, y]); });
  chain('zoomTo', (z, ms, ease, force, cb, ctx) => { run(cam.zoomEffect, 'zoom', ms === undefined ? 1000 : ms, () => { cam.zoom = z; }, cb, ctx, [z]); });
  chain('rotateTo', (r, shortest, ms, ease, force, cb, ctx) => { run(cam.rotateToEffect, 'rotate', ms === undefined ? 1000 : ms, () => { cam.rotation = r; }, cb, ctx); });
  cam.getWorldPoint = (x, y, out) => { const o = out || {}; o.x = cam.scrollX + x / cam.zoom; o.y = cam.scrollY + y / cam.zoom; return o; };
  cam.getBounds = () => cam.bounds;
  cam.getScroll = (x, y) => ({ x: x - cam.width / 2, y: y - cam.height / 2 });
  cam.cull = (list) => list;
  cam.destroy = () => { cam.destroyed = true; };
  cam.preRender = () => {};
  cam.update = () => {};
  return cam;
}

/** @returns {any} */
export function makeScale(scene, w, h) {
  const ev = emitter();
  const S = Object.assign({
    kind: 'scale', width: w, height: h, zoom: 1, scaleMode: 0, autoCenter: 0, isFullscreen: false, orientation: 'landscape-primary', log: [],
    gameSize: { width: w, height: h }, baseSize: { width: w, height: h }, displaySize: { width: w, height: h }, parentSize: { width: w, height: h }, parent: null, canvas: null,
    fullscreen: { available: true, active: false, keyboard: false },
  }, ev);
  S.resize = function (nw, nh) {
    const pw = S.width; const ph = S.height;
    S.width = nw; S.height = nh;
    S.gameSize = { width: nw, height: nh }; S.baseSize = { width: nw, height: nh }; S.displaySize = { width: nw, height: nh };
    for (const cam of scene.cameras.cameras) { cam.width = nw; cam.height = nh; }
    if (scene.game && scene.game.canvas) { scene.game.canvas.width = nw; scene.game.canvas.height = nh; }
    S.log.push(['resize', nw, nh]);
    S.emit('resize', S.gameSize, S.baseSize, S.displaySize, pw, ph);
    return S;
  };
  S.setGameSize = S.resize;
  S.setZoom = (z) => { S.zoom = z; return S; };
  S.setParentSize = (pw, ph) => { S.parentSize = { width: pw, height: ph }; return S; };
  S.getParentBounds = () => true;
  S.refresh = () => { S.emit('resize', S.gameSize, S.baseSize, S.displaySize, S.width, S.height); return S; };
  S.startFullscreen = () => { S.isFullscreen = true; S.fullscreen.active = true; S.log.push(['startFullscreen']); S.emit('enterfullscreen'); };
  S.stopFullscreen = () => { S.isFullscreen = false; S.fullscreen.active = false; S.log.push(['stopFullscreen']); S.emit('leavefullscreen'); };
  S.toggleFullscreen = () => { if (S.isFullscreen) S.stopFullscreen(); else S.startFullscreen(); };
  S.lockOrientation = (o) => { S.log.push(['lockOrientation', o]); return true; };
  S.transformX = (x) => x;
  S.transformY = (y) => y;
  Object.defineProperty(S, 'isLandscape', { get: () => S.orientation.indexOf('landscape') === 0 });
  Object.defineProperty(S, 'isPortrait', { get: () => S.orientation.indexOf('portrait') === 0 });
  return S;
}

/* ── Game, managers and the scene ──────────────────────────────────────────────────────────── */

function dataManager() {
  const ev = emitter();
  const D = { kind: 'data', values: {}, events: ev, log: [] };
  D.get = (k) => (Array.isArray(k) ? k.map((n) => D.values[n]) : (k === undefined ? Object.assign({}, D.values) : D.values[k]));
  D.set = (k, v) => { if (typeof k === 'object' && k) { for (const n in k) D.set(n, k[n]); return D; } const had = k in D.values; const prev = D.values[k]; D.values[k] = v; D.log.push(['set', k, v]); ev.emit(had ? 'changedata' : 'setdata', D, k, v, prev); if (had) ev.emit('changedata-' + k, D, v, prev); return D; };
  D.has = (k) => k in D.values;
  D.remove = (k) => { for (const n of Array.isArray(k) ? k : [k]) { const v = D.values[n]; delete D.values[n]; ev.emit('removedata', D, n, v); } return D; };
  D.inc = (k, n) => D.set(k, (D.values[k] || 0) + (n === undefined ? 1 : n));
  D.toggle = (k) => D.set(k, !D.values[k]);
  D.merge = (o, overwrite) => { for (const n in o) if (overwrite !== false || !(n in D.values)) D.set(n, o[n]); return D; };
  D.each = (fn, ctx) => { for (const n in D.values) fn.call(ctx, D, n, D.values[n]); return D; };
  D.getAll = () => Object.assign({}, D.values);
  D.query = (re) => { const out = {}; for (const n in D.values) if (re.test(n)) out[n] = D.values[n]; return out; };
  D.reset = () => { D.values = {}; return D; };
  D.destroy = () => { D.values = {}; };
  Object.defineProperty(D, 'count', { get: () => Object.keys(D.values).length });
  Object.defineProperty(D, 'list', { get: () => D.values });
  return D;
}

function cacheStore() {
  const entries = new Map();
  return { entries, exists: (k) => entries.has(k), has: (k) => entries.has(k), get: (k) => entries.get(k), add(k, v) { entries.set(k, v); return this; }, remove(k) { entries.delete(k); return this; }, getKeys: () => [...entries.keys()], destroy() { entries.clear(); } };
}

const LOADER_METHODS = ['image', 'spritesheet', 'atlas', 'atlasXML', 'unityAtlas', 'multiatlas', 'audio', 'audioSprite', 'json', 'text', 'xml', 'html', 'binary', 'tilemapTiledJSON', 'tilemapCSV', 'tilemapImpact', 'bitmapFont', 'video', 'svg', 'pack', 'plugin', 'script', 'scripts', 'sceneFile', 'scenePlugin', 'glsl', 'obj', 'css', 'font', 'aseprite', 'animation', 'htmlTexture', 'rexAwait'];

function loader(scene) {
  const ev = emitter();
  const L = Object.assign({ kind: 'load', queue: [], log: [], baseURL: '', path: '', crossOrigin: null, state: 0, totalToLoad: 0, totalComplete: 0, totalFailed: 0, progress: 0, loading: false, maxParallelDownloads: 4 }, ev);
  for (const name of LOADER_METHODS) L[name] = function (key, url, cfg) { const item = { type: name, key, url, config: cfg }; L.queue.push(item); L.log.push([name, key, url, cfg]); L.totalToLoad = L.queue.length; return L; };
  L.setBaseURL = (u) => { L.baseURL = u; return L; };
  L.setPath = (p) => { L.path = p; return L; };
  L.setCORS = (c) => { L.crossOrigin = c; return L; };
  L.setPrefix = () => L;
  L.isLoading = () => L.loading;
  L.isReady = () => !L.loading;
  L.keyExists = (item) => L.queue.some((q) => q.key === item.key && q.type === item.type);
  L.addFile = (f) => { L.queue.push(f); return L; };
  L.reset = () => { L.queue.length = 0; L.totalToLoad = 0; L.totalComplete = 0; L.progress = 0; return L; };
  /** Resolve the queue: textures, sounds and json land in their managers, then 'complete'. */
  L.start = function () {
    L.loading = true;
    L.state = 2;
    L.emit('start', L);
    const items = L.queue.splice(0);
    items.forEach((item, i) => {
      const key = typeof item.key === 'object' && item.key ? item.key.key : item.key;
      if (item.type === 'image' || item.type === 'svg' || item.type === 'atlas' || item.type === 'multiatlas' || item.type === 'atlasXML' || item.type === 'htmlTexture') scene.textures.register(key, 32, 32, { from: item.type });
      else if (item.type === 'spritesheet') scene.textures.addSpriteSheet(key, { width: (item.config && item.config.frameWidth ? item.config.frameWidth : 32) * ((item.config && item.config.endFrame !== undefined ? item.config.endFrame + 1 : 1)), height: item.config && item.config.frameHeight ? item.config.frameHeight : 32 }, item.config || { frameWidth: 32, frameHeight: 32 });
      else if (item.type === 'audio' || item.type === 'audioSprite') scene.cache.audio.add(key, { key, url: item.url });
      else if (item.type === 'json' || item.type === 'pack' || item.type === 'aseprite' || item.type === 'animation') scene.cache.json.add(key, item.config && item.config.data !== undefined ? item.config.data : (L.fixtures && L.fixtures[key]) || {});
      else if (item.type === 'tilemapTiledJSON') scene.cache.tilemap.add(key, { format: 1, data: (L.fixtures && L.fixtures[key]) || {} });
      else if (item.type === 'text' || item.type === 'glsl' || item.type === 'html' || item.type === 'css') scene.cache.text.add(key, (L.fixtures && L.fixtures[key]) || '');
      else if (item.type === 'xml') scene.cache.xml.add(key, {});
      else if (item.type === 'bitmapFont') scene.cache.bitmapFont.add(key, {});
      L.totalComplete += 1;
      L.progress = (i + 1) / items.length;
      L.emit('filecomplete', key, item.type, item);
      L.emit('filecomplete-' + item.type + '-' + key, key, item.type, item);
      L.emit('progress', L.progress);
    });
    L.loading = false;
    L.state = 4;
    L.emit('complete', L, items.length, 0);
    L.emit('loaderror');
    return L;
  };
  return L;
}

/** @returns {any} */
export function makeGame(scene, opts) {
  const o = opts || {};
  const doc = globalThis.document && globalThis.document.__akStub ? globalThis.document : makeDom().document;
  const host = doc.createElement('div');
  host.className = 'ak-game';
  doc.body.appendChild(host);
  const canvas = doc.createElement('canvas');
  canvas.width = scene.scale.width;
  canvas.height = scene.scale.height;
  host.appendChild(canvas);
  scene.scale.canvas = canvas;
  scene.scale.parent = host;
  const gev = emitter();
  const scenes = new Map();
  scenes.set(scene.key, scene);
  const manager = { kind: 'sceneManager', keys: {}, scenes: [scene], log: [], isProcessing: false, isBooted: true, register(key, s) { scenes.set(key, s); manager.keys[key] = s; manager.scenes.push(s); return s; } };
  manager.keys[scene.key] = scene;
  const m = (name, fn) => { manager[name] = function (...a) { manager.log.push([name, ...a]); scene.log.push({ kind: 'sceneManager', method: name, args: a, target: manager }); const r = fn ? fn(...a) : undefined; return r === undefined ? manager : r; }; };
  for (const name of ['start', 'stop', 'pause', 'resume', 'sleep', 'wake', 'run', 'launch', 'switch', 'bringToTop', 'sendToBack', 'moveUp', 'moveDown', 'moveAbove', 'moveBelow', 'swapPosition', 'remove', 'dump', 'processQueue']) m(name);
  m('add', (key, cfg, autoStart) => { const s = cfg && typeof cfg === 'object' ? cfg : { key }; manager.register(key, s); if (autoStart) manager.start(key); return s; });
  manager.getScene = (key) => (typeof key === 'string' ? scenes.get(key) || null : key || null);
  manager.getScenes = (active) => (active ? [scene] : [...scenes.values()]);
  manager.getAt = (i) => manager.scenes[i] || null;
  manager.getIndex = (key) => manager.scenes.indexOf(manager.getScene(key));
  manager.isActive = (key) => key === undefined || key === scene.key || (scenes.has(key) && !!scenes.get(key).__active);
  manager.isPaused = (key) => !!(scenes.get(key) && scenes.get(key).__paused);
  manager.isSleeping = (key) => !!(scenes.get(key) && scenes.get(key).__sleeping);
  manager.isVisible = (key) => key === undefined || key === scene.key || (scenes.has(key) && scenes.get(key).__visible !== false);
  const game = {
    kind: 'game', canvas, context: canvas.getContext ? canvas.getContext('2d') : null, config: Object.assign({ width: scene.scale.width, height: scene.scale.height, type: 0, parent: host }, o.config || {}),
    events: gev, scene: manager, scale: scene.scale, registry: dataManager(), cache: scene.cache, sound: scene.sound, input: { events: emitter(), canvas, enabled: true, keyboard: scene.input.keyboard },
    textures: scene.textures, anims: scene.anims, renderer: { type: 2, width: scene.scale.width, height: scene.scale.height, gl: null, snapshot() {} }, loop: { running: true, sleeping: false, actualFps: 60, delta: 16.67, now: 0, log: [], sleep() { this.sleeping = true; this.log.push('sleep'); }, wake() { this.sleeping = false; this.log.push('wake'); }, stop() { this.running = false; }, start() { this.running = true; }, resetDelta() {} },
    device: { os: { desktop: true, iOS: false, android: false, windows: true, macOS: false }, input: { touch: false, mspointer: false }, audio: { webAudio: true, ogg: true, mp3: true }, browser: { chrome: true, safari: false, firefox: false }, video: { h264: true } },
    isBooted: true, isRunning: true, isPaused: false, hasFocus: true, log: [], host, document: doc,
    getFrame: () => 0, getTime: () => scene.clock.now, step: () => {}, headlessStep: () => {},
    pause() { game.isPaused = true; gev.emit('pause'); }, resume() { game.isPaused = false; gev.emit('resume'); },
    destroy(removeCanvas, noReturn) { game.log.push(['destroy', removeCanvas, noReturn]); game.isRunning = false; gev.emit('destroy'); if (removeCanvas && canvas.remove) canvas.remove(); },
  };
  return game;
}

/**
 * The scene. Every factory records into scene.log and scene.made; scene.clock.advance(ms) runs
 * timers, tweens and camera effects; scene.step(ms) is one frame: the clock, the arcade bodies,
 * and the preupdate / update / postupdate events.
 * @param {{ width?: number, height?: number, key?: string, gravity?: number|{ x: number, y: number },
 *   overlapRect?: Function, tiledMaps?: Record<string, any>, gamepad?: boolean, audioContext?: any,
 *   config?: any }} [opts]
 * @returns {any}
 */
export function makeScene(opts) {
  const o = opts || {};
  const w = o.width || 960;
  const h = o.height || 540;
  const log = [];
  const made = [];
  const scene = { kind: 'scene', key: o.key || 'stub', log, made, opts: o };
  scene.events = emitter();
  scene.clock = makeClock(log);
  scene.textures = texturesManager(scene);
  scene.anims = animsManager(scene);
  scene.cameras = { main: null, cameras: [], log: [] };
  scene.cameras.main = makeCamera(scene, w, h, 'main');
  scene.cameras.cameras.push(scene.cameras.main);
  scene.cameras.add = (x, y, cw, ch, makeMain, name) => { const c = makeCamera(scene, cw === undefined ? w : cw, ch === undefined ? h : ch, name); c.x = x || 0; c.y = y || 0; scene.cameras.cameras.push(c); if (makeMain) scene.cameras.main = c; return c; };
  scene.cameras.remove = (c) => { const i = scene.cameras.cameras.indexOf(c); if (i >= 0) scene.cameras.cameras.splice(i, 1); return 1; };
  scene.cameras.getCamera = (name) => scene.cameras.cameras.find((c) => c.name === name) || null;
  scene.cameras.resetAll = () => scene.cameras.main;
  scene.scale = makeScale(scene, w, h);
  scene.input = makeInput(scene, o);
  scene.sound = makeSound(scene, o.audioContext);
  scene.physics = makePhysics(scene, o);
  scene.cache = { audio: cacheStore(), json: cacheStore(), text: cacheStore(), tilemap: cacheStore(), xml: cacheStore(), html: cacheStore(), binary: cacheStore(), video: cacheStore(), shader: cacheStore(), obj: cacheStore(), bitmapFont: cacheStore(), physics: cacheStore(), custom: {} };
  scene.registry = dataManager();
  scene.data = dataManager();
  scene.load = loader(scene);
  scene.children = { list: [], log: [], getByName: (n) => scene.children.list.find((g) => g.name === n) || null, getAll: () => scene.children.list.slice(), getChildren: () => scene.children.list, each: (fn, ctx) => scene.children.list.slice().forEach((g) => fn.call(ctx, g)), exists: (g) => scene.children.list.indexOf(g) >= 0, bringToTop(g) { const i = this.list.indexOf(g); if (i >= 0) { this.list.splice(i, 1); this.list.push(g); } return g; }, sendToBack(g) { const i = this.list.indexOf(g); if (i >= 0) { this.list.splice(i, 1); this.list.unshift(g); } return g; }, moveUp: (g) => g, moveDown: (g) => g, depthSort() {}, queueDepthSort() {}, remove(g) { const i = this.list.indexOf(g); if (i >= 0) this.list.splice(i, 1); return g; }, get length() { return this.list.length; } };
  const added = (g) => { scene.children.list.push(g); record(g, 'create', []); return g; };
  scene.add = new Proxy({
    graphics: (cfg) => added(graphics(scene, Object.assign({ add: true }, cfg || {}))),
    text: (x, y, str, style) => added(text(scene, x, y, str, style)),
    bitmapText: (x, y, font, str, size) => added(text(scene, x, y, str, { fontFamily: font, fontSize: size })),
    container: (x, y, kids) => added(container(scene, x, y, kids)),
    sprite: (x, y, key, frame) => added(sprite(scene, 'sprite', x, y, key, frame, false)),
    image: (x, y, key, frame) => added(sprite(scene, 'image', x, y, key, frame, false)),
    tileSprite: (x, y, tw, th, key, frame) => added(tileSprite(scene, x, y, tw, th, key, frame)),
    rectangle: (x, y, rw, rh, fill, alpha) => added(shape(scene, 'rectangle', x, y, rw, rh, fill, alpha)),
    circle: (x, y, r, fill, alpha) => added(shape(scene, 'circle', x, y, r, fill, alpha)),
    ellipse: (x, y, ew, eh, fill, alpha) => added(shape(scene, 'ellipse', x, y, ew, eh, fill, alpha)),
    zone: (x, y, zw, zh) => added(shape(scene, 'zone', x, y, zw, zh)),
    particles: (x, y, key, cfg) => added(particles(scene, x, y, key, cfg)),
    group: (kids, cfg) => added(group(scene, Array.isArray(kids) ? cfg : kids, false, false)),
    existing: (g) => added(g),
    renderTexture: (x, y, rw, rh) => { const r = added(gameObject(scene, 'renderTexture', { x, y, width: rw || 32, height: rh || 32, draws: [] })); for (const n of ['draw', 'drawFrame', 'clear', 'fill', 'erase', 'stamp', 'beginDraw', 'batchDraw', 'endDraw', 'saveTexture', 'snapshot', 'resize', 'setSize']) r[n] = function (...a) { record(r, n, a); r.draws.push([n, ...a]); return r; }; return r; },
    dom: (x, y, el, style, str) => added(gameObject(scene, 'dom', { x, y, node: el, style, text: str })),
  }, { get(t, name) { return name in t ? t[name] : (typeof name === 'string' ? (...args) => added(gameObject(scene, name, { args })) : undefined); } });
  scene.make = {
    graphics: (cfg) => { const g = graphics(scene, cfg); if (cfg && cfg.add) added(g); else record(g, 'create', []); return g; },
    text: (cfg) => { const c = cfg || {}; const t = text(scene, c.x || 0, c.y || 0, c.text, c.style); if (c.add !== false) added(t); return t; },
    sprite: (cfg) => { const c = cfg || {}; const s = sprite(scene, 'sprite', c.x || 0, c.y || 0, c.key, c.frame, false); if (c.add !== false) added(s); return s; },
    image: (cfg) => { const c = cfg || {}; const s = sprite(scene, 'image', c.x || 0, c.y || 0, c.key, c.frame, false); if (c.add !== false) added(s); return s; },
    container: (cfg) => { const c = cfg || {}; const s = container(scene, c.x || 0, c.y || 0, c.children); if (c.add !== false) added(s); return s; },
    tileSprite: (cfg) => { const c = cfg || {}; const s = tileSprite(scene, c.x || 0, c.y || 0, c.width, c.height, c.key, c.frame); if (c.add !== false) added(s); return s; },
    particles: (cfg) => { const c = cfg || {}; const s = particles(scene, c.x || 0, c.y || 0, c.key || c.texture, c.config || c); if (c.add !== false) added(s); return s; },
    group: (cfg) => group(scene, cfg, false, false),
    zone: (cfg) => { const c = cfg || {}; return shape(scene, 'zone', c.x || 0, c.y || 0, c.width, c.height); },
    tilemap: (cfg) => { const map = tilemap(scene, cfg, o.tiledMaps); if (cfg && cfg.key && scene.cache.tilemap.exists(cfg.key) && !map.layers.length) { const data = scene.cache.tilemap.get(cfg.key).data || {}; map.layers = (data.layers || []).map((l) => Object.assign({ properties: [] }, l)); } return map; },
    renderTexture: (cfg) => scene.add.renderTexture((cfg || {}).x || 0, (cfg || {}).y || 0, (cfg || {}).width, (cfg || {}).height),
  };
  scene.time = {
    kind: 'time', log: [], paused: false,
    get now() { return scene.clock.now; },
    get timeScale() { return scene.clock.timeScale; },
    set timeScale(v) { scene.clock.timeScale = v; },
    delayedCall: (ms, fn, args, scope) => scene.clock.delayedCall(ms, fn, args, scope),
    addEvent: (cfg) => scene.clock.addEvent(cfg),
    removeEvent: (t) => scene.clock.removeEvent(t),
    removeAllEvents: () => scene.clock.removeAllEvents(),
    clearPendingEvents: () => scene.clock.removeAllEvents(),
    getPendingEvents: () => scene.clock.liveTimers(),
  };
  scene.tweens = {
    kind: 'tweens', log: [],
    get timeScale() { return scene.clock.tweenScale; },
    set timeScale(v) { scene.clock.tweenScale = v; },
    add: (cfg) => scene.clock.tween(cfg, true),
    create: (cfg) => scene.clock.tween(Object.assign({ paused: true }, cfg || {})),
    addCounter: (cfg) => { const c = Object.assign({}, cfg || {}); const target = { value: c.from === undefined ? 0 : c.from }; c.targets = target; c.value = c.to === undefined ? 1 : c.to; delete c.from; delete c.to; const t = scene.clock.tween(c, true); t.getValue = () => target.value; return t; },
    chain: (cfg) => { const list = (cfg && cfg.tweens) || []; const chain = { tweens: [], alive: true, paused: false, log: [] }; const runAt = (i) => { if (i >= list.length) { chain.alive = false; if (cfg && cfg.onComplete) cfg.onComplete(chain); return; } const c = Object.assign({}, list[i]); const done = c.onComplete; c.onComplete = (...a) => { if (done) done(...a); runAt(i + 1); }; chain.tweens.push(scene.clock.tween(c, true)); }; runAt(0); chain.stop = () => { chain.alive = false; for (const t of chain.tweens) t.stop(); return chain; }; chain.pause = () => { chain.paused = true; for (const t of chain.tweens) t.pause(); return chain; }; chain.resume = () => { chain.paused = false; for (const t of chain.tweens) t.resume(); return chain; }; chain.destroy = chain.stop; return chain; },
    killTweensOf: (target) => { const list = Array.isArray(target) ? target : [target]; for (const t of scene.clock.tweens) if (t.alive && list.some((x) => t.hasTarget(x))) t.alive = false; log.push({ kind: 'tweens', method: 'killTweensOf', args: [target], target: null }); return scene.tweens; },
    killAll: () => { for (const t of scene.clock.tweens) t.alive = false; return scene.tweens; },
    getTweensOf: (target) => scene.clock.liveTweens().filter((t) => t.hasTarget(target)),
    getTweens: () => scene.clock.liveTweens(),
    isTweening: (target) => scene.clock.liveTweens().some((t) => t.hasTarget(target)),
    pauseAll: () => { for (const t of scene.clock.liveTweens()) t.pause(); return scene.tweens; },
    resumeAll: () => { for (const t of scene.clock.liveTweens()) t.resume(); return scene.tweens; },
    stagger: (v) => () => v,
    remove: (t) => { t.alive = false; return scene.tweens; },
    makeActive: (t) => { t.alive = true; return scene.tweens; },
    existing: (t) => { t.alive = true; return scene.tweens; },
  };
  scene.game = makeGame(scene, o);
  scene.sys = {
    settings: { key: scene.key, status: 5, active: true, visible: true, data: {}, isBooted: true },
    game: scene.game, scale: scene.scale, events: scene.events, canvas: scene.game.canvas, displayList: scene.children, updateList: { add() {}, remove() {}, length: 0 },
    textures: scene.textures, anims: scene.anims, cache: scene.cache, registry: scene.registry, sound: scene.sound, input: scene.input, time: scene.time, tweens: scene.tweens, cameras: scene.cameras, add: scene.add, make: scene.make, load: scene.load, physics: scene.physics,
    isActive: () => scene.sys.settings.active, isPaused: () => scene.sys.settings.status === 6, isSleeping: () => scene.sys.settings.status === 7, isVisible: () => scene.sys.settings.visible, isTransitioning: () => false, isTransitionIn: () => false, isTransitionOut: () => false,
    queueDepthSort() {}, depthSort() {}, setActive: (v) => { scene.sys.settings.active = !!v; }, setVisible: (v) => { scene.sys.settings.visible = !!v; },
    pause() { scene.sys.settings.status = 6; scene.events.emit('pause', scene.sys); }, resume() { scene.sys.settings.status = 5; scene.events.emit('resume', scene.sys); },
    sleep() { scene.sys.settings.status = 7; scene.events.emit('sleep', scene.sys); }, wake() { scene.sys.settings.status = 5; scene.events.emit('wake', scene.sys); },
    shutdown() { scene.sys.settings.status = 8; scene.events.emit('shutdown', scene.sys); }, destroy() { scene.sys.settings.status = 9; scene.events.emit('destroy', scene.sys); },
    start() { scene.sys.settings.status = 2; scene.events.emit('start', scene.sys); },
  };
  const manager = scene.game.scene;
  scene.scene = { kind: 'scenePlugin', key: scene.key, settings: scene.sys.settings, manager, systems: scene.sys, log: [] };
  for (const name of ['start', 'stop', 'pause', 'resume', 'sleep', 'wake', 'run', 'launch', 'switch', 'bringToTop', 'sendToBack', 'moveUp', 'moveDown', 'moveAbove', 'moveBelow', 'swapPosition', 'remove', 'add', 'setVisible', 'setActive']) {
    scene.scene[name] = function (...a) { scene.scene.log.push([name, ...a]); log.push({ kind: 'scenePlugin', method: name, args: a, target: scene.scene }); if (typeof manager[name] === 'function') manager[name](...a); return scene.scene; };
  }
  scene.scene.restart = (data) => { scene.scene.log.push(['restart', data]); log.push({ kind: 'scenePlugin', method: 'restart', args: [data], target: scene.scene }); manager.log.push(['restart', scene.key, data]); return scene.scene; };
  scene.scene.transition = (cfg) => { scene.scene.log.push(['transition', cfg]); scene.events.emit('transitionout', manager.getScene(cfg && cfg.target), cfg && cfg.duration); return true; };
  scene.scene.get = (key) => manager.getScene(key);
  scene.scene.getIndex = (key) => manager.getIndex(key === undefined ? scene.key : key);
  scene.scene.isActive = (key) => manager.isActive(key === undefined ? scene.key : key);
  scene.scene.isPaused = (key) => manager.isPaused(key === undefined ? scene.key : key);
  scene.scene.isSleeping = (key) => manager.isSleeping(key === undefined ? scene.key : key);
  scene.scene.isVisible = (key) => manager.isVisible(key === undefined ? scene.key : key);
  scene.scene.getStatus = () => scene.sys.settings.status;
  scene.renderer = scene.game.renderer;
  scene.plugins = { get: () => null, installScenePlugin() {}, start: () => null };
  scene.lights = { enable: () => scene.lights, disable: () => scene.lights, addLight: () => ({}), setAmbientColor: () => scene.lights, active: false };

  /** One frame: the clock moves, bodies move, and the scene's update events fire in order. */
  scene.step = function (ms) {
    const delta = ms === undefined ? 16 : ms;
    scene.clock.advance(delta);
    scene.physics.world.step(delta);
    for (const cam of scene.cameras.cameras) if (cam.follow && !cam.follow.destroyed) cam.centerOn(cam.follow.x + cam.followOffset.x, cam.follow.y + cam.followOffset.y);
    scene.events.emit('preupdate', scene.clock.now, delta);
    scene.events.emit('update', scene.clock.now, delta);
    if (typeof scene.update === 'function') scene.update(scene.clock.now, delta);
    scene.events.emit('postupdate', scene.clock.now, delta);
    scene.events.emit('render');
    return scene.clock.now;
  };
  scene.frames = (n, ms) => { for (let i = 0; i < n; i++) scene.step(ms); return scene.clock.now; };
  scene.shutdown = () => scene.sys.shutdown();
  scene.destroy = () => scene.sys.destroy();
  scene.calls = (kind, method) => log.filter((e) => (kind === undefined || e.kind === kind) && (method === undefined || e.method === method));
  scene.find = (kind, pred) => made.filter((g) => (kind === undefined || g.kind === kind) && (!pred || pred(g)));
  scene.live = (kind, pred) => scene.find(kind, (g) => !g.destroyed && (!pred || pred(g)));
  scene.last = (kind) => { const list = scene.find(kind); return list[list.length - 1] || null; };
  return scene;
}
