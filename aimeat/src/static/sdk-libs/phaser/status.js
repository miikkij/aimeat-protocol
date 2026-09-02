/**
 * @file phaser/status.js
 * @description The player's own state, drawn in the canvas on the page's tokens: bars for health,
 *   stamina, mana or anything else with a maximum; round cooldown rings that drain and come back;
 *   an inventory row of slots along the bottom edge; a small quest log; and buff chips with a
 *   timer. hud.js holds the score and the level in the top corners; this module takes the rest of
 *   the edges, so the two share one screen without a collision: the left column below the score
 *   (bars, then the quest log) and the bottom edge (rings on one side, the slots in the middle,
 *   the chips on the other side).
 *
 *   A CHANGE IS A MOTION, AN IDLE STATUS IS NOTHING. A drop tweens the fill down and flashes the
 *   bar once; a rise fills smoothly; a bar that falls into its low zone pulses a counted three
 *   times and stops. A ring drains for exactly the time it was given and pops once when it is
 *   ready. A chip fades when its timer ends. Nothing here runs while the game stands still, and
 *   under less motion every value lands where it belongs with no travel: the flash is one short
 *   tint, the low pulse is skipped, and a ring or a chip repaints in eight steps instead of every
 *   frame.
 *
 *   PERSISTENCE IS ONE SECTION OF THE ONE SAVE KEY. Given a saves() store, bars, the inventory
 *   and the quests read from and write to store.get().status through set() and save(), so a whole
 *   status costs the player nothing against the node's key budget. The section is applied at
 *   construction when the store already holds one, and again whenever the store reports a change
 *   this handle did not write (the load after sign-in, for one), so an app needs no ceremony
 *   beyond passing the store. Cooldowns and buffs are timers and are not written: a saved
 *   cooldown would be stale before the page had loaded.
 *
 *     status: {
 *       bars: { [id]: { value, max } },
 *       inventory: { slots: [ { key?, icon?, count?, label? } | null, ... ], selected: number },
 *       quests: [ { id, title, done, steps: [ { text, done } ] }, ... ],
 *     }
 *
 *   NO COLOUR IS WRITTEN HERE. Every fill, edge and face is a theme token read once through
 *   tokens.js, so a page that changes its palette changes the whole status with it. The rings,
 *   the chips and the quest log are built in status-parts.js and assembled here, which is also
 *   where the tone table and the tween pool this file and achievements.js share live.
 * @structure status(scene, spec) → bars / cooldowns / inventory / quest / buffs / layout / load /
 *   persist / show / hide / destroy. Bars and the inventory row are built here; the cooldown
 *   rings, the buff chips and the quest log come from ./status-parts.js.
 * @usage
 *   const st = AIMEAT.phaser.status(this, {
 *     store: store,
 *     bars: [{ id: 'hp', label: 'Health', max: 100, value: 100, tone: 'err' }],
 *     cooldowns: [{ id: 'dash', icon: 'D', ms: 3000 }],
 *     inventory: { slots: 6 },
 *   });
 *   st.bars.set('hp', 64); st.cooldowns.start('dash'); st.inventory.setSlot(0, { icon: 'K', count: 2 });
 *   st.quest.set('gate', { title: 'Open the gate', steps: [{ text: 'Find the key', done: false }] });
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: bars, cooldown rings, the inventory row, the quest log and buff
 *     chips on the theme, persisted as one section of the saves() key.
 */
import { reducedMotion } from '../atelier/dom.js';
import { look, cssColour, ms, curve } from './tokens.js';
import { toneColour, motionPool, num, glyph, cooldownRings, buffChips, questLog } from './status-parts.js';

/** Above hud()'s figures (900) and under its toast (950), so a passing message reads over a bar. */
const STATUS_DEPTH = 940;

/** The bar's box, the row pitch it takes, where the low zone starts and how often it pulses. */
const BAR_W = 160;
const BAR_H = 10;
const BAR_ROW = 34;
const LOW_SHARE = 0.25;
const LOW_PULSES = 3;

/** The inventory slot, the gap between two, and how far the chosen one lifts. */
const SLOT = 44;
const SLOT_GAP = 8;
const SLOT_LIFT = 6;

/** Phaser's names for the digit keys, in the order the slots take them. */
const DIGIT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

/** @typedef {import('./status-parts.js').Tone} Tone */
/** @typedef {import('./status-parts.js').CooldownSpec} CooldownSpec */
/** @typedef {import('./status-parts.js').QuestSpec} QuestSpec */
/** @typedef {import('./status-parts.js').QuestRecord} QuestRecord */

/**
 * @typedef {object} BarSpec
 * @property {string} id
 * @property {string} [label]   over the bar; default the id
 * @property {number} max
 * @property {number} [value]   default max
 * @property {Tone} [tone]      the fill; default 'accent'
 * @property {string} [icon]    a texture key or a letter before the bar
 * @property {number} [low]     the share at or under which the bar pulses; default 0.25
 */

/**
 * @typedef {{ key?: string, icon?: string, count?: number, label?: string }} SlotItem
 */

/**
 * @typedef {object} StatusLayout
 * @property {'left'|'right'} [corner]  which side the column (bars, quests) takes; the bottom
 *   groups mirror with it. Default 'left', under hud()'s score.
 * @property {number} [scale]   one factor over everything. Default 1.
 * @property {number} [pad]     the edge inset, matching hud()'s. Default 14.
 * @property {number} [top]     where the column starts, below the score and the hearts. Default 96.
 */

/**
 * @typedef {object} StatusSpec
 * @property {BarSpec[]} [bars]
 * @property {CooldownSpec[]} [cooldowns]
 * @property {{ slots: number }|number} [inventory]  how many slots the bottom row holds
 * @property {{ label?: string }} [quest]   the log's caption. Default 'Quests'.
 * @property {boolean} [keys]    the digit keys 1..9 select a slot. Default true.
 * @property {any} [store]       a saves() store; bars, inventory and quests live in its status section
 * @property {StatusLayout} [layout]
 * @property {number} [depth]    default 940
 * @property {any} [theme]       a theme handle; default read once off the game's frame
 */

/**
 * @typedef {object} StatusHandle
 * @property {{ set: (id: string, value: number) => number|null, max: (id: string, n?: number) => number|null,
 *   get: (id: string) => { value: number, max: number, share: number }|null }} bars
 * @property {{ start: (id: string, ms?: number) => boolean, ready: (id: string) => boolean,
 *   reset: (id: string) => boolean }} cooldowns
 * @property {{ setSlot: (i: number, item: SlotItem|null) => boolean, select: (i: number) => number,
 *   selected: () => number, get: (i: number) => SlotItem|null, clear: (i?: number) => void }} inventory
 * @property {{ set: (id: string, q: QuestSpec) => QuestRecord, complete: (id: string) => boolean,
 *   remove: (id: string) => boolean, get: (id: string) => QuestRecord|null }} quest
 * @property {{ add: (id: string, b: { label?: string, ms?: number, tone?: Tone }) => any,
 *   remove: (id: string) => boolean, has: (id: string) => boolean, clear: () => void }} buffs
 * @property {(patch?: StatusLayout) => StatusLayout} layout
 * @property {() => boolean} load       apply the store's status section; false when there is none
 * @property {() => Promise<void>} persist   write the section now (every change already does)
 * @property {() => void} show
 * @property {() => void} hide
 * @property {() => void} destroy
 */

/**
 * The status display for one scene.
 * @param {any} scene
 * @param {StatusSpec} [spec]
 * @returns {StatusHandle}
 */
export function status(scene, spec) {
  const s = spec || /** @type {StatusSpec} */ ({});
  const th = s.theme || look(scene);
  const still = reducedMotion();
  const pace = ms(th.motion, 200);
  const ease = curve(th);
  const depth = num(s.depth, STATUS_DEPTH);
  const store = s.store && typeof s.store.get === 'function' && typeof s.store.set === 'function' ? s.store : null;
  const lay = Object.assign({ corner: 'left', scale: 1, pad: 14, top: 96 }, s.layout || {});
  const keyboard = s.keys !== false && scene.input && scene.input.keyboard ? scene.input.keyboard : null;
  const pool = motionPool(scene);
  let dead = false;
  let loading = false;
  let lastWritten = '';

  /** @param {any} box */
  function fixed(box) {
    return box.setScrollFactor(0).setDepth(depth);
  }
  const barsBox = fixed(scene.add.container(0, 0));
  const questBox = fixed(scene.add.container(0, 0));
  const coolBox = fixed(scene.add.container(0, 0));
  const invBox = fixed(scene.add.container(0, 0));
  const buffBox = fixed(scene.add.container(0, 0));
  const boxes = [barsBox, questBox, coolBox, invBox, buffBox];

  const ctx = {
    scene: scene, th: th, still: still, pace: pace, pool: pool,
    alive: function () { return !dead; },
    persist: function () { return persist(); },
  };

  /* ── Bars ──────────────────────────────────────────────────────────────────────────────── */

  /** @type {Array<{ id: string, spec: BarSpec, max: number, value: number, tone: number,
   *   shown: { p: number }, fill: any, flash: any, figure: any }>} */
  const barRows = [];
  const barX = (s.bars || []).some(function (b) { return !!(b && b.icon); }) ? 22 : 0;

  function drawFill(row) {
    const w = Math.round(BAR_W * Math.max(0, Math.min(1, row.shown.p)));
    row.fill.clear();
    if (w < 1) return;
    row.fill.fillStyle(row.tone, 1);
    row.fill.fillRoundedRect(0, 0, w, BAR_H, Math.min(BAR_H / 2, w / 2));
  }

  function barFigure(row) {
    row.figure.setText(Math.round(row.value) + ' / ' + Math.round(row.max));
  }

  /** @param {BarSpec} b @param {number} i */
  function buildBar(b, i) {
    const tone = toneColour(th, b.tone, th.accent);
    const box = scene.add.container(0, i * BAR_ROW);
    const label = scene.add.text(barX, 0, b.label != null ? String(b.label) : b.id, {
      fontFamily: th.fontMono, fontSize: '12px', color: cssColour(th.inkDim),
    }).setOrigin(0, 0);
    const figure = scene.add.text(barX + BAR_W, 0, '', {
      fontFamily: th.fontMono, fontSize: '12px', color: cssColour(th.ink),
    }).setOrigin(1, 0);
    const back = scene.add.graphics().setPosition(barX, 16);
    back.fillStyle(th.surface, 0.9);
    back.fillRoundedRect(0, 0, BAR_W, BAR_H, BAR_H / 2);
    back.lineStyle(1, th.line, 1);
    back.strokeRoundedRect(0, 0, BAR_W, BAR_H, BAR_H / 2);
    const fill = scene.add.graphics().setPosition(barX, 16);
    const flash = scene.add.graphics().setPosition(barX, 16).setAlpha(0);
    flash.fillStyle(th.ink, 1);
    flash.fillRoundedRect(0, 0, BAR_W, BAR_H, BAR_H / 2);
    box.add([label, figure, back, fill, flash]);
    if (b.icon) box.add(glyph(scene, th, b.icon, 18, tone).setPosition(9, 21));
    barsBox.add(box);
    const max = Math.max(1, num(b.max, 100));
    const value = Math.max(0, Math.min(max, num(b.value, max)));
    const row = { id: b.id, spec: b, max: max, value: value, tone: tone, shown: { p: value / max },
      fill: fill, flash: flash, figure: figure };
    barRows.push(row);
    drawFill(row);
    barFigure(row);
  }
  (s.bars || []).forEach(function (b, i) { if (b && b.id) buildBar(b, i); });

  function barOf(id) {
    for (const row of barRows) if (row.id === id) return row;
    return null;
  }

  /** One short tint over the bar: the game answering a hit. Kept under less motion, once. */
  function blink(row) {
    pool.stop(row.flash);
    row.flash.setAlpha(0.6);
    pool.run({ targets: row.flash, alpha: 0, duration: Math.max(80, pace * 1.2), ease: 'Quad.easeOut' });
  }

  /** The counted pulse a bar gives as it falls into its low zone. */
  function pulse(row) {
    if (still) return;
    pool.stop(row.fill);
    row.fill.setAlpha(1);
    pool.run({
      targets: row.fill, alpha: 0.35, duration: pace, yoyo: true, repeat: LOW_PULSES - 1,
      onComplete: function () { row.fill.setAlpha(1); },
    });
  }

  /** Move the fill from where it was to where the value now is. */
  function moveBar(row, prev, next) {
    const target = next / row.max;
    const low = num(row.spec.low, LOW_SHARE);
    const wentLow = target <= low && prev / row.max > low;
    pool.stop(row.shown);
    if (next < prev) blink(row);
    if (still || prev === next) {
      row.shown.p = target;
      drawFill(row);
      return;
    }
    pool.run({
      targets: row.shown, p: target, duration: next < prev ? pace * 1.5 : pace * 2, ease: ease,
      onUpdate: function () { drawFill(row); },
      onComplete: function () { drawFill(row); },
    });
    if (wentLow) pulse(row);
  }

  const bars = {
    /** Put a bar at a value, clamped to 0..max. Returns what landed, or null for an unknown id. */
    set(id, value) {
      const row = barOf(id);
      if (!row || dead) return null;
      const next = Math.max(0, Math.min(row.max, num(value, 0)));
      const prev = row.value;
      row.value = next;
      barFigure(row);
      moveBar(row, prev, next);
      persist();
      return next;
    },
    /** Read the maximum with one argument, or change it with two. The value is clamped to it. */
    max(id, n) {
      const row = barOf(id);
      if (!row || dead) return null;
      if (typeof n === 'number' && isFinite(n) && n > 0) {
        row.max = n;
        if (row.value > n) row.value = n;
        pool.stop(row.shown);
        row.shown.p = row.value / row.max;
        drawFill(row);
        barFigure(row);
        persist();
      }
      return row.max;
    },
    get(id) {
      const row = barOf(id);
      return row ? { value: row.value, max: row.max, share: row.value / row.max } : null;
    },
  };

  /* ── The departments from status-parts.js ──────────────────────────────────────────────── */

  const rings = cooldownRings(ctx, coolBox, s.cooldowns || []);
  const chips = buffChips(ctx, buffBox);
  const quests = questLog(ctx, questBox, (s.quest && s.quest.label) || 'Quests');

  /* ── Inventory ─────────────────────────────────────────────────────────────────────────── */

  const slotCount = Math.max(0, Math.floor(num(typeof s.inventory === 'number'
    ? s.inventory : (s.inventory && s.inventory.slots), 0)));
  /** @type {Array<{ box: any, back: any, face: any, count: any, item: SlotItem|null }>} */
  const slots = [];
  let selectedAt = -1;
  const nameText = scene.add.text(0, -SLOT_LIFT - 6, '', {
    fontFamily: th.fontMono, fontSize: '11px', color: cssColour(th.inkDim),
  }).setOrigin(0.5, 1);
  invBox.add(nameText);

  function drawSlotBack(slot, on) {
    slot.back.clear();
    slot.back.fillStyle(th.surface, on ? 0.98 : 0.9);
    slot.back.fillRoundedRect(0, 0, SLOT, SLOT, 8);
    slot.back.lineStyle(on ? 2 : 1, on ? th.accent : th.line, 1);
    slot.back.strokeRoundedRect(0, 0, SLOT, SLOT, 8);
  }

  for (let i = 0; i < slotCount; i++) {
    const box = scene.add.container(i * (SLOT + SLOT_GAP), 0);
    const back = scene.add.graphics();
    const hit = scene.add.rectangle(SLOT / 2, SLOT / 2, SLOT, SLOT).setOrigin(0.5, 0.5);
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerdown', function () { inventory.select(i); });
    const digit = scene.add.text(4, 2, i < DIGIT_KEYS.length ? String(i + 1) : '', {
      fontFamily: th.fontMono, fontSize: '10px', color: cssColour(th.inkDim),
    }).setOrigin(0, 0);
    const count = scene.add.text(SLOT - 4, SLOT - 3, '', {
      fontFamily: th.fontMono, fontSize: '11px', color: cssColour(th.ink),
    }).setOrigin(1, 1);
    box.add([back, hit, digit, count]);
    invBox.add(box);
    const slot = { box: box, back: back, face: null, count: count, item: null };
    slots.push(slot);
    drawSlotBack(slot, false);
  }

  /** @param {SlotItem|null} item */
  function fillSlot(slot, item) {
    if (slot.face) {
      slot.face.destroy();
      slot.face = null;
    }
    slot.item = item;
    if (!item) {
      slot.count.setText('');
      return;
    }
    const what = item.key != null ? item.key : (item.icon != null ? item.icon : String(item.label || '').charAt(0));
    slot.face = glyph(scene, th, what, SLOT - 14, th.ink).setPosition(SLOT / 2, SLOT / 2);
    slot.box.addAt(slot.face, 2);
    slot.count.setText(num(item.count, 0) > 1 ? String(Math.round(item.count)) : '');
  }

  function lift(slot, y) {
    pool.stop(slot.box);
    if (still) {
      slot.box.y = y;
      return;
    }
    pool.run({ targets: slot.box, y: y, duration: Math.max(60, pace * 0.7), ease: ease });
  }

  /** The four fields an item may carry, and only the ones it does: the record stays clean. */
  function cleanItem(item) {
    /** @type {SlotItem} */
    const out = {};
    for (const k of ['key', 'icon', 'count', 'label']) if (item[k] !== undefined) out[k] = item[k];
    return out;
  }

  const inventory = {
    /** Put an item in a slot, or null to empty it. */
    setSlot(i, item) {
      const slot = slots[i];
      if (!slot || dead) return false;
      fillSlot(slot, item && typeof item === 'object' ? cleanItem(item) : null);
      if (i === selectedAt) nameText.setText(item && item.label ? String(item.label) : '');
      persist();
      return true;
    },
    /** Choose a slot; anything out of range chooses none. Returns the chosen index. */
    select(i) {
      if (dead) return selectedAt;
      const want = typeof i === 'number' && slots[i] ? i : -1;
      if (want === selectedAt) return selectedAt;
      const prev = slots[selectedAt];
      selectedAt = want;
      if (prev) {
        drawSlotBack(prev, false);
        lift(prev, 0);
      }
      const now = slots[want];
      if (now) {
        drawSlotBack(now, true);
        lift(now, -SLOT_LIFT);
        nameText.setX(now.box.x + SLOT / 2);
      }
      nameText.setText(now && now.item && now.item.label ? String(now.item.label) : '');
      persist();
      return selectedAt;
    },
    selected() {
      return selectedAt;
    },
    get(i) {
      const slot = slots[i];
      return slot && slot.item ? Object.assign({}, slot.item) : null;
    },
    /** Empty one slot, or every slot with no argument. */
    clear(i) {
      if (dead) return;
      if (typeof i === 'number') {
        if (slots[i]) fillSlot(slots[i], null);
      } else {
        for (const slot of slots) fillSlot(slot, null);
      }
      if (i === undefined || i === selectedAt) nameText.setText('');
      persist();
    },
  };

  /** @type {Array<{ name: string, fn: () => void }>} */
  const keyHandlers = [];
  if (keyboard) {
    for (let i = 0; i < Math.min(slots.length, DIGIT_KEYS.length); i++) {
      const fn = function () { inventory.select(i); };
      keyboard.on('keydown-' + DIGIT_KEYS[i], fn);
      keyHandlers.push({ name: 'keydown-' + DIGIT_KEYS[i], fn: fn });
    }
  }

  /* ── Layout, the store, the end ────────────────────────────────────────────────────────── */

  function place() {
    if (dead) return;
    const W = scene.scale.width;
    const H = scene.scale.height;
    const k = Math.max(0.25, num(lay.scale, 1));
    const pad = num(lay.pad, 14);
    const top = num(lay.top, 96);
    const left = lay.corner !== 'right';
    const colX = left ? pad : W - pad - (barX + BAR_W) * k;
    barsBox.setScale(k).setPosition(colX, top);
    questBox.setScale(k).setPosition(colX, top + barRows.length * (BAR_ROW * k) + (barRows.length ? 8 : 0));
    coolBox.setScale(k).setPosition(left ? pad : W - pad - rings.width * k, H - pad - rings.height * k);
    const rowW = slots.length ? (slots.length * (SLOT + SLOT_GAP) - SLOT_GAP) * k : 0;
    invBox.setScale(k).setPosition(Math.round((W - rowW) / 2), H - pad - SLOT * k);
    buffBox.setScale(k).setPosition(left ? W - pad : pad, H - pad);
    chips.align(left);
  }

  /** The section as it stands: what persist() writes and what load() reads back. */
  function section() {
    /** @type {{ bars: Record<string, { value: number, max: number }>,
     *   inventory: { slots: Array<SlotItem|null>, selected: number }, quests: QuestRecord[] }} */
    const out = { bars: {}, inventory: { slots: [], selected: selectedAt }, quests: quests.records() };
    for (const row of barRows) out.bars[row.id] = { value: row.value, max: row.max };
    for (const slot of slots) out.inventory.slots.push(slot.item ? Object.assign({}, slot.item) : null);
    return out;
  }

  function persist() {
    if (!store || dead || loading) return Promise.resolve();
    const sec = section();
    lastWritten = JSON.stringify(sec);
    store.set({ status: sec });
    return typeof store.save === 'function' ? store.save() : Promise.resolve();
  }

  function load() {
    if (!store) return false;
    const state = store.get();
    const sec = state && state.status && typeof state.status === 'object' ? state.status : null;
    if (!sec) return false;
    loading = true;
    try {
      const saved = sec.bars && typeof sec.bars === 'object' ? sec.bars : {};
      for (const row of barRows) {
        const b = saved[row.id];
        if (!b || typeof b !== 'object') continue;
        if (typeof b.max === 'number' && b.max > 0) row.max = b.max;
        row.value = Math.max(0, Math.min(row.max, num(b.value, row.value)));
        pool.stop(row.shown);
        row.shown.p = row.value / row.max;
        drawFill(row);
        barFigure(row);
      }
      const inv = sec.inventory && typeof sec.inventory === 'object' ? sec.inventory : {};
      const list = Array.isArray(inv.slots) ? inv.slots : [];
      inventory.select(-1);
      slots.forEach(function (slot, i) { fillSlot(slot, list[i] && typeof list[i] === 'object' ? list[i] : null); });
      inventory.select(typeof inv.selected === 'number' ? inv.selected : -1);
      quests.replace(sec.quests);
      lastWritten = JSON.stringify(section());
    } finally {
      loading = false;
    }
    return true;
  }

  // The store's own changes come back here: the load after sign-in, or another handle's write.
  // What this handle wrote itself is recognised by its fingerprint and left alone.
  const unhook = store && typeof store.onChange === 'function' ? store.onChange(function (state) {
    if (dead || loading) return;
    const sec = state && state.status;
    if (!sec || typeof sec !== 'object' || JSON.stringify(sec) === lastWritten) return;
    load();
  }) : null;

  function show() {
    for (const box of boxes) box.setVisible(true);
  }

  function hide() {
    for (const box of boxes) box.setVisible(false);
  }

  function destroy() {
    if (dead) return;
    dead = true;
    scene.events.off('shutdown', destroy);
    scene.events.off('destroy', destroy);
    if (scene.scale && typeof scene.scale.off === 'function') scene.scale.off('resize', place);
    if (keyboard) for (const h of keyHandlers) keyboard.off(h.name, h.fn);
    if (unhook) unhook();
    pool.killAll();
    for (const box of boxes) box.destroy(true);
  }

  if (scene.scale && typeof scene.scale.on === 'function') scene.scale.on('resize', place);
  scene.events.once('shutdown', destroy);
  scene.events.once('destroy', destroy);
  place();
  if (store) load();

  return {
    bars: bars,
    cooldowns: rings.api,
    inventory: inventory,
    quest: quests.api,
    buffs: chips.api,
    /** Change the corner, the scale or the insets; returns the layout in force. */
    layout(patch) {
      if (patch && typeof patch === 'object') Object.assign(lay, patch);
      place();
      return Object.assign({}, lay);
    },
    load: load,
    persist: persist,
    show: show,
    hide: hide,
    destroy: destroy,
  };
}
