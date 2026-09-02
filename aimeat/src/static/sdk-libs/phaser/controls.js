/**
 * @file phaser/controls.js
 * @description One input state per frame, whatever the player is holding. Keyboard, gamepad and a
 *   touch overlay all feed the same seven booleans (left, right, up, down, jump, action, pause) and
 *   the same analog `axis`, so a scene reads `c.left` and never asks which device said so.
 *
 *   EVERY GAME HERE OTHERWISE REWRITES THIS. Arrow keys and WASD, a stick with a dead zone, a
 *   d-pad, and a phone with no keys at all: four input paths, one state. The scheme is a plain map
 *   from an action name to Phaser key names, so a player's rebinding is one call and a game that
 *   wants different keys writes them in the options rather than in its update loop.
 *
 *   THE TOUCH OVERLAY IS DOM, NOT CANVAS. A joystick pad on the left and two round buttons on the
 *   right, mounted over the canvas as ordinary elements and dressed by /lib/aimeat-phaser/
 *   controls.css on the Atelier tokens. Only the parts themselves take pointer events, so a tap
 *   between them still reaches the game, and each part sets touch-action none so dragging the
 *   stick never scrolls the page behind it. WHETHER it shows is a stylesheet question: this module
 *   writes data-ak-touch="auto|on|off" and the CSS media query answers 'auto', so a device that
 *   changes its pointer mid-session needs nothing re-run.
 *
 *   READ AFTER update(). The booleans are a snapshot: call `c.update()` once at the top of the
 *   scene's update and read the state below it. That is also where the press edges are found, so
 *   `justPressed()` and the `on()` handlers are exactly one frame wide.
 *
 *   THE GAMEPAD NEEDS PERMISSION FROM THE GAME CONFIG. Phaser only starts its gamepad plugin when
 *   the game was created with `input: { gamepad: true }`. Without it `scene.input.gamepad` is
 *   undefined and this module quietly runs on keyboard and touch alone.
 * @structure defaults (scheme, dead zone) · key helpers · gamepad reading · the touch overlay ·
 *   controls(scene, opts) returning the state with update/justPressed/on/rebind/bindings/
 *   showTouch/vibrate/destroy
 * @usage
 *   const c = AIMEAT.phaser.controls(this, { touch: 'auto', gamepad: true });
 *   // in update(): c.update(); if (c.left) player.x -= 3; if (c.jump) jump();
 *   c.on('pause', () => this.scene.pause());
 * @version-history
 *   v1.0.0 - 2026-09-02 - Initial: the seven actions, the rebindable scheme, gamepad stick and
 *     d-pad, and the DOM touch overlay.
 */

/** The keys each action answers to until the game or the player says otherwise. */
const DEFAULT_SCHEME = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  up: ['UP', 'W'],
  down: ['DOWN', 'S'],
  jump: ['SPACE', 'UP', 'W'],
  action: ['X', 'K', 'ENTER'],
  pause: ['ESC', 'P'],
};

/** The actions, in the order the state object reports them. */
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'action', 'pause'];

/** How far a stick travels before it counts as pushed. */
const DEFAULT_DEAD_ZONE = 0.2;

/**
 * How far the drawn knob is thrown, as a share of its OWN width: a CSS translate percentage
 * resolves against the element's own box, not its parent's, so this is the knob's size and not the
 * pad's radius.
 */
const KNOB_TRAVEL = 0.62;

/**
 * What `controls()` was given.
 * @typedef {Object} ControlsOptions
 * @property {boolean} [keyboard]   Read the arrow keys. Default true.
 * @property {boolean} [wasd]       Read WASD as well. Default true.
 * @property {boolean} [gamepad]    Read a connected pad. Default true, and it needs
 *   `input: { gamepad: true }` in the game config to have anything to read.
 * @property {'auto'|boolean} [touch]  The on-screen overlay. 'auto' (the default) shows it on a
 *   coarse pointer, true always shows it, false never does.
 * @property {Partial<typeof DEFAULT_SCHEME>} [scheme]  Action to Phaser key names.
 * @property {Element} [touchTarget]  Where the overlay mounts. Default: the canvas's parent.
 * @property {number} [deadZone]    Stick travel that counts as nothing. Default 0.2.
 */

/** The pad Phaser is currently seeing, or null. */
function readPad(scene) {
  const gp = scene && scene.input && scene.input.gamepad;
  if (!gp || !gp.total) return null;
  if (gp.pad1) return gp.pad1;
  if (typeof gp.getPad === 'function') {
    const p = gp.getPad(0);
    if (p) return p;
  }
  return (gp.gamepads && gp.gamepads[0]) || null;
}

/** A stick value with the dead zone removed and the remainder rescaled to the full range. */
function applyDeadZone(v, dead) {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  const mag = Math.abs(n);
  if (mag <= dead) return 0;
  const scaled = (mag - dead) / (1 - dead);
  return n < 0 ? -scaled : scaled;
}

/** Clamp to -1..1. */
function clamp1(v) {
  return v < -1 ? -1 : (v > 1 ? 1 : v);
}

/**
 * Build the touch overlay: a stick pad on the left and two buttons on the right. Returns the
 * element plus the state its pointers write into, and the function that takes it all down.
 *
 * Presses are recorded twice: `jump` is true while the finger is down, and `jumpTap` latches a
 * press that arrived and left between two frames. update() reads both and clears the latch, so a
 * quick tap still counts for exactly one frame and never for two.
 *
 * @param {Element} host
 */
function buildOverlay(host) {
  const doc = host.ownerDocument || document;
  const root = doc.createElement('div');
  root.className = 'ak-touchpad';

  const stick = doc.createElement('div');
  stick.className = 'ak-touchpad__stick';
  stick.setAttribute('role', 'application');
  stick.setAttribute('aria-label', 'Movement stick');
  const knob = doc.createElement('div');
  knob.className = 'ak-touchpad__knob';
  stick.appendChild(knob);

  const bank = doc.createElement('div');
  bank.className = 'ak-touchpad__bank';
  const jumpBtn = doc.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'ak-touchpad__btn ak-touchpad__btn--jump';
  jumpBtn.textContent = 'Jump';
  const actionBtn = doc.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'ak-touchpad__btn ak-touchpad__btn--action';
  actionBtn.textContent = 'Act';
  bank.appendChild(jumpBtn);
  bank.appendChild(actionBtn);

  root.appendChild(stick);
  root.appendChild(bank);
  // The overlay is absolutely placed inside the game's frame, so the frame has to be a positioning
  // context. That is one class rather than an inline style, and it comes off again on destroy.
  host.classList.add('ak-touchpad-host');
  host.appendChild(root);

  const touch = {
    x: 0, y: 0, active: false,
    jump: false, action: false,
    jumpTap: false, actionTap: false,
  };
  /** @type {(() => void)[]} */
  const undo = [];

  let pointerId = -1;

  function place(dx, dy) {
    knob.style.setProperty('--ak-touchpad-knob-x', (dx * KNOB_TRAVEL * 100).toFixed(1) + '%');
    knob.style.setProperty('--ak-touchpad-knob-y', (dy * KNOB_TRAVEL * 100).toFixed(1) + '%');
  }

  function readStick(ev) {
    const box = stick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(box.width, box.height) / 2);
    const dx = clamp1((ev.clientX - (box.left + box.width / 2)) / radius);
    const dy = clamp1((ev.clientY - (box.top + box.height / 2)) / radius);
    touch.x = dx;
    touch.y = dy;
    place(dx, dy);
  }

  function springBack() {
    pointerId = -1;
    touch.active = false;
    touch.x = 0;
    touch.y = 0;
    stick.classList.remove('is-held');
    place(0, 0);
  }

  function onStickDown(ev) {
    pointerId = ev.pointerId;
    touch.active = true;
    stick.classList.add('is-held');
    if (typeof stick.setPointerCapture === 'function') {
      try {
        stick.setPointerCapture(ev.pointerId);
      } catch (err) {
        console.warn('[aimeat-phaser] the stick could not capture the pointer:', err);
      }
    }
    readStick(ev);
    ev.preventDefault();
  }

  function onStickMove(ev) {
    if (!touch.active || ev.pointerId !== pointerId) return;
    readStick(ev);
    ev.preventDefault();
  }

  function onStickUp(ev) {
    if (ev.pointerId !== pointerId) return;
    springBack();
    ev.preventDefault();
  }

  function bind(node, type, fn) {
    node.addEventListener(type, fn);
    undo.push(function () { node.removeEventListener(type, fn); });
  }

  bind(stick, 'pointerdown', onStickDown);
  bind(stick, 'pointermove', onStickMove);
  bind(stick, 'pointerup', onStickUp);
  bind(stick, 'pointercancel', onStickUp);

  /** One round button: held while a pointer is on it, with the press latched for one frame. */
  function wireButton(node, name) {
    bind(node, 'pointerdown', function (ev) {
      touch[name] = true;
      touch[name + 'Tap'] = true;
      node.classList.add('is-held');
      ev.preventDefault();
    });
    const release = function (ev) {
      touch[name] = false;
      node.classList.remove('is-held');
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    };
    bind(node, 'pointerup', release);
    bind(node, 'pointercancel', release);
    bind(node, 'pointerleave', release);
    // A click reaches the button after the pointer pair on some browsers; swallowing it keeps the
    // press from being counted twice.
    bind(node, 'click', function (ev) { ev.preventDefault(); });
  }

  wireButton(jumpBtn, 'jump');
  wireButton(actionBtn, 'action');

  return {
    root: root,
    touch: touch,
    /**
     * Say WHEN the pad shows, and let the stylesheet decide whether that is now: 'auto' shows it
     * on a coarse pointer only, 'on' always, 'off' never. Keeping the media query in CSS means a
     * phone that is also holding a keyboard does not need this module to re-run anything.
     * @param {'auto'|'on'|'off'} mode
     */
    show(mode) {
      root.setAttribute('data-ak-touch', mode);
      if (mode === 'off') springBack();
    },
    destroy() {
      for (const off of undo) off();
      springBack();
      host.classList.remove('ak-touchpad-host');
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * Read one scene's input as a single state.
 *
 * @param {any} scene  The Phaser scene. Its `input` plugin is what this reads.
 * @param {ControlsOptions} [opts]
 * @returns {{
 *   left: boolean, right: boolean, up: boolean, down: boolean,
 *   jump: boolean, action: boolean, pause: boolean,
 *   axis: { x: number, y: number },
 *   update: () => void,
 *   justPressed: (name: string) => boolean,
 *   on: (name: string, fn: () => void) => (() => void),
 *   rebind: (name: string, keys: string[]) => void,
 *   bindings: () => Record<string, string[]>,
 *   showTouch: (on: boolean) => void,
 *   vibrate: (ms: number) => boolean,
 *   destroy: () => void,
 * }}
 */
export function controls(scene, opts) {
  const o = opts || {};
  const useKeyboard = o.keyboard !== false;
  const useWasd = o.wasd !== false;
  const useGamepad = o.gamepad !== false;
  const dead = typeof o.deadZone === 'number' ? Math.min(0.9, Math.max(0, o.deadZone)) : DEFAULT_DEAD_ZONE;

  /** @type {Record<string, string[]>} */
  const scheme = {};
  for (const name of ACTIONS) {
    const given = o.scheme && /** @type {any} */ (o.scheme)[name];
    scheme[name] = Array.isArray(given) ? given.slice() : DEFAULT_SCHEME[name].slice();
  }
  // WASD is part of the default scheme, so turning it off means dropping the letter keys rather
  // than adding anything.
  if (!useWasd) {
    const letters = ['W', 'A', 'S', 'D'];
    for (const name of ACTIONS) {
      scheme[name] = scheme[name].filter(function (k) { return letters.indexOf(k) < 0; });
    }
  }

  /** @type {Record<string, any>} Phaser Key objects, one per distinct key name. */
  const keys = {};
  const keyboard = useKeyboard && scene && scene.input ? scene.input.keyboard : null;

  function ensureKey(codeName) {
    if (!keyboard || keys[codeName]) return;
    try {
      keys[codeName] = keyboard.addKey(codeName);
    } catch (err) {
      console.warn('[aimeat-phaser] key "' + codeName + '" could not be bound:', err);
    }
  }

  for (const name of ACTIONS) {
    for (const codeName of scheme[name]) ensureKey(codeName);
  }

  // ── The state the scene reads ─────────────────────────────────────────────────────────────

  const state = /** @type {any} */ ({
    left: false, right: false, up: false, down: false,
    jump: false, action: false, pause: false,
    axis: { x: 0, y: 0 },
  });

  /** @type {Record<string, boolean>} last frame's values, for the press edges. */
  const previous = {};
  /** @type {Record<string, boolean>} */
  const edges = {};
  for (const name of ACTIONS) {
    previous[name] = false;
    edges[name] = false;
  }

  /** @type {Record<string, ((() => void))[]>} */
  const handlers = {};

  function fire(name) {
    const list = handlers[name];
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        fn();
      } catch (err) {
        console.warn('[aimeat-phaser] a controls handler for "' + name + '" threw:', err);
      }
    }
  }

  // ── The touch overlay ─────────────────────────────────────────────────────────────────────

  const touchMode = (o.touch === undefined || o.touch === 'auto') ? 'auto' : (o.touch ? 'on' : 'off');
  const host = o.touchTarget
    || (scene && scene.game && scene.game.canvas && scene.game.canvas.parentElement)
    || (typeof document !== 'undefined' ? document.body : null);
  /** @type {any} */
  let overlay = null;
  if (host) {
    overlay = buildOverlay(host);
    overlay.show(touchMode);
  }

  // ── Reading ───────────────────────────────────────────────────────────────────────────────

  function keyHeld(name) {
    const list = scheme[name];
    for (const codeName of list) {
      const k = keys[codeName];
      if (k && k.isDown) return true;
    }
    return false;
  }

  /**
   * One frame. Reads the keyboard, the pad and the overlay, folds them into the seven booleans and
   * the axis, then works out which of them were pressed on this frame.
   */
  function update() {
    const pad = useGamepad ? readPad(scene) : null;
    // A pad the stylesheet is not showing takes no pointers, so its state is already all zero and
    // there is nothing to check first.
    const touch = overlay ? overlay.touch : null;

    let ax = 0;
    let ay = 0;
    if (touch && touch.active) {
      ax = applyDeadZone(touch.x, dead);
      ay = applyDeadZone(touch.y, dead);
    }
    if (pad && ax === 0 && ay === 0) {
      const stick = pad.leftStick;
      if (stick) {
        ax = applyDeadZone(stick.x, dead);
        ay = applyDeadZone(stick.y, dead);
      } else if (pad.axes && pad.axes.length >= 2) {
        ax = applyDeadZone(pad.axes[0].getValue(), dead);
        ay = applyDeadZone(pad.axes[1].getValue(), dead);
      }
    }

    const padLeft = !!(pad && pad.left);
    const padRight = !!(pad && pad.right);
    const padUp = !!(pad && pad.up);
    const padDown = !!(pad && pad.down);

    let left = keyHeld('left') || padLeft || ax < -dead;
    let right = keyHeld('right') || padRight || ax > dead;
    let up = keyHeld('up') || padUp || ay < -dead;
    let down = keyHeld('down') || padDown || ay > dead;

    // Keys and the d-pad are digital, so they have to reach the axis too, or a keyboard player
    // gets booleans and no `axis` at all.
    if (ax === 0) ax = (right ? 1 : 0) - (left ? 1 : 0);
    if (ay === 0) ay = (down ? 1 : 0) - (up ? 1 : 0);

    state.left = left;
    state.right = right;
    state.up = up;
    state.down = down;
    state.jump = keyHeld('jump') || !!(touch && (touch.jump || touch.jumpTap))
      || !!(pad && pad.A);
    state.action = keyHeld('action') || !!(touch && (touch.action || touch.actionTap))
      || !!(pad && (pad.B || pad.X));
    state.pause = keyHeld('pause')
      || !!(pad && pad.buttons && pad.buttons[9] && pad.buttons[9].pressed);
    state.axis.x = clamp1(ax);
    state.axis.y = clamp1(ay);

    for (const name of ACTIONS) {
      const now = !!state[name];
      edges[name] = now && !previous[name];
      previous[name] = now;
      if (edges[name]) fire(name);
    }

    // The latches have now been counted. Clearing them here, after the edges, is what keeps a tap
    // that came and went between two frames worth exactly one press.
    if (touch) {
      touch.jumpTap = false;
      touch.actionTap = false;
    }
  }

  // ── The rest of the surface ───────────────────────────────────────────────────────────────

  /** Was this action pressed on the frame just read? */
  function justPressed(name) {
    return !!edges[name];
  }

  /**
   * Run something on the press edge of an action.
   * @param {string} name
   * @param {() => void} fn
   * @returns {() => void} stop listening
   */
  function on(name, fn) {
    if (typeof fn !== 'function' || ACTIONS.indexOf(name) < 0) {
      return function () { /* nothing was registered */ };
    }
    if (!handlers[name]) handlers[name] = [];
    handlers[name].push(fn);
    return function () {
      handlers[name] = handlers[name].filter(function (f) { return f !== fn; });
    };
  }

  /**
   * Point an action at different keys. Phaser key names, for example ['SPACE', 'Z'].
   * @param {string} name
   * @param {string[]} nextKeys
   */
  function rebind(name, nextKeys) {
    if (ACTIONS.indexOf(name) < 0 || !Array.isArray(nextKeys)) return;
    scheme[name] = nextKeys.slice();
    for (const codeName of scheme[name]) ensureKey(codeName);
  }

  /** The scheme as it stands, as a copy. */
  function bindings() {
    /** @type {Record<string, string[]>} */
    const out = {};
    for (const name of ACTIONS) out[name] = scheme[name].slice();
    return out;
  }

  /** Show or hide the on-screen pad, whatever kind of pointer the device has. */
  function showTouch(on2) {
    if (overlay) overlay.show(on2 ? 'on' : 'off');
  }

  /**
   * A short buzz, where the device has one. Returns whether anything happened, so a game can pair
   * the buzz with something visible instead of relying on it.
   * @param {number} ms
   * @returns {boolean}
   */
  function vibrate(ms) {
    const n = typeof ms === 'number' && isFinite(ms) ? Math.max(1, Math.min(1000, ms)) : 20;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    try {
      return !!navigator.vibrate(n);
    } catch (err) {
      console.warn('[aimeat-phaser] vibrate was refused:', err);
      return false;
    }
  }

  /** Give the keys back, take the overlay down, forget the handlers. */
  function destroy() {
    if (keyboard && typeof keyboard.removeKey === 'function') {
      for (const codeName in keys) {
        try {
          keyboard.removeKey(keys[codeName]);
        } catch (err) {
          console.warn('[aimeat-phaser] key "' + codeName + '" could not be released:', err);
        }
        delete keys[codeName];
      }
    }
    if (overlay) {
      overlay.destroy();
      overlay = null;
    }
    for (const name of ACTIONS) handlers[name] = [];
  }

  state.update = update;
  state.justPressed = justPressed;
  state.on = on;
  state.rebind = rebind;
  state.bindings = bindings;
  state.showTouch = showTouch;
  state.vibrate = vibrate;
  state.destroy = destroy;
  return state;
}
