/**
 * @file phaser/editor.js
 * @description The level editor: the ASCII map format level.js plays, painted on a grid instead of
 *   counted out by hand in a source file.
 *
 *   THE MAP STAYS THE FORMAT. The editor paints into the same rows parseMap() reads, and the text
 *   view under the grid IS those rows, live and editable in both directions. So a level leaves as
 *   `['...', '...']`, which is what platformer() has always taken, a level typed into a source file
 *   opens here untouched, and there is no project file and nothing to import.
 *
 *   THE GRID IS A CANVAS, THE CONTROLS ARE DOM. A 60 x 30 map is 1800 cells, and 1800 elements with
 *   hover rules is a map that stutters while you drag across it; one canvas paints it in a frame.
 *   The palette, the size fields and the text view stay real controls, because a button a person
 *   can tab to is worth more than a uniform look.
 *
 *   LEVELS ARE ONE RECORD, NEVER ONE KEY EACH. When a store is given, every level a person saves
 *   lives in ONE array under ONE key. The node's budget is 1000 keys per person, so a key per level
 *   is a game that spends someone's whole allowance holding ten screens of text.
 *
 *   NOTHING MOVES ON ITS OWN: no animation at all, so the reduced-motion path and the ordinary path
 *   are the same path and an idle editor repaints zero times.
 * @structure the legend, the paint roles and the pure helpers (clamp · normalizeLegend · blankMap ·
 *   toGrid · colourOf · letterOn · drawCell) · levelEditor(spec) → the editor handle
 * @usage  const ed = AIMEAT.phaser.levelEditor({ target: '#editor', store: saveStore });
 *         play.addEventListener('click', () => start(ed.rows()));
 * @version-history
 *   v1.1.0 — 2026-09-02 — Initial: the painted grid, the palette, bounded undo/redo, the two-way
 *     text view, Copy as JS, and the named levels a store keeps in one key.
 */
import { el, clear, resolve, uid } from '../atelier/dom.js';
import { theme } from './boot.js';

/** A legend entry as an app writes it. @typedef {{ kind: string, label?: string, colour?: string }} LegendEntry */
/** The same entry as the editor keeps it. @typedef {{ char: string, kind: string, label: string, colour?: string }} Mark */
/** One level in a store's array. @typedef {{ id: string, name: string, rows: string[], updated: string }} SavedLevel */

/** The mark that means "nothing here", and the tool that takes a cell back to it. */
const EMPTY = '.';

/** The platformer legend level.js reads, with the words a person picks each mark by. */
const DEFAULT_LEGEND = {
  '#': { kind: 'ground', label: 'Ground' },
  '=': { kind: 'brick', label: 'Brick' },
  '^': { kind: 'spike', label: 'Spike' },
  o: { kind: 'coin', label: 'Coin' },
  E: { kind: 'enemy', label: 'Enemy' },
  P: { kind: 'spawn', label: 'Player start' },
  G: { kind: 'goal', label: 'Goal' },
  '.': { kind: 'empty', label: 'Eraser' },
};

/** A fresh map (room to build in, and something to stand on), how big one cell is drawn when the
 *  app names no size, and the sizes the size control allows. */
const DEFAULT_COLS = 26;
const DEFAULT_ROWS = 12;
const DEFAULT_TILE = 24;
const MIN_SIZE = 2;
const MAX_SIZE = 400;

/** How many states back the editor can go: a session's worth of undo at a bounded cost. */
const HISTORY_MAX = 60;

/** Which theme token draws each kind. The seven platformer kinds mirror level.js's own TINT_ROLE,
 *  so a level looks in the editor the way it looks in play. */
const ROLE = {
  ground: 'line', brick: 'inkDim', spike: 'err', coin: 'warn',
  enemy: 'accent', spawn: 'ch1', goal: 'ok', empty: 'surface',
};

/** Kinds a map holds exactly one of. Painting one takes the other away, because parseMap keeps the
 *  last it finds and a map with two starts is a map with a bug nobody can see. Both are drawn as
 *  their own mark rather than as a shape, which is what AS_LETTER says. */
const UNIQUE = { spawn: true, goal: true };
const AS_LETTER = { spawn: true, goal: true };

/** How faint the cell rules are under the marks. */
const RULE_ALPHA = 0.35;

/** A whole number inside a range, or the fallback. @returns {number} */
function clamp(value, low, high, fallback) {
  const n = Math.floor(Number(value));
  return isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
}

/**
 * The legend as the editor keeps it: the app's entries over the platformer's, every one carrying
 * its own mark and a label. A bare string is read as the kind, the way level.js takes one.
 * @param {Record<string, LegendEntry|string>} [custom] @returns {Record<string, Mark>}
 */
function normalizeLegend(custom) {
  const source = Object.assign({}, DEFAULT_LEGEND, custom || {});
  const out = /** @type {Record<string, Mark>} */ ({});
  for (const char in source) {
    const raw = source[char];
    const entry = typeof raw === 'string' ? { kind: raw, label: '', colour: '' } : (raw || { kind: 'empty' });
    out[char] = {
      char: char, kind: entry.kind || 'empty',
      label: entry.label || entry.kind || char, colour: entry.colour,
    };
  }
  return out;
}

/**
 * The rows a fresh editor starts on: empty, with a floor across the bottom in whatever mark this
 * legend calls ground.
 * @param {number} cols @param {number} rows @param {Record<string, Mark>} legend
 * @returns {string[]}
 */
function blankMap(cols, rows, legend) {
  let floor = EMPTY;
  for (const char in legend) if (legend[char].kind === 'ground') { floor = char; break; }
  const out = [];
  for (let y = 0; y < rows; y += 1) out.push((y === rows - 1 ? floor : EMPTY).repeat(cols));
  return out;
}

/**
 * Rows of text as a rectangular grid of marks. Short rows are filled with the empty mark, and a
 * space is read as empty because level.js reads it that way too.
 * @param {string[]} rows @param {number} [wanted]  the width to hold to, else the widest row
 * @returns {string[][]}
 */
function toGrid(rows, wanted) {
  const lines = Array.isArray(rows) && rows.length ? rows : [''];
  let cols = wanted || 0;
  if (!cols) for (const line of lines) cols = Math.max(cols, String(line == null ? '' : line).length);
  cols = Math.max(1, cols);
  const grid = /** @type {string[][]} */ ([]);
  for (const line of lines) {
    const text = String(line == null ? '' : line);
    const row = /** @type {string[]} */ ([]);
    for (let x = 0; x < cols; x += 1) {
      const char = text.charAt(x);
      row.push(char === '' || char === ' ' ? EMPTY : char);
    }
    grid.push(row);
  }
  return grid;
}

/**
 * The colour one mark is drawn in. An app may name a KIND ('coin') or a token ('ch2', 'accent'),
 * and either resolves through the same theme, so no colour is ever written into a game.
 * @param {Mark} mark @param {Record<string, string>} paint  theme.css()'s token → colour map
 * @returns {string}
 */
function colourOf(mark, paint) {
  const named = mark && mark.colour;
  if (named && ROLE[named] && paint[ROLE[named]]) return paint[ROLE[named]];
  if (named && paint[named]) return paint[named];
  return paint[ROLE[mark ? mark.kind : 'empty']] || paint.ink;
}

/** One character centred in a cell, in whatever colour the caller has set. @returns {void} */
function letterOn(ctx, text, font, px, py, size) {
  ctx.font = Math.round(size * 0.72) + 'px ' + font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + size / 2, py + size * 0.54);
}

/**
 * Paint one mark into a 2D context: the same shapes level.js generates its stand-in textures from,
 * so the palette, the grid and the running game agree. A kind this module has no shape for is a
 * filled square wearing its own mark, which is what level.js assumes of an app's own legend entry.
 * @param {CanvasRenderingContext2D} ctx @param {Mark|null} mark
 * @param {Record<string, string>} paint @param {number} px @param {number} py @param {number} size
 * @returns {void}
 */
function drawCell(ctx, mark, paint, px, py, size) {
  ctx.fillStyle = paint.surface;
  ctx.fillRect(px, py, size, size);
  const kind = mark ? mark.kind : 'empty';
  if (!mark || kind === 'empty') return;
  const mid = size / 2;
  ctx.fillStyle = colourOf(mark, paint);
  if (kind === 'coin') {
    ctx.beginPath();
    ctx.arc(px + mid, py + mid, Math.max(2, size * 0.3), 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'spike') {
    ctx.beginPath();
    ctx.moveTo(px, py + size);
    ctx.lineTo(px + mid, py + size * 0.2);
    ctx.lineTo(px + size, py + size);
    ctx.fill();
  } else if (AS_LETTER[kind]) {
    letterOn(ctx, mark.char, paint.fontMono, px, py, size);
  } else {
    ctx.fillRect(px, py, size, size);
    ctx.fillStyle = paint.surface;
    if (kind === 'brick') {
      ctx.fillRect(px, py + mid - size * 0.04, size, size * 0.08);
      ctx.fillRect(px + mid - size * 0.04, py, size * 0.08, mid);
      ctx.fillRect(px + size * 0.21, py + mid, size * 0.08, mid);
    } else if (kind === 'enemy') {
      const r = Math.max(1, size * 0.09);
      ctx.beginPath();
      ctx.arc(px + size * 0.34, py + size * 0.4, r, 0, Math.PI * 2);
      ctx.arc(px + size * 0.66, py + size * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (!ROLE[kind]) {
      letterOn(ctx, mark.char, paint.fontMono, px, py, size);
    }
  }
}

/**
 * The level editor: a grid painted by hand, the palette that fills it, the text view of the same
 * rows, and the named levels a store keeps.
 *
 * THE APP DECIDES THE KEY. With a `saves()` store the levels go into that store's own record under
 * `levelSet`, which is the one key per player that module already owns; with a plain
 * `{ load, save }` object the app writes them wherever it likes, and the right shape for authored
 * content is ONE key per game (say `<app>.levels`) holding the whole array. Never a key per level.
 *
 * @param {{ target: Element|string, map?: string[],
 *   legend?: Record<string, LegendEntry|string>, tile?: number, tools?: string[],
 *   onChange?: (rows: string[]) => void, store?: any, readOnly?: boolean }} spec
 * @returns {{ el: HTMLElement, rows: () => string[], set: (rows: string[]) => void,
 *   tool: (char: string) => string, undo: () => void, redo: () => void, clear: () => void,
 *   resize: (cols: number, rows: number) => void, play?: never, destroy: () => void }}
 */
export function levelEditor(spec) {
  const s = spec || /** @type {any} */ ({});
  const legend = normalizeLegend(s.legend);
  const tile = clamp(s.tile || DEFAULT_TILE, 8, 96, DEFAULT_TILE);
  const readOnly = !!s.readOnly;
  const store = s.store || null;
  // A saves() store keeps the whole file itself, so it is written through set() + save(); anything
  // else is the app's own pair and is asked directly.
  const useSaves = !!(store && typeof store.set === 'function' && typeof store.save === 'function'
    && typeof store.get === 'function');

  let grid = toGrid(s.map && s.map.length ? s.map : blankMap(DEFAULT_COLS, DEFAULT_ROWS, legend));
  let cols = grid[0].length;
  let rowCount = grid.length;
  /** The maps undo and redo can come back to, the newest last. */
  const past = /** @type {string[][][]} */ ([]);
  const future = /** @type {string[][][]} */ ([]);
  /** The theme, resolved once and kept until the page's colours change under us. */
  let paint = /** @type {Record<string, string>|null} */ (null);
  const cursor = { x: 0, y: 0 };
  let toolChar = offered()[0] || EMPTY;
  let painting = false;
  let strokeDirty = false;
  let strokeBefore = /** @type {string[]|null} */ (null);
  let textBefore = /** @type {string[]|null} */ (null);
  let syncing = false;
  let levels = /** @type {SavedLevel[]} */ ([]);
  let currentId = '';
  let gone = false;

  const root = el('div', { class: 'ak-leveled' + (readOnly ? ' ak-leveled--readonly' : '') });
  resolve(s.target, document.body).appendChild(root);

  const canvas = /** @type {HTMLCanvasElement} */ (el('canvas', {
    class: 'ak-leveled__grid', tabindex: '0',
    'aria-label': 'The level map. Arrow keys move the cursor, space paints, the number keys pick a tool.',
  }));
  const palette = el('div', { class: 'ak-leveled__palette', role: 'group', 'aria-label': 'Tools' });
  const status = el('p', { class: 'ak-leveled__status', role: 'status' });
  const ascii = /** @type {HTMLTextAreaElement} */ (el('textarea', {
    class: 'ak-leveled__ascii', spellcheck: 'false', rows: '8', readonly: readOnly,
    'aria-label': 'The map as text',
  }));
  const nameInput = /** @type {HTMLInputElement} */ (el('input', {
    type: 'text', class: 'ak-input ak-leveled__name', placeholder: 'Level name',
    'aria-label': 'Level name', disabled: readOnly,
  }));
  const picker = /** @type {HTMLSelectElement} */ (el('select', {
    class: 'ak-input ak-leveled__picker', 'aria-label': 'Saved levels',
  }));
  const colsInput = sizeField('Columns', true);
  const rowsInput = sizeField('Rows', false);
  const swatches = /** @type {Array<{ canvas: HTMLCanvasElement, mark: Mark }>} */ ([]);
  const toolButtons = /** @type {HTMLButtonElement[]} */ ([]);
  const toolMarks = /** @type {Mark[]} */ ([]);

  /** One number field of the size control. @returns {HTMLInputElement} */
  function sizeField(label, isCols) {
    const input = /** @type {HTMLInputElement} */ (el('input', {
      type: 'number', class: 'ak-input ak-leveled__size', disabled: readOnly,
      min: String(MIN_SIZE), max: String(MAX_SIZE), 'aria-label': label,
      on: { change: function () {
        const n = clamp(input.value, MIN_SIZE, MAX_SIZE, isCols ? cols : rowCount);
        api.resize(isCols ? n : cols, isCols ? rowCount : n);
      } },
    }));
    return input;
  }

  /** One button, on the kit's own classes so it reads as a button with or without the kit. */
  function button(label, run, needsWrite) {
    return el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
      disabled: !!(needsWrite && readOnly), on: { click: run },
    }, label);
  }

  /** The marks this editor offers, the eraser aside, in the order shown. @returns {string[]} */
  function offered() {
    const asked = Array.isArray(s.tools) && s.tools.length ? s.tools : Object.keys(legend);
    return asked.filter(function (char) { return !!legend[char] && legend[char].kind !== 'empty'; });
  }

  /** Draw the page: the bar, the palette, the grid, the status line, the text view. @returns {void} */
  function build() {
    for (const char of offered()) toolMarks.push(legend[char]);
    toolMarks.push(legend[EMPTY] || { char: EMPTY, kind: 'empty', label: 'Eraser' });
    for (let i = 0; i < toolMarks.length; i += 1) palette.appendChild(toolButton(toolMarks[i], i));

    root.appendChild(el('div', { class: 'ak-leveled__bar' }, [
      el('div', { class: 'ak-leveled__group' }, [
        el('span', { class: 'ak-leveled__legendword', text: 'Size' }), colsInput,
        el('span', { class: 'ak-leveled__times', text: 'x' }), rowsInput,
      ]),
      el('div', { class: 'ak-leveled__group' }, [
        button('Undo', function () { api.undo(); }, true),
        button('Redo', function () { api.redo(); }, true),
        button('Clear', function () { api.clear(); }, true),
        button('Copy as JS', copyAsJs),
      ]),
      store ? el('div', { class: 'ak-leveled__group ak-leveled__group--store' }, [
        nameInput, picker,
        button('Save', function () { void saveLevel(); }, true),
        button('Load', loadLevel),
        button('New', newLevel, true),
        button('Delete', function () { void deleteLevel(); }, true),
      ]) : null,
    ]));
    root.appendChild(el('div', { class: 'ak-leveled__main' }, [
      palette,
      el('div', { class: 'ak-leveled__stage' }, canvas),
    ]));
    root.appendChild(status);
    root.appendChild(ascii);
  }

  /** One tool: its swatch, its word, and the number key that picks it. @returns {HTMLElement} */
  function toolButton(mark, index) {
    const swatch = /** @type {HTMLCanvasElement} */ (el('canvas', {
      class: 'ak-leveled__swatch', width: '24', height: '24', 'aria-hidden': 'true',
    }));
    swatches.push({ canvas: swatch, mark: mark });
    const node = /** @type {HTMLButtonElement} */ (el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost ak-leveled__tool', 'data-ak-noguard': true,
      'aria-pressed': String(mark.char === toolChar), disabled: readOnly,
      title: mark.label + ' (' + mark.char + ')',
      on: { click: function () { api.tool(mark.char); } },
    }, [
      swatch,
      el('span', { class: 'ak-leveled__toolname', text: mark.label }),
      index < 9 ? el('kbd', { class: 'ak-leveled__hint', text: String(index + 1) }) : null,
    ]));
    toolButtons.push(node);
    return node;
  }

  // ── The grid ─────────────────────────────────────────────────────────────────────────────────

  /** The theme's colours, read from the tokens on this editor and kept until they change. */
  function colours() {
    if (!paint) paint = theme.css(root);
    return paint;
  }

  /** The context, already scaled so everything else works in CSS pixels. @returns {CanvasRenderingContext2D|null} */
  function context() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /** Size the canvas to the map. Its CSS size goes to the stylesheet as two custom properties
   *  rather than being written here as style. @returns {void} */
  function sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cols * tile * dpr);
    canvas.height = Math.round(rowCount * tile * dpr);
    canvas.style.setProperty('--akl-w', cols * tile + 'px');
    canvas.style.setProperty('--akl-h', rowCount * tile + 'px');
  }

  /** The rules and the cursor, back over what was just painted: one cell when `box` names one, the
   *  whole map when it does not. @returns {void} */
  function overlay(ctx, p, box) {
    ctx.globalAlpha = RULE_ALPHA;
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1;
    if (box) {
      ctx.strokeRect(box[0] * tile + 0.5, box[1] * tile + 0.5, tile, tile);
    } else {
      ctx.beginPath();
      for (let x = 0; x <= cols; x += 1) { ctx.moveTo(x * tile + 0.5, 0); ctx.lineTo(x * tile + 0.5, rowCount * tile); }
      for (let y = 0; y <= rowCount; y += 1) { ctx.moveTo(0, y * tile + 0.5); ctx.lineTo(cols * tile, y * tile + 0.5); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // The cursor is shown only while the grid has focus, so a mouse user is never asked to wonder
    // what the box means.
    if (document.activeElement !== canvas) return;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(cursor.x * tile + 1, cursor.y * tile + 1, tile - 2, tile - 2);
  }

  /** Repaint every cell, the rules over them, the cursor and the palette swatches. @returns {void} */
  function paintAll() {
    const ctx = context();
    if (!ctx) return;
    const p = colours();
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, cols * tile, rowCount * tile);
    for (let y = 0; y < rowCount; y += 1) {
      for (let x = 0; x < cols; x += 1) drawCell(ctx, legend[grid[y][x]] || null, p, x * tile, y * tile, tile);
    }
    overlay(ctx, p, null);
    for (const item of swatches) {
      const swatchCtx = item.canvas.getContext('2d');
      if (swatchCtx) drawCell(swatchCtx, item.mark, p, 0, 0, item.canvas.width);
    }
  }

  /** Repaint one cell. This is what a drag costs, and it is why the grid is a canvas. @returns {void} */
  function paintOne(x, y) {
    const ctx = context();
    if (!ctx) return;
    const p = colours();
    drawCell(ctx, legend[grid[y][x]] || null, p, x * tile, y * tile, tile);
    overlay(ctx, p, [x, y]);
  }

  /** The cell under a pointer. The stylesheet may scale the canvas, so the measured box decides and
   *  never the backing size. @param {PointerEvent} ev @returns {{ x: number, y: number }|null} */
  function cellAt(ev) {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const x = Math.floor((ev.clientX - box.left) / (box.width / cols));
    const y = Math.floor((ev.clientY - box.top) / (box.height / rowCount));
    return x < 0 || y < 0 || x >= cols || y >= rowCount ? null : { x: x, y: y };
  }

  /** Put one mark in one cell. Says whether anything moved, so dragging across cells that already
   *  hold the tool costs nothing. @returns {boolean} */
  function put(x, y, char) {
    if (grid[y][x] === char) return false;
    const mark = legend[char];
    if (mark && UNIQUE[mark.kind]) {
      for (let yy = 0; yy < rowCount; yy += 1) {
        for (let xx = 0; xx < cols; xx += 1) {
          const other = legend[grid[yy][xx]];
          if (other && other.kind === mark.kind) { grid[yy][xx] = EMPTY; paintOne(xx, yy); }
        }
      }
    }
    grid[y][x] = char;
    paintOne(x, y);
    return true;
  }

  /** @param {PointerEvent} ev @returns {void} */
  function onDown(ev) {
    if (readOnly) return;
    const cell = cellAt(ev);
    if (!cell) return;
    ev.preventDefault();
    canvas.focus();
    try { canvas.setPointerCapture(ev.pointerId); } catch (err) {
      console.warn('[aimeat-phaser] the pointer could not be captured, painting still works:', err);
    }
    painting = true;
    strokeDirty = false;
    strokeBefore = rowsNow();
    cursor.x = cell.x; cursor.y = cell.y;
    if (put(cell.x, cell.y, toolChar)) strokeDirty = true;
  }

  /** @param {PointerEvent} ev @returns {void} */
  function onMove(ev) {
    if (!painting) return;
    const cell = cellAt(ev);
    if (cell && put(cell.x, cell.y, toolChar)) strokeDirty = true;
  }

  /** The stroke is one undo step, however many cells it crossed. @param {PointerEvent} ev @returns {void} */
  function onUp(ev) {
    if (!painting) return;
    painting = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (err) {
      console.warn('[aimeat-phaser] the pointer capture could not be released:', err);
    }
    if (!strokeDirty || !strokeBefore) return;
    commit(strokeBefore);
    strokeBefore = null;
    changed();
  }

  /** @param {KeyboardEvent} ev @returns {void} */
  function onKey(ev) {
    const key = ev.key;
    if (ev.ctrlKey || ev.metaKey) {
      if (key === 'z' || key === 'Z') { ev.preventDefault(); if (ev.shiftKey) api.redo(); else api.undo(); }
      else if (key === 'y' || key === 'Y') { ev.preventDefault(); api.redo(); }
      return;
    }
    if (/^[1-9]$/.test(key)) {
      const mark = toolMarks[Number(key) - 1];
      if (mark) { ev.preventDefault(); api.tool(mark.char); }
      return;
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    if (step) {
      ev.preventDefault();
      cursor.x = Math.max(0, Math.min(cols - 1, cursor.x + step[0]));
      cursor.y = Math.max(0, Math.min(rowCount - 1, cursor.y + step[1]));
      paintAll();
      return;
    }
    if ((key === ' ' || key === 'Enter') && !readOnly) {
      ev.preventDefault();
      const before = rowsNow();
      if (!put(cursor.x, cursor.y, toolChar)) return;
      commit(before);
      changed();
    }
  }

  // ── The rows, the history and the text view ──────────────────────────────────────────────────

  /** The map as it stands. @returns {string[]} */
  function rowsNow() {
    return grid.map(function (row) { return row.join(''); });
  }

  /** The grid changed shape: the canvas, the cursor and the size fields catch up. @returns {void} */
  function relayout() {
    rowCount = grid.length;
    cols = grid[0] ? grid[0].length : 1;
    sizeCanvas();
    cursor.x = Math.min(cursor.x, cols - 1); cursor.y = Math.min(cursor.y, rowCount - 1);
    paintAll();
    colsInput.value = String(cols);
    rowsInput.value = String(rowCount);
  }

  /** Take a grid as the map; the text view follows, and `tell` says whether the app hears about it.
   *  @param {string[][]} next @param {boolean} [tell] @returns {void} */
  function adopt(next, tell) {
    grid = next;
    relayout();
    syncing = true;
    ascii.value = rowsNow().join('\n');
    syncing = false;
    if (tell) changed();
  }

  /** File one state for undo. The oldest goes at the bound, and a new edit closes off redo. */
  function commit(before) {
    past.push(toGrid(before, before[0] ? before[0].length : cols));
    if (past.length > HISTORY_MAX) past.shift();
    future.length = 0;
  }

  /** Tell the app the rows moved. @returns {void} */
  function changed() {
    if (typeof s.onChange !== 'function') return;
    try { s.onChange(rowsNow()); } catch (err) {
      console.warn('[aimeat-phaser] a levelEditor onChange listener threw:', err);
    }
  }

  /** The text view was typed in: the grid follows live, and one focus session is one undo step. */
  function onText() {
    if (syncing || readOnly) return;
    grid = toGrid(ascii.value.split('\n'));
    relayout();
    changed();
  }

  /** The map as the array a source file holds. @returns {string} */
  function asJs() {
    const quoted = rowsNow().map(function (row) {
      return "  '" + row.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    });
    return '[\n' + quoted.join(',\n') + '\n]';
  }

  /** @param {string} words @returns {void} */
  function say(words) {
    status.textContent = words;
  }

  /** Put the array on the clipboard, and say so plainly when the browser will not allow it. */
  function copyAsJs() {
    const clip = navigator.clipboard;
    if (!clip || typeof clip.writeText !== 'function') {
      say('This browser keeps the clipboard closed. The rows are in the text box below.');
      return;
    }
    clip.writeText(asJs()).then(function () {
      say('Copied. Paste it straight into a source file.');
    }, function (err) {
      console.warn('[aimeat-phaser] the clipboard refused the level:', err);
      say('The clipboard refused. The rows are in the text box below.');
    });
  }

  // ── The named levels ─────────────────────────────────────────────────────────────────────────

  /** Read the whole array out of the store and fill the picker. @returns {Promise<void>} */
  async function refreshLevels() {
    try {
      if (useSaves) {
        if (typeof store.load === 'function') await store.load();
        const state = store.get();
        levels = Array.isArray(state && state.levelSet) ? state.levelSet : [];
      } else {
        const list = typeof store.load === 'function' ? await store.load() : [];
        levels = Array.isArray(list) ? list : [];
      }
    } catch (err) {
      console.warn('[aimeat-phaser] the saved levels could not be read:', err);
      say('The saved levels could not be read.');
      return;
    }
    if (!gone) fillPicker();
  }

  /** Write the whole array back, then say how it went: ONE array, ONE key, whichever store this is.
   *  @param {string} done  what to say when it lands @returns {Promise<void>} */
  async function writeLevels(done) {
    try {
      if (useSaves) { store.set({ levelSet: levels }); await store.save(); }
      else if (typeof store.save === 'function') await store.save(levels);
    } catch (err) {
      console.warn('[aimeat-phaser] the levels could not be written:', err);
      say('The levels could not be written to the store.');
      return;
    }
    fillPicker();
    say(done);
  }

  /** @returns {void} */
  function fillPicker() {
    clear(picker);
    picker.appendChild(el('option', { value: '', text: levels.length ? 'Pick a level' : 'Nothing saved yet' }));
    for (const level of levels) {
      picker.appendChild(el('option', { value: level.id, text: level.name || level.id }));
    }
    picker.value = currentId;
  }

  /** The level the picker names. @returns {SavedLevel|null} */
  function picked() {
    const wanted = picker.value;
    return levels.filter(function (level) { return level.id === wanted; })[0] || null;
  }

  /** Keep the level under the name in the field, replacing the one it came from. @returns {Promise<void>} */
  async function saveLevel() {
    const name = nameInput.value.trim() || 'Untitled level';
    const found = levels.filter(function (level) { return level.id === currentId; })[0];
    const record = found || { id: uid('level'), name: name, rows: [], updated: '' };
    record.name = name;
    record.rows = rowsNow();
    record.updated = new Date().toISOString();
    if (!found) levels.push(record);
    currentId = record.id;
    await writeLevels('Saved as "' + name + '".');
  }

  /** Open whatever the picker names. @returns {void} */
  function loadLevel() {
    const found = picked();
    if (!found) { say('Pick a level first.'); return; }
    currentId = found.id;
    nameInput.value = found.name || '';
    commit(rowsNow());
    adopt(toGrid(found.rows || []), true);
    say('Opened "' + (found.name || found.id) + '".');
  }

  /** Start again on an empty map, under no name. @returns {void} */
  function newLevel() {
    currentId = '';
    nameInput.value = '';
    picker.value = '';
    api.clear();
    say('A fresh map. Save it to give it a name.');
  }

  /** Take the picked level out of the array. @returns {Promise<void>} */
  async function deleteLevel() {
    const found = picked();
    if (!found) { say('Pick a level first.'); return; }
    levels = levels.filter(function (level) { return level.id !== found.id; });
    if (currentId === found.id) currentId = '';
    await writeLevels('Deleted "' + (found.name || found.id) + '".');
  }

  // ── Listening ────────────────────────────────────────────────────────────────────────────────

  const redraw = function () { paintAll(); };
  const invalidate = function () { paint = null; paintAll(); };
  const onTextFocus = function () { textBefore = rowsNow(); };
  const onTextChange = function () { if (textBefore) { commit(textBefore); textBefore = null; } };
  const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  /** Everything this editor listens to, written once so destroy() takes back exactly it. */
  const bound = /** @type {Array<[HTMLElement, string, any]>} */ ([
    [canvas, 'pointerdown', onDown], [canvas, 'pointermove', onMove],
    [canvas, 'pointerup', onUp], [canvas, 'pointercancel', onUp],
    [canvas, 'keydown', onKey], [canvas, 'focus', redraw], [canvas, 'blur', redraw],
    [ascii, 'input', onText], [ascii, 'focus', onTextFocus], [ascii, 'change', onTextChange],
  ]);
  for (const [node, type, fn] of bound) node.addEventListener(type, fn);
  if (scheme) scheme.addEventListener('change', invalidate);

  const api = {
    el: root,

    /** The map as it stands, one string per row. @returns {string[]} */
    rows() {
      return rowsNow();
    },

    /** Put a map in the editor. It goes on the undo stack, so a person can come back from it, and
     *  it is NOT reported through onChange: the app asked for it and already knows.
     *  @param {string[]} next @returns {void} */
    set(next) {
      commit(rowsNow());
      adopt(toGrid(Array.isArray(next) && next.length ? next : blankMap(cols, rowCount, legend)), false);
    },

    /** Pick the mark the grid paints; one this editor does not offer leaves the tool where it was.
     *  @param {string} char @returns {string} the mark now in hand */
    tool(char) {
      const wanted = String(char);
      if (toolMarks.filter(function (m) { return m.char === wanted; }).length) toolChar = wanted;
      for (let i = 0; i < toolButtons.length; i += 1) {
        toolButtons[i].setAttribute('aria-pressed', String(toolMarks[i].char === toolChar));
      }
      return toolChar;
    },

    /** Back one state. @returns {void} */
    undo() {
      const previous = past.pop();
      if (!previous) { say('Nothing to undo.'); return; }
      future.push(toGrid(rowsNow(), cols));
      adopt(previous, true);
    },

    /** Forward one state. @returns {void} */
    redo() {
      const next = future.pop();
      if (!next) { say('Nothing to redo.'); return; }
      past.push(toGrid(rowsNow(), cols));
      adopt(next, true);
    },

    /** An empty map of the same size, with its floor back. @returns {void} */
    clear() {
      commit(rowsNow());
      adopt(toGrid(blankMap(cols, rowCount, legend)), true);
    },

    /** Change the map's size: cells outside it are dropped, new ones start empty.
     *  @param {number} nextCols @param {number} nextRows @returns {void} */
    resize(nextCols, nextRows) {
      const wide = clamp(nextCols, MIN_SIZE, MAX_SIZE, cols);
      const tall = clamp(nextRows, MIN_SIZE, MAX_SIZE, rowCount);
      if (wide === cols && tall === rowCount) return;
      commit(rowsNow());
      const lines = rowsNow().slice(0, tall);
      while (lines.length < tall) lines.push('');
      adopt(toGrid(lines, wide), true);
    },

    destroy() {
      if (gone) return;
      gone = true;
      for (const [node, type, fn] of bound) node.removeEventListener(type, fn);
      if (scheme) scheme.removeEventListener('change', invalidate);
      past.length = 0;
      future.length = 0;
      swatches.length = 0;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

  build();
  api.tool(toolChar);
  adopt(grid, false);
  if (store) void refreshLevels();
  return api;
}
