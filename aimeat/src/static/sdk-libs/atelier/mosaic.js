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
 *   v0.36.0 — 2026-08-30 — The work-planning family (`kanban` with onMove wiring, `plan`,
 *     `schedule`); scene3d binds model/globe record shapes; the six flat projections extracted
 *     whole to mosaic-projections.js under the 800-line rule (pure move).
 *   v0.18.0 — 2026-08-29 — The ops family (`health`, `queue`, `gauge`, `console`), the `atlas`
 *     and the chart's `kind` join the block vocabulary; LIVE BY DECLARATION — the spec's
 *     `live` map wires declared sources to aimeat-live with the firehose guards built in;
 *     appRef/loadLayout/labelOf extracted whole to mosaic-layout.js under the 800-line rule.
 *   v0.17.0 — 2026-08-29 — The `scene3d` block (bars bind a source; orb and sky mount bare);
 *     transition/morph extracted whole to mosaic-motion.js under the 800-line rule.
 *   v0.16.0 — 2026-08-28 — The harvest trio joins the vocabulary: `matrix`, `graph` and
 *     `waveform` blocks, each riding its bound record whole like the chart.
 *   v0.15.0 — 2026-08-28 — The `chart` block: the bound record ({ labels, series }) rides to the
 *     chart component whole — the first harvest component in the layout vocabulary.
 *   v0.14.0 — 2026-08-28 — The signature COLOUR pair: an `--ak-accent` token of the form
 *     "#light/#dark" lands as a two-rule style element on :root (light default,
 *     `:root[data-theme="dark"]` override) instead of an inline property — inline cannot switch
 *     with the theme, and the sheet's derivations substitute var(--ak-accent) at :root, so only
 *     a :root override reaches them. Removed on re-render and on destroy.
 *   v0.13.0 — 2026-08-28 — The AI-NATIVE layer reaches the mosaic (TARGET-074 phase 6): the
 *     `aide` block (its tools are the spec's own sources and actions), the viewer's overlay
 *     (hidden/order/nav over the owner's layout, applied at render, never written back) with
 *     setOverlay() on the handle, explain() — what this screen holds, generated from the
 *     declarations instead of a help text that would drift — and exposeActions(): the same
 *     declared actions handed to a visiting in-browser agent over WebMCP (one declaration,
 *     four doors: the button, the aide, the agent, and the app's own code).
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
import { el, clear, resolve, enter } from './dom.js';
import { t } from './i18n.js';
import { section, tabs } from './shell.js';
import { hero, statRow, figure, rating } from './hero.js';
import { emptyState, skeleton } from './state.js';
import { list } from './list.js';
import { cardGrid, mediaCard } from './grid.js';
import { table, searchBar } from './table.js';
import { timeline } from './timeline.js';
import { chart } from './chart.js';
import { matrix } from './matrix.js';
import { graph } from './graph.js';
import { waveform } from './waveform.js';
import { scene3d } from './scene3d.js';
import { reveal } from './disclose.js';
import { patchFor, derivedColumns, wireLive } from './mosaic-bind.js';
import { morph } from './mosaic-motion.js';
import { appRef, loadLayout, labelOf } from './mosaic-layout.js';
import { aide } from './aide.js';
import { projectCanvas } from './mosaic-canvas.js';
import { projectStack, projectOverlay, projectRail, projectPicker, projectDeck, projectFlow } from './mosaic-projections.js';
import { health, queue, gauge } from './ops.js';
import { kanban, plan, schedule, steps } from './planner.js';
import { konsole } from './konsole.js';
import { legalLinks, auditTrail, feedbackForm, reviewerLine } from './commercial.js';
import { atlas } from './atlas.js';
import { map } from './map.js';

export { appRef };

/** Canvas zoom bounds and wheel step — tight enough that a tile never vanishes or fills the sky. */
// The canvas camera constants moved with the projection to mosaic-canvas.js (pure extraction);
// appRef/loadLayout/labelOf moved whole to mosaic-layout.js the same way.

/**
 * The mosaic.
 * @param {{
 *   app?: { main: HTMLElement, el?: HTMLElement, set?: (patch: { look?: string }) => void }, target?: string|Element,
 *   sources?: Record<string, () => any>,
 *   live?: Record<string, { keyPrefix?: string|string[], domains?: string[], minIntervalMs?: number }>,
 *   actions?: Array<{ id: string, summary: string, params?: Record<string, string>, run?: (params: any) => any }>,
 *   overlay?: { hidden?: string[], order?: string[], nav?: string }|null,
 *   fill?: Record<string, (body: HTMLElement) => void>,
 *   onPick?: (blockId: string, item: any) => void,
 *   onSearch?: (bind: string, query: string) => void,
 *   onMove?: (blockId: string, cardId: string, toColumnId: string) => void,
 *   layout?: object|null, fallback?: object|null,
 *   owner?: string, filename?: string,
 * }} spec
 * @returns {{ el: HTMLElement, set: (layout: object|null) => void, reload: () => Promise<void>,
 *   setOverlay: (o: { hidden?: string[], order?: string[], nav?: string }|null) => void,
 *   explain: (opts?: { target?: string|Element }) => string[],
 *   exposeActions: () => Promise<string>,
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
      case 'aide': {
        // The aide's tools ARE the app's declarations: the same sources this mosaic reads and
        // the actions the app handed the spec. It can do nothing a button could not.
        alive.handles.push(aide({
          target: into, appName: p.title || document.title, intro: p.intro,
          appId: p.title, sources: spec.sources || {}, actions: spec.actions || [],
        }));
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
      case 'rating':
        return bound('rating', function (data) {
          const d = patchFor('rating', data).data || {};
          return rating({ target: into, value: Number(d.value) || 0, max: d.max, count: d.count, label: d.label || p.title });
        });
      case 'steps':
        return bound('steps', function (data) {
          return steps({ target: into, data: patchFor('steps', data).data, empty: empty });
        });
      case 'list':
        return bound('list', function (data) {
          return list({ target: into, items: patchFor('list', data).items, empty: empty, onPick: pick });
        });
      case 'cardGrid':
        return bound('cardGrid', function (data) {
          return cardGrid({ target: into, items: patchFor('cardGrid', data).items, empty: empty, onPick: pick });
        });
      case 'chart':
        return bound('chart', function (data) {
          return chart({
            target: into, data: patchFor('chart', data).data, title: p.title, empty: empty,
            presentation: p.presentation === 'mural' ? 'mural' : 'tile',
            kind: p.kind,
          });
        });
      case 'health':
        return bound('health', function (data) {
          return health({ target: into, data: patchFor('health', data).data, empty: empty, onPick: pick });
        });
      case 'queue':
        return bound('queue', function (data) {
          return queue({ target: into, data: patchFor('queue', data).data, empty: empty, onPick: pick });
        });
      case 'gauge':
        return bound('gauge', function (data) {
          return gauge({ target: into, data: patchFor('gauge', data).data, empty: empty });
        });
      case 'console':
        return bound('console', function (data) {
          return konsole({ target: into, data: patchFor('console', data).data, cap: p.cap, empty: empty });
        });
      case 'kanban':
        return bound('kanban', function (data) {
          return kanban({
            target: into, data: patchFor('kanban', data).data, empty: empty,
            onMove: spec.onMove ? function (cardId, toColumn) { spec.onMove(block.id, cardId, toColumn); } : undefined,
          });
        });
      case 'plan':
        return bound('plan', function (data) {
          return plan({ target: into, data: patchFor('plan', data).data, empty: empty });
        });
      case 'schedule':
        return bound('schedule', function (data) {
          return schedule({ target: into, data: patchFor('schedule', data).data, empty: empty, onPick: pick });
        });
      case 'atlas':
        return bound('atlas', function (data) {
          return atlas({ target: into, data: patchFor('atlas', data).data, title: p.title, fit: p.fit, empty: empty, onPick: pick });
        });
      case 'map':
        return bound('map', function (data) {
          return map({ target: into, data: patchFor('map', data).data, title: p.title, zoom: p.zoom, empty: empty, onPick: pick });
        });
      case 'matrix':
        return bound('matrix', function (data) {
          return matrix({ target: into, data: patchFor('matrix', data).data, empty: empty, onPick: pick });
        });
      case 'graph':
        return bound('graph', function (data) {
          return graph({ target: into, data: patchFor('graph', data).data, title: p.title, empty: empty, onPick: pick });
        });
      case 'waveform':
        return bound('waveform', function (data) {
          return waveform({ target: into, data: patchFor('waveform', data).data, title: p.title, empty: empty });
        });
      case 'scene3d': {
        // bars binds a source (rows stand up as columns); model and globe bind their own
        // record shapes ({ url } / { points, routes }); orb and sky need no data at all.
        if (p.source) {
          return bound('scene3d', function (data) {
            const shaped = (p.kind === 'model' || p.kind === 'globe')
              ? (data && !Array.isArray(data) ? data : null)
              : { items: patchFor('scene3d', data).items };
            return scene3d({ target: into, kind: p.kind, data: shaped, title: p.title, empty: empty });
          });
        }
        alive.handles.push(scene3d({ target: into, kind: p.kind, title: p.title }));
        return;
      }
      case 'reveal':
        return bound('reveal', function (data) {
          return reveal({ target: into, items: patchFor('reveal', data).items, mode: p.mode === 'many' ? 'many' : 'one' });
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
      // ── The commercial side: self-sourced blocks (the app's own public legal surface, the
      //    organism row space and the intake form the props name), no memory source to bind.
      case 'legalLinks': {
        alive.handles.push(legalLinks({ target: into, title: p.title }));
        return;
      }
      case 'auditTrail': {
        alive.handles.push(auditTrail({
          target: into, org: p.org, ws: p.ws, space: p.space, title: p.title, hint: p.hint,
        }));
        return;
      }
      case 'feedbackForm': {
        alive.handles.push(feedbackForm({
          target: into, org: p.org, ws: p.ws, formId: p.formId, title: p.title, hint: p.hint,
        }));
        return;
      }
      case 'reviewerLine': {
        alive.handles.push(reviewerLine({ target: into }));
        return;
      }
      default:
        // A component newer than this kit build: name it rather than break the screen.
        console.warn('aimeat-atelier: this kit build has no renderer for "' + block.component + '" — skipping block "' + block.id + '".');
    }
  }

  // ── The flat projections live in mosaic-projections.js; the canvas one in mosaic-canvas.js.

  /** The viewer's own overlay, applied over the owner's layout at render. */
  let viewerOverlay = spec.overlay || null;

  /**
   * Apply one viewer's overlay to a layout copy: `hidden` drops blocks, `order` re-sorts the
   * rest (ids it does not name keep their place at the end), `nav` re-projects. Props are
   * deliberately untouchable — an overlay arranges, it never rewrites content.
   * @param {any} layout @param {{ hidden?: string[], order?: string[], nav?: string }|null} o
   */
  function applyViewerOverlay(layout, o) {
    if (!o) return layout;
    const out = { v: layout.v, look: layout.look, nav: o.nav || layout.nav, tokens: layout.tokens, meta: layout.meta, blocks: layout.blocks.slice() };
    if (Array.isArray(o.hidden) && o.hidden.length) {
      out.blocks = out.blocks.filter(function (b) { return o.hidden.indexOf(b.id) < 0; });
    }
    if (Array.isArray(o.order) && o.order.length) {
      out.blocks.sort(function (a, b) {
        const ia = o.order.indexOf(a.id); const ib = o.order.indexOf(b.id);
        return (ia < 0 ? o.order.length : ia) - (ib < 0 ? o.order.length : ib);
      });
    }
    return out;
  }

  // ── Render, and the handle ───────────────────────────────────────────────────────────────────

  /** @param {object|null} layout */
  function render(layout) {
    for (const h of alive.handles) { if (h && h.destroy) h.destroy(); }
    for (const fn of alive.cleanup) fn();
    alive = { handles: [], bound: [], cleanup: [] };
    clear(root);
    if (!layout || !Array.isArray(layout.blocks)) return;

    // The VIEWER'S overlay: their own kept preference over the owner's page — hide, reorder,
    // change the navigation — applied at render, never written back to the owner's layout. The
    // malleable-software rule: the person shapes their tool at the moment of use, the owner's
    // base survives untouched.
    layout = applyViewerOverlay(layout, viewerOverlay);

    if (layout.look && spec.app && spec.app.set) spec.app.set({ look: layout.look });
    root.setAttribute('data-ak-nav', layout.nav || 'stack');
    // The choreography is a class the stylesheet reads: scroll timelines live entirely in CSS,
    // so 'cinema' costs the page nothing at idle and reduced motion switches it off wholesale.
    root.setAttribute('data-ak-choreo', layout.choreography === 'cinema' ? 'cinema' : 'still');

    // The SIGNATURE: the layout's bounded token overrides land as inline custom properties on the
    // app frame (or this root, when there is no frame), so one app's shape, type, density and
    // motion diverge from the look without a stylesheet. The server validated the names and
    // values against the allowlist; older stored layouts simply have no tokens.
    const tokenHost = /** @type {any} */ (spec.app && spec.app.el ? spec.app.el : root);
    if (tokenHost.__akTokens) {
      for (const name of tokenHost.__akTokens) tokenHost.style.removeProperty(name);
    }
    tokenHost.__akTokens = [];
    if (tokenHost.__akSigStyle) { tokenHost.__akSigStyle.remove(); tokenHost.__akSigStyle = null; }
    if (layout.tokens && typeof layout.tokens === 'object') {
      for (const name of Object.keys(layout.tokens)) {
        if (name.indexOf('--ak-') !== 0) continue; // belt on top of the server allowlist
        const value = String(layout.tokens[name]);
        // The signature COLOUR is a light/dark pair "#hex/#hex" applied PER MODE — an inline
        // property cannot switch with the theme, so the pair lands as a two-rule style element.
        // It MUST target :root, not the app frame: the sheet's derivations (gradient, mesh,
        // spectrum, text tints) are custom properties declared at :root, and the browser
        // substitutes their var(--ak-accent) AT :ROOT at computed-value time — descendants
        // inherit the already-resolved value, so a frame-scoped override would recolour direct
        // uses while every derivation kept the house colour (measured in a real browser).
        if (name === '--ak-accent' && value.indexOf('/') >= 0) {
          const halves = value.split('/');
          const light = halves[0].trim();
          const dark = (halves[1] || halves[0]).trim();
          if (!/^#[0-9a-fA-F]{3,6}$/.test(light) || !/^#[0-9a-fA-F]{3,6}$/.test(dark)) continue;
          const style = document.createElement('style');
          style.textContent = ':root{--ak-accent:' + light + '}\n'
            + ':root[data-theme="dark"]{--ak-accent:' + dark + '}';
          document.head.appendChild(style);
          tokenHost.__akSigStyle = style;
          continue;
        }
        tokenHost.style.setProperty(name, value);
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
    if (nav === 'tabs' || nav === 'bottom-bar') root.appendChild(projectPicker(units, nav, alive));
    else if (nav === 'deck') root.appendChild(projectDeck(units, alive));
    else if (nav === 'flow') root.appendChild(projectFlow(units));
    else if (nav === 'canvas') root.appendChild(projectCanvas(units, morph));
    else if (nav === 'rail') root.appendChild(projectRail(units));
    else if (nav === 'overlay') root.appendChild(projectOverlay(units, alive));
    else root.appendChild(projectStack(units, alive));
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

  // LIVE BY DECLARATION: when the spec names live sources and the app loaded aimeat-live, a
  // change on the declared keys re-resolves that source and the components repaint with their
  // own motion. Guarded in wireLive — no prefix, no memory subscription.
  const stopLive = wireLive(spec, function (name) { api.refresh(name); });

  const api = {
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

    /**
     * ONE DECLARATION, FOUR DOORS: expose this mosaic's declared actions to an in-browser agent
     * through WebMCP. The same { id, summary, params, run } the buttons and the aide use
     * becomes the visiting agent's tool — same handler, same limits, nothing extra. Returns the
     * registration surface name, or 'none' when the page has no agent API or no actions.
     * @returns {Promise<string>}
     */
    async exposeActions() {
      const ns = /** @type {any} */ (window).AIMEAT;
      if (!ns || !ns.webmcp || typeof ns.webmcp.register !== 'function') return 'none';
      const tools = (spec.actions || []).map(function (a) {
        const properties = {};
        const params = a.params || {};
        for (const key of Object.keys(params)) {
          properties[key] = { type: params[key] === 'number' ? 'number' : 'string' };
        }
        return {
          name: 'app-' + a.id,
          description: a.summary + ' (a declared action of this app; runs the same handler its button runs).',
          inputSchema: { type: 'object', properties: properties },
          execute: async function (input) {
            const result = await Promise.resolve(a.run ? a.run(input || {}) : null);
            return typeof result === 'string' ? result : 'done';
          },
        };
      });
      if (!tools.length) return 'none';
      return ns.webmcp.register(tools);
    },

    /**
     * The viewer's overlay: set (or clear with null) and re-render. The APP owns loading and
     * saving the overlay record (the viewer's own memory) — the mosaic only applies it.
     * @param {{ hidden?: string[], order?: string[], nav?: string }|null} o
     */
    setOverlay(o) {
      viewerOverlay = o || null;
      render(currentLayout);
    },

    /**
     * EXPLAIN THIS SCREEN, generated from the declarations rather than from a hand-written help
     * text that would drift: every visible block, its name and what it draws from, in words.
     * Returns the lines; also renders them as a designed panel when `target` is given.
     * @param {{ target?: string|Element }} [opts]
     */
    explain(opts) {
      const layout = currentLayout ? applyViewerOverlay(currentLayout, viewerOverlay) : null;
      const lines = (layout && Array.isArray(layout.blocks) ? layout.blocks : [])
        .filter(function (b) { return !b.hidden; })
        .map(function (b) {
          const p = b.props || {};
          const name = p.title || labelOf(b);
          return name + ' — ' + b.component + (p.source ? ' (' + t('open').toLowerCase() + ': ' + p.source + ')' : '');
        });
      if (opts && opts.target) {
        const host = resolve(opts.target);
        const panel = el('div', { class: 'ak-root ak-explain' }, [
          el('h3', { class: 'ak-section__title', text: t('explainTitle') }),
          el('ul', { class: 'ak-explain__list' }, lines.map(function (line) { return el('li', { text: line }); })),
        ]);
        host.appendChild(panel);
        enter(panel);
      }
      return lines;
    },

    destroy() {
      destroyed = true;
      stopLive();
      for (const h of alive.handles) { if (h && h.destroy) h.destroy(); }
      for (const fn of alive.cleanup) fn();
      alive = { handles: [], bound: [], cleanup: [] };
      const host = /** @type {any} */ (spec.app && spec.app.el ? spec.app.el : root);
      if (host.__akSigStyle) { host.__akSigStyle.remove(); host.__akSigStyle = null; }
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
  return api;
}
