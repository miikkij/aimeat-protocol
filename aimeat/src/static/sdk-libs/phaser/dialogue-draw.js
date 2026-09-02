/**
 * @file phaser/dialogue-draw.js
 * @description The dialogue box as a picture. dialogue.js decides what the box says and when the
 *   player has read it; this file decides where every part sits and what colour it is, so the
 *   state machine never touches a coordinate and the drawing never touches a promise. One panel
 *   is built per dialogue handle and redrawn for each line: the plate, the speaker tab on its top
 *   edge, the portrait (a texture, or a disc with the speaker's initial), the body text, the mark
 *   in the corner that says "more" or "next", and the rows a question offers.
 *
 *   EVERY COLOUR IS A TOKEN. Surface, ink, line and accent come from the theme handle boot.js
 *   read off the page, and a speaker's tone is one of the theme's own tone words (accent, ok,
 *   warn, err, ch1 to ch4) or a number the app already holds. Nothing in here names a colour.
 *
 *   IT RIDES THE CAMERA. One container at scroll factor 0, at a depth above the HUD and under its
 *   toast. Every interactive part carries its own scroll factor 0 as well: Phaser 4 multiplies a
 *   child's scroll factor by its container's when it draws, but tests a pointer against the
 *   child's own, so a plate left at 1 would render in the right place and take taps from the
 *   wrong one once the level had scrolled under it.
 *
 *   THE HIT AREA IS A PLAIN OBJECT. A Graphics object has no size Phaser can read, so the plate is
 *   made interactive with a rectangle written as { x, y, width, height } and a contains callback,
 *   handed over as { hitArea, hitAreaCallback }: that form needs no Phaser global, and the same
 *   object is resized in place when the box changes shape.
 *
 *   THE INITIAL CHOOSES ITS OWN INK. A disc in a channel colour can be a bright yellow on a light
 *   page or a deep teal on a dark one, so the letter on it takes whichever of ink, surface and bg
 *   sits furthest from the disc's luminance rather than assuming ink is always readable.
 *
 *   ONE FINITE MOTION EACH WAY. The box arrives with one short rise and leaves with one; under
 *   less motion both are a cut. Nothing here animates while a line waits to be read.
 * @structure DIALOGUE_DEPTH · MARGIN · tone() · inkOn() · inRect() · panel(scene, th, spec, hooks)
 *   returning root / lines / wrap / speaker / text / layout / relayout / mark / rows / select /
 *   show / destroy
 * @usage
 *   const view = panel(scene, th, { position: 'bottom', lines: 3 }, { plate: advance, row: onRow });
 *   view.speaker({ name: 'Guide', tone: 'accent', initial: 'G' }); view.layout(0); view.show(true);
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the drawing half of the dialogue box, split out of dialogue.js.
 */
import { cssColour, channels } from './tokens.js';

/**
 * Above the HUD (900 in hud.js) and under its toast (950), so a passing message still wins over a
 * conversation. The cutscene's fade cover sits just under this and its skip ring just over it.
 */
export const DIALOGUE_DEPTH = 940;

/** The box's distance from the camera edge. The cutscene's skip ring keeps the same margin. */
export const MARGIN = 16;

/** The inner padding, and the width past which a speech box reads as a banner. */
const PAD = 16;
const MAX_WIDTH = 760;

/** The portrait square, the speaker tab's height, one answer row, the corner mark's half-size. */
const PORTRAIT = 56;
const TAB_H = 26;
const ROW_H = 30;
const MARK = 8;

/** The gap between the last text line and the first answer row, and the box's travel in and out. */
const ROWS_GAP = 10;
const RISE = 10;

/** The tone words a speaker or a line may name, each one a theme colour. */
const TONES = { accent: 1, ok: 1, warn: 1, err: 1, ch1: 1, ch2: 1, ch3: 1, ch4: 1, ink: 1, inkDim: 1 };

/**
 * A tone word, or a colour number, as a theme colour.
 * @param {any} th  the theme handle
 * @param {any} want
 * @param {number} fallback
 * @returns {number}
 */
export function tone(th, want, fallback) {
  if (typeof want === 'number' && isFinite(want)) return want;
  if (typeof want === 'string' && TONES[want] && typeof th[want] === 'number') return th[want];
  return fallback;
}

/**
 * How light a colour is, 0 to 1.
 * @param {number} colour
 * @returns {number}
 */
function luminance(colour) {
  const c = channels(colour);
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

/**
 * The theme colour that reads best on top of another: whichever of ink, surface and bg is
 * furthest from it in luminance.
 * @param {any} th
 * @param {number} colour
 * @returns {number}
 */
export function inkOn(th, colour) {
  const l = luminance(colour);
  let best = th.ink;
  let gap = -1;
  for (const candidate of [th.ink, th.surface, th.bg]) {
    const d = Math.abs(luminance(candidate) - l);
    if (d > gap) {
      gap = d;
      best = candidate;
    }
  }
  return best;
}

/**
 * Is a local point inside a plain rectangle? The hit-area callback Phaser is handed for a
 * Graphics object, which has no size of its own.
 * @param {{ x: number, y: number, width: number, height: number }} area
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function inRect(area, x, y) {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

/**
 * @typedef {object} PanelSpec
 * @property {'bottom'|'top'} [position]
 * @property {number} [depth]
 * @property {number} [fontSize]   the body face size. Default 18.
 * @property {number} [lines]      lines per page. Default 3.
 * @property {boolean} [portrait]  whether the portrait column exists at all. Default true.
 * @property {boolean} [still]     less motion: arrivals are cuts
 * @property {number} [pace]       the look's pace in milliseconds
 * @property {string} [ease]       a Phaser ease name
 */

/**
 * @typedef {object} SpeakerLook
 * @property {string} [name]
 * @property {string|number} [tone]
 * @property {string} [texture]    a texture key for the portrait
 * @property {string} [initial]    the letter on the placeholder disc
 * @property {boolean} [portrait]  false hides the portrait for this speaker
 */

/**
 * The box, built once and redrawn per line.
 *
 * @param {any} scene
 * @param {any} th  the theme handle
 * @param {PanelSpec} spec
 * @param {{ plate?: () => void, row?: (index: number, kind: 'over'|'down') => void }} hooks
 *   what a tap on the plate and a pointer on an answer row do
 * @returns {{
 *   root: any,
 *   lines: number,
 *   wrap: (text: string) => string[],
 *   speaker: (look: SpeakerLook) => void,
 *   text: (str: string) => void,
 *   layout: (rowCount: number) => void,
 *   relayout: () => void,
 *   mark: (kind: 'more'|'next'|null) => void,
 *   rows: (labels: string[]) => void,
 *   select: (i: number) => number,
 *   show: (on: boolean, done?: () => void) => void,
 *   destroy: () => void,
 * }}
 */
export function panel(scene, th, spec, hooks) {
  const s = spec || /** @type {PanelSpec} */ ({});
  const h = hooks || {};
  const fs = typeof s.fontSize === 'number' ? s.fontSize : 18;
  const lineH = Math.round(fs * 1.4);
  const lines = Math.max(1, Math.round(typeof s.lines === 'number' ? s.lines : 3));
  const atTop = s.position === 'top';
  const depth = typeof s.depth === 'number' ? s.depth : DIALOGUE_DEPTH;
  const column = s.portrait !== false;
  const still = !!s.still;
  const pace = typeof s.pace === 'number' ? s.pace : 200;
  const ease = s.ease || 'Cubic.easeOut';
  const display = th.fontDisplay || th.font;

  const root = scene.add.container(0, 0).setScrollFactor(0).setDepth(depth);
  root.setVisible(false);
  root.setAlpha(0);

  const area = { x: 0, y: 0, width: 10, height: 10 };
  const plate = scene.add.graphics().setScrollFactor(0);
  plate.setInteractive({ hitArea: area, hitAreaCallback: inRect, useHandCursor: true });
  plate.on('pointerdown', function () { if (typeof h.plate === 'function') h.plate(); });

  const tab = scene.add.graphics().setScrollFactor(0);
  const name = scene.add.text(0, 0, '', {
    fontFamily: display, fontSize: '15px', color: cssColour(th.ink),
  }).setOrigin(0, 0.5);
  const disc = scene.add.graphics().setScrollFactor(0);
  const initial = scene.add.text(0, 0, '', {
    fontFamily: display, fontSize: Math.round(PORTRAIT * 0.46) + 'px', color: cssColour(th.ink),
  }).setOrigin(0.5, 0.5);
  const body = scene.add.text(0, 0, '', {
    fontFamily: th.font, fontSize: fs + 'px', color: cssColour(th.ink),
    wordWrap: { width: MAX_WIDTH, useAdvancedWrap: true },
  }).setOrigin(0, 0);
  const mark = scene.add.graphics().setScrollFactor(0);
  const bar = scene.add.rectangle(0, 0, 3, ROW_H - 10, th.accent).setOrigin(0, 0).setScrollFactor(0);
  bar.setVisible(false);
  root.add([plate, tab, name, disc, initial, body, mark, bar]);

  /** @type {any} the texture portrait, made the first time a speaker brings one */
  let image = null;
  let hasPortrait = column;
  let toneNow = th.accent;
  /** @type {Array<{ rect: any, label: any }>} */
  let rowList = [];
  let selected = 0;
  /** @type {'more'|'next'|null} */
  let markKind = null;
  let gone = false;
  let geo = measure(0);

  /**
   * Where everything goes for a box with this many answer rows.
   * @param {number} rowCount
   */
  function measure(rowCount) {
    const camW = scene.scale.width;
    const camH = scene.scale.height;
    const w = Math.max(160, Math.min(MAX_WIDTH, camW - MARGIN * 2));
    const portraitW = hasPortrait ? PORTRAIT + PAD : 0;
    const textH = Math.max(hasPortrait ? PORTRAIT : 0, lines * lineH);
    const rowsH = rowCount > 0 ? ROWS_GAP + rowCount * ROW_H : 0;
    const boxH = PAD + textH + rowsH + PAD;
    return {
      x: Math.round((camW - w) / 2),
      y: atTop ? MARGIN + TAB_H : Math.max(TAB_H, camH - MARGIN - boxH),
      w: w,
      h: boxH,
      bodyLeft: PAD + portraitW,
      bodyWidth: w - PAD - portraitW - PAD - MARK * 2 - 4,
      rowsTop: PAD + textH + ROWS_GAP,
      rows: rowCount,
    };
  }

  /** Redraw the plate and the tab, and put every part where the geometry says. */
  function layout(rowCount) {
    if (gone) return;
    geo = measure(rowCount);
    root.setPosition(geo.x, geo.y);

    plate.clear();
    plate.fillStyle(th.surface, 0.96);
    plate.fillRoundedRect(0, 0, geo.w, geo.h, 10);
    plate.lineStyle(1, th.line, 1);
    plate.strokeRoundedRect(0, 0, geo.w, geo.h, 10);
    area.width = geo.w;
    area.height = geo.h;

    // The tab sits on the top edge, drawn after the plate so it covers the border under it.
    tab.clear();
    if (name.text) {
      const tabW = Math.ceil(name.width) + 24;
      const corners = { tl: 8, tr: 8, bl: 0, br: 0 };
      tab.fillStyle(th.surface, 1);
      tab.fillRoundedRect(PAD, 1 - TAB_H, tabW, TAB_H, corners);
      tab.lineStyle(1, toneNow, 1);
      tab.strokeRoundedRect(PAD, 1 - TAB_H, tabW, TAB_H, corners);
    }
    name.setPosition(PAD + 12, 1 - TAB_H / 2);

    const px = PAD + PORTRAIT / 2;
    const py = PAD + PORTRAIT / 2;
    disc.setPosition(px, py);
    initial.setPosition(px, py);
    if (image) image.setPosition(px, py);

    body.setPosition(geo.bodyLeft, PAD);
    body.setWordWrapWidth(geo.bodyWidth, true);

    for (let i = 0; i < rowList.length; i += 1) {
      const row = rowList[i];
      const top = geo.rowsTop + i * ROW_H;
      row.rect.setPosition(PAD, top);
      row.rect.setSize(geo.w - PAD * 2, ROW_H);
      row.label.setPosition(PAD + 22, top + ROW_H / 2);
    }
    placeBar();
    drawMark();
  }

  /** The bar beside the selected answer, or nothing when there are no answers. */
  function placeBar() {
    if (!rowList.length || selected < 0 || selected >= rowList.length) {
      bar.setVisible(false);
      return;
    }
    bar.setVisible(true);
    bar.setPosition(PAD + 8, geo.rowsTop + selected * ROW_H + 5);
  }

  /** The corner mark: a triangle pointing down for "more", right for "next", nothing otherwise. */
  function drawMark() {
    mark.clear();
    if (!markKind) return;
    const cx = geo.w - PAD - MARK;
    const cy = geo.h - PAD - MARK + 2;
    mark.fillStyle(th.accent, 1);
    if (markKind === 'more') {
      mark.fillTriangle(cx - MARK, cy - MARK / 2, cx + MARK, cy - MARK / 2, cx, cy + MARK / 2);
    } else {
      mark.fillTriangle(cx - MARK / 2, cy - MARK, cx - MARK / 2, cy + MARK, cx + MARK / 2, cy);
    }
  }

  /**
   * Dress the box for a speaker: the name on the tab, the tone on its edge, and the portrait as a
   * texture when the key exists or as a disc with the initial when it does not.
   * @param {SpeakerLook} look
   */
  function speaker(look) {
    const sp = look || /** @type {SpeakerLook} */ ({});
    toneNow = tone(th, sp.tone, th.accent);
    name.setText(sp.name == null ? '' : String(sp.name));
    hasPortrait = column && sp.portrait !== false;
    disc.clear();
    initial.setText('');
    if (image) image.setVisible(false);
    if (!hasPortrait) return;
    const key = typeof sp.texture === 'string' ? sp.texture : '';
    const known = key && scene.textures && typeof scene.textures.exists === 'function' && scene.textures.exists(key);
    if (known) {
      if (!image) {
        image = scene.add.image(0, 0, key).setScrollFactor(0);
        root.add(image);
      } else {
        image.setTexture(key);
      }
      image.setVisible(true);
      image.setDisplaySize(PORTRAIT, PORTRAIT);
      return;
    }
    disc.fillStyle(toneNow, 1);
    disc.fillCircle(0, 0, PORTRAIT / 2);
    initial.setText(String(sp.initial || sp.name || '?').charAt(0).toUpperCase());
    initial.setColor(cssColour(inkOn(th, toneNow)));
  }

  /**
   * The answer rows. Each row is a plate the pointer can find and a label; the old rows go first.
   * @param {string[]} labels
   */
  function rows(labels) {
    for (const row of rowList) {
      row.rect.destroy();
      row.label.destroy();
    }
    rowList = [];
    selected = 0;
    const list = Array.isArray(labels) ? labels : [];
    // Measured before the rows are made, so each plate is born at its real size and the hit area
    // Phaser derives from it is right without a second pass.
    geo = measure(list.length);
    for (let i = 0; i < list.length; i += 1) {
      const top = geo.rowsTop + i * ROW_H;
      const rect = scene.add.rectangle(PAD, top, geo.w - PAD * 2, ROW_H, th.surface, 1)
        .setOrigin(0, 0).setScrollFactor(0);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerover', onRow(i, 'over'));
      rect.on('pointerdown', onRow(i, 'down'));
      const label = scene.add.text(PAD + 22, top + ROW_H / 2, String(list[i]), {
        fontFamily: th.font, fontSize: Math.round(fs * 0.94) + 'px', color: cssColour(th.ink),
      }).setOrigin(0, 0.5);
      root.add([rect, label]);
      rowList.push({ rect: rect, label: label });
    }
    layout(list.length);
    select(0);
  }

  /**
   * @param {number} i
   * @param {'over'|'down'} kind
   * @returns {() => void}
   */
  function onRow(i, kind) {
    return function () { if (typeof h.row === 'function') h.row(i, kind); };
  }

  /**
   * Put the cursor on an answer. Out of range wraps, so a pad never dead-ends at the last row.
   * @param {number} i
   * @returns {number} the row now selected
   */
  function select(i) {
    const n = rowList.length;
    if (!n) {
      selected = 0;
      placeBar();
      return 0;
    }
    selected = ((Math.round(i) % n) + n) % n;
    for (let k = 0; k < n; k += 1) {
      const on = k === selected;
      rowList[k].rect.setFillStyle(on ? th.accent : th.surface, on ? 0.14 : 1);
      rowList[k].label.setColor(cssColour(on ? th.accent : th.ink));
    }
    placeBar();
    return selected;
  }

  /**
   * Bring the box in or take it away: one short rise each way, a cut under less motion.
   * @param {boolean} on
   * @param {() => void} [done]
   */
  function show(on, done) {
    if (gone) return;
    if (scene.tweens) scene.tweens.killTweensOf(root);
    const home = geo.y;
    if (on) {
      root.setVisible(true);
      if (still) {
        root.setAlpha(1);
        root.y = home;
        if (done) done();
        return;
      }
      root.setAlpha(0);
      root.y = home + RISE;
      scene.tweens.add({
        targets: root, alpha: 1, y: home, duration: Math.round(pace * 0.8), ease: ease,
        onComplete: function () { if (done) done(); },
      });
      return;
    }
    if (still) {
      root.setAlpha(0);
      root.setVisible(false);
      if (done) done();
      return;
    }
    scene.tweens.add({
      targets: root, alpha: 0, y: home + RISE, duration: Math.round(pace * 0.6), ease: ease,
      onComplete: function () {
        root.setVisible(false);
        root.y = home;
        if (done) done();
      },
    });
  }

  return {
    root: root,
    lines: lines,

    /**
     * The text as the body will break it, one string per line, at the width the box has now.
     * @param {string} text
     * @returns {string[]}
     */
    wrap(text) {
      const str = text == null ? '' : String(text);
      if (typeof body.getWrappedText !== 'function') return str.split('\n');
      return body.getWrappedText(str);
    },

    speaker: speaker,

    /** @param {string} str */
    text(str) { body.setText(str == null ? '' : String(str)); },

    layout: layout,

    /** The same geometry again, after the camera changed size. */
    relayout() { layout(geo.rows); },

    /** @param {'more'|'next'|null} kind */
    mark(kind) {
      markKind = kind === 'more' || kind === 'next' ? kind : null;
      drawMark();
    },

    rows: rows,
    select: select,
    show: show,

    destroy() {
      if (gone) return;
      gone = true;
      if (scene.tweens) scene.tweens.killTweensOf(root);
      rowList = [];
      root.destroy();
    },
  };
}
