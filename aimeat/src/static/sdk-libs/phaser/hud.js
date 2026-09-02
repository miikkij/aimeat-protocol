/**
 * @file phaser/hud.js
 * @description The heads-up display and the passing message, both dressed in the same tokens as
 *   the rest of the page. `hud(scene)` puts the score in the top left, the lives under it as small
 *   hearts, the level and the clock in the top right; `toast(scene, text)` sends one line up the
 *   middle of the screen and takes it away again.
 *
 *   THE COLOURS AND THE FACES COME FROM THE PAGE. Every value is read once through `theme(el)`
 *   from boot.js, which resolves the Atelier --ak-* tokens on the element the game lives in. So a
 *   game inherits the app's palette and its display, mono and body faces without naming a colour,
 *   and a page that changes its look changes the HUD with it.
 *
 *   IT RIDES THE CAMERA, NOT THE WORLD. Everything is setScrollFactor(0) at a high depth, so the
 *   HUD stays put while the level scrolls under it, and stays above whatever the game draws.
 *
 *   MOTION ONLY ON A CHANGE. A number that moves gets one short scale pop and stops; the hearts
 *   pop when a life is lost or won. Nothing here animates while the game sits still, which is what
 *   keeps an idle scene at zero repaints.
 *
 *   THE HEART IS DRAWN, NOT LOADED. Two circles and a triangle go into a Graphics object once,
 *   become a texture through generateTexture, and every life after that is an image on that
 *   texture. No file, no atlas, no request.
 * @structure themeHost() · clock() · heartTexture() · hud(scene, opts) returning score/lives/level/
 *   time/message/set/destroy · toast(scene, text, opts). Colours come from boot.js: theme() reads
 *   the tokens, hex() turns one into the string a Phaser text style takes.
 * @usage
 *   const h = AIMEAT.phaser.hud(this, { lives: 3, level: 'Ridge 2-1' });
 *   h.score(1200); h.lives(2); h.time(74);
 *   AIMEAT.phaser.toast(this, 'Checkpoint reached');
 * @version-history
 *   v1.0.0 - 2026-09-02 - Initial: the four HUD figures on the theme's tokens, drawn hearts, the
 *     change pop and the rising toast.
 */
import { theme, hex } from './boot.js';

/** Above anything a game is likely to draw, and the toast sits just above the HUD. */
const HUD_DEPTH = 900;
const TOAST_DEPTH = 950;

/** The pop a changed figure makes: one beat out and back, and then nothing. */
const POP_SCALE = 1.16;
const POP_MS = 120;

/** How long a toast holds before it leaves, and how far it rises on the way out. */
const TOAST_MS = 1600;
const TOAST_RISE = 30;

/** The element whose computed tokens dress this game. */
function themeHost(scene, opts) {
  if (opts && opts.themeFrom) return opts.themeFrom;
  const canvas = scene && scene.game && scene.game.canvas;
  if (!canvas) return typeof document !== 'undefined' ? document.body : null;
  return canvas.parentElement || canvas;
}

/** mm:ss from a count of seconds. Anything past an hour keeps counting in minutes. */
function clock(seconds) {
  const total = Math.max(0, Math.floor(typeof seconds === 'number' && isFinite(seconds) ? seconds : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + (s < 10 ? '0' + s : String(s));
}

/**
 * The heart texture, drawn once per colour and then reused. Two circles for the lobes and a
 * triangle for the point, which is the whole shape at this size.
 * @param {any} scene
 * @param {number} colour
 * @returns {string} the texture key
 */
function heartTexture(scene, colour) {
  const key = 'ak-phaser-heart-' + ((colour >>> 0) & 0xffffff).toString(16);
  if (scene.textures && scene.textures.exists(key)) return key;
  const size = 18;
  const g = scene.add.graphics();
  g.fillStyle(colour, 1);
  const r = size * 0.26;
  g.fillCircle(size * 0.3, size * 0.32, r);
  g.fillCircle(size * 0.7, size * 0.32, r);
  g.fillTriangle(size * 0.04, size * 0.38, size * 0.96, size * 0.38, size * 0.5, size * 0.95);
  g.generateTexture(key, size, size);
  g.destroy();
  return key;
}

/**
 * The heads-up display for one scene.
 *
 * @param {any} scene
 * @param {{ depth?: number, pad?: number, score?: number, lives?: number, level?: string,
 *   time?: number, themeFrom?: Element }} [opts]
 * @returns {{
 *   score: (v: number) => void,
 *   lives: (n: number) => void,
 *   level: (text: string) => void,
 *   time: (seconds: number) => void,
 *   message: (text: string, ms?: number) => void,
 *   set: (values: { score?: number, lives?: number, level?: string }) => void,
 *   destroy: () => void,
 * }}
 */
export function hud(scene, opts) {
  const o = opts || {};
  const t = theme(themeHost(scene, o));
  const depth = typeof o.depth === 'number' ? o.depth : HUD_DEPTH;
  const pad = typeof o.pad === 'number' ? o.pad : 14;
  const inkCss = hex(t.ink);
  const dimCss = hex(t.inkDim);

  const width = function () { return scene.scale.width; };

  const scoreText = scene.add.text(pad, pad, '0', {
    fontFamily: t.fontDisplay, fontSize: '30px', color: inkCss,
  }).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);

  const levelText = scene.add.text(width() - pad, pad, '', {
    fontFamily: t.fontMono, fontSize: '15px', color: dimCss,
  }).setOrigin(1, 0).setScrollFactor(0).setDepth(depth);

  const timeText = scene.add.text(width() - pad, pad + 22, '', {
    fontFamily: t.fontMono, fontSize: '15px', color: inkCss,
  }).setOrigin(1, 0).setScrollFactor(0).setDepth(depth);

  const messageText = scene.add.text(width() / 2, pad + 54, '', {
    fontFamily: t.font, fontSize: '18px', color: inkCss, align: 'center',
  }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(depth);
  messageText.setVisible(false);

  const heartKey = heartTexture(scene, t.err);
  /** @type {any[]} */
  let hearts = [];
  let liveCount = 0;
  let scoreValue = 0;
  let timeValue = -1;
  /** @type {any} */
  let messageTimer = null;
  let dead = false;

  /** One short beat on a figure that just changed. Finite: out, back, done. */
  function pop(target) {
    if (!scene.tweens) return;
    scene.tweens.add({
      targets: target,
      scale: POP_SCALE,
      duration: POP_MS,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /** Put the right-hand column back on the right edge after a resize. */
  function layout() {
    if (dead) return;
    levelText.setX(width() - pad);
    timeText.setX(width() - pad);
    messageText.setX(width() / 2);
    placeHearts();
  }

  function placeHearts() {
    const top = pad + scoreText.height + 6;
    for (let i = 0; i < hearts.length; i++) {
      hearts[i].setPosition(pad + 9 + i * 22, top + 9);
    }
  }

  /**
   * Show this many lives. Hearts above the count are removed and hearts below it are added, so the
   * row is rebuilt only by the difference.
   * @param {number} n
   */
  function lives(n) {
    if (dead) return;
    const want = Math.max(0, Math.floor(typeof n === 'number' && isFinite(n) ? n : 0));
    while (hearts.length > want) {
      const gone = hearts.pop();
      if (gone) gone.destroy();
    }
    while (hearts.length < want) {
      const img = scene.add.image(0, 0, heartKey)
        .setScrollFactor(0).setDepth(depth);
      hearts.push(img);
    }
    placeHearts();
    if (want !== liveCount && hearts.length > 0) pop(hearts[hearts.length - 1]);
    liveCount = want;
  }

  /** @param {number} v */
  function score(v) {
    if (dead) return;
    const next = typeof v === 'number' && isFinite(v) ? Math.round(v) : 0;
    const changed = next !== scoreValue;
    scoreValue = next;
    scoreText.setText(String(next));
    if (changed) pop(scoreText);
  }

  /** @param {string} text */
  function level(text) {
    if (dead) return;
    levelText.setText(text == null ? '' : String(text));
  }

  /** @param {number} seconds */
  function time(seconds) {
    if (dead) return;
    const next = Math.max(0, Math.floor(typeof seconds === 'number' && isFinite(seconds) ? seconds : 0));
    const changed = next !== timeValue;
    timeValue = next;
    timeText.setText(clock(next));
    if (changed) pop(timeText);
  }

  /**
   * A line under the HUD for a moment: "Checkpoint", "Key found". It replaces whatever was there,
   * so a burst of them does not stack.
   * @param {string} text
   * @param {number} [ms]
   */
  function message(text, ms) {
    if (dead) return;
    if (messageTimer) {
      messageTimer.remove(false);
      messageTimer = null;
    }
    const str = text == null ? '' : String(text);
    messageText.setText(str);
    messageText.setVisible(!!str);
    messageText.setAlpha(1);
    if (!str) return;
    const hold = typeof ms === 'number' && isFinite(ms) ? Math.max(200, ms) : 1400;
    messageTimer = scene.time.delayedCall(hold, function () {
      messageTimer = null;
      if (dead) return;
      messageText.setVisible(false);
    });
  }

  /**
   * Set several figures at once. A field left out is left alone.
   * @param {{ score?: number, lives?: number, level?: string }} values
   */
  function set(values) {
    if (!values || typeof values !== 'object') return;
    if (typeof values.score === 'number') score(values.score);
    if (typeof values.lives === 'number') lives(values.lives);
    if (values.level !== undefined) level(values.level);
  }

  const onResize = function () { layout(); };
  if (scene.scale && typeof scene.scale.on === 'function') scene.scale.on('resize', onResize);

  /** Take the HUD down and stop everything it started. */
  function destroy() {
    if (dead) return;
    dead = true;
    if (scene.scale && typeof scene.scale.off === 'function') scene.scale.off('resize', onResize);
    if (messageTimer) {
      messageTimer.remove(false);
      messageTimer = null;
    }
    if (scene.tweens) {
      scene.tweens.killTweensOf(scoreText);
      scene.tweens.killTweensOf(timeText);
      for (const h of hearts) scene.tweens.killTweensOf(h);
    }
    for (const h of hearts) h.destroy();
    hearts = [];
    scoreText.destroy();
    levelText.destroy();
    timeText.destroy();
    messageText.destroy();
  }

  if (typeof o.score === 'number') score(o.score);
  if (typeof o.lives === 'number') lives(o.lives);
  if (o.level !== undefined) level(o.level);
  if (typeof o.time === 'number') time(o.time);

  return {
    score: score,
    lives: lives,
    level: level,
    time: time,
    message: message,
    set: set,
    destroy: destroy,
  };
}

/**
 * One line up the middle: it arrives, holds, rises and fades away. Finite by construction, and it
 * removes itself, so a scene never collects them.
 *
 * @param {any} scene
 * @param {string} text
 * @param {{ ms?: number, y?: number, depth?: number, rise?: number, tone?: 'ok'|'warn'|'err',
 *   themeFrom?: Element }} [opts]
 * @returns {any} the container, in case the caller wants it gone sooner
 */
export function toast(scene, text, opts) {
  const o = opts || {};
  const t = theme(themeHost(scene, o));
  const depth = typeof o.depth === 'number' ? o.depth : TOAST_DEPTH;
  const hold = typeof o.ms === 'number' && isFinite(o.ms) ? Math.max(300, o.ms) : TOAST_MS;
  const rise = typeof o.rise === 'number' ? o.rise : TOAST_RISE;
  const edge = o.tone === 'ok' ? t.ok : (o.tone === 'warn' ? t.warn : (o.tone === 'err' ? t.err : t.line));

  const label = scene.add.text(0, 0, text == null ? '' : String(text), {
    fontFamily: t.font, fontSize: '16px', color: hex(t.ink), align: 'center',
  }).setOrigin(0.5, 0.5);

  const w = Math.ceil(label.width) + 34;
  const h = Math.ceil(label.height) + 18;
  const r = h / 2;

  const pill = scene.add.graphics();
  pill.fillStyle(t.surface, 0.96);
  pill.fillRoundedRect(-w / 2, -h / 2, w, h, r);
  pill.lineStyle(1, edge, 1);
  pill.strokeRoundedRect(-w / 2, -h / 2, w, h, r);

  const x = scene.scale.width / 2;
  const y = typeof o.y === 'number' ? o.y : scene.scale.height * 0.72;
  const box = scene.add.container(x, y, [pill, label])
    .setScrollFactor(0).setDepth(depth).setAlpha(0);

  scene.tweens.add({
    targets: box,
    alpha: 1,
    y: y - 8,
    duration: 160,
    ease: 'Quad.easeOut',
  });

  scene.time.delayedCall(hold, function () {
    if (!box.scene) return;
    scene.tweens.add({
      targets: box,
      alpha: 0,
      y: y - rise,
      duration: 260,
      ease: 'Quad.easeIn',
      onComplete: function () { box.destroy(); },
    });
  });

  return box;
}
