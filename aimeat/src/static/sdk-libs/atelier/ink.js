/**
 * @file atelier/ink.js
 * @description THE INK: the one marker that shows which item in a row is the chosen one, and
 *   travels there when the choice changes, instead of each item painting its own fill. It is an
 *   edge pair (springs.js): the edge in the direction of travel leads, so the marker stretches
 *   toward the new item and closes up on it. The tabs, the segmented control and the menu's
 *   highlight all use it.
 *
 *   The ink is one element inside the container, drawn under the items' labels and over their
 *   own backgrounds (the stylesheet orders them), so a row keeps its look at rest and only the
 *   move is new. It measures in the container's own coordinates, scroll included, so a tab strip
 *   that scrolls carries the ink with it. A container that is rebuilt (the tabs clear their row
 *   on every render) gets the same ink element back on the next sync, so the travel continues
 *   from where it was rather than starting over.
 *
 *   The first placement and every resize land without travel: only a change of choice moves.
 * @structure ink(container, opts) → { el, sync, jump, pin, destroy }
 * @usage
 *   const mark = ink(row, { active: '[aria-selected="true"]' });
 *   // after the row changed which item is chosen:
 *   mark.sync();
 * @version-history
 *   v0.55.0 — 2026-09-28 — Initial (the ten motion parts).
 */
import { el, uid } from './dom.js';
import { edgePair } from './springs.js';

/** An element's own transform as a 2D matrix (identity when it has none or cannot be read). */
function ownTransform(node) {
  const id = { a: 1, d: 1, e: 0, f: 0 };
  let t;
  try { t = getComputedStyle(node).transform || 'none'; } catch { return id; }
  if (t === 'none' || typeof DOMMatrixReadOnly !== 'function') return id;
  try {
    const m = new DOMMatrixReadOnly(t);
    return { a: m.a || 1, d: m.d || 1, e: m.e || 0, f: m.f || 0 };
  } catch { return id; }
}

/**
 * Put a travelling marker in a row.
 * @param {HTMLElement} container  the row; it becomes the ink's positioning context
 * @param {{ active: string|((container: HTMLElement) => Element|null), axis?: 'x'|'y',
 *   className?: string }} opts
 *   `active` finds the chosen item (a selector inside the container, or a function). `axis` is
 *   the direction the items run in: x for a row, y for a column such as a menu.
 * @returns {{ el: HTMLElement, sync: () => void, jump: () => void, pin: () => (() => void),
 *   destroy: () => void }}
 */
export function ink(container, opts) {
  const o = opts || { active: '' };
  const axis = o.axis === 'y' ? 'y' : 'x';
  const mark = el('span', { class: 'ak-ink' + (o.className ? ' ' + o.className : ''), 'data-ak-part': 'ink', 'aria-hidden': 'true' });
  let cross = { pos: 0, size: 0 };
  let placed = false;
  let visible = false;

  /** The chosen item's box in the container's own coordinates, or null when nothing is chosen. */
  function measure() {
    const found = typeof o.active === 'function' ? o.active(container)
      : (o.active ? container.querySelector(o.active) : null);
    if (!found || found === mark) return null;
    const c = container.getBoundingClientRect();
    const r = found.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    // The screen box includes any transform on the way up, and the kit's own entrance scales a
    // section for a moment: measured then, the ink came out a pixel short and stayed so. Divide
    // the transform back out with the container's own layout size.
    const sx = container.offsetWidth ? c.width / container.offsetWidth : 1;
    const sy = container.offsetHeight ? c.height / container.offsetHeight : 1;
    const kx = sx > 0 ? sx : 1;
    const ky = sy > 0 ? sy : 1;
    // The item's OWN transform is taken out too: a row gliding to its new place (settle) is drawn
    // where it was, and the ink belongs where it is going. The kit's moves are translate and
    // scale about the centre, which is what this undoes.
    const own = ownTransform(found);
    const w = r.width / own.a;
    const h = r.height / own.d;
    const cx = r.left + r.width / 2 - own.e * kx;
    const cy = r.top + r.height / 2 - own.f * ky;
    const left = (cx - w / 2 - c.left) / kx + container.scrollLeft - (container.clientLeft || 0);
    const top = (cy - h / 2 - c.top) / ky + container.scrollTop - (container.clientTop || 0);
    return { left, top, width: w / kx, height: h / ky };
  }

  function draw(start, end) {
    const size = Math.max(0, end - start);
    if (axis === 'x') {
      mark.style.transform = 'translate(' + start + 'px, ' + cross.pos + 'px)';
      mark.style.width = size + 'px';
      mark.style.height = cross.size + 'px';
    } else {
      mark.style.transform = 'translate(' + cross.pos + 'px, ' + start + 'px)';
      mark.style.height = size + 'px';
      mark.style.width = cross.size + 'px';
    }
  }
  const edges = edgePair(draw, { el: container });

  function attach() {
    if (mark.parentNode !== container) container.appendChild(mark);
  }
  function show(on) {
    if (on === visible) return;
    visible = on;
    mark.hidden = !on;
    container.toggleAttribute('data-ak-ink', on);
  }

  /** Move to the chosen item; the first time, and after a resize, land without travel. */
  function sync(travel) {
    attach();
    watch();
    const box = measure();
    if (!box) { show(false); placed = false; return; }
    cross = axis === 'x' ? { pos: box.top, size: box.height } : { pos: box.left, size: box.width };
    const start = axis === 'x' ? box.left : box.top;
    const end = start + (axis === 'x' ? box.width : box.height);
    if (!placed || travel === false) {
      edges.jump(start, end);
      draw(start, end);
      placed = true;
    } else {
      edges.set(start, end);
    }
    show(true);
  }

  // A resize moves every item at once; the ink follows without travelling. The chosen item is
  // watched too, because it can change size while the row does not: a web font that arrives
  // after the first measurement widens every label and leaves the row as wide as it was.
  let ro = null;
  let watched = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(function () { if (placed && !edges.moving()) sync(false); });
    ro.observe(container);
  }
  function watch() {
    if (!ro) return;
    const found = typeof o.active === 'function' ? o.active(container) : (o.active ? container.querySelector(o.active) : null);
    if (found === watched) return;
    if (watched) ro.unobserve(watched);
    watched = found;
    if (found) ro.observe(found);
  }
  attach();
  show(false);
  // The container may not be in the document yet, and then nothing can be measured.
  if (container.isConnected) sync(false);
  else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { sync(false); });

  return {
    el: mark,
    sync() { sync(true); },
    jump() { sync(false); },
    /**
     * Keep the row out of a view transition's crossfade while the screen changes around it, so
     * the ink is seen travelling rather than frozen in the old snapshot. Returns the release.
     */
    pin() {
      const name = uid('ak-ink').replace(/[^a-z0-9-]/gi, '');
      container.style.setProperty('view-transition-name', name);
      container.style.setProperty('view-transition-class', 'ak-live');
      return function () {
        container.style.removeProperty('view-transition-name');
        container.style.removeProperty('view-transition-class');
      };
    },
    destroy() {
      edges.destroy();
      if (ro) ro.disconnect();
      if (mark.parentNode) mark.parentNode.removeChild(mark);
      container.removeAttribute('data-ak-ink');
    },
  };
}
