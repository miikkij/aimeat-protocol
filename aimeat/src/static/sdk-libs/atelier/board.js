/**
 * @file atelier/board.js
 * @description The board — frames on an infinite plane, the spatial surface ORIGAMI is made of.
 *   Every frame is a card in world coordinates with a head (title, kind, the app's own action
 *   buttons), a body the app renders into, and a resize grip; the head and the grip are
 *   counter-scaled so they read the same size on screen at every zoom. Frames are keyed: set()
 *   adds, moves, resizes and removes without rebuilding, and re-renders a body only when the
 *   frame's `rev` changed, so a frame holding an app iframe is never reloaded by a neighbour's
 *   move. Rings are a request panel's ground: a circle drawn from its member frames, behind
 *   them and deaf to the pointer, so a frame can be dragged anywhere without falling off.
 *
 *   THE CAMERA IS AIMEAT.viewport, feature-detected on the page: pan, zoom at the cursor, pinch,
 *   drag delegation and the Move/Use overlay model are the library's, and this file only claims
 *   the pointer for a frame's head, body (in Move mode) and grip. Without the library the frames
 *   are laid out where they are in a scrolling box and a line says what is missing: the Design
 *   Book shows the board either way.
 *
 *   WHAT FETCHES AND WHY. Nothing. The frames' contents are the app's (`render(frame, body)`),
 *   and every change of geometry, selection, mode and camera is reported, never stored.
 *
 *   THE SAMPLE STATE. `sample: true` draws three frames and a ring with built-in bodies and
 *   changes nothing, so a gallery shows a board with something on it.
 * @parts board root · tools · tool · world · ring · ringName · frame · head · title · kind · extra · actions · act · body · grip · empty · note
 * @slots board title(frame) · extra(frame) · empty()
 * @variants board fill · plain
 * @tokens board --ak-board-h · --ak-board-head · --ak-board-frame-radius · --ak-board-ring
 * @fork board Copy .ak-board* out of board.css and drive AIMEAT.viewport yourself; you keep the camera and give up the keyed frames, the ring geometry, the Move/Use overlay and the chrome that stays one size at every zoom.
 * @structure board(spec) → { el, world, set, select, selected, frameEl, fit, centerOn, camera, mode, setMode, destroy }
 * @usage
 *   var b = AIMEAT.atelier.board({ target: host, frames: frames, rings: rings,
 *     actions: [{ id: 'remove', glyph: '✗', label: 'Remove' }],
 *     render: function (f, body) { body.textContent = f.title; },
 *     onMove: save, onAction: act, onSelect: show });
 *   b.set({ frames: frames });        // keyed: adds, moves, removes; re-renders on frame.rev
 * @version-history
 *   v0.64.0 — 2026-10-02 — Initial, from ORIGAMI 1.2.0's board (wish-origami-atelieriin-ja-laudan-osat-kitin-lohkoiksi-ja-design-).
 */
import { el, clear, resolve } from './dom.js';
import { applyVariant } from './parts-model.js';
import { emptyState } from './state.js';
import { tb } from './board-i18n.js';

const VARIANTS = ['fill', 'plain'];
const FRAME_W = 480;
const FRAME_MIN_W = 160;
const FRAME_MIN_H = 120;
const RING_PAD = 60;
const FAR = 0.55;
const NUDGE = 10;

/**
 * @typedef {{ id: string, x: number, y: number, w?: number, h?: number, title?: string,
 *   kind?: string, live?: boolean, tone?: string, rev?: string|number, borrowed?: boolean,
 *   [k: string]: any }} BoardFrame
 * @typedef {{ id: string, title?: string, members: string[], borrowed?: string[], anchor?: string }} BoardRing
 */

/** A frame's rectangle in world units, the drawn height when the frame does not name one. */
function rectOf(entry) {
  const f = entry.frame;
  return { x: f.x || 0, y: f.y || 0, w: f.w || FRAME_W, h: f.h || entry.el.offsetHeight || 240 };
}

/** The sample board: three frames and the ring that owns two of them. */
function sampleFrames() {
  return [
    { id: 's-tbl', x: 0, y: 0, w: 420, h: 250, kind: 'table', title: 'Contacts', rev: 1 },
    { id: 's-chart', x: 460, y: 0, w: 360, h: 250, kind: 'chart', title: 'Per month', rev: 1 },
    { id: 's-note', x: 0, y: 300, w: 300, kind: 'note', title: 'Note', rev: 1 },
  ];
}
function sampleRings() {
  return [{ id: 's-ring', title: 'Who is coming', members: ['s-tbl', 's-chart'] }];
}
/** @param {BoardFrame} f @param {HTMLElement} body */
function renderSample(f, body) {
  if (f.kind === 'table') {
    const rows = [['Anna', 'Virtanen', 'coming'], ['Mikko', 'Korhonen', 'coming'], ['Sari', 'Nieminen', 'maybe']];
    body.appendChild(el('div', { class: 'ak-board__srows' }, [
      el('div', { class: 'ak-board__srow ak-board__srow--head' }, [el('span', { text: 'First' }), el('span', { text: 'Last' }), el('span', { text: 'Status' })]),
    ].concat(rows.map(function (r) {
      return el('div', { class: 'ak-board__srow' }, r.map(function (c) { return el('span', { text: c }); }));
    }))));
    return;
  }
  if (f.kind === 'chart') {
    body.appendChild(el('div', { class: 'ak-board__sbars' }, [38, 52, 61, 48, 75, 90].map(function (h) {
      return el('div', { class: 'ak-board__sbar', style: 'height:' + h + '%' });
    })));
    return;
  }
  body.appendChild(el('div', { class: 'ak-board__snote', text: 'Every frame is a live product, not a picture of one.' }));
}

/**
 * The board.
 * @param {{
 *   target?: string|Element, label?: string, variant?: string, sample?: boolean,
 *   frames?: BoardFrame[], rings?: BoardRing[], camera?: { x: number, y: number, k: number }|null,
 *   mode?: 'move'|'use', tools?: boolean, minZoom?: number, maxZoom?: number,
 *   actions?: Array<{ id: string, glyph?: string, label?: string, when?: (f: BoardFrame) => boolean, pressed?: (f: BoardFrame) => boolean }>,
 *   render?: (frame: BoardFrame, body: HTMLElement, api: { el: HTMLElement }) => void,
 *   onMove?: (frame: BoardFrame, rect: { x: number, y: number, w: number, h: number }) => void,
 *   tow?: (frame: BoardFrame) => string[],
 *   onSelect?: (frame: BoardFrame|null) => void,
 *   onAction?: (id: string, frame: BoardFrame) => void,
 *   onActivate?: (frame: BoardFrame) => void,
 *   onDrop?: (frame: BoardFrame, ring: BoardRing) => void,
 *   onCamera?: (cam: { x: number, y: number, k: number }) => void,
 *   onMode?: (mode: 'move'|'use') => void,
 *   empty?: { title?: string, hint?: string, action?: { label: string, onClick: () => void } },
 *   parts?: { title?: (f: BoardFrame) => any, extra?: (f: BoardFrame) => any, empty?: () => any },
 * }} spec
 */
export function board(spec) {
  const sample = spec.sample === true;
  const root = el('div', {
    class: 'ak-root ak-board', 'data-ak-part': 'root', tabindex: '0', role: 'application',
    'aria-label': spec.label || tb('frame'),
  });
  applyVariant(root, spec, VARIANTS);
  if (spec.target) resolve(spec.target).appendChild(root);

  const ns = /** @type {any} */ (window).AIMEAT;
  const vpLib = ns && ns.viewport && typeof ns.viewport.create === 'function' ? ns.viewport : null;
  /** @type {Map<string, { el: HTMLElement, frame: BoardFrame, head: HTMLElement, title: HTMLElement, kind: HTMLElement, extra: HTMLElement, acts: HTMLElement, body: HTMLElement, rev: any, sig: string }>} */
  const shown = new Map();
  /** @type {Map<string, { el: HTMLElement, name: HTMLElement }>} */
  const ringEls = new Map();
  /** @type {BoardRing[]} */
  let rings = sample ? sampleRings() : (spec.rings || []);
  /** @type {string|null} */
  let selected = null;
  let mode = spec.mode === 'use' ? 'interact' : 'navigate';
  let emptyCard = null;
  let destroyed = false;
  const parts = spec.parts || {};
  const actions = spec.actions || [];

  // The camera, or the static box.
  let vp = null;
  /** @type {HTMLElement} */
  let world;
  if (vpLib) {
    vp = vpLib.create(root, {
      classPrefix: 'akb',
      minZoom: spec.minZoom || 0.05,
      maxZoom: spec.maxZoom || 3,
      fitMaxZoom: 1,
      initial: spec.camera || undefined,
      captureSelector: '[data-ak-frame]:not([data-ak-live])',
      contentBBox: bbox,
      onClaimPointer: claim,
      onTap: function () { select(null); },
      onCameraChange: onCamera,
      mode: mode,
    });
    world = vp.world;
    world.setAttribute('data-ak-part', 'world');
  } else {
    root.classList.add('ak-board--static');
    world = el('div', { class: 'ak-board__world ak-board__world--static', 'data-ak-part': 'world' });
    root.appendChild(world);
    root.appendChild(el('p', { class: 'ak-board__note', 'data-ak-part': 'note', text: tb('noViewport') }));
  }
  if (sample) root.appendChild(el('span', { class: 'ak-board__sample', text: tb('sample') }));

  // The mode switch: fixed chrome, never in the world.
  let toolMove = null, toolUse = null;
  if (vp && spec.tools !== false) {
    toolMove = el('button', { type: 'button', class: 'ak-board__tool', 'data-ak-part': 'tool', 'data-ak-noguard': true, text: tb('move'), title: tb('moveHint'), on: { click: function () { setMode('move'); } } });
    toolUse = el('button', { type: 'button', class: 'ak-board__tool', 'data-ak-part': 'tool', 'data-ak-noguard': true, text: tb('use'), title: tb('useHint'), on: { click: function () { setMode('use'); } } });
    root.appendChild(el('div', { class: 'ak-board__tools', 'data-ak-part': 'tools', role: 'group', 'aria-label': tb('move') + ' / ' + tb('use') }, [toolMove, toolUse]));
    paintMode();
  }

  function bbox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    shown.forEach(function (entry) {
      const r = rectOf(entry);
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    });
    if (x0 === Infinity) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function onCamera(cam) {
    const k = (cam && cam.k) || 1;
    root.style.setProperty('--ak-board-inv', String(Math.max(1, 1 / k)));
    root.classList.toggle('ak-board--far', k < FAR);
    if (spec.onCamera) spec.onCamera({ x: cam.x, y: cam.y, k: cam.k });
  }

  function paintMode() {
    if (toolMove) toolMove.setAttribute('aria-pressed', mode === 'navigate' ? 'true' : 'false');
    if (toolUse) toolUse.setAttribute('aria-pressed', mode === 'interact' ? 'true' : 'false');
    root.setAttribute('data-ak-mode', mode === 'interact' ? 'use' : 'move');
  }
  /** @param {'move'|'use'} m */
  function setMode(m) {
    const next = m === 'use' ? 'interact' : 'navigate';
    if (next === mode) return;
    mode = next;
    if (vp) vp.setMode(mode);
    paintMode();
    if (spec.onMode) spec.onMode(m === 'use' ? 'use' : 'move');
  }

  // A pointer that lands on a control is the control's; a frame's head or grip is ours; a frame's
  // body is ours in Move mode and the content's in Use mode or on a live frame.
  function swallow() { return { onMove: function () {}, onEnd: function () {} }; }
  function claim(ev) {
    const t = /** @type {Element} */ (ev.target);
    if (!t || !t.closest) return null;
    if (t.closest('.ak-board__tools, .ak-board__empty')) return swallow();
    const node = t.closest('[data-ak-frame]');
    if (!node) return null;
    const entry = shown.get(node.getAttribute('data-ak-id') || '');
    if (!entry) return null;
    if (t.closest('button, input, select, textarea, a, [contenteditable], [data-ak-noclaim]')) return swallow();
    const onGrip = !!t.closest('.ak-board__grip');
    const onHead = !!t.closest('.ak-board__head');
    if (!onGrip && !onHead && (mode === 'interact' || node.hasAttribute('data-ak-live'))) return swallow();
    select(entry.frame.id);
    const f = entry.frame;
    const start = rectOf(entry);
    let moved = false;
    // The rings this frame already sits in: only ENTERING new ground is offered at the end, so a
    // nudge inside a circle the frame was declined for never asks again.
    const wasIn = ringsUnder(entry);
    // The frames that travel with this one (a request panel tows its members), with where they
    // started, so a drag moves them all by the same hand.
    const towed = (!onGrip && spec.tow ? (spec.tow(f) || []) : [])
      .map(function (id) { return shown.get(String(id)); })
      .filter(function (e) { return e && e !== entry; })
      .map(function (e) { return { entry: e, x0: e.frame.x || 0, y0: e.frame.y || 0 }; });
    if (onGrip) {
      return {
        onMove: function (dx, dy) {
          moved = true;
          f.w = Math.max(FRAME_MIN_W, Math.round(start.w + dx));
          f.h = Math.max(FRAME_MIN_H, Math.round(start.h + dy));
          place(entry);
          drawRings();
        },
        onEnd: function () { if (moved && spec.onMove) spec.onMove(f, rectOf(entry)); },
      };
    }
    return {
      onMove: function (dx, dy) {
        moved = true;
        f.x = Math.round(start.x + dx);
        f.y = Math.round(start.y + dy);
        place(entry);
        towed.forEach(function (tw) {
          tw.entry.frame.x = Math.round(tw.x0 + dx);
          tw.entry.frame.y = Math.round(tw.y0 + dy);
          place(tw.entry);
        });
        drawRings();
      },
      onEnd: function () {
        if (!moved) return;
        dropCheck(entry, wasIn);
        if (spec.onMove) {
          spec.onMove(f, rectOf(entry));
          towed.forEach(function (tw) { spec.onMove(tw.entry.frame, rectOf(tw.entry)); });
        }
      },
    };
  }

  /** The ids of the rings whose circle holds this frame's centre. */
  function ringsUnder(entry) {
    const r = rectOf(entry), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    return rings.filter(function (ring) {
      const g = ringGeom(ring);
      return !!g && Math.hypot(cx - g.cx, cy - g.cy) <= g.r;
    }).map(function (ring) { return ring.id; });
  }

  /** A frame dropped inside a ring it was not in and does not belong to is offered to that ring. */
  function dropCheck(entry, wasIn) {
    if (!spec.onDrop) return;
    const id = entry.frame.id;
    const now = ringsUnder(entry);
    for (const ring of rings) {
      if (now.indexOf(ring.id) < 0 || (wasIn || []).indexOf(ring.id) >= 0) continue;
      if ((ring.members || []).indexOf(id) >= 0 || (ring.borrowed || []).indexOf(id) >= 0) continue;
      spec.onDrop(entry.frame, ring);
      return;
    }
  }

  function buildFrame(f) {
    const node = el('div', { class: 'ak-board__frame ak-board__frame--in', 'data-ak-part': 'frame', 'data-ak-frame': true, 'data-ak-id': f.id });
    const head = el('div', { class: 'ak-board__head', 'data-ak-part': 'head' });
    const title = el('span', { class: 'ak-board__title', 'data-ak-part': 'title' });
    const kind = el('span', { class: 'ak-board__kind', 'data-ak-part': 'kind' });
    const extra = el('span', { class: 'ak-board__extra', 'data-ak-part': 'extra' });
    const acts = el('div', { class: 'ak-board__actions', 'data-ak-part': 'actions' });
    head.appendChild(title); head.appendChild(kind); head.appendChild(extra); head.appendChild(acts);
    const body = el('div', { class: 'ak-board__body', 'data-ak-part': 'body' });
    const grip = el('div', { class: 'ak-board__grip', 'data-ak-part': 'grip', title: tb('resize'), 'aria-hidden': 'true' });
    node.appendChild(head); node.appendChild(body); node.appendChild(grip);
    head.addEventListener('click', function (e) {
      if (/** @type {Element} */ (e.target).closest('button')) return;
      select(f.id);
    });
    node.addEventListener('dblclick', function (e) {
      if (/** @type {Element} */ (e.target).closest('button, input, textarea, select, a')) return;
      const entry = shown.get(f.id);
      if (entry && spec.onActivate) spec.onActivate(entry.frame);
    });
    node.addEventListener('animationend', function () { node.classList.remove('ak-board__frame--in'); });
    return { el: node, frame: f, head, title, kind, extra, acts, body, rev: undefined, sig: '' };
  }

  function place(entry) {
    const f = entry.frame;
    entry.el.style.left = (f.x || 0) + 'px';
    entry.el.style.top = (f.y || 0) + 'px';
    entry.el.style.width = (f.w || FRAME_W) + 'px';
    entry.el.style.height = f.h ? f.h + 'px' : '';
  }

  function fillSlot(host, value) {
    clear(host);
    if (value == null || value === false) return;
    if (value instanceof Node) host.appendChild(value);
    else if (Array.isArray(value)) value.forEach(function (v) { fillSlot(host, v); });
    else host.textContent = String(value);
  }

  function chrome(entry) {
    const f = entry.frame;
    const titleVal = parts.title ? parts.title(f) : (f.title || '');
    fillSlot(entry.title, titleVal);
    const kindKey = f.kind ? 'kind.' + f.kind : '';
    const kindText = kindKey ? tb(kindKey) : '';
    entry.kind.textContent = kindText === kindKey ? String(f.kind) : kindText;
    fillSlot(entry.extra, parts.extra ? parts.extra(f) : (f.extra || ''));
    if (f.kind) entry.el.setAttribute('data-ak-kind', String(f.kind)); else entry.el.removeAttribute('data-ak-kind');
    if (f.live) entry.el.setAttribute('data-ak-live', ''); else entry.el.removeAttribute('data-ak-live');
    if (f.tone) entry.el.setAttribute('data-ak-tone', String(f.tone)); else entry.el.removeAttribute('data-ak-tone');
    entry.el.classList.toggle('ak-board__frame--borrowed', !!f.borrowed);
    // The action buttons are rebuilt only when the set that applies to this frame changes.
    const visible = actions.filter(function (a) { return !a.when || a.when(f); });
    const sig = visible.map(function (a) { return a.id + (a.pressed && a.pressed(f) ? '*' : ''); }).join('|');
    if (sig !== entry.sig) {
      entry.sig = sig;
      clear(entry.acts);
      visible.forEach(function (a) {
        const b = el('button', {
          type: 'button', class: 'ak-board__act', 'data-ak-part': 'act', 'data-ak-act': a.id, 'data-ak-noguard': true,
          'aria-label': a.label || a.id, title: a.label || a.id,
          'aria-pressed': a.pressed ? (a.pressed(f) ? 'true' : 'false') : null,
          text: a.glyph || a.label || a.id,
          on: { click: function (e) {
            e.stopPropagation();
            const now = shown.get(f.id);
            if (now && spec.onAction) spec.onAction(a.id, now.frame);
          } },
        });
        entry.acts.appendChild(b);
      });
    }
  }

  function renderBody(entry, fresh) {
    const f = entry.frame;
    if (!fresh && entry.rev === f.rev) return;
    entry.rev = f.rev;
    clear(entry.body);
    if (sample) { renderSample(f, entry.body); return; }
    if (spec.render) spec.render(f, entry.body, { el: entry.el });
  }

  /** The keyed reconcile: add, move, resize, re-chrome, re-render on rev, remove. */
  function reconcile(frames) {
    const next = new Map();
    (frames || []).forEach(function (f) { if (f && f.id != null) next.set(String(f.id), f); });
    shown.forEach(function (entry, id) {
      if (next.has(id)) return;
      entry.el.remove();
      shown.delete(id);
      if (selected === id) selected = null;
    });
    next.forEach(function (f, id) {
      let entry = shown.get(id);
      const fresh = !entry;
      if (!entry) {
        entry = buildFrame(f);
        shown.set(id, entry);
        world.appendChild(entry.el);
      } else {
        entry.frame = f;
      }
      place(entry);
      chrome(entry);
      renderBody(entry, fresh);
      entry.el.classList.toggle('ak-board__frame--selected', selected === id);
    });
    paintEmpty();
    drawRings();
    if (vp && vp.refreshCaptures) vp.refreshCaptures();
  }

  function paintEmpty() {
    const bare = shown.size === 0;
    if (!bare) { if (emptyCard) { emptyCard.remove(); emptyCard = null; } return; }
    if (emptyCard) return;
    emptyCard = el('div', { class: 'ak-board__empty', 'data-ak-part': 'empty' });
    if (parts.empty) fillSlot(emptyCard, parts.empty());
    else {
      const e = spec.empty || {};
      emptyState({ target: emptyCard, tone: 'quiet', title: e.title || tb('empty'), hint: e.hint || tb('emptyHint'), action: e.action || null });
    }
    root.appendChild(emptyCard);
  }

  /**
   * The circle that holds a ring's members, from their rectangles. With an `anchor` frame the
   * circle is centred on it (a request panel's ring reaches out from the panel), and only the
   * members stretch it: a borrowed frame may sit on the far side of the board, and reaching it
   * would claim ground this ring does not hold.
   */
  function ringGeom(ring) {
    const anchor = ring.anchor != null ? shown.get(String(ring.anchor)) : null;
    const members = (ring.members || [])
      .map(function (id) { return shown.get(String(id)); }).filter(Boolean);
    const all = anchor ? [anchor].concat(members.filter(function (m) { return m !== anchor; })) : members;
    if (!all.length) return null;
    let cx = 0, cy = 0, rad = 0;
    if (anchor) {
      const a = rectOf(anchor);
      cx = a.x + a.w / 2; cy = a.y + a.h / 2;
      rad = Math.max(a.w, a.h) / 2 + RING_PAD;
    } else {
      const rects = all.map(rectOf);
      rects.forEach(function (r) { cx += r.x + r.w / 2; cy += r.y + r.h / 2; });
      cx /= rects.length; cy /= rects.length;
    }
    all.forEach(function (e) {
      if (e === anchor) return;
      const r = rectOf(e);
      [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].forEach(function (p) {
        rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cy) + (anchor ? 28 : RING_PAD));
      });
    });
    return { cx: cx, cy: cy, r: rad };
  }

  function drawRings() {
    const keep = new Set();
    rings.forEach(function (ring) {
      const g = ringGeom(ring);
      if (!g) return;
      keep.add(ring.id);
      let r = ringEls.get(ring.id);
      if (!r) {
        const name = el('span', { class: 'ak-board__ring-name', 'data-ak-part': 'ringName' });
        const node = el('div', { class: 'ak-board__ring', 'data-ak-part': 'ring', 'data-ak-id': ring.id, 'aria-hidden': 'true' }, [name]);
        world.insertBefore(node, world.firstChild);
        r = { el: node, name: name };
        ringEls.set(ring.id, r);
      }
      r.name.textContent = ring.title || '';
      r.el.style.left = (g.cx - g.r) + 'px';
      r.el.style.top = (g.cy - g.r) + 'px';
      r.el.style.width = (g.r * 2) + 'px';
      r.el.style.height = (g.r * 2) + 'px';
      const mine = selected != null && ((ring.members || []).indexOf(selected) >= 0 || (ring.borrowed || []).indexOf(selected) >= 0);
      r.el.classList.toggle('ak-board__ring--selected', mine);
      (ring.members || []).forEach(function (id) {
        const e = shown.get(String(id));
        if (e) e.el.classList.add('ak-board__frame--member');
      });
    });
    ringEls.forEach(function (r, id) {
      if (keep.has(id)) return;
      r.el.remove();
      ringEls.delete(id);
    });
  }

  /** @param {string|null} id */
  function select(id) {
    const next = id == null ? null : String(id);
    if (next !== null && !shown.has(next)) return;
    if (next === selected) return;
    selected = next;
    shown.forEach(function (entry, key) {
      entry.el.classList.toggle('ak-board__frame--selected', key === selected);
      if (key === selected) entry.el.setAttribute('aria-current', 'true'); else entry.el.removeAttribute('aria-current');
    });
    drawRings();
    if (spec.onSelect) spec.onSelect(selected ? shown.get(selected).frame : null);
  }

  // Keyboard: the selected frame moves on the arrow keys, Escape clears the selection and hands
  // the canvas back to Move.
  root.addEventListener('keydown', function (ev) {
    const target = /** @type {Element} */ (ev.target);
    if (target && target !== root && target.closest && target.closest('input, textarea, select, [contenteditable]')) return;
    if (ev.key === 'Escape') { select(null); setMode('move'); return; }
    if (!selected) return;
    const entry = shown.get(selected);
    if (!entry) return;
    const step = ev.shiftKey ? NUDGE * 5 : NUDGE;
    const f = entry.frame;
    let moved = true;
    if (ev.key === 'ArrowLeft') f.x = (f.x || 0) - step;
    else if (ev.key === 'ArrowRight') f.x = (f.x || 0) + step;
    else if (ev.key === 'ArrowUp') f.y = (f.y || 0) - step;
    else if (ev.key === 'ArrowDown') f.y = (f.y || 0) + step;
    else moved = false;
    if (!moved) return;
    ev.preventDefault();
    place(entry);
    drawRings();
    if (spec.onMove) spec.onMove(f, rectOf(entry));
  });

  reconcile(sample ? sampleFrames() : (spec.frames || []));
  if (vp) {
    if (spec.camera) vp.setCamera(spec.camera, false); else if (shown.size) vp.fit(false);
    onCamera(vp.cam());
  }

  return {
    el: root,
    world: world,
    /** @param {{ frames?: BoardFrame[], rings?: BoardRing[], camera?: object|null, mode?: 'move'|'use' }} patch */
    set: function (patch) {
      if (destroyed || !patch) return;
      if (patch.rings) { rings = patch.rings; }
      if (patch.frames) reconcile(patch.frames); else if (patch.rings) drawRings();
      if (patch.camera && vp) vp.setCamera(patch.camera, true);
      if (patch.mode) setMode(patch.mode);
    },
    select: select,
    selected: function () { return selected; },
    frameEl: function (id) { const e = shown.get(String(id)); return e ? e.el : null; },
    bodyEl: function (id) { const e = shown.get(String(id)); return e ? e.body : null; },
    fit: function (animated) { if (vp) vp.fit(animated !== false); },
    centerOn: function (id, animated) {
      const e = shown.get(String(id));
      if (e && vp) vp.centerOn(rectOf(e), animated !== false);
    },
    camera: function () { return vp ? vp.cam() : null; },
    mode: function () { return mode === 'interact' ? 'use' : 'move'; },
    setMode: setMode,
    clientToWorld: function (cx, cy) { return vp ? vp.clientToWorld(cx, cy) : { x: cx, y: cy }; },
    nextSlot: function () {
      // The next free place: below everything, at the left edge of what is there.
      const b = bbox();
      return shown.size ? { x: b.x, y: b.y + b.h + 40 } : { x: 0, y: 0 };
    },
    destroy: function () {
      destroyed = true;
      if (vp) vp.destroy();
      shown.clear();
      ringEls.clear();
      root.remove();
    },
  };
}
