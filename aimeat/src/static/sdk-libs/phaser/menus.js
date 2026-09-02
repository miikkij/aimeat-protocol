/**
 * @file phaser/menus.js
 * @description The in-canvas menu department: the vertical list a player moves through, the
 *   title screen an app drops into its scenes array, the pause menu that opens over a running
 *   scene, and the four ways one scene hands over to the next.
 *
 *   THE MENU IS THE GAME'S FIRST SCREEN, so it reads like the app around it: every colour, face
 *   and pace comes from the Atelier tokens through theme(), never from a literal in here. A game
 *   that changes its palette changes its menus with it, and nobody edits a number.
 *
 *   A LOCKED ITEM IS NOT A DEAD BUTTON. It stays readable, keeps its hint, and answers a pick
 *   with a shake so the player learns the control works and the door does not. The same rule the
 *   DOM menu (game/menu.js) has carried since it was written.
 *
 *   EVERY MOTION IS FINITE. Arrivals are one tween or one counted timer per item, the title's
 *   entrance is one pass, stars twinkle once and then hold. An idle menu animates nothing, which
 *   is what lets a finished screen be measured for repaints instead of argued about.
 *
 *   KEYBOARD FIRST, POINTER TOO: up/down move, Enter/Space pick, Escape closes a pause menu, and
 *   a controls state (from controls(scene)) drives the same list on a pad or a touch overlay.
 *   Hover selects and a click picks, so neither input is the second-class one.
 * @structure menuItems(scene, spec) → handle · titleScene(spec) → Phaser scene config ·
 *   pauseMenu(scene, spec) → handle · transition (re-exported from ./transitions.js)
 * @usage  const m = AIMEAT.phaser.menuItems(this, { x: 80, y: 200, motion: 'stagger',
 *           items: [{ label: 'Play', onPick: () => this.scene.start('play') }] });
 *         await AIMEAT.phaser.transition(this, 'play', { kind: 'iris', colour: 'accent' });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (wish-phaser4-design-book-page). The four scene moves live in
 *     ./transitions.js and the token bridge in ./tokens.js: this file was 857 lines with them in
 *     it, which the 800-line rule refuses, so both came out as pure extractions and transition()
 *     is re-exported here. A caller's import is unchanged.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, cssColour, ms, curve, OVERLAY_DEPTH } from './tokens.js';

export { transition } from './transitions.js';

/** The parallel scene the pause menu lives in. Registered once per game, on first use. */
const PAUSE_KEY = 'ak-pause';

/** How far a locked item travels when it refuses a pick, in pixels. */
const SHAKE_PX = 9;

/**
 * A vertical menu drawn inside the canvas.
 *
 * @param {any} scene  the Phaser scene it is drawn in
 * @param {{
 *   x?: number, y?: number,
 *   items: Array<{ label: string, onPick?: () => void, locked?: boolean, hint?: string }>,
 *   motion?: 'stagger'|'slide'|'zoom'|'typewriter',
 *   cursor?: 'bar'|'arrow'|'glow',
 *   align?: 'left'|'center',
 *   font?: string, size?: number, gap?: number,
 *   controls?: any, index?: number,
 * }} spec
 * @returns {{ el: any, select: (i: number) => void, current: () => number,
 *   enable: (on: boolean) => void, destroy: () => void }}
 */
export function menuItems(scene, spec) {
  const s = spec || /** @type {any} */ ({});
  const th = look(scene);
  const still = reducedMotion();
  const items = (s.items || []).slice();
  const gap = s.gap != null ? s.gap : 46;
  const size = s.size != null ? s.size : 26;
  const family = s.font || th.font;
  const centred = s.align === 'center';
  const cursorKind = s.cursor || 'bar';
  const arrival = s.motion || 'stagger';
  const pace = ms(th.motion, 200);
  const ease = curve(th);

  const labelStyle = { fontFamily: family, fontSize: size + 'px', color: cssColour(th.ink) };
  const hintStyle = { fontFamily: family, fontSize: Math.round(size * 0.56) + 'px', color: cssColour(th.inkDim) };

  const root = scene.add.container(s.x || 0, s.y || 0);
  root.setDepth(OVERLAY_DEPTH - 10);

  /** @type {Array<{ item: any, box: any, label: any, hint: any, text: string, homeX: number }>} */
  const rows = [];
  /** @type {any[]} the counted timers a typewriter arrival owns, cleared on destroy */
  const timers = [];
  let index = 0;
  let live = true;
  let gone = false;

  const cursor = buildCursor();
  if (cursor) root.add(cursor);
  items.forEach(buildRow);

  /** @returns {any|null} the mark that follows the selection, or null for the 'glow' cursor */
  function buildCursor() {
    if (cursorKind === 'glow') return null;
    if (cursorKind === 'arrow') {
      const mark = scene.add.text(0, 0, '→', { fontFamily: family, fontSize: size + 'px', color: cssColour(th.accent) });
      return mark.setOrigin(1, 0.5);
    }
    const bar = scene.add.rectangle(0, 0, Math.max(3, Math.round(size / 7)), size, th.accent);
    return bar.setOrigin(1, 0.5);
  }

  /**
   * @param {{ label: string, onPick?: () => void, locked?: boolean, hint?: string }} item
   * @param {number} i
   */
  function buildRow(item, i) {
    const box = scene.add.container(0, i * gap);
    const label = scene.add.text(0, 0, item.label, labelStyle);
    label.setOrigin(centred ? 0.5 : 0, 0.5);
    if (item.locked) label.setAlpha(0.55);
    box.add(label);
    let hint = null;
    if (item.hint) {
      hint = scene.add.text(0, Math.round(size * 0.78), item.hint, hintStyle);
      hint.setOrigin(centred ? 0.5 : 0, 0.5);
      box.add(hint);
    }
    root.add(box);
    label.setInteractive({ useHandCursor: true });
    label.on('pointerover', function () { if (live) api.select(i); });
    label.on('pointerdown', function () { if (live) pick(i); });
    rows.push({ item: item, box: box, label: label, hint: hint, text: item.label, homeX: 0 });
  }

  /** Put the cursor and the ink where the current selection is. */
  function mark() {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const on = i === index;
      const locked = !!r.item.locked;
      r.label.setColor(cssColour(on ? th.accent : th.ink));
      r.label.setAlpha(locked ? 0.55 : 1);
      if (cursorKind === 'glow') r.label.setScale(on ? 1.08 : 1);
    }
    if (!cursor || !rows.length) return;
    const row = rows[index];
    const left = centred ? row.label.x - row.label.width / 2 : row.label.x;
    const toX = left - Math.round(size * 0.55);
    const toY = row.box.y;
    if (still) { cursor.setPosition(toX, toY); return; }
    scene.tweens.add({ targets: cursor, x: toX, y: toY, duration: Math.round(pace * 0.9), ease: ease });
  }

  /** @param {number} i */
  function pick(i) {
    if (!live || !rows[i]) return;
    api.select(i);
    const row = rows[i];
    if (row.item.locked) { refuse(row); return; }
    if (typeof row.item.onPick === 'function') row.item.onPick();
  }

  /**
   * The refusal a locked item answers with: one counted shake, back where it started.
   * @param {{ box: any, homeX: number }} row
   */
  function refuse(row) {
    if (still) return;
    scene.tweens.killTweensOf(row.box);
    row.box.x = row.homeX;
    scene.tweens.add({
      targets: row.box, x: row.homeX + SHAKE_PX, duration: Math.round(pace * 0.28),
      ease: 'Sine.easeInOut', yoyo: true, repeat: 2,
      onComplete: function () { row.box.x = row.homeX; },
    });
  }

  /** The arrival: one finite pass over the rows, or nothing at all under less motion. */
  function arrive() {
    if (still) { if (arrival === 'typewriter') for (const r of rows) r.label.setText(r.text); mark(); return; }
    const step = Math.round(pace * 0.35);
    const span = Math.round(pace * 1.6);
    if (arrival === 'typewriter') {
      for (const r of rows) r.label.setText('');
      rows.forEach(function (r, i) { type(r, i * (step + r.text.length * 8)); });
      mark();
      return;
    }
    rows.forEach(function (r, i) {
      const from = {};
      if (arrival === 'slide') { r.box.x = r.homeX - 48; from.x = r.homeX; }
      else if (arrival === 'zoom') { r.box.setScale(0.86); from.scaleX = 1; from.scaleY = 1; }
      else { r.box.y = i * gap + 14; from.y = i * gap; }
      r.box.setAlpha(0);
      scene.tweens.add(Object.assign({
        targets: r.box, alpha: 1, delay: i * step, duration: span, ease: ease,
      }, from));
    });
    mark();
  }

  /**
   * One label typed out, one counted timer, no loop.
   * @param {{ label: any, text: string }} row
   * @param {number} delay
   */
  function type(row, delay) {
    const chars = row.text.length;
    if (!chars) return;
    const ev = scene.time.addEvent({
      delay: Math.max(16, Math.round(pace / 8)),
      repeat: chars - 1,
      startAt: 0,
      paused: false,
      callback: function () { row.label.setText(row.text.slice(0, chars - ev.repeatCount)); },
    });
    timers.push(ev);
    if (delay > 0) { ev.paused = true; timers.push(scene.time.delayedCall(delay, function () { ev.paused = false; })); }
  }

  // ── Input ────────────────────────────────────────────────────────────────────────────────────
  const keyboard = scene.input && scene.input.keyboard ? scene.input.keyboard : null;
  const onPrev = function () { if (live) api.select(index - 1); };
  const onNext = function () { if (live) api.select(index + 1); };
  const onEnter = function () { if (live) pick(index); };
  if (keyboard) {
    keyboard.on('keydown-UP', onPrev);
    keyboard.on('keydown-W', onPrev);
    keyboard.on('keydown-DOWN', onNext);
    keyboard.on('keydown-S', onNext);
    keyboard.on('keydown-ENTER', onEnter);
    keyboard.on('keydown-SPACE', onEnter);
  }

  // A controls state moves the same list. It is read on the edge, so holding a direction moves
  // one item rather than sliding through the whole menu in three frames. `up`/`down` are used
  // when the state carries them; otherwise left/right do the moving, which is what a pad's stick
  // reports on a menu that has no other use for the axis.
  const held = { prev: false, next: false, act: false };
  const tick = function () {
    const c = s.controls;
    if (!live || !c) return;
    const prev = c.up != null ? !!c.up : !!c.left;
    const next = c.down != null ? !!c.down : !!c.right;
    const act = !!(c.action || c.jump);
    if (prev && !held.prev) api.select(index - 1);
    if (next && !held.next) api.select(index + 1);
    if (act && !held.act) pick(index);
    held.prev = prev; held.next = next; held.act = act;
  };
  if (s.controls) scene.events.on('update', tick);

  const api = {
    el: root,

    /**
     * Move the selection. Out-of-range wraps, so a pad never dead-ends at the last item.
     * @param {number} i
     */
    select(i) {
      if (!rows.length) return;
      const n = rows.length;
      index = ((i % n) + n) % n;
      mark();
    },

    /** @returns {number} the selected item's position */
    current() { return index; },

    /** @param {boolean} on  whether picks and moves are answered at all */
    enable(on) {
      live = !!on;
      root.setAlpha(live ? 1 : 0.5);
      for (const r of rows) {
        if (live) r.label.setInteractive({ useHandCursor: true });
        else r.label.disableInteractive();
      }
    },

    destroy() {
      if (gone) return;
      gone = true;
      if (keyboard) {
        keyboard.off('keydown-UP', onPrev);
        keyboard.off('keydown-W', onPrev);
        keyboard.off('keydown-DOWN', onNext);
        keyboard.off('keydown-S', onNext);
        keyboard.off('keydown-ENTER', onEnter);
        keyboard.off('keydown-SPACE', onEnter);
      }
      scene.events.off('update', tick);
      scene.events.off('shutdown', api.destroy);
      for (const ev of timers) if (ev && typeof ev.remove === 'function') ev.remove(false);
      timers.length = 0;
      for (const r of rows) scene.tweens.killTweensOf(r.box);
      if (cursor) scene.tweens.killTweensOf(cursor);
      root.destroy(true);
    },
  };

  scene.events.once('shutdown', api.destroy);
  api.select(s.index || 0);
  arrive();
  return api;
}

/**
 * A title screen as a scene CONFIG, which is what an app's `scenes: []` array wants. Nothing is
 * created until Phaser starts the scene, so this may be built at module scope.
 *
 * @param {{
 *   key?: string, title: string, sub?: string,
 *   items: Array<{ label: string, scene?: string, onPick?: () => void, locked?: boolean, hint?: string }>,
 *   motion?: 'stagger'|'slide'|'zoom'|'typewriter',
 *   titleMotion?: 'drop'|'kinetic'|'typewriter',
 *   backdrop?: 'grid'|'stars'|'none',
 *   version?: string, controls?: any,
 * }} spec
 * @returns {{ key: string, create: () => void }}
 */
export function titleScene(spec) {
  const s = spec || /** @type {any} */ ({});
  return {
    key: s.key || 'title',
    create: function () { buildTitle(/** @type {any} */ (this), s); },
  };
}

/**
 * The title screen's contents, drawn into the scene Phaser just started.
 * @param {any} scene
 * @param {any} s  the titleScene spec
 * @returns {void}
 */
function buildTitle(scene, s) {
  const th = look(scene);
  const still = reducedMotion();
  const width = scene.scale.width;
  const height = scene.scale.height;
  const pace = ms(th.motion, 200);

  scene.cameras.main.setBackgroundColor(th.bg);
  drawBackdrop(scene, s.backdrop || 'grid', th, still);

  const titleSize = Math.max(30, Math.round(Math.min(width, height) * 0.11));
  const style = {
    fontFamily: th.fontDisplay || th.font,
    fontSize: titleSize + 'px',
    color: cssColour(th.ink),
  };
  const titleY = Math.round(height * 0.24);
  const kinetic = (s.titleMotion || 'drop') === 'kinetic';
  const heading = kinetic ? null : scene.add.text(width / 2, titleY, s.title || '', style).setOrigin(0.5, 0.5);
  if (heading) enterTitle(scene, heading, s.titleMotion || 'drop', pace, still, th);
  else throwLetters(scene, s.title || '', width / 2, titleY, style, pace, still, th);

  if (s.sub) {
    const sub = scene.add.text(width / 2, titleY + Math.round(titleSize * 0.86), s.sub, {
      fontFamily: th.font, fontSize: Math.round(titleSize * 0.3) + 'px', color: cssColour(th.inkDim),
    }).setOrigin(0.5, 0.5);
    if (!still) {
      sub.setAlpha(0);
      scene.tweens.add({ targets: sub, alpha: 1, delay: pace * 2, duration: pace * 2, ease: curve(th) });
    }
  }

  menuItems(scene, {
    x: width / 2,
    y: Math.round(height * 0.55),
    align: 'center',
    motion: s.motion || 'stagger',
    cursor: 'bar',
    controls: s.controls,
    items: (s.items || []).map(function (item) {
      return {
        label: item.label,
        locked: item.locked,
        hint: item.hint,
        onPick: function () {
          if (typeof item.onPick === 'function') item.onPick();
          if (item.scene) scene.scene.start(item.scene);
        },
      };
    }),
  });

  if (s.version) {
    scene.add.text(width - 12, height - 10, s.version, {
      fontFamily: th.fontMono || th.font, fontSize: '12px', color: cssColour(th.inkDim),
    }).setOrigin(1, 1).setAlpha(0.8);
  }
}

/**
 * The drawn backdrop. A grid is one static Graphics; stars twinkle exactly once on arrival and
 * then hold, so the screen stops moving and stays stopped.
 * @param {any} scene
 * @param {'grid'|'stars'|'none'} kind
 * @param {any} th
 * @param {boolean} still
 * @returns {void}
 */
function drawBackdrop(scene, kind, th, still) {
  if (kind === 'none') return;
  const width = scene.scale.width;
  const height = scene.scale.height;
  if (kind === 'stars') {
    const count = Math.min(90, Math.round((width * height) / 9000));
    for (let i = 0; i < count; i += 1) {
      const size = 1 + Math.round(Math.random() * 2);
      const star = scene.add.rectangle(Math.random() * width, Math.random() * height, size, size, th.ink);
      star.setAlpha(still ? 0.35 : 0);
      if (still) continue;
      scene.tweens.add({
        targets: star, alpha: 0.35, duration: 260 + Math.random() * 420,
        delay: Math.random() * 700, yoyo: true, hold: 120, repeat: 0,
        onComplete: function () { star.setAlpha(0.35); },
      });
    }
    return;
  }
  const g = scene.add.graphics();
  g.lineStyle(1, th.line, 0.5);
  const step = 48;
  for (let x = 0; x <= width; x += step) g.lineBetween(x, 0, x, height);
  for (let y = 0; y <= height; y += step) g.lineBetween(0, y, width, y);
  g.setDepth(-10);
}

/**
 * The title's own entrance: a drop, or a typed reveal. One pass, then it holds.
 * @param {any} scene
 * @param {any} heading
 * @param {'drop'|'kinetic'|'typewriter'} kind
 * @param {number} pace
 * @param {boolean} still
 * @param {any} th
 * @returns {void}
 */
function enterTitle(scene, heading, kind, pace, still, th) {
  if (still) return;
  if (kind === 'typewriter') {
    const full = heading.text;
    heading.setText('');
    const ev = scene.time.addEvent({
      delay: Math.max(28, Math.round(pace / 5)),
      repeat: Math.max(0, full.length - 1),
      callback: function () { heading.setText(full.slice(0, full.length - ev.repeatCount)); },
    });
    return;
  }
  const home = heading.y;
  heading.y = home - Math.max(60, pace);
  heading.setAlpha(0);
  scene.tweens.add({ targets: heading, y: home, alpha: 1, duration: pace * 3, ease: 'Back.easeOut' });
  void th;
}

/**
 * The kinetic title: one Text per letter, each landing a beat after the one before it. Laid out
 * by measuring each glyph, so it stays centred in any face the look picks.
 * @param {any} scene
 * @param {string} text
 * @param {number} cx
 * @param {number} cy
 * @param {any} style
 * @param {number} pace
 * @param {boolean} still
 * @param {any} th
 * @returns {void}
 */
function throwLetters(scene, text, cx, cy, style, pace, still, th) {
  const chars = Array.from(text);
  /** @type {any[]} */
  const made = [];
  let total = 0;
  for (const ch of chars) {
    const letter = scene.add.text(0, cy, ch, style).setOrigin(0, 0.5);
    made.push(letter);
    total += letter.width;
  }
  let x = cx - total / 2;
  made.forEach(function (letter, i) {
    letter.x = x;
    x += letter.width;
    if (still) return;
    const home = cy;
    letter.y = home - 40;
    letter.setAlpha(0);
    scene.tweens.add({
      targets: letter, y: home, alpha: 1, delay: i * Math.round(pace * 0.22),
      duration: pace * 2, ease: 'Back.easeOut',
    });
  });
  void th;
}

/**
 * The pause menu: a scrim and four choices over whatever was running. The parallel scene is
 * registered on this game the first time it is asked for, so an app never declares it.
 *
 * @param {any} scene  the scene being paused
 * @param {{
 *   title?: string, labels?: { resume?: string, restart?: string, settings?: string, quit?: string },
 *   onSettings?: () => void, onQuit?: () => void, onResume?: () => void,
 *   pauseScene?: boolean, controls?: any,
 * }} spec
 * @returns {{ close: () => void, destroy: () => void }}
 */
export function pauseMenu(scene, spec) {
  const s = spec || /** @type {any} */ ({});
  const mgr = scene.scene;
  if (!mgr.get(PAUSE_KEY)) mgr.add(PAUSE_KEY, pauseSceneConfig(), false);

  const session = {
    parentKey: mgr.key,
    spec: s,
    closed: false,
    /** Filled in by the pause scene once it has drawn itself. @type {(() => void)|null} */
    shut: null,
  };

  const shouldPause = s.pauseScene !== false;
  if (shouldPause) mgr.pause(mgr.key);
  mgr.launch(PAUSE_KEY, session);
  mgr.bringToTop(PAUSE_KEY);

  const api = {
    close() {
      if (session.closed) return;
      session.closed = true;
      if (session.shut) session.shut();
      else mgr.stop(PAUSE_KEY);
      if (shouldPause) mgr.resume(session.parentKey);
      if (typeof s.onResume === 'function') s.onResume();
    },
    destroy() { api.close(); },
  };
  session.shut = null;
  /** @type {any} */ (session).close = api.close;
  return api;
}

/**
 * The pause scene's config, registered once per game. It reads its callbacks out of the launch
 * data, so one registered scene serves every pause menu the game ever opens.
 * @returns {{ key: string, create: (data: any) => void }}
 */
function pauseSceneConfig() {
  return {
    key: PAUSE_KEY,
    create: function (data) {
      const scene = /** @type {any} */ (this);
      const session = data || {};
      const s = session.spec || {};
      const th = look(scene);
      const width = scene.scale.width;
      const height = scene.scale.height;
      const labels = s.labels || {};

      const scrim = scene.add.rectangle(0, 0, width, height, th.bg, 0.78).setOrigin(0, 0);
      scrim.setDepth(OVERLAY_DEPTH - 20);
      scrim.setInteractive();

      scene.add.text(width / 2, Math.round(height * 0.26), s.title || 'Paused', {
        fontFamily: th.fontDisplay || th.font,
        fontSize: Math.max(26, Math.round(Math.min(width, height) * 0.08)) + 'px',
        color: cssColour(th.ink),
      }).setOrigin(0.5, 0.5).setDepth(OVERLAY_DEPTH - 5);

      const close = function () {
        if (typeof session.close === 'function') session.close();
        else scene.scene.stop(PAUSE_KEY);
      };

      const menu = menuItems(scene, {
        x: width / 2,
        y: Math.round(height * 0.44),
        align: 'center',
        gap: 44,
        motion: 'stagger',
        cursor: 'bar',
        controls: s.controls,
        items: [
          { label: labels.resume || 'Resume', onPick: close },
          {
            label: labels.restart || 'Restart',
            onPick: function () {
              close();
              const parent = scene.scene.get(session.parentKey);
              if (parent) parent.scene.restart();
            },
          },
          { label: labels.settings || 'Settings', onPick: function () { if (typeof s.onSettings === 'function') s.onSettings(); } },
          { label: labels.quit || 'Quit', onPick: function () { close(); if (typeof s.onQuit === 'function') s.onQuit(); } },
        ],
      });

      // The way out is the same key that got here: Escape, and the controls state's own pause.
      const keyboard = scene.input && scene.input.keyboard ? scene.input.keyboard : null;
      const onEscape = function () { close(); };
      if (keyboard) keyboard.on('keydown-ESC', onEscape);
      let heldPause = true;
      const watchPause = function () {
        const c = s.controls;
        if (!c) return;
        if (c.pause && !heldPause) { close(); return; }
        heldPause = !!c.pause;
      };
      if (s.controls) scene.events.on('update', watchPause);

      // Whoever stops this scene, the listeners go with it: the handle's close(), the Escape key
      // and the parent scene ending underneath it all arrive here.
      scene.events.once('shutdown', function () {
        if (keyboard) keyboard.off('keydown-ESC', onEscape);
        scene.events.off('update', watchPause);
        menu.destroy();
      });

      session.shut = function () { scene.scene.stop(PAUSE_KEY); };
    },
  };
}

