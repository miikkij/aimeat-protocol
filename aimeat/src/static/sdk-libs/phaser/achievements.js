/**
 * @file phaser/achievements.js
 * @description Trophies from conditions. A game declares what counts (ten coins, a run under a
 *   minute, a level without damage) and feeds the numbers as they happen; the first time a
 *   condition is met the trophy unlocks, once, and a ribbon with a medal slides in along the top
 *   edge between hud()'s two corners and leaves again.
 *
 *   FOUR KINDS OF CONDITION AND NOTHING CLEVERER. 'count' and 'max' unlock when a stat reaches
 *   the target (count is fed by increments, max by the value itself, and the test is the same);
 *   'min' unlocks when a stat comes in at or under the target, and only once the stat has been
 *   set at all, so a fresh save does not hand out "under a minute" for free; 'flag' unlocks when
 *   the named flag is raised. A condition is read every time its stat moves and never on a clock.
 *
 *   THE RECORD IS ONE SECTION OF THE ONE SAVE KEY. Unlocks, the stats behind them and the flags
 *   live in store.get().achievements of a saves() store, written through set() and save(), so a
 *   guest keeps them in the browser and a signed-in player on the node, exactly as the rest of
 *   the save file does. The section is applied at construction when the store already holds one
 *   and again when the store reports a change this handle did not write. Without a store the
 *   record lives for the session only.
 *
 *     achievements: {
 *       unlocked: { [id]: isoTime },
 *       stats: { [name]: number },
 *       flags: { [name]: true },
 *     }
 *
 *   A TROPHY MAY ALSO BE A SCORE. With board: true, a count or max trophy's stat is offered to the
 *   store as the player's best whenever it rises, which is the figure the store's public
 *   leaderboard row carries. It asks the store for a leaderboard first and does nothing where
 *   there is none; a min trophy's lower-is-better figure has no place on that board and is left
 *   out.
 *
 *   SECRETS STAY SECRET. A trophy marked secret is listed as '???' with no hint until it is
 *   unlocked, in list() and in the trophy room alike.
 *
 *   EVERY MOTION IS FINITE. The banner slides in, holds and slides out; queued banners follow one
 *   another; the trophy room's rows arrive once. Under less motion the banner appears in place
 *   and fades, and the room's rows are simply there. No colour is written here: the medal, the
 *   ribbon and the room take their tones from the theme through the tone table in
 *   status-parts.js, which also lends the tween pool every motion here is kept in.
 * @structure num() · medalTexture() · achievements(scene, spec) → stat / set / flag / unlock /
 *   unlocked / progress / list / reset / on / load / persist / destroy ·
 *   trophyRoom(scene, ach, opts) → close / destroy / scroll
 * @usage
 *   const ach = AIMEAT.phaser.achievements(this, { store: store, list: [
 *     { id: 'ten', title: 'Ten coins', hint: 'Collect ten coins', kind: 'count', stat: 'coins', target: 10 },
 *     { id: 'fast', title: 'Quick', hint: 'Finish under 60 s', kind: 'min', stat: 'time', target: 60 },
 *   ] });
 *   ach.stat('coins', 1); ach.set('time', 48); ach.on('unlock', (t) => console.log(t.title));
 *   AIMEAT.phaser.trophyRoom(this, ach);
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the four condition kinds, the once-only unlock, the banner
 *     queue, the store section, the board post and the trophy room.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, cssColour, ms, curve, OVERLAY_DEPTH } from './tokens.js';
import { toneColour, motionPool } from './status-parts.js';

/** The banner: above hud()'s figures (900) and under its toast (950). */
const BANNER_DEPTH = 945;
/** How long a banner holds before it leaves. */
const BANNER_MS = 2400;
/** The banner's height. */
const BANNER_H = 52;
/** The medal mark's drawn size. */
const MEDAL = 28;
/** The trophy room sits over everything, the pause menu included. */
const ROOM_DEPTH = OVERLAY_DEPTH - 1;
const ROW_H = 46;
const ROOM_PAD = 18;

/** The condition kinds this module reads. */
const KINDS = { count: true, flag: true, max: true, min: true };

/** A finite number, or the fallback. */
function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/**
 * @typedef {object} Trophy
 * @property {string} id
 * @property {string} title
 * @property {string} [hint]     what to do, shown while it is locked
 * @property {'count'|'flag'|'max'|'min'} kind
 * @property {string} stat       the stat (or, for a flag, the flag) the condition reads
 * @property {number} [target]   the number to reach (count, max) or to come in under (min)
 * @property {string|number} [tone]  the medal's colour, a tone word or a number; default 'accent'
 * @property {boolean} [secret]  listed as '???' until unlocked
 * @property {boolean} [board]   also post the stat as the player's best on the store's board
 */

/**
 * One trophy as list() and the 'unlock' event report it.
 * @typedef {{ id: string, title: string, hint: string, kind: string, stat: string, target: number,
 *   tone: string|number|undefined, secret: boolean, done: boolean, at: string|null }} TrophyRecord
 */

/**
 * @typedef {object} AchievementsSpec
 * @property {Trophy[]} list
 * @property {any} [store]       a saves() store; the record lives in its achievements section
 * @property {boolean|{ ms?: number, y?: number, pad?: number, caption?: string }} [banner]
 *   the unlock banner; false for none. caption is the small line over the title.
 * @property {number} [depth]    the banner's depth; default 945
 * @property {any} [theme]       a theme handle; default read once off the game's frame
 */

/**
 * @typedef {object} AchievementsHandle
 * @property {(name: string, delta?: number) => number} stat   add to a stat (default +1)
 * @property {(name: string, value: number) => number} set     put a stat at a value
 * @property {(name: string, on?: boolean) => boolean} flag    raise (or lower) a flag
 * @property {(id: string) => boolean} unlock                 unlock by hand; false when it already was
 * @property {() => string[]} unlocked                          ids, earliest first
 * @property {(id: string) => { value: number|null, target: number, done: boolean }|null} progress
 * @property {() => TrophyRecord[]} list                         every trophy, secrets masked
 * @property {() => void} reset                                  forget every unlock, stat and flag
 * @property {(event: 'unlock'|'reset', fn: (value?: any) => void) => (() => void)} on
 * @property {() => boolean} load                                apply the store's section
 * @property {() => Promise<void>} persist                       write the section now
 * @property {() => void} destroy
 */

/**
 * The medal, drawn once per colour and kept: two ribbon tails meeting a disc with a ring. A
 * locked trophy draws it in the line colour, so a room shows it dim without a second shape.
 * @param {any} scene
 * @param {any} th
 * @param {number} colour
 * @returns {string} the texture key
 */
function medalTexture(scene, th, colour) {
  const key = 'ak-phaser-medal-' + ((colour >>> 0) & 0xffffff).toString(16);
  if (scene.textures && scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ add: false });
  const s = MEDAL;
  g.fillStyle(colour, 0.7);
  g.fillTriangle(s * 0.22, 0, s * 0.5, 0, s * 0.5, s * 0.5);
  g.fillTriangle(s * 0.5, 0, s * 0.78, 0, s * 0.5, s * 0.5);
  g.fillStyle(colour, 1);
  g.fillCircle(s * 0.5, s * 0.66, s * 0.3);
  g.fillStyle(th.surface, 1);
  g.fillCircle(s * 0.5, s * 0.66, s * 0.16);
  g.generateTexture(key, s, s);
  g.destroy();
  return key;
}

/**
 * The trophies for one game.
 * @param {any} scene
 * @param {AchievementsSpec} spec
 * @returns {AchievementsHandle}
 */
export function achievements(scene, spec) {
  const s = spec || /** @type {AchievementsSpec} */ ({ list: [] });
  const th = s.theme || look(scene);
  const still = reducedMotion();
  const pace = ms(th.motion, 200);
  const depth = num(s.depth, BANNER_DEPTH);
  const store = s.store && typeof s.store.get === 'function' && typeof s.store.set === 'function' ? s.store : null;
  const bannerOn = s.banner !== false;
  const bannerOpts = s.banner && typeof s.banner === 'object' ? s.banner : {};
  const pool = motionPool(scene);

  /** @type {Trophy[]} */
  const list = [];
  for (const t of (Array.isArray(s.list) ? s.list : [])) {
    if (!t || typeof t !== 'object' || !t.id || !KINDS[t.kind]) {
      console.warn('[aimeat-phaser] a trophy needs an id and a kind of count, flag, max or min:', t);
      continue;
    }
    if (t.kind !== 'flag' && !(typeof t.target === 'number' && isFinite(t.target))) {
      console.warn('[aimeat-phaser] trophy ' + t.id + ' needs a numeric target');
      continue;
    }
    list.push(t);
  }

  /** @type {Record<string, string>} id to the time it unlocked */
  let unlockedAt = {};
  /** @type {Record<string, number>} */
  let stats = {};
  /** @type {Record<string, boolean>} */
  let flags = {};
  /** @type {Record<string, Array<(value?: any) => void>>} */
  const listeners = { unlock: [], reset: [] };
  /** @type {Trophy[]} banners still owed, in order */
  const queue = [];
  /** @type {any} the banner on screen */
  let showing = null;
  /** @type {any} */
  let holdTimer = null;
  let dead = false;
  let loading = false;
  let lastWritten = '';

  function trophyOf(id) {
    for (const t of list) if (t.id === id) return t;
    return null;
  }

  /** @param {Trophy} t */
  function met(t) {
    if (t.kind === 'flag') return !!flags[t.stat];
    const v = stats[t.stat];
    if (typeof v !== 'number') return false;
    return t.kind === 'min' ? v <= t.target : v >= t.target;
  }

  function emit(event, value) {
    for (const fn of (listeners[event] || []).slice()) {
      try {
        fn(value);
      } catch (err) {
        console.warn('[aimeat-phaser] an achievements listener threw:', err);
      }
    }
  }

  /** @param {Trophy} t @returns {TrophyRecord} */
  function record(t) {
    return {
      id: t.id, title: t.title, hint: t.hint || '', kind: t.kind, stat: t.stat,
      target: t.kind === 'flag' ? 1 : t.target, tone: t.tone, secret: !!t.secret,
      done: !!unlockedAt[t.id], at: unlockedAt[t.id] || null,
    };
  }

  /** The unlock itself, once per id. The caller persists. @param {Trophy} t */
  function unlock(t) {
    if (unlockedAt[t.id]) return false;
    unlockedAt[t.id] = new Date().toISOString();
    emit('unlock', record(t));
    if (bannerOn) {
      queue.push(t);
      nextBanner();
    }
    return true;
  }

  /** Read every condition on a stat (or all of them for null). @returns {number} new unlocks */
  function evaluate(statName) {
    let n = 0;
    for (const t of list) {
      if (unlockedAt[t.id] || (statName != null && t.stat !== statName)) continue;
      if (met(t) && unlock(t)) n += 1;
    }
    return n;
  }

  /** A board trophy's stat, offered to the store as the best when it rises. */
  function post(statName) {
    if (!store || typeof store.leaderboard !== 'function') return;
    const v = stats[statName];
    if (typeof v !== 'number') return;
    for (const t of list) {
      if (!t.board || t.stat !== statName || (t.kind !== 'count' && t.kind !== 'max')) continue;
      const state = store.get();
      if (v > num(state && state.best, 0)) store.set({ best: v });
      return;
    }
  }

  function section() {
    return { unlocked: Object.assign({}, unlockedAt), stats: Object.assign({}, stats), flags: Object.assign({}, flags) };
  }

  function persist() {
    if (!store || dead || loading) return Promise.resolve();
    const sec = section();
    lastWritten = JSON.stringify(sec);
    store.set({ achievements: sec });
    return typeof store.save === 'function' ? store.save() : Promise.resolve();
  }

  /** The store's section over what is held: unlocks are a union, stats and flags take the store's. */
  function load() {
    if (!store) return false;
    const state = store.get();
    const sec = state && state.achievements && typeof state.achievements === 'object' ? state.achievements : null;
    if (!sec) return false;
    loading = true;
    unlockedAt = Object.assign({}, sec.unlocked && typeof sec.unlocked === 'object' ? sec.unlocked : {}, unlockedAt);
    stats = Object.assign({}, stats, sec.stats && typeof sec.stats === 'object' ? sec.stats : {});
    flags = Object.assign({}, flags, sec.flags && typeof sec.flags === 'object' ? sec.flags : {});
    lastWritten = JSON.stringify(section());
    loading = false;
    if (evaluate(null) > 0) persist();
    return true;
  }

  const unhook = store && typeof store.onChange === 'function' ? store.onChange(function (state) {
    if (dead || loading) return;
    const sec = state && state.achievements;
    if (!sec || typeof sec !== 'object' || JSON.stringify(sec) === lastWritten) return;
    load();
  }) : null;

  /* ── The banner ────────────────────────────────────────────────────────────────────────── */

  function nextBanner() {
    if (dead || showing || !queue.length) return;
    const t = queue.shift();
    const tone = toneColour(th, /** @type {any} */ (t.tone), th.accent);
    const caption = scene.add.text(0, 0, bannerOpts.caption || 'Trophy unlocked', {
      fontFamily: th.fontMono, fontSize: '11px', color: cssColour(th.inkDim),
    }).setOrigin(0, 0);
    const title = scene.add.text(0, 0, t.title, {
      fontFamily: th.fontDisplay, fontSize: '17px', color: cssColour(th.ink),
    }).setOrigin(0, 0);
    const w = Math.ceil(Math.max(caption.width, title.width)) + MEDAL + 44;
    const h = BANNER_H;
    const plate = scene.add.graphics();
    plate.fillStyle(th.surface, 0.97);
    plate.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    plate.lineStyle(1, tone, 1);
    plate.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    plate.fillStyle(tone, 1);
    plate.fillRoundedRect(-w / 2, -h / 2, 6, h, { tl: 10, bl: 10, tr: 0, br: 0 });
    const medal = scene.add.image(-w / 2 + 16 + MEDAL / 2, 0, medalTexture(scene, th, tone));
    const tx = -w / 2 + 16 + MEDAL + 12;
    caption.setPosition(tx, -h / 2 + 9);
    title.setPosition(tx, -h / 2 + 24);
    const restY = num(bannerOpts.y, num(bannerOpts.pad, 14) + h / 2);
    const box = scene.add.container(scene.scale.width / 2, still ? restY : -h, [plate, medal, caption, title])
      .setScrollFactor(0).setDepth(depth);
    showing = box;
    const hold = Math.max(300, num(bannerOpts.ms, BANNER_MS));

    const leave = function () {
      holdTimer = null;
      if (dead) return;
      pool.run({
        targets: box, y: still ? restY : -h, alpha: still ? 0 : 1,
        duration: still ? pace : pace * 1.6, ease: 'Quad.easeIn',
        onComplete: function () {
          box.destroy(true);
          showing = null;
          nextBanner();
        },
      });
    };
    const settle = function () { holdTimer = scene.time.delayedCall(hold, leave); };
    if (still) {
      box.setAlpha(0);
      pool.run({ targets: box, alpha: 1, duration: pace, onComplete: settle });
    } else {
      pool.run({ targets: box, y: restY, duration: pace * 2, ease: 'Back.easeOut', onComplete: settle });
    }
  }

  /* ── The surface ───────────────────────────────────────────────────────────────────────── */

  function after(key) {
    evaluate(key);
    post(key);
    persist();
  }

  function destroy() {
    if (dead) return;
    dead = true;
    scene.events.off('shutdown', destroy);
    scene.events.off('destroy', destroy);
    if (unhook) unhook();
    if (holdTimer) {
      holdTimer.remove(false);
      holdTimer = null;
    }
    queue.length = 0;
    pool.killAll();
    if (showing) {
      showing.destroy(true);
      showing = null;
    }
    listeners.unlock.length = 0;
    listeners.reset.length = 0;
  }

  scene.events.once('shutdown', destroy);
  scene.events.once('destroy', destroy);
  if (store) load();

  return {
    stat(name, delta) {
      if (dead) return 0;
      const key = String(name);
      stats[key] = num(stats[key], 0) + (delta === undefined ? 1 : num(delta, 0));
      after(key);
      return stats[key];
    },
    set(name, value) {
      if (dead) return 0;
      const key = String(name);
      stats[key] = num(value, 0);
      after(key);
      return stats[key];
    },
    flag(name, on) {
      if (dead) return false;
      const key = String(name);
      if (on === false) delete flags[key];
      else flags[key] = true;
      evaluate(key);
      persist();
      return !!flags[key];
    },
    unlock(id) {
      const t = trophyOf(String(id));
      if (!t || dead || !unlock(t)) return false;
      persist();
      return true;
    },
    unlocked() {
      return Object.keys(unlockedAt).sort(function (a, b) { return unlockedAt[a] < unlockedAt[b] ? -1 : 1; });
    },
    progress(id) {
      const t = trophyOf(String(id));
      if (!t) return null;
      const done = !!unlockedAt[t.id];
      if (t.kind === 'flag') return { value: flags[t.stat] ? 1 : 0, target: 1, done: done };
      const v = stats[t.stat];
      return { value: typeof v === 'number' ? v : (t.kind === 'min' ? null : 0), target: t.target, done: done };
    },
    list() {
      return list.map(function (t) {
        const r = record(t);
        if (r.secret && !r.done) {
          r.title = '???';
          r.hint = '';
        }
        return r;
      });
    },
    reset() {
      if (dead) return;
      unlockedAt = {};
      stats = {};
      flags = {};
      queue.length = 0;
      persist();
      emit('reset', undefined);
    },
    on(event, fn) {
      const bucket = listeners[event];
      if (!bucket || typeof fn !== 'function') return function () { /* nothing was registered */ };
      bucket.push(fn);
      return function () {
        const at = bucket.indexOf(fn);
        if (at >= 0) bucket.splice(at, 1);
      };
    },
    load: load,
    persist: persist,
    destroy: destroy,
  };
}

/**
 * The trophy room: every trophy in a scrolling panel over the game. Unlocked ones bright, locked
 * ones dim with their hint, secret ones as '???'. The wheel, a drag, the arrow keys and a controls
 * state scroll it; Escape, Enter, Space, the controls' action or pause, the Close label and a tap
 * outside the panel close it.
 *
 * @param {any} scene
 * @param {AchievementsHandle} ach
 * @param {{ title?: string, closeLabel?: string, unlockedLabel?: string, controls?: any,
 *   width?: number, height?: number, depth?: number, theme?: any, onClose?: () => void }} [opts]
 * @returns {{ close: () => void, destroy: () => void, scroll: (dy: number) => void }}
 */
export function trophyRoom(scene, ach, opts) {
  const o = opts || {};
  const th = o.theme || look(scene);
  const still = reducedMotion();
  const pace = ms(th.motion, 200);
  const ease = curve(th);
  const depth = num(o.depth, ROOM_DEPTH);
  const pool = motionPool(scene);
  const W = scene.scale.width;
  const H = scene.scale.height;
  const w = Math.min(W - 28, num(o.width, 460));
  const h = Math.min(H - 28, num(o.height, 340));
  const rows = ach && typeof ach.list === 'function' ? ach.list() : [];
  const doneCount = rows.filter(function (r) { return r.done; }).length;
  let gone = false;

  const root = scene.add.container(0, 0).setScrollFactor(0).setDepth(depth);
  const scrim = scene.add.rectangle(0, 0, W, H, th.bg, 0.78).setOrigin(0, 0);
  scrim.setInteractive();
  scrim.on('pointerdown', close);
  root.add(scrim);

  const x0 = Math.round((W - w) / 2);
  const y0 = Math.round((H - h) / 2);
  const panel = scene.add.graphics();
  panel.fillStyle(th.surface, 1);
  panel.fillRoundedRect(x0, y0, w, h, 12);
  panel.lineStyle(1, th.line, 1);
  panel.strokeRoundedRect(x0, y0, w, h, 12);
  // The panel takes its own pointer downs, so a tap on it is not a tap on the scrim behind it.
  const shield = scene.add.rectangle(x0, y0, w, h).setOrigin(0, 0);
  shield.setInteractive();
  root.add([panel, shield]);

  const title = scene.add.text(x0 + ROOM_PAD, y0 + ROOM_PAD, o.title || 'Trophies', {
    fontFamily: th.fontDisplay, fontSize: '20px', color: cssColour(th.ink),
  }).setOrigin(0, 0);
  const tally = scene.add.text(x0 + w - ROOM_PAD, y0 + ROOM_PAD + 5, doneCount + ' / ' + rows.length, {
    fontFamily: th.fontMono, fontSize: '13px', color: cssColour(th.inkDim),
  }).setOrigin(1, 0);
  const closeText = scene.add.text(x0 + w - ROOM_PAD, y0 + h - ROOM_PAD, o.closeLabel || 'Close', {
    fontFamily: th.fontMono, fontSize: '12px', color: cssColour(th.accent),
  }).setOrigin(1, 1);
  closeText.setInteractive({ useHandCursor: true });
  closeText.on('pointerdown', close);
  root.add([title, tally, closeText]);

  // The list lives in a masked viewport under the header and above the Close label.
  const vx = x0 + ROOM_PAD;
  const vy = y0 + ROOM_PAD + 36;
  const vw = w - ROOM_PAD * 2;
  const vh = h - ROOM_PAD * 2 - 36 - 24;
  const listBox = scene.add.container(vx, vy);
  root.add(listBox);
  const shape = scene.make.graphics({ add: false });
  shape.fillStyle(th.ink, 1);
  shape.fillRect(vx, vy, vw, vh);
  shape.setScrollFactor(0);
  listBox.setMask(shape.createGeometryMask());

  const dimKey = medalTexture(scene, th, th.line);
  const unlockedLabel = o.unlockedLabel || 'Unlocked';
  rows.forEach(function (r, i) {
    const rowBox = scene.add.container(0, i * ROW_H);
    const medal = scene.add.image(MEDAL / 2 + 2, ROW_H / 2,
      r.done ? medalTexture(scene, th, toneColour(th, /** @type {any} */ (r.tone), th.accent)) : dimKey);
    const name = scene.add.text(MEDAL + 16, 8, r.title, {
      fontFamily: th.font, fontSize: '15px', color: cssColour(r.done ? th.ink : th.inkDim),
    }).setOrigin(0, 0);
    const line = r.done ? unlockedLabel + (r.at ? ' ' + String(r.at).slice(0, 10) : '') : r.hint;
    const hint = scene.add.text(MEDAL + 16, 27, line, {
      fontFamily: th.fontMono, fontSize: '11px', color: cssColour(th.inkDim),
    }).setOrigin(0, 0);
    const rule = scene.add.graphics();
    rule.lineStyle(1, th.line, 0.6);
    rule.lineBetween(0, ROW_H - 1, vw, ROW_H - 1);
    rowBox.add([rule, medal, name, hint]);
    listBox.add(rowBox);
    if (still) return;
    rowBox.setAlpha(0);
    pool.run({ targets: rowBox, alpha: 1, delay: Math.min(i, 8) * pace * 0.25, duration: pace * 1.5, ease: ease });
  });

  const maxScroll = Math.max(0, rows.length * ROW_H - vh);
  let scrollY = 0;
  /** @param {number} dy */
  function scroll(dy) {
    if (gone) return;
    scrollY = Math.max(0, Math.min(maxScroll, scrollY + num(dy, 0)));
    listBox.y = vy - scrollY;
  }
  const onWheel = function (_pointer, _over, _dx, dy) { scroll(dy); };
  const onMove = function (pointer) {
    if (pointer && pointer.isDown && pointer.prevPosition) scroll(pointer.prevPosition.y - pointer.y);
  };
  scene.input.on('wheel', onWheel);
  scene.input.on('pointermove', onMove);

  const keyboard = scene.input && scene.input.keyboard ? scene.input.keyboard : null;
  const onUp = function () { scroll(-ROW_H); };
  const onDown = function () { scroll(ROW_H); };
  const keys = [
    ['keydown-UP', onUp], ['keydown-W', onUp], ['keydown-DOWN', onDown], ['keydown-S', onDown],
    ['keydown-ESC', close], ['keydown-ENTER', close], ['keydown-SPACE', close],
  ];
  if (keyboard) for (const k of keys) keyboard.on(k[0], k[1]);

  // A controls state works the same list. The press that opened the room is still down on the
  // first frame, so action and pause start out as held and only a fresh press closes.
  const held = { up: false, down: false, act: true, pause: true };
  const tick = function () {
    const c = o.controls;
    if (gone || !c) return;
    const up = !!c.up;
    const down = !!c.down;
    const act = !!(c.action || c.jump);
    const pause = !!c.pause;
    if (up && !held.up) scroll(-ROW_H);
    if (down && !held.down) scroll(ROW_H);
    held.up = up;
    held.down = down;
    const fresh = (act && !held.act) || (pause && !held.pause);
    held.act = act;
    held.pause = pause;
    if (fresh) close();
  };
  if (o.controls) scene.events.on('update', tick);

  function close() {
    if (gone) return;
    gone = true;
    scene.events.off('update', tick);
    scene.events.off('shutdown', close);
    scene.input.off('wheel', onWheel);
    scene.input.off('pointermove', onMove);
    if (keyboard) for (const k of keys) keyboard.off(k[0], k[1]);
    pool.killAll();
    listBox.clearMask(true);
    shape.destroy();
    root.destroy(true);
    if (typeof o.onClose === 'function') o.onClose();
  }

  scene.events.once('shutdown', close);
  if (!still) {
    root.setAlpha(0);
    pool.run({ targets: root, alpha: 1, duration: pace, ease: ease });
  }
  return { close: close, destroy: close, scroll: scroll };
}
