/**
 * @file phaser/boss-bar.js
 * @description The wide bar a boss fight is read from: the boss's name, one bar across the top of
 *   the camera with a tick at every phase boundary, and two fills. The FRONT fill is the health
 *   and moves at once; the LAG fill behind it holds for a beat and then catches up, which is how
 *   a fighting game shows the size of a hit after the hit has landed. A phase change flashes the
 *   bar once. It is the bar half of boss.js, in its own file so both stay under the line limit.
 *
 *   IT SITS BETWEEN THE HUD'S CORNERS. hud.js keeps the score at the top left (a 30 px figure
 *   from y 14, the hearts under it) and the level and clock at the top right (two 15 px lines
 *   from y 14), and puts its passing message on the centre line from y 68. This bar takes the
 *   centre of the top edge above that message: the name on the 14 px line, the bar under it, and
 *   its width is 60 percent of the view but never closer than 140 px to either edge, so the
 *   corner figures keep their room on a phone as well as a desktop.
 *
 *   MOTION ONLY ON A CHANGE. A hit moves the front fill in one short tween and the lag fill after
 *   a hold; a heal moves the front fill up and the lag fill jumps to meet it, since a lag that
 *   trails a heal would read as damage. Under less motion every fill snaps and the phase flash is
 *   the one short tint status.js also keeps. Nothing here runs while the fight stands still.
 *
 *   NO COLOUR IS WRITTEN HERE. The fills, the ticks, the plate and the faces are theme tokens read
 *   once through tokens.js, so the bar re-tones with the page.
 * @structure toneColour() · motionPool() · bossBar(scene, opts) → show / hide / setName /
 *   setPhase / set / flash / state / layout / destroy
 * @usage
 *   const bar = bossBar(this, { name: 'The Warden', phases: [{ at: 1 }, { at: 0.5 }] });
 *   bar.set(0.62);        // the front fill moves now, the lag fill follows after a beat
 *   bar.flash();          // a phase changed
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the segmented top bar with the lag fill and the phase flash.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, cssColour, ms as toMs, curve } from './tokens.js';

/**
 * A tone word, or a colour number, as a theme colour. Any colour boot.js puts on the theme is a
 * word here (accent, ink, inkDim, ok, warn, err, ch1 to ch4), plus 'dim' for inkDim.
 * @param {any} th
 * @param {string|number|undefined} want
 * @param {number} fallback
 * @returns {number}
 */
export function toneColour(th, want, fallback) {
  if (typeof want === 'number' && isFinite(want)) return want;
  const key = want === 'dim' ? 'inkDim' : want;
  return typeof key === 'string' && typeof th[key] === 'number' ? th[key] : fallback;
}

/**
 * The tweens one handle owns: run() starts one and forgets it when it ends, stop() ends the ones
 * on a target, killAll() is what destroy() calls.
 * @param {any} scene
 * @returns {{ run: (config: any) => any, stop: (target: any) => void, killAll: () => void }}
 */
export function motionPool(scene) {
  const flying = new Set();
  return {
    run(config) {
      const after = config.onComplete;
      /** @type {any} */
      let t = null;
      config.onComplete = function () {
        if (t) flying.delete(t);
        if (typeof after === 'function') after();
      };
      t = scene.tweens.add(config);
      flying.add(t);
      return t;
    },
    stop(target) {
      scene.tweens.killTweensOf(target);
      for (const t of Array.from(flying)) {
        if (t && Array.isArray(t.targets) && t.targets.indexOf(target) >= 0) flying.delete(t);
      }
    },
    killAll() {
      for (const t of flying) {
        if (!t) continue;
        if (typeof t.remove === 'function') t.remove();
        else if (typeof t.stop === 'function') t.stop();
      }
      flying.clear();
    },
  };
}

/** Above hud()'s figures (900), under status bars (940) and the toast (950). */
const BAR_DEPTH = 920;

/** The name's line, matching hud()'s pad, and the bar under it. */
const TOP = 14;
const NAME_SIZE = 14;
const BAR_H = 12;
const BAR_DY = 20;

/** The share of the view the bar takes, the room each corner keeps, and the least a bar can be. */
const SHARE = 0.6;
const CLEAR = 140;
const MIN_W = 120;

/** How long the lag fill holds after a hit, as multiples of the look's pace. */
const LAG_HOLD = 2;
const LAG_MOVE = 2.5;

/**
 * @typedef {object} BossBarOptions
 * @property {string} [name]
 * @property {Array<{ at: number, name?: string }>} [phases]  a tick is drawn at every at under 1
 * @property {'ok'|'warn'|'err'|'accent'|'ink'|'dim'|'ch1'|'ch2'|'ch3'|'ch4'|number} [tone]  the
 *   front fill. Default 'err'.
 * @property {number} [y]        the name's line. Default 14, hud()'s own pad.
 * @property {number} [share]    the width as a share of the view. Default 0.6.
 * @property {number} [depth]    default 920
 * @property {any} [theme]       a theme handle; default read once off the game's frame
 */

/**
 * @typedef {object} BossBarHandle
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(name: string) => void} setName
 * @property {(name: string) => void} setPhase   the small label at the bar's right end
 * @property {(fraction: number, opts?: { instant?: boolean }) => void} set
 * @property {() => void} flash
 * @property {() => { fraction: number, shown: number, lag: number, visible: boolean }} state
 *   fraction is what was asked for, shown is where the front fill is drawn, lag the lag fill
 * @property {() => void} layout   put the bar back in the centre after a resize
 * @property {() => void} destroy
 */

/**
 * The boss bar for one scene.
 * @param {any} scene
 * @param {BossBarOptions} [opts]
 * @returns {BossBarHandle}
 */
export function bossBar(scene, opts) {
  const o = opts || /** @type {BossBarOptions} */ ({});
  const th = o.theme || look(scene);
  const pace = toMs(th.motion, 200);
  const ease = curve(th);
  const depth = typeof o.depth === 'number' ? o.depth : BAR_DEPTH;
  const top = typeof o.y === 'number' ? o.y : TOP;
  const share = typeof o.share === 'number' && o.share > 0 ? Math.min(1, o.share) : SHARE;
  const tone = toneColour(th, o.tone, th.err);
  const pool = motionPool(scene);
  const bounds = (o.phases || [])
    .map(function (p) { return p && typeof p.at === 'number' ? p.at : 1; })
    .filter(function (at) { return at > 0 && at < 1; });

  let fraction = 1;
  const shown = { fill: 1, lag: 1 };
  let width = MIN_W;
  let dead = false;
  let visible = true;
  /** @type {any} */
  let lagTimer = null;
  /** @type {any} */
  let lagTween = null;

  const box = scene.add.container(0, top).setScrollFactor(0).setDepth(depth);
  const nameText = scene.add.text(0, 0, o.name != null ? String(o.name) : '', {
    fontFamily: th.fontDisplay, fontSize: NAME_SIZE + 'px', color: cssColour(th.ink),
  }).setOrigin(0, 0);
  const phaseText = scene.add.text(0, 2, '', {
    fontFamily: th.fontMono, fontSize: '11px', color: cssColour(th.inkDim),
  }).setOrigin(1, 0);
  const back = scene.add.graphics().setPosition(0, BAR_DY);
  const lag = scene.add.graphics().setPosition(0, BAR_DY);
  const fill = scene.add.graphics().setPosition(0, BAR_DY);
  const ticks = scene.add.graphics().setPosition(0, BAR_DY);
  const flashG = scene.add.graphics().setPosition(0, BAR_DY).setAlpha(0);
  box.add([back, lag, fill, ticks, flashG, nameText, phaseText]);

  /** The view's width, whatever the game's scale mode. */
  function viewWidth() {
    const cam = scene.cameras && scene.cameras.main;
    return cam && typeof cam.width === 'number' ? cam.width : scene.scale.width;
  }

  function drawFills() {
    const r = BAR_H / 2;
    lag.clear();
    const lw = Math.round(width * Math.max(0, Math.min(1, shown.lag)));
    if (lw >= 1) {
      lag.fillStyle(th.warn, 0.85);
      lag.fillRoundedRect(0, 0, lw, BAR_H, Math.min(r, lw / 2));
    }
    fill.clear();
    const fw = Math.round(width * Math.max(0, Math.min(1, shown.fill)));
    if (fw >= 1) {
      fill.fillStyle(tone, 1);
      fill.fillRoundedRect(0, 0, fw, BAR_H, Math.min(r, fw / 2));
    }
  }

  /** The plate, the ticks and the flash plate, redrawn only when the width changes. */
  function drawFrame() {
    const r = BAR_H / 2;
    back.clear();
    back.fillStyle(th.surface, 0.9);
    back.fillRoundedRect(0, 0, width, BAR_H, r);
    back.lineStyle(1, th.line, 1);
    back.strokeRoundedRect(0, 0, width, BAR_H, r);
    ticks.clear();
    ticks.lineStyle(1, th.ink, 0.55);
    for (const at of bounds) {
      const x = Math.round(width * at) + 0.5;
      ticks.lineBetween(x, -2, x, BAR_H + 2);
    }
    flashG.clear();
    flashG.fillStyle(th.ink, 1);
    flashG.fillRoundedRect(0, 0, width, BAR_H, r);
  }

  function layout() {
    if (dead) return;
    const vw = viewWidth();
    width = Math.max(MIN_W, Math.min(Math.round(vw * share), vw - CLEAR * 2));
    box.setPosition(Math.round((vw - width) / 2), top);
    phaseText.setX(width);
    drawFrame();
    drawFills();
  }

  function dropLagTimer() {
    if (!lagTimer) return;
    lagTimer.remove(false);
    lagTimer = null;
  }

  function dropLagTween() {
    if (!lagTween) return;
    const t = lagTween;
    lagTween = null;
    if (typeof t.remove === 'function') t.remove();
    else if (typeof t.stop === 'function') t.stop();
  }

  /**
   * The lag fill catches up after its hold. Kept under less motion as a snap after the hold. The
   * front fill and the lag fill tween the same object, so only the lag's own tween is stopped
   * here: killTweensOf(shown) would take the front fill's tween down with it.
   */
  function chaseLag() {
    dropLagTimer();
    dropLagTween();
    lagTimer = scene.time.delayedCall(pace * LAG_HOLD, function () {
      lagTimer = null;
      if (dead) return;
      if (reducedMotion() || !scene.tweens) {
        shown.lag = fraction;
        drawFills();
        return;
      }
      lagTween = pool.run({
        targets: shown, lag: fraction, duration: pace * LAG_MOVE, ease: ease,
        onUpdate: drawFills,
        onComplete: function () {
          lagTween = null;
          drawFills();
        },
      });
    });
  }

  /**
   * Put the bar at a fraction of full. A drop moves the front fill now and the lag fill after a
   * hold; a rise moves the front fill and the lag fill jumps to meet it.
   * @param {number} want
   * @param {{ instant?: boolean }} [setOpts]
   * @returns {void}
   */
  function set(want, setOpts) {
    if (dead) return;
    const next = Math.max(0, Math.min(1, typeof want === 'number' && isFinite(want) ? want : 0));
    const prev = fraction;
    fraction = next;
    const snap = (setOpts && setOpts.instant) || reducedMotion() || !scene.tweens;
    dropLagTimer();
    dropLagTween();
    pool.stop(shown);
    if (next >= prev) {
      shown.lag = Math.max(shown.lag, next);
      if (snap) {
        shown.fill = next;
        shown.lag = next;
        drawFills();
        return;
      }
      shown.lag = next;
      pool.run({ targets: shown, fill: next, duration: pace * 1.5, ease: ease, onUpdate: drawFills, onComplete: drawFills });
      return;
    }
    if (snap) {
      shown.fill = next;
      if (setOpts && setOpts.instant) shown.lag = next;
      drawFills();
      if (!(setOpts && setOpts.instant)) chaseLag();
      return;
    }
    pool.run({ targets: shown, fill: next, duration: Math.max(60, pace * 0.6), ease: ease, onUpdate: drawFills, onComplete: drawFills });
    chaseLag();
  }

  /** One short tint over the bar: a phase changed. One tint under less motion as well. */
  function flash() {
    if (dead) return;
    pool.stop(flashG);
    flashG.setAlpha(0.6);
    pool.run({ targets: flashG, alpha: 0, duration: Math.max(80, pace * 1.2), ease: 'Quad.easeOut' });
  }

  const onResize = function () { layout(); };
  if (scene.scale && typeof scene.scale.on === 'function') scene.scale.on('resize', onResize);

  function destroy() {
    if (dead) return;
    dead = true;
    if (scene.scale && typeof scene.scale.off === 'function') scene.scale.off('resize', onResize);
    dropLagTimer();
    pool.killAll();
    box.destroy();
  }

  layout();
  drawFills();

  return {
    show: function () { if (!dead) { visible = true; box.setVisible(true); } },
    hide: function () { if (!dead) { visible = false; box.setVisible(false); } },
    setName: function (name) { if (!dead) nameText.setText(name == null ? '' : String(name)); },
    setPhase: function (name) { if (!dead) phaseText.setText(name == null ? '' : String(name)); },
    set: set,
    flash: flash,
    state: function () { return { fraction: fraction, shown: shown.fill, lag: shown.lag, visible: visible }; },
    layout: layout,
    destroy: destroy,
  };
}
