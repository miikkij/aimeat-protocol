/**
 * @file phaser/status-parts.js
 * @description The departments status() assembles, and the two helpers achievements.js shares
 *   with it. A pure extraction from status.js, made when that file passed the 800-line rule:
 *   nothing here changed shape, and status.js still owns the bars, the inventory row, the layout
 *   and the store section.
 *
 *   THE TONE TABLE is the one place a tone word ('ok', 'err', 'ch3') becomes a theme colour, so
 *   a bar, a ring, a chip and a medal all mean the same thing by 'warn'.
 *
 *   THE TWEEN POOL is how a handle keeps every motion it started: run() forgets a tween when it
 *   ends, stop() ends the ones on a target, killAll() is what destroy() calls. Nothing a handle
 *   started can outlive it.
 *
 *   THE THREE DEPARTMENTS (cooldown rings, buff chips, the quest log) each take a context (the
 *   scene, the theme, the pace, the pool, whether less motion is on, how to persist) and the
 *   container they draw into, and hand back their public surface plus what the assembler needs
 *   for layout and for the store section. Every motion in them is finite: a ring drains once and
 *   pops once when ready, a chip drains once and fades, a check-off pops once. Under less motion
 *   a ring or a chip repaints in eight steps rather than every frame, and the pops are skipped.
 * @structure toneColour() · motionPool() · num() · glyph() · cooldownRings(ctx, box, specs) ·
 *   buffChips(ctx, box) · questLog(ctx, box, label)
 * @usage  Internal to the library: status.js and achievements.js import from here, and an app
 *   reaches the result through AIMEAT.phaser.status() and AIMEAT.phaser.achievements().
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: extracted from status.js (the tone table, the tween pool, the
 *     glyph, the cooldown rings, the buff chips and the quest log).
 */
import { cssColour } from './tokens.js';

/** The cooldown ring. */
const RING_R = 17;
const RING_GAP = 10;
const RING_LINE = 3;

/** The buff chip. */
const CHIP_H = 22;
const CHIP_GAP = 6;

/** The quest log's faces and its check box. */
const QUEST_TITLE = 14;
const QUEST_STEP = 12;
const QUEST_BOX = 10;

/** Under less motion a timer repaints this many times instead of every frame. */
const STILL_STEPS = 8;

/** The tone words a bar, a ring, a chip or a medal may name, and the theme colour each one is. */
const TONE_KEYS = {
  ok: 'ok', warn: 'warn', err: 'err', accent: 'accent', ink: 'ink', dim: 'inkDim',
  ch1: 'ch1', ch2: 'ch2', ch3: 'ch3', ch4: 'ch4',
};

/**
 * @typedef {'ok'|'warn'|'err'|'accent'|'ink'|'dim'|'ch1'|'ch2'|'ch3'|'ch4'|number} Tone
 */

/**
 * A tone word, or a colour number, as a theme colour.
 * @param {any} th  the theme handle
 * @param {Tone|undefined} want
 * @param {number} fallback
 * @returns {number}
 */
export function toneColour(th, want, fallback) {
  if (typeof want === 'number' && isFinite(want)) return want;
  const key = typeof want === 'string' ? TONE_KEYS[want] : undefined;
  return key && typeof th[key] === 'number' ? th[key] : fallback;
}

/**
 * The tweens one handle owns.
 * @param {any} scene
 * @returns {{ run: (config: any) => any, stop: (target: any) => void, killAll: () => void }}
 */
export function motionPool(scene) {
  const flying = new Set();
  return {
    run(config) {
      const after = config.onComplete;
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

/**
 * A finite number, or the fallback.
 * @param {any} v
 * @param {number} fallback
 * @returns {number}
 */
export function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/**
 * A small mark centred on (0, 0): the texture when the key names one the scene has loaded, else
 * the first two characters as text. So an icon can be a sprite from the game's pack or a letter.
 * @param {any} scene
 * @param {any} th
 * @param {any} what  a texture key or a short string
 * @param {number} size
 * @param {number} colour
 * @returns {any}
 */
export function glyph(scene, th, what, size, colour) {
  const key = what == null ? '' : String(what);
  if (key && scene.textures && scene.textures.exists(key)) {
    const img = scene.add.image(0, 0, key);
    img.setScale(size / Math.max(1, img.width, img.height));
    return img;
  }
  return scene.add.text(0, 0, key.slice(0, 2), {
    fontFamily: th.fontDisplay, fontSize: Math.round(size * 0.62) + 'px', color: cssColour(colour),
  }).setOrigin(0.5, 0.5);
}

/**
 * What every department is handed.
 * @typedef {object} StatusContext
 * @property {any} scene
 * @property {any} th             the theme handle
 * @property {boolean} still      less motion is on
 * @property {number} pace        the look's pace, in ms
 * @property {{ run: (config: any) => any, stop: (target: any) => void, killAll: () => void }} pool
 * @property {() => boolean} alive   false once the handle has been destroyed
 * @property {() => any} persist     write the store section, when there is a store
 */

/**
 * @typedef {object} CooldownSpec
 * @property {string} id
 * @property {string} [icon]    a texture key or a letter inside the ring; default the id's first letter
 * @property {number} [ms]      the length start(id) uses when given none; default 1000
 * @property {Tone} [tone]      the ring when ready; default 'accent'
 */

/**
 * The round rings that drain. Ready: a full ring in its tone. Cooling: what remains of a dim arc,
 * the mark half faded. Done: ready again, with one pop.
 * @param {StatusContext} ctx
 * @param {any} box   the container the rings are laid in, left to right
 * @param {CooldownSpec[]} specs
 * @returns {{ api: { start: (id: string, ms?: number) => boolean, ready: (id: string) => boolean,
 *   reset: (id: string) => boolean }, width: number, height: number }}
 */
export function cooldownRings(ctx, box, specs) {
  const scene = ctx.scene;
  const th = ctx.th;
  const pool = ctx.pool;
  /** @type {Array<{ id: string, spec: CooldownSpec, tone: number, box: any, ring: any, mark: any,
   *   state: { p: number }, ready: boolean }>} */
  const rings = [];

  function drawRing(r) {
    const g = r.ring;
    g.clear();
    if (r.ready) {
      g.lineStyle(RING_LINE, r.tone, 1);
      g.strokeCircle(0, 0, RING_R);
      return;
    }
    const share = ctx.still ? Math.ceil(r.state.p * STILL_STEPS) / STILL_STEPS : r.state.p;
    if (share <= 0) return;
    g.lineStyle(RING_LINE, th.inkDim, 1);
    g.beginPath();
    g.arc(0, 0, RING_R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share, false);
    g.strokePath();
  }

  /** @param {CooldownSpec} c @param {number} i */
  function buildRing(c, i) {
    const tone = toneColour(th, c.tone, th.accent);
    const cell = scene.add.container(i * (RING_R * 2 + RING_GAP) + RING_R, RING_R);
    const back = scene.add.graphics();
    back.fillStyle(th.surface, 0.9);
    back.fillCircle(0, 0, RING_R);
    back.lineStyle(1, th.line, 1);
    back.strokeCircle(0, 0, RING_R);
    const ring = scene.add.graphics();
    const mark = glyph(scene, th, c.icon != null ? c.icon : c.id.charAt(0), RING_R * 1.1, th.ink);
    cell.add([back, ring, mark]);
    box.add(cell);
    const r = { id: c.id, spec: c, tone: tone, box: cell, ring: ring, mark: mark, state: { p: 0 }, ready: true };
    rings.push(r);
    drawRing(r);
  }
  (specs || []).forEach(function (c, i) { if (c && c.id) buildRing(c, i); });

  function ringOf(id) {
    for (const r of rings) if (r.id === id) return r;
    return null;
  }

  function becomeReady(r, pop) {
    r.ready = true;
    r.state.p = 0;
    r.mark.setAlpha(1);
    drawRing(r);
    if (!pop || ctx.still) return;
    pool.run({
      targets: r.box, scale: 1.16, duration: Math.max(60, ctx.pace * 0.6), yoyo: true, ease: 'Quad.easeOut',
      onComplete: function () { r.box.setScale(1); },
    });
  }

  const api = {
    /** Start draining, for ms or for the spec's length. A ring already cooling starts over. */
    start(id, msWanted) {
      const r = ringOf(id);
      if (!r || !ctx.alive()) return false;
      const span = Math.max(16, num(msWanted, num(r.spec.ms, 1000)));
      pool.stop(r.state);
      r.ready = false;
      r.state.p = 1;
      r.mark.setAlpha(0.5);
      drawRing(r);
      pool.run({
        targets: r.state, p: 0, duration: span, ease: 'Linear',
        onUpdate: function () { drawRing(r); },
        onComplete: function () { becomeReady(r, true); },
      });
      return true;
    },
    ready(id) {
      const r = ringOf(id);
      return !!(r && r.ready);
    },
    /** Make it ready now, with no pop: the game granted it rather than the clock. */
    reset(id) {
      const r = ringOf(id);
      if (!r || !ctx.alive()) return false;
      pool.stop(r.state);
      becomeReady(r, false);
      return true;
    },
  };

  return {
    api: api,
    width: rings.length ? rings.length * (RING_R * 2 + RING_GAP) - RING_GAP : 0,
    height: RING_R * 2,
  };
}

/**
 * Small chips with a timer, stacked upward from a bottom corner. The chip's drain line runs for
 * exactly the ms it was given, then the chip fades and is gone.
 * @param {StatusContext} ctx
 * @param {any} box   the container the chips stack in; its origin is the bottom corner
 * @returns {{ api: { add: (id: string, b: { label?: string, ms?: number, tone?: Tone }) => any,
 *   remove: (id: string) => boolean, has: (id: string) => boolean, clear: () => void },
 *   align: (fromRight: boolean) => void }}
 */
export function buffChips(ctx, box) {
  const scene = ctx.scene;
  const th = ctx.th;
  const pool = ctx.pool;
  /** @type {Array<{ id: string, box: any, w: number, drain: any, tone: number, state: { p: number } }>} */
  const chips = [];
  let rightSide = true;

  function chipOf(id) {
    for (const c of chips) if (c.id === id) return c;
    return null;
  }

  function place() {
    let y = 0;
    for (const c of chips) {
      y -= CHIP_H;
      c.box.setPosition(rightSide ? -c.w : 0, y);
      y -= CHIP_GAP;
    }
  }

  function drawDrain(c) {
    const share = ctx.still ? Math.ceil(c.state.p * STILL_STEPS) / STILL_STEPS : c.state.p;
    c.drain.clear();
    const w = Math.round((c.w - 12) * Math.max(0, Math.min(1, share)));
    if (w < 1) return;
    c.drain.fillStyle(c.tone, 1);
    c.drain.fillRect(6, CHIP_H - 4, w, 2);
  }

  function dropChip(c, now) {
    const at = chips.indexOf(c);
    if (at >= 0) chips.splice(at, 1);
    pool.stop(c.state);
    pool.stop(c.box);
    place();
    if (now || ctx.still) {
      c.box.destroy(true);
      return;
    }
    pool.run({ targets: c.box, alpha: 0, duration: Math.max(80, ctx.pace), onComplete: function () { c.box.destroy(true); } });
  }

  const api = {
    /** Show a chip for ms; the same id again restarts it. Returns the chip's container. */
    add(id, b) {
      if (!ctx.alive()) return null;
      const o = b && typeof b === 'object' ? b : {};
      const key = String(id);
      const had = chipOf(key);
      if (had) dropChip(had, true);
      const tone = toneColour(th, o.tone, th.accent);
      const label = scene.add.text(8, CHIP_H / 2 - 1, o.label != null ? String(o.label) : key, {
        fontFamily: th.fontMono, fontSize: '11px', color: cssColour(th.ink),
      }).setOrigin(0, 0.5);
      const w = Math.ceil(label.width) + 16;
      const pill = scene.add.graphics();
      pill.fillStyle(th.surface, 0.94);
      pill.fillRoundedRect(0, 0, w, CHIP_H, CHIP_H / 2);
      pill.lineStyle(1, tone, 1);
      pill.strokeRoundedRect(0, 0, w, CHIP_H, CHIP_H / 2);
      const drain = scene.add.graphics();
      const chip = scene.add.container(0, 0, [pill, drain, label]);
      box.add(chip);
      const c = { id: key, box: chip, w: w, drain: drain, tone: tone, state: { p: 1 } };
      chips.push(c);
      drawDrain(c);
      place();
      pool.run({
        targets: c.state, p: 0, duration: Math.max(16, num(o.ms, 3000)), ease: 'Linear',
        onUpdate: function () { drawDrain(c); },
        onComplete: function () { dropChip(c, false); },
      });
      return chip;
    },
    remove(id) {
      const c = chipOf(String(id));
      if (!c) return false;
      dropChip(c, true);
      return true;
    },
    has(id) {
      return !!chipOf(String(id));
    },
    clear() {
      for (const c of chips.slice()) dropChip(c, true);
    },
  };

  return {
    api: api,
    /** Which way the chips grow from the corner: leftward from a right corner, or rightward. */
    align(fromRight) {
      rightSide = fromRight !== false;
      place();
    },
  };
}

/**
 * @typedef {{ title: string, done?: boolean, steps?: Array<{ text: string, done?: boolean }> }} QuestSpec
 */

/**
 * @typedef {{ id: string, title: string, done: boolean, steps: Array<{ text: string, done: boolean }> }} QuestRecord
 */

/**
 * The small quest log: a caption, then each quest as a check box, a title and its steps. A
 * completed quest checks off with one pop and dims.
 * @param {StatusContext} ctx
 * @param {any} box   the container the log is laid in, top down
 * @param {string} label   the caption over the list
 * @returns {{ api: { set: (id: string, q: QuestSpec) => QuestRecord, complete: (id: string) => boolean,
 *   remove: (id: string) => boolean, get: (id: string) => QuestRecord|null },
 *   records: () => QuestRecord[], replace: (list: any[]) => void }}
 */
export function questLog(ctx, box, label) {
  const scene = ctx.scene;
  const th = ctx.th;
  const pool = ctx.pool;
  const caption = scene.add.text(0, 0, label, {
    fontFamily: th.fontMono, fontSize: '11px', color: cssColour(th.inkDim),
  }).setOrigin(0, 0).setVisible(false);
  box.add(caption);
  /** @type {Array<{ id: string, rec: QuestRecord, box: any, square: any, tick: any, title: any,
   *   steps: Array<{ square: any }> }>} */
  const rows = [];

  function questOf(id) {
    for (const q of rows) if (q.id === id) return q;
    return null;
  }

  function drawSquare(g, size, done) {
    g.clear();
    if (done) {
      g.fillStyle(th.ok, 1);
      g.fillRoundedRect(0, 0, size, size, 2);
    } else {
      g.lineStyle(1, th.inkDim, 1);
      g.strokeRoundedRect(0, 0, size, size, 2);
    }
  }

  function paint(q) {
    drawSquare(q.square, QUEST_BOX, q.rec.done);
    q.tick.setVisible(q.rec.done);
    q.title.setColor(cssColour(q.rec.done ? th.inkDim : th.ink));
    q.steps.forEach(function (st, i) { drawSquare(st.square, QUEST_BOX - 2, !!q.rec.steps[i].done); });
  }

  function height(q) {
    return QUEST_TITLE + 6 + q.steps.length * (QUEST_STEP + 5) + 6;
  }

  function place() {
    caption.setVisible(rows.length > 0);
    let y = rows.length ? 16 : 0;
    for (const q of rows) {
      q.box.setPosition(0, y);
      y += height(q);
    }
  }

  /** @param {any} id @param {any} q @returns {QuestRecord} */
  function norm(id, q) {
    const src = q && typeof q === 'object' ? q : {};
    const steps = Array.isArray(src.steps) ? src.steps.map(function (st) {
      return { text: st && st.text != null ? String(st.text) : '', done: !!(st && st.done) };
    }) : [];
    return { id: String(id), title: src.title != null ? String(src.title) : String(id), done: !!src.done, steps: steps };
  }

  /** @param {QuestRecord} rec @returns {QuestRecord} */
  function copy(rec) {
    return { id: rec.id, title: rec.title, done: rec.done,
      steps: rec.steps.map(function (st) { return { text: st.text, done: st.done }; }) };
  }

  /** @param {QuestRecord} rec @param {number} [at] */
  function build(rec, at) {
    const row = scene.add.container(0, 0);
    const square = scene.add.graphics().setPosition(0, 3);
    const tick = scene.add.text(QUEST_BOX / 2, 3 + QUEST_BOX / 2, '✓', {
      fontFamily: th.fontMono, fontSize: '11px', color: cssColour(th.surface),
    }).setOrigin(0.5, 0.5);
    const title = scene.add.text(QUEST_BOX + 8, 0, rec.title, {
      fontFamily: th.font, fontSize: QUEST_TITLE + 'px', color: cssColour(th.ink),
    }).setOrigin(0, 0);
    row.add([square, tick, title]);
    const steps = rec.steps.map(function (st, i) {
      const y = QUEST_TITLE + 6 + i * (QUEST_STEP + 5);
      const sq = scene.add.graphics().setPosition(16, y + 3);
      const text = scene.add.text(16 + QUEST_BOX + 4, y, st.text, {
        fontFamily: th.font, fontSize: QUEST_STEP + 'px', color: cssColour(th.inkDim),
      }).setOrigin(0, 0);
      row.add([sq, text]);
      return { square: sq };
    });
    box.add(row);
    const q = { id: rec.id, rec: rec, box: row, square: square, tick: tick, title: title, steps: steps };
    if (typeof at === 'number' && at >= 0 && at < rows.length) rows.splice(at, 0, q);
    else rows.push(q);
    paint(q);
    place();
    return q;
  }

  function drop(q) {
    const at = rows.indexOf(q);
    if (at >= 0) rows.splice(at, 1);
    pool.stop(q.tick);
    q.box.destroy(true);
    return at;
  }

  const api = {
    /** Add a quest, or replace one by the same id in its place. */
    set(id, q) {
      const rec = norm(id, q);
      if (!ctx.alive()) return rec;
      const had = questOf(rec.id);
      build(rec, had ? drop(had) : -1);
      ctx.persist();
      return copy(rec);
    },
    /** Mark it done, every step with it, with one check-off. */
    complete(id) {
      const q = questOf(String(id));
      if (!q || !ctx.alive()) return false;
      const was = q.rec.done;
      q.rec.done = true;
      for (const st of q.rec.steps) st.done = true;
      paint(q);
      if (!was && !ctx.still) {
        q.tick.setScale(0);
        pool.run({ targets: q.tick, scale: 1, duration: Math.max(80, ctx.pace * 1.2), ease: 'Back.easeOut' });
      }
      ctx.persist();
      return true;
    },
    remove(id) {
      const q = questOf(String(id));
      if (!q || !ctx.alive()) return false;
      drop(q);
      place();
      ctx.persist();
      return true;
    },
    get(id) {
      const q = questOf(String(id));
      return q ? copy(q.rec) : null;
    },
  };

  return {
    api: api,
    /** The quests as records, for the store section. */
    records() {
      return rows.map(function (q) { return copy(q.rec); });
    },
    /** Every quest replaced from stored records, silently: a load, not a change. */
    replace(list) {
      for (const q of rows.slice()) drop(q);
      for (const rec of (Array.isArray(list) ? list : [])) {
        if (rec && rec.id != null) build(norm(rec.id, rec));
      }
      place();
    },
  };
}
