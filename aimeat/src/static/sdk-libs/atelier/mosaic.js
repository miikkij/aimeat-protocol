/**
 * @file atelier/mosaic.js
 * @description The mosaic renderer (TARGET-074 phase 2): the client side of the stored layout.
 *   The server keeps one record per app — `{ v: 1, look?, nav?, blocks: [...] }`, validated and
 *   versioned — and this module turns it into a living screen built from the kit's own
 *   components. "Move the numbers above the list" is a stored-layout change; the app's code does
 *   not change and does not redeploy.
 *
 *   THE APP BINDS, THE LAYOUT ARRANGES. A layout block's `source` is a NAME; the app supplies a
 *   resolver for each name (`spec.sources`), and handlers, formatting and data stay the app's.
 *   A stored layout can therefore reorder, restyle and reproject the screen but can never make
 *   the app do anything its own code did not declare.
 *
 *   ONE NETWORK CALL, AND ONLY THIS ONE. The kit's no-fetch rule stands everywhere else; the
 *   mosaic's single exception is the sessionless GET of the app's OWN public layout record
 *   (`/v1/apps/:owner/:filename/ui`) — as public as the app itself, read the way the CSS is
 *   read. Identity comes from the `#aimeat-app-ref` block the node injects at serve time, or
 *   from the spec. No session, no credentials, no other endpoint.
 *
 *   NAV MODES ARE PROJECTIONS OF THE SAME BLOCKS. A hero renders as the constant band above the
 *   navigation in every mode; every other visible block is a UNIT, and the layout's `nav` decides
 *   how units are reached: stacked (default), a tab row, a bottom bar, a swipeable deck, a
 *   step-by-step flow, or a pan-and-zoom canvas whose tiles expand to full view. Switching mode
 *   is a one-field change in the stored layout. Unit switches ride View Transitions when the
 *   browser has them and collapse cleanly under prefers-reduced-motion.
 * @structure mosaic(spec) → { el, set, reload, refresh, destroy } · appRef()
 * @usage
 *   const m = AIMEAT.atelier.mosaic({
 *     app: a,
 *     sources: { 'errands.': loadErrandRows },
 *     fill: { notes: function (body) { body.append(myNotesView()); } },
 *     onPick: function (blockId, item) { open(item); },
 *     fallback: { v: 1, blocks: [{ id: 'main', component: 'list', props: { source: 'errands.' } }] },
 *   });
 *   // later, when the app's data changed:  m.refresh('errands.');
 * @version-history
 *   v0.12.0 — 2026-08-28 — The SIGNATURE and the MORPH (TARGET-074 phase 4): a layout's bounded
 *     `tokens` land as inline custom properties on the app frame (server-validated allowlist;
 *     cleared and reapplied per render), and the canvas tile now GROWS into the focused screen —
 *     a real shared-element morph via view-transition-name, not a crossfade.
 *   v0.10.0 — 2026-08-27 — Scroll reveals on the composition grid (units rise into view as they
 *     enter the viewport, distance from the look's entrance token, reduced-motion off) and the
 *     `overlay` projection: one Menu control opening a full-screen list in display type.
 *   v0.7.0 — 2026-08-27 — Composition: the stack projection places blocks on a six-column grid
 *     by their `span`, and the `rail` projection arrives (desktop left rail, phone strip).
 *   v0.4.0 — 2026-08-27 — Initial (TARGET-074 phase 2, the client renderer).
 */
import { el, clear, resolve, enter, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { APEX_URL } from '../_core/config.js';
import { section, tabs, bottomNav } from './shell.js';
import { hero, statRow, figure } from './hero.js';
import { emptyState, skeleton } from './state.js';
import { list } from './list.js';
import { cardGrid, mediaCard } from './grid.js';
import { table, searchBar } from './table.js';
import { timeline } from './timeline.js';

/** Canvas zoom bounds and wheel step — tight enough that a tile never vanishes or fills the sky. */
const CANVAS_MIN = 0.35;
const CANVAS_MAX = 1.6;
const CANVAS_STEP = 1.18;

/**
 * The app's own identity, from the `#aimeat-app-ref` block the node injects into every served
 * app. Null when absent (a raw file open, a test page) — the mosaic then renders the fallback.
 * @returns {{ owner: string, filename: string }|null}
 */
export function appRef() {
  try {
    const node = document.getElementById('aimeat-app-ref');
    if (!node) return null;
    // The node HTML-escapes the block on injection (a JSON value could otherwise carry a
    // </script> breakout), and script content is raw text, so the entities arrive literal.
    const text = (node.textContent || '')
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const parsed = JSON.parse(text);
    return parsed && parsed.owner && parsed.app_id
      ? { owner: String(parsed.owner), filename: String(parsed.app_id) }
      : null;
  } catch {
    return null;
  }
}

/**
 * The one fetch: this app's stored layout, sessionless. Resolves to the layout object or null
 * (none stored, or the read failed — the caller falls back either way).
 * @param {string} owner @param {string} filename
 * @returns {Promise<object|null>}
 */
async function loadLayout(owner, filename) {
  try {
    const base = APEX_URL || '';
    const res = await fetch(base + '/v1/apps/' + encodeURIComponent(owner)
      + '/' + encodeURIComponent(filename) + '/ui');
    if (!res.ok) return null;
    const body = await res.json();
    return (body && body.data && body.data.layout) || null;
  } catch {
    return null;
  }
}

/** The unit's tab/step/tile label: its own words first, the component name as the visible
 *  floor that nudges the layout author to give the block a `title`. */
function labelOf(block) {
  const p = block.props || {};
  return p.title || p.caption || block.component;
}

/** What `set()` takes for one bound component kind, from a freshly resolved source. */
function patchFor(kind, data) {
  if (kind === 'statRow') return { tiles: Array.isArray(data) ? data : [] };
  if (kind === 'table') return { rows: Array.isArray(data) ? data : (data && data.rows) || [] };
  if (kind === 'figure') return data && typeof data === 'object' ? data : { value: 0 };
  return { items: Array.isArray(data) ? data : [] };
}

/** Columns for a table whose source sent bare rows: one column per key of the first row.
 *  The `id` key is the row's address, not a column a person reads — it stays out. */
function derivedColumns(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter(function (key) { return key !== 'id'; }).map(function (key) {
    return { key: key, label: key, sortable: true };
  });
}

/**
 * The mosaic.
 * @param {{
 *   app?: { main: HTMLElement, el?: HTMLElement, set?: (patch: { look?: string }) => void }, target?: string|Element,
 *   sources?: Record<string, () => any>,
 *   fill?: Record<string, (body: HTMLElement) => void>,
 *   onPick?: (blockId: string, item: any) => void,
 *   onSearch?: (bind: string, query: string) => void,
 *   layout?: object|null, fallback?: object|null,
 *   owner?: string, filename?: string,
 * }} spec
 * @returns {{ el: HTMLElement, set: (layout: object|null) => void, reload: () => Promise<void>,
 *   refresh: (name?: string) => Promise<void>, destroy: () => void }}
 */
export function mosaic(spec) {
  const host = spec.app ? spec.app.main : resolve(spec.target, document.body);
  const root = el('div', { class: 'ak-root ak-mosaic' });
  host.appendChild(root);

  /** Everything one render created, so the next render (and destroy) can end it cleanly. */
  let alive = { handles: [], bound: [], cleanup: [] };
  let destroyed = false;

  /** @param {string} name @returns {Promise<any>} */
  function resolveSource(name) {
    const fn = (spec.sources || {})[name];
    if (typeof fn !== 'function') {
      console.warn('aimeat-atelier: the layout binds source "' + name + '" but the app declares no resolver for it.');
      return Promise.resolve(null);
    }
    return Promise.resolve().then(fn);
  }

  /**
   * Build one block. A source-bound block shows a skeleton until its data lands, then the real
   * component enters with it — no flash of the empty state on the way to a full one.
   * @param {{ id: string, component: string, props?: any }} block
   * @param {HTMLElement} into
   */
  function buildBlock(block, into) {
    const p = block.props || {};
    const pick = spec.onPick ? function (item) { spec.onPick(block.id, item); } : undefined;
    const empty = { title: p.emptyTitle, hint: p.emptyHint };

    /** Mount a source-bound component: skeleton → resolve → component. */
    function bound(kind, create) {
      const wait = skeleton({ target: into, rows: 2 });
      resolveSource(p.source).then(function (data) {
        if (destroyed) return;
        wait.destroy();
        const handle = create(data == null ? [] : data);
        alive.handles.push(handle);
        alive.bound.push({ name: p.source, kind: kind, handle: handle });
      });
    }

    switch (block.component) {
      case 'hero': {
        alive.handles.push(hero({ target: into, title: p.title, sub: p.sub, image: p.image }));
        return;
      }
      case 'statRow':
        return bound('statRow', function (data) {
          return statRow({ target: into, tiles: patchFor('statRow', data).tiles });
        });
      case 'figure':
        return bound('figure', function (data) {
          const d = patchFor('figure', data);
          return figure({ target: into, value: d.value, label: d.label || p.title || '', sub: d.sub, delta: d.delta });
        });
      case 'list':
        return bound('list', function (data) {
          return list({ target: into, items: patchFor('list', data).items, empty: empty, onPick: pick });
        });
      case 'cardGrid':
        return bound('cardGrid', function (data) {
          return cardGrid({ target: into, items: patchFor('cardGrid', data).items, empty: empty, onPick: pick });
        });
      case 'table':
        return bound('table', function (data) {
          const rows = patchFor('table', data).rows;
          const columns = (data && !Array.isArray(data) && data.columns) || derivedColumns(rows);
          return table({ target: into, columns: columns, rows: rows, caption: p.caption, onPick: pick });
        });
      case 'timeline':
        return bound('timeline', function (data) {
          return timeline({ target: into, items: patchFor('timeline', data).items });
        });
      case 'searchBar': {
        alive.handles.push(searchBar({
          target: into,
          onChange: spec.onSearch ? function (q) { spec.onSearch(p.bind || block.id, q); } : undefined,
        }));
        return;
      }
      case 'tabs': {
        const items = (p.items || []).map(function (label, i) { return { id: String(i), label: label }; });
        alive.handles.push(tabs({
          target: into, items: items,
          onChange: spec.onPick ? function (id) { spec.onPick(block.id, items[Number(id)] && items[Number(id)].label); } : undefined,
        }));
        return;
      }
      case 'section': {
        const s = section({ target: into, title: p.title, hint: p.hint });
        alive.handles.push(s);
        const fillFn = (spec.fill || {})[block.id];
        if (fillFn) fillFn(s.body);
        return;
      }
      case 'emptyState': {
        alive.handles.push(emptyState({ target: into, title: p.title, hint: p.hint, tone: p.tone }));
        return;
      }
      case 'mediaCard': {
        alive.handles.push(mediaCard({
          target: into,
          item: { id: block.id, title: p.title, sub: p.sub, image: p.image },
          onPick: pick,
        }));
        return;
      }
      default:
        // A component newer than this kit build: name it rather than break the screen.
        console.warn('aimeat-atelier: this kit build has no renderer for "' + block.component + '" — skipping block "' + block.id + '".');
    }
  }

  /** Swap visible units through a View Transition when the browser has one. */
  function transition(run) {
    if (typeof document.startViewTransition === 'function' && !reducedMotion()) {
      document.startViewTransition(run);
    } else {
      run();
    }
  }

  /**
   * The SHARED-ELEMENT morph: the element that exists on both sides of the change carries one
   * view-transition-name for the duration, so the browser animates it from where it WAS to where
   * it IS — a tile grows into the full screen instead of crossfading. Falls back to the plain
   * swap when the browser has no View Transitions or the person asked for reduced motion.
   * @param {HTMLElement} moving @param {() => void} run
   */
  function morph(moving, run) {
    if (typeof document.startViewTransition !== 'function' || reducedMotion()) { run(); return; }
    moving.style.viewTransitionName = 'ak-morph';
    const vt = document.startViewTransition(run);
    vt.finished.finally(function () { moving.style.viewTransitionName = ''; });
  }

  // ── The five projections ─────────────────────────────────────────────────────────────────────

  /** Stacked: every unit in order on the COMPOSITION GRID — a block's `span` places it (full
   *  line, the main column, the side column, a half), so the record composes a page instead of
   *  piling cards. Narrow screens stack everything (the stylesheet folds the grid). Units below
   *  the fold REVEAL as they scroll into view — the distance rides the look's own entrance
   *  token, so a look that declares no entrance (flat) moves nothing here either. */
  function projectStack(units) {
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
  function projectOverlay(units) {
    const box = el('div', { class: 'ak-mosaic__units' });
    for (const u of units) { u.el.hidden = true; box.appendChild(u.el); }
    let current = 0;
    let open = false;
    const items = [];

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
        transition(function () {
          units[current].el.hidden = true;
          current = index;
          units[current].el.hidden = false;
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
  function projectRail(units) {
    const box = el('div', { class: 'ak-mosaic__units' });
    for (const u of units) { u.el.hidden = true; box.appendChild(u.el); }
    let current = 0;
    const items = [];
    function show(index) {
      if (index === current && !units[index].el.hidden) return;
      transition(function () {
        units[current].el.hidden = true;
        current = index;
        units[current].el.hidden = false;
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
  function projectPicker(units, mode) {
    const box = el('div', { class: 'ak-mosaic__units' });
    for (const u of units) { u.el.hidden = true; box.appendChild(u.el); }
    let current = 0;
    function show(index) {
      if (index === current && !units[index].el.hidden) return;
      transition(function () {
        units[current].el.hidden = true;
        current = index;
        units[current].el.hidden = false;
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
  function projectDeck(units) {
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
  function projectFlow(units) {
    const box = el('div', { class: 'ak-mosaic__units' });
    for (const u of units) { u.el.hidden = true; box.appendChild(u.el); }
    let current = 0;
    const where = el('span', { class: 'ak-mosaic__flowstep', 'aria-live': 'polite' });
    function show(index) {
      transition(function () {
        units[current].el.hidden = true;
        current = Math.max(0, Math.min(units.length - 1, index));
        units[current].el.hidden = false;
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

  /**
   * The canvas: units as live tiles on a pan-and-zoom field. Zoomed out the app is its own map;
   * a tile expands to full view on pick and collapses on back — the semantic-zoom promise, sized
   * for v1. Buttons carry the zoom for keyboards and touch alike; drag pans; wheel zooms at the
   * cursor. Nothing animates at idle — motion happens on input only.
   */
  function projectCanvas(units) {
    const field = el('div', { class: 'ak-mosaic__field' });
    const cam = { x: 0, y: 0, scale: 0.6 };
    let focused = null;

    function apply() {
      field.style.transform = 'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.scale + ')';
    }

    const viewport = el('div', { class: 'ak-mosaic__canvas' }, field);

    units.forEach(function (u) {
      const cover = el('button', {
        type: 'button', class: 'ak-mosaic__tilecover', 'data-ak-noguard': true,
        'aria-label': t('open') + ': ' + u.label,
        on: { click: function () { focus(u); } },
      });
      u.tile = el('div', { class: 'ak-mosaic__tile' }, [
        el('span', { class: 'ak-mosaic__tilelabel', text: u.label }),
        u.el, cover,
      ]);
      field.appendChild(u.tile);
    });

    const focusHost = el('div', { class: 'ak-mosaic__focus', hidden: true });
    const backBtn = el('button', {
      type: 'button', class: 'ak-btn ak-btn--ghost', 'data-ak-noguard': true,
      on: { click: function () { unfocus(); } },
    }, '↩ ' + t('back'));

    function focus(u) {
      morph(u.el, function () {
        focused = u;
        focusHost.hidden = false;
        viewport.hidden = true;
        zoombar.hidden = true;
        clear(focusHost);
        focusHost.appendChild(backBtn);
        focusHost.appendChild(u.el);
        enter(focusHost);
      });
    }
    function unfocus() {
      if (!focused) return;
      const u = focused;
      morph(u.el, function () {
        focused = null;
        u.tile.insertBefore(u.el, u.tile.lastChild);
        focusHost.hidden = true;
        viewport.hidden = false;
        zoombar.hidden = false;
      });
    }

    // Pan by pointer drag; zoom at the cursor by wheel; buttons as the keyboard-reachable twin.
    let drag = null;
    viewport.addEventListener('pointerdown', function (ev) {
      const at = /** @type {Element|null} */ (ev.target instanceof Element ? ev.target : null);
      if (at && at.closest('.ak-mosaic__tilecover')) return;
      drag = { x: ev.clientX, y: ev.clientY };
      viewport.setPointerCapture(ev.pointerId);
    });
    viewport.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      cam.x += ev.clientX - drag.x;
      cam.y += ev.clientY - drag.y;
      drag = { x: ev.clientX, y: ev.clientY };
      apply();
    });
    viewport.addEventListener('pointerup', function () { drag = null; });
    viewport.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? CANVAS_STEP : 1 / CANVAS_STEP;
      const next = Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, cam.scale * factor));
      const rect = viewport.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      cam.x = px - (px - cam.x) * (next / cam.scale);
      cam.y = py - (py - cam.y) * (next / cam.scale);
      cam.scale = next;
      apply();
    }, { passive: false });

    function zoomBtn(label, aria, factor) {
      return el('button', {
        type: 'button', class: 'ak-btn ak-btn--ghost', 'aria-label': aria, 'data-ak-noguard': true,
        on: {
          click: function () {
            cam.scale = factor === 0 ? 0.6 : Math.max(CANVAS_MIN, Math.min(CANVAS_MAX, cam.scale * factor));
            if (factor === 0) { cam.x = 0; cam.y = 0; }
            apply();
          },
        },
      }, label);
    }
    const zoombar = el('div', { class: 'ak-mosaic__zoombar' }, [
      zoomBtn('−', t('zoomOut'), 1 / CANVAS_STEP),
      zoomBtn('⤢', t('fitView'), 0),
      zoomBtn('+', t('zoomIn'), CANVAS_STEP),
    ]);

    apply();
    return el('div', { class: 'ak-mosaic__canvaswrap' }, [viewport, zoombar, focusHost]);
  }

  // ── Render, and the handle ───────────────────────────────────────────────────────────────────

  /** @param {object|null} layout */
  function render(layout) {
    for (const h of alive.handles) { if (h && h.destroy) h.destroy(); }
    for (const fn of alive.cleanup) fn();
    alive = { handles: [], bound: [], cleanup: [] };
    clear(root);
    if (!layout || !Array.isArray(layout.blocks)) return;

    if (layout.look && spec.app && spec.app.set) spec.app.set({ look: layout.look });
    root.setAttribute('data-ak-nav', layout.nav || 'stack');

    // The SIGNATURE: the layout's bounded token overrides land as inline custom properties on the
    // app frame (or this root, when there is no frame), so one app's shape, type, density and
    // motion diverge from the look without a stylesheet. The server validated the names and
    // values against the allowlist; older stored layouts simply have no tokens.
    const tokenHost = /** @type {any} */ (spec.app && spec.app.el ? spec.app.el : root);
    if (tokenHost.__akTokens) {
      for (const name of tokenHost.__akTokens) tokenHost.style.removeProperty(name);
    }
    tokenHost.__akTokens = [];
    if (layout.tokens && typeof layout.tokens === 'object') {
      for (const name of Object.keys(layout.tokens)) {
        if (name.indexOf('--ak-') !== 0) continue; // belt on top of the server allowlist
        tokenHost.style.setProperty(name, String(layout.tokens[name]));
        tokenHost.__akTokens.push(name);
      }
    }

    const visible = layout.blocks.filter(function (b) { return !b.hidden; });
    const band = el('div', { class: 'ak-mosaic__band' });
    const units = [];
    for (const block of visible) {
      if (block.component === 'hero') {
        buildBlock(block, band);
        continue;
      }
      const unitEl = el('section', { class: 'ak-mosaic__unit', 'data-ak-block': block.id });
      buildBlock(block, unitEl);
      units.push({ el: unitEl, label: labelOf(block), block: block });
    }
    if (band.childNodes.length) root.appendChild(band);

    const nav = layout.nav || 'stack';
    if (!units.length) return;
    if (nav === 'tabs' || nav === 'bottom-bar') root.appendChild(projectPicker(units, nav));
    else if (nav === 'deck') root.appendChild(projectDeck(units));
    else if (nav === 'flow') root.appendChild(projectFlow(units));
    else if (nav === 'canvas') root.appendChild(projectCanvas(units));
    else if (nav === 'rail') root.appendChild(projectRail(units));
    else if (nav === 'overlay') root.appendChild(projectOverlay(units));
    else root.appendChild(projectStack(units));
  }

  let currentLayout = null;

  /** Fetch (unless given), fall back, render. */
  async function boot() {
    let layout = spec.layout || null;
    if (!layout) {
      const ref = spec.owner && spec.filename
        ? { owner: spec.owner, filename: spec.filename }
        : appRef();
      if (ref) layout = await loadLayout(ref.owner, ref.filename);
    }
    if (destroyed) return;
    currentLayout = layout || spec.fallback || null;
    render(currentLayout);
  }
  const booting = boot();

  return {
    el: root,

    /** Replace the whole rendered layout — what a live layout-change event calls. */
    set(layout) {
      currentLayout = layout || spec.fallback || null;
      render(currentLayout);
    },

    /** Re-fetch the stored layout and re-render — after the app knows it changed. */
    async reload() {
      await booting;
      const ref = spec.owner && spec.filename
        ? { owner: spec.owner, filename: spec.filename }
        : appRef();
      const layout = ref ? await loadLayout(ref.owner, ref.filename) : null;
      if (destroyed) return;
      currentLayout = layout || spec.fallback || null;
      render(currentLayout);
    },

    /**
     * Re-resolve one source (or all) and hand the fresh rows to every component bound to it.
     * The change paints with the components' own motion — this is the app's line to call when
     * its data moved.
     * @param {string} [name]
     */
    async refresh(name) {
      await booting;
      const targets = alive.bound.filter(function (b) { return !name || b.name === name; });
      await Promise.all(targets.map(function (b) {
        return resolveSource(b.name).then(function (data) {
          if (!destroyed && data != null) b.handle.set(patchFor(b.kind, data));
        });
      }));
    },

    destroy() {
      destroyed = true;
      for (const h of alive.handles) { if (h && h.destroy) h.destroy(); }
      for (const fn of alive.cleanup) fn();
      alive = { handles: [], bound: [], cleanup: [] };
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
