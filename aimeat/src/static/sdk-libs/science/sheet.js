/**
 * @file science/sheet.js
 * @description A worksheet on a page: read it, work it out, draw it, and keep it worked out while a
 *   person moves an input or a reading arrives. The maths itself is the node's — POST
 *   /v1/worksheet/evaluate — because the unit rules are the part that is quietly easy to get wrong,
 *   and a second copy of them in the browser would be a second set to keep in step.
 *
 *   THE ROUND TRIP IS DEBOUNCED, NOT AWAITED PER KEYSTROKE. A slider fires far faster than a request
 *   returns, so moves are collapsed into one call and answers that arrive out of order are dropped
 *   by sequence number: the sheet a person sees is always the sheet they last asked for.
 *
 *   NOTHING MOVES AT IDLE. A drawn sheet repaints when an answer changes and at no other time, which
 *   is the finish gate's own measurement.
 * @structure mount · evaluate · setInput · destroy
 * @usage
 *   const sheet = await AIMEAT.science.mount(el, { key: 'science.sheet.heating' });
 *   sheet.setInput('T_sisa', 23);
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 2).
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-science.js');
import { quantityEl } from './quantity.js';
import { formulaEl, typesetInto } from './formula.js';
import { controlEl } from './controls.js';
import { followKeys } from './live.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

/** How long a burst of moves is collected before one call goes out. */
const SETTLE_MS = 120;

/**
 * Put a worksheet on the page and keep it current.
 * @param {HTMLElement} target
 * @param {{ key?: string, sheet?: object, owner?: string, locale?: string, readOnly?: boolean,
 *           onChange?: (sheet: object) => void }} opts
 */
export async function mount(target, opts) {
  if (!target) throw new Error('mount needs an element');
  const o = opts || {};
  const state = {
    sheet: o.sheet ? clone(o.sheet) : null,
    values: {},          // cell id → the number its memory key currently reads
    history: {},         // cell id → the recent readings, for a sparkline
    answers: new Map(),
    seq: 0,
    settle: null,
    stopFollowing: null,
    dead: false,
  };

  if (!state.sheet && o.key) state.sheet = await read(o.key, o.owner);
  if (!state.sheet) state.sheet = { cells: [] };

  const root = el('div', 'sci-sheet');
  target.replaceChildren(root);

  const api = {
    /** The sheet as it stands, safe to keep. */
    get sheet() { return clone(state.sheet); },
    /** The last answers, by cell id. */
    get answers() { return new Map(state.answers); },
    setInput,
    evaluate,
    destroy,
  };

  await evaluate();
  state.stopFollowing = followKeys(liveKeys(state.sheet), (cellId, value) => {
    state.values[cellId] = value;
    const seen = state.history[cellId] || (state.history[cellId] = []);
    seen.push(value);
    if (seen.length > 60) seen.shift();
    schedule();
  }, { owner: o.owner });

  return api;

  /* ── The work ──────────────────────────────────────────────────────────────────────────────── */

  async function evaluate() {
    if (state.dead) return;
    const seq = ++state.seq;
    let answer;
    try {
      const res = await authFetch('/v1/worksheet/evaluate', {
        method: 'POST',
        body: JSON.stringify({ sheet: state.sheet, values: state.values, locale: o.locale }),
      });
      answer = res && res.ok ? res.data : null;
    } catch (err) {
      // The sheet stays on the screen with its last answers, and the line below says the node did
      // not answer. Throwing here would take a working page down for one failed round trip.
      answer = null;
      note(String(err && err.message ? err.message : err));
    }
    if (state.dead || seq !== state.seq) return;   // a newer move already went out
    if (!answer) return;
    state.answers = new Map((answer.cells || []).map(c => [c.id, c]));
    draw();
  }

  /** Collect a burst of moves into one call. */
  function schedule() {
    if (state.settle) clearTimeout(state.settle);
    state.settle = setTimeout(() => { state.settle = null; evaluate(); }, SETTLE_MS);
  }

  /** Move an input and let everything standing on it follow. */
  function setInput(id, value) {
    const cell = (state.sheet.cells || []).find(c => c.id === id && c.kind === 'input');
    if (!cell) return false;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    cell.value = n;
    schedule();
    if (typeof o.onChange === 'function') o.onChange(clone(state.sheet));
    return true;
  }

  function destroy() {
    state.dead = true;
    if (state.settle) clearTimeout(state.settle);
    if (state.stopFollowing) state.stopFollowing();
    root.replaceChildren();
  }

  /* ── The drawing ───────────────────────────────────────────────────────────────────────────── */

  function draw() {
    const rows = document.createDocumentFragment();
    for (const cell of state.sheet.cells || []) {
      const answer = state.answers.get(cell.id);
      const row = el('div', 'sci-row sci-row--' + cell.kind);
      row.dataset.cell = cell.id;

      if (cell.kind === 'text') {
        row.append(el('p', 'sci-text', cell.text || ''));
      } else if (cell.kind === 'input') {
        row.append(controlEl(cell, answer, { readOnly: o.readOnly, onInput: v => setInput(cell.id, v) }));
      } else if (cell.kind === 'formula') {
        row.append(formulaEl(cell, answer));
      } else if (cell.kind === 'view') {
        const of = cell.of ? state.answers.get(cell.of) : null;
        row.append(quantityEl(of || answer, {
          as: cell.as, label: cell.label, min: cell.min, max: cell.max, bands: cell.bands,
          history: cell.of ? state.history[cell.of] : undefined,
        }));
      } else {
        row.append(quantityEl(answer, { as: 'figure', label: cell.label || cell.id }));
        if (cell.live) row.append(el('small', 'sci-follows', cell.live));
      }
      if (cell.note) row.append(el('small', 'sci-note', cell.note));
      rows.append(row);
    }
    root.replaceChildren(rows);
    typesetInto(root);
  }

  function note(message) {
    let line = root.querySelector('.sci-sheet-note');
    if (!line) { line = el('div', 'sci-sheet-note'); root.prepend(line); }
    line.textContent = message;
  }
}

/* ── Reading and keeping ─────────────────────────────────────────────────────────────────────── */

/** A sheet from a memory key. */
export async function read(key, owner) {
  const path = owner
    ? '/v1/memory/' + encodeURIComponent(owner) + '/' + encodeURIComponent(key)
    : '/v1/memory/' + encodeURIComponent(key) + '?owner_scope=true';
  const res = await authFetch(path);
  if (!res || !res.ok) throw new Error(res?.error?.message || 'The worksheet could not be read');
  return res.data?.value ?? null;
}

/** Keep a sheet under a memory key. The record names itself, so a later reader knows what it is. */
export async function save(key, sheet) {
  const body = { key, value: { spec: 'aimeat.worksheet/v1', ...sheet }, visibility: 'private' };
  const res = await authFetch('/v1/memory', { method: 'POST', body: JSON.stringify(body) });
  if (!res || !res.ok) throw new Error(res?.error?.message || 'The worksheet could not be kept');
  return res.data;
}

/** Work a sheet out once, without drawing it. */
export async function evaluateSheet(sheet, opts) {
  const res = await authFetch('/v1/worksheet/evaluate', {
    method: 'POST',
    body: JSON.stringify({ sheet, values: opts?.values, locale: opts?.locale }),
  });
  if (!res || !res.ok) throw new Error(res?.error?.message || 'The worksheet could not be worked out');
  return res.data;
}

/**
 * cell id → memory key, for every cell that follows one.
 * @param {{ cells?: Array<{ id: string, kind: string, live?: string }> }} sheet
 * @returns {Record<string, string>}
 */
function liveKeys(sheet) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const cell of sheet?.cells || []) if (cell.kind === 'quantity' && cell.live) out[cell.id] = cell.live;
  return out;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
