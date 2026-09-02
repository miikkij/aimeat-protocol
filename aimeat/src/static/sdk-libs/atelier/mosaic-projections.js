/**
 * @file atelier/mosaic-projections.js
 * @description The mosaic's flat projections, extracted whole from mosaic.js under the
 *   800-line rule (the canvas projection lives in mosaic-canvas.js the same way): the same
 *   block units shown as a composition grid (stack), a full-screen menu (overlay), a left
 *   rail, tabs or a bottom bar (picker), a scroll-snap deck, or a guided flow. Each takes
 *   the built units and, where it registers cleanup or chrome, the mosaic's `alive` registry.
 * @structure unitSwapper · projectStack · projectOverlay · projectRail · projectPicker ·
 *   projectDeck · projectFlow
 * @usage  import { projectStack, ... } from './mosaic-projections.js';
 * @version-history
 *   v0.46.0 — 2026-09-02 — A browser without View Transitions no longer gets the bare swap: the
 *     four projections that show one unit at a time (overlay, rail, picker, flow) share
 *     unitSwapper, which hands the change to panelTransition's crossfade and then puts every
 *     unit back in the box. The View-Transition path is untouched, and so is every signature.
 *   v0.36.0 — 2026-08-30 — Extracted from mosaic.js unchanged (pure move; the planner family
 *     pushed the file past the limit).
 */
import { el, enter, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { tabs, bottomNav } from './shell.js';
import { transition } from './mosaic-motion.js';
import { panelTransition } from './transitions.js';

/** What panelTransition pins the outgoing panel with, and what the restore takes off again. */
const PINNED = ['position', 'box-sizing', 'margin', 'top', 'left', 'width', 'height'];

/**
 * THE UNIT SWAP the flat projections share: one unit gives way to another inside the box they
 * all live in, and not one of them ever leaves it.
 *
 * Where the browser has View Transitions the move is exactly what it was: `transition` runs the
 * change and the browser crosses the two states. Where it has none, the instant swap is the
 * kit's own panel move instead, so a tab change on Firefox reads as a change rather than a jump.
 *
 * TWO THINGS panelTransition DOES THAT THIS SHAPE CANNOT KEEP. It takes the incoming panel into
 * the slot itself, so the unit is handed over detached (with both in the flow, the height it
 * travels is a height neither of them has); and it finishes by removing the outgoing panel,
 * which is not how these projections work, since their units are siblings that stay in the box
 * and take turns being hidden. So the move is followed by a restore that puts every unit back in
 * its own order, takes off the inline box the outgoing one was pinned with, and leaves exactly
 * the live unit showing. The restore is written from `units` rather than from whatever it finds,
 * so two clicks landing on top of each other cannot leave the box in a state neither move meant.
 * @param {HTMLElement} box
 * @param {Array<{ el: HTMLElement }>} units
 * @param {() => HTMLElement|null} live  the unit meant to be on screen once the dust settles
 * @returns {(from: HTMLElement, to: HTMLElement, settle: () => void) => void}
 */
function unitSwapper(box, units, live) {
  /** Which move is the current one. A move overtaken by a later click leaves the tidying to it:
   *  the restore below puts EVERY unit back, so the last one to land repairs all of them, and a
   *  stale restore running mid-move would only unpin the panel the new move is still using. */
  let epoch = 0;
  const restore = function () {
    const on = live();
    for (const u of units) {
      for (const name of PINNED) u.el.style.removeProperty(name);
      u.el.hidden = u.el !== on;
      box.appendChild(u.el);
    }
  };
  return function (from, to, settle) {
    if (from === to) { to.hidden = false; settle(); return; }
    if (typeof document.startViewTransition === 'function' && !reducedMotion()) {
      transition(function () { from.hidden = true; to.hidden = false; settle(); });
      return;
    }
    if (reducedMotion()) { from.hidden = true; to.hidden = false; settle(); return; }
    to.hidden = false;
    if (to.parentNode) to.parentNode.removeChild(to);
    // The insertion is synchronous, so the projection's own bookkeeping (the marks, the label,
    // the entrance) still runs on a unit that is already on the page and can be measured.
    const mine = ++epoch;
    const move = panelTransition(from, to, 'crossfade');
    settle();
    const tidy = function () { if (mine === epoch) restore(); };
    move.then(tidy, tidy);
  };
}

/** Stacked: every unit in order on the COMPOSITION GRID — a block's `span` places it (full
 *  line, the main column, the side column, a half), so the record composes a page instead of
 *  piling cards. Narrow screens stack everything (the stylesheet folds the grid). Units below
 *  the fold REVEAL as they scroll into view — the distance rides the look's own entrance
 *  token, so a look that declares no entrance (flat) moves nothing here either. */
export function projectStack(units, alive) {
  const box = el('div', { class: 'ak-mosaic__units ak-mosaic__units--grid' });
  for (const u of units) {
    u.el.classList.add('ak-mosaic__unit--' + (u.block.span || 'full'));
    box.appendChild(u.el);
  }
  if (!reducedMotion() && typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(function (entries) {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('ak-reveal--in');
          io.unobserve(entry.target);
        }
      }
      // threshold 0 + a bottom inset, not a ratio: a unit TALLER than the viewport can never
      // reach a ratio threshold (visible/height stays tiny), and would never reveal.
    }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
    for (const u of units) { u.el.classList.add('ak-reveal'); io.observe(u.el); }
    alive.cleanup.push(function () { io.disconnect(); });
  }
  return box;
}

/** The overlay: ONE Menu control opening a full-screen list in display type — the award-site
 *  move. Escape, the close control and a backdrop tap all leave it (a phone has no Escape,
 *  and an exit that exists only on a keyboard is no exit — first design review's finding).
 *  The CURRENT section is marked persistently (aria-current + class), because a hover that is
 *  the only differentiated state reads as "you are here" when it is only the mouse. */
export function projectOverlay(units, alive) {
  const box = el('div', { class: 'ak-mosaic__units' });
  for (const u of units) { u.el.hidden = true; box.appendChild(u.el); }
  let current = 0;
  let open = false;
  const items = [];
  const swap = unitSwapper(box, units, function () { return units[current] ? units[current].el : null; });

  const heading = el('h2', { class: 'ak-mosaic__unittitle' });
  const panel = el('div', {
    class: 'ak-mosaic__overlay', role: 'dialog', 'aria-label': t('menu'),
    on: { click: function (ev) { if (ev.target === panel) close(); } },
  });
  panel.hidden = true;

  const trigger = el('button', {
    type: 'button', class: 'ak-mosaic__overlaytrigger',
    'aria-expanded': 'false', 'data-ak-noguard': true,
    on: { click: function () { if (open) { close(); } else { show(); } } },
  }, t('menu'));

  const closeBtn = el('button', {
    type: 'button', class: 'ak-mosaic__overlayclose', 'aria-label': t('close'), 'data-ak-noguard': true,
    on: { click: function () { close(); } },
  }, '×');
  panel.appendChild(closeBtn);

  function mark() {
    items.forEach(function (btn, i) {
      btn.classList.toggle('ak-mosaic__overlayitem--on', i === current);
      if (i === current) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
    heading.textContent = units[current] ? units[current].label : '';
  }

  function show(index) {
    if (typeof index === 'number') {
      swap(units[current].el, units[index].el, function () {
        current = index;
        mark();
        enter(units[current].el);
      });
      close();
      return;
    }
    open = true;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    enter(panel);
    const on = /** @type {HTMLElement|null} */ (panel.querySelector('.ak-mosaic__overlayitem--on') || panel.querySelector('button'));
    if (on) on.focus();
  }
  function close() {
    open = false;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }
  function onKey(ev) { if (ev.key === 'Escape' && open) close(); }
  document.addEventListener('keydown', onKey);
  alive.cleanup.push(function () { document.removeEventListener('keydown', onKey); });

  units.forEach(function (u, i) {
    const btn = el('button', {
      type: 'button', class: 'ak-mosaic__overlayitem', 'data-ak-noguard': true,
      on: { click: function () { show(i); } },
    }, [
      el('span', { class: 'ak-mosaic__overlaynum', text: String(i + 1).padStart(2, '0') }),
      u.label,
    ]);
    items.push(btn);
    panel.appendChild(btn);
  });
  if (units.length) units[0].el.hidden = false;
  mark();

  return el('div', { class: 'ak-mosaic__overlaywrap' }, [
    el('div', { class: 'ak-mosaic__overlaybar' }, [heading, trigger]),
    box, panel,
  ]);
}

/** The rail: a desktop-grade left rail picking one unit at a time; on a narrow screen the
 *  stylesheet folds the rail into a top strip. Same blocks, another projection. */
export function projectRail(units) {
  const box = el('div', { class: 'ak-mosaic__units' });
  for (const u of units) { u.el.hidden = true; box.appendChild(u.el); }
  let current = 0;
  const items = [];
  const swap = unitSwapper(box, units, function () { return units[current] ? units[current].el : null; });
  function show(index) {
    if (index === current && !units[index].el.hidden) return;
    swap(units[current].el, units[index].el, function () {
      current = index;
      items.forEach(function (btn, i) { btn.classList.toggle('ak-mosaic__railitem--on', i === index); });
      enter(units[current].el);
    });
  }
  const rail = el('nav', { class: 'ak-mosaic__rail' }, units.map(function (u, i) {
    const btn = el('button', {
      type: 'button',
      class: 'ak-mosaic__railitem' + (i === 0 ? ' ak-mosaic__railitem--on' : ''),
      'data-ak-noguard': true,
      on: { click: function () { show(i); } },
    }, u.label);
    items.push(btn);
    return btn;
  }));
  if (units.length) units[0].el.hidden = false;
  return el('div', { class: 'ak-mosaic__railwrap' }, [rail, box]);
}

/** One unit shown at a time; the chrome (tabs or bottom bar) picks. */
export function projectPicker(units, mode, alive) {
  const box = el('div', { class: 'ak-mosaic__units' });
  for (const u of units) { u.el.hidden = true; box.appendChild(u.el); }
  let current = 0;
  const swap = unitSwapper(box, units, function () { return units[current] ? units[current].el : null; });
  function show(index) {
    if (index === current && !units[index].el.hidden) return;
    swap(units[current].el, units[index].el, function () {
      current = index;
      enter(units[current].el);
    });
  }
  const items = units.map(function (u, i) { return { id: String(i), label: u.label }; });
  const chrome = mode === 'tabs'
    ? tabs({ items: items, value: '0', onChange: function (id) { show(Number(id)); } })
    : bottomNav({
      items: items.map(function (item, i) {
        return { id: item.id, label: item.label, onPick: function () { show(i); } };
      }),
      value: '0',
    });
  alive.handles.push(chrome);
  if (units.length) units[0].el.hidden = false;
  return el('div', { class: 'ak-mosaic__picker ak-mosaic__picker--' + mode },
    mode === 'tabs' ? [chrome.el, box] : [box, chrome.el]);
}

/** The deck: a scroll-snap strip, one full-width card per unit, dots underneath. */
export function projectDeck(units, alive) {
  const strip = el('div', { class: 'ak-mosaic__deck', role: 'group' });
  const dots = el('div', { class: 'ak-mosaic__dots', 'aria-hidden': 'true' });
  units.forEach(function (u, i) {
    strip.appendChild(el('div', { class: 'ak-mosaic__deckcard', 'aria-label': u.label }, u.el));
    dots.appendChild(el('span', { class: 'ak-mosaic__dot' + (i === 0 ? ' ak-mosaic__dot--on' : '') }));
  });
  const onScroll = function () {
    const i = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
    Array.prototype.forEach.call(dots.children, function (dot, j) {
      dot.classList.toggle('ak-mosaic__dot--on', j === i);
    });
  };
  strip.addEventListener('scroll', onScroll, { passive: true });
  alive.cleanup.push(function () { strip.removeEventListener('scroll', onScroll); });
  return el('div', { class: 'ak-mosaic__deckwrap' }, [strip, dots]);
}

/** The flow: one unit, previous/next, and where you are. */
export function projectFlow(units) {
  const box = el('div', { class: 'ak-mosaic__units' });
  for (const u of units) { u.el.hidden = true; box.appendChild(u.el); }
  let current = 0;
  const where = el('span', { class: 'ak-mosaic__flowstep', 'aria-live': 'polite' });
  const swap = unitSwapper(box, units, function () { return units[current] ? units[current].el : null; });
  function show(index) {
    // The step is clamped BEFORE the move rather than inside it: the swap needs to know which
    // unit is arriving, and at either end of the flow that is the one already on screen.
    const step = Math.max(0, Math.min(units.length - 1, index));
    swap(units[current].el, units[step].el, function () {
      current = step;
      where.textContent = (current + 1) + ' / ' + units.length;
      prev.disabled = current === 0;
      next.disabled = current === units.length - 1;
      enter(units[current].el);
    });
  }
  const prev = /** @type {HTMLButtonElement} */ (el('button', {
    type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
    on: { click: function () { show(current - 1); } },
  }, t('previous')));
  const next = /** @type {HTMLButtonElement} */ (el('button', {
    type: 'button', class: 'ak-btn ak-btn--primary', 'data-ak-noguard': true,
    on: { click: function () { show(current + 1); } },
  }, t('next')));
  if (units.length) {
    units[0].el.hidden = false;
    where.textContent = '1 / ' + units.length;
    prev.disabled = true;
    next.disabled = units.length === 1;
  }
  return el('div', { class: 'ak-mosaic__flow' }, [
    box,
    el('div', { class: 'ak-mosaic__flowbar' }, [prev, where, next]),
  ]);
}
