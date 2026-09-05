/**
 * @file test/unit/phaser-stub-input.mjs
 * @description The input and sound plugins of the fake Phaser scene. The keyboard's keys are
 *   pressed with press(code) and let go with release(code), which sets key.isDown and fires the
 *   keydown-CODE events; the pointer is driven with tap(x, y), which goes through pointerdown and
 *   pointerup to the interactive object under it the way Phaser's hit test would; a gamepad is
 *   connected by hand. The sound manager plays into a stub AudioContext and records every call.
 * @structure KEY_CODES · makeInput() · makeGamepad() · makeSound()
 * @usage  Internal to phaser-stub-scene.mjs; scripts reach them as scene.input and scene.sound.
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial, split out of phaser-stub-scene.mjs.
 */
import { emitter } from './phaser-stub-objects.mjs';
import { makeAudioContext } from './phaser-stub-dom.mjs';

/** A handful of Phaser key codes, for addKey(number) and for the KeyCodes table on the namespace. */
export const KEY_CODES = { BACKSPACE: 8, TAB: 9, ENTER: 13, SHIFT: 16, CTRL: 17, ALT: 18, PAUSE: 19, CAPS_LOCK: 20, ESC: 27, SPACE: 32, PAGE_UP: 33, PAGE_DOWN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, DELETE: 46, ZERO: 48, ONE: 49, TWO: 50, THREE: 51, FOUR: 52, FIVE: 53, SIX: 54, SEVEN: 55, EIGHT: 56, NINE: 57, A: 65, B: 66, C: 67, D: 68, E: 69, F: 70, G: 71, H: 72, I: 73, J: 74, K: 75, L: 76, M: 77, N: 78, O: 79, P: 80, Q: 81, R: 82, S: 83, T: 84, U: 85, V: 86, W: 87, X: 88, Y: 89, Z: 90, F1: 112, F2: 113, F3: 114, PLUS: 187, MINUS: 189, COMMA: 188, PERIOD: 190 };

function keyName(code) {
  if (typeof code === 'number') { for (const n in KEY_CODES) if (KEY_CODES[n] === code) return n; return String(code); }
  if (code && typeof code === 'object' && code.name) return code.name;
  return String(code).toUpperCase();
}

/**
 * The input plugin.
 * @param {any} scene
 * @param {{ gamepad?: boolean }} [opts]  gamepad: true gives scene.input.gamepad a plugin (Phaser
 *   leaves it undefined unless the game config asked for it, and so does this by default)
 * @returns {any}
 */
export function makeInput(scene, opts) {
  const o = opts || {};
  const ev = emitter();
  const kev = emitter();
  const keys = new Map();
  const input = Object.assign({ kind: 'input', enabled: true, topOnly: true, dragDistanceThreshold: 0, dragTimeThreshold: 0, log: [], pointersTotal: 1 }, ev);
  const keyboard = Object.assign({ kind: 'keyboard', enabled: true, keys, captures: [], log: [], manager: { enabled: true, captures: [] } }, kev);
  function makeKey(name) {
    const kv = emitter();
    const key = Object.assign({ kind: 'key', name, keyCode: KEY_CODES[name] || 0, code: name, isDown: false, isUp: true, enabled: true, repeats: 0, timeDown: 0, timeUp: 0, duration: 0, _justDown: false, _justUp: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, originalEvent: null, emitOnRepeat: false, log: [] }, kv);
    key.reset = () => { key.isDown = false; key.isUp = true; key._justDown = false; key._justUp = false; key.repeats = 0; return key; };
    key.setEmitOnRepeat = (v) => { key.emitOnRepeat = !!v; return key; };
    key.getDuration = () => (key.isDown ? scene.clock.now - key.timeDown : key.duration);
    key.destroy = () => { key.enabled = false; keys.delete(name); };
    return key;
  }
  keyboard.addKey = function (code, capture, repeat) {
    const name = keyName(code);
    keyboard.log.push(['addKey', name]);
    if (!keys.has(name)) keys.set(name, makeKey(name));
    const key = keys.get(name);
    if (repeat !== undefined) key.emitOnRepeat = !!repeat;
    if (capture !== false) keyboard.captures.push(name);
    return key;
  };
  keyboard.addKeys = function (list, capture, repeat) {
    const out = {};
    if (typeof list === 'string') for (const n of list.split(',')) out[n.trim()] = keyboard.addKey(n.trim(), capture, repeat);
    else for (const n in list) out[n] = keyboard.addKey(list[n], capture, repeat);
    return out;
  };
  keyboard.createCursorKeys = () => keyboard.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', space: 'SPACE', shift: 'SHIFT' });
  keyboard.removeKey = (code, destroy) => { const name = keyName(code); keyboard.log.push(['removeKey', name]); const key = keys.get(name); if (key && destroy) key.enabled = false; keys.delete(name); return keyboard; };
  keyboard.removeAllKeys = (destroy) => { for (const k of [...keys.keys()]) keyboard.removeKey(k, destroy); return keyboard; };
  keyboard.resetKeys = () => { for (const k of keys.values()) k.reset(); return keyboard; };
  keyboard.checkDown = (key, duration) => key.isDown && (duration === undefined || scene.clock.now - key.timeDown >= duration);
  keyboard.addCapture = (c) => { keyboard.captures.push(c); return keyboard; };
  keyboard.removeCapture = (c) => { keyboard.captures = keyboard.captures.filter((x) => x !== c); return keyboard; };
  keyboard.clearCaptures = () => { keyboard.captures.length = 0; return keyboard; };
  keyboard.getCaptures = () => keyboard.captures.slice();
  keyboard.enableGlobalCapture = () => keyboard;
  keyboard.disableGlobalCapture = () => keyboard;
  keyboard.isDown = (code) => { const k = keys.get(keyName(code)); return !!(k && k.isDown); };
  const keyEvent = (name, type) => ({ type, key: name.length === 1 ? name.toLowerCase() : name, keyCode: KEY_CODES[name] || 0, code: name, repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  keyboard.press = function (code) {
    const name = keyName(code);
    const e = keyEvent(name, 'keydown');
    keyboard.log.push(['press', name]);
    const key = keys.get(name);
    if (key && key.enabled) {
      if (!key.isDown) { key._justDown = true; key.timeDown = scene.clock.now; }
      key.isDown = true; key.isUp = false; key.originalEvent = e;
      key.emit('down', key, e);
    }
    if (keyboard.enabled) { kev.emit('keydown', e); kev.emit('keydown-' + name, e); }
    return keyboard;
  };
  keyboard.release = function (code) {
    const name = keyName(code);
    const e = keyEvent(name, 'keyup');
    keyboard.log.push(['release', name]);
    const key = keys.get(name);
    if (key && key.enabled) {
      if (key.isDown) { key._justUp = true; key.timeUp = scene.clock.now; key.duration = key.timeUp - key.timeDown; }
      key.isDown = false; key.isUp = true; key.originalEvent = e;
      key.emit('up', key, e);
    }
    if (keyboard.enabled) { kev.emit('keyup', e); kev.emit('keyup-' + name, e); }
    return keyboard;
  };
  keyboard.tap = (code) => { keyboard.press(code); keyboard.release(code); return keyboard; };
  keyboard.destroy = () => { keyboard.enabled = false; };

  const pointerAt = (x, y, isDown, id) => {
    const cam = scene.cameras.main;
    const prev = input.activePointer || { x: 0, y: 0, downX: 0, downY: 0 };
    const p = { kind: 'pointer', id: id || 1, x, y, worldX: cam.scrollX + x / cam.zoom, worldY: cam.scrollY + y / cam.zoom, isDown: !!isDown, button: 0, buttons: isDown ? 1 : 0, position: { x, y }, prevPosition: { x: prev.x, y: prev.y }, downX: isDown ? x : prev.downX, downY: isDown ? y : prev.downY, upX: x, upY: y, downTime: scene.clock.now, upTime: scene.clock.now, velocity: { x: 0, y: 0 }, event: { preventDefault() {}, stopPropagation() {} }, camera: cam, wasTouch: false, primaryDown: !!isDown, active: true, locked: false, deltaX: 0, deltaY: 0, deltaZ: 0 };
    p.leftButtonDown = () => p.isDown;
    p.rightButtonDown = () => false;
    p.middleButtonDown = () => false;
    p.leftButtonReleased = () => !p.isDown;
    p.getDuration = () => p.upTime - p.downTime;
    p.positionToCamera = () => ({ x: p.worldX, y: p.worldY });
    p.getDistance = () => Math.hypot(p.x - p.downX, p.y - p.downY);
    p.noButtonDown = () => !p.isDown;
    return p;
  };
  input.activePointer = pointerAt(0, 0, false);
  input.mousePointer = input.activePointer;
  input.pointer1 = input.activePointer;
  input.pointers = [input.activePointer];
  /** The interactive objects under a screen point, top-most first (only the top one unless topOnly is false). */
  input.hitTest = function (x, y) {
    const hits = scene.made.filter((g) => g.input && g.input.enabled && !g.destroyed && g.visible && g.getBounds);
    const under = hits.filter((g) => {
      const b = g.getBounds();
      let ox = 0; let oy = 0;
      for (let c = g.parentContainer; c; c = c.parentContainer) { ox += c.x; oy += c.y; }
      const cam = scene.cameras.main;
      const wx = cam.scrollX * g.scrollFactorX + x / cam.zoom;
      const wy = cam.scrollY * g.scrollFactorY + y / cam.zoom;
      return wx >= b.left + ox && wx <= b.right + ox && wy >= b.top + oy && wy <= b.bottom + oy;
    });
    under.sort((a, b) => (b.depth - a.depth) || (scene.made.indexOf(b) - scene.made.indexOf(a)));
    return input.topOnly ? under.slice(0, 1) : under;
  };
  const dispatch = (name, x, y, isDown) => {
    const p = pointerAt(x, y, isDown);
    input.activePointer = p;
    input.log.push([name, x, y]);
    const over = input.enabled ? input.hitTest(x, y) : [];
    for (const g of over) {
      if (name === 'pointermove' && !g.input.wasOver) { g.input.wasOver = true; g.emit('pointerover', p, x, y, p.event); ev.emit('gameobjectover', p, g, p.event); }
      g.emit(name, p, x, y, p.event);
      ev.emit('gameobject' + name.slice(7), p, g, p.event);
    }
    if (name === 'pointermove') for (const g of scene.made) if (g.input && g.input.wasOver && over.indexOf(g) < 0) { g.input.wasOver = false; g.emit('pointerout', p, p.event); ev.emit('gameobjectout', p, g, p.event); }
    if (input.enabled) ev.emit(name, p, over);
    return p;
  };
  input.down = (x, y) => dispatch('pointerdown', x, y, true);
  input.up = (x, y) => dispatch('pointerup', x, y, false);
  input.move = (x, y) => dispatch('pointermove', x, y, input.activePointer.isDown);
  input.tap = (x, y) => { input.down(x, y); return input.up(x, y); };
  input.wheel = (x, y, deltaY) => { const p = pointerAt(x, y, false); p.deltaY = deltaY; ev.emit('wheel', p, input.hitTest(x, y), 0, deltaY, 0); return p; };
  input.setDefaultCursor = (c) => { input.defaultCursor = c; input.log.push(['setDefaultCursor', c]); return input; };
  input.setTopOnly = (v) => { input.topOnly = !!v; return input; };
  input.setGlobalTopOnly = input.setTopOnly;
  input.setPollAlways = () => input;
  input.setPollRate = () => input;
  input.setPollOnMove = () => input;
  input.addPointer = (n) => { for (let i = 0; i < (n || 1); i++) input.pointers.push(pointerAt(0, 0, false, input.pointers.length + 1)); input.pointersTotal = input.pointers.length; return input.pointers.slice(-1); };
  input.setDraggable = (g, v) => { for (const one of Array.isArray(g) ? g : [g]) if (one.input) one.input.draggable = v !== false; return input; };
  input.setHitArea = (g) => { for (const one of Array.isArray(g) ? g : [g]) if (!one.input) one.setInteractive(); return input; };
  input.enableDebug = () => input;
  input.isOver = true;
  input.mouse = { enabled: true, locked: false, disableContextMenu() { input.log.push(['disableContextMenu']); return this; }, requestPointerLock() { this.locked = true; }, releasePointerLock() { this.locked = false; }, preventDefaultDown: true, preventDefaultUp: true };
  input.touch = { enabled: true, capture: true, disableContextMenu() { return this; } };
  input.keyboard = keyboard;
  input.manager = { canvas: null, enabled: true, events: emitter(), pointers: input.pointers, activePointer: input.activePointer, setDefaultCursor: input.setDefaultCursor, isOver: true };
  input.gamepad = o.gamepad ? makeGamepad() : undefined;
  input.destroy = () => { input.enabled = false; };
  return input;
}

/** A gamepad plugin with no pad until connect(spec) hands it one. @returns {any} */
export function makeGamepad() {
  const ev = emitter();
  const G = Object.assign({ kind: 'gamepad', enabled: true, total: 0, gamepads: [], pad1: null, pad2: null, pad3: null, pad4: null, log: [] }, ev);
  G.getPad = (i) => G.gamepads[i] || null;
  G.getAll = () => G.gamepads.slice();
  G.isActive = () => G.total > 0;
  G.connect = function (spec) {
    const s = spec || {};
    const pad = Object.assign({ kind: 'pad', id: s.id || 'stub-pad', index: G.gamepads.length, connected: true, axes: [], buttons: [], leftStick: { x: 0, y: 0 }, rightStick: { x: 0, y: 0 }, A: false, B: false, X: false, Y: false, L1: false, R1: false, L2: 0, R2: 0, up: false, down: false, left: false, right: false, vibration: null }, emitter(), s);
    for (let i = 0; i < 4; i++) pad.axes.push({ index: i, value: 0, threshold: 0.1, getValue() { return Math.abs(this.value) < this.threshold ? 0 : this.value; } });
    for (let i = 0; i < 17; i++) pad.buttons.push({ index: i, value: 0, pressed: false, threshold: 1 });
    pad.getAxisValue = (i) => (pad.axes[i] ? pad.axes[i].getValue() : 0);
    pad.getAxisTotal = () => pad.axes.length;
    pad.getButtonTotal = () => pad.buttons.length;
    pad.getButtonValue = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    pad.isButtonDown = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    pad.setAxisThreshold = (v) => { for (const a of pad.axes) a.threshold = v; };
    pad.press = (i) => { pad.buttons[i].pressed = true; pad.buttons[i].value = 1; pad.emit('down', i, 1, pad.buttons[i]); G.emit('down', pad, pad.buttons[i], 1); };
    pad.release = (i) => { pad.buttons[i].pressed = false; pad.buttons[i].value = 0; pad.emit('up', i, 0, pad.buttons[i]); G.emit('up', pad, pad.buttons[i], 0); };
    pad.destroy = () => { pad.connected = false; };
    G.gamepads.push(pad);
    G.total = G.gamepads.length;
    G['pad' + G.total] = pad;
    G.log.push(['connect', pad.id]);
    G.emit('connected', pad, { gamepad: pad });
    return pad;
  };
  G.disconnect = function (pad) {
    const i = G.gamepads.indexOf(pad);
    if (i < 0) return;
    G.gamepads.splice(i, 1);
    pad.connected = false;
    G.total = G.gamepads.length;
    for (let n = 1; n <= 4; n++) G['pad' + n] = G.gamepads[n - 1] || null;
    G.emit('disconnected', pad, { gamepad: pad });
  };
  return G;
}

/**
 * The sound manager with a stub AudioContext under it. `locked` is false until lock() says
 * otherwise; unlock() fires 'unlocked' the way a first gesture does.
 * @returns {any}
 */
export function makeSound(scene, ctx) {
  const ev = emitter();
  const context = ctx || makeAudioContext();
  const S = Object.assign({ kind: 'sound', context, destination: context.destination, locked: false, mute: false, volume: 1, rate: 1, detune: 0, pauseOnBlur: true, sounds: [], log: [], gameLostFocus: false }, ev);
  const chain = (name, fn) => { S[name] = function (...a) { S.log.push([name, ...a]); scene.log.push({ kind: 'sound', method: name, args: a, target: S }); const r = fn(...a); return r === undefined ? S : r; }; };
  function soundObject(key, cfg) {
    const sev = emitter();
    const c = Object.assign({ loop: false, volume: 1, rate: 1, detune: 0, seek: 0, mute: false, delay: 0 }, cfg || {});
    const s = Object.assign({ kind: 'soundObject', key, config: c, isPlaying: false, isPaused: false, loop: c.loop, volume: c.volume, rate: c.rate, detune: c.detune, mute: c.mute, seek: c.seek, duration: 1, totalDuration: 1, markers: {}, currentMarker: null, log: [], pendingRemove: false, hasEnded: false, totalRate: c.rate, manager: S }, sev);
    const sc = (name, fn) => { s[name] = function (...a) { s.log.push([name, ...a]); const r = fn(...a); return r === undefined ? s : r; }; };
    sc('play', (marker, pc) => { if (typeof marker === 'object' && marker) Object.assign(s, marker); if (pc) Object.assign(s, pc); if (typeof marker === 'string') s.currentMarker = s.markers[marker] || { name: marker }; s.isPlaying = true; s.isPaused = false; s.hasEnded = false; s.emit('play', s); return true; });
    sc('stop', () => { const was = s.isPlaying; s.isPlaying = false; s.isPaused = false; if (was) s.emit('stop', s); return was; });
    sc('pause', () => { if (!s.isPlaying) return false; s.isPlaying = false; s.isPaused = true; s.emit('pause', s); return true; });
    sc('resume', () => { if (!s.isPaused) return false; s.isPlaying = true; s.isPaused = false; s.emit('resume', s); return true; });
    sc('setVolume', (v) => { s.volume = v; s.emit('volume', s, v); });
    sc('setRate', (v) => { s.rate = v; s.totalRate = v; s.emit('rate', s, v); });
    sc('setDetune', (v) => { s.detune = v; s.emit('detune', s, v); });
    sc('setLoop', (v) => { s.loop = !!v; s.emit('loop', s, !!v); });
    sc('setMute', (v) => { s.mute = !!v; s.emit('mute', s, !!v); });
    sc('setSeek', (v) => { s.seek = v; s.emit('seek', s, v); });
    sc('addMarker', (m) => { s.markers[m.name] = m; return true; });
    sc('updateMarker', (m) => { s.markers[m.name] = m; return true; });
    sc('removeMarker', (n) => { const m = s.markers[n]; delete s.markers[n]; return m || null; });
    sc('finish', () => { s.isPlaying = false; s.hasEnded = true; s.emit('complete', s); });
    sc('destroy', () => { s.stop(); s.pendingRemove = true; s.destroyed = true; const i = S.sounds.indexOf(s); if (i >= 0) S.sounds.splice(i, 1); s.emit('destroy', s); });
    return s;
  }
  chain('add', (key, cfg) => { const s = soundObject(key, cfg); S.sounds.push(s); return s; });
  chain('addAudioSprite', (key, cfg) => { const s = soundObject(key, cfg); s.spritemap = {}; S.sounds.push(s); return s; });
  chain('play', (key, cfg) => { if (S.locked) return false; const s = S.add(key, cfg); s.play(); return true; });
  chain('playAudioSprite', (key, marker, cfg) => { const s = S.addAudioSprite(key, cfg); return s.play(marker); });
  chain('get', (key) => S.sounds.find((s) => s.key === key) || null);
  chain('getAll', (key) => S.sounds.filter((s) => key === undefined || s.key === key));
  chain('getAllPlaying', () => S.sounds.filter((s) => s.isPlaying));
  chain('isPlaying', (key) => S.sounds.some((s) => s.key === key && s.isPlaying));
  chain('remove', (s) => { const i = S.sounds.indexOf(s); if (i < 0) return false; s.destroy(); return true; });
  chain('removeByKey', (key) => { const list = S.sounds.filter((s) => s.key === key); for (const s of list) s.destroy(); return list.length; });
  chain('removeAll', () => { for (const s of S.sounds.slice()) s.destroy(); });
  chain('stopAll', () => { for (const s of S.sounds) s.stop(); S.emit('stopall', S); });
  chain('stopByKey', (key) => { let n = 0; for (const s of S.sounds) if (s.key === key && s.stop()) n += 1; return n; });
  chain('pauseAll', () => { for (const s of S.sounds) s.pause(); S.emit('pauseall', S); });
  chain('resumeAll', () => { for (const s of S.sounds) s.resume(); S.emit('resumeall', S); });
  chain('setMute', (v) => { S.mute = !!v; S.emit('mute', S, !!v); });
  chain('setVolume', (v) => { S.volume = v; S.emit('volume', S, v); });
  chain('setRate', (v) => { S.rate = v; S.emit('rate', S, v); });
  chain('setDetune', (v) => { S.detune = v; S.emit('detune', S, v); });
  chain('setListenerPosition', () => {});
  chain('unlock', () => { if (!S.locked) return; S.locked = false; S.emit('unlocked', S); });
  chain('lock', () => { S.locked = true; });
  chain('destroy', () => { S.removeAll(); S.destroyed = true; });
  S.update = () => {};
  S.onBlur = () => {};
  S.onFocus = () => {};
  return S;
}
