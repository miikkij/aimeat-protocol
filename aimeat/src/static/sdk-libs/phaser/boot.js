/**
 * @file phaser/boot.js
 * @description Getting a Phaser 4 game onto the screen, in the clothes the rest of this node
 *   wears. Three things live here.
 *
 *   ensurePhaser() loads /lib/phaser@4.min.js FROM THIS NODE, once, whoever asks first. The
 *   engine is vendored here (the phaser4 library pack) and is never fetched from an outside
 *   host, so a game keeps working on a private node with no way out to the internet.
 *
 *   theme(el) reads the Atelier --ak-* tokens off a real element and hands back NUMBERS, which
 *   is what Phaser wants everywhere it takes a colour. A token may be a var() chain or a
 *   color-mix(), so the value is resolved the only way that always works: paint it and read the
 *   pixel back. When the kit's stylesheet is not on the page the tokens are absent and a
 *   documented fallback set stands in, so a bare page still gets a finished-looking game.
 *
 *   game(spec) boots one. It wraps a FRAME around the canvas (class ak-phaser) and that frame is
 *   what goes full screen, so a DOM overlay an app draws over the game stays inside the picture
 *   instead of being left behind on the page. A ResizeObserver keeps 'resize' scaling honest when
 *   the box changes for a reason the window never hears about, and the loop sleeps while the tab
 *   is hidden.
 *
 *   NOTHING HERE LOOPS. The observer and the visibility listener are the only standing
 *   subscriptions, both removed by destroy().
 *
 *   THE PHONE HALF IS ASKED FOR, NEVER ASSUMED. `spec.mobile` wires mobile.js onto the handle as
 *   `handle.mobile`, and a spec that does not mention it leaves the handle without the member and
 *   the page without a single extra listener. It is wired here rather than by the app because the
 *   orientation prompt belongs INSIDE the frame, and the frame is what this file owns.
 * @structure ensurePhaser · theme (+ theme.css, hex) · game(spec) → handle
 * @usage
 *   import { game, theme } from './boot.js';
 *   const h = await game({ parent: '#stage', scale: 'fit', fullscreen: 'button', scenes: [play] });
 *   h.theme.accent   // 0xe8564a on the default palette, a number Phaser accepts anywhere
 * @version-history
 *   v1.1.1 — 2026-09-02 — The gamepad plugin is on in the game config (spec.gamepad, default
 *     true), so controls() can read a pad at all.
 *   v1.1.0 — 2026-09-02 — spec.mobile wires the phone half onto the handle: the orientation
 *     prompt inside the frame, the wake lock and the measured safe area. Absent unless asked for.
 *   v1.0.0 — 2026-09-02 — Initial: the loader, the token reader and the framed boot.
 */
import { NODE_URL } from '../_core/config.js';
import { el, clear, reducedMotion } from '../atelier/dom.js';
import { mobile } from './mobile.js';

/** The vendored engine, served by this node. The phaser@4 filename is the compatibility
 *  contract: version 3 stays where it is, so every game already published keeps running. */
const PHASER_URL = '/lib/phaser@4.min.js';

/** One shared load, whoever asks first. Cleared on failure so a retry may still succeed. */
let phaserPromise = null;

/** @returns {any} the global Phaser namespace, or undefined before the engine has loaded. */
function phaserGlobal() {
  return /** @type {any} */ (window).Phaser;
}

/**
 * Load Phaser 4 from this node, once.
 * @returns {Promise<any>} the Phaser namespace (window.Phaser)
 */
export function ensurePhaser() {
  const already = phaserGlobal();
  if (already && already.Game) return Promise.resolve(already);
  if (phaserPromise) return phaserPromise;
  phaserPromise = new Promise(function (ok, fail) {
    const src = NODE_URL + PHASER_URL;
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.onload = function () {
      const P = phaserGlobal();
      if (P && P.Game) { ok(P); return; }
      phaserPromise = null;
      fail(new Error('The game engine loaded from ' + src + ' but left no Phaser on the page.'));
    };
    tag.onerror = function () {
      phaserPromise = null;
      fail(new Error('The game engine could not be loaded from ' + src + '. This node serves it; '
        + 'check that the address is reachable from where the page is running.'));
    };
    document.head.appendChild(tag);
  });
  return phaserPromise;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The look: Atelier tokens as Phaser colours
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Every colour on the theme object, and the token it comes from. */
const COLOUR_TOKENS = {
  bg: '--ak-bg',
  surface: '--ak-surface',
  ink: '--ak-ink',
  inkDim: '--ak-ink-dim',
  accent: '--ak-accent',
  ok: '--ak-ok',
  warn: '--ak-warn',
  err: '--ak-err',
  line: '--ak-line',
  ch1: '--ak-crt-ch1',
  ch2: '--ak-crt-ch2',
  ch3: '--ak-crt-ch3',
  ch4: '--ak-crt-ch4',
};

/**
 * THE NO-KIT FALLBACK SET. These numbers are used only when the token is ABSENT, which means the
 * page never loaded /lib/aimeat-atelier.css. Each one is the light contract default of the token
 * above it, written as a number because Phaser takes numbers; inkDim is that contract's 68/32 mix
 * of ink over surface, worked out once here rather than at every call. A page WITH the kit never
 * reaches these values: the token wins, in whatever palette, look and mode the page is wearing.
 */
const NO_KIT = {
  bg: 0xf3f5f8,
  surface: 0xffffff,
  ink: 0x151a21,
  inkDim: 0x606368,
  accent: 0xe8564a,
  ok: 0x0f7a45,
  warn: 0x8a5300,
  err: 0xb3261e,
  line: 0xd7dce4,
  ch1: 0x24e5ff,
  ch2: 0xff2e9a,
  ch3: 0xffe14d,
  ch4: 0x38f2a0,
};

/** The typography, motion and curve tokens, and what stands in when they are absent. */
const TEXT_TOKENS = {
  font: ['--ak-font', 'ui-sans-serif, system-ui, sans-serif'],
  fontDisplay: ['--ak-font-display', 'ui-sans-serif, system-ui, sans-serif'],
  fontMono: ['--ak-font-mono', 'ui-monospace, SFMono-Regular, Menlo, monospace'],
  ease: ['--ak-ease', 'cubic-bezier(0.2, 0.7, 0.3, 1)'],
};

/** The pace token is a duration, so it is read as a number of milliseconds. */
const MOTION_FALLBACK = 200;

/** The one-pixel pad every colour is painted onto. Built on first use, reused for the life of the page. */
let pad = null;

/** @returns {CanvasRenderingContext2D|null} */
function padContext() {
  if (pad) return pad;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  pad = canvas.getContext('2d', { willReadFrequently: true });
  return pad;
}

/**
 * Turn ANY CSS colour into a number. A token can compute to a form that varies by browser and by
 * colour space, so the value is painted onto a one-pixel pad and read back: whatever the browser
 * understood, the pixel is the truth. An unpaintable value leaves the pad transparent and the
 * fallback is used, so a mistyped token degrades to a colour instead of to black.
 * @param {string} value  a computed CSS colour
 * @param {number} fallback
 * @returns {number} 0xrrggbb
 */
function toColour(value, fallback) {
  const ctx = padContext();
  if (!ctx || !value) return fallback;
  ctx.clearRect(0, 0, 1, 1);
  // An unparseable assignment is ignored and leaves the pad's own fill in place, so the pad is
  // first set to nothing: then "nothing was painted" and "the value made no sense" are one case.
  ctx.fillStyle = 'transparent';
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const px = ctx.getImageData(0, 0, 1, 1).data;
  if (px[3] === 0) return fallback;
  return (px[0] << 16) | (px[1] << 8) | px[2];
}

/**
 * The element the tokens are read from. A canvas is legal to append to but its children are
 * fallback content that never renders, so a caller who passes `game.canvas` (the natural thing to
 * pass) is moved up to the frame around it.
 * @param {Element|null|undefined} host
 * @returns {Element}
 */
function tokenHost(host) {
  const node = host && host.nodeType === 1 ? host : document.body;
  if (node.tagName === 'CANVAS' && node.parentElement) return node.parentElement;
  return node;
}

/**
 * Read every colour token in one pass. One probe per token is put into the host and read after
 * they are all in place, so the browser recalculates style once rather than thirteen times.
 * @param {Element} node
 * @returns {Record<string, number>}
 */
function readColours(node) {
  const style = getComputedStyle(node);
  const names = Object.keys(COLOUR_TOKENS);
  const pen = document.createElement('div');
  pen.setAttribute('aria-hidden', 'true');
  pen.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
  /** @type {HTMLElement[]} */
  const probes = [];
  /** @type {boolean[]} */
  const declared = [];
  for (const name of names) {
    const token = COLOUR_TOKENS[name];
    const has = (style.getPropertyValue(token) || '').trim() !== '';
    const probe = document.createElement('span');
    // An absent token would make `color` invalid at computed-value time, which inherits rather
    // than failing — indistinguishable from a real value. So absence is decided above, and the
    // probe is only asked about tokens the page actually declares.
    if (has) probe.style.color = 'var(' + token + ')';
    pen.appendChild(probe);
    probes.push(probe);
    declared.push(has);
  }
  node.appendChild(pen);
  /** @type {Record<string, number>} */
  const out = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    out[name] = declared[i]
      ? toColour(getComputedStyle(probes[i]).color, NO_KIT[name])
      : NO_KIT[name];
  }
  pen.remove();
  return out;
}

/**
 * @typedef {object} PhaserTheme
 * @property {number} bg        the page ground
 * @property {number} surface   cards, panels, the HUD's plate
 * @property {number} ink       body text
 * @property {number} inkDim    secondary text
 * @property {number} accent    the one colour that means "this"
 * @property {number} ok
 * @property {number} warn
 * @property {number} err
 * @property {number} line      hairlines and edges
 * @property {number} ch1       the four channel colours, for anything that needs a set that
 * @property {number} ch2       reads apart at a glance: player colours, tile kinds, chart series
 * @property {number} ch3
 * @property {number} ch4
 * @property {string} font        the body face, as a CSS font-family list
 * @property {string} fontDisplay the display face
 * @property {string} fontMono    the monospace face
 * @property {number} motion      the kit's pace, in milliseconds
 * @property {string} ease        the kit's curve, as a CSS timing function
 */

/**
 * The Atelier look, as Phaser wants it: colours are numbers, faces are font-family strings.
 * @param {Element|null} [host]  the element whose cascade decides. Defaults to the body; pass the
 *   frame a game lives in so a scoped palette or a look on that subtree is what the game wears.
 * @returns {PhaserTheme}
 */
export function theme(host) {
  const node = tokenHost(host);
  const style = getComputedStyle(node);
  const out = /** @type {any} */ (readColours(node));
  for (const name in TEXT_TOKENS) {
    const pair = TEXT_TOKENS[name];
    out[name] = (style.getPropertyValue(pair[0]) || '').trim() || pair[1];
  }
  out.motion = parseFloat(style.getPropertyValue('--ak-motion')) || MOTION_FALLBACK;
  return /** @type {PhaserTheme} */ (out);
}

/**
 * A colour number as a CSS colour string.
 * @param {number} value 0xrrggbb
 * @returns {string}
 */
export function hex(value) {
  const n = Math.max(0, Math.min(0xffffff, Math.round(value || 0)));
  return '#' + ('000000' + n.toString(16)).slice(-6);
}

/**
 * The same theme with the colours as CSS strings, for the DOM half of a game — a HUD, a settings
 * panel, an overlay. An element that lives inside the frame can of course name the token itself;
 * this is for the places that need a resolved value (a canvas text style, an inline SVG fill).
 * @param {Element|null} [host]
 * @returns {Record<string, string>}
 */
theme.css = function (host) {
  const look = theme(host);
  /** @type {Record<string, string>} */
  const out = {
    font: look.font,
    fontDisplay: look.fontDisplay,
    fontMono: look.fontMono,
    ease: look.ease,
    motion: look.motion + 'ms',
  };
  for (const name in COLOUR_TOKENS) out[name] = hex(look[name]);
  return out;
};

/* ────────────────────────────────────────────────────────────────────────────────────────────
   The boot
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/** The corner brackets, pointing out: enter full screen. */
const ICON_ENTER = 'M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z';
/** The corner brackets, pointing in: leave full screen. */
const ICON_LEAVE = 'M9 4h2v5H6V7h3V4zm4 0h2v3h3v2h-5V4zM6 15h5v5H9v-3H6v-2zm7 0h5v2h-3v3h-2v-5z';

/**
 * A small inline icon. SVG, never an emoji: the interface here carries no emoji at all.
 * @param {string} path
 * @returns {SVGElement}
 */
function icon(path) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = document.createElementNS(ns, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'currentColor');
  svg.appendChild(shape);
  return svg;
}

/**
 * @param {string|Element|null|undefined} target
 * @returns {Element}
 */
function resolveParent(target) {
  if (!target) return document.body;
  if (typeof target === 'string') return document.querySelector(target) || document.body;
  return target;
}

/**
 * The ground the game paints before a scene draws anything.
 * @param {PhaserTheme} look
 * @param {'bg'|'surface'|'ink'|number|undefined} want
 * @returns {number}
 */
function groundColour(look, want) {
  if (typeof want === 'number') return want;
  if (want === 'surface') return look.surface;
  if (want === 'ink') return look.ink;
  return look.bg;
}

/**
 * @typedef {object} GameSpec
 * @property {Element|string} [parent]     where the frame is put. Default: the body.
 * @property {number} [width]              the design width. Default 960.
 * @property {number} [height]             the design height. Default 540.
 * @property {'fit'|'resize'|'fixed'} [scale]  'fit' (default) letterboxes the design size inside
 *   the parent's box and centres it, and the frame keeps the design's aspect ratio. 'resize'
 *   makes the canvas follow the parent's box and hands scenes a 'resize' event with the new size
 *   (`this.scale.on('resize', size => …)`). 'fixed' leaves the canvas at the design size.
 * @property {boolean|'button'} [fullscreen]  true wires full screen up for the handle to drive;
 *   'button' also puts the kit's button in the frame's corner. Escape leaves, as everywhere.
 * @property {Array<any>} [scenes]         Phaser scene classes or plain scene objects.
 * @property {'arcade'|'matter'|null} [physics]  Default 'arcade'. null runs with no physics.
 * @property {{ x?: number, y?: number }} [gravity]  Default { y: 0 }.
 * @property {boolean} [pixelArt]
 * @property {boolean} [gamepad]  the gamepad plugin, on unless false
 * @property {'bg'|'surface'|'ink'|number} [background]  Default 'bg'.
 * @property {boolean} [pauseOnHide]       Default true: the loop sleeps while the tab is hidden.
 * @property {number} [fps]                target frames per second. Default: Phaser's own.
 * @property {boolean} [transparent]       let the page show through the canvas.
 * @property {string} [fullscreenLabel]    the button's label when it will enter full screen.
 * @property {string} [exitFullscreenLabel] and when it will leave.
 * @property {{ orientation?: 'landscape'|'portrait'|'any', keepAwake?: boolean, safeArea?: true }} [mobile]
 *   the phone half, wired onto the handle as `handle.mobile`. `orientation` puts the "Turn your
 *   phone" prompt in the frame and asks for the lock in full screen; `keepAwake` holds the screen
 *   on and re-asks after a hidden tab; `safeArea: true` asks for nothing on its own and is how a
 *   game says it wants the handle only to measure the notch. Any one of the three is enough, and
 *   a spec without this member gets no `handle.mobile` and no listeners at all.
 * @property {(game: any) => void} [onReady]
 */

/**
 * @typedef {object} GameHandle
 * @property {any} game                    the Phaser.Game
 * @property {HTMLElement} frame           the element wrapped around the canvas (class ak-phaser)
 * @property {PhaserTheme} theme           the look the game booted in
 * @property {() => Promise<boolean>} fullscreen
 * @property {() => void} exitFullscreen
 * @property {() => boolean} isFullscreen
 * @property {(w: number, h: number) => void} resize
 * @property {() => { width: number, height: number }} size
 * @property {() => void} sleep
 * @property {() => void} wake
 * @property {() => boolean} reducedMotion  does the viewer ask for less motion?
 * @property {any} [mobile]                 the phone half, present only when spec.mobile asked
 *   for it: orientation(want), safeArea(), keepAwake(on), install(), vibrate(ms), destroy().
 *   The game handle's own destroy() takes it down with everything else.
 * @property {() => void} destroy
 */

/**
 * Boot a game into an element.
 * @param {GameSpec} spec
 * @returns {Promise<GameHandle>}
 */
export function game(spec) {
  const s = spec || /** @type {GameSpec} */ ({});
  return ensurePhaser().then(function (Phaser) {
    const parent = resolveParent(s.parent);
    const width = s.width || 960;
    const height = s.height || 540;
    const mode = s.scale === 'resize' ? 'resize' : (s.scale === 'fixed' ? 'fixed' : 'fit');

    const frame = el('div', { class: 'ak-phaser ak-phaser--' + mode });
    // The one value that has to come from JS is the design ratio, and it goes in as a custom
    // property so the rule that uses it stays in the stylesheet.
    if (mode === 'fit') frame.style.setProperty('--ak-phaser-ratio', width + ' / ' + height);
    parent.appendChild(frame);

    const look = theme(frame);

    const scaleMode = mode === 'resize' ? Phaser.Scale.RESIZE
      : (mode === 'fixed' ? Phaser.Scale.NONE : Phaser.Scale.FIT);
    /** @type {any} */
    const config = {
      type: Phaser.AUTO,
      parent: frame,
      width: width,
      height: height,
      backgroundColor: groundColour(look, s.background),
      transparent: !!s.transparent,
      pixelArt: !!s.pixelArt,
      // The gamepad plugin is off in Phaser unless asked; controls() reads it, so it is on here.
      input: { gamepad: s.gamepad !== false },
      scale: {
        mode: scaleMode,
        autoCenter: mode === 'fit' ? Phaser.Scale.CENTER_BOTH : Phaser.Scale.NO_CENTER,
        width: width,
        height: height,
        // The FRAME goes full screen, not the canvas: a DOM overlay an app draws inside the frame
        // travels with it. Phaser only moves the canvas when it had to invent a target itself,
        // and the canvas is already in here, so nothing is reparented.
        fullscreenTarget: frame,
      },
      scene: s.scenes || [],
    };
    if (s.physics !== null) {
      const gravity = s.gravity || { y: 0 };
      config.physics = s.physics === 'matter'
        ? { default: 'matter', matter: { gravity: gravity } }
        : { default: 'arcade', arcade: { gravity: gravity } };
    }
    if (s.fps) config.fps = { target: s.fps };

    const g = new Phaser.Game(config);
    return whenReady(g).then(function () {
      const handle = wire(g, frame, parent, look, mode, s);
      if (s.onReady) s.onReady(g);
      return handle;
    });
  });
}

/**
 * Resolve once the game has booted. Phaser announces it; a game that has already started running
 * (it cannot have, here, but the check costs nothing) resolves straight away.
 * @param {any} g
 * @returns {Promise<any>}
 */
function whenReady(g) {
  if (g.isRunning) return Promise.resolve(g);
  return new Promise(function (ok) {
    g.events.once('ready', function () { ok(g); });
  });
}

/**
 * Everything that outlives the boot: the button, the observer, the visibility listener, and the
 * handle that can take them all down again.
 * @param {any} g
 * @param {HTMLElement} frame
 * @param {Element} parent
 * @param {PhaserTheme} look
 * @param {'fit'|'resize'|'fixed'} mode
 * @param {GameSpec} s
 * @returns {GameHandle}
 */
function wire(g, frame, parent, look, mode, s) {
  let destroyed = false;
  const enterLabel = s.fullscreenLabel || 'Full screen';
  const leaveLabel = s.exitFullscreenLabel || 'Leave full screen';

  /** @type {HTMLElement|null} */
  let button = null;
  const onFullscreenChange = function () {
    if (!button) return;
    const inside = !!g.scale.isFullscreen;
    const label = inside ? leaveLabel : enterLabel;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    clear(button);
    button.appendChild(icon(inside ? ICON_LEAVE : ICON_ENTER));
  };

  if (s.fullscreen === 'button') {
    button = el('button', {
      type: 'button',
      class: 'ak-phaser__full',
      'aria-label': enterLabel,
      title: enterLabel,
      on: {
        click: function () {
          if (g.scale.isFullscreen) g.scale.stopFullscreen();
          else g.scale.startFullscreen();
        },
      },
    }, icon(ICON_ENTER));
    frame.appendChild(button);
    g.scale.on('enterfullscreen', onFullscreenChange);
    g.scale.on('leavefullscreen', onFullscreenChange);
  }

  // 'resize' scaling follows the window on its own, which is not the same as following the BOX:
  // a sidebar folding away or a panel opening changes the frame without the window hearing a
  // thing. The observer is what makes the mode honest. Both the parent and the frame are watched,
  // because in full screen the frame changes while the parent does not.
  /** @type {any} */
  let observer = null;
  const onBox = function () {
    if (destroyed || mode !== 'resize') return;
    const box = frame.getBoundingClientRect();
    // A collapsed box is a hidden panel, not a resize; refreshing to zero would take the canvas
    // with it and it would not come back on its own.
    if (box.width < 1 || box.height < 1) return;
    // In RESIZE mode the game size IS the parent's box, and Phaser rebuilds it from the parent
    // bounds inside refresh(). scale.resize(w, h) is the fixed-size door: called here it is
    // measured, applied, and then overwritten by the parent bounds on the next refresh, which
    // looks exactly like the observer not firing. Verified in a browser on 4.2.1.
    g.scale.getParentBounds();
    g.scale.refresh();
  };
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(onBox);
    observer.observe(parent);
    observer.observe(frame);
  }

  const pauseOnHide = s.pauseOnHide !== false;
  const onVisibility = function () {
    if (destroyed) return;
    if (document.hidden) g.loop.sleep();
    else g.loop.wake();
  };
  if (pauseOnHide) document.addEventListener('visibilitychange', onVisibility);

  // The phone half, and only when the spec asked. Built here because the orientation prompt goes
  // INSIDE the frame, so it travels into full screen with the picture like everything else.
  /** @type {any} */
  let phone = null;
  if (s.mobile) {
    phone = mobile({ frame: frame, game: g }, {
      orientation: s.mobile.orientation,
      keepAwake: s.mobile.keepAwake,
    });
  }

  /** @type {any} */
  const handle = {
    game: g,
    frame: frame,
    theme: look,

    /**
     * Ask for full screen on the frame. Resolves when the browser grants it, rejects with words
     * when it refuses — which it does when the call did not come from a real gesture.
     * @returns {Promise<boolean>}
     */
    fullscreen() {
      if (g.scale.isFullscreen) return Promise.resolve(true);
      return new Promise(function (ok, fail) {
        const stop = function () {
          g.scale.off('enterfullscreen', granted);
          g.scale.off('fullscreenunsupported', refused);
          g.scale.off('fullscreenfailed', refused);
        };
        const granted = function () { stop(); ok(true); };
        const refused = function () {
          stop();
          fail(new Error('The browser refused full screen for the game frame. It grants it only '
            + 'from a click, a key or a tap the person made.'));
        };
        g.scale.once('enterfullscreen', granted);
        g.scale.once('fullscreenunsupported', refused);
        g.scale.once('fullscreenfailed', refused);
        g.scale.startFullscreen();
      });
    },

    exitFullscreen() {
      if (g.scale.isFullscreen) g.scale.stopFullscreen();
    },

    isFullscreen() {
      return !!(g.scale && g.scale.isFullscreen);
    },

    /**
     * Change the design size. In 'resize' mode the box decides and this is ignored; in 'fit' mode
     * the frame's aspect ratio follows the new size.
     * @param {number} w
     * @param {number} h
     */
    resize(w, h) {
      if (destroyed || mode === 'resize' || !w || !h) return;
      g.scale.resize(w, h);
      if (mode === 'fit') frame.style.setProperty('--ak-phaser-ratio', w + ' / ' + h);
    },

    size() {
      const box = g.scale.gameSize;
      return { width: box.width, height: box.height };
    },

    sleep() { g.loop.sleep(); },

    wake() { g.loop.wake(); },

    reducedMotion: reducedMotion,

    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (observer) observer.disconnect();
      if (pauseOnHide) document.removeEventListener('visibilitychange', onVisibility);
      if (button) {
        g.scale.off('enterfullscreen', onFullscreenChange);
        g.scale.off('leavefullscreen', onFullscreenChange);
      }
      if (phone) {
        phone.destroy();
        phone = null;
      }
      g.destroy(true);
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    },
  };

  // Present only when it was asked for, so `if (h.mobile)` is a real question a game can ask.
  if (phone) handle.mobile = phone;
  return handle;
}
